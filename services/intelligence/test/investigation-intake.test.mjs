import test from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { randomUUID } from 'node:crypto';
import { EvidenceStore } from '../src/store.mjs';
import { InvestigationEngine } from '../src/investigations.mjs';
import { Governance } from '../src/governance.mjs';
import { PostgresDatabase } from '../src/postgres-db.mjs';
import { createIntelligenceServer, SCOPES } from '../src/server.mjs';

const at = 1_791_657_600_000;
const session = id => ({ id, platform: 'fixture', title: 'Synthetic retained conversation', sourceUrl: 'https://example.invalid/' + id, startedAtMs: at });
const event = (id, extra = {}) => ({ source: { adapter: 'fixture', eventId: id }, kind: 'chat', text: 'Original fixture words', account: 'viewer', sourceTimestampMs: null, capturedAtMs: at + 20, ...extra });

function fixture(t, backend) {
  let database, schema;
  if (backend === 'PostgreSQL') {
    schema = 'll_intake_' + randomUUID().replaceAll('-', '');
    database = new PostgresDatabase({ connectionString: process.env.LIVELENS_TEST_POSTGRES_URL, schema });
  }
  const store = new EvidenceStore(':memory:', { database, now: () => at + 100 });
  t.after(() => { if (schema) database.exec('DROP SCHEMA "' + schema + '" CASCADE'); store.close(); });
  const investigation = new InvestigationEngine({ store, now: () => at + 200 });
  const governance = new Governance({ store, members: [
    { workspace: 'alpha', subject: 'owner', role: 'owner' },
    { workspace: 'alpha', subject: 'analyst', role: 'analyst' },
    { workspace: 'alpha', subject: 'viewer', role: 'viewer' },
    { workspace: 'beta', subject: 'owner', role: 'owner' },
  ], now: () => at + 300 });
  for (const workspace of ['alpha', 'beta']) store.createSession(workspace, session('room'));
  store.createSession('alpha', session('other-room'));
  return { store, investigation, governance };
}

