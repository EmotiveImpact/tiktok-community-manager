import test from "node:test";
import assert from "node:assert/strict";
import {
  mkdtempSync,
  rmSync,
  writeFileSync,
  copyFileSync,
  statSync,
  readFileSync,
  existsSync,
} from "node:fs";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { execFileSync, spawn } from "node:child_process";
import { once } from "node:events";
import { fileURLToPath } from "node:url";
import { EvidenceStore } from "../src/store.mjs";
import { Recorder, hashFile } from "../src/recorder.mjs";
import { SpeechWorker, validateSpeechResult } from "../src/speech.mjs";

const ffmpeg = process.env.LIVELENS_FFMPEG_PATH ?? "/usr/bin/ffmpeg";
const recognizer = { id: "test-engine", language: "en-US", diarization: false };
const result = {
  schemaVersion: 1,
  engine: {
    id: "test-engine",
    version: "fixture-contract-1",
    language: "en-US",
    diarization: false,
  },
  segments: [
    {
      startMs: 100,
      endMs: 900,
      text: "Known test-only adapter words",
      speakerId: null,
      confidence: 0.8,
    },
  ],
};
async function until(predicate, timeout = 12_000) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    const value = predicate();
    if (value) return value;
    await new Promise((resolve) => setTimeout(resolve, 30));
  }
  throw new Error("Speech readiness timeout");
}
async function fixture(
  t,
  script = `console.log(${JSON.stringify(JSON.stringify(result))});`,
) {
  const dir = mkdtempSync(join(tmpdir(), "livelens-speech-")),
    db = join(dir, "evidence.sqlite"),
    mediaRoot = join(dir, "media");
  const input = join(dir, "reference.wav"),
    engine = join(dir, "engine.mjs");
  execFileSync(ffmpeg, [
    "-v",
    "error",
    "-f",
    "lavfi",
    "-i",
    "sine=frequency=440:sample_rate=16000",
    "-t",
    "2",
    input,
  ]);
  writeFileSync(engine, script);
  let store = new EvidenceStore(db);
  for (const workspace of ["alpha", "beta"])
    store.createSession(workspace, {
      id: "session",
      platform: "fixture",
      sourceUrl: "https://example.invalid/speech",
      title: "Speech contract fixture",
      startedAtMs: Date.now(),
    });
  const config = {
    store,
    mediaRoot,
    ffmpeg,
    sources: [
      {
        id: "source",
        workspace: "alpha",
        sessionId: "session",
        kind: "file",
        input,
      },
    ],
  };
  let recorder = new Recorder(config);
  recorder.create("alpha", {
    id: "recording",
    sessionId: "session",
    sourceId: "source",
    maxDurationSeconds: 5,
    segmentSeconds: 2,
  });
  store.db
    .prepare(
      "UPDATE recording_jobs SET state='completed',attempts=1 WHERE workspace='alpha' AND id='recording'",
    )
    .run();
  const output = join(
    recorder.directory("alpha", "recording", 1),
    "segment.wav",
  );
  copyFileSync(input, output);
  const sha256 = await hashFile(output),
    startedAtMs = Date.now() - 5000;
  store.db
    .prepare("INSERT INTO media_segments VALUES(?,?,?,?,?,?,?,?,?)")
    .run(
      "alpha",
      "recording",
      "segment",
      1,
      startedAtMs,
      2000,
      statSync(output).size,
      sha256,
      "alpha/recording/attempt-1/segment.wav",
    );
  const speechConfig = {
    recognizer: { ...recognizer, command: process.execPath, args: [engine] },
    intervalMs: 30,
    leaseMs: 600,
  };
  let worker = new SpeechWorker({ store, recorder, ...speechConfig });
  const f = {
    dir,
    db,
    input,
    engine,
    sha256,
    startedAtMs,
    config,
    speechConfig,
    get store() {
      return store;
    },
    get recorder() {
      return recorder;
    },
    get worker() {
      return worker;
    },
    async restart() {
      await worker.close();
      await recorder.close();
      store.close();
      store = new EvidenceStore(db);
      recorder = new Recorder({ ...config, store });
      worker = new SpeechWorker({ store, recorder, ...speechConfig });
      worker.start();
    },
  };
  t.after(async () => {
    await worker.close();
    await recorder.close();
    store.close();
    rmSync(dir, { recursive: true, force: true });
  });
  return f;
}
const job = {
  id: "speech-job",
  sessionId: "session",
  recordingJobId: "recording",
  maxDurationSeconds: 30,
};

