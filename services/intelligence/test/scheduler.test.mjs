import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { EvidenceStore } from "../src/store.mjs";
import { Scheduler } from "../src/scheduler.mjs";
import { Fault } from "../src/validation.mjs";

class FixtureRecorder {
  maxWorkspaceDurationSeconds = 3600;
  jobs = new Map();
  sources = new Map();
  created = 0;
  registerSource(value) {
    this.sources.set(value.workspace + ":" + value.id, value);
  }
  create(workspace, value) {
    const key = workspace + ":" + value.id;
    const old = this.jobs.get(key);
    if (old) return old;
    const source = this.sources.get(workspace + ":" + value.sourceId);
    assert.equal(source.sessionId, value.sessionId);
    const job = { ...value, state: "queued", fixture: true };
    this.jobs.set(key, job);
    this.created++;
    return job;
  }
  job(workspace, id) {
    const job = this.jobs.get(workspace + ":" + id);
    if (!job) throw new Fault("job_not_found", 404);
    return { ...job };
  }
  stop(workspace, id) {
    const job = this.jobs.get(workspace + ":" + id);
    job.state = "stopped";
    return this.job(workspace, id);
  }
}
function fixtureAdapter(workspace, id, broadcastId) {
  let polls = 0,
    closed = 0;
  return {
    workspace,
    id,
    get polls() {
      return polls;
    },
    get closed() {
      return closed;
    },
    descriptor: () => ({
      id,
      label: `Fictional ${workspace} source`,
      platform: "fixture",
      kind: "file",
      fixture: true,
    }),
    poll: async () => {
      polls++;
      return {
        status: "available",
        broadcastId,
        platform: "fixture",
        title: "Generated source fixture",
        sourceUrl: "https://example.invalid/fixture",
        account: null,
        sourceTimestampMs: null,
        recorderSource: { kind: "file", input: "/tmp/fixture-only-test" },
      };
    },
    subscribe: async ({ broadcastId: room, onEvent }) => {
      assert.equal(room, broadcastId);
      onEvent({
        source: { adapter: "fixture", eventId: "chat-" + room },
        kind: "chat",
        account: "fictional_" + workspace,
        text: "A generated test event for " + workspace,
        sourceTimestampMs: null,
        capturedAtMs: 500,
      });
      return {
        close: async () => {
          closed++;
        },
      };
    },
  };
}

test("explicit bounded watchlists persist, retain broadcast isolation and restart without duplicate jobs", async (t) => {
  const dir = mkdtempSync(join(tmpdir(), "livelens-scheduler-")),
    db = join(dir, "db.sqlite");
  let now = 1000,
    store = new EvidenceStore(db, { now: () => now });
  const recorder = new FixtureRecorder(),
    adapters = [
      fixtureAdapter("alpha", "selected", "room-a"),
      fixtureAdapter("beta", "selected", "room-b"),
    ];
  let scheduler = new Scheduler({ store, recorder, adapters, now: () => now });
  t.after(async () => {
    await scheduler.close();
    store.close();
    rmSync(dir, { recursive: true, force: true });
  });
  await scheduler.tick();
  assert.equal(adapters[0].polls, 0); // Source configuration cannot start unattended polling.
  const input = {
    id: "mission",
    sourceId: "selected",
    startAtMs: 1000,
    endAtMs: 100_000,
    maxDurationSeconds: 12,
    segmentSeconds: 2,
    pollSeconds: 10,
    autoRecord: true,
  };
  for (const workspace of ["alpha", "beta"]) scheduler.create(workspace, input);
  await scheduler.tick();
  const a = scheduler.mission("alpha", "mission"),
    b = scheduler.mission("beta", "mission");
  assert.notEqual(a.sessionId, b.sessionId);
  assert.notEqual(a.jobId, b.jobId);
  assert.equal(recorder.created, 2);
  assert.equal(store.search("alpha", { account: "fictional_beta" }).length, 0);
  const retained = store.events("alpha", a.sessionId)[0];
  assert.equal(retained.sourceTimestampMs, null);
  assert.equal(retained.capturedAtMs, 500);
  assert.equal(retained.receivedAtMs, 1000);
  assert.deepEqual(scheduler.create("alpha", input), a);
  assert.throws(
    () => scheduler.mission("third", "mission"),
    /mission_not_found/,
  );
  assert.throws(
    () =>
      scheduler.create("alpha", {
        ...input,
        input: "https://arbitrary.invalid",
      }),
    /unknown_field/,
  );
  await scheduler.close();
  store.close();
  now += 11_000;
  store = new EvidenceStore(db, { now: () => now });
  scheduler = new Scheduler({ store, recorder, adapters, now: () => now });
  await scheduler.tick();
  assert.equal(recorder.created, 2);
  assert.equal(store.events("alpha", a.sessionId).length, 1);
  scheduler.stop("alpha", "mission");
  assert.equal(scheduler.mission("alpha", "mission").job.state, "stopped");
  assert.equal(scheduler.mission("beta", "mission").job.state, "queued");
  now = 101_000;
  await scheduler.tick();
  assert.equal(scheduler.mission("beta", "mission").state, "completed");
  assert.equal(scheduler.mission("beta", "mission").job.state, "stopped");
});

