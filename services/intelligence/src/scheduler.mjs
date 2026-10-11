import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import {
  Fault,
  digest,
  ident,
  object,
  pageLimit,
  timestamp,
} from "./validation.mjs";

const terminal = ["stopped", "completed", "failed"];
const jobTerminal = ["stopped", "completed", "failed"];
const schema = `
CREATE TABLE IF NOT EXISTS collection_missions(
 workspace TEXT NOT NULL,id TEXT NOT NULL,source_id TEXT NOT NULL,state TEXT NOT NULL,
 created_at INTEGER NOT NULL,start_at INTEGER NOT NULL,end_at INTEGER NOT NULL,
 max_seconds INTEGER NOT NULL,segment_seconds INTEGER NOT NULL,poll_seconds INTEGER NOT NULL,
 auto_record INTEGER NOT NULL,next_poll INTEGER NOT NULL,last_checked INTEGER,
 status TEXT NOT NULL DEFAULT 'unchecked',failures INTEGER NOT NULL DEFAULT 0,poll_count INTEGER NOT NULL DEFAULT 0,
 broadcast_id TEXT,session_id TEXT,job_id TEXT,error TEXT,PRIMARY KEY(workspace,id));
CREATE TABLE IF NOT EXISTS collection_mission_leases(
 workspace TEXT NOT NULL,mission_id TEXT NOT NULL,owner TEXT NOT NULL,expires_at INTEGER NOT NULL,
 PRIMARY KEY(workspace,mission_id),FOREIGN KEY(workspace,mission_id) REFERENCES collection_missions(workspace,id));
CREATE TABLE IF NOT EXISTS collection_broadcasts(
 workspace TEXT NOT NULL,mission_id TEXT NOT NULL,broadcast_id TEXT NOT NULL,session_id TEXT NOT NULL,job_id TEXT,
 discovered_at INTEGER NOT NULL,PRIMARY KEY(workspace,mission_id,broadcast_id),
 FOREIGN KEY(workspace,mission_id) REFERENCES collection_missions(workspace,id));
CREATE TABLE IF NOT EXISTS collection_worker_processes(owner TEXT PRIMARY KEY,pid INTEGER NOT NULL,start_token TEXT NOT NULL);
`;

