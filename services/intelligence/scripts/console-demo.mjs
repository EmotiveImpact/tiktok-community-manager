import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { randomBytes } from "node:crypto";
import { EvidenceStore } from "../src/store.mjs";
import { createIntelligenceServer, SCOPES } from "../src/server.mjs";
import { Recorder } from "../src/recorder.mjs";
import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { InvestigationEngine } from "../src/investigations.mjs";
import { Governance } from "../src/governance.mjs";
import { Scheduler } from "../src/scheduler.mjs";
import { createSourceAdapters } from "../src/source-adapters.mjs";
import { SpeechWorker } from "../src/speech.mjs";
import { SourceCatalog } from "../src/source-catalog.mjs";
import { MediaArchive } from "../src/media-archive.mjs";
import { FilesystemObjectStorage, EncryptedObjectStorage } from "../../../deployment/livelens/object-storage.mjs";

// Explicit synthetic development mode, bound to loopback with a public fixture login.
const dir = resolve(
  process.env.LIVELENS_DEMO_DIR ??
    "./services/intelligence/data/console-fixture",
);
mkdirSync(dir, { recursive: true, mode: 0o700 });
const store = new EvidenceStore(resolve(dir, "evidence.sqlite"));
let session;
try {
  session = store.session("fixture_workspace", "fixture-conversation");
} catch {
  session = store.createSession("fixture_workspace", {
    id: "fixture-conversation",
    platform: "fixture",
    account: "fictional_host",
    sourceUrl: "https://example.invalid/fixture",
    title: "Fictional fixture · a conversation about context",
    startedAtMs: Date.now(),
  });
}
store.append("fixture_workspace", session.id, [
  {
    source: { adapter: "fixture", eventId: "chat-1" },
    kind: "chat",
    text: "Could we see the original context?",
    account: "fictional_viewer",
    sourceTimestampMs: session.startedAtMs + 2000,
    capturedAtMs: session.startedAtMs + 2100,
  },
  {
    source: { adapter: "fixture", eventId: "caption-1" },
    kind: "caption",
    text: "Keep the original conversation with the evidence.",
    sourceTimestampMs: session.startedAtMs + 4000,
    capturedAtMs: session.startedAtMs + 4200,
  },
  {
    source: { adapter: "fixture", eventId: "gap-1" },
    kind: "gap",
    text: "Synthetic example of a capture gap; no speech was inferred.",
    capturedAtMs: session.startedAtMs + 7000,
  },
  {
    source: { adapter: "fixture", eventId: "context-target" }, kind: "chat",
    text: "Please preserve the original context mentioning @fictional_target.",
    account: "fictional_viewer", capturedAtMs: session.startedAtMs + 6000,
  },
  {
    source: { adapter: "fixture", eventId: "clarification" }, kind: "chat",
    text: "Clarification: this is a fictional demonstration, not a threat.",
    account: "fictional_guest", capturedAtMs: session.startedAtMs + 6500,
  },
]);
let reference;
try { reference = store.session("fixture_workspace", "fixture-reference"); }
catch {
  reference = store.createSession("fixture_workspace", { id: "fixture-reference", platform: "fixture", account: "fictional_guest", sourceUrl: "https://example.invalid/reference", title: "Reference fixture · a different statement", startedAtMs: session.startedAtMs - 3600_000 });
}
store.append("fixture_workspace", reference.id, [{ source: { adapter: "fixture", eventId: "reference-comment" }, kind: "chat", text: "A different session can contain context without proving a relationship.", account: "fictional_viewer", capturedAtMs: reference.startedAtMs + 3000 }]);
const port = Number(process.env.LIVELENS_PORT ?? 4318);
const ffmpeg = resolve(
  process.env.LIVELENS_FFMPEG_PATH ?? "node_modules/ffmpeg-static/ffmpeg",
);
const media = resolve(dir, "fixture-input.mp4");
if (!existsSync(media))
  execFileSync(
    ffmpeg,
    [
      "-v",
      "error",
      "-f",
      "lavfi",
      "-i",
      "testsrc2=size=320x180:rate=15",
      "-f",
      "lavfi",
      "-i",
      "sine=frequency=440:sample_rate=44100",
      "-t",
      "16",
      "-c:v",
      "libx264",
      "-threads",
      "1",
      "-c:a",
      "aac",
      "-pix_fmt",
      "yuv420p",
      media,
    ],
    { stdio: "ignore" },
  );
