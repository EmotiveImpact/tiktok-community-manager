import { spawn, execFile } from "node:child_process";
import { promisify } from "node:util";
import {
  mkdirSync,
  readFileSync,
  writeFileSync,
  renameSync,
  readdirSync,
  statSync,
  realpathSync,
  existsSync,
  createReadStream,
} from "node:fs";
import { resolve, join, sep } from "node:path";
import { randomUUID, createHash } from "node:crypto";
import { fileURLToPath } from "node:url";
import { Fault, ident, object, pageLimit } from "./validation.mjs";

const run = promisify(execFile);
const terminal = ["completed", "stopped", "failed"];
const schema = `
CREATE TABLE IF NOT EXISTS recording_jobs(
 workspace TEXT NOT NULL,id TEXT NOT NULL,session_id TEXT NOT NULL,source_id TEXT NOT NULL,
 state TEXT NOT NULL,attempts INTEGER NOT NULL DEFAULT 0,created_at INTEGER NOT NULL,
 deadline INTEGER NOT NULL,segment_seconds INTEGER NOT NULL,max_seconds INTEGER NOT NULL,
 attempt_started INTEGER,stop_requested INTEGER NOT NULL DEFAULT 0,next_retry INTEGER NOT NULL DEFAULT 0,
 error TEXT,PRIMARY KEY(workspace,id),FOREIGN KEY(workspace,session_id) REFERENCES sessions(workspace,id));
CREATE TABLE IF NOT EXISTS media_segments(
 workspace TEXT NOT NULL,job_id TEXT NOT NULL,id TEXT NOT NULL,attempt INTEGER NOT NULL,
 started_at INTEGER NOT NULL,duration_ms INTEGER NOT NULL,bytes INTEGER NOT NULL,sha256 TEXT NOT NULL,
 relative_path TEXT NOT NULL,PRIMARY KEY(workspace,job_id,id),
 FOREIGN KEY(workspace,job_id) REFERENCES recording_jobs(workspace,id));
CREATE TABLE IF NOT EXISTS recorder_lease(id INTEGER PRIMARY KEY CHECK(id=1),owner TEXT NOT NULL,expires_at INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS recording_job_leases(
 workspace TEXT NOT NULL,job_id TEXT NOT NULL,owner TEXT NOT NULL,expires_at INTEGER NOT NULL,
 PRIMARY KEY(workspace,job_id),FOREIGN KEY(workspace,job_id) REFERENCES recording_jobs(workspace,id));
CREATE TABLE IF NOT EXISTS recording_budgets(
 workspace TEXT NOT NULL,job_id TEXT NOT NULL,reserved_bytes INTEGER NOT NULL,
 PRIMARY KEY(workspace,job_id),FOREIGN KEY(workspace,job_id) REFERENCES recording_jobs(workspace,id));
CREATE TABLE IF NOT EXISTS recording_sources(workspace TEXT NOT NULL,id TEXT NOT NULL,configuration TEXT NOT NULL,PRIMARY KEY(workspace,id));
CREATE TABLE IF NOT EXISTS recording_worker_processes(owner TEXT PRIMARY KEY,pid INTEGER NOT NULL,start_token TEXT NOT NULL);
`;

