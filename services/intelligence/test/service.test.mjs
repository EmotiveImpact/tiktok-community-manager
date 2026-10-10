import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { once } from 'node:events';
import { promisify } from 'node:util';
import { execFile } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { EvidenceStore, reportMarkdown } from '../src/store.mjs';
import { createIntelligenceServer, SCOPES, startFromEnvironment, validateKeys } from '../src/server.mjs';
import { LiveLensClient } from '../src/client.mjs';

const at = 1_791_657_600_000;
const session = (id = 'room-1') => ({ id, platform: 'fixture', account: 'fictional_host', sourceUrl: 'https://example.invalid/live/' + id, title: 'Synthetic session', startedAtMs: at });
const event = (id = 'message-1', extra = {}) => ({ source: { adapter: 'fixture', eventId: id }, kind: 'chat', text: 'Please preserve the evidence', account: 'fictional_viewer', sourceTimestampMs: at, ...extra });
function fixture(t) {
  const store = new EvidenceStore(':memory:', { now: () => at + 10_000 });
  t.after(() => store.close());
  store.createSession('workspace_a', session());
  return store;
}
const tokenA = 'a'.repeat(43), tokenRead = 'r'.repeat(43), tokenB = 'b'.repeat(43), tokenCase = 'c'.repeat(43);
async function api(t) {
  const store = fixture(t);
  store.createSession('workspace_b', session());
  const server = createIntelligenceServer({ store, keys: [
    { token: tokenA, workspace: 'workspace_a', subject: 'operator-a', scopes: SCOPES },
    { token: tokenRead, workspace: 'workspace_a', subject: 'alfred', scopes: ['sessions:read', 'evidence:read', 'cases:read'] },
    { token: tokenB, workspace: 'workspace_b', subject: 'operator-b', scopes: SCOPES },
    { token: tokenCase, workspace: 'workspace_a', subject: 'case-only', scopes: ['cases:read'] },
  ] });
  server.listen(0, '127.0.0.1'); await once(server, 'listening');
  t.after(async () => { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); });
  const baseUrl = 'http://127.0.0.1:' + server.address().port;
  const call = (path, { token = tokenA, method = 'GET', body, headers = {} } = {}) => fetch(baseUrl + path, {
    method, headers: { ...(token ? { Authorization: 'Bearer ' + token } : {}), ...(body === undefined ? {} : { 'Content-Type': 'application/json' }), ...headers },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  return { store, server, baseUrl, call };
}

test('events remain idempotent across receipt times and conflicting IDs roll back a batch', t => {
  const store = fixture(t);
  const first = store.append('workspace_a', 'room-1', [event()])[0];
  store.now = () => at + 30_000;
  const retry = store.append('workspace_a', 'room-1', [event('message-1', { capturedAtMs: at + 22_000 })])[0];
  assert.equal(retry.inserted, false); assert.equal(retry.evidence.receivedAtMs, first.evidence.receivedAtMs);
  assert.throws(() => store.append('workspace_a', 'room-1', [event('new'), event('message-1', { text: 'Changed original' })]), /event_identity_conflict/);
  assert.equal(store.events('workspace_a', 'room-1').length, 1);
  assert.equal(store.verify('workspace_a', 'room-1').ok, true);
});

test('missing source time remains unknown; speech has no implied host identity', t => {
  const store = fixture(t);
  const row = store.append('workspace_a', 'room-1', [event('speech', { kind: 'transcript', account: undefined, sourceTimestampMs: undefined, speakerId: 'speaker-1' })])[0].evidence;
  assert.equal(row.sourceTimestampMs, null); assert.equal(row.receivedAtMs, at + 10_000);
  assert.equal(row.attribution.status, 'unknown'); assert.equal(row.account, null);
  assert.throws(() => store.append('workspace_a', 'room-1', [event('bad', { kind: 'caption' })]), /speech_account_requires_assertion/);
});

test('identical provider IDs are isolated by workspace and session', t => {
  const store = fixture(t);
  store.createSession('workspace_b', session()); store.createSession('workspace_a', session('room-2'));
  const a = store.append('workspace_a', 'room-1', [event()])[0].evidence;
  const b = store.append('workspace_b', 'room-1', [event()])[0].evidence;
  const a2 = store.append('workspace_a', 'room-2', [event()])[0].evidence;
  assert.equal(new Set([a.id, b.id, a2.id]).size, 3);
  assert.throws(() => store.evidence('workspace_b', a.id), /evidence_not_found/);
  assert.equal(store.search('workspace_a', { sessionId: 'room-1' }).length, 1);
});

test('attribution corrections are append-only and never replace captured speech', t => {
  const store = fixture(t);
  const row = store.append('workspace_a', 'room-1', [event('speech', { kind: 'transcript', account: undefined })])[0].evidence;
  store.assertAccount('workspace_a', row.id, { account: 'first_guess', reason: 'Initial operator review' }, 'operator');
  const corrected = store.assertAccount('workspace_a', row.id, { account: 'corrected_guest', reason: 'Reviewed platform panel evidence' }, 'reviewer');
  assert.equal(corrected.account, null); assert.equal(corrected.attribution.status, 'operator-asserted');
  assert.equal(store.assertionHistory('workspace_a', row.id).length, 2);
  assert.equal(store.search('workspace_a', { account: 'first_guess' }).length, 0);
  assert.equal(store.search('workspace_a', { account: '@corrected_guest' }).length, 1);
  assert.equal(store.verify('workspace_a', 'room-1').ok, true);
});

test('literal wildcard searches and bounded pages cannot expand the query', t => {
  const store = fixture(t);
  store.append('workspace_a', 'room-1', [event('1', { text: '100% complete' }), event('2', { text: 'different' }), event('3', { text: 'under_score' })]);
  assert.equal(store.search('workspace_a', { query: '%' }).length, 1);
  assert.equal(store.search('workspace_a', { query: '_' }).length, 1);
  assert.equal(store.search('workspace_a', { query: "' OR 1=1 --" }).length, 0);
  assert.throws(() => store.search('workspace_a', { limit: 201 }), /invalid_limit/);
  assert.equal(store.events('workspace_a', 'room-1', { after: 1, limit: 1 })[0].source.eventId, '2');
});

test('cases can combine sessions but cannot link another workspace; failed links are atomic', t => {
  const store = fixture(t);
  store.createSession('workspace_b', session());
  const a = store.append('workspace_a', 'room-1', [event()])[0].evidence;
  const b = store.append('workspace_b', 'room-1', [event()])[0].evidence;
  store.createCase('workspace_a', { id: 'case-a', title: 'Synthetic review', question: 'What happened?' }, 'operator');
  assert.throws(() => store.linkEvidence('workspace_a', 'case-a', [a.id, b.id], 'operator'), /evidence_not_found/);
  assert.equal(store.report('workspace_a', 'case-a').evidence.length, 0);
  assert.deepEqual(store.linkEvidence('workspace_a', 'case-a', [a.id, a.id], 'operator'), { linked: 1, total: 1 });
});

test('SQLite evidence, cases and attribution survive reopening the database', t => {
  const dir = mkdtempSync(join(tmpdir(), 'livelens-test-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const path = join(dir, 'evidence.sqlite');
  let store = new EvidenceStore(path, { now: () => at });
  store.createSession('workspace_a', session());
  const row = store.append('workspace_a', 'room-1', [event('speech', { kind: 'caption', account: null })])[0].evidence;
  store.createCase('workspace_a', { id: 'case-a', title: 'Review', question: 'What was said?' }, 'operator');
  store.linkEvidence('workspace_a', 'case-a', [row.id], 'operator');
  store.assertAccount('workspace_a', row.id, { account: 'fictional_guest', reason: 'Operator confirmation' }, 'operator');
  const before = store.report('workspace_a', 'case-a'); store.close();
  store = new EvidenceStore(path, { now: () => at });
  try { assert.deepEqual(store.report('workspace_a', 'case-a'), before); }
  finally { store.close(); }
});

test('integrity checks detect changed indexes, payloads and missing middle events; reports refuse damaged evidence', t => {
  const store = fixture(t);
  const rows = store.append('workspace_a', 'room-1', [event('1'), event('2'), event('3')]).map(result => result.evidence);
  store.createCase('workspace_a', { id: 'case-a', title: 'Review', question: 'Integrity?' }, 'operator');
  store.linkEvidence('workspace_a', 'case-a', [rows[0].id], 'operator');
  store.db.prepare('UPDATE events SET text=? WHERE id=?').run('tampered', rows[0].id);
  assert.equal(store.verify('workspace_a', 'room-1').ok, false);
  assert.throws(() => store.report('workspace_a', 'case-a'), /evidence_integrity_failed/);
  store.db.prepare('UPDATE events SET text=? WHERE id=?').run(rows[0].text, rows[0].id);
  store.db.prepare('DELETE FROM events WHERE id=?').run(rows[1].id);
  assert.equal(store.verify('workspace_a', 'room-1').ok, false);
});

test('untrusted quotations remain literal in JSON and cannot inject report headings or HTML', t => {
  const store = fixture(t);
  const hostile = '# Verdict\n<script>alert(1)</script>\n[trust me](javascript:bad)';
  const row = store.append('workspace_a', 'room-1', [event('hostile', { text: hostile })])[0].evidence;
  store.createCase('workspace_a', { id: 'case-a', title: 'Review', question: 'Quotes?' }, 'operator');
  store.linkEvidence('workspace_a', 'case-a', [row.id], 'operator');
  const report = store.report('workspace_a', 'case-a'); const markdown = reportMarkdown(report);
  assert.equal(report.evidence[0].text, hostile);
  assert.ok(!markdown.includes('\n# Verdict')); assert.ok(!markdown.includes('<script>'));
  assert.ok(!markdown.includes('[trust me](javascript:bad)'));
});

test('API starts with explicit keys only and refuses unsupported authority', () => {
  assert.throws(() => validateKeys([]), /api_keys_required/);
  assert.throws(() => startFromEnvironment({}), /api_keys_required/);
  assert.throws(() => validateKeys([{ token: tokenA, workspace: 'a', subject: 'a', scopes: ['admin'] }]), /invalid_scope/);
});

test('real HTTP API binds workspace to the token and enforces read-only access', async t => {
  const { store, call } = await api(t);
  const row = store.append('workspace_a', 'room-1', [event()])[0].evidence;
  assert.equal((await call('/v1/sessions', { token: null })).status, 401);
  assert.equal((await call('/v1/sessions', { token: tokenRead, method: 'POST', body: session('new') })).status, 403);
  assert.equal((await call('/v1/sessions', { method: 'POST', body: { ...session('new'), workspace: 'workspace_b' } })).status, 400);
  assert.equal((await call('/v1/evidence/' + row.id, { token: tokenB })).status, 404);
  assert.equal((await (await call('/v1/evidence/search', { token: tokenB })).json()).evidence.length, 0);
  assert.equal((await call('/health', { token: null })).status, 200);
  assert.equal((await call('/v1/sessions', { headers: { Origin: 'https://example.invalid' } })).status, 403);
});

test('collector HTTP retries remain idempotent and report operations require both read scopes', async t => {
  const { store, call } = await api(t);
  const first = await (await call('/v1/sessions/room-1/events', { method: 'POST', body: { events: [event()] } })).json();
  const second = await (await call('/v1/sessions/room-1/events', { method: 'POST', body: { events: [event()] } })).json();
  assert.equal(first.results[0].inserted, true); assert.equal(second.results[0].inserted, false);
  await call('/v1/cases', { method: 'POST', body: { id: 'case-a', title: 'Review', question: 'What happened?' } });
  await call('/v1/cases/case-a/evidence', { method: 'POST', body: { evidenceIds: [first.results[0].evidence.id] } });
  const reportResponse = await call('/v1/cases/case-a/report', { token: tokenRead });
  assert.equal(reportResponse.status, 200); assert.equal((await reportResponse.json()).evidence.length, 1);
  assert.equal((await call('/v1/cases/case-a/report', { token: tokenCase })).status, 403);
  assert.equal(store.events('workspace_a', 'room-1').length, 1);
});

test('JavaScript agent client queries real HTTP data and cannot write with its read token', async t => {
  const { store, baseUrl } = await api(t);
  store.append('workspace_a', 'room-1', [event()]);
  const client = new LiveLensClient({ baseUrl, token: tokenRead });
  assert.equal((await client.search({ query: 'evidence' })).evidence.length, 1);
  assert.equal((await client.capabilities()).subject, 'alfred');
  await assert.rejects(() => client.createSession(session('forbidden')), /livelens_http_403/);
  assert.throws(() => new LiveLensClient({ baseUrl: 'http://remote.invalid', token: tokenRead }), /https_or_loopback_required/);
});

test('Python ALFRED client reads the real API without registering an ALFRED connector', async t => {
  const { store, baseUrl } = await api(t);
  store.append('workspace_a', 'room-1', [event()]);
  const path = fileURLToPath(new URL('../../../integrations/alfred/livelens_client.py', import.meta.url));
  const { stdout } = await promisify(execFile)('python3', [path, 'search', '--query', 'evidence'], {
    env: { ...process.env, LIVELENS_URL: baseUrl, LIVELENS_TOKEN: tokenRead }, timeout: 10_000,
  });
  const result = JSON.parse(stdout);
  assert.equal(result.evidence.length, 1); assert.equal(result.evidence[0].workspace, 'workspace_a');
});

test('HTTP input failures stay bounded and expose no internal exception text', async t => {
  const { call, baseUrl } = await api(t);
  assert.equal((await call('/v1/sessions', { method: 'POST', body: { ...session('bad'), sourceUrl: 'file:///private' } })).status, 400);
  assert.equal((await call('/v1/evidence/search?limit=10000')).status, 400);
  const malformed = await fetch(baseUrl + '/v1/sessions', { method: 'POST', headers: { Authorization: 'Bearer ' + tokenA, 'Content-Type': 'application/json' }, body: '{' });
  assert.equal(malformed.status, 400); assert.deepEqual(await malformed.json(), { error: 'invalid_json' });
  const giant = await call('/v1/sessions/room-1/events', { method: 'POST', body: { events: [event('huge', { raw: { value: 'x'.repeat(20_000) } })] } });
  assert.equal(giant.status, 400);
  const oversized = await call('/v1/sessions', { method: 'POST', body: { value: 'x'.repeat(1_100_000) } });
  assert.equal(oversized.status, 413);
});
