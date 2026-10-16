import { Fault } from './validation.mjs';

// Diagnostic output is an allowlist, never a serialized worker, database row,
// provider exception, process identifier, source URL or filesystem path.
const SAFE_ERRORS = new Set([
  'capture_deadline_exceeded', 'recording_storage_limit', 'workspace_storage_capacity',
  'workspace_recording_capacity', 'workspace_quota_exceeded', 'source_unavailable',
  'service_restart', 'capture_failed', 'media_integrity_failed', 'media_missing',
  'speech_deadline_exceeded', 'speech_attempts_exhausted', 'speech_engine_configuration_changed',
  'speech_engine_failed', 'speech_output_invalid', 'speech_input_integrity_failed',
  'media_archive_deadline_exceeded', 'archive_object_integrity_failed',
  'archive_manifest_integrity_failed', 'archive_media_metadata_conflict',
  'archived_media_metadata_missing', 'unsafe_archive_restore_path',
  'object_storage_unavailable', 'object_storage_timeout', 'source_poll_timeout',
  'worker_failure', 'scheduler_failure', 'speech_worker_failure', 'media_archive_worker_failed',
]);
const terminal = new Set(['completed', 'stopped', 'failed']);
const states = new Set(['queued', 'starting', 'recording', 'recovering', 'retrying', 'stopping', 'watching', 'checking', 'transcribing', 'uploading', 'restoring', ...terminal]);
const definitions = [
  { id: 'recording', table: 'recording_jobs', scope: 'recordings:read', active: ['starting', 'recording', 'stopping'], error: 'worker_failure' },
  { id: 'scheduling', table: 'collection_missions', scope: 'recordings:read', active: ['watching', 'checking', 'recording'], error: 'scheduler_failure' },
  { id: 'speech', table: 'speech_jobs', scope: 'speech:read', active: ['transcribing', 'stopping'], error: 'speech_worker_failure' },
  { id: 'archive', table: 'media_archives', scope: 'recordings:read', active: ['uploading', 'restoring'], error: 'media_archive_worker_failed' },
];
const errorCode = value => value == null ? null : SAFE_ERRORS.has(value) ? value : 'job_failed';

function workerSnapshot({ db, governance, workspace, definition, worker, allowed }) {
  const { id, table, scope, active } = definition;
  if (!allowed(scope)) return { worker: { id, access: 'restricted' }, attention: [] };
  const counts = { pending: 0, active: 0, retrying: 0, failed: 0, completed: 0, stopped: 0 };
  let oldestPendingAtMs = null, attention = [];
  if (governance.hasTable(table)) {
    // An explicit restore is the archive's current operation. Its final outcome
    // remains visible after completion/failure instead of the original upload masking it.
    const state = id === 'archive' ? "CASE WHEN restore_state!='not-requested' THEN restore_state ELSE state END" : 'state';
    const error = id === 'archive' ? "CASE WHEN restore_state!='not-requested' THEN restore_error ELSE error END" : 'error';
    const created = id === 'archive' ? "CASE WHEN restore_state!='not-requested' THEN restore_requested_at ELSE created_at END" : 'created_at';
    const rows = db.prepare(`SELECT ${state} AS state,count(*) AS n,min(${created}) AS oldest FROM ${table} WHERE workspace=? GROUP BY ${state}`).all(workspace);
    for (const row of rows) {
      if (!terminal.has(row.state)) {
        counts.pending += row.n;
        if (row.oldest !== null && (oldestPendingAtMs === null || row.oldest < oldestPendingAtMs)) oldestPendingAtMs = row.oldest;
      }
      if (active.includes(row.state)) counts.active += row.n;
      if (['retrying', 'recovering'].includes(row.state)) counts.retrying += row.n;
      if (terminal.has(row.state)) counts[row.state] += row.n;
    }
    // Filter before LIMIT so successful recent jobs cannot hide older failures.
    const session = id === 'archive' ? 'NULL' : 'session_id';
    attention = db.prepare(`SELECT id,${session} AS session_id,${state} AS state,${error} AS error,${created} AS created_at FROM ${table} WHERE workspace=? AND (${state}='failed' OR ${error} IS NOT NULL) ORDER BY ${created} DESC,id LIMIT 20`).all(workspace).map(row => ({
      id: id + ':' + row.id, kind: id, jobId: row.id,
      state: states.has(row.state) ? row.state : 'unknown', error: errorCode(row.error) ?? 'job_failed', createdAtMs: row.created_at,
      ...(row.session_id && allowed('sessions:read') ? { sessionId: row.session_id } : {}),
    }));
  }
  const state = !worker ? 'not-configured' : worker.closed || !worker.timer ? 'stopped'
    : worker.workerError ? 'error' : counts.active > 0 ? 'running' : 'idle';
  let recordingBudget;
  if (id === 'recording' && worker) {
    // Recorder admission has its own conservative per-job allocation, separate
    // from governance's actual retained/archive/cleanup footprint. Do not add
    // the two reservations together and present them as the same quota.
    const retainedBytes = db.prepare('SELECT coalesce(sum(bytes),0) AS n FROM media_segments WHERE workspace=?').get(workspace).n;
    const reservedBytes = db.prepare("SELECT coalesce(sum(b.reserved_bytes),0) AS n FROM recording_budgets b JOIN recording_jobs j ON j.workspace=b.workspace AND j.id=b.job_id WHERE b.workspace=? AND j.state NOT IN ('completed','stopped','failed')").get(workspace).n;
    recordingBudget = { retainedBytes, reservedBytes, limitBytes: worker.maxWorkspaceBytes, availableBytes: Math.max(0, worker.maxWorkspaceBytes - retainedBytes - reservedBytes), requiredForNextRecordingBytes: worker.maxJobBytes,
      maxConcurrent: worker.maxConcurrent, maxWorkspaceConcurrent: worker.maxWorkspaceConcurrent, maxWorkspacePending: worker.maxWorkspacePending };
  }
  return { worker: { id, access: 'allowed', configured: !!worker, state, error: worker?.workerError ? definition.error : null, counts, oldestPendingAtMs, ...(recordingBudget ? { recordingBudget } : {}) }, attention };
}

