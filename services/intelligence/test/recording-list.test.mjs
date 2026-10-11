import test from "node:test";
import assert from "node:assert/strict";
import { once } from "node:events";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { EvidenceStore } from "../src/store.mjs";
import { Recorder } from "../src/recorder.mjs";
import { createIntelligenceServer } from "../src/server.mjs";

async function fixture(t) {
  const root = mkdtempSync(join(tmpdir(), "livelens-recording-list-"));
  const store = new EvidenceStore();
  const recorder = new Recorder({
    store,
    mediaRoot: root,
    ffmpeg: "/usr/bin/ffmpeg",
  });
  const tokens = {
    alpha: "a".repeat(43),
    beta: "b".repeat(43),
    denied: "d".repeat(43),
  };
  for (const workspace of ["alpha", "beta"])
    store.createSession(workspace, {
      id: "session",
      platform: "fixture",
      title: "Receipt projection fixture",
      sourceUrl: "https://example.invalid/receipts",
      startedAtMs: 0,
    });
  store.createSession("alpha", {
    id: "another-session",
    platform: "fixture",
    title: "Separate retained session",
    sourceUrl: "https://example.invalid/another-session",
    startedAtMs: 0,
  });
  const insert = store.db.prepare(
    "INSERT INTO recording_jobs(workspace,id,session_id,source_id,state,created_at,deadline,segment_seconds,max_seconds) VALUES(?,?,?,'source',?,?,?,2,10)",
  );
  for (let i = 0; i < 115; i++)
    insert.run(
      "alpha",
      `historical-${i}`,
      "session",
      ["completed", "stopped", "failed"][i % 3],
      1000 + i,
      11_000 + i,
    );
  const activeIds = ["queued", "starting", "recording", "stopping", "retrying"]
    .map((state, i) => {
      const id = `older-${state}`;
      insert.run("alpha", id, "session", state, 100 + i, 10_100 + i);
      return id;
    })
    .reverse();
  insert.run(
    "alpha",
    "older-other-session",
    "another-session",
    "queued",
    99,
    10_099,
  );
  insert.run("beta", "foreign-active", "session", "queued", 5000, 15_000);
  insert.run("beta", "foreign-completed", "session", "completed", 5001, 15_001);
  const server = createIntelligenceServer({
    store,
    recorder,
    keys: [
      {
        token: tokens.alpha,
        workspace: "alpha",
        subject: "alpha-reader",
        scopes: ["recordings:read"],
      },
      {
        token: tokens.beta,
        workspace: "beta",
        subject: "beta-reader",
        scopes: ["recordings:read"],
      },
      {
        token: tokens.denied,
        workspace: "alpha",
        subject: "evidence-only",
        scopes: ["evidence:read"],
      },
    ],
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  t.after(async () => {
    server.closeAllConnections();
    await new Promise((resolve) => server.close(resolve));
    await recorder.close();
    store.close();
    rmSync(root, { recursive: true, force: true });
  });
  const call = (query = "", token = tokens.alpha) =>
    fetch(`http://127.0.0.1:${server.address().port}/v1/jobs${query}`, {
      headers: token ? { Authorization: `Bearer ${token}` } : {},
    });
  return { recorder, activeIds, tokens, call };
}

test("active receipts retain older capture controls beyond a page of newer terminal jobs", async (t) => {
  const { recorder, activeIds, tokens, call } = await fixture(t);
  const recentResponse = await call();
  assert.equal(recentResponse.status, 200);
  const recent = (await recentResponse.json()).jobs;
  assert.equal(recent.length, 100);
  assert.ok(
    recent.every((job) =>
      ["completed", "stopped", "failed"].includes(job.state),
    ),
  );
  assert.ok(recent.every((job) => !job.id.startsWith("older-")));
  const explicitFalse = await call("?active=false");
  assert.deepEqual((await explicitFalse.json()).jobs, recent);
  const activeResponse = await call("?active=true&limit=200");
  assert.equal(activeResponse.status, 200);
  const active = (await activeResponse.json()).jobs;
  assert.deepEqual(
    active.map((job) => job.id),
    [...activeIds, "older-other-session"],
  );
  assert.ok(active.some((job) => job.state === "recovering"));
  assert.ok(
    active.every(
      (job) => !["completed", "stopped", "failed"].includes(job.state),
    ),
  );
  assert.deepEqual(
    recorder
      .list("alpha", { active: true, sessionId: "session" })
      .map((job) => job.id),
    activeIds,
  );
  const limited = await call("?active=true&limit=2");
  assert.deepEqual(
    (await limited.json()).jobs.map((job) => job.id),
    activeIds.slice(0, 2),
  );
  const foreign = await call("?active=true&limit=200", tokens.beta);
  assert.deepEqual(
    (await foreign.json()).jobs.map((job) => job.id),
    ["foreign-active"],
  );
  // Supplying a workspace in a query cannot alter the authenticated projection.
  const workspaceAttempt = await call("?active=true&workspace=beta");
  assert.deepEqual(
    (await workspaceAttempt.json()).jobs.map((job) => job.id),
    [...activeIds, "older-other-session"],
  );
  assert.equal(recorder.activeJobs.size, 0); // Only durable receipt metadata was seeded; no FFmpeg was spawned.
});

test("active job projection rejects ambiguous booleans, invalid bounds and missing read grants", async (t) => {
  const { recorder, tokens, call } = await fixture(t);
  for (const value of [
    "1",
    "0",
    "TRUE",
    "yes",
    "",
    "null",
    "false&active=true",
    "true&active=true",
  ]) {
    const response = await call(`?active=${value}`);
    assert.equal(response.status, 400);
    assert.equal((await response.json()).error, "invalid_active_filter");
  }
  for (const limit of [0, 201]) {
    const response = await call(`?active=true&limit=${limit}`);
    assert.equal(response.status, 400);
    assert.equal((await response.json()).error, "invalid_limit");
  }
  assert.throws(
    () => recorder.list("alpha", { active: "true" }),
    /invalid_active_filter/,
  );
  assert.throws(
    () => recorder.list("alpha", { active: true, limit: 201 }),
    /invalid_limit/,
  );
  assert.equal((await call("?active=true", tokens.denied)).status, 403);
  assert.equal((await call("?active=true", null)).status, 401);
});