test("speech adapter schema refuses guessed timing, account/commands, bogus speaker and confidence", () => {
  assert.deepEqual(validateSpeechResult(result, 2000, recognizer), result);
  for (const segment of [
    { ...result.segments[0], endMs: 3000 },
    { ...result.segments[0], startMs: -1 },
    { ...result.segments[0], speakerId: "speaker1" },
    { ...result.segments[0], account: "someone" },
    { ...result.segments[0], confidence: 2 },
  ])
    assert.throws(() =>
      validateSpeechResult(
        { ...result, segments: [segment] },
        2000,
        recognizer,
      ),
    );
  assert.throws(
    () =>
      validateSpeechResult(
        { ...result, engine: { ...result.engine, id: "another" } },
        2000,
        recognizer,
      ),
    /speech_engine_mismatch/,
  );
});
test("speech snapshots verified media, uses actual subprocess and survives database reopen without inventing identities", async (t) => {
  const f = await fixture(t);
  assert.equal(f.worker.create("alpha", job).state, "queued");
  assert.equal(f.worker.create("alpha", job).segments[0].sha256, f.sha256);
  assert.throws(() => f.worker.job("beta", job.id), /speech_job_not_found/);
  assert.throws(() => f.worker.create("beta", job), /job_not_found/);
  assert.throws(
    () => f.worker.create("alpha", { ...job, command: "/bin/sh" }),
    /unknown_field/,
  );
  assert.throws(
    () => f.worker.create("alpha", { ...job, maxDurationSeconds: 10 }),
    /speech_job_identity_conflict/,
  );
  f.worker.start();
  await until(() => f.worker.job("alpha", job.id).state === "completed");
  const event = f.store.events("alpha", "session")[0];
  assert.equal(event.kind, "transcript");
  assert.equal(event.account, null);
  assert.equal(event.sourceTimestampMs, null);
  assert.equal(event.capturedAtMs, f.startedAtMs + 100);
  assert.equal(event.raw.mediaEndMs, 900);
  assert.equal(event.raw.mediaSha256, f.sha256);
  assert.equal(event.raw.diarization, false);
  assert.equal(event.raw.speakerTrack, "unseparated-audio-track");
  assert.equal(event.attribution.status, "unknown");
  await f.restart();
  assert.equal(f.worker.job("alpha", job.id).state, "completed");
  assert.equal(f.store.events("alpha", "session").length, 1);
  assert.equal(f.store.verify("alpha", "session").ok, true);
});
test("malformed real subprocess output retries three times and persists failure without transcript success", async (t) => {
  const f = await fixture(t, "console.log('{invalid-json}');");
  f.worker.create("alpha", job);
  f.worker.start();
  await until(() => f.worker.job("alpha", job.id).state === "failed");
  const receipt = f.worker.job("alpha", job.id);
  assert.equal(receipt.segments[0].attempts, 3);
  assert.equal(receipt.error, "invalid_speech_output");
  assert.equal(f.store.events("alpha", "session").length, 0);
  await f.restart();
  assert.equal(f.worker.job("alpha", job.id).state, "failed");
});
test("damaged verified input is refused before inference and queued stop prevents any execution", async (t) => {
  const f = await fixture(t);
  f.worker.create("alpha", job);
  f.worker.stop("alpha", job.id);
  f.worker.start();
  await new Promise((resolve) => setTimeout(resolve, 100));
  assert.equal(f.worker.job("alpha", job.id).state, "stopped");
  assert.equal(f.worker.job("alpha", job.id).segments[0].attempts, 0);
  const file = (await f.recorder.media("alpha", "recording", "segment")).path;
  writeFileSync(file, "damaged");
  f.worker.create("alpha", { ...job, id: "damaged-job" });
  await until(() => f.worker.job("alpha", "damaged-job").state === "failed");
  assert.equal(
    f.worker.job("alpha", "damaged-job").error,
    "media_integrity_failed",
  );
  assert.equal(f.store.events("alpha", "session").length, 0);
});
test("running stop is bounded; interrupted attempts restart and honour the original deadline", async (t) => {
  const f = await fixture(
    t,
    `setTimeout(()=>console.log(${JSON.stringify(JSON.stringify(result))}),1500);`,
  );
  f.worker.create("alpha", job);
  f.worker.start();
  await until(() => f.worker.job("alpha", job.id).state === "transcribing");
  await f.restart();
  await until(() => f.worker.job("alpha", job.id).state === "completed");
  assert.equal(f.worker.job("alpha", job.id).segments[0].attempts, 2);
  f.worker.create("alpha", { ...job, id: "stop-running" });
  await until(
    () => f.worker.job("alpha", "stop-running").state === "transcribing",
  );
  f.worker.stop("alpha", "stop-running");
  await until(() => f.worker.job("alpha", "stop-running").state === "stopped");
  assert.equal(f.store.events("alpha", "session").length, 1);
});
test("oversize output is killed and bounded by attempts rather than accepted as success", async (t) => {
  const f = await fixture(
    t,
    "process.stdout.write('x'.repeat(700000));setTimeout(()=>{},5000);",
  );
  f.worker.create("alpha", job);
  f.worker.start();
  await until(() => f.worker.job("alpha", job.id).state === "failed");
  assert.equal(f.worker.job("alpha", job.id).error, "speech_output_too_large");
  assert.equal(f.store.events("alpha", "session").length, 0);
});
test("elapsed job deadline terminates a running engine and remains failed after restart", async (t) => {
  const f = await fixture(t, "setInterval(()=>{},1000);");
  f.worker.create("alpha", { ...job, maxDurationSeconds: 5 });
  f.worker.start();
  await until(() => f.worker.job("alpha", job.id).state === "failed", 8000);
  const receipt = f.worker.job("alpha", job.id);
  assert.equal(receipt.error, "speech_deadline_exceeded");
  assert.equal(receipt.segments[0].attempts, 1);
  assert.equal(f.store.events("alpha", "session").length, 0);
  await f.restart();
  assert.equal(f.worker.job("alpha", job.id).state, "failed");
});
test("abrupt service death kills the engine and SQLite lease recovery resumes the durable job", async (t) => {
  const f = await fixture(t);
  const pidFile = join(f.dir, "engine.pid");
  writeFileSync(
    f.engine,
    `import {writeFileSync} from 'node:fs';writeFileSync(${JSON.stringify(pidFile)},String(process.pid));setTimeout(()=>console.log(${JSON.stringify(JSON.stringify(result))}),10000);`,
  );
  f.worker.create("alpha", job);
  const storeModule = new URL("../src/store.mjs", import.meta.url).href,
    recorderModule = new URL("../src/recorder.mjs", import.meta.url).href,
    speechModule = new URL("../src/speech.mjs", import.meta.url).href;
  const childScript = join(f.dir, "service.mjs");
  writeFileSync(
    childScript,
    `import {EvidenceStore} from ${JSON.stringify(storeModule)};import {Recorder} from ${JSON.stringify(recorderModule)};import {SpeechWorker} from ${JSON.stringify(speechModule)};const store=new EvidenceStore(${JSON.stringify(f.db)});const recorder=new Recorder({...${JSON.stringify({ ...f.config, store: undefined })},store});const worker=new SpeechWorker({store,recorder,...${JSON.stringify(f.speechConfig)}});worker.start();`,
  );
  const child = spawn(process.execPath, [childScript], { stdio: "ignore" });
  t.after(() => child.kill("SIGKILL"));
  await until(() => existsSync(pidFile));
  const enginePid = Number(readFileSync(pidFile, "utf8"));
  child.kill("SIGKILL");
  await once(child, "close");
  await until(() => {
    try {
      return /State:\s+Z/.test(
        readFileSync("/proc/" + enginePid + "/status", "utf8"),
      );
    } catch {
      return true;
    }
  });
  writeFileSync(
    f.engine,
    `console.log(${JSON.stringify(JSON.stringify(result))});`,
  );
  await f.restart();
  await until(() => f.worker.job("alpha", job.id).state === "completed");
  assert.equal(f.worker.job("alpha", job.id).segments[0].attempts, 2);
  assert.equal(f.store.events("alpha", "session").length, 1);
});