/** Authenticated, workspace-bound observations. Does not start, repair or probe workers. */
export function workspaceOperations({ store, governance, principal, allowed, recorder, scheduler, speech, mediaArchive, now = Date.now }) {
  if (!governance) throw new Fault('workspace_controls_unavailable', 503);
  const workspace = principal.workspace;
  governance.role(principal);
  let capacity;
  try {
    const usage = governance.usage(workspace), limits = JSON.parse(governance.ensureSettings(workspace).limits);
    capacity = {
      available: true, measurement: usage.measurement,
      meters: [
        ['recordingSeconds', 'maxRecordingSeconds', usage.reservedRecordingSeconds],
        ['storageBytes', 'maxStorageBytes', usage.reservedStorageBytes],
        ['speechSeconds', 'maxSpeechSeconds', usage.reservedSpeechSeconds],
        ['pendingJobs', 'maxPendingJobs', 0],
      ].map(([id, limit, reserved]) => {
        const used = usage[id], committed = used + reserved;
        return { id, used, reserved, committed, limit: limits[limit], remaining: Math.max(0, limits[limit] - committed), overLimit: committed > limits[limit] };
      }),
      storage: { localBytes: usage.localStorageBytes, archivedBytes: usage.archivedStorageBytes, reservedArchiveBytes: usage.reservedArchiveStorageBytes, pendingCleanupBytes: usage.pendingCleanupBytes },
    };
  } catch { capacity = { available: false, error: 'usage_unavailable' }; }
  const configured = { recording: recorder, scheduling: scheduler, speech, archive: mediaArchive };
  const results = definitions.map(definition => workerSnapshot({ db: store.db, governance, workspace, definition, worker: configured[definition.id], allowed }));
  const canManage = allowed('workspace:admin');
  const cleanup = { canManage };
  if (canManage) {
    const rows = store.db.prepare("SELECT state,count(*) AS n FROM retention_cleanup WHERE workspace=? AND state!='completed' GROUP BY state").all(workspace);
    cleanup.pendingCount = rows.filter(row => row.state === 'pending').reduce((n, row) => n + row.n, 0);
    cleanup.failedCount = rows.filter(row => row.state === 'failed').reduce((n, row) => n + row.n, 0);
  }
  return { schemaVersion: 1, workspace, observedAtMs: now(), capacity, workers: results.map(row => row.worker),
    attention: results.flatMap(row => row.attention).sort((a, b) => b.createdAtMs - a.createdAtMs || a.id.localeCompare(b.id)).slice(0, 20), cleanup };
}
