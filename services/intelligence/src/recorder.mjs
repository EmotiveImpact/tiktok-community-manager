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
`;

export class Recorder {
  constructor({ store, mediaRoot, ffmpeg, sources = [], intervalMs = 200 }) {
    this.store = store;
    this.db = store.db;
    this.root = resolve(mediaRoot);
    this.ffmpeg = resolve(ffmpeg);
    mkdirSync(this.root, { recursive: true, mode: 0o700 });
    this.root = realpathSync(this.root);
    this.owner = randomUUID();
    this.intervalMs = intervalMs;
    this.active = null;
    this.closed = false;
    this.recovered = false;
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
        row.state === "recording" && this.active?.row.id !== id
          ? "recovering"
          : row.state,
      attempts: row.attempts,
      createdAtMs: row.created_at,
      deadlineMs: row.deadline,
      maxDurationSeconds: row.max_seconds,
      segmentSeconds: row.segment_seconds,
      stopRequested: !!row.stop_requested,
      error: row.error,
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
  list(workspace, { sessionId, limit = 100 } = {}) {
    ident(workspace);
    limit = pageLimit(limit);
    if (sessionId) this.store.session(workspace, sessionId);
    const rows = sessionId
      ? this.db
          .prepare(
            "SELECT id FROM recording_jobs WHERE workspace=? AND session_id=? ORDER BY created_at DESC LIMIT ?",
          )
          .all(workspace, sessionId, limit)
      : this.db
          .prepare(
            "SELECT id FROM recording_jobs WHERE workspace=? ORDER BY created_at DESC LIMIT ?",
          )
          .all(workspace, limit);
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
      max > 3600 ||
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
      const pending = this.db
        .prepare(
          "SELECT count(*) AS n FROM recording_jobs WHERE state NOT IN ('completed','stopped','failed')",
        )
        .get().n;
      if (pending >= 100) throw new Fault("recording_capacity", 409);
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
  lease() {
    return this.store.transaction(() => {
      const lease = this.db
        .prepare("SELECT * FROM recorder_lease WHERE id=1")
        .get();
      if (lease && lease.owner !== this.owner && lease.expires_at > Date.now())
        return false;
      this.db
        .prepare(
          "INSERT INTO recorder_lease VALUES(1,?,?) ON CONFLICT(id) DO UPDATE SET owner=excluded.owner,expires_at=excluded.expires_at",
        )
        .run(this.owner, Date.now() + 10_000);
      return true;
    });
  }
  async recover() {
    const rows = this.db
      .prepare(
        "SELECT * FROM recording_jobs WHERE state IN ('starting','recording','stopping')",
      )
      .all();
    for (const row of rows) {
      await this.collect(row, true);
      this.gap(row, "worker-interrupted");
      this.retry(row, "worker_interrupted");
    }
    this.recovered = true;
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
    if (this.timer) return;
    const fail = () => {
      this.workerError = "worker_failure";
      if (this.active) {
        this.signal(this.active);
        this.db
          .prepare(
            "UPDATE recording_jobs SET error='worker_failure' WHERE workspace=? AND id=?",
          )
          .run(this.active.row.workspace, this.active.row.id);
      }
    };
    this.timer = setInterval(() => this.tick().catch(fail), this.intervalMs);
    this.heartbeat = setInterval(() => {
      if (!this.closed)
        this.db
          .prepare("UPDATE recorder_lease SET expires_at=? WHERE owner=?")
          .run(Date.now() + 10_000, this.owner);
    }, 1000);
    this.tick().catch(fail);
  }
  async tick() {
    if (this.busy || this.closed) return;
    this.busy = true;
    try {
      if (!this.lease()) return;
      if (!this.recovered) await this.recover();
      if (this.active) {
        const a = this.active;
        const row = this.db
          .prepare("SELECT * FROM recording_jobs WHERE workspace=? AND id=?")
          .get(a.row.workspace, a.row.id);
        await this.collect(row);
        if ((row.stop_requested || Date.now() >= row.deadline) && !a.signalled)
          this.signal(a);
        if (a.done) {
          clearTimeout(a.killTimer);
          await this.collect(row, true);
          const segments = this.job(row.workspace, row.id).segments;
          if (row.stop_requested)
            this.db
              .prepare(
                "UPDATE recording_jobs SET state='stopped',error=NULL WHERE workspace=? AND id=?",
              )
              .run(row.workspace, row.id);
          else if (
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
          this.active = null;
        }
        return;
      }
      const row = this.db
        .prepare(
          "SELECT * FROM recording_jobs WHERE state IN ('queued','retrying') AND stop_requested=0 AND next_retry<=? ORDER BY created_at,id LIMIT 1",
        )
        .get(Date.now());
      if (!row) return;
      if (Date.now() >= row.deadline || row.attempts >= 3) {
        this.db
          .prepare(
            "UPDATE recording_jobs SET state='failed',error='capture_deadline_exceeded' WHERE workspace=? AND id=?",
          )
          .run(row.workspace, row.id);
        this.gap(row, "capture-deadline-exceeded");
        return;
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
        return;
      }
      row.attempts++;
      row.attempt_started = Date.now();
      this.db
        .prepare(
          "UPDATE recording_jobs SET state='starting',attempts=?,attempt_started=? WHERE workspace=? AND id=?",
        )
        .run(row.attempts, row.attempt_started, row.workspace, row.id);
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
        "-nostdin",
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
        { stdio: ["ignore", "ignore", "ignore"], shell: false },
      );
      const active = { row, child, done: false, code: null, signalled: false };
      child.once("error", () => {
        active.done = true;
        active.code = -1;
      });
      child.once("close", (code) => {
        active.done = true;
        active.code = code;
      });
      this.active = active;
    } finally {
      this.busy = false;
    }
  }
  signal(active) {
    active.signalled = true;
    active.child.kill("SIGINT");
    active.killTimer = setTimeout(() => {
      if (!active.done) active.child.kill("SIGKILL");
    }, 3000);
  }
  async close() {
    this.closed = true;
    clearInterval(this.timer);
    clearInterval(this.heartbeat);
    while (this.busy) await new Promise((r) => setTimeout(r, 20));
    if (this.active) {
      const a = this.active;
      this.signal(a);
      while (!a.done) await new Promise((r) => setTimeout(r, 20));
      clearTimeout(a.killTimer);
      const row = this.db
        .prepare("SELECT * FROM recording_jobs WHERE workspace=? AND id=?")
        .get(a.row.workspace, a.row.id);
      await this.collect(row, true);
      this.gap(row, "service-restart");
      this.retry(row, "service_restart");
      this.active = null;
    }
    this.db.prepare("DELETE FROM recorder_lease WHERE owner=?").run(this.owner);
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
