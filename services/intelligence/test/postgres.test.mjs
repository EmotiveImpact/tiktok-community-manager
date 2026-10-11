import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID, randomBytes } from 'node:crypto';
import { mkdtempSync, rmSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { once } from 'node:events';
import { PostgresDatabase, translatePilotSql } from '../src/postgres-db.mjs';
import { EvidenceStore } from '../src/store.mjs';
import { Recorder } from '../src/recorder.mjs';
import { Scheduler } from '../src/scheduler.mjs';
import { DirectMediaAdapter } from '../src/source-adapters.mjs';
import { Governance } from '../src/governance.mjs';
import { InvestigationEngine } from '../src/investigations.mjs';
import { MediaArchive } from '../src/media-archive.mjs';
import { createIntelligenceServer, SCOPES } from '../src/server.mjs';
import { FilesystemObjectStorage, EncryptedObjectStorage } from '../../../deployment/livelens/object-storage.mjs';

const connectionString = process.env.LIVELENS_TEST_POSTGRES_URL, enabled = { skip: !connectionString };
const run = promisify(execFile), at = 1_791_657_600_000;
const session = (id = 'session') => ({ id, platform: 'fixture', account: 'fictional_host', sourceUrl: 'https://example.invalid/' + id, title: 'PostgreSQL fixture', startedAtMs: at });
const event = (id = 'message', extra = {}) => ({ source: { adapter: 'fixture', eventId: id }, kind: 'chat', text: 'Original captured statement', sourceTimestampMs: at, capturedAtMs: at + 30, ...extra });
function fixture(t) {
  const schema = 'll_test_' + randomUUID().replaceAll('-', ''), root = mkdtempSync(join(tmpdir(), 'livelens-postgres-'));
  let database = new PostgresDatabase({ connectionString, schema }), store = new EvidenceStore(':memory:', { database, now: () => at + 100 });
  const cleanup = [];
  t.after(async () => { for (const stop of cleanup.reverse()) await stop(); database.exec('DROP SCHEMA "' + schema + '" CASCADE'); database.close(); rmSync(root, { recursive: true, force: true }); });
  return { schema, root, cleanup, get database() { return database; }, get store() { return store; }, reopen() { store.close(); database = new PostgresDatabase({ connectionString, schema }); store = new EvidenceStore(':memory:', { database, now: () => at + 500 }); return store; } };
}
async function until(predicate, timeoutMs = 25_000) {
  const end = Date.now() + timeoutMs;
  while (Date.now() < end) { if (await predicate()) return; await new Promise(r => setTimeout(r, 50)); }
  throw new Error('postgres_fixture_wait_timeout');
}

test('PostgreSQL translator protects quoted placeholders/aliases and refuses unsupported SQLite syntax', () => {
  const translated = translatePilotSql("SELECT ? AS updatedAtMs,'?' AS literal -- ignored ?\n");
  assert.equal(translated.parameterCount, 1); assert.match(translated.sql, /\$1 AS "updatedAtMs"/); assert.match(translated.sql, /'\?'/);
  assert.match(translatePilotSql('CREATE TABLE journal(seq INTEGER PRIMARY KEY AUTOINCREMENT,source_ts INTEGER)').sql, /BIGSERIAL PRIMARY KEY,source_ts BIGINT/);
  assert.match(translatePilotSql('INSERT OR IGNORE INTO table_name VALUES(?)').sql, /ON CONFLICT DO NOTHING$/);
  assert.throws(() => translatePilotSql('PRAGMA writable_schema=ON'), /unsupported_postgres_sql/);
  assert.throws(() => translatePilotSql("SELECT json_extract(payload,'$.id') FROM events"), /unsupported_postgres_sql/);
});

test('PostgreSQL destination and TLS options are validated before opening a native connection', () => {
  for (const url of ['postgresql://localhost/example?host=203.0.113.9&sslmode=disable', 'postgresql://localhost/example?hostaddr=203.0.113.9', 'postgresql://localhost/example?service=hidden', 'postgresql://203.0.113.9/example?sslmode=verify-full&sslmode=disable', 'postgresql://localhost/example?options=-c%20sslmode=disable']) assert.throws(() => new PostgresDatabase({ connectionString: url }), /invalid_postgres_connection_option/);
  assert.throws(() => new PostgresDatabase({ connectionString: 'postgresql://203.0.113.9/example?sslmode=require' }), /postgres_verified_tls_required/);
});

test('actual PostgreSQL preserves clocks, atomic idempotency, hash chains, cases and restart receipts', enabled, t => {
  const fixtureState = fixture(t); let store = fixtureState.store;
  store.createSession('team', session()); store.createSession('other', session());
  const first = store.append('team', 'session', [event()])[0].evidence;
  assert.equal(typeof first.sourceTimestampMs, 'number'); assert.equal(first.sourceTimestampMs, at); assert.equal(first.capturedAtMs, at + 30); assert.equal(first.receivedAtMs, at + 100);
  const retry = store.append('team', 'session', [event('message', { capturedAtMs: at + 999 })])[0]; assert.equal(retry.inserted, false); assert.equal(retry.evidence.id, first.id);
  assert.throws(() => store.append('team', 'session', [event('new'), event('message', { text: 'Conflicting replacement' })]), /event_identity_conflict/);
  assert.equal(store.events('team', 'session').length, 1);
  const unknown = store.append('team', 'session', [event('speech', { kind: 'transcript', sourceTimestampMs: null, capturedAtMs: null, speakerId: 'anonymous_1' })])[0].evidence;
  assert.equal(unknown.sourceTimestampMs, null); assert.equal(unknown.account, null);
  store.assertAccount('team', unknown.id, { account: 'fictional_guest', reason: 'Operator comparison' }, 'owner');
  store.createCase('team', { id: 'case', title: 'Review', question: 'What was captured?' }, 'owner');
  assert.equal(store.linkEvidence('team', 'case', [first.id, unknown.id], 'owner').linked, 2);
  assert.equal(store.linkEvidence('team', 'case', [first.id], 'owner').linked, 0);
  const report = store.report('team', 'case'); assert.equal(store.verify('team', 'session').ok, true); assert.equal(report.evidence.length, 2);
  assert.throws(() => store.evidence('other', first.id), /evidence_not_found/);
  assert.throws(() => store.case('other', 'case'), /case_not_found/);
  const statement = fixtureState.database.prepare('SELECT started_at AS startedAtMs FROM sessions WHERE workspace=? AND id=?'); assert.equal(statement.get('team', 'session').startedAtMs, at);
  assert.equal(fixtureState.database.prepare('PRAGMA table_info("sessions")').all().some(c => c.name === 'started_at'), true);
  store = fixtureState.reopen(); const reopened = store.report('team', 'case'); assert.deepEqual(reopened.evidence, report.evidence); assert.deepEqual(reopened.sessions, report.sessions); assert.equal(store.evidence('team', first.id).receivedAtMs, at + 100); assert.equal(store.verify('team', 'session').ok, true);
});

test('actual PostgreSQL role/ACL/usage/audit controls enforce actual HTTP isolation', enabled, async t => {
  const { store, cleanup } = fixture(t);
  store.createSession('team', session()); const evidence = store.append('team', 'session', [event()])[0].evidence;
  const governance = new Governance({ store, members: [{ workspace: 'team', subject: 'owner', role: 'owner' }, { workspace: 'team', subject: 'viewer', role: 'viewer' }], now: () => at });
  const investigations = new InvestigationEngine({ store });
  store.createCase('team', { id: 'case', title: 'Private review', question: 'Review?' }, 'owner'); store.linkEvidence('team', 'case', [evidence.id], 'owner');
  governance.grantCase('team', 'case', { visibility: 'restricted', reason: 'Selected reviewer' }, 'owner');
  investigations.addNote('team', 'case', { text: 'Reviewed supporting context', evidenceIds: [evidence.id] }, 'owner');
  assert.equal(governance.authorize({ workspace: 'team', subject: 'owner' }, 'cases:read', { caseId: 'case' }).role, 'owner');
  governance.setLimits('team', { maxSpeechSeconds: 12, reason: 'Pilot entitlement' }, 'owner');
  assert.equal(governance.workspace('team').limits.maxSpeechSeconds, 12); assert.equal(governance.verifyAudit('team').valid, true);
  const server = createIntelligenceServer({ store, governance, investigation: investigations, keys: [{ token: 'o'.repeat(43), workspace: 'team', subject: 'owner', scopes: SCOPES }, { token: 'v'.repeat(43), workspace: 'team', subject: 'viewer', scopes: SCOPES }] });
  server.listen(0, '127.0.0.1'); await once(server, 'listening'); cleanup.push(async () => { server.closeAllConnections(); await new Promise(r => server.close(r)); });
  const base = 'http://127.0.0.1:' + server.address().port;
  const request = (path, token) => fetch(base + path, { headers: { Authorization: 'Bearer ' + token.repeat(43) } });
  assert.equal((await request('/v1/cases/case/report', 'v')).status, 403);
  assert.deepEqual((await (await request('/v1/cases', 'v')).json()).cases, []);
  governance.grantCase('team', 'case', { subject: 'viewer', permission: 'read', reason: 'Read permission' }, 'owner');
  assert.equal((await request('/v1/cases/case/report', 'v')).status, 200);
  governance.setMember('team', { subject: 'viewer', role: 'revoked' }, 'owner'); assert.equal((await request('/v1/sessions', 'v')).status, 403);
  assert.equal((await request('/v1/workspace/usage', 'o')).status, 200);
});

test('actual PostgreSQL records two independent media jobs, verifies archive/restore, and persists scheduler leases', enabled, async t => {
  const state = fixture(t), { store, root, cleanup } = state, input = join(root, 'source.mp4');
  const ffmpeg = existsSync(resolve('../../node_modules/ffmpeg-static/ffmpeg')) ? resolve('../../node_modules/ffmpeg-static/ffmpeg') : '/usr/bin/ffmpeg';
  await run(ffmpeg, ['-hide_banner', '-loglevel', 'error', '-f', 'lavfi', '-i', 'testsrc2=size=320x180:rate=12', '-f', 'lavfi', '-i', 'sine=frequency=500:sample_rate=16000', '-t', '5', '-c:v', 'libx264', '-threads', '1', '-preset', 'ultrafast', '-c:a', 'aac', '-y', input], { timeout: 15_000 });
  store.createSession('team', session('room_a')); store.createSession('team', session('room_b'));
  const recorder = new Recorder({ store, mediaRoot: join(root, 'media'), ffmpeg, intervalMs: 50, sources: ['a', 'b'].map(id => ({ id: 'source_' + id, workspace: 'team', sessionId: 'room_' + id, kind: 'file', input })) });
  cleanup.push(() => recorder.close());
  recorder.registerSource({ id: 'retained_source', workspace: 'team', sessionId: 'room_a', kind: 'file', input, label: 'Retained configured fixture' });
  assert.equal(store.db.prepare('SELECT count(*) AS n FROM recording_sources WHERE workspace=?').get('team').n, 1);
  const governance = new Governance({ store, recorder, members: [{ workspace: 'team', subject: 'owner', role: 'owner' }] }); recorder.admission = (workspace, additions) => governance.checkQuota(workspace, additions);
  const first = recorder.create('team', { id: 'job_a', sourceId: 'source_a', sessionId: 'room_a', maxDurationSeconds: 4, segmentSeconds: 2 });
  recorder.create('team', { id: 'job_b', sourceId: 'source_b', sessionId: 'room_b', maxDurationSeconds: 4, segmentSeconds: 2 });
  assert.equal(recorder.create('team', { id: 'job_a', sourceId: 'source_a', sessionId: 'room_a', maxDurationSeconds: 4, segmentSeconds: 2 }).id, first.id);
  recorder.start(); await until(() => ['completed', 'stopped', 'failed'].includes(recorder.job('team', 'job_a').state) && ['completed', 'stopped', 'failed'].includes(recorder.job('team', 'job_b').state));
  const jobA = recorder.job('team', 'job_a'), jobB = recorder.job('team', 'job_b'); assert.ok(jobA.segments.length); assert.ok(jobB.segments.length); assert.equal(jobA.sessionId, 'room_a'); assert.equal(jobB.sessionId, 'room_b');
  const retained = await recorder.media('team', 'job_a', jobA.segments[0].id), original = readFileSync(retained.path); assert.equal(original.length, jobA.segments[0].bytes);
  assert.ok(governance.usage('team').recordingSeconds > 0); assert.ok(governance.usage('team').storageBytes > 0);
  const archive = new MediaArchive({ store, recorder, storage: new EncryptedObjectStorage(new FilesystemObjectStorage(join(root, 'objects')), randomBytes(32)), intervalMs: 50 }); cleanup.push(() => archive.close());
  archive.create('team', { id: 'archive_a', recordingJobId: 'job_a', maxDurationSeconds: 30 }); archive.start(); await until(() => archive.job('team', 'archive_a').state === 'completed');
  rmSync(retained.path); await assert.rejects(recorder.media('team', 'job_a', jobA.segments[0].id));
  archive.restore('team', 'archive_a'); await until(() => archive.job('team', 'archive_a').restore.state === 'completed'); assert.deepEqual(readFileSync(retained.path), original);
  const adapter = new DirectMediaAdapter({ id: 'watch', workspace: 'team', kind: 'file', input, sessionId: 'room_b', sourceUrl: 'https://example.invalid/fixture' });
  const scheduler = new Scheduler({ store, recorder, adapters: [adapter] }); cleanup.push(() => scheduler.close());
  scheduler.create('team', { id: 'watch_mission', sourceId: 'watch', maxDurationSeconds: 4, segmentSeconds: 2, autoRecord: false });
  const row = store.db.prepare('SELECT * FROM collection_missions WHERE workspace=? AND id=?').get('team', 'watch_mission'); assert.equal(scheduler.claim(row), true);
  assert.equal(store.db.prepare('SELECT count(*) AS n FROM collection_mission_leases WHERE workspace=?').get('team').n, 1); scheduler.release(row);
  assert.equal(scheduler.mission('team', 'watch_mission').sourceId, 'watch');
  const check = state.database.prepare('SELECT bytes AS retainedBytes FROM media_segments WHERE workspace=? LIMIT ?').get('team', 1); assert.equal(typeof check.retainedBytes, 'number');
});