const recorder = new Recorder({
  store,
  mediaRoot: resolve(dir, "media"),
  ffmpeg,
  sources: [
    {
      id: "fixture-media",
      workspace: "fixture_workspace",
      sessionId: session.id,
      kind: "file",
      input: media,
      label: "Synthetic colour bars & tone (fixture)",
    },
  ],
});
const investigation = new InvestigationEngine({ store });
const governance = new Governance({ store, recorder, members: [
  { workspace: "fixture_workspace", subject: "fixture", role: "owner" },
  { workspace: "fixture_workspace", subject: "fixture-collector", role: "owner" },
] });
const scheduler = new Scheduler({ store, recorder, adapters: createSourceAdapters([{ id: "fixture-media", workspace: "fixture_workspace", sessionId: session.id, kind: "file", input: media, label: "Synthetic colour bars & tone (fixture)" }]) });
recorder.admission = (workspace, additions) => governance.checkQuota(workspace, additions);
const sourceCatalog = new SourceCatalog({ store, scheduler, governance });
const archiveKeyPath = resolve(dir, 'fixture-object-key');
if (!existsSync(archiveKeyPath)) writeFileSync(archiveKeyPath, randomBytes(32), { mode: 0o600, flag: 'wx' });
const mediaArchive = new MediaArchive({ store, recorder, storage: new EncryptedObjectStorage(new FilesystemObjectStorage(resolve(dir, 'objects')), readFileSync(archiveKeyPath)) });
mediaArchive.encrypted = true;
mediaArchive.admission = (workspace, additions) => governance.checkQuota(workspace, additions);
const speechPython = process.env.LIVELENS_SPEECH_PYTHON ?? "/workspace/.venv-speech/bin/python";
const speech = process.env.LIVELENS_DEMO_SPEECH !== "0" && existsSync(speechPython) ? new SpeechWorker({ store, recorder, recognizer: { command: speechPython, args: [resolve("services/intelligence/speech/pocketsphinx_adapter.py"), "--ffmpeg", ffmpeg], id: "pocketsphinx", language: "en-US", diarization: false } }) : undefined;
let pdf = process.env.LIVELENS_PDF_RENDERER ? JSON.parse(process.env.LIVELENS_PDF_RENDERER) : undefined;
try { if (!pdf && existsSync("/usr/bin/chromium") && process.env.LIVELENS_DEMO_PDF !== "0") { execFileSync("python3", ["-c", "import playwright"], { stdio: "ignore" }); pdf = { python: execFileSync("python3", ["-c", "import sys; print(sys.executable)"], { encoding: "utf8" }).trim(), chromium: "/usr/bin/chromium" }; } } catch {}
try { store.case("fixture_workspace", "fixture-review"); }
catch {
  store.createCase("fixture_workspace", { id: "fixture-review", title: "Fictional context review", question: "What does the captured conversation support, and what remains uncertain?" }, "fixture");
  const evidence = store.events("fixture_workspace", session.id);
  store.linkEvidence("fixture_workspace", "fixture-review", evidence.map(e => e.id), "fixture");
  investigation.addNote("fixture_workspace", "fixture-review", { text: "Synthetic demonstration: review the clarification alongside the initial request. The recording is test footage.", evidenceIds: [evidence[0].id, evidence.at(-1).id] }, "fixture");
  investigation.createFinding("fixture_workspace", "fixture-review", { title: "Context was requested", statement: "The fictional viewer asks to retain context. A later clarification states that this is a demonstration.", supportEvidenceIds: [evidence[0].id], counterEvidenceIds: [evidence.at(-1).id], topic: "context" }, "fixture");
}
const server = createIntelligenceServer({
  store,
  recorder,
  investigation, governance, scheduler, speech, pdf, sourceCatalog, mediaArchive,
  keys: [
    {
      token: randomBytes(32).toString("base64url"),
      workspace: "fixture_workspace",
      subject: "fixture-collector",
      scopes: SCOPES,
    },
  ],
  browser: {
    origin: `http://127.0.0.1:${port}`,
    bundleDir: resolve("dist"),
    users: [
      {
        username: "fixture",
        password: "fixture-operator-only",
        workspace: "fixture_workspace",
        scopes: SCOPES,
      },
    ],
  },
});
recorder.start();
scheduler.start();
speech?.start();
mediaArchive.start();
// Explicit synthetic markers align evidence seek to real written media.
// This timer exists only in this fixture launcher, never in the service.
const markers = setInterval(() => {
  for (const job of recorder.list("fixture_workspace"))
    for (const segment of job.segments)
      store.append("fixture_workspace", session.id, [
        {
          source: {
            adapter: "fixture-marker",
            eventId: `${job.id}-${segment.id}`,
          },
          kind: "chat",
          account: "fictional_viewer",
          text: "Synthetic fixture marker inside the recorded colour bars and tone.",
          capturedAtMs:
            segment.startedAtMs + Math.min(500, segment.durationMs - 1),
          raw: { fixture: true, jobId: job.id, segmentId: segment.id },
        },
      ]);
}, 500);
server.listen(port, "127.0.0.1", () =>
  console.log(
    "Synthetic console fixture ready; see the service README for the loopback-only fixture login.",
  ),
);
const stop = () => {
  clearInterval(markers);
  server.close(async () => {
    await scheduler.close();
    await speech?.close();
    await mediaArchive.close();
    await recorder.close();
    store.close();
    process.exit(0);
  });
};
server.once("error", async () => {
  clearInterval(markers);
  await scheduler.close();
  await speech?.close();
  await mediaArchive.close();
  await recorder.close();
  store.close();
  process.exitCode = 1;
});
process.once("SIGINT", stop);
process.once("SIGTERM", stop);