/** A selected watchlist runs only within its explicit deadline. Configured sources alone do not poll. */
export class Scheduler {
  constructor({
    store,
    recorder,
    adapters = [],
    intervalMs = 1000,
    now = Date.now,
    maxWorkspaceMissions = 20,
    pollTimeoutMs = 15_000,
  }) {
    if (!recorder) throw new Fault("recorder_required");
    this.store = store;
    this.db = store.db;
    this.recorder = recorder;
    this.adapters = adapters;
    this.intervalMs = intervalMs;
    this.now = now;
    this.maxWorkspaceMissions = maxWorkspaceMissions;
    this.pollTimeoutMs = pollTimeoutMs;
    this.owner = randomUUID();
    this.subscriptions = new Map();
    this.controllers = new Set();
    this.closed = false;
    this.busy = false;
    if (
      !Number.isInteger(maxWorkspaceMissions) ||
      maxWorkspaceMissions < 1 ||
      maxWorkspaceMissions > 100 ||
      !Number.isInteger(pollTimeoutMs) ||
      pollTimeoutMs < 100 ||
      pollTimeoutMs > 30_000
    )
      throw new Fault("invalid_scheduler_bounds");
    const keys = new Set();
    for (const adapter of adapters) {
      ident(adapter.workspace);
      ident(adapter.id);
      if (
        keys.has(adapter.workspace + ":" + adapter.id) ||
        typeof adapter.poll !== "function" ||
        typeof adapter.descriptor !== "function"
      )
        throw new Fault("invalid_source_adapter");
      keys.add(adapter.workspace + ":" + adapter.id);
    }
    this.db.exec(schema);
    this.db
      .prepare("INSERT INTO collection_worker_processes VALUES(?,?,?)")
      .run(this.owner, process.pid, processToken(process.pid));
  }
  key(row) {
    return row.workspace + ":" + row.id;
  }
  source(workspace, id) {
    ident(workspace);
    ident(id);
    const source = this.adapters.find(
      (a) => a.workspace === workspace && a.id === id,
    );
    if (!source) throw new Fault("source_unavailable", 404);
    return source;
  }
  sourcesFor(workspace) {
    ident(workspace);
    return this.adapters
      .filter((a) => a.workspace === workspace)
      .map((a) => a.descriptor());
  }
  mission(workspace, id) {
    ident(workspace);
    ident(id);
    const row = this.db
      .prepare("SELECT * FROM collection_missions WHERE workspace=? AND id=?")
      .get(workspace, id);
    if (!row) throw new Fault("mission_not_found", 404);
    let job = null;
    if (row.job_id) {
      try {
        job = this.recorder.job(workspace, row.job_id);
      } catch {}
    }
    return {
      id: row.id,
      sourceId: row.source_id,
      state: row.state,
      createdAtMs: row.created_at,
      startAtMs: row.start_at,
      endAtMs: row.end_at,
      maxDurationSeconds: row.max_seconds,
      segmentSeconds: row.segment_seconds,
      pollSeconds: row.poll_seconds,
      autoRecord: !!row.auto_record,
      status: row.status,
      lastCheckedAtMs: row.last_checked,
      nextPollAtMs: row.next_poll,
      failures: row.failures,
      pollCount: row.poll_count,
      broadcastId: row.broadcast_id,
      sessionId: row.session_id,
      jobId: row.job_id,
      error: row.error,
      job,
      limits: {
        maxWorkspaceMissions: this.maxWorkspaceMissions,
        maxPolls: 500,
        maxConsecutiveFailures: 10,
        maxScheduleHours: 24,
      },
      broadcasts: this.db
        .prepare(
          "SELECT broadcast_id,session_id,job_id,discovered_at FROM collection_broadcasts WHERE workspace=? AND mission_id=? ORDER BY discovered_at DESC LIMIT 100",
        )
        .all(workspace, id)
        .map((b) => ({
          broadcastId: b.broadcast_id,
          sessionId: b.session_id,
          jobId: b.job_id,
          discoveredAtMs: b.discovered_at,
        })),
    };
  }
  list(workspace, { limit = 100 } = {}) {
    ident(workspace);
    limit = pageLimit(limit);
    return this.db
      .prepare(
        "SELECT id FROM collection_missions WHERE workspace=? ORDER BY created_at DESC,id LIMIT ?",
      )
      .all(workspace, limit)
      .map((row) => this.mission(workspace, row.id));
  }
  create(workspace, value) {
    object(value, [
      "id",
      "sourceId",
      "startAtMs",
      "endAtMs",
      "maxDurationSeconds",
      "segmentSeconds",
      "pollSeconds",
      "autoRecord",
    ]);
    this.source(workspace, ident(value.sourceId));
    const id = value.id == null ? randomUUID() : ident(value.id),
      now = this.now();
    const start = timestamp(value.startAtMs ?? now),
      end = timestamp(value.endAtMs ?? start + 3600_000);
    const duration = value.maxDurationSeconds ?? 60,
      segment = value.segmentSeconds ?? 5,
      poll = value.pollSeconds ?? 60,
      auto = value.autoRecord ?? false;
    if (
      end <= start ||
      end <= now ||
      end - start > 24 * 3600_000 ||
      start - now > 30 * 24 * 3600_000 ||
      !Number.isInteger(duration) ||
      duration < 2 ||
      duration > this.recorder.maxWorkspaceDurationSeconds ||
      !Number.isInteger(segment) ||
      segment < 2 ||
      segment > 30 ||
      segment > duration ||
      !Number.isInteger(poll) ||
      poll < 10 ||
      poll > 3600 ||
      typeof auto !== "boolean"
    )
      throw new Fault("invalid_mission_bounds");
    return this.store.transaction(() => {
      const old = this.db
        .prepare("SELECT * FROM collection_missions WHERE workspace=? AND id=?")
        .get(workspace, id);
      if (old) {
        // Omitted defaults remain the persisted values when retrying an explicit identity.
        if (
          old.source_id !== value.sourceId ||
          (value.startAtMs != null && old.start_at !== start) ||
          (value.endAtMs != null && old.end_at !== end) ||
          old.max_seconds !== duration ||
          old.segment_seconds !== segment ||
          old.poll_seconds !== poll ||
          !!old.auto_record !== auto
        )
          throw new Fault("mission_identity_conflict", 409);
        return this.mission(workspace, id);
      }
      const active = this.db
        .prepare(
          "SELECT count(*) AS n FROM collection_missions WHERE workspace=? AND state NOT IN ('stopped','completed','failed')",
        )
        .get(workspace).n;
      const total = this.db
        .prepare(
          "SELECT count(*) AS n FROM collection_missions WHERE state NOT IN ('stopped','completed','failed')",
        )
        .get().n;
      if (active >= this.maxWorkspaceMissions || total >= 100)
        throw new Fault("mission_capacity", 409);
      if (
        this.db
          .prepare(
            "SELECT 1 FROM collection_missions WHERE workspace=? AND source_id=? AND state NOT IN ('stopped','completed','failed')",
          )
          .get(workspace, value.sourceId)
      )
        throw new Fault("source_mission_exists", 409);
      this.db
        .prepare(
          "INSERT INTO collection_missions(workspace,id,source_id,state,created_at,start_at,end_at,max_seconds,segment_seconds,poll_seconds,auto_record,next_poll) VALUES(?,?,?,'scheduled',?,?,?,?,?,?,?,?)",
        )
        .run(
          workspace,
          id,
          value.sourceId,
          now,
          start,
          end,
          duration,
          segment,
          poll,
          auto ? 1 : 0,
          start,
        );
      return this.mission(workspace, id);
    });
  }
  stop(workspace, id) {
    const mission = this.mission(workspace, id);
    if (terminal.includes(mission.state)) return mission;
    if (mission.jobId && !jobTerminal.includes(mission.job?.state))
      this.recorder.stop(workspace, mission.jobId);
    this.db
      .prepare(
        "UPDATE collection_missions SET state='stopped',error=NULL WHERE workspace=? AND id=?",
      )
      .run(workspace, id);
    const subscription = this.subscriptions.get(workspace + ":" + id);
    if (subscription) {
      subscription.controller.abort();
      void subscription.close().catch(() => {});
      this.subscriptions.delete(workspace + ":" + id);
    }
    return this.mission(workspace, id);
  }
  claim(row) {
    return this.store.transaction(() => {
      const lease = this.db
        .prepare(
          "SELECT * FROM collection_mission_leases WHERE workspace=? AND mission_id=?",
        )
        .get(row.workspace, row.id);
      if (
        lease &&
        lease.owner !== this.owner &&
        (lease.expires_at > this.now() || this.ownerAlive(lease.owner))
      )
        return false;
      this.db
        .prepare(
          "INSERT INTO collection_mission_leases VALUES(?,?,?,?) ON CONFLICT(workspace,mission_id) DO UPDATE SET owner=excluded.owner,expires_at=excluded.expires_at",
        )
        .run(
          row.workspace,
          row.id,
          this.owner,
          this.now() + Math.max(30_000, this.pollTimeoutMs * 2),
        );
      return true;
    });
  }
  ownerAlive(owner) {
    const row = this.db
      .prepare("SELECT * FROM collection_worker_processes WHERE owner=?")
      .get(owner);
    return !!row && processToken(row.pid) === row.start_token;
  }
  release(row) {
    this.db
      .prepare(
        "DELETE FROM collection_mission_leases WHERE workspace=? AND mission_id=? AND owner=?",
      )
      .run(row.workspace, row.id, this.owner);
  }
  async unsubscribe(row) {
    const sub = this.subscriptions.get(this.key(row));
    if (sub) {
      this.subscriptions.delete(this.key(row));
      sub.controller.abort();
      await sub.close();
    }
  }
  async ingestSubscription(row, adapter, broadcastId, sessionId) {
    if (
      this.subscriptions.has(this.key(row)) ||
      typeof adapter.subscribe !== "function"
    )
      return;
    const controller = new AbortController();
    this.controllers.add(controller);
    const onGap = (reason) => {
      this.store.append(row.workspace, sessionId, [
        {
          source: {
            adapter: "scheduler",
            eventId: `${row.id}-${broadcastId}-${randomUUID()}`,
          },
          kind: "gap",
          text: "Selected source event stream unavailable; missing events were not inferred.",
          capturedAtMs: this.now(),
          raw: { missionId: row.id, reason },
        },
      ]);
      this.db
        .prepare(
          "UPDATE collection_missions SET error=? WHERE workspace=? AND id=?",
        )
        .run(reason, row.workspace, row.id);
      // Reconnect only on the next bounded source poll, rather than an uncontrolled connector loop.
      const current = this.subscriptions.get(this.key(row));
      if (current) {
        this.subscriptions.delete(this.key(row));
        current.controller.abort();
        void current.close().catch(() => {});
        this.release(row);
      }
    };
    const timeout = setTimeout(() => controller.abort(), this.pollTimeoutMs);
    try {
      const subscription = await adapter.subscribe({
        broadcastId,
        signal: controller.signal,
        onEvent: (event) =>
          this.store.append(row.workspace, sessionId, [event]),
        onGap,
      });
      if (controller.signal.aborted || this.closed) {
        await subscription.close();
        return;
      }
      this.subscriptions.set(this.key(row), { ...subscription, controller });
    } catch {
      onGap("provider_event_stream_unavailable");
    } finally {
      clearTimeout(timeout);
      this.controllers.delete(controller);
    }
  }
  async process(row) {
    try {
      if (this.now() >= row.end_at || row.poll_count >= 500) {
        if (row.job_id) this.recorder.stop(row.workspace, row.job_id);
        this.db
          .prepare(
            "UPDATE collection_missions SET state='completed',error=? WHERE workspace=? AND id=?",
          )
          .run(
            row.poll_count >= 500 ? "poll_budget_exhausted" : null,
            row.workspace,
            row.id,
          );
        await this.unsubscribe(row);
        return;
      }
      let adapter;
      try {
        adapter = this.source(row.workspace, row.source_id);
      } catch {
        this.db
          .prepare(
            "UPDATE collection_missions SET state='failed',status='unavailable',error='source_unavailable' WHERE workspace=? AND id=?",
          )
          .run(row.workspace, row.id);
        return;
      }
      const controller = new AbortController();
      this.controllers.add(controller);
      const timeout = setTimeout(() => controller.abort(), this.pollTimeoutMs);
      let snapshot;
      try {
        snapshot = await Promise.race([
          adapter.poll({ signal: controller.signal }),
          new Promise((resolve) =>
            controller.signal.addEventListener(
              "abort",
              () => resolve({ status: "unavailable", reason: "poll_timeout" }),
              { once: true },
            ),
          ),
        ]);
      } catch {
        snapshot = { status: "unavailable", reason: "provider_unavailable" };
      } finally {
        clearTimeout(timeout);
        this.controllers.delete(controller);
      }
      const fresh = this.db
        .prepare("SELECT * FROM collection_missions WHERE workspace=? AND id=?")
        .get(row.workspace, row.id);
      if (
        this.closed ||
        terminal.includes(fresh.state) ||
        this.now() >= row.end_at
      )
        return;
      const knownStatus = [
        "available",
        "live",
        "offline",
        "unavailable",
      ].includes(snapshot?.status)
        ? snapshot.status
        : "unavailable";
      const failures = knownStatus === "unavailable" ? row.failures + 1 : 0;
      const backoff = Math.min(
        3600,
        row.poll_seconds * 2 ** Math.min(failures, 6),
      );
      this.db
        .prepare(
          "UPDATE collection_missions SET state=?,status=?,last_checked=?,next_poll=?,failures=?,poll_count=poll_count+1,error=? WHERE workspace=? AND id=?",
        )
        .run(
          failures >= 10
            ? "failed"
            : knownStatus === "offline"
              ? "offline"
              : knownStatus === "unavailable"
                ? "retrying"
                : "discovered",
          knownStatus,
          this.now(),
          Math.min(row.end_at, this.now() + backoff * 1000),
          failures,
          knownStatus === "unavailable"
            ? String(snapshot?.reason ?? "provider_unavailable").slice(0, 100)
            : null,
          row.workspace,
          row.id,
        );
      if (failures >= 10) {
        await this.unsubscribe(row);
        return;
      }
      if (!["live", "available"].includes(knownStatus)) return;
      const broadcastId = String(snapshot.broadcastId ?? "");
      if (!broadcastId || broadcastId.length > 256)
        throw new Fault("broadcast_id_unavailable");
      const descriptor = adapter.descriptor();
      const sessionId =
        descriptor.sessionId ??
        "ses_" +
          digest([row.workspace, row.source_id, broadcastId]).slice(0, 48);
      try {
        this.store.session(row.workspace, sessionId);
      } catch (error) {
        if (error.code !== "session_not_found") throw error;
        try {
          this.store.createSession(row.workspace, {
            id: sessionId,
            platform: snapshot.platform,
            account: snapshot.account ?? null,
            title: snapshot.title || descriptor.label,
            sourceUrl: snapshot.sourceUrl,
            startedAtMs: snapshot.sourceTimestampMs ?? this.now(),
          });
        } catch (conflict) {
          if (conflict.code !== "session_exists") throw conflict;
        }
      }
      let discovered = this.db
        .prepare(
          "SELECT * FROM collection_broadcasts WHERE workspace=? AND mission_id=? AND broadcast_id=?",
        )
        .get(row.workspace, row.id, broadcastId);
      if (!discovered) {
        this.db
          .prepare("INSERT INTO collection_broadcasts VALUES(?,?,?,?,NULL,?)")
          .run(row.workspace, row.id, broadcastId, sessionId, this.now());
        discovered = { job_id: null };
      }
      this.db
        .prepare(
          "UPDATE collection_missions SET broadcast_id=?,session_id=? WHERE workspace=? AND id=?",
        )
        .run(broadcastId, sessionId, row.workspace, row.id);
      if (!row.auto_record) return;
      let jobId = discovered.job_id;
      if (!jobId) {
        if (!snapshot.recorderSource)
          throw new Fault("media_url_unavailable", 503);
        const sourceId =
          "src_" +
          digest([row.workspace, row.source_id, broadcastId]).slice(0, 48);
        this.recorder.registerSource({
          ...snapshot.recorderSource,
          id: sourceId,
          workspace: row.workspace,
          sessionId,
          label: descriptor.label,
        });
        jobId =
          "job_" + digest([row.workspace, row.id, broadcastId]).slice(0, 48);
        const duration = Math.min(
          row.max_seconds,
          Math.floor((row.end_at - this.now()) / 1000),
        );
        if (duration < 2) return;
        let existing;
        try {
          existing = this.recorder.job(row.workspace, jobId);
        } catch (error) {
          if (error.code !== "job_not_found") throw error;
        }
        if (
          existing &&
          (existing.sessionId !== sessionId || existing.sourceId !== sourceId)
        )
          throw new Fault("job_identity_conflict", 409);
        if (!existing)
          this.recorder.create(row.workspace, {
            id: jobId,
            sourceId,
            sessionId,
            maxDurationSeconds: duration,
            segmentSeconds: Math.min(row.segment_seconds, duration),
          });
        this.db
          .prepare(
            "UPDATE collection_broadcasts SET job_id=? WHERE workspace=? AND mission_id=? AND broadcast_id=?",
          )
          .run(jobId, row.workspace, row.id, broadcastId);
      }
      const job = this.recorder.job(row.workspace, jobId);
      this.db
        .prepare(
          "UPDATE collection_missions SET state=?,job_id=? WHERE workspace=? AND id=?",
        )
        .run(
          jobTerminal.includes(job.state)
            ? "watching"
            : job.state === "recording"
              ? "recording"
              : "starting",
          jobId,
          row.workspace,
          row.id,
        );
      if (jobTerminal.includes(job.state)) await this.unsubscribe(row);
      else await this.ingestSubscription(row, adapter, broadcastId, sessionId);
    } catch (error) {
      this.db
        .prepare(
          "UPDATE collection_missions SET state='retrying',error=?,next_poll=? WHERE workspace=? AND id=? AND state NOT IN ('stopped','completed','failed')",
        )
        .run(
          error instanceof Fault ? error.code : "collection_failed",
          Math.min(row.end_at, this.now() + row.poll_seconds * 1000),
          row.workspace,
          row.id,
        );
    } finally {
      if (!this.subscriptions.has(this.key(row))) this.release(row);
    }
  }
  async tick() {
    if (this.closed || this.busy) return;
    this.busy = true;
    try {
      // Reconcile receipts and close feeds promptly when the bounded recorder ends.
      for (const [key, sub] of this.subscriptions) {
        const row = this.db
          .prepare(
            "SELECT * FROM collection_missions WHERE workspace=? AND id=?",
          )
          .get(...key.split(":"));
        if (
          !row ||
          terminal.includes(row.state) ||
          (row.job_id &&
            jobTerminal.includes(
              this.recorder.job(row.workspace, row.job_id).state,
            ))
        ) {
          sub.controller.abort();
          await sub.close();
          this.subscriptions.delete(key);
          if (row) {
            if (!terminal.includes(row.state))
              this.db
                .prepare(
                  "UPDATE collection_missions SET state='watching' WHERE workspace=? AND id=?",
                )
                .run(row.workspace, row.id);
            this.release(row);
          }
        } else if (row.job_id)
          this.db
            .prepare(
              "UPDATE collection_missions SET state=? WHERE workspace=? AND id=?",
            )
            .run(
              this.recorder.job(row.workspace, row.job_id).state === "recording"
                ? "recording"
                : "starting",
              row.workspace,
              row.id,
            );
      }
      const due = this.db
        .prepare(
          "SELECT * FROM collection_missions WHERE state NOT IN ('stopped','completed','failed') AND start_at<=? AND (next_poll<=? OR end_at<=?) ORDER BY next_poll,id LIMIT 100",
        )
        .all(this.now(), this.now(), this.now());
      const claimed = [];
      for (const row of due)
        if (claimed.length < 2 && this.claim(row)) claimed.push(row);
      await Promise.all(claimed.map((row) => this.process(row)));
    } finally {
      this.busy = false;
    }
  }
  start() {
    if (this.timer || this.closed) return;
    this.timer = setInterval(() => {
      void this.tick().catch(() => {
        this.workerError = "scheduler_failure";
      });
    }, this.intervalMs);
    this.heartbeat = setInterval(() => {
      if (!this.closed)
        this.db
          .prepare(
            "UPDATE collection_mission_leases SET expires_at=? WHERE owner=?",
          )
          .run(
            this.now() + Math.max(30_000, this.pollTimeoutMs * 2),
            this.owner,
          );
    }, 1000);
    void this.tick().catch(() => {
      this.workerError = "scheduler_failure";
    });
  }
  async close() {
    if (this.closed) return;
    this.closed = true;
    clearInterval(this.timer);
    clearInterval(this.heartbeat);
    for (const controller of this.controllers) controller.abort();
    for (const sub of this.subscriptions.values()) {
      sub.controller.abort();
      await sub.close();
    }
    this.subscriptions.clear();
    while (this.busy) await new Promise((resolve) => setTimeout(resolve, 20));
    this.db
      .prepare("DELETE FROM collection_mission_leases WHERE owner=?")
      .run(this.owner);
    this.db
      .prepare("DELETE FROM collection_worker_processes WHERE owner=?")
      .run(this.owner);
  }
}

function processToken(pid) {
  try {
    const stat = readFileSync(`/proc/${pid}/stat`, "utf8"),
      fields = stat.slice(stat.lastIndexOf(")") + 2).split(" ");
    return fields[0] === "Z" ? null : fields[19];
  } catch {
    return null;
  }
}
