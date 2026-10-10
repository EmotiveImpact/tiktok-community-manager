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
