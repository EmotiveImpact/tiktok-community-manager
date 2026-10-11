import { randomUUID, createHash } from "node:crypto";
import {
  readFileSync,
  realpathSync,
  existsSync,
  openSync,
  closeSync,
  writeFileSync,
  fsyncSync,
  renameSync,
  rmSync,
  constants,
} from "node:fs";
import { resolve, dirname, basename, sep } from "node:path";
import {
  Fault,
  canonical,
  digest,
  ident,
  object,
  pageLimit,
} from "./validation.mjs";
import { ARCHIVE_USAGE_LIMITS, archiveStorageUsage } from "./archive-usage.mjs";

const hash = (bytes) => createHash("sha256").update(bytes).digest("hex");
const schema = `
CREATE TABLE IF NOT EXISTS media_archives(
 workspace TEXT NOT NULL,id TEXT NOT NULL,recording_job_id TEXT NOT NULL,state TEXT NOT NULL,
 created_at INTEGER NOT NULL,deadline INTEGER NOT NULL,max_seconds INTEGER NOT NULL,max_attempts INTEGER NOT NULL,
 attempts INTEGER NOT NULL DEFAULT 0,next_retry INTEGER NOT NULL DEFAULT 0,error TEXT,
 manifest TEXT NOT NULL,manifest_sha256 TEXT NOT NULL,object_key TEXT NOT NULL,
 restore_state TEXT NOT NULL DEFAULT 'not-requested',restore_requested_at INTEGER,restore_deadline INTEGER,
 restore_attempts INTEGER NOT NULL DEFAULT 0,restore_next_retry INTEGER NOT NULL DEFAULT 0,restore_error TEXT,
 PRIMARY KEY(workspace,id),FOREIGN KEY(workspace,recording_job_id) REFERENCES recording_jobs(workspace,id));
CREATE TABLE IF NOT EXISTS media_archive_segments(
 workspace TEXT NOT NULL,archive_id TEXT NOT NULL,segment_id TEXT NOT NULL,state TEXT NOT NULL DEFAULT 'pending',
 verified_at INTEGER,restored_at INTEGER,PRIMARY KEY(workspace,archive_id,segment_id),
 FOREIGN KEY(workspace,archive_id) REFERENCES media_archives(workspace,id));
CREATE TABLE IF NOT EXISTS media_archive_leases(
 workspace TEXT NOT NULL,archive_id TEXT NOT NULL,owner TEXT NOT NULL,expires_at INTEGER NOT NULL,
 PRIMARY KEY(workspace,archive_id),FOREIGN KEY(workspace,archive_id) REFERENCES media_archives(workspace,id));
CREATE TABLE IF NOT EXISTS media_archive_workers(owner TEXT PRIMARY KEY,pid INTEGER NOT NULL,start_token TEXT NOT NULL);
`;