const referenceDir =
  process.env.LIVELENS_SPEECH_REFERENCE_DIR ??
  "/tmp/livelens-speech-references";
const speechPython =
  process.env.LIVELENS_SPEECH_PYTHON ?? "/workspace/.venv-speech/bin/python";
test(
  "actual PocketSphinx CPU recognition creates exact verified media-linked transcripts",
  {
    skip:
      !existsSync(speechPython) ||
      !existsSync(join(referenceDir, "goforward.wav"))
        ? "Run speech/prepare_reference.py and install the pinned optional speech environment first"
        : false,
  },
  async (t) => {
    const f = await fixture(t),
      input = join(referenceDir, "goforward.wav");
    await f.worker.close();
    const media = await f.recorder.media("alpha", "recording", "segment");
    copyFileSync(input, media.path);
    const sha256 = await hashFile(media.path);
    f.store.db
      .prepare(
        "UPDATE media_segments SET sha256=?,bytes=?,duration_ms=2786 WHERE workspace=? AND job_id=?",
      )
      .run(sha256, statSync(media.path).size, "alpha", "recording");
    const worker = new SpeechWorker({
      store: f.store,
      recorder: f.recorder,
      intervalMs: 30,
      recognizer: {
        command: speechPython,
        args: [
          fileURLToPath(
            new URL("../speech/pocketsphinx_adapter.py", import.meta.url),
          ),
          "--ffmpeg",
          ffmpeg,
        ],
        id: "pocketsphinx",
        language: "en-US",
        diarization: false,
      },
    });
    t.after(() => worker.close());
    worker.create("alpha", { ...job, id: "actual-recognition" });
    worker.start();
    await until(
      () => worker.job("alpha", "actual-recognition").state === "completed",
    );
    const events = f.store.events("alpha", "session");
    assert.equal(events[0].text, "go forward ten meters");
    assert.equal(events[0].raw.engine.id, "pocketsphinx");
    assert.equal(events[0].raw.mediaSha256, sha256);
    assert.equal(events[0].sourceTimestampMs, null);
    assert.equal(events[0].raw.mediaStartMs, 460);
    assert.equal(events[0].raw.mediaEndMs, 2120);
    await worker.close();
  },
);
