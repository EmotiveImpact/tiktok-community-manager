import test from "node:test";
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  createSourceAdapters,
  DirectMediaAdapter,
  TikTokPublicAdapter,
} from "../src/source-adapters.mjs";

test("trusted direct media adapter redacts signed inputs and marks files as fixtures", async (t) => {
  const dir = mkdtempSync(join(tmpdir(), "livelens-adapter-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const input = join(dir, "generated.mp4");
  writeFileSync(input, "fixture metadata only, not media validation");
  const [adapter] = createSourceAdapters([
    {
      id: "fixture",
      workspace: "alpha",
      kind: "file",
      input,
      sessionId: "session",
    },
  ]);
  assert.equal(adapter.descriptor().fixture, true);
  assert.equal(adapter.descriptor().platform, "fixture");
  assert.equal((await adapter.poll()).recorderSource.input, input);
  const remote = new DirectMediaAdapter(
    {
      id: "remote",
      workspace: "alpha",
      kind: "https",
      input: "https://media.example.invalid/allowed.mp4?signature=private",
      platform: "permitted-source",
    },
    {
      fetchImpl: async () => ({
        ok: true,
        url: "https://media.example.invalid/allowed.mp4",
      }),
    },
  );
  assert.equal(
    JSON.stringify(remote.descriptor()).includes("signature"),
    false,
  );
  assert.equal(
    (await remote.poll()).sourceUrl,
    "https://media.example.invalid/allowed.mp4",
  );
  assert.equal(remote.descriptor().providerValidated, false);
  assert.throws(
    () =>
      createSourceAdapters([
        {
          id: "source",
          workspace: "alpha",
          kind: "https",
          input: "http://untrusted.invalid/media",
        },
      ]),
    /https_media_required/,
  );
  assert.throws(
    () =>
      createSourceAdapters([
        {
          id: "x",
          workspace: "alpha",
          kind: "https",
          input: "https://example.invalid",
        },
        {
          id: "x",
          workspace: "alpha",
          kind: "https",
          input: "https://example.invalid",
        },
      ]),
    /duplicate_source_adapter/,
  );
});

test("selected public TikTok adapter isolates credentials, known broadcasts and original event clocks", async () => {
  let lastOptions, client;
  class FixtureConnection extends EventEmitter {
    webClient = {};
    async fetchIsLive() {
      return true;
    }
    async fetchRoomId() {
      return "12345";
    }
    async fetchRoomInfo() {
      return {
        data: {
          owner: { display_id: "fictional" },
          title: "Fixture provider response",
          create_time: 100,
          stream_url: {
            hls_pull_url: "https://example.invalid/room.m3u8?private=secret",
          },
        },
      };
    }
    async connect(roomId) {
      assert.equal(roomId, "12345");
      return { roomId };
    }
    async disconnect() {}
  }
  const adapter = new TikTokPublicAdapter(
    {
      id: "selected",
      workspace: "alpha",
      kind: "tiktok-public",
      account: "fictional",
      signApiKeyEnv: "FIXTURE_SECRET",
    },
    {
      env: { FIXTURE_SECRET: "test-secret-only" },
      connectionFactory: (_account, options) => {
        lastOptions = options;
        client = new FixtureConnection();
        return client;
      },
    },
  );
  assert.equal(
    JSON.stringify(adapter.descriptor()).includes("test-secret"),
    false,
  );
  const status = await adapter.poll();
  assert.equal(status.broadcastId, "12345");
  assert.equal(status.sourceTimestampMs, 100_000);
  assert.equal(status.status, "live");
  assert.equal(lastOptions.signApiKey, "test-secret-only");
  assert.equal(lastOptions.disableEulerFallbacks, true);
  const events = [],
    gaps = [];
  const feed = await adapter.subscribe({
    broadcastId: "12345",
    onEvent: (e) => events.push(e),
    onGap: (reason) => gaps.push(reason),
    signal: new AbortController().signal,
  });
  client.emit("chat", {
    comment: "Fixture chat",
    user: { uniqueId: "fictional_viewer" },
    common: { msgId: "source-1", createTime: 200 },
  });
  client.emit("caption", { text: "Fixture speech with unknown account" });
  assert.equal(events[0].source.eventId, "source-1");
  assert.equal(events[0].sourceTimestampMs, 200_000);
  assert.equal(events[0].raw.broadcastId, "12345");
  assert.equal(events[1].sourceTimestampMs, null);
  assert.equal(events[1].account, undefined);
  client.emit("disconnected");
  assert.deepEqual(gaps, ["event_transport_interrupted"]);
  await feed.close();
  client.emit("chat", { comment: "closed feed" });
  assert.equal(events.length, 2);
});

test("provider refusal and offline status never become capture success", async () => {
  class Unavailable extends EventEmitter {
    async fetchIsLive() {
      throw new Error("private signed URL must not escape");
    }
    async disconnect() {}
  }
  const unavailable = new TikTokPublicAdapter(
    {
      id: "private",
      workspace: "alpha",
      kind: "tiktok-public",
      account: "fictional",
    },
    { connectionFactory: () => new Unavailable() },
  );
  assert.deepEqual(await unavailable.poll(), {
    status: "unavailable",
    reason: "provider_unavailable",
  });
  class Offline extends Unavailable {
    async fetchIsLive() {
      return false;
    }
  }
  const offline = new TikTokPublicAdapter(
    {
      id: "offline",
      workspace: "alpha",
      kind: "tiktok-public",
      account: "fictional",
    },
    { connectionFactory: () => new Offline() },
  );
  assert.deepEqual(await offline.poll(), { status: "offline" });
});