async function api(t, options) {
  const definitions = {
    owner: { workspace: 'alpha', subject: 'owner', scopes: SCOPES },
    analyst: { workspace: 'alpha', subject: 'analyst', scopes: SCOPES },
    viewer: { workspace: 'alpha', subject: 'viewer', scopes: SCOPES },
    readonly: { workspace: 'alpha', subject: 'owner', scopes: ['cases:read', 'evidence:read'] },
    casewriter: { workspace: 'alpha', subject: 'analyst', scopes: ['cases:write', 'cases:read'] },
    evidence: { workspace: 'alpha', subject: 'owner', scopes: ['evidence:read'] },
    beta: { workspace: 'beta', subject: 'owner', scopes: SCOPES },
  };
  const tokens = Object.fromEntries(Object.keys(definitions).map((key, i) => [key, String.fromCharCode(97 + i).repeat(43)]));
  const server = createIntelligenceServer({ ...options, keys: Object.entries(definitions).map(([name, principal]) => ({ ...principal, token: tokens[name] })) });
  server.listen(0, '127.0.0.1'); await once(server, 'listening');
  t.after(async () => { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); });
  return async (path, principal = 'owner', body) => {
    const response = await fetch('http://127.0.0.1:' + server.address().port + path, {
      method: body === undefined ? 'GET' : 'POST',
      headers: { ...(principal === null ? {} : { Authorization: 'Bearer ' + tokens[principal] }), ...(body === undefined ? {} : { 'Content-Type': 'application/json' }) },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    return { status: response.status, body: await response.json() };
  };
}

for (const backend of ['SQLite', 'PostgreSQL']) {
  const options = { skip: backend === 'PostgreSQL' && !process.env.LIVELENS_TEST_POSTGRES_URL };

  test(backend + ': intake search filters the complete journal before lookahead pages', options, async t => {
    const setup = fixture(t, backend), { store } = setup, expected = [];
    for (let batch = 0; batch < 3; batch++) {
      const rows = store.append('alpha', 'room', Array.from({ length: 100 }, (_, i) => event('early-' + (batch * 100 + i), { text: i % 2 ? 'Other text' : 'Retained NEEDLE ' + i, kind: i % 5 ? 'chat' : 'observation' }))).map(item => item.evidence);
      expected.push(...rows.filter(row => row.text.includes('NEEDLE') && row.kind === 'chat'));
      store.append('alpha', 'other-room', [event('separate-' + batch, { text: 'Needle separate session' })]);
      store.append('beta', 'room', [event('foreign-' + batch, { text: 'Needle other workspace' })]);
    }
    store.append('alpha', 'room', Array.from({ length: 200 }, (_, i) => event('newer-' + i)));
    const call = await api(t, setup), collected = [];
    let offset = 0;
    do {
      const result = await call('/v1/evidence/search?q=needle&kind=chat&session=room&limit=17&offset=' + offset);
      assert.equal(result.status, 200);
      const page = result.body;
      assert.ok(page.evidence.length <= 17);
      collected.push(...page.evidence);
      assert.equal(page.hasMore, page.nextOffset !== null);
      if (!page.hasMore) break;
      assert.equal(page.nextOffset, offset + 17); offset = page.nextOffset;
    } while (offset < 1000);
    assert.deepEqual(collected, expected.reverse());
    assert.equal(new Set(collected.map(row => row.id)).size, 120);
    assert.deepEqual((await call('/v1/evidence/search?q=needle&kind=chat&session=room&offset=120')).body, { evidence: [], hasMore: false, nextOffset: null });
    const exact = await call('/v1/evidence/search?q=needle&kind=chat&session=room&limit=120');
    assert.equal(exact.body.hasMore, false); assert.equal(exact.body.nextOffset, null);
    assert.equal(collected[0].sourceTimestampMs, null);
    assert.equal(collected[0].capturedAtMs, at + 20); assert.equal(collected[0].receivedAtMs, at + 100);
  });

  test(backend + ': literal text and exact current-account filters preserve originals', options, async t => {
    const setup = fixture(t, backend), { store } = setup;
    const rows = store.append('alpha', 'room', [
      event('percent', { text: '100% COMPLETE' }), event('underscore', { text: 'under_score' }),
      event('slash', { text: 'folder\\capture' }), event('combined', { text: 'literal \\%_ together' }),
      event('speaker', { kind: 'transcript', text: 'Independent speech', account: null, speakerId: 'anonymous_track' }),
    ]).map(item => item.evidence);
    const call = await api(t, setup);
    const ids = async query => (await call('/v1/evidence/search?q=' + encodeURIComponent(query))).body.evidence.map(row => row.source.eventId);
    assert.deepEqual(await ids('%'), ['combined', 'percent']);
    assert.deepEqual(await ids('_'), ['combined', 'underscore']);
    assert.deepEqual(await ids('\\'), ['combined', 'slash']);
    assert.deepEqual(await ids('\\%_'), ['combined']);
    assert.deepEqual(await ids('100% complete'), ['percent']);
    assert.deepEqual(await ids("' OR 1=1 --"), []);
    assert.deepEqual(await ids('viewer'), []); assert.deepEqual(await ids('anonymous_track'), []);
    const original = rows.at(-1);
    store.assertAccount('alpha', original.id, { account: 'old_guest', reason: 'Initial assertion' }, 'owner');
    store.assertAccount('alpha', original.id, { account: 'current_guest', reason: 'Corrected assertion' }, 'owner');
    assert.deepEqual((await call('/v1/evidence/search?account=old_guest')).body.evidence, []);
    const current = (await call('/v1/evidence/search?account=%40CURRENT_GUEST&kind=transcript&q=speech')).body.evidence;
    assert.equal(current.length, 1); assert.equal(current[0].id, original.id);
    assert.equal(current[0].account, null); assert.equal(current[0].attribution.account, 'current_guest');
    assert.deepEqual(current[0].integrity, original.integrity); assert.equal(current[0].text, original.text);
    assert.equal(store.verify('alpha', 'room').ok, true);
  });

  test(backend + ': saved-moment search pages and opt-in originals are complete and scoped', options, async t => {
    const setup = fixture(t, backend), { store, investigation } = setup, expected = [];
    for (let batch = 0; batch < 3; batch++) {
      const rows = store.append('alpha', 'room', Array.from({ length: 60 }, (_, i) => event('saved-' + (batch * 60 + i), { kind: i % 2 ? 'chat' : 'observation', text: i < 5 ? 'Captured rare phrase' : 'Ordinary captured phrase' }))).map(item => item.evidence);
      for (let index = 0; index < rows.length; index++) {
        const label = index < 8 ? 'Review 100% \\ under_score' : 'Routine mark';
        const saved = investigation.bookmark('alpha', rows[index].id, { label }, 'owner');
        if (index < 8 && rows[index].kind === 'observation') expected.push({ ...saved, evidence: rows[index] });
      }
    }
    const foreign = store.append('beta', 'room', [event('saved-foreign')])[0].evidence;
    investigation.bookmark('beta', foreign.id, { label: 'Review 100% \\ under_score' }, 'owner');
    expected.sort((a, b) => b.createdAtMs - a.createdAtMs || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
    const call = await api(t, setup), collected = [];
    for (let offset = 0; offset < 12; offset += 5) {
      const result = await call('/v1/bookmarks?q=100%25&kind=observation&session=room&account=viewer&includeEvidence=true&limit=5&offset=' + offset);
      assert.equal(result.status, 200); collected.push(...result.body.bookmarks);
      assert.equal(result.body.hasMore, offset < 10);
    }
    assert.deepEqual(collected, expected);
    const basic = await call('/v1/bookmarks?q=under_score&kind=observation&limit=1');
    const { evidence: _original, ...mark } = expected[0];
    assert.deepEqual(basic.body.bookmarks, [mark]);
    assert.equal(investigation.bookmarks('alpha', { query: 'under_score', kind: 'observation', limit: 1 })[0].evidence, undefined);
    assert.equal((await call('/v1/bookmarks?q=rare%20phrase&includeEvidence=true&limit=200')).body.bookmarks.length, 15);
    assert.equal((await call('/v1/bookmarks?q=100%25&session=other-room')).body.bookmarks.length, 0);
    assert.equal((await call('/v1/bookmarks?includeEvidence=true', 'beta')).body.bookmarks[0].evidence.id, foreign.id);
  });

  test(backend + ': case visibility and literal question search precede pagination with truthful write access', options, async t => {
    const setup = fixture(t, backend), { store, governance } = setup;
    for (let i = 0; i < 220; i++) {
      const id = 'hidden-' + String(i).padStart(3, '0');
      store.createCase('alpha', { id, title: 'Sensitive question', question: 'Needle hidden question' }, 'owner');
      store.db.prepare('INSERT INTO case_access_policy VALUES(?,?,?)').run('alpha', id, 'restricted');
    }
    const owner = { workspace: 'alpha', subject: 'owner' };
    for (const [id, creator] of [['z-shared', 'owner'], ['z-owned', 'analyst'], ['z-read', 'owner'], ['z-write', 'owner']]) {
      store.createCase('alpha', { id, title: 'Review 100% \\ under_score', question: 'NEEDLE observed question' }, creator);
      if (id !== 'z-shared') governance.grantCase('alpha', id, { visibility: 'restricted', reason: 'Fixture policy' }, owner);
    }
    governance.grantCase('alpha', 'z-read', { subject: 'analyst', permission: 'read', reason: 'Fixture read grant' }, owner);
    governance.grantCase('alpha', 'z-write', { subject: 'analyst', permission: 'write', reason: 'Fixture write grant' }, owner);
    store.createCase('beta', { id: 'foreign', title: 'Review 100%', question: 'Needle other workspace' }, 'owner');
    const call = await api(t, setup);
    assert.equal((await call('/v1/capabilities', 'analyst')).body.permissions.createCases, true);
    assert.equal((await call('/v1/capabilities', 'viewer')).body.permissions.createCases, false);
    assert.equal((await call('/v1/capabilities', 'readonly')).body.permissions.createCases, false);
    assert.equal((await call('/v1/capabilities', 'casewriter')).body.permissions.createCases, true);
    const first = await call('/v1/cases?q=needle&limit=2', 'analyst');
    assert.equal(first.status, 200); assert.equal(first.body.hasMore, true); assert.equal(first.body.nextOffset, 2);
    assert.deepEqual(first.body.cases.map(row => [row.id, row.canWrite]), [['z-owned', true], ['z-read', false]]);
    const second = await call('/v1/cases?q=needle&limit=2&offset=2', 'analyst');
    assert.deepEqual(second.body.cases.map(row => [row.id, row.canWrite]), [['z-shared', true], ['z-write', true]]);
    assert.equal(second.body.hasMore, false); assert.equal(second.body.nextOffset, null);
    assert.equal((await call('/v1/cases?limit=200', 'owner')).body.hasMore, true);
    for (const query of ['%', '\\', 'under_score']) assert.equal((await call('/v1/cases?q=' + encodeURIComponent(query), 'analyst')).body.cases.length, 4);
    assert.equal((await call('/v1/cases/z-read', 'analyst')).body.canWrite, false);
    assert.equal((await call('/v1/investigations/z-write', 'analyst')).body.case.canWrite, true);
    assert.equal((await call('/v1/investigations/z-read', 'analyst')).body.case.canWrite, false);
    assert.equal((await call('/v1/cases/z-shared', 'viewer')).body.canWrite, false);
    assert.equal((await call('/v1/cases/z-write', 'readonly')).body.canWrite, false);
    assert.equal((await call('/v1/cases/hidden-000', 'analyst')).status, 403);
    assert.deepEqual((await call('/v1/cases?subject=owner&workspace=beta', 'analyst')).body.cases.map(row => row.id), ['z-owned', 'z-read', 'z-shared', 'z-write']);
    governance.setMember('alpha', { subject: 'analyst', role: 'revoked' }, owner);
    assert.equal((await call('/v1/cases', 'analyst')).status, 403);
  });

  test(backend + ': batch evidence linking is deduplicated, atomic and enforced at current case authority', options, async t => {
    const setup = fixture(t, backend), { store, governance } = setup;
    const [a, b] = store.append('alpha', 'room', [event('a'), event('b')]).map(item => item.evidence);
    const c = store.append('alpha', 'other-room', [event('c')])[0].evidence;
    const foreign = store.append('beta', 'room', [event('foreign')])[0].evidence;
    store.createCase('alpha', { id: 'case', title: 'Question', question: 'What is retained?' }, 'owner');
    const call = await api(t, setup), path = '/v1/cases/case/evidence';
    assert.deepEqual((await call(path, 'owner', { evidenceIds: [a.id, a.id, b.id] })).body, { linked: 2, total: 2, existing: 0 });
    assert.deepEqual((await call(path, 'owner', { evidenceIds: [a.id, c.id, c.id] })).body, { linked: 1, total: 3, existing: 1 });
    assert.deepEqual((await call(path, 'owner', { evidenceIds: [a.id, b.id, c.id] })).body, { linked: 0, total: 3, existing: 3 });
    const newEvent = store.append('alpha', 'room', [event('unlinked')])[0].evidence;
    for (const ids of [[newEvent.id, foreign.id], [newEvent.id, 'missing']]) {
      assert.equal((await call(path, 'owner', { evidenceIds: ids })).status, 404);
      assert.equal(store.report('alpha', 'case').evidence.length, 3);
    }
    for (const ids of [[], [newEvent.id, 'bad identifier'], Array(201).fill(a.id), null]) assert.equal((await call(path, 'owner', { evidenceIds: ids })).status, 400);
    assert.equal((await call(path, 'readonly', { evidenceIds: [newEvent.id] })).status, 403);
    assert.equal((await call(path, 'casewriter', { evidenceIds: [newEvent.id] })).status, 403);
    governance.grantCase('alpha', 'case', { visibility: 'restricted', reason: 'Changed current policy' }, { workspace: 'alpha', subject: 'owner' });
    assert.equal((await call(path, 'analyst', { evidenceIds: [newEvent.id] })).status, 403);
    governance.grantCase('alpha', 'case', { subject: 'analyst', permission: 'read', reason: 'Read only' }, { workspace: 'alpha', subject: 'owner' });
    assert.equal((await call(path, 'analyst', { evidenceIds: [newEvent.id] })).status, 403);
    assert.equal(store.report('alpha', 'case').evidence.length, 3);
  });

  test(backend + ': conversation create-and-link commits together and cannot grant evidence read', options, async t => {
    const setup = fixture(t, backend), { store } = setup;
    const own = store.append('alpha', 'room', [event('a')])[0].evidence;
    const foreign = store.append('beta', 'room', [event('foreign')])[0].evidence;
    const call = await api(t, setup);
    const create = (id, evidenceIds) => ({ id, title: 'New investigation', question: 'What supports the question?', evidenceIds });
    assert.equal((await call('/v1/cases', 'owner', create('created', [own.id, own.id]))).status, 201);
    assert.deepEqual(store.report('alpha', 'created').evidence.map(row => row.id), [own.id]);
    for (const [id, ids, status] of [['foreign-case', [own.id, foreign.id], 404], ['missing-case', [own.id, 'missing'], 404], ['invalid-case', [own.id, 'invalid id'], 400], ['large-case', Array(201).fill(own.id), 400], ['null-case', null, 400]]) {
      assert.equal((await call('/v1/cases', 'owner', create(id, ids))).status, status);
      assert.throws(() => store.case('alpha', id), /case_not_found/);
    }
    assert.equal((await call('/v1/cases', 'casewriter', create('scope-refused', [own.id]))).status, 403);
    assert.throws(() => store.case('alpha', 'scope-refused'), /case_not_found/);
    assert.equal((await call('/v1/cases', 'casewriter', create('empty-allowed', []))).status, 201);
    assert.equal((await call('/v1/cases', 'casewriter', { id: 'plain-allowed', title: 'Plain', question: 'Question' })).status, 201);
    assert.equal((await call('/v1/cases', 'readonly', create('readonly-refused', [own.id]))).status, 403);
    assert.equal((await call('/v1/cases', 'owner', create('created', []))).status, 409);
    assert.deepEqual(store.report('alpha', 'created').evidence.map(row => row.id), [own.id]);
  });

  test(backend + ': full-case capacity refusals leave all proposed links absent', options, t => {
    const { store } = fixture(t, backend), all = [];
    store.createCase('alpha', { id: 'full', title: 'Bounded case', question: 'Keep the current evidence?' }, 'owner');
    for (let batch = 0; batch < 5; batch++) {
      const ids = store.append('alpha', 'room', Array.from({ length: 200 }, (_, index) => event('capacity-' + (batch * 200 + index)))).map(row => row.evidence.id);
      all.push(...ids);
      store.linkEvidence('alpha', 'full', batch === 4 ? ids.slice(0, 199) : ids, 'owner');
    }
    const extra = store.append('alpha', 'room', [event('capacity-extra')])[0].evidence.id;
    assert.throws(() => store.linkEvidence('alpha', 'full', [all.at(-1), extra], 'owner'), /case_evidence_capacity/);
    const count = () => store.db.prepare('SELECT count(*) AS n FROM case_events WHERE workspace=? AND case_id=?').get('alpha', 'full').n;
    assert.equal(count(), 999);
    assert.deepEqual(store.linkEvidence('alpha', 'full', [all[0], all.at(-1), all.at(-1)], 'owner'), { linked: 1, total: 1000, existing: 1 });
    assert.throws(() => store.linkEvidence('alpha', 'full', [all[0], extra], 'owner'), /case_evidence_capacity/);
    assert.equal(count(), 1000);
    assert.deepEqual(store.linkEvidence('alpha', 'full', [all[0], all[0]], 'owner'), { linked: 0, total: 1000, existing: 1 });
  });

  test(backend + ': review intake enforces its 200-original budget atomically while legacy exports retain 1000', options, async t => {
    const setup = fixture(t, backend), { store, investigation } = setup;
    const ids = store.append('alpha', 'room', Array.from({ length: 200 }, (_, index) => event('review-' + index))).map(row => row.evidence.id);
    ids.push(...store.append('alpha', 'room', [event('review-extra'), event('review-one-more')]).map(row => row.evidence.id));
    store.createCase('alpha', { id: 'review', title: 'Review budget', question: 'Keep the review usable?', evidenceIds: ids.slice(0, 199) }, 'owner');
    const call = await api(t, setup), path = '/v1/cases/review/evidence';
    const count = () => store.db.prepare('SELECT count(*) AS n FROM case_events WHERE workspace=? AND case_id=?').get('alpha', 'review').n;
    const refused = await call(path, 'owner', { evidenceIds: ids.slice(199, 201), forReview: true });
    assert.equal(refused.status, 409); assert.equal(refused.body.error, 'investigation_evidence_capacity');
    assert.equal(count(), 199);
    const competing = await Promise.all([
      call(path, 'owner', { evidenceIds: [ids[0], ids[199], ids[199]], forReview: true }),
      call(path, 'owner', { evidenceIds: [ids[200]], forReview: true }),
    ]);
    assert.deepEqual(competing.map(row => row.status).sort(), [200, 409]);
    assert.equal(count(), 200);
    assert.equal(competing.find(row => row.status === 409).body.error, 'investigation_evidence_capacity');
    assert.deepEqual((await call(path, 'owner', { evidenceIds: [ids[0], ids[0]], forReview: true })).body, { linked: 0, total: 200, existing: 1 });
    let detail = (await call('/v1/investigations/review')).body;
    assert.equal(detail.totalEvidence, 200); assert.equal(detail.reviewEvidenceLimit, 200);
    assert.equal(detail.evidence.length, 200); assert.equal(detail.truncated, false);
    // The final valid intake remains usable by the actual downstream review engine.
    investigation.addNote('alpha', 'review', { text: 'A note against a retained original', evidenceIds: [ids[0]] }, 'owner');
    investigation.createFinding('alpha', 'review', { title: 'Reviewable finding', statement: 'Supported fixture interpretation', supportEvidenceIds: [ids[0]] }, 'owner');
    for (const forReview of [null, 0, 1, 'true', 'false', [], {}]) {
      const invalid = await call(path, 'owner', { evidenceIds: [ids[0]], forReview });
      assert.equal(invalid.status, 400); assert.equal(invalid.body.error, 'invalid_for_review');
    }
    assert.equal(count(), 200);
    const legacy = await call(path, 'owner', { evidenceIds: [ids[201]], forReview: false });
    assert.equal(legacy.status, 200); assert.equal(legacy.body.total, 201);
    detail = (await call('/v1/investigations/review')).body;
    assert.equal(detail.totalEvidence, 201); assert.equal(detail.truncated, true);
    assert.equal((await call(path, 'owner', { evidenceIds: [ids[0]], forReview: true })).status, 409);
    assert.deepEqual((await call(path, 'owner', { evidenceIds: [ids[0]] })).body, { linked: 0, total: 201, existing: 1 });
  });

  test(backend + ': intake pagination rejects invalid filters and never widens token scope', options, async t => {
    const setup = fixture(t, backend), call = await api(t, setup);
    const evidence = setup.store.append('alpha', 'room', [event('a')])[0].evidence;
    setup.investigation.bookmark('alpha', evidence.id, { label: 'Saved' }, 'owner');
    for (const route of ['/v1/evidence/search', '/v1/bookmarks', '/v1/cases']) {
      for (const query of ['limit=201', 'limit=0', 'limit=1.5', 'offset=-1', 'offset=0.5', 'offset=bad', 'offset=9007199254740992', 'q=' + 'x'.repeat(513), 'q=%00']) {
        assert.equal((await call(route + '?' + query)).status, 400, route + '?' + query);
      }
      assert.equal((await call(route, null)).status, 401);
    }
    for (const route of ['/v1/evidence/search', '/v1/bookmarks']) {
      for (const query of ['kind=', 'kind=CHAT', 'kind=unknown', 'session=', 'account=', 'account=bad%20handle']) assert.equal((await call(route + '?' + query)).status, 400, query);
      assert.equal((await call(route + '?session=missing')).status, 404);
      assert.equal((await call(route, 'casewriter')).status, 403);
      assert.equal((await call(route, 'evidence')).status, 200);
      assert.equal((await call(route + '?workspace=beta', 'evidence')).body[route.endsWith('bookmarks') ? 'bookmarks' : 'evidence'].length, 1);
      assert.equal((await call(route, 'beta')).body[route.endsWith('bookmarks') ? 'bookmarks' : 'evidence'].length, 0);
    }
    for (const value of ['1', '', 'TRUE']) assert.equal((await call('/v1/bookmarks?includeEvidence=' + value)).status, 400);
    assert.equal((await call('/v1/cases', 'evidence')).status, 403);
  });
}