/** Explicit verified-media outbox. Storage is trusted runtime configuration, never API input. */
export class MediaArchive {
  constructor({
    store,
    recorder,
    storage,
    intervalMs = 500,
    maxConcurrent = 2,
    maxSegmentBytes = 64 * 1024 ** 2,
    maxArchiveBytes = 10 * 1024 ** 3,
    now = Date.now,
  }) {
    if (
      !recorder ||
      !storage ||
      typeof storage.put !== "function" ||
      typeof storage.get !== "function"
    )
      throw new Fault("media_archive_configuration_required");
    if (
      !Number.isInteger(maxConcurrent) ||
      maxConcurrent < 1 ||
      maxConcurrent > 4 ||
      !Number.isSafeInteger(maxSegmentBytes) ||
      maxSegmentBytes < 1024 ||
      maxSegmentBytes > 256 * 1024 ** 2 ||
      !Number.isSafeInteger(maxArchiveBytes) ||
      maxArchiveBytes < maxSegmentBytes
    )
      throw new Fault("invalid_media_archive_bounds");
    Object.assign(this, {
      store,
      db: store.db,
      recorder,
      storage,
      intervalMs,
      maxConcurrent,
      maxSegmentBytes,
      maxArchiveBytes,
      now,
    });
    this.owner = randomUUID();
    this.closed = false;
    this.busy = false;
    this.active = new Set();
    this.db.exec(schema);
    this.db
      .prepare("INSERT INTO media_archive_workers VALUES(?,?,?)")
      .run(this.owner, process.pid, processToken(process.pid));
  }
  key(row) {
    return row.workspace + ":" + row.id;
  }
  row(workspace, id) {
    ident(workspace);
    ident(id);
    const row = this.db
      .prepare("SELECT * FROM media_archives WHERE workspace=? AND id=?")
      .get(workspace, id);
    if (!row) throw new Fault("media_archive_not_found", 404);
    return row;
  }
  job(workspace, id) {
    const row = this.row(workspace, id),
      manifest = JSON.parse(row.manifest);
    const receipts = this.db
      .prepare(
        "SELECT * FROM media_archive_segments WHERE workspace=? AND archive_id=? ORDER BY segment_id",
      )
      .all(workspace, id);
    return {
      id: row.id,
      recordingJobId: row.recording_job_id,
      state: row.state,
      createdAtMs: row.created_at,
      deadlineMs: row.deadline,
      attempts: row.attempts,
      maxAttempts: row.max_attempts,
      maxDurationSeconds: row.max_seconds,
      error: row.error,
      manifestSha256: row.manifest_sha256,
      snapshotAtMs: manifest.snapshotAtMs,
      recordingStateAtSnapshot: manifest.recordingStateAtSnapshot,
      coverage: "verified-segments-at-explicit-snapshot",
      totalBytes: manifest.totalBytes,
      segments: manifest.segments.map((segment) => {
        const receipt = receipts.find((r) => r.segment_id === segment.id);
        const { objectKey, ...value } = segment;
        return {
          ...value,
          state: receipt.state,
          verifiedAtMs: receipt.verified_at,
          restoredAtMs: receipt.restored_at,
        };
      }),
      restore: {
        state: row.restore_state,
        requestedAtMs: row.restore_requested_at,
        deadlineMs: row.restore_deadline,
        attempts: row.restore_attempts,
        error: row.restore_error,
      },
      limits: {
        maxConcurrent: this.maxConcurrent,
        maxSegmentBytes: this.maxSegmentBytes,
        maxArchiveBytes: this.maxArchiveBytes,
        maxWorkspaceArchives: ARCHIVE_USAGE_LIMITS.maxArchives,
        maxWorkspaceObjectKeys: ARCHIVE_USAGE_LIMITS.maxObjectKeys,
      },
      storage: {
        configured: true,
        publicUrls: false,
        verifiedReadback: row.state === "completed",
      },
    };
  }
  list(workspace, { limit = 100 } = {}) {
    ident(workspace);
    limit = pageLimit(limit);
    return this.db
      .prepare(
        "SELECT id FROM media_archives WHERE workspace=? ORDER BY created_at DESC,id LIMIT ?",
      )
      .all(workspace, limit)
      .map((row) => this.job(workspace, row.id));
  }
  create(workspace, value) {
    object(value, [
      "id",
      "recordingJobId",
      "maxDurationSeconds",
      "maxAttempts",
    ]);
    const recordingJobId = ident(value.recordingJobId),
      id = value.id == null ? randomUUID() : ident(value.id),
      seconds = value.maxDurationSeconds ?? 120,
      attempts = value.maxAttempts ?? 3;
    if (
      !Number.isInteger(seconds) ||
      seconds < 10 ||
      seconds > 600 ||
      !Number.isInteger(attempts) ||
      attempts < 1 ||
      attempts > 3
    )
      throw new Fault("invalid_media_archive_bounds");
    return this.store.transaction(() => {
      const old = this.db
        .prepare("SELECT * FROM media_archives WHERE workspace=? AND id=?")
        .get(workspace, id);
      if (old) {
        if (
          old.recording_job_id !== recordingJobId ||
          old.max_seconds !== seconds ||
          old.max_attempts !== attempts
        )
          throw new Fault("media_archive_identity_conflict", 409);
        return this.job(workspace, id);
      }
      const recording = this.recorder.job(workspace, recordingJobId);
      if (!recording.segments.length)
        throw new Fault("verified_media_required", 409);
      if (
        recording.segments.length > 2000 ||
        recording.segments.some((s) => s.bytes > this.maxSegmentBytes) ||
        recording.segments.reduce((n, s) => n + s.bytes, 0) >
          this.maxArchiveBytes
      )
        throw new Fault("media_archive_capacity", 409);
      const pending = this.db
        .prepare(
          "SELECT count(*) AS n FROM media_archives WHERE state NOT IN ('completed','failed') OR restore_state IN ('queued','restoring','retrying')",
        )
        .get().n;
      const own = this.db
        .prepare(
          "SELECT count(*) AS n FROM media_archives WHERE workspace=? AND (state NOT IN ('completed','failed') OR restore_state IN ('queued','restoring','retrying'))",
        )
        .get(workspace).n;
      if (pending >= 100 || own >= 20)
        throw new Fault("media_archive_capacity", 409);
      const now = this.now(),
        manifest = {
          schemaVersion: 1,
          workspace,
          archiveId: id,
          recordingJobId,
          sessionId: recording.sessionId,
          snapshotAtMs: now,
          recordingStateAtSnapshot: recording.state,
          coverage: "verified-segments-at-explicit-snapshot",
          totalBytes: recording.segments.reduce((n, s) => n + s.bytes, 0),
          segments: recording.segments.map((s) => ({
            ...s,
            objectKey: `recordings/${recordingJobId}/${s.id}-${s.sha256}.mp4`,
          })),
        };
      const encoded = canonical(manifest);
      if (Buffer.byteLength(encoded) > 1024 ** 2)
        throw new Fault("media_archive_capacity", 409);
      const objectKey = `archives/${id}/manifest.json`;
      const reservation = archiveStorageUsage(this.db, workspace, {
        encoded,
        objectKey,
        segments: manifest.segments,
      });
      // The inserted snapshot reserves all uncertain objects before any worker can upload.
      this.admission?.(workspace, {
        pendingJobs: 1,
        storageBytes: reservation.additionalStorageBytes,
      });
      this.db
        .prepare(
          "INSERT INTO media_archives(workspace,id,recording_job_id,state,created_at,deadline,max_seconds,max_attempts,manifest,manifest_sha256,object_key) VALUES(?,?,?,'queued',?,?,?,?,?,?,?)",
        )
        .run(
          workspace,
          id,
          recordingJobId,
          now,
          now + seconds * 1000,
          seconds,
          attempts,
          encoded,
          digest(encoded),
          objectKey,
        );
      for (const segment of manifest.segments)
        this.db
          .prepare(
            "INSERT INTO media_archive_segments(workspace,archive_id,segment_id) VALUES(?,?,?)",
          )
          .run(workspace, id, segment.id);
      return this.job(workspace, id);
    });
  }
  restore(workspace, id) {
    return this.store.transaction(() => {
      const row = this.row(workspace, id);
      if (row.state !== "completed")
        throw new Fault("media_archive_not_completed", 409);
      if (["queued", "restoring", "retrying"].includes(row.restore_state))
        return this.job(workspace, id);
      this.admission?.(workspace, { pendingJobs: 1 });
      this.db
        .prepare(
          "UPDATE media_archives SET restore_state='queued',restore_requested_at=?,restore_deadline=?,restore_attempts=0,restore_next_retry=0,restore_error=NULL WHERE workspace=? AND id=?",
        )
        .run(this.now(), this.now() + row.max_seconds * 1000, workspace, id);
      return this.job(workspace, id);
    });
  }
  ownerAlive(owner) {
    const row = this.db
      .prepare("SELECT * FROM media_archive_workers WHERE owner=?")
      .get(owner);
    return !!row && processToken(row.pid) === row.start_token;
  }
  claim(row) {
    return this.store.transaction(() => {
      const held = this.db
        .prepare(
          "SELECT * FROM media_archive_leases WHERE workspace=? AND archive_id=?",
        )
        .get(row.workspace, row.id);
      if (
        held &&
        held.owner !== this.owner &&
        (held.expires_at > this.now() || this.ownerAlive(held.owner))
      )
        return false;
      const live = this.db
        .prepare("SELECT * FROM media_archive_leases")
        .all()
        .filter((l) => l.expires_at > this.now() || this.ownerAlive(l.owner));
      if (
        (!held || held.owner !== this.owner) &&
        live.length >= this.maxConcurrent
      )
        return false;
      this.db
        .prepare(
          "INSERT INTO media_archive_leases VALUES(?,?,?,?) ON CONFLICT(workspace,archive_id) DO UPDATE SET owner=excluded.owner,expires_at=excluded.expires_at",
        )
        .run(row.workspace, row.id, this.owner, this.now() + 30_000);
      return true;
    });
  }
  release(row) {
    this.db
      .prepare(
        "DELETE FROM media_archive_leases WHERE workspace=? AND archive_id=? AND owner=?",
      )
      .run(row.workspace, row.id, this.owner);
  }
  current(row, restore = false) {
    if (this.closed) throw new Fault("media_archive_worker_closed", 503);
    const lease = this.db
      .prepare(
        "SELECT owner FROM media_archive_leases WHERE workspace=? AND archive_id=?",
      )
      .get(row.workspace, row.id);
    if (lease?.owner !== this.owner)
      throw new Fault("media_archive_lease_lost", 409);
    if (this.now() >= (restore ? row.restore_deadline : row.deadline))
      throw new Fault("media_archive_deadline_exceeded", 408);
  }
  checked(bytes, segment) {
    if (
      !Buffer.isBuffer(bytes) ||
      bytes.length !== segment.bytes ||
      bytes.length > this.maxSegmentBytes ||
      hash(bytes) !== segment.sha256
    )
      throw new Fault("archive_object_integrity_failed", 409);
    return bytes;
  }
  async operation(row, restoring, method, ...args) {
    this.current(row, restoring);
    let timer;
    try {
      return await Promise.race([
        Promise.resolve().then(() =>
          this.storage[method](row.workspace, ...args),
        ),
        new Promise((_, reject) => {
          timer = setTimeout(
            () => reject(new Fault("object_storage_timeout", 504)),
            Math.min(
              15_000,
              (restoring ? row.restore_deadline : row.deadline) - this.now(),
            ),
          );
        }),
      ]);
    } finally {
      clearTimeout(timer);
    }
  }
  manifest(row) {
    const encoded = Buffer.from(row.manifest);
    if (hash(encoded) !== row.manifest_sha256)
      throw new Fault("archive_manifest_integrity_failed", 409);
    return JSON.parse(row.manifest);
  }
  async export(row) {
    const manifest = this.manifest(row);
    for (const segment of manifest.segments) {
      this.current(row);
      const receipt = this.db
        .prepare(
          "SELECT state FROM media_archive_segments WHERE workspace=? AND archive_id=? AND segment_id=?",
        )
        .get(row.workspace, row.id, segment.id);
      if (receipt.state === "verified") {
        this.checked(
          await this.operation(row, false, "get", segment.objectKey, {
            maxBytes: segment.bytes,
          }),
          segment,
        );
        continue;
      }
      const local = await this.recorder.media(
        row.workspace,
        row.recording_job_id,
        segment.id,
      );
      const bytes = this.checked(readFileSync(local.path), segment);
      this.current(row);
      await this.operation(row, false, "put", segment.objectKey, bytes);
      this.current(row);
      this.checked(
        await this.operation(row, false, "get", segment.objectKey, {
          maxBytes: segment.bytes,
        }),
        segment,
      );
      this.current(row);
      this.db
        .prepare(
          "UPDATE media_archive_segments SET state='verified',verified_at=? WHERE workspace=? AND archive_id=? AND segment_id=?",
        )
        .run(this.now(), row.workspace, row.id, segment.id);
    }
    this.current(row);
    await this.operation(
      row,
      false,
      "put",
      row.object_key,
      Buffer.from(row.manifest),
    );
    this.current(row);
    const stored = await this.operation(row, false, "get", row.object_key, {
      maxBytes: Buffer.byteLength(row.manifest),
    });
    if (
      !Buffer.isBuffer(stored) ||
      stored.length !== Buffer.byteLength(row.manifest) ||
      hash(stored) !== row.manifest_sha256
    )
      throw new Fault("archive_manifest_integrity_failed", 409);
    this.current(row);
    this.db
      .prepare(
        "UPDATE media_archives SET state='completed',error=NULL WHERE workspace=? AND id=?",
      )
      .run(row.workspace, row.id);
  }
  target(row, segment) {
    const original = this.db
      .prepare(
        "SELECT * FROM media_segments WHERE workspace=? AND job_id=? AND id=?",
      )
      .get(row.workspace, row.recording_job_id, segment.id);
    if (!original) throw new Fault("archived_media_metadata_missing", 410);
    if (
      original.sha256 !== segment.sha256 ||
      original.bytes !== segment.bytes ||
      original.attempt !== segment.attempt ||
      original.started_at !== segment.startedAtMs ||
      original.duration_ms !== segment.durationMs
    )
      throw new Fault("archive_media_metadata_conflict", 409);
    const directory = this.recorder.directory(
        row.workspace,
        row.recording_job_id,
        original.attempt,
      ),
      target = resolve(this.recorder.root, original.relative_path);
    if (
      !target.startsWith(this.recorder.root + sep) ||
      realpathSync(dirname(target)) !== directory ||
      !/^segment-\d{5}\.mp4$/.test(basename(target))
    )
      throw new Fault("unsafe_archive_restore_path", 409);
    return target;
  }
  async recover(row) {
    const manifest = this.manifest(row);
    this.current(row, true);
    const encoded = await this.operation(row, true, "get", row.object_key, {
      maxBytes: Buffer.byteLength(row.manifest),
    });
    if (
      !Buffer.isBuffer(encoded) ||
      encoded.length !== Buffer.byteLength(row.manifest) ||
      hash(encoded) !== row.manifest_sha256
    )
      throw new Fault("archive_manifest_integrity_failed", 409);
    // Preflight all original metadata before making an explicit restore concrete.
    for (const segment of manifest.segments) this.target(row, segment);
    for (const segment of manifest.segments) {
      this.current(row, true);
      const bytes = this.checked(
        await this.operation(row, true, "get", segment.objectKey, {
          maxBytes: segment.bytes,
        }),
        segment,
      );
      this.current(row, true);
      const target = this.target(row, segment);
      if (existsSync(target)) {
        const existing = realpathSync(target);
        if (existing !== target)
          throw new Fault("unsafe_archive_restore_path", 409);
        try {
          this.checked(readFileSync(target), segment);
          this.markRestored(row, segment);
          continue;
        } catch (error) {
          if (error.code !== "archive_object_integrity_failed") throw error;
        }
      }
      const temp = target + ".restore-" + randomUUID();
      const fd = openSync(
        temp,
        constants.O_CREAT |
          constants.O_EXCL |
          constants.O_WRONLY |
          constants.O_NOFOLLOW,
        0o600,
      );
      try {
        writeFileSync(fd, bytes);
        fsyncSync(fd);
        closeSync(fd);
        this.current(row, true);
        renameSync(temp, target);
        const directoryFd = openSync(
          dirname(target),
          constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW,
        );
        try {
          fsyncSync(directoryFd);
        } finally {
          closeSync(directoryFd);
        }
      } catch (error) {
        try {
          closeSync(fd);
        } catch {}
        rmSync(temp, { force: true });
        throw error;
      }
      await this.recorder.media(
        row.workspace,
        row.recording_job_id,
        segment.id,
      );
      this.markRestored(row, segment);
    }
    this.current(row, true);
    this.db
      .prepare(
        "UPDATE media_archives SET restore_state='completed',restore_error=NULL WHERE workspace=? AND id=?",
      )
      .run(row.workspace, row.id);
  }
  markRestored(row, segment) {
    this.db
      .prepare(
        "UPDATE media_archive_segments SET restored_at=? WHERE workspace=? AND archive_id=? AND segment_id=?",
      )
      .run(this.now(), row.workspace, row.id, segment.id);
  }
  async work(row) {
    const restoring =
      row.state === "completed" &&
      ["queued", "restoring", "retrying"].includes(row.restore_state);
    const attempts = (restoring ? row.restore_attempts : row.attempts) + 1;
    try {
      if (
        attempts > row.max_attempts ||
        this.now() >= (restoring ? row.restore_deadline : row.deadline)
      )
        throw new Fault("media_archive_deadline_exceeded", 408);
      if (restoring) {
        row.restore_attempts = attempts;
        this.db
          .prepare(
            "UPDATE media_archives SET restore_state='restoring',restore_attempts=? WHERE workspace=? AND id=?",
          )
          .run(attempts, row.workspace, row.id);
        await this.recover(row);
      } else {
        row.attempts = attempts;
        this.db
          .prepare(
            "UPDATE media_archives SET state='uploading',attempts=? WHERE workspace=? AND id=?",
          )
          .run(attempts, row.workspace, row.id);
        await this.export(row);
      }
    } catch (error) {
      const code =
        error instanceof Fault
          ? error.code
          : [
                "object_authentication_failed",
                "invalid_encrypted_object",
                "object_too_large",
              ].includes(error?.message)
            ? "archive_object_integrity_failed"
            : "object_storage_unavailable";
      // Shutdown preserves a retry receipt; an incomplete object is never advertised as archived.
      const state =
        attempts >= row.max_attempts ||
        this.now() >= (restoring ? row.restore_deadline : row.deadline)
          ? "failed"
          : "retrying";
      if (restoring)
        this.db
          .prepare(
            "UPDATE media_archives SET restore_state=?,restore_error=?,restore_next_retry=? WHERE workspace=? AND id=?",
          )
          .run(
            state,
            code,
            this.now() + Math.min(5000, attempts * 500),
            row.workspace,
            row.id,
          );
      else
        this.db
          .prepare(
            "UPDATE media_archives SET state=?,error=?,next_retry=? WHERE workspace=? AND id=?",
          )
          .run(
            state,
            code,
            this.now() + Math.min(5000, attempts * 500),
            row.workspace,
            row.id,
          );
    } finally {
      this.active.delete(this.key(row));
      this.release(row);
    }
  }
  async tick() {
    if (this.busy || this.closed) return;
    this.busy = true;
    try {
      const rows = this.db
        .prepare(
          "SELECT * FROM media_archives WHERE (state IN ('queued','uploading','retrying') AND next_retry<=?) OR (state='completed' AND restore_state IN ('queued','restoring','retrying') AND restore_next_retry<=?) ORDER BY created_at,id LIMIT 100",
        )
        .all(this.now(), this.now());
      const claimed = [];
      for (const row of rows)
        if (claimed.length < this.maxConcurrent && this.claim(row)) {
          claimed.push(row);
          this.active.add(this.key(row));
        }
      await Promise.all(claimed.map((row) => this.work(row)));
    } finally {
      this.busy = false;
    }
  }
  start() {
    if (this.timer || this.closed) return;
    this.timer = setInterval(() => {
      void this.tick().catch(() => {
        this.workerError = "media_archive_worker_failed";
      });
    }, this.intervalMs);
    this.heartbeat = setInterval(() => {
      if (!this.closed)
        this.db
          .prepare("UPDATE media_archive_leases SET expires_at=? WHERE owner=?")
          .run(this.now() + 30_000, this.owner);
    }, 1000);
    void this.tick().catch(() => {
      this.workerError = "media_archive_worker_failed";
    });
  }
  async close() {
    if (this.closed) return;
    this.closed = true;
    clearInterval(this.timer);
    clearInterval(this.heartbeat);
    while (this.busy) await new Promise((r) => setTimeout(r, 20));
    this.db
      .prepare("DELETE FROM media_archive_leases WHERE owner=?")
      .run(this.owner);
    this.db
      .prepare("DELETE FROM media_archive_workers WHERE owner=?")
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
