import "./helpers";
import { describe, it, expect } from "vitest";
import { archivePayload, uploadArchive } from "../electron/livelens-archive";
import type { SessionRecord } from "../electron/sessions";
import * as sessions from "../electron/sessions";
import { wipeDataDir } from "./helpers";
const record = {
  id: "broadcast-one",
  broadcastId: "provider-one",
  hostUniqueId: "fixture_host",
  roomTitle: "Fixture broadcast",
  startedAt: 1000,
  events: [
    {
      type: "chat",
      ts: 1234,
      comment: "Retained words",
      user: { uniqueId: "viewer", nickname: "Viewer" },
    },
    {
      type: "caption",
      ts: 2345,
      text: "Unknown speaker",
      definite: true,
      sourceTimestampMs: 2200,
    },
  ],
} as SessionRecord;
describe("desktop archive contract", () => {
  it("does not combine two broadcasts from one account and retains final captions", () => {
    wipeDataDir();
    const one = sessions.start("fixture_host", "Fixture", "First", "room-one");
    sessions.append({
      type: "caption",
      ts: 100,
      sourceTimestampMs: 90,
      text: "Final caption",
      definite: true,
    });
    sessions.end();
    const two = sessions.start("fixture_host", "Fixture", "Second", "room-two");
    sessions.end();
    expect(one).not.toBe(two);
    expect(sessions.get(one)?.events[0].sourceTimestampMs).toBe(90);
    expect(sessions.get(two)?.events).toEqual([]);
    expect(sessions.start("fixture_host", "Fixture", "First", "room-one")).toBe(
      one,
    );
    sessions.end();
    wipeDataDir();
  });
  it("uploads and retries against the actual workspace-bound HTTP evidence API", async () => {
    const { EvidenceStore } = await import(
      "../services/intelligence/src/store.mjs"
    );
    const { createIntelligenceServer, SCOPES } = await import(
      "../services/intelligence/src/server.mjs"
    );
    const { once } = await import("node:events");
    const store = new EvidenceStore();
    const token = "x".repeat(40);
    const server = createIntelligenceServer({
      store,
      keys: [
        {
          token,
          workspace: "archive_test",
          subject: "desktop",
          scopes: SCOPES,
        },
      ],
    });
    server.listen(0, "127.0.0.1");
    await once(server, "listening");
    const base = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
    const request = async (method: string, route: string, body?: unknown) => {
      const response = await fetch(base + route, {
        method,
        headers: {
          Authorization: `Bearer ${token}`,
          ...(body === undefined ? {} : { "Content-Type": "application/json" }),
        },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      });
      if (!response.ok) throw new Error(`http_${response.status}`);
      return response.json();
    };
    try {
      const first = await uploadArchive(record, request);
      await uploadArchive(record, request);
      expect(store.events("archive_test", first.sessionId)).toHaveLength(2);
      expect(
        store.events("archive_test", first.sessionId)[1].attribution.status,
      ).toBe("unknown");
      expect(store.verify("archive_test", first.sessionId).ok).toBe(true);
      await expect(
        uploadArchive(
          {
            ...record,
            events: [{ ...record.events[0], comment: "Changed original" }],
          },
          request,
        ),
      ).rejects.toThrow("http_409");
      expect(store.events("archive_test", first.sessionId)).toHaveLength(2);
    } finally {
      server.closeAllConnections();
      await new Promise<void>((resolve) => server.close(() => resolve()));
      store.close();
    }
  });
  it("keeps missing source clocks unknown, captions anonymous and broadcast IDs separate", () => {
    const one = archivePayload(record),
      two = archivePayload({ ...record, id: "broadcast-two" });
    expect(one.session.id).not.toBe(two.session.id);
    expect(one.events[0].sourceTimestampMs).toBeNull();
    expect(one.events[0].capturedAtMs).toBe(1234);
    expect(one.events[1].sourceTimestampMs).toBe(2200);
    expect(one.events[1]).not.toHaveProperty("account");
    expect(archivePayload(record)).toEqual(one);
  });
  it("accepts an identical session retry and sends deterministic batches", async () => {
    const payload = archivePayload(record),
      batches: unknown[] = [];
    await uploadArchive(record, async (method, route, body) => {
      if (route === "/v1/sessions") throw new Error("http_409");
      if (method === "GET") return payload.session;
      batches.push(body);
    });
    expect(batches).toEqual([{ events: payload.events }]);
  });
  it("refuses session identity conflicts and preserves event conflict failures", async () => {
    await expect(
      uploadArchive(record, async (method) => {
        if (method === "POST") throw new Error("http_409");
        return { ...archivePayload(record).session, title: "Changed" };
      }),
    ).rejects.toThrow("session_identity_conflict");
    await expect(
      uploadArchive(record, async (_m, route) => {
        if (route.endsWith("/events")) throw new Error("http_409");
      }),
    ).rejects.toThrow("http_409");
  });
});
