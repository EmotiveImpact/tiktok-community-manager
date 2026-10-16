import test from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { randomUUID } from 'node:crypto';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync, chmodSync, renameSync, symlinkSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { EvidenceStore } from '../src/store.mjs';
import { Governance } from '../src/governance.mjs';
import { Recorder } from '../src/recorder.mjs';
import { Scheduler } from '../src/scheduler.mjs';
import { SpeechWorker } from '../src/speech.mjs';
import { MediaArchive } from '../src/media-archive.mjs';
import { PostgresDatabase } from '../src/postgres-db.mjs';
import { createIntelligenceServer, SCOPES } from '../src/server.mjs';
import { digest } from '../src/validation.mjs';

const at = 1_791_657_600_000;
const members = [
  { workspace: 'alpha', subject: 'owner', role: 'owner' },
  { workspace: 'alpha', subject: 'analyst', role: 'analyst' },
  { workspace: 'alpha', subject: 'viewer', role: 'viewer' },
  { workspace: 'beta', subject: 'owner', role: 'owner' },
];
const owner = { workspace: 'alpha', subject: 'owner' };
const session = id => ({ id, platform: 'fixture', title: 'Private fixture title', sourceUrl: 'https://example.invalid/private-source', startedAtMs: 0 });

function fixture(t, backend, recorderOptions = {}) {
  const root = mkdtempSync(join(tmpdir(), 'livelens-operations-'));
  const schema = backend === 'PostgreSQL' ? 'll_ops_' + randomUUID().replaceAll('-', '') : undefined;
  const open = () => new EvidenceStore(join(root, 'intelligence.sqlite'), { ...(schema ? { database: new PostgresDatabase({ connectionString: process.env.LIVELENS_TEST_POSTGRES_URL, schema }) } : {}), now: () => at });
  const store = open(), source = join(root, 'source'); writeFileSync(source, 'synthetic source');
  for (const workspace of ['alpha', 'beta']) store.createSession(workspace, session('room'));
  const recorder = new Recorder({ store, mediaRoot: join(root, 'media'), ffmpeg: '/usr/bin/ffmpeg', sources: ['alpha', 'beta'].map(workspace => ({ workspace, id: 'source', sessionId: 'room', kind: 'file', input: source })), ...recorderOptions });
  const governance = new Governance({ store, recorder, members, now: () => at });
  recorder.admission = (workspace, additions) => governance.checkQuota(workspace, additions);
  const setup = { root, store, recorder, governance, open, schema };
  t.after(async () => {
    // Test permission failures are deliberate; restore directories before cleanup.
    for (const path of [join(root, 'media/alpha'), join(root, 'media/alpha/job')]) if (existsSync(path)) { try { chmodSync(path, 0o700); } catch {} }
    for (const worker of [setup.scheduler, setup.speech, setup.mediaArchive, setup.recorder]) await worker?.close();
    if (!setup.store.db.closed) { if (schema) setup.store.db.exec('DROP SCHEMA "' + schema + '" CASCADE'); setup.store.close(); }
    rmSync(root, { recursive: true, force: true });
  });
  return setup;
}

function recording(setup, workspace, id, state, { created = at, error = null, max = 30, sessionId = 'room' } = {}) {
  setup.store.db.prepare('INSERT INTO recording_jobs(workspace,id,session_id,source_id,state,created_at,deadline,segment_seconds,max_seconds,error) VALUES(?,?,?,?,?,?,?,?,?,?)').run(workspace, id, sessionId, 'source', state, created, at + 60_000, 2, max, error);
}