test("discovery-only missions poll on schedule, back off on honest unavailability and remain bounded", async (t) => {
  let now = 1000,
    polls = 0;
  const store = new EvidenceStore();
  const adapter = {
    workspace: "alpha",
    id: "unavailable",
    descriptor: () => ({
      id: "unavailable",
      label: "Fixture unavailable",
      fixture: true,
    }),
    poll: async () => {
      polls++;
      return { status: "unavailable", reason: "fixture_unavailable" };
    },
  };
  const recorder = new FixtureRecorder(),
    scheduler = new Scheduler({
      store,
      recorder,
      adapters: [adapter],
      now: () => now,
    });
  t.after(async () => {
    await scheduler.close();
    store.close();
  });
  scheduler.create("alpha", {
    id: "watch",
    sourceId: "unavailable",
    startAtMs: 5000,
    endAtMs: 3600_000,
    pollSeconds: 10,
  });
  await scheduler.tick();
  assert.equal(polls, 0);
  now = 5000;
  await scheduler.tick();
  let mission = scheduler.mission("alpha", "watch");
  assert.equal(mission.state, "retrying");
  assert.equal(mission.autoRecord, false);
  assert.equal(mission.nextPollAtMs, 25_000);
  assert.equal(recorder.created, 0);
  await scheduler.tick();
  assert.equal(polls, 1);
  while (mission.failures < 10) {
    now = mission.nextPollAtMs;
    await scheduler.tick();
    mission = scheduler.mission("alpha", "watch");
  }
  assert.equal(mission.state, "failed");
  assert.equal(mission.jobId, null);
  assert.equal(polls, 10);
  assert.throws(
    () =>
      scheduler.create("alpha", {
        sourceId: "unavailable",
        endAtMs: now + 25 * 3600_000,
      }),
    /invalid_mission_bounds/,
  );
});

test("live sibling scheduler leases prevent duplicate poll and capture; expired ownership recovers idempotently", async (t) => {
  let now = 1000;
  const store = new EvidenceStore(),
    recorder = new FixtureRecorder(),
    adapter = fixtureAdapter("alpha", "selected", "room-a");
  const first = new Scheduler({
      store,
      recorder,
      adapters: [adapter],
      now: () => now,
    }),
    second = new Scheduler({
      store,
      recorder,
      adapters: [adapter],
      now: () => now,
    });
  t.after(async () => {
    await first.close();
    await second.close();
    store.close();
  });
  first.create("alpha", {
    id: "selected",
    sourceId: "selected",
    endAtMs: 100_000,
    autoRecord: true,
    pollSeconds: 10,
  });
  await first.tick();
  now += 11_000;
  await second.tick();
  assert.equal(adapter.polls, 1);
  assert.equal(recorder.created, 1);
  await first.close();
  await second.tick();
  assert.equal(adapter.polls, 2);
  assert.equal(recorder.created, 1);
});
