import { mkdirSync } from "node:fs";
import { resolve } from "node:path";
import { randomBytes } from "node:crypto";
import { EvidenceStore } from "../src/store.mjs";
import { createIntelligenceServer, SCOPES } from "../src/server.mjs";
import { Recorder } from "../src/recorder.mjs";
import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";

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
]);
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
const server = createIntelligenceServer({
  store,
  recorder,
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
        scopes: [
          "sessions:read",
          "evidence:read",
          "cases:read",
          "cases:write",
          "recordings:read",
          "recordings:write",
        ],
      },
    ],
  },
});
recorder.start();
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
    await recorder.close();
    store.close();
    process.exit(0);
  });
};
server.once("error", async () => {
  clearInterval(markers);
  await recorder.close();
  store.close();
  process.exitCode = 1;
});
process.once("SIGINT", stop);
process.once("SIGTERM", stop);
