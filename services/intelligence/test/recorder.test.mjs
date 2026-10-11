import test from "node:test";
import assert from "node:assert/strict";
import {
  mkdtempSync,
  rmSync,
  writeFileSync,
  readFileSync,
  existsSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { execFileSync } from "node:child_process";
import { once } from "node:events";
import { EvidenceStore } from "../src/store.mjs";
import { Recorder, hashFile } from "../src/recorder.mjs";
import { createIntelligenceServer, SCOPES } from "../src/server.mjs";
import { Scheduler } from "../src/scheduler.mjs";
import { createSourceAdapters } from "../src/source-adapters.mjs";
import { Fault } from "../src/validation.mjs";

const locked = resolve(
  import.meta.dirname,
  "../../../node_modules/ffmpeg-static/ffmpeg",
);
const ffmpeg =
  process.env.LIVELENS_FFMPEG_PATH ??
  (existsSync(locked) ? locked : "/usr/bin/ffmpeg");
async function until(predicate, timeout = 20_000) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    const value = predicate();
    if (value) return value;
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error("Recorder readiness timeout");
}
function fixture(t, { corrupt = false } = {}) {
  const dir = mkdtempSync(join(tmpdir(), "livelens-recorder-"));
  const input = join(dir, "fixture.mp4"),
    db = join(dir, "evidence.sqlite");
  if (corrupt) writeFileSync(input, "not-media");
  else
    execFileSync(ffmpeg, [
      "-v",
      "error",
      "-f",
      "lavfi",
      "-i",
      "testsrc2=size=160x90:rate=10",
      "-f",
      "lavfi",
      "-i",
      "sine=frequency=440:sample_rate=44100",
      "-t",
      "12",
      "-c:v",
      "libx264",
      "-threads",
      "1",
      "-pix_fmt",
      "yuv420p",
      "-c:a",
      "aac",
      input,
    ]);
  let store = new EvidenceStore(db);
  for (const workspace of ["alpha", "beta"])
    store.createSession(workspace, {
      id: "session",
      platform: "fixture",
      sourceUrl: "https://example.invalid/fixture",
      title: "Fictional recorder fixture",
      startedAtMs: Date.now(),
    });
  const config = {
    mediaRoot: join(dir, "media"),
    ffmpeg,
    sources: ["alpha", "beta"].map((workspace) => ({
      id: "source",
      workspace,
      sessionId: "session",
      kind: "file",
      input,
    })),
  };
  let worker = new Recorder({ store, ...config });
  const f = {
    dir,
    input,
    db,
    config,
    get store() {
      return store;
    },
    get worker() {
      return worker;
    },
    async restart() {
      await worker.close();
      store.close();
      store = new EvidenceStore(db);
      worker = new Recorder({ store, ...config });
      worker.start();
    },
  };
  t.after(async () => {
    await worker.close();
    store.close();
    rmSync(dir, { recursive: true, force: true });
  });
  return f;
}
test("durable job retries conflict, remain workspace/session-bound and stop before capture", async (t) => {
  const f = fixture(t);
  const value = {
    id: "job",
    sessionId: "session",
    sourceId: "source",
    maxDurationSeconds: 12,
    segmentSeconds: 2,
  };
  const job = f.worker.create("alpha", value);
  assert.equal(job.state, "queued");
  assert.equal(job.segments.length, 0);
  assert.deepEqual(f.worker.create("alpha", value), job);
  assert.throws(
    () => f.worker.create("alpha", { ...value, maxDurationSeconds: 10 }),
    /job_identity_conflict/,
  );
  assert.throws(() => f.worker.job("beta", "job"), /job_not_found/);
  assert.throws(
    () => f.worker.create("alpha", { ...value, input: "/tmp/arbitrary" }),
    /unknown_field/,
  );
  assert.throws(
    () => f.worker.create("alpha", { ...value, sessionId: "missing" }),
    /session_not_found/,
  );
  f.worker.stop("alpha", "job");
  await f.restart();
  assert.equal(f.worker.job("alpha", "job").state, "stopped");
  assert.equal(f.worker.list("beta").length, 0);
});
test("real segmented media becomes active only after verification, survives restart and supports reports/range replay", async (t) => {
  const f = fixture(t);
  f.worker.create("alpha", {
    id: "job",
    sessionId: "session",
    sourceId: "source",
    maxDurationSeconds: 25,
    segmentSeconds: 2,
  });
  f.worker.start();
  const initial = f.worker.job("alpha", "job");
  assert.equal(initial.segments.length, 0);
  assert.notEqual(initial.state, "recording");
  await until(() => f.worker.job("alpha", "job").state === "recording");
  const first = f.worker.job("alpha", "job").segments[0];
  assert.equal(
    await hashFile((await f.worker.media("alpha", "job", first.id)).path),
    first.sha256,
  );
  await f.restart();
  assert.ok(
    f.store
      .search("alpha", { query: "service restart" })
      .some((e) => e.kind === "gap"),
  );
  await until(() => f.worker.job("alpha", "job").state === "completed");
  const job = f.worker.job("alpha", "job");
  assert.equal(job.attempts, 2);
  assert.ok(job.segments.length >= 3);
  const manifestPath = join(
    f.config.mediaRoot,
    "alpha",
    "job",
    "attempt-2",
    "manifest.json",
  );
  assert.equal(JSON.parse(readFileSync(manifestPath)).state, "completed");
  const event = f.store.append("alpha", "session", [
    {
      source: { adapter: "fixture", eventId: "statement" },
      kind: "chat",
      account: "fictional_viewer",
      text: "Reopen this fixture after restart",
      capturedAtMs: first.startedAtMs + 500,
    },
  ])[0].evidence;
  f.store.createCase(
    "alpha",
    { id: "case", title: "Fixture report", question: "What was retained?" },
    "operator",
  );
  f.store.linkEvidence("alpha", "case", [event.id], "operator");
  const keys = ["alpha", "beta"].map((workspace, i) => ({
    token: String(i + 1).repeat(40),
    workspace,
    subject: "operator",
    scopes: SCOPES,
  }));
  const server = createIntelligenceServer({
    store: f.store,
    recorder: f.worker,
    keys,
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  t.after(async () => {
    server.closeAllConnections();
    await new Promise((r) => server.close(r));
  });
  const base = "http://127.0.0.1:" + server.address().port;
  const call = (path, headers = {}) =>
    fetch(base + path, {
      headers: { Authorization: "Bearer " + keys[0].token, ...headers },
    });
  const response = await call(`/v1/media/job/${first.id}`, {
    Range: "bytes=0-99",
  });
  assert.equal(response.status, 206);
  assert.equal((await response.arrayBuffer()).byteLength, 100);
  assert.equal(
    (
      await call(`/v1/media/job/${first.id}`, {
        Authorization: "Bearer " + keys[1].token,
      })
    ).status,
    404,
  );
  assert.equal(
    (await call(`/v1/media/job/${first.id}`, { Range: "bytes=999999999-" }))
      .status,
    416,
  );
  const report = await (await call("/v1/cases/case/report")).json();
  assert.equal(report.evidence[0].id, event.id);
  assert.equal(report.media[0].segments[0].sha256, first.sha256);
  const media = await f.worker.media("alpha", "job", first.id);
  writeFileSync(media.path, "damaged");
  assert.equal((await call(`/v1/media/job/${first.id}`)).status, 409);
  assert.equal((await call("/v1/cases/case/report")).status, 409);
});
test("unavailable input has bounded retries and honest gaps, never recording success", async (t) => {
  const f = fixture(t, { corrupt: true });
  f.worker.create("alpha", {
    id: "failed",
    sessionId: "session",
    sourceId: "source",
    maxDurationSeconds: 12,
    segmentSeconds: 2,
  });
  f.worker.start();
  await until(() => f.worker.job("alpha", "failed").state === "failed");
  const job = f.worker.job("alpha", "failed");
  assert.equal(job.attempts, 3);
  assert.deepEqual(job.segments, []);
  assert.equal(
    f.store.search("alpha", { query: "media unavailable" }).length,
    3,
  );
});
test("stop finalises real media and an interrupted partial tail remains unavailable", async (t) => {
  const f = fixture(t);
  f.worker.create("alpha", {
    id: "stop",
    sessionId: "session",
    sourceId: "source",
    maxDurationSeconds: 20,
    segmentSeconds: 2,
  });
  f.worker.start();
  await until(() => f.worker.job("alpha", "stop").segments.length > 0);
  const first = f.worker.job("alpha", "stop").segments[0];
  // Abrupt FFmpeg death leaves an unlisted MP4 tail; recovery must quarantine it.
  f.worker.active.child.kill("SIGKILL");
  await until(
    () => f.store.search("alpha", { query: "partial tail" }).length > 0,
  );
  assert.ok(f.store.search("alpha", { query: "media unavailable" }).length > 0);
  f.worker.stop("alpha", "stop");
  await until(() => f.worker.job("alpha", "stop").state === "stopped");
  assert.equal(
    (await f.worker.media("alpha", "stop", first.id)).sha256,
    first.sha256,
  );
  await f.restart();
  assert.equal(f.worker.job("alpha", "stop").state, "stopped");
});

test("two actual FFmpeg recordings run concurrently with job-scoped leases and no workspace mixing", async (t) => {
  const f = fixture(t);
  const secondStore = new EvidenceStore(f.db);
  const sibling = new Recorder({
    store: secondStore,
    ...f.config,
    maxConcurrent: 2,
    maxWorkspaceConcurrent: 1,
  });
  t.after(async () => {
    await sibling.close();
    secondStore.close();
  });
  for (const workspace of ["alpha", "beta"])
    f.worker.create(workspace, {
      id: "parallel",
      sessionId: "session",
      sourceId: "source",
      maxDurationSeconds: 15,
      segmentSeconds: 2,
    });
  // Separate service workers compete over one durable database. They must claim different jobs.
  f.worker.maxWorkspaceConcurrent = 1;
  const firstRow = f.store.db
    .prepare(
      "SELECT * FROM recording_jobs WHERE workspace='alpha' AND id='parallel'",
    )
    .get();
  assert.equal(f.worker.claim(firstRow), true);
  f.worker.launch(firstRow, f.worker.source("alpha", "source"));
  await sibling.tick();
  assert.equal(f.worker.activeJobs.size, 1);
  assert.equal(sibling.activeJobs.size, 1);
  f.store.db
    .prepare("UPDATE recording_job_leases SET expires_at=0 WHERE owner=?")
    .run(f.worker.owner);
  assert.equal(sibling.claim(firstRow), false); // A paused living owner cannot be mistaken for an interrupted child.
  // A sibling cannot recover or terminate either healthy recording.
  sibling.start();
  f.worker.start();
  await until(() =>
    ["alpha", "beta"].every(
      (w) => f.worker.job(w, "parallel").state === "recording",
    ),
  );
  const jobs = ["alpha", "beta"].map((w) => f.worker.job(w, "parallel"));
  assert.equal(jobs[0].attempts, 1);
  assert.equal(jobs[1].attempts, 1);
  assert.ok(
    Math.abs(
      jobs[0].segments[0].startedAtMs - jobs[1].segments[0].startedAtMs,
    ) < 1500,
  );
  assert.equal(
    secondStore.db
      .prepare("SELECT count(*) AS n FROM recording_job_leases")
      .get().n,
    2,
  );
  assert.equal(
    secondStore.db
      .prepare("SELECT count(DISTINCT owner) AS n FROM recording_job_leases")
      .get().n,
    2,
  );
  assert.equal(
    secondStore.search("alpha", { query: "worker interrupted" }).length,
    0,
  );
  f.worker.stop("alpha", "parallel");
  await until(() => f.worker.job("alpha", "parallel").state === "stopped");
  assert.equal(f.worker.job("beta", "parallel").state, "recording");
  const betaMedia = await f.worker.media(
    "beta",
    "parallel",
    jobs[1].segments[0].id,
  );
  assert.ok(betaMedia.path.includes("/beta/parallel/"));
  assert.ok(
    (
      await f.worker.media("alpha", "parallel", jobs[0].segments[0].id)
    ).path.includes("/alpha/parallel/"),
  );
  f.worker.stop("beta", "parallel");
  await until(() => f.worker.job("beta", "parallel").state === "stopped");
});

test("workspace reservations, pending count and duration reject work before FFmpeg spawn", async (t) => {
  const f = fixture(t);
  const bounded = new Recorder({
    store: f.store,
    ...f.config,
    maxWorkspacePending: 1,
    maxWorkspaceBytes: 4096,
    maxJobBytes: 2048,
    maxWorkspaceDurationSeconds: 4,
  });
  assert.throws(
    () =>
      bounded.create("alpha", {
        id: "overlong",
        sessionId: "session",
        sourceId: "source",
        maxDurationSeconds: 5,
        segmentSeconds: 2,
      }),
    /invalid_recording_bounds/,
  );
  const job = bounded.create("alpha", {
    id: "quota",
    sessionId: "session",
    sourceId: "source",
    maxDurationSeconds: 4,
    segmentSeconds: 2,
  });
  assert.equal(job.quotas.maxJobBytes, 2048);
  assert.throws(
    () =>
      bounded.create("alpha", {
        id: "another",
        sessionId: "session",
        sourceId: "source",
        maxDurationSeconds: 4,
        segmentSeconds: 2,
      }),
    /workspace_recording_capacity/,
  );
  const reserved = new Recorder({
    store: f.store,
    ...f.config,
    maxWorkspaceBytes: 2048,
    maxJobBytes: 2048,
  });
  assert.throws(
    () =>
      reserved.create("alpha", {
        id: "no-space",
        sessionId: "session",
        sourceId: "source",
        maxDurationSeconds: 4,
        segmentSeconds: 2,
      }),
    /workspace_storage_capacity/,
  );
  assert.equal(bounded.activeJobs.size, 0);
  assert.equal(reserved.activeJobs.size, 0);
  let admissions = 0;
  bounded.admission = () => {
    admissions++;
    throw new Fault("workspace_quota_exceeded", 429);
  };
  assert.equal(
    bounded.create("alpha", {
      id: "quota",
      sessionId: "session",
      sourceId: "source",
      maxDurationSeconds: 4,
      segmentSeconds: 2,
    }).id,
    "quota",
  );
  assert.equal(admissions, 0); // Retries of a retained job do not consume another entitlement.
  assert.throws(
    () =>
      bounded.create("beta", {
        id: "denied",
        sessionId: "session",
        sourceId: "source",
        maxDurationSeconds: 4,
        segmentSeconds: 2,
      }),
    /workspace_quota_exceeded/,
  );
  assert.equal(admissions, 1);
  await bounded.close();
  await reserved.close();
});

test("selected source missions launch two real recordings in one workspace and restore private source receipts", async (t) => {
  const dir = mkdtempSync(join(tmpdir(), "livelens-scheduled-recording-")),
    db = join(dir, "evidence.sqlite");
  const configurations = ["first", "second"].map((id, i) => {
    const input = join(dir, id + ".mp4");
    execFileSync(ffmpeg, [
      "-v",
      "error",
      "-f",
      "lavfi",
      "-i",
      `color=c=${i ? "blue" : "red"}:size=160x90:rate=10`,
      "-t",
      "12",
      "-c:v",
      "libx264",
      "-threads",
      "1",
      input,
    ]);
    return {
      id,
      workspace: "alpha",
      sessionId: id,
      kind: "file",
      input,
      label: "Generated " + id + " fixture",
    };
  });
  let store = new EvidenceStore(db),
    recorder = new Recorder({ store, mediaRoot: join(dir, "media"), ffmpeg }),
    scheduler = new Scheduler({
      store,
      recorder,
      adapters: createSourceAdapters(configurations),
    });
  t.after(async () => {
    await scheduler.close();
    await recorder.close();
    store.close();
    rmSync(dir, { recursive: true, force: true });
  });
  for (const source of configurations) {
    store.createSession("alpha", {
      id: source.sessionId,
      platform: "fixture",
      sourceUrl: "https://example.invalid/" + source.id,
      title: source.label,
      startedAtMs: Date.now(),
    });
    scheduler.create("alpha", {
      id: source.id,
      sourceId: source.id,
      autoRecord: true,
      endAtMs: Date.now() + 30_000,
      maxDurationSeconds: 12,
      segmentSeconds: 2,
      pollSeconds: 10,
    });
  }
  await scheduler.tick();
  recorder.start();
  scheduler.start();
  const first = scheduler.mission("alpha", "first"),
    second = scheduler.mission("alpha", "second");
  await until(() =>
    [first, second].every(
      (m) => recorder.job("alpha", m.jobId).state === "recording",
    ),
  );
  assert.equal(recorder.activeJobs.size, 2);
  assert.equal(recorder.job("alpha", first.jobId).sessionId, "first");
  assert.equal(recorder.job("alpha", second.jobId).sessionId, "second");
  const a = recorder.job("alpha", first.jobId).segments[0],
    b = recorder.job("alpha", second.jobId).segments[0];
  assert.notEqual(a.sha256, b.sha256); // Different source footage remains separate, rather than copied into both jobs.
  scheduler.stop("alpha", "first");
  await until(() => recorder.job("alpha", first.jobId).state === "stopped");
  assert.equal(recorder.job("alpha", second.jobId).state, "recording");
  scheduler.stop("alpha", "second");
  await until(() => recorder.job("alpha", second.jobId).state === "stopped");
  await scheduler.close();
  await recorder.close();
  store.close();
  store = new EvidenceStore(db);
  recorder = new Recorder({ store, mediaRoot: join(dir, "media"), ffmpeg });
  scheduler = new Scheduler({
    store,
    recorder,
    adapters: createSourceAdapters(configurations),
  });
  assert.equal(scheduler.mission("alpha", "first").jobId, first.jobId);
  assert.equal(recorder.sourcesFor("alpha").length, 2);
  assert.equal(
    (await recorder.media("alpha", first.jobId, a.id)).sha256,
    a.sha256,
  );
  await scheduler.tick();
  assert.equal(recorder.list("alpha").length, 2);
  assert.equal(
    store.search("alpha", { sessionId: "first", query: "service restart" })
      .length,
    0,
  );
});

test("storage entitlement refusal quarantines actual media and stops only its own capture", async (t) => {
  const f = fixture(t);
  f.worker.admission = (workspace, addition) => {
    if (workspace === "alpha" && addition.storageBytes)
      throw new Fault("workspace_quota_exceeded", 429);
  };
  for (const workspace of ["alpha", "beta"])
    f.worker.create(workspace, {
      id: "metered",
      sessionId: "session",
      sourceId: "source",
      maxDurationSeconds: 12,
      segmentSeconds: 2,
    });
  f.worker.start();
  await until(() => f.worker.job("alpha", "metered").state === "failed");
  const denied = f.worker.job("alpha", "metered");
  assert.equal(denied.error, "workspace_quota_exceeded");
  assert.equal(denied.segments.length, 0);
  assert.equal(f.store.search("alpha", { query: "quota limit" }).length, 1);
  assert.equal(f.worker.job("beta", "metered").state, "recording");
  f.worker.stop("beta", "metered");
  await until(() => f.worker.job("beta", "metered").state === "stopped");
});