export class Recorder {
  constructor({
    store,
    mediaRoot,
    ffmpeg,
    sources = [],
    intervalMs = 200,
    maxConcurrent = 2,
    maxWorkspaceConcurrent = 2,
    maxWorkspacePending = 20,
    maxWorkspaceDurationSeconds = 3600,
    maxWorkspaceBytes = 10 * 1024 ** 3,
    maxJobBytes = 1024 ** 3,
    leaseMs = 10_000,
  }) {
    this.store = store;
    this.db = store.db;
    this.root = resolve(mediaRoot);
    this.ffmpeg = resolve(ffmpeg);
    mkdirSync(this.root, { recursive: true, mode: 0o700 });
    this.root = realpathSync(this.root);
    this.owner = randomUUID();
    this.intervalMs = intervalMs;
    this.activeJobs = new Map();
    this.closed = false;
    for (const [key, value, min, max] of [
      ["maxConcurrent", maxConcurrent, 1, 16],
      ["maxWorkspaceConcurrent", maxWorkspaceConcurrent, 1, 16],
      ["maxWorkspacePending", maxWorkspacePending, 1, 100],
      ["maxWorkspaceDurationSeconds", maxWorkspaceDurationSeconds, 2, 3600],
      ["maxWorkspaceBytes", maxWorkspaceBytes, 1024, Number.MAX_SAFE_INTEGER],
      ["maxJobBytes", maxJobBytes, 1024, Number.MAX_SAFE_INTEGER],
      ["leaseMs", leaseMs, 1000, 60_000],
    ]) {
      if (!Number.isSafeInteger(value) || value < min || value > max)
        throw new Fault("invalid_recorder_quota");
      this[key] = value;
    }
    if (process.platform !== "linux")
      throw new Fault("linux_recorder_required");
    const ids = new Set();
    this.sources = sources.map((source) => {
      object(source, [
        "id",
        "workspace",
        "sessionId",
        "kind",
        "input",
        "label",
      ]);
      ident(source.id);
      ident(source.workspace);
      ident(source.sessionId);
      if (ids.has(source.workspace + ":" + source.id))
        throw new Fault("duplicate_recorder_source");
      ids.add(source.workspace + ":" + source.id);
      if (source.kind === "file") {
        const path = realpathSync(source.input);
        if (!statSync(path).isFile()) throw new Fault("fixture_file_required");
        return { ...source, input: path };
      }
      if (source.kind !== "https") throw new Fault("invalid_recorder_source");
      const url = new URL(source.input);
      if (url.protocol !== "https:" || url.username || url.password || url.hash)
        throw new Fault("https_media_required");
      return { ...source };
    });
    this.db.exec(schema);
    this.processStartToken = processToken(process.pid);
    this.db
      .prepare("INSERT INTO recording_worker_processes VALUES(?,?,?)")
      .run(this.owner, process.pid, this.processStartToken);
    for (const row of this.db
      .prepare("SELECT configuration FROM recording_sources")
      .all()) {
      const source = JSON.parse(row.configuration);
      if (
        !this.sources.some(
          (s) => s.workspace === source.workspace && s.id === source.id,
        )
      ) {
        // Explicit adapter selection persisted this private configuration previously.
        // Validate again so removed local fixtures cannot claim capture availability.
        try {
          this.sources.push(this.validateSource(source));
        } catch {}
      }
    }
  }

  // Compatibility for callers inspecting a single fixture worker; production uses activeJobs.
  get active() {
    return this.activeJobs.values().next().value ?? null;
  }
  key(row) {
    return row.workspace + ":" + row.id;
  }
  validateSource(source) {
    object(source, ["id", "workspace", "sessionId", "kind", "input", "label"]);
    ident(source.id);
    ident(source.workspace);
    ident(source.sessionId);
    if (source.kind === "file") {
      const path = realpathSync(source.input);
      if (!statSync(path).isFile()) throw new Fault("fixture_file_required");
      return { ...source, input: path };
    }
    if (source.kind !== "https") throw new Fault("invalid_recorder_source");
    let url;
    try {
      url = new URL(source.input);
    } catch {
      throw new Fault("https_media_required");
    }
    if (url.protocol !== "https:" || url.username || url.password || url.hash)
      throw new Fault("https_media_required");
    return { ...source };
  }
  registerSource(source) {
    // Only trusted server-side adapters call this. Browser/API input never supplies media URLs.
    const existing = this.sources.findIndex(
      (s) => s.workspace === source.workspace && s.id === source.id,
    );
    const configured = this.validateSource(source);
    if (existing < 0) this.sources.push(configured);
    else this.sources[existing] = configured;
    this.db
      .prepare(
        "INSERT INTO recording_sources VALUES(?,?,?) ON CONFLICT(workspace,id) DO UPDATE SET configuration=excluded.configuration",
      )
      .run(configured.workspace, configured.id, JSON.stringify(configured));
    return this.sourcesFor(source.workspace).find((s) => s.id === source.id);
  }