async function api(t, setup, overrides = {}) {
  const definitions = {
    owner: { ...owner, scopes: SCOPES }, analyst: { workspace: 'alpha', subject: 'analyst', scopes: SCOPES },
    viewer: { workspace: 'alpha', subject: 'viewer', scopes: SCOPES },
    workspace: { ...owner, scopes: ['workspace:read'] },
    recording: { ...owner, scopes: ['workspace:read', 'recordings:read'] },
    speech: { ...owner, scopes: ['workspace:read', 'speech:read'] },
    missing: { ...owner, scopes: ['sessions:read'] }, beta: { workspace: 'beta', subject: 'owner', scopes: SCOPES },
  };
  const tokens = Object.fromEntries(Object.keys(definitions).map((name, index) => [name, String.fromCharCode(97 + index).repeat(43)]));
  const server = createIntelligenceServer({ ...setup, ...overrides, keys: Object.entries(definitions).map(([name, value]) => ({ ...value, token: tokens[name] })) });
  server.listen(0, '127.0.0.1'); await once(server, 'listening');
  const close = async () => { if (!server.listening) return; server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); };
  t.after(close);
  const call = async (path, principal = 'owner', body) => {
    const response = await fetch('http://127.0.0.1:' + server.address().port + path, {
      method: body === undefined ? 'GET' : 'POST', headers: { ...(principal ? { Authorization: 'Bearer ' + tokens[principal] } : {}), ...(body === undefined ? {} : { 'Content-Type': 'application/json' }) },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    return { status: response.status, body: await response.json() };
  };
  return { call, close };
}

function retained(setup) {
  const { store, root } = setup;
  recording(setup, 'alpha', 'job', 'completed');
  const directory = join(root, 'media/alpha/job'); mkdirSync(directory, { recursive: true });
  const bytes = Buffer.from('Retained original bytes'); writeFileSync(join(directory, 'segment.mp4'), bytes);
  store.db.prepare('INSERT INTO media_segments VALUES(?,?,?,?,?,?,?,?,?)').run('alpha', 'job', 'segment', 1, at, 2000, bytes.length, digest(bytes.toString()), 'alpha/job/segment.mp4');
  return { directory, bytes };
}

async function retainAndDelete(call) {
  assert.equal((await call('/v1/workspace/retention', 'owner', { days: 2, reason: 'Fixture retention' })).status, 201);
  const preview = await call('/v1/workspace/retention/preview');
  return call('/v1/workspace/retention/apply', 'owner', { previewHash: preview.body.previewHash, sessionIds: ['room'], reason: 'Explicit fixture selection' });
}

for (const backend of ['SQLite', 'PostgreSQL']) {
  const options = { skip: backend === 'PostgreSQL' && !process.env.LIVELENS_TEST_POSTGRES_URL };

  test(backend + ': operational HTTP views enforce scopes, membership and workspace boundaries', options, async t => {
    const setup = fixture(t, backend);
    recording(setup, 'alpha', 'failed', 'failed', { error: 'private_token_should_never_be_returned' });
    recording(setup, 'beta', 'foreign-job', 'recording');
    const { call } = await api(t, setup);
    assert.equal((await call('/v1/workspace/operations', null)).status, 401);
    assert.equal((await call('/v1/workspace/operations', 'missing')).status, 403);
    const restricted = (await call('/v1/workspace/operations', 'workspace')).body;
    assert.ok(restricted.workers.every(worker => worker.access === 'restricted' && Object.keys(worker).length === 2));
    assert.deepEqual(restricted.attention, []); assert.deepEqual(restricted.cleanup, { canManage: false });
    const full = (await call('/v1/workspace/operations')).body;
    assert.equal(full.workers[0].counts.failed, 1); assert.equal(full.workers[0].counts.active, 0);
    assert.equal(full.attention[0].error, 'job_failed'); assert.equal(full.attention[0].sessionId, 'room');
    for (const secret of ['foreign-job', 'private_token', setup.root, 'private-source', 'Private fixture title']) assert.equal(JSON.stringify(full).includes(secret), false);
    const scoped = (await call('/v1/workspace/operations', 'recording')).body;
    assert.equal('sessionId' in scoped.attention[0], false); assert.equal(scoped.workers.find(w => w.id === 'speech').access, 'restricted');
    assert.equal((await call('/v1/workspace/operations', 'beta')).body.workers[0].counts.active, 1);
    setup.governance.setMember('alpha', { subject: 'viewer', role: 'revoked' }, owner);
    assert.equal((await call('/v1/workspace/operations', 'viewer')).status, 403);
    assert.equal((await call('/v1/workspace/retention/cleanup', 'analyst')).status, 403);
  });

  test(backend + ': queue aggregation precedes receipt bounds and capacity uses admission reservations', options, async t => {
    const setup = fixture(t, backend);
    recording(setup, 'alpha', 'old-queued', 'queued', { created: at - 10000 });
    recording(setup, 'alpha', 'old-retry', 'retrying', { created: at - 9000, error: 'source_unavailable' });
    recording(setup, 'alpha', 'old-failure', 'failed', { created: at - 8000, error: 'capture_deadline_exceeded' });
    setup.store.db.prepare('INSERT INTO recording_budgets VALUES(?,?,?)').run('alpha', 'old-queued', 1024);
    setup.store.db.prepare('INSERT INTO recording_budgets VALUES(?,?,?)').run('alpha', 'old-failure', 9999);
    for (let n = 0; n < 230; n++) recording(setup, 'alpha', 'done-' + n, 'completed', { created: at + n });
    setup.governance.setLimits('alpha', { maxRecordingSeconds: 60, reason: 'Exact fixture allowance' }, owner);
    const { call } = await api(t, setup), response = (await call('/v1/workspace/operations')).body;
    assert.deepEqual(response.workers[0].counts, { pending: 2, active: 0, retrying: 1, failed: 1, completed: 230, stopped: 0 });
    assert.equal(response.workers[0].oldestPendingAtMs, at - 10000);
    assert.deepEqual(response.workers[0].recordingBudget, { retainedBytes: 0, reservedBytes: 1024, pendingCleanupBytes: 0, limitBytes: setup.recorder.maxWorkspaceBytes, availableBytes: setup.recorder.maxWorkspaceBytes - 1024,
      requiredForNextRecordingBytes: setup.recorder.maxJobBytes, maxConcurrent: 2, maxWorkspaceConcurrent: 2, maxWorkspacePending: 20 });
    // These conservative recording allocations are separate from governance's
    // logical storage reservation and must never be silently double counted.
    assert.equal(response.capacity.meters.find(m => m.id === 'storageBytes').reserved, 0);
    assert.deepEqual(response.attention.map(row => row.jobId), ['old-failure', 'old-retry']);
    const recordingMeter = response.capacity.meters.find(m => m.id === 'recordingSeconds');
    assert.deepEqual(recordingMeter, { id: 'recordingSeconds', used: 0, reserved: 60, committed: 60, limit: 60, remaining: 0, overLimit: false });
    assert.throws(() => setup.governance.checkQuota('alpha', { recordingSeconds: 1 }), /workspace_quota_exceeded/);
    setup.governance.setLimits('alpha', { maxRecordingSeconds: 59, reason: 'Lowered limit' }, owner);
    const changed = (await call('/v1/workspace/operations')).body.capacity.meters.find(m => m.id === 'recordingSeconds');
    assert.equal(changed.overLimit, true); assert.equal(changed.remaining, 0);
  });

  test(backend + ': configured lifecycle is separate from scoped persisted work and safe failures', options, async t => {
    const setup = fixture(t, backend), { call } = await api(t, setup);
    let result = (await call('/v1/workspace/operations')).body;
    assert.equal(result.workers[0].state, 'stopped'); assert.equal(result.workers[1].state, 'not-configured');
    setup.recorder.start();
    result = (await call('/v1/workspace/operations')).body;
    assert.equal(result.workers[0].state, 'idle');
    // A controlled persisted snapshot tests summary semantics without dispatching
    // another capture. The timer exists; busy suppresses scheduling during this assertion.
    setup.recorder.busy = true;
    recording(setup, 'beta', 'foreign-running', 'recording');
    assert.equal((await call('/v1/workspace/operations')).body.workers[0].state, 'idle');
    recording(setup, 'alpha', 'local-running', 'recording');
    assert.equal((await call('/v1/workspace/operations')).body.workers[0].state, 'running');
    setup.recorder.workerError = 'secret_path_or_runtime_details';
    result = (await call('/v1/workspace/operations')).body;
    assert.equal(result.workers[0].state, 'error'); assert.equal(result.workers[0].error, 'worker_failure');
    setup.recorder.busy = false;
    await setup.recorder.close();
    assert.equal((await call('/v1/workspace/operations')).body.workers[0].state, 'stopped');
  });

  test(backend + ': speech, schedule and archive observations preserve scope and restore failure truth', options, async t => {
    const setup = fixture(t, backend), { store } = setup;
    setup.scheduler = new Scheduler({ store, recorder: setup.recorder });
    setup.speech = new SpeechWorker({ store, recorder: setup.recorder, recognizer: { command: '/usr/bin/true', args: [], id: 'fixture', diarization: false } });
    setup.mediaArchive = new MediaArchive({ store, recorder: setup.recorder, storage: { put() {}, get() {} } });
    recording(setup, 'alpha', 'capture', 'completed');
    store.db.prepare('INSERT INTO speech_jobs(workspace,id,session_id,recording_job_id,engine_id,state,created_at,deadline,max_seconds,error) VALUES(?,?,?,?,?,?,?,?,?,?)').run('alpha', 'speech-job', 'room', 'capture', 'fixture', 'retrying', at, at + 1000, 30, 'service_restart');
    store.db.prepare('INSERT INTO speech_inputs(workspace,job_id,segment_id,ordinal,sha256,started_at,duration_ms,state) VALUES(?,?,?,?,?,?,?,?)').run('alpha', 'speech-job', 'segment', 0, 'a'.repeat(64), at, 3000, 'queued');
    store.db.prepare('INSERT INTO collection_missions(workspace,id,source_id,state,created_at,start_at,end_at,max_seconds,segment_seconds,poll_seconds,auto_record,next_poll,error) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)').run('alpha', 'schedule', 'source', 'retrying', at, at, at + 1000, 30, 2, 30, 0, at, 'sensitive_url_should_be_redacted');
    const manifest = JSON.stringify({ workspace: 'alpha', archiveId: 'archive', segments: [] });
    store.db.prepare('INSERT INTO media_archives(workspace,id,recording_job_id,state,created_at,deadline,max_seconds,max_attempts,manifest,manifest_sha256,object_key,restore_state,restore_requested_at,restore_error) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?)').run('alpha', 'archive', 'capture', 'completed', at, at + 1000, 30, 3, manifest, digest(manifest), 'private-object-key', 'failed', at + 2, 'archive_object_integrity_failed');
    const { call } = await api(t, setup), result = (await call('/v1/workspace/operations')).body;
    assert.equal(result.workers.find(w => w.id === 'speech').counts.retrying, 1);
    assert.equal(result.workers.find(w => w.id === 'archive').counts.failed, 1);
    assert.equal(result.workers.find(w => w.id === 'archive').counts.completed, 0);
    assert.equal(result.capacity.meters.find(m => m.id === 'speechSeconds').reserved, 3);
    assert.equal(result.attention.find(item => item.kind === 'archive').error, 'archive_object_integrity_failed');
    assert.equal(result.attention.find(item => item.kind === 'scheduling').error, 'job_failed');
    const scoped = (await call('/v1/workspace/operations', 'speech')).body;
    assert.deepEqual(scoped.attention.map(item => item.kind), ['speech']);
    assert.equal(JSON.stringify(result).includes('private-object-key'), false);
    store.db.prepare("UPDATE media_archives SET manifest_sha256='corrupt' WHERE workspace='alpha'").run();
    const corrupt = await call('/v1/workspace/operations');
    assert.equal(corrupt.status, 200); assert.deepEqual(corrupt.body.capacity, { available: false, error: 'usage_unavailable' });
    assert.equal(corrupt.body.workers.find(w => w.id === 'archive').counts.failed, 1);
  });

  test(backend + ': actual filesystem cleanup failure persists across restart, reserves bytes, and retries idempotently', options, async t => {
    const setup = fixture(t, backend), { directory, bytes } = retained(setup);
    assert.notEqual(process.getuid?.(), 0, 'Permission-failure test requires non-root execution');
    chmodSync(directory, 0o500);
    let transport = await api(t, setup);
    const result = await retainAndDelete(transport.call);
    assert.equal(result.status, 201); assert.equal(result.body.deletedSessions, 1);
    assert.deepEqual(result.body.cleanupFailures, ['job']);
    const task = result.body.cleanupTasks[0];
    assert.equal(task.state, 'failed'); assert.equal(task.error, 'cleanup_filesystem_failed');
    assert.equal(task.attempts, 1); assert.equal(task.bytes, bytes.length);
    assert.equal((await transport.call('/v1/sessions/room')).status, 404);
    const usage = (await transport.call('/v1/workspace/usage')).body;
    assert.equal(usage.storageBytes, 0); assert.equal(usage.pendingCleanupBytes, bytes.length); assert.equal(usage.reservedStorageBytes, bytes.length);
    setup.governance.setLimits('alpha', { maxStorageBytes: bytes.length, reason: 'Conserve pending bytes' }, owner);
    assert.throws(() => setup.governance.checkQuota('alpha', { storageBytes: 1 }), /workspace_quota_exceeded/);
    assert.equal((await transport.call('/v1/workspace/retention/cleanup/' + task.id + '/retry', 'beta', { reason: 'Wrong workspace' })).status, 404);
    assert.equal((await transport.call('/v1/workspace/retention/cleanup/' + task.id + '/retry', 'analyst', { reason: 'Insufficient role' })).status, 403);
    assert.equal((await transport.call('/v1/workspace/retention/cleanup/' + task.id + '/retry', 'workspace', { reason: 'Insufficient scope' })).status, 403);
    await transport.close(); await setup.recorder.close(); setup.store.close();
    setup.store = setup.open(); setup.recorder = new Recorder({ store: setup.store, mediaRoot: join(setup.root, 'media'), ffmpeg: '/usr/bin/ffmpeg' });
    setup.governance = new Governance({ store: setup.store, recorder: setup.recorder, members, now: () => at + 1000 });
    transport = await api(t, setup);
    assert.equal((await transport.call('/v1/workspace/retention/cleanup')).body.tasks[0].state, 'failed');
    assert.equal((await transport.call('/v1/workspace/operations')).body.cleanup.failedCount, 1);
    chmodSync(directory, 0o700);
    const retried = await transport.call('/v1/workspace/retention/cleanup/' + task.id + '/retry', 'owner', { reason: 'Restored filesystem permission' });
    assert.equal(retried.status, 201); assert.equal(retried.body.state, 'completed'); assert.equal(retried.body.attempts, 2); assert.equal(retried.body.error, null);
    assert.equal(existsSync(directory), false); assert.equal(setup.governance.usage('alpha').reservedStorageBytes, 0);
    assert.equal(setup.governance.checkQuota('alpha', { storageBytes: 1 }).allowed, true);
    const repeated = await transport.call('/v1/workspace/retention/cleanup/' + task.id + '/retry', 'owner', { reason: 'Repeat safe request' });
    assert.deepEqual(repeated.body, retried.body); assert.equal(setup.governance.verifyAudit('alpha').valid, true);
    assert.equal(JSON.stringify((await transport.call('/v1/workspace/retention/cleanup')).body).includes(setup.root), false);
  });

  test(backend + ': cleanup refuses symlink substitution, replacement directories and reused job identities', options, async t => {
    const setup = fixture(t, backend), { directory, bytes } = retained(setup);
    chmodSync(directory, 0o500);
    const { call } = await api(t, setup), task = (await retainAndDelete(call)).body.cleanupTasks[0];
    chmodSync(directory, 0o700);
    const original = directory + '-original', unrelated = join(setup.root, 'unrelated');
    renameSync(directory, original); mkdirSync(unrelated); writeFileSync(join(unrelated, 'keep'), 'Do not remove');
    symlinkSync(unrelated, directory);
    let result = await call('/v1/workspace/retention/cleanup/' + task.id + '/retry', 'owner', { reason: 'Refuse link' });
    assert.equal(result.body.error, 'cleanup_target_unsafe'); assert.equal(readFileSync(join(unrelated, 'keep'), 'utf8'), 'Do not remove');
    rmSync(directory); mkdirSync(directory); writeFileSync(join(directory, 'keep'), 'Replacement data');
    result = await call('/v1/workspace/retention/cleanup/' + task.id + '/retry', 'owner', { reason: 'Refuse replacement' });
    assert.equal(result.body.error, 'cleanup_target_changed'); assert.equal(readFileSync(join(directory, 'keep'), 'utf8'), 'Replacement data');
    rmSync(directory, { recursive: true }); renameSync(original, directory);
    setup.store.createSession('alpha', session('new-room'));
    recording(setup, 'alpha', 'job', 'completed', { sessionId: 'new-room' });
    result = await call('/v1/workspace/retention/cleanup/' + task.id + '/retry', 'owner', { reason: 'Refuse reused ID' });
    assert.equal(result.body.error, 'cleanup_target_in_use'); assert.deepEqual(readFileSync(join(directory, 'segment.mp4')), bytes);
    assert.equal(setup.governance.usage('alpha').pendingCleanupBytes, bytes.length);
  });

  test(backend + ': crash after database deletion leaves a bounded durable task and explicit retry receipt', options, async t => {
    const setup = fixture(t, backend), { directory, bytes } = retained(setup);
    setup.governance.configureRetention('alpha', { days: 2, reason: 'Fixture policy' }, owner);
    const preview = setup.governance.previewRetention('alpha');
    // Fault injection occurs exactly after the commit and before the first
    // filesystem action. No API result or filesystem outcome is fabricated.
    setup.governance.performCleanup = () => { throw new Error('simulated_process_stop'); };
    assert.throws(() => setup.governance.runRetention('alpha', { previewHash: preview.previewHash, sessionIds: ['room'], reason: 'Explicit deletion' }, owner), /simulated_process_stop/);
    assert.throws(() => setup.store.session('alpha', 'room'), /session_not_found/);
    assert.deepEqual(readFileSync(join(directory, 'segment.mp4')), bytes);
    setup.governance = new Governance({ store: setup.store, recorder: setup.recorder, members, now: () => at + 1 });
    const { call } = await api(t, setup);
    const initial = await call('/v1/workspace/retention/cleanup?limit=1&offset=0'), task = initial.body.tasks[0];
    assert.equal(task.state, 'pending'); assert.equal(task.attempts, 0); assert.equal(initial.body.hasMore, false); assert.equal(initial.body.nextOffset, null);
    assert.equal((await call('/v1/workspace/operations')).body.cleanup.pendingCount, 1);
    assert.equal((await call('/v1/workspace/retention/cleanup?limit=201')).status, 400);
    assert.equal((await call('/v1/workspace/retention/cleanup?offset=-1')).status, 400);
    assert.deepEqual((await call('/v1/workspace/retention/cleanup?offset=1')).body, { tasks: [], hasMore: false, nextOffset: null });
    assert.equal((await call('/v1/workspace/retention/cleanup/' + task.id + '/retry', 'owner', {})).status, 400);
    assert.equal((await call('/v1/workspace/retention/cleanup/' + task.id + '/retry', 'owner', { reason: 'No arbitrary target', path: setup.root })).status, 400);
    const retried = await call('/v1/workspace/retention/cleanup/' + task.id + '/retry', 'owner', { reason: 'Resume interrupted cleanup' });
    assert.equal(retried.body.state, 'completed'); assert.equal(retried.body.attempts, 1); assert.equal(existsSync(directory), false);
    assert.equal(setup.governance.usage('alpha').pendingCleanupBytes, 0);
    const audits = setup.governance.audit('alpha');
    assert.equal(audits.filter(entry => entry.action === 'retention.session.deleted').length, 1);
    assert.equal(audits.filter(entry => entry.action === 'retention.cleanup.completed').length, 1);
  });

  test(backend + ': recorder refuses pending cleanup identity reuse until exact cleanup completes', options, async t => {
    const setup = fixture(t, backend, { maxWorkspaceBytes: 1024, maxJobBytes: 1024 }), { directory, bytes } = retained(setup);
    chmodSync(directory, 0o500);
    const { call } = await api(t, setup), task = (await retainAndDelete(call)).body.cleanupTasks[0];
    setup.governance.setLimits('alpha', { maxStorageBytes: 10_000, reason: 'Governance allowance exceeds the recorder allocation' }, owner);
    setup.store.createSession('alpha', session('room'));
    const capture = { id: 'job', sourceId: 'source', sessionId: 'room', maxDurationSeconds: 5, segmentSeconds: 2 };
    const refused = await call('/v1/jobs', 'owner', capture);
    assert.equal(refused.status, 409); assert.equal(refused.body.error, 'recording_cleanup_pending');
    assert.deepEqual(readFileSync(join(directory, 'segment.mp4')), bytes);
    assert.equal(setup.store.db.prepare("SELECT count(*) AS n FROM recording_jobs WHERE workspace='alpha'").get().n, 0);
    const allocation = (await call('/v1/workspace/operations')).body.workers[0].recordingBudget;
    assert.equal(allocation.retainedBytes, 0); assert.equal(allocation.pendingCleanupBytes, bytes.length);
    assert.equal(allocation.reservedBytes, bytes.length); assert.equal(allocation.availableBytes, 1024 - bytes.length);
    assert.equal(setup.governance.checkQuota('alpha', { storageBytes: 1024 }).allowed, true);
    const separateId = await call('/v1/jobs', 'owner', { ...capture, id: 'different-job' });
    assert.equal(separateId.status, 409); assert.equal(separateId.body.error, 'workspace_storage_capacity');
    assert.equal(setup.store.db.prepare("SELECT count(*) AS n FROM recording_jobs WHERE workspace='alpha'").get().n, 0);
    assert.deepEqual(readFileSync(join(directory, 'segment.mp4')), bytes);
    assert.equal((await call('/v1/jobs', 'beta', { ...capture, id: 'different-job' })).status, 201, 'Another workspace does not inherit cleanup reservations');
    chmodSync(directory, 0o700);
    assert.equal((await call('/v1/workspace/retention/cleanup/' + task.id + '/retry', 'owner', { reason: 'Permission restored' })).body.state, 'completed');
    const released = (await call('/v1/workspace/operations')).body.workers[0].recordingBudget;
    assert.equal(released.pendingCleanupBytes, 0); assert.equal(released.reservedBytes, 0); assert.equal(released.availableBytes, 1024);
    assert.equal((await call('/v1/jobs', 'owner', { ...capture, id: 'different-job' })).status, 201);
    assert.equal((await call('/v1/jobs/different-job/stop', 'owner', {})).status, 200);
    assert.equal((await call('/v1/jobs', 'owner', capture)).status, 201);
    assert.equal(existsSync(directory), false, 'Queued recording does not silently restore old bytes');
  });
}
