import { spawn } from "node:child_process";
import { accessSync, constants } from "node:fs";
import { isAbsolute, resolve } from "node:path";
import { randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";
import {
  Fault,
  ident,
  object,
  pageLimit,
  text,
  digest,
} from "./validation.mjs";

const terminal = ["completed", "stopped", "failed"];
const schema = `
CREATE TABLE IF NOT EXISTS speech_jobs(
 workspace TEXT NOT NULL,id TEXT NOT NULL,session_id TEXT NOT NULL,recording_job_id TEXT NOT NULL,
 engine_id TEXT NOT NULL,state TEXT NOT NULL,created_at INTEGER NOT NULL,deadline INTEGER NOT NULL,
 max_seconds INTEGER NOT NULL,stop_requested INTEGER NOT NULL DEFAULT 0,error TEXT,
 PRIMARY KEY(workspace,id),FOREIGN KEY(workspace,session_id) REFERENCES sessions(workspace,id));
CREATE TABLE IF NOT EXISTS speech_inputs(
 workspace TEXT NOT NULL,job_id TEXT NOT NULL,segment_id TEXT NOT NULL,ordinal INTEGER NOT NULL,
 sha256 TEXT NOT NULL,started_at INTEGER NOT NULL,duration_ms INTEGER NOT NULL,
 state TEXT NOT NULL DEFAULT 'queued',attempts INTEGER NOT NULL DEFAULT 0,next_retry INTEGER NOT NULL DEFAULT 0,
 result TEXT,error TEXT,PRIMARY KEY(workspace,job_id,segment_id),
 FOREIGN KEY(workspace,job_id) REFERENCES speech_jobs(workspace,id));
CREATE TABLE IF NOT EXISTS speech_lease(id INTEGER PRIMARY KEY CHECK(id=1),owner TEXT NOT NULL,expires_at INTEGER NOT NULL);
`;

// This is a trusted service-side adapter contract. Recognised words are data,
// never executable input, prompts, account assertions or provider timestamps.
export function validateSpeechResult(value, durationMs, recognizer) {
  object(value, ["schemaVersion", "engine", "segments"]);
  object(value.engine, ["id", "version", "language", "diarization"]);
  if (
    value.schemaVersion !== 1 ||
    value.engine.id !== recognizer.id ||
    typeof value.engine.diarization !== "boolean" ||
    value.engine.diarization !== recognizer.diarization
  )
    throw new Fault("speech_engine_mismatch");
  text(value.engine.version, 100);
  text(value.engine.language, 64);
  if (recognizer.language && value.engine.language !== recognizer.language)
    throw new Fault("speech_language_mismatch");
  if (!Array.isArray(value.segments) || value.segments.length > 200)
    throw new Fault("invalid_speech_segments");
  let previousStart = -1;
  const segments = value.segments.map((segment) => {
    object(segment, ["startMs", "endMs", "text", "speakerId", "confidence"]);
    if (
      !Number.isInteger(segment.startMs) ||
      !Number.isInteger(segment.endMs) ||
      segment.startMs < 0 ||
      segment.endMs <= segment.startMs ||
      segment.endMs > durationMs ||
      segment.startMs < previousStart
    )
      throw new Fault("invalid_speech_range");
    previousStart = segment.startMs;
    text(segment.text, 8000);
    const speakerId =
      segment.speakerId == null ? null : ident(segment.speakerId);
    if (!recognizer.diarization && speakerId !== null)
      throw new Fault("diarization_unavailable");
    const confidence = segment.confidence ?? null;
    if (
      confidence !== null &&
      (typeof confidence !== "number" ||
        !Number.isFinite(confidence) ||
        confidence < 0 ||
        confidence > 1)
    )
      throw new Fault("invalid_speech_confidence");
    return { ...segment, speakerId, confidence };
  });
  return { schemaVersion: 1, engine: { ...value.engine }, segments };
}

export class SpeechWorker {
  constructor({
    store,
    recorder,
    recognizer,
    intervalMs = 200,
    leaseMs = 10_000,
  }) {
    if (!store || !recorder) throw new Fault("speech_recorder_required");
    object(recognizer, ["command", "args", "id", "language", "diarization"]);
    ident(recognizer.id);
    if (
      !isAbsolute(recognizer.command) ||
      !Array.isArray(recognizer.args ?? []) ||
      (recognizer.args ?? []).some(
        (arg) => typeof arg !== "string" || arg.includes("\0"),
      )
    )
      throw new Fault("invalid_speech_command");
    accessSync(recognizer.command, constants.X_OK);
    if (recognizer.language !== undefined) text(recognizer.language, 64);
    if (typeof recognizer.diarization !== "boolean")
      throw new Fault("invalid_speech_diarization");
    if (!Number.isInteger(leaseMs) || leaseMs < 500 || leaseMs > 60_000)
      throw new Fault("invalid_speech_lease");
    if (process.platform !== "linux") throw new Fault("linux_speech_required");
    this.store = store;
    this.db = store.db;
    this.recorder = recorder;
    this.recognizer = {
      ...recognizer,
      command: resolve(recognizer.command),
      args: [...(recognizer.args ?? [])],
    };
    this.owner = randomUUID();
    this.intervalMs = intervalMs;
    this.leaseMs = leaseMs;
    this.active = null;
    this.closed = false;
    this.busy = false;
    this.recovered = false;
    this.db.exec(schema);
  }
  capabilities() {
    return {
      enabled: true,
      engine: this.recognizer.id,
      language: this.recognizer.language ?? "engine-configured",
      independentTranscription: true,
      diarization: this.recognizer.diarization,
      speakerIdentity: false,
      maxConcurrentJobs: 1,
      maxAttemptsPerSegment: 3,
      timing: "verified-media-offset",
      limitations: this.recognizer.diarization
        ? [
            "Anonymous engine speaker tracks are not account identities; engine quality requires measured evaluation.",
          ]
        : [
            "Diarisation unavailable: transcripts retain an anonymous unseparated audio track, not detected speakers.",
          ],
    };
  }
  job(workspace, id) {
    ident(workspace);
    ident(id);
    const row = this.db
      .prepare("SELECT * FROM speech_jobs WHERE workspace=? AND id=?")
      .get(workspace, id);
    if (!row) throw new Fault("speech_job_not_found", 404);
    const segments = this.db
      .prepare(
        "SELECT * FROM speech_inputs WHERE workspace=? AND job_id=? ORDER BY ordinal",
      )
      .all(workspace, id)
      .map((input) => ({
        id: input.segment_id,
        sha256: input.sha256,
        startedAtMs: input.started_at,
        durationMs: input.duration_ms,
        state: input.state,
        attempts: input.attempts,
        error: input.error,
        transcriptCount: input.result
          ? JSON.parse(input.result).segments.length
          : 0,
      }));
    return {
      id: row.id,
      sessionId: row.session_id,
      recordingJobId: row.recording_job_id,
      engine: row.engine_id,
      state:
        row.state === "transcribing" &&
        (this.active?.job.id !== id || this.active?.job.workspace !== workspace)
          ? "recovering"
          : row.state,
      createdAtMs: row.created_at,
      deadlineMs: row.deadline,
      maxDurationSeconds: row.max_seconds,
      stopRequested: !!row.stop_requested,
      error: row.error,
      segments,
      completedSegments: segments.filter(
        (segment) => segment.state === "completed",
      ).length,
      transcriptCount: segments
        .filter((segment) => segment.state === "completed")
        .reduce((n, segment) => n + segment.transcriptCount, 0),
      timestampBasis: "verified-media-offset",
      diarization: this.recognizer.diarization,
    };
  }
  list(workspace, { sessionId, limit = 100 } = {}) {
    ident(workspace);
    limit = pageLimit(limit);
    if (sessionId) this.store.session(workspace, sessionId);
    const rows = sessionId
      ? this.db
          .prepare(
            "SELECT id FROM speech_jobs WHERE workspace=? AND session_id=? ORDER BY created_at DESC,id LIMIT ?",
          )
          .all(workspace, sessionId, limit)
      : this.db
          .prepare(
            "SELECT id FROM speech_jobs WHERE workspace=? ORDER BY created_at DESC,id LIMIT ?",
          )
          .all(workspace, limit);
    return rows.map((row) => this.job(workspace, row.id));
  }
  create(workspace, value) {
    ident(workspace);
    object(value, [
      "id",
      "sessionId",
      "recordingJobId",
      "segmentIds",
      "maxDurationSeconds",
    ]);
    const sessionId = ident(value.sessionId),
      recordingJobId = ident(value.recordingJobId);
    this.store.session(workspace, sessionId);
    const recording = this.recorder.job(workspace, recordingJobId);
    if (recording.sessionId !== sessionId)
      throw new Fault("speech_session_mismatch", 409);
    const id = value.id == null ? randomUUID() : ident(value.id),
      max = value.maxDurationSeconds ?? 120;
    if (!Number.isInteger(max) || max < 5 || max > 3600)
      throw new Fault("invalid_speech_bounds");
    const requested = value.segmentIds;
    if (
      requested !== undefined &&
      (!Array.isArray(requested) ||
        !requested.length ||
        requested.length > 120 ||
        new Set(requested.map(ident)).size !== requested.length)
    )
      throw new Fault("invalid_speech_inputs");
    const inputs = requested
      ? requested.map((segmentId) => {
          const segment = recording.segments.find(
            (segment) => segment.id === segmentId,
          );
          if (!segment) throw new Fault("media_not_found", 404);
          return segment;
        })
      : recording.segments;
    if (!inputs.length) throw new Fault("verified_media_required", 409);
    if (
      inputs.length > 120 ||
      inputs.reduce((n, input) => n + input.durationMs, 0) > 3_600_000
    )
      throw new Fault("speech_input_capacity", 409);
    return this.store.transaction(() => {
      const existing = this.db
        .prepare("SELECT * FROM speech_jobs WHERE workspace=? AND id=?")
        .get(workspace, id);
      if (existing) {
        const frozen = this.db
          .prepare(
            "SELECT segment_id,sha256 FROM speech_inputs WHERE workspace=? AND job_id=? ORDER BY ordinal",
          )
          .all(workspace, id);
        if (
          existing.session_id !== sessionId ||
          existing.recording_job_id !== recordingJobId ||
          existing.max_seconds !== max ||
          existing.engine_id !== this.recognizer.id ||
          JSON.stringify(frozen) !==
            JSON.stringify(
              inputs.map((input) => ({
                segment_id: input.id,
                sha256: input.sha256,
              })),
            )
        )
          throw new Fault("speech_job_identity_conflict", 409);
        return this.job(workspace, id);
      }
      if (
        this.db
          .prepare(
            "SELECT count(*) AS n FROM speech_jobs WHERE state NOT IN ('completed','stopped','failed')",
          )
          .get().n >= 100
      )
        throw new Fault("speech_capacity", 409);
      const now = Date.now();
      this.db
        .prepare(
          "INSERT INTO speech_jobs(workspace,id,session_id,recording_job_id,engine_id,state,created_at,deadline,max_seconds) VALUES(?,?,?,?,?,'queued',?,?,?)",
        )
        .run(
          workspace,
          id,
          sessionId,
          recordingJobId,
          this.recognizer.id,
          now,
          now + max * 1000,
          max,
        );
      inputs.forEach((input, ordinal) =>
        this.db
          .prepare(
            "INSERT INTO speech_inputs(workspace,job_id,segment_id,ordinal,sha256,started_at,duration_ms) VALUES(?,?,?,?,?,?,?)",
          )
          .run(
            workspace,
            id,
            input.id,
            ordinal,
            input.sha256,
            input.startedAtMs,
            input.durationMs,
          ),
      );
      return this.job(workspace, id);
    });
  }
  stop(workspace, id) {
    const job = this.job(workspace, id);
    if (terminal.includes(job.state)) return job;
    this.db
      .prepare(
        "UPDATE speech_jobs SET stop_requested=1,state=CASE WHEN state IN ('queued','retrying','recovering') THEN 'stopped' ELSE 'stopping' END WHERE workspace=? AND id=?",
      )
      .run(workspace, id);
    if (["queued", "retrying", "recovering"].includes(job.state))
      this.db
        .prepare(
          "UPDATE speech_inputs SET state='stopped' WHERE workspace=? AND job_id=? AND state!='completed'",
        )
        .run(workspace, id);
    return this.job(workspace, id);
  }
  lease() {
    return this.store.transaction(() => {
      const row = this.db
        .prepare("SELECT * FROM speech_lease WHERE id=1")
        .get();
      if (row && row.owner !== this.owner && row.expires_at > Date.now())
        return false;
      this.db
        .prepare(
          "INSERT INTO speech_lease VALUES(1,?,?) ON CONFLICT(id) DO UPDATE SET owner=excluded.owner,expires_at=excluded.expires_at",
        )
        .run(this.owner, Date.now() + this.leaseMs);
      return true;
    });
  }
  start() {
    if (this.timer || this.closed) return;
    const failure = () => {
      this.workerError = "speech_worker_failure";
      if (this.active) this.signal(this.active);
    };
    this.timer = setInterval(() => this.tick().catch(failure), this.intervalMs);
    this.heartbeat = setInterval(
      () => {
        if (!this.closed)
          this.db
            .prepare("UPDATE speech_lease SET expires_at=? WHERE owner=?")
            .run(Date.now() + this.leaseMs, this.owner);
      },
      Math.min(1000, Math.floor(this.leaseMs / 3)),
    );
    this.tick().catch(failure);
  }
  recover() {
    this.db
      .prepare(
        "UPDATE speech_inputs SET state=CASE WHEN attempts>=3 THEN 'failed' ELSE 'queued' END,error='service_restart' WHERE state='transcribing'",
      )
      .run();
    this.db
      .prepare(
        "UPDATE speech_jobs SET state=CASE WHEN stop_requested=1 THEN 'stopped' ELSE 'recovering' END,error='service_restart' WHERE state IN ('transcribing','stopping')",
      )
      .run();
    this.recovered = true;
  }
  signal(active) {
    if (active.signalled) return;
    active.signalled = true;
    const kill = (signal) => {
      try {
        process.kill(-active.child.pid, signal);
      } catch {
        active.child.kill(signal);
      }
    };
    kill("SIGTERM");
    active.killTimer = setTimeout(() => {
      if (!active.done) kill("SIGKILL");
    }, 1000);
  }
  failure(job, input, code) {
    const failed = input.attempts >= 3 || Date.now() >= job.deadline;
    this.db
      .prepare(
        "UPDATE speech_inputs SET state=?,error=?,next_retry=? WHERE workspace=? AND job_id=? AND segment_id=?",
      )
      .run(
        failed ? "failed" : "queued",
        code,
        Date.now() + Math.min(2000, input.attempts * 300),
        job.workspace,
        job.id,
        input.segment_id,
      );
    this.db
      .prepare(
        "UPDATE speech_jobs SET state=?,error=? WHERE workspace=? AND id=?",
      )
      .run(failed ? "failed" : "retrying", code, job.workspace, job.id);
  }
  publish(job, input) {
    const result = validateSpeechResult(
      JSON.parse(input.result),
      input.duration_ms,
      this.recognizer,
    );
    if (result.segments.length)
      this.store.append(
        job.workspace,
        job.session_id,
        result.segments.map((segment, index) => ({
          source: {
            adapter: "independent-speech",
            eventId: `${job.id}:${input.segment_id}:${index}`,
          },
          kind: "transcript",
          text: segment.text,
          speakerId: segment.speakerId
            ? `track_${digest([job.id, input.segment_id, segment.speakerId]).slice(0, 40)}`
            : `audio_${digest(job.id).slice(0, 40)}`,
          sourceTimestampMs: null,
          capturedAtMs: input.started_at + segment.startMs,
          raw: {
            speechJobId: job.id,
            recordingJobId: job.recording_job_id,
            mediaSegmentId: input.segment_id,
            mediaSha256: input.sha256,
            mediaStartMs: segment.startMs,
            mediaEndMs: segment.endMs,
            timestampBasis: "verified-media-offset",
            confidence: segment.confidence,
            engine: result.engine,
            speakerTrack: segment.speakerId
              ? "anonymous-engine-track"
              : "unseparated-audio-track",
            speakerTrackScope: segment.speakerId
              ? "media-segment"
              : "recording-job-unseparated",
            diarization: result.engine.diarization,
            independentTranscription: true,
          },
        })),
      );
    this.db
      .prepare(
        "UPDATE speech_inputs SET state='completed',error=NULL WHERE workspace=? AND job_id=? AND segment_id=?",
      )
      .run(job.workspace, job.id, input.segment_id);
  }
  async tick() {
    if (this.busy || this.closed) return;
    this.busy = true;
    try {
      if (!this.lease()) return;
      if (!this.recovered) this.recover();
      if (this.active) {
        const active = this.active;
        const job = this.db
          .prepare("SELECT * FROM speech_jobs WHERE workspace=? AND id=?")
          .get(active.job.workspace, active.job.id);
        if (
          job.stop_requested ||
          Date.now() >= job.deadline ||
          this.workerError
        )
          this.signal(active);
        if (!active.done) return;
        clearTimeout(active.killTimer);
        const input = this.db
          .prepare(
            "SELECT * FROM speech_inputs WHERE workspace=? AND job_id=? AND segment_id=?",
          )
          .get(job.workspace, job.id, active.input.segment_id);
        if (job.stop_requested) {
          this.db
            .prepare(
              "UPDATE speech_jobs SET state='stopped',error=NULL WHERE workspace=? AND id=?",
            )
            .run(job.workspace, job.id);
          this.db
            .prepare(
              "UPDATE speech_inputs SET state='stopped' WHERE workspace=? AND job_id=? AND state!='completed'",
            )
            .run(job.workspace, job.id);
        } else if (Date.now() >= job.deadline)
          this.failure(job, input, "speech_deadline_exceeded");
        else if (active.code !== 0 || active.outputTooLarge || this.workerError)
          this.failure(
            job,
            input,
            active.outputTooLarge
              ? "speech_output_too_large"
              : "speech_engine_failed",
          );
        else {
          try {
            const result = validateSpeechResult(
              JSON.parse(active.output),
              input.duration_ms,
              this.recognizer,
            );
            // Revalidate after inference; modified or vanished media cannot become evidence.
            const media = await this.recorder.media(
              job.workspace,
              job.recording_job_id,
              input.segment_id,
            );
            if (media.sha256 !== input.sha256)
              throw new Fault("speech_media_changed");
            this.db
              .prepare(
                "UPDATE speech_inputs SET state='recognised',result=?,error=NULL WHERE workspace=? AND job_id=? AND segment_id=?",
              )
              .run(
                JSON.stringify(result),
                job.workspace,
                job.id,
                input.segment_id,
              );
          } catch (error) {
            this.failure(
              job,
              input,
              error instanceof Fault ? error.code : "invalid_speech_output",
            );
          }
        }
        this.active = null;
      }
      const now = Date.now();
      this.db
        .prepare(
          "UPDATE speech_jobs SET state='failed',error='speech_deadline_exceeded' WHERE state NOT IN ('completed','failed','stopped') AND deadline<=? AND stop_requested=0",
        )
        .run(now);
      const job = this.db
        .prepare(
          "SELECT * FROM speech_jobs WHERE state IN ('queued','retrying','recovering','transcribing') AND stop_requested=0 AND deadline>? ORDER BY created_at,id LIMIT 1",
        )
        .get(now);
      if (!job) return;
      if (
        this.db
          .prepare(
            "SELECT 1 FROM speech_inputs WHERE workspace=? AND job_id=? AND (state='failed' OR (state='queued' AND attempts>=3))",
          )
          .get(job.workspace, job.id)
      ) {
        this.db
          .prepare(
            "UPDATE speech_jobs SET state='failed',error='speech_attempts_exhausted' WHERE workspace=? AND id=?",
          )
          .run(job.workspace, job.id);
        return;
      }
      if (job.engine_id !== this.recognizer.id) {
        this.db
          .prepare(
            "UPDATE speech_jobs SET state='failed',error='speech_engine_configuration_changed' WHERE workspace=? AND id=?",
          )
          .run(job.workspace, job.id);
        return;
      }
      const recognised = this.db
        .prepare(
          "SELECT * FROM speech_inputs WHERE workspace=? AND job_id=? AND state='recognised' ORDER BY ordinal LIMIT 1",
        )
        .get(job.workspace, job.id);
      if (recognised) {
        try {
          const media = await this.recorder.media(
            job.workspace,
            job.recording_job_id,
            recognised.segment_id,
          );
          if (media.sha256 !== recognised.sha256)
            throw new Fault("speech_media_changed");
          this.publish(job, recognised);
        } catch (error) {
          this.db
            .prepare(
              "UPDATE speech_jobs SET state='failed',error=? WHERE workspace=? AND id=?",
            )
            .run(
              error instanceof Fault ? error.code : "speech_publish_failed",
              job.workspace,
              job.id,
            );
        }
        return;
      }
      const input = this.db
        .prepare(
          "SELECT * FROM speech_inputs WHERE workspace=? AND job_id=? AND state='queued' AND next_retry<=? ORDER BY ordinal LIMIT 1",
        )
        .get(job.workspace, job.id, now);
      if (!input) {
        const unfinished = this.db
          .prepare(
            "SELECT count(*) AS n FROM speech_inputs WHERE workspace=? AND job_id=? AND state!='completed'",
          )
          .get(job.workspace, job.id).n;
        if (!unfinished)
          this.db
            .prepare(
              "UPDATE speech_jobs SET state='completed',error=NULL WHERE workspace=? AND id=?",
            )
            .run(job.workspace, job.id);
        return;
      }
      try {
        const media = await this.recorder.media(
          job.workspace,
          job.recording_job_id,
          input.segment_id,
        );
        if (media.sha256 !== input.sha256)
          throw new Fault("speech_media_changed");
        this.db
          .prepare(
            "UPDATE speech_inputs SET state='transcribing',attempts=attempts+1 WHERE workspace=? AND job_id=? AND segment_id=?",
          )
          .run(job.workspace, job.id, input.segment_id);
        this.db
          .prepare(
            "UPDATE speech_jobs SET state='transcribing',error=NULL WHERE workspace=? AND id=?",
          )
          .run(job.workspace, job.id);
        const guard = fileURLToPath(
          new URL("../speech/parent_exec.py", import.meta.url),
        );
        const child = spawn(
          "python3",
          [
            guard,
            String(process.pid),
            this.recognizer.command,
            ...this.recognizer.args,
            "--input",
            media.path,
            "--duration-ms",
            String(input.duration_ms),
          ],
          { stdio: ["ignore", "pipe", "pipe"], shell: false, detached: true },
        );
        const active = {
          job,
          input,
          child,
          output: "",
          bytes: 0,
          outputTooLarge: false,
          done: false,
          code: null,
        };
        child.stdout.setEncoding("utf8");
        child.stdout.on("data", (data) => {
          active.bytes += Buffer.byteLength(data);
          if (active.bytes > 512_000) {
            active.outputTooLarge = true;
            this.signal(active);
          } else active.output += data;
        });
        // Engine stderr may contain input paths or provider diagnostics. Never expose it to clients.
        child.stderr.on("data", () => {});
        child.on("error", () => {
          active.code = -1;
          active.done = true;
        });
        child.on("close", (code) => {
          active.code = code;
          active.done = true;
        });
        this.active = active;
      } catch (error) {
        this.db
          .prepare(
            "UPDATE speech_jobs SET state='failed',error=? WHERE workspace=? AND id=?",
          )
          .run(
            error instanceof Fault ? error.code : "speech_spawn_failed",
            job.workspace,
            job.id,
          );
      }
    } finally {
      this.busy = false;
    }
  }
  async close() {
    if (this.closePromise) return this.closePromise;
    this.closePromise = this.finishClose();
    return this.closePromise;
  }
  async finishClose() {
    this.closed = true;
    clearInterval(this.timer);
    clearInterval(this.heartbeat);
    while (this.busy) await new Promise((resolve) => setTimeout(resolve, 20));
    if (this.active) {
      const active = this.active;
      this.signal(active);
      while (!active.done)
        await new Promise((resolve) => setTimeout(resolve, 20));
      clearTimeout(active.killTimer);
      this.db
        .prepare(
          "UPDATE speech_inputs SET state=CASE WHEN attempts>=3 THEN 'failed' ELSE 'queued' END,error='service_restart' WHERE workspace=? AND job_id=? AND segment_id=? AND state='transcribing'",
        )
        .run(active.job.workspace, active.job.id, active.input.segment_id);
      this.db
        .prepare(
          "UPDATE speech_jobs SET state=CASE WHEN stop_requested=1 THEN 'stopped' ELSE 'retrying' END,error='service_restart' WHERE workspace=? AND id=?",
        )
        .run(active.job.workspace, active.job.id);
      this.active = null;
    }
    this.db.prepare("DELETE FROM speech_lease WHERE owner=?").run(this.owner);
  }
}