  sourcesFor(workspace) {
    return this.sources
      .filter((s) => s.workspace === workspace)
      .map(({ id, sessionId, kind, label }) => ({
        id,
        sessionId,
        kind,
        label: label || id,
      }));
  }
  source(workspace, id) {
    const source = this.sources.find(
      (s) => s.workspace === workspace && s.id === id,
    );
    if (!source) throw new Fault("source_unavailable", 404);
    return source;
  }
  job(workspace, id) {
    ident(workspace);
    ident(id);
    const row = this.db
      .prepare("SELECT * FROM recording_jobs WHERE workspace=? AND id=?")
      .get(workspace, id);
    if (!row) throw new Fault("job_not_found", 404);
    return {
      id: row.id,
      sessionId: row.session_id,
      sourceId: row.source_id,
      state:
        row.state === "recording" &&
        !this.db
          .prepare(
            "SELECT 1 FROM recording_job_leases WHERE workspace=? AND job_id=? AND expires_at>?",
          )
          .get(workspace, id, Date.now())
          ? "recovering"
          : row.state,
      attempts: row.attempts,
      createdAtMs: row.created_at,
      deadlineMs: row.deadline,
      maxDurationSeconds: row.max_seconds,
      segmentSeconds: row.segment_seconds,
      stopRequested: !!row.stop_requested,
      error: row.error,
      quotas: {
        maxConcurrent: this.maxConcurrent,
        maxWorkspaceConcurrent: this.maxWorkspaceConcurrent,
        maxWorkspacePending: this.maxWorkspacePending,
        maxDurationSeconds: this.maxWorkspaceDurationSeconds,
        maxWorkspaceBytes: this.maxWorkspaceBytes,
        maxJobBytes: this.maxJobBytes,
      },
      segments: this.db
        .prepare(
          "SELECT id,attempt,started_at,duration_ms,bytes,sha256 FROM media_segments WHERE workspace=? AND job_id=? ORDER BY started_at,id",
        )
        .all(workspace, id)
        .map((s) => ({
          id: s.id,
          attempt: s.attempt,
          startedAtMs: s.started_at,
          durationMs: s.duration_ms,
          bytes: s.bytes,
          sha256: s.sha256,
          timestampBasis: "collector-media-offset",
        })),
    };
  }
  list(workspace, { sessionId, limit = 100, active = false } = {}) {
    ident(workspace);
    limit = pageLimit(limit);
    if (typeof active !== "boolean") throw new Fault("invalid_active_filter");
    if (sessionId) this.store.session(workspace, sessionId);
    const query =
      "SELECT id FROM recording_jobs WHERE workspace=?" +
      (sessionId ? " AND session_id=?" : "") +
      (active ? " AND state NOT IN ('completed','stopped','failed')" : "") +
      " ORDER BY created_at DESC LIMIT ?";
    const rows = this.db
      .prepare(query)
      .all(workspace, ...(sessionId ? [sessionId] : []), limit);
    return rows.map((row) => this.job(workspace, row.id));
  }
  create(workspace, value) {
    object(value, [
      "id",
      "sessionId",
      "sourceId",
      "maxDurationSeconds",
      "segmentSeconds",
    ]);
    const source = this.source(workspace, ident(value.sourceId));
    const sessionId = ident(value.sessionId);
    this.store.session(workspace, sessionId);
    if (source.sessionId !== sessionId)
      throw new Fault("source_session_mismatch", 409);
    const id = value.id == null ? randomUUID() : ident(value.id);
    const max = value.maxDurationSeconds ?? 60,
      segment = value.segmentSeconds ?? 5;
    if (
      !Number.isInteger(max) ||
      max < 2 ||
      max > this.maxWorkspaceDurationSeconds ||
      !Number.isInteger(segment) ||
      segment < 2 ||
      segment > 30 ||
      segment > max
    )
      throw new Fault("invalid_recording_bounds");
    return this.store.transaction(() => {
      const existing = this.db
        .prepare("SELECT * FROM recording_jobs WHERE workspace=? AND id=?")
        .get(workspace, id);
      if (existing) {
        if (
          existing.session_id !== sessionId ||
          existing.source_id !== source.id ||
          existing.max_seconds !== max ||
          existing.segment_seconds !== segment
        )
          throw new Fault("job_identity_conflict", 409);
        return this.job(workspace, id);
      }
      if (
        this.db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='retention_cleanup'").get() &&
        this.db.prepare("SELECT 1 FROM retention_cleanup WHERE workspace=? AND job_id=? AND state!='completed' LIMIT 1").get(workspace, id)
      ) throw new Fault("recording_cleanup_pending", 409);
      this.admission?.(workspace, { recordingSeconds: max, pendingJobs: 1 });
      const pending = this.db
        .prepare(
          "SELECT count(*) AS n FROM recording_jobs WHERE state NOT IN ('completed','stopped','failed')",
        )
        .get().n;
      if (pending >= 100) throw new Fault("recording_capacity", 409);
      const workspacePending = this.db
        .prepare(
          "SELECT count(*) AS n FROM recording_jobs WHERE workspace=? AND state NOT IN ('completed','stopped','failed')",
        )
        .get(workspace).n;
      if (workspacePending >= this.maxWorkspacePending)
        throw new Fault("workspace_recording_capacity", 409);
      const retained = this.db
        .prepare(
          "SELECT coalesce(sum(bytes),0) AS n FROM media_segments WHERE workspace=?",
        )
        .get(workspace).n;
      const pendingCleanup = this.db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='retention_cleanup'").get()
        ? this.db.prepare("SELECT coalesce(sum(bytes),0) AS n FROM retention_cleanup WHERE workspace=? AND state!='completed'").get(workspace).n
        : 0;
      const reserved = pendingCleanup + this.db
        .prepare(
          "SELECT coalesce(sum(b.reserved_bytes),0) AS n FROM recording_budgets b JOIN recording_jobs j ON j.workspace=b.workspace AND j.id=b.job_id WHERE b.workspace=? AND j.state NOT IN ('completed','stopped','failed')",
        )
        .get(workspace).n;
      if (retained + reserved + this.maxJobBytes > this.maxWorkspaceBytes)
        throw new Fault("workspace_storage_capacity", 409);
      if (
        this.db
          .prepare(
            "SELECT 1 FROM recording_jobs WHERE workspace=? AND session_id=? AND state NOT IN ('completed','stopped','failed')",
          )
          .get(workspace, sessionId)
      )
        throw new Fault("session_recording_exists", 409);
      const now = Date.now();
      this.db
        .prepare(
          "INSERT INTO recording_jobs(workspace,id,session_id,source_id,state,created_at,deadline,segment_seconds,max_seconds) VALUES(?,?,?,?,'queued',?,?,?,?)",
        )
        .run(
          workspace,
          id,
          sessionId,
          source.id,
          now,
          now + max * 1000,
          segment,
          max,
        );
      this.db
        .prepare("INSERT INTO recording_budgets VALUES(?,?,?)")
        .run(workspace, id, this.maxJobBytes);
      return this.job(workspace, id);
    });
  }
  stop(workspace, id) {
    const job = this.job(workspace, id);
    if (terminal.includes(job.state)) return job;
    this.db
      .prepare(
        "UPDATE recording_jobs SET stop_requested=1,state=CASE WHEN state IN ('queued','retrying') THEN 'stopped' ELSE 'stopping' END WHERE workspace=? AND id=?",
      )
      .run(workspace, id);
    return this.job(workspace, id);
  }
  directory(workspace, id, attempt) {
    ident(workspace);
    ident(id);
    const dir = join(this.root, workspace, id, `attempt-${attempt}`);
    mkdirSync(dir, { recursive: true, mode: 0o700 });
    if (!realpathSync(dir).startsWith(this.root + sep))
      throw new Fault("unsafe_media_path", 500);
    return dir;
  }
  gap(row, reason) {
    this.store.append(row.workspace, row.session_id, [
      {
        source: {
          adapter: "recorder",
          eventId: `${row.id}-attempt-${row.attempts}-${reason}`,
        },
        kind: "gap",
        text: `Recording capture gap: ${reason.replaceAll("-", " ")}. No missing content was inferred.`,
        capturedAtMs: Date.now(),
        raw: { jobId: row.id, attempt: row.attempts, reason },
      },
    ]);
  }
  async collect(row, recover = false) {
    if (!row.attempts) return;
    const dir = this.directory(row.workspace, row.id, row.attempts);
    let lines = [];
    try {
      lines = readFileSync(join(dir, "segments.csv"), "utf8")
        .trim()
        .split("\n");
    } catch {}
    for (const line of lines) {
      const match =
        /^(?:"?)(segment-\d{5}\.partial\.mp4)(?:"?),([\d.]+),([\d.]+)$/.exec(
          line,
        );
      if (!match) continue;
      const duration = Math.round((Number(match[3]) - Number(match[2])) * 1000);
      if (duration <= 0 || duration > (row.segment_seconds + 10) * 1000)
        continue;
      const id = `a${row.attempts}-${match[1].slice(0, 13)}`;
      if (
        this.db
          .prepare(
            "SELECT 1 FROM media_segments WHERE workspace=? AND job_id=? AND id=?",
          )
          .get(row.workspace, row.id, id)
      )
        continue;
      const partial = join(dir, match[1]),
        final = join(dir, match[1].replace(".partial", ""));
      const path = existsSync(final) ? final : partial;
      if (
        !existsSync(path) ||
        !statSync(path).size ||
        statSync(path).size > 512 * 1024 * 1024
      )
        continue;
      try {
        await run(
          this.ffmpeg,
          [
            "-v",
            "error",
            "-nostdin",
            "-protocol_whitelist",
            "file",
            "-i",
            path,
            "-f",
            "null",
            "-",
          ],
          { timeout: 15_000, maxBuffer: 64 * 1024 },
        );
      } catch {
        if (recover && existsSync(path))
          renameSync(path, path + ".unavailable");
        this.gap(row, `invalid-segment-${match[1].slice(0, 13)}`);
        continue;
      }
      const sha256 = await hashFile(path);
      try {
        this.admission?.(row.workspace, { storageBytes: statSync(path).size });
      } catch (error) {
        row.quotaExceeded =
          error instanceof Fault ? error.code : "workspace_quota_exceeded";
        if (existsSync(path)) renameSync(path, path + ".unavailable");
        this.gap(row, "quota-limit");
        const active = this.activeJobs.get(this.key(row));
        if (active) {
          active.quotaError = row.quotaExceeded;
          if (!active.signalled) this.signal(active, "quota-limit");
        }
        break;
      }
      if (path === partial) renameSync(partial, final);
      this.db
        .prepare(
          "INSERT OR IGNORE INTO media_segments VALUES(?,?,?,?,?,?,?,?,?)",
        )
        .run(
          row.workspace,
          row.id,
          id,
          row.attempts,
          row.attempt_started + Math.round(Number(match[2]) * 1000),
          duration,
          statSync(final).size,
          sha256,
          final.slice(this.root.length + 1),
        );
      // Only a decoded, durably retained segment can establish recording-active.
      this.db
        .prepare(
          "UPDATE recording_jobs SET state='recording' WHERE workspace=? AND id=? AND state='starting'",
        )
        .run(row.workspace, row.id);
    }
    if (recover) {
      for (const file of readdirSync(dir).filter((f) =>
        f.endsWith(".partial.mp4"),
      )) {
        // Unlisted or undecodable tails are quarantined, never advertised as media.
        renameSync(join(dir, file), join(dir, file + ".unavailable"));
        this.gap(row, `partial-tail-${file.slice(0, 13)}`);
      }
    }
    const manifest = this.job(row.workspace, row.id);
    writeFileSync(
      join(dir, "manifest.json.tmp"),
      JSON.stringify(
        {
          schemaVersion: 1,
          workspace: row.workspace,
          sessionId: row.session_id,
          ...manifest,
        },
        null,
        2,
      ),
      { mode: 0o600 },
    );
    renameSync(join(dir, "manifest.json.tmp"), join(dir, "manifest.json"));
  }
  claim(row) {
    return this.store.transaction(() => {
      const now = Date.now();
      // An old release may still hold its original global lease. Do not recover its live child.
      const legacy = this.db
        .prepare("SELECT * FROM recorder_lease WHERE id=1")
        .get();
      if (legacy && legacy.owner !== this.owner && legacy.expires_at > now)
        return false;
      const held = this.db
        .prepare(
          "SELECT * FROM recording_job_leases WHERE workspace=? AND job_id=?",
        )
        .get(row.workspace, row.id);
      // Never recover a paused but still living sibling. A PID birth token also
      // prevents an unrelated process reusing an old PID from blocking recovery.
      if (
        held &&
        held.owner !== this.owner &&
        (held.expires_at > now || this.ownerAlive(held.owner))
      )
        return false;
      const leases = this.db
        .prepare("SELECT * FROM recording_job_leases")
        .all()
        .filter((l) => l.expires_at > now || this.ownerAlive(l.owner));
      const live = leases.length;
      const own = leases.filter((l) => l.workspace === row.workspace).length;
      if (
        (!held || held.owner !== this.owner) &&
        (live >= this.maxConcurrent || own >= this.maxWorkspaceConcurrent)
      )
        return false;
      this.db
        .prepare(
          "INSERT INTO recording_job_leases VALUES(?,?,?,?) ON CONFLICT(workspace,job_id) DO UPDATE SET owner=excluded.owner,expires_at=excluded.expires_at",
        )
        .run(row.workspace, row.id, this.owner, now + this.leaseMs);
      return true;
    });
  }
  ownerAlive(owner) {
    const row = this.db
      .prepare("SELECT * FROM recording_worker_processes WHERE owner=?")
      .get(owner);
    return !!row && processToken(row.pid) === row.start_token;
  }
  release(row) {
    this.db
      .prepare(
        "DELETE FROM recording_job_leases WHERE workspace=? AND job_id=? AND owner=?",
      )
      .run(row.workspace, row.id, this.owner);
  }
  async recover(row) {
    await this.collect(row, true);
    if (row.quotaExceeded) {
      this.db
        .prepare(
          "UPDATE recording_jobs SET state='failed',error=? WHERE workspace=? AND id=?",
        )
        .run(row.quotaExceeded, row.workspace, row.id);
      this.release(row);
      return;
    }
    this.gap(row, "worker-interrupted");
    this.retry(row, "worker_interrupted");
    this.release(row);
  }
  diskBytes(path) {
    if (!existsSync(path)) return 0;
    let total = 0;
    for (const entry of readdirSync(path, { withFileTypes: true })) {
      const child = join(path, entry.name);
      // Do not follow symlinks, which cannot be advertised as valid retained segments.
      if (entry.isDirectory()) total += this.diskBytes(child);
      else if (entry.isFile()) total += statSync(child).size;
      if (total > this.maxWorkspaceBytes) return total;
    }
    return total;
  }
  retry(row, error) {
    const state = row.stop_requested
      ? "stopped"
      : row.attempts >= 3 || Date.now() >= row.deadline
        ? "failed"
        : "retrying";
    this.db
      .prepare(
        "UPDATE recording_jobs SET state=?,error=?,next_retry=? WHERE workspace=? AND id=?",
      )
      .run(
        state,
        error,
        Date.now() + Math.min(5000, row.attempts * 500),
        row.workspace,
        row.id,
      );
  }
  start() {
    if (this.timer || this.closed) return;
    const fail = () => {
      this.workerError = "worker_failure";
      for (const active of this.activeJobs.values()) {
        this.signal(active, "worker-failure");
        this.db
          .prepare(
            "UPDATE recording_jobs SET error='worker_failure' WHERE workspace=? AND id=?",
          )
          .run(active.row.workspace, active.row.id);
      }
    };
    this.timer = setInterval(() => this.tick().catch(fail), this.intervalMs);
    this.heartbeat = setInterval(
      () => {
        if (!this.closed)
          this.db
            .prepare(
              "UPDATE recording_job_leases SET expires_at=? WHERE owner=?",
            )
            .run(Date.now() + this.leaseMs, this.owner);
      },
      Math.min(1000, Math.floor(this.leaseMs / 3)),
    );
    this.tick().catch(fail);
  }
  async pollActive(a) {
    const lease = this.db
      .prepare(
        "SELECT owner FROM recording_job_leases WHERE workspace=? AND job_id=?",
      )
      .get(a.row.workspace, a.row.id);
    if (lease?.owner !== this.owner) {
      if (!a.signalled) this.signal(a, "lease-lost");
      if (a.done) {
        clearTimeout(a.killTimer);
        this.activeJobs.delete(this.key(a.row));
      }
      return;
    }
    const row = this.db
      .prepare("SELECT * FROM recording_jobs WHERE workspace=? AND id=?")
      .get(a.row.workspace, a.row.id);
    await this.collect(row);
    const storageExceeded =
      this.diskBytes(join(this.root, row.workspace, row.id)) >
        this.maxJobBytes ||
      this.diskBytes(join(this.root, row.workspace)) > this.maxWorkspaceBytes;
    if (storageExceeded) a.quotaError = "recording_storage_limit";
    if (
      (row.stop_requested || Date.now() >= row.deadline || storageExceeded) &&
      !a.signalled
    )
      this.signal(
        a,
        row.stop_requested
          ? "stop"
          : storageExceeded
            ? "storage-limit"
            : "deadline",
      );
    if (!a.done) return;
    clearTimeout(a.killTimer);
    await this.collect(row, true);
    const segments = this.job(row.workspace, row.id).segments;
    if (a.quotaError) {
      this.db
        .prepare(
          "UPDATE recording_jobs SET state='failed',error=? WHERE workspace=? AND id=?",
        )
        .run(a.quotaError, row.workspace, row.id);
      this.gap(row, "storage-limit");
    } else if (row.stop_requested)
      this.db
        .prepare(
          "UPDATE recording_jobs SET state='stopped',error=NULL WHERE workspace=? AND id=?",
        )
        .run(row.workspace, row.id);
    else if (
      !a.processError &&
      a.code === 0 &&
      segments.some((s) => s.attempt === row.attempts)
    )
      this.db
        .prepare(
          "UPDATE recording_jobs SET state='completed',error=NULL WHERE workspace=? AND id=?",
        )
        .run(row.workspace, row.id);
    else {
      this.gap(row, "media-unavailable");
      this.retry(row, "media_unavailable");
    }
    await this.collect(row);
    this.activeJobs.delete(this.key(row));
    this.release(row);
  }
  async tick() {
    if (this.busy || this.closed) return;
    this.busy = true;
    try {
      await Promise.all(
        [...this.activeJobs.values()].map((a) => this.pollActive(a)),
      );
      // Lease each job separately. A second worker may collect another session but may
      // never recover or signal a healthy sibling's FFmpeg process.
      const interrupted = this.db
        .prepare(
          "SELECT j.* FROM recording_jobs j LEFT JOIN recording_job_leases l ON l.workspace=j.workspace AND l.job_id=j.id WHERE j.state IN ('starting','recording','stopping') AND (l.expires_at IS NULL OR l.expires_at<=? OR l.owner=?) ORDER BY j.created_at,j.id LIMIT 100",
        )
        .all(Date.now(), this.owner);
      for (const row of interrupted)
        if (!this.activeJobs.has(this.key(row)) && this.claim(row))
          await this.recover(row);
      const candidates = this.db
        .prepare(
          "SELECT * FROM recording_jobs WHERE state IN ('queued','retrying') AND stop_requested=0 AND next_retry<=? ORDER BY created_at,id LIMIT 100",
        )
        .all(Date.now());
      for (const row of candidates) {
        if (this.activeJobs.size >= this.maxConcurrent) break;
        if (!this.claim(row)) continue;
        if (Date.now() >= row.deadline || row.attempts >= 3) {
          this.db
            .prepare(
              "UPDATE recording_jobs SET state='failed',error='capture_deadline_exceeded' WHERE workspace=? AND id=?",
            )
            .run(row.workspace, row.id);
          this.gap(row, "capture-deadline-exceeded");
          this.release(row);
          continue;
        }
        if (
          this.diskBytes(join(this.root, row.workspace)) >=
          this.maxWorkspaceBytes
        ) {
          this.db
            .prepare(
              "UPDATE recording_jobs SET state='failed',error='workspace_storage_capacity' WHERE workspace=? AND id=?",
            )
            .run(row.workspace, row.id);
          this.gap(row, "storage-limit");
          this.release(row);
          continue;
        }
        let source;
        try {
          source = this.source(row.workspace, row.source_id);
        } catch {
          this.db
            .prepare(
              "UPDATE recording_jobs SET state='failed',error='source_unavailable' WHERE workspace=? AND id=?",
            )
            .run(row.workspace, row.id);
          this.gap(row, "source-unavailable");
          this.release(row);
          continue;
        }
        this.launch(row, source);
      }
    } finally {
      this.busy = false;
    }
  }
  launch(row, source) {
    row.attempts++;
    row.attempt_started = Date.now();
    this.db
      .prepare(
        "UPDATE recording_jobs SET state='starting',attempts=?,attempt_started=? WHERE workspace=? AND id=? AND state IN ('queued','retrying') AND stop_requested=0",
      )
      .run(row.attempts, row.attempt_started, row.workspace, row.id);
    const actual = this.db
      .prepare("SELECT * FROM recording_jobs WHERE workspace=? AND id=?")
      .get(row.workspace, row.id);
    if (
      actual.state !== "starting" ||
      actual.attempts !== row.attempts ||
      actual.stop_requested
    ) {
      this.release(row);
      return;
    }
    const dir = this.directory(row.workspace, row.id, row.attempts);
    const remaining = Math.max(
      1,
      Math.ceil((row.deadline - Date.now()) / 1000),
    );
    const offset =
      this.job(row.workspace, row.id).segments.reduce(
        (n, s) => n + s.durationMs,
        0,
      ) / 1000;
    const input =
      source.kind === "file"
        ? [
            "-re",
            "-ss",
            String(offset),
            "-protocol_whitelist",
            "file",
            "-i",
            source.input,
          ]
        : [
            "-protocol_whitelist",
            "https,tls,tcp,crypto",
            "-tls_verify",
            "1",
            "-ca_file",
            "/etc/ssl/certs/ca-certificates.crt",
            "-rw_timeout",
            "10000000",
            ...(process.env.HTTPS_PROXY
              ? ["-http_proxy", process.env.HTTPS_PROXY]
              : []),
            "-i",
            source.input,
          ];
    const args = [
      "-hide_banner",
      "-loglevel",
      "error",
      "-stdin",
      ...input,
      "-map",
      "0:v:0?",
      "-map",
      "0:a:0?",
      "-c:v",
      "libx264",
      "-preset",
      "ultrafast",
      "-threads",
      "1",
      "-pix_fmt",
      "yuv420p",
      "-force_key_frames",
      `expr:gte(t,n_forced*${row.segment_seconds})`,
      "-c:a",
      "aac",
      "-t",
      String(remaining),
      "-f",
      "segment",
      "-segment_time",
      String(row.segment_seconds),
      "-reset_timestamps",
      "1",
      "-segment_format",
      "mp4",
      "-segment_format_options",
      "movflags=+faststart",
      "-segment_list",
      join(dir, "segments.csv"),
      "-segment_list_type",
      "csv",
      join(dir, "segment-%05d.partial.mp4"),
    ];
    const child = spawn(
      "python3",
      [
        fileURLToPath(new URL("./recorder-exec.py", import.meta.url)),
        String(process.pid),
        this.ffmpeg,
        ...args,
      ],
      { stdio: ["pipe", "ignore", "ignore"], shell: false },
    );
    const active = {
      row,
      child,
      done: false,
      code: null,
      exitSignal: null,
      signalled: false,
    };
    // Only the parent writes the fixed quit command; a closed pipe is handled by signal().
    child.stdin.on("error", () => {});
    child.once("error", () => {
      active.done = true;
      active.code = -1;
      active.processError = true;
    });
    child.once("close", (code, signal) => {
      active.done = true;
      active.code = code;
      active.exitSignal = signal;
    });
    this.activeJobs.set(this.key(row), active);
  }
  signal(active, reason = "interrupt") {
    // collect() awaits decoding: a child can exit before the deadline check resumes.
    // Do not assign controller intent to an already-exited process or replace a prior reason.
    if (
      active.signalled ||
      active.done ||
      active.child.exitCode != null ||
      active.child.signalCode != null
    )
      return false;
    active.signalled = true;
    if (reason === "deadline") {
      // This FFmpeg build can defer SIGINT until input EOF. Its quit command
      // promptly stops capture and finalises the segment without a nonzero exit.
      active.signalReason = reason;
      active.stopCommand = "quit";
      const written = (error) => {
        if (!error) active.stopCommandSent = true;
        else {
          active.stopCommandError = true;
          if (
            !active.done &&
            active.child.exitCode == null &&
            active.child.signalCode == null
          )
            active.signalSent = active.child.kill("SIGINT");
        }
      };
      try {
        active.child.stdin.write("q\n", written);
      } catch (error) {
        written(error);
      }
    } else {
      if (!active.child.kill("SIGINT")) return false;
      active.signalSent = true;
      active.signalReason = reason;
    }
    active.killTimer = setTimeout(() => {
      if (
        !active.done &&
        active.child.exitCode == null &&
        active.child.signalCode == null
      )
        active.forcedKill = active.child.kill("SIGKILL");
    }, 3000);
    return true;
  }
  async close() {
    if (this.closed) return;
    this.closed = true;
    clearInterval(this.timer);
    clearInterval(this.heartbeat);
    while (this.busy) await new Promise((r) => setTimeout(r, 20));
    await Promise.all(
      [...this.activeJobs.values()].map(async (a) => {
        if (!a.signalled) this.signal(a, "service-restart");
        while (!a.done) await new Promise((r) => setTimeout(r, 20));
        clearTimeout(a.killTimer);
        const row = this.db
          .prepare("SELECT * FROM recording_jobs WHERE workspace=? AND id=?")
          .get(a.row.workspace, a.row.id);
        await this.collect(row, true);
        this.gap(row, "service-restart");
        if (row.quotaExceeded)
          this.db
            .prepare(
              "UPDATE recording_jobs SET state='failed',error=? WHERE workspace=? AND id=?",
            )
            .run(row.quotaExceeded, row.workspace, row.id);
        else this.retry(row, "service_restart");
        await this.collect(row);
        this.release(row);
      }),
    );
    this.activeJobs.clear();
    this.db
      .prepare("DELETE FROM recording_job_leases WHERE owner=?")
      .run(this.owner);
    this.db
      .prepare("DELETE FROM recording_worker_processes WHERE owner=?")
      .run(this.owner);
  }
  async media(workspace, jobId, segmentId) {
    this.job(workspace, jobId);
    ident(segmentId);
    const row = this.db
      .prepare(
        "SELECT * FROM media_segments WHERE workspace=? AND job_id=? AND id=?",
      )
      .get(workspace, jobId, segmentId);
    if (!row) throw new Fault("media_not_found", 404);
    let path;
    try {
      path = realpathSync(join(this.root, row.relative_path));
    } catch {
      throw new Fault("media_unavailable", 410);
    }
    if (
      !path.startsWith(this.root + sep) ||
      !statSync(path).isFile() ||
      statSync(path).size !== row.bytes ||
      (await hashFile(path)) !== row.sha256
    )
      throw new Fault("media_integrity_failed", 409);
    return { path, bytes: row.bytes, sha256: row.sha256 };
  }
}

export async function hashFile(path) {
  const hash = createHash("sha256");
  for await (const chunk of createReadStream(path)) hash.update(chunk);
  return hash.digest("hex");
}

function processToken(pid) {
  try {
    // /proc stat field22 is process start time. Commands may contain spaces/parentheses.
    const stat = readFileSync(`/proc/${pid}/stat`, "utf8");
    const fields = stat.slice(stat.lastIndexOf(")") + 2).split(" ");
    return fields[0] === "Z" ? null : fields[19];
  } catch {
    return null;
  }
}
