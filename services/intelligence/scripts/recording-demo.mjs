import { execFileSync, spawn } from "node:child_process";
import { mkdtempSync, rmSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { randomBytes } from "node:crypto";
import { createServer } from "node:net";
import { once } from "node:events";
import assert from "node:assert/strict";
import { EvidenceStore } from "../src/store.mjs";
import { SCOPES } from "../src/server.mjs";

const root = resolve(import.meta.dirname, "../../..");
const locked = join(root, "node_modules/ffmpeg-static/ffmpeg");
const ffmpeg =
  process.env.LIVELENS_FFMPEG_PATH ??
  (existsSync(locked) ? locked : "/usr/bin/ffmpeg");
const dir = mkdtempSync(join(tmpdir(), "livelens-recording-demo-"));
const input = join(dir, "synthetic-bars-tone.mp4"),
  db = join(dir, "evidence.sqlite");
const token = randomBytes(32).toString("base64url");
const reservation = createServer();
reservation.listen(0, "127.0.0.1");
await once(reservation, "listening");
const port = reservation.address().port;
await new Promise((r) => reservation.close(r));
const base = `http://127.0.0.1:${port}`;
let child;
async function waitFor(operation, timeout = 30_000) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    try {
      const value = await operation();
      if (value) return value;
    } catch {}
    await new Promise((r) => setTimeout(r, 150));
  }
  throw new Error("fixture_readiness_timeout");
}
async function call(path, body) {
  const r = await fetch(base + path, {
    method: body === undefined ? "GET" : "POST",
    headers: {
      Authorization: "Bearer " + token,
      ...(body === undefined ? {} : { "Content-Type": "application/json" }),
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    signal: AbortSignal.timeout(3000),
  });
  assert.ok(r.ok, `fixture HTTP ${r.status}`);
  return r.json();
}
async function start() {
  child = spawn(
    process.execPath,
    [join(root, "services/intelligence/src/server.mjs")],
    {
      env: {
        ...process.env,
        LIVELENS_API_KEYS: JSON.stringify([
          {
            token,
            workspace: "fixture_workspace",
            subject: "fixture-operator",
            scopes: SCOPES,
          },
        ]),
        LIVELENS_DB_PATH: db,
        LIVELENS_PORT: String(port),
        LIVELENS_RECORDER_SOURCES: JSON.stringify([
          {
            id: "fixture",
            workspace: "fixture_workspace",
            sessionId: "fixture-session",
            kind: "file",
            input,
          },
        ]),
        LIVELENS_MEDIA_ROOT: join(dir, "media"),
        LIVELENS_FFMPEG_PATH: ffmpeg,
      },
      stdio: ["ignore", "ignore", "ignore"],
    },
  );
  await waitFor(async () => {
    const r = await fetch(base + "/health", {
      signal: AbortSignal.timeout(1000),
    });
    return r.ok;
  });
}
async function stop(signal = "SIGTERM") {
  if (!child || child.exitCode !== null || child.signalCode !== null) return;
  const exited = once(child, "exit");
  child.kill(signal);
  await exited;
  child = null;
}
try {
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
    "24",
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
  const store = new EvidenceStore(db);
  store.createSession("fixture_workspace", {
    id: "fixture-session",
    platform: "fixture",
    account: "fictional_host",
    sourceUrl: "https://example.invalid/synthetic-recording",
    title: "Synthetic media and chat fixture",
    startedAtMs: Date.now(),
  });
  const evidence = store.append("fixture_workspace", "fixture-session", [
    {
      source: { adapter: "fixture", eventId: "chat" },
      kind: "chat",
      account: "fictional_viewer",
      text: "Please preserve this synthetic fixture clip.",
      capturedAtMs: Date.now(),
    },
  ])[0].evidence;
  store.close();
  await start();
  await call("/v1/jobs", {
    id: "fixture-job",
    sessionId: "fixture-session",
    sourceId: "fixture",
    maxDurationSeconds: 60,
    segmentSeconds: 2,
  });
  const first = await waitFor(async () => {
    const job = await call("/v1/jobs/fixture-job");
    return job.segments.length ? job.segments[0] : false;
  });
  await stop("SIGKILL"); // Actual service death; the Python guard kills its FFmpeg child.
  await start();
  await waitFor(async () => {
    const job = await call("/v1/jobs/fixture-job");
    return job.attempts === 2 && job.segments.some((s) => s.attempt === 2);
  });
  await call("/v1/jobs/fixture-job/stop", {});
  await waitFor(
    async () => (await call("/v1/jobs/fixture-job")).state === "stopped",
  );
  const gaps = await call("/v1/evidence/search?q=worker%20interrupted");
  assert.ok(gaps.evidence.some((e) => e.kind === "gap"));
  await call("/v1/cases", {
    id: "fixture-case",
    title: "Synthetic restart report",
    question: "Can the original fixture be reopened?",
  });
  await call("/v1/cases/fixture-case/evidence", { evidenceIds: [evidence.id] });
  await stop();
  await start();
  const report = await call("/v1/cases/fixture-case/report");
  assert.equal(report.evidence[0].id, evidence.id);
  assert.equal(report.media[0].segments[0].sha256, first.sha256);
  const replay = await fetch(base + `/v1/media/fixture-job/${first.id}`, {
    headers: { Authorization: "Bearer " + token, Range: "bytes=0-99" },
  });
  assert.equal(replay.status, 206);
  assert.equal((await replay.arrayBuffer()).byteLength, 100);
  console.log(
    JSON.stringify({
      fixture: true,
      source: "synthetic colour bars, tone and chat; no LIVE connection",
      abruptServiceInterruption: true,
      restartRecovery: true,
      captureGaps: true,
      verifiedSegments: report.media[0].segments.length,
      authenticatedRangeReplay: true,
      retainedCaseReport: true,
      reportSha256: report.reportSha256,
    }),
  );
} finally {
  await stop();
  rmSync(dir, { recursive: true, force: true });
}
