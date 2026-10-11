import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { once } from 'node:events';
import { EvidenceStore } from '../src/store.mjs';
import { PostgresDatabase } from '../src/postgres-db.mjs';
import { createIntelligenceServer } from '../src/server.mjs';

const at = 1_791_657_600_000;
const session = (id, extra = {}) => ({ id, platform: 'fixture', account: 'fictional_host', sourceUrl: 'https://example.invalid/' + id, title: 'Synthetic conversation', startedAtMs: at, ...extra });
const event = (id, extra = {}) => ({ source: { adapter: 'fixture', eventId: id }, kind: 'chat', text: 'Unrelated captured words', account: 'fictional_viewer', sourceTimestampMs: null, capturedAtMs: at + 20, ...extra });

function fixture(t, backend) {
  let database, schema;
  if (backend === 'PostgreSQL') {
    schema = 'll_search_' + randomUUID().replaceAll('-', '');
    database = new PostgresDatabase({ connectionString: process.env.LIVELENS_TEST_POSTGRES_URL, schema });
  }
  const store = new EvidenceStore(':memory:', { database, now: () => at + 100 });
  t.after(() => { if (schema) database.exec('DROP SCHEMA "' + schema + '" CASCADE'); store.close(); });
  store.createSession('alpha', session('room'));
  store.createSession('beta', session('room'));
  store.createSession('alpha', session('separate'));
  return store;
}

async function api(t, store) {
  const tokens = { alpha: 'a'.repeat(43), beta: 'b'.repeat(43), sessions: 's'.repeat(43), evidence: 'e'.repeat(43), neither: 'n'.repeat(43) };
  const server = createIntelligenceServer({ store, keys: [
    { token: tokens.alpha, workspace: 'alpha', subject: 'reader', scopes: ['sessions:read', 'evidence:read'] },
    { token: tokens.beta, workspace: 'beta', subject: 'reader', scopes: ['sessions:read', 'evidence:read'] },
    { token: tokens.sessions, workspace: 'alpha', subject: 'sessions-reader', scopes: ['sessions:read'] },
    { token: tokens.evidence, workspace: 'alpha', subject: 'evidence-reader', scopes: ['evidence:read'] },
    { token: tokens.neither, workspace: 'alpha', subject: 'case-reader', scopes: ['cases:read'] },
  ] });
  server.listen(0, '127.0.0.1'); await once(server, 'listening');
  t.after(async () => { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); });
  return async (path, principal = 'alpha') => {
    const response = await fetch('http://127.0.0.1:' + server.address().port + path, { headers: principal === null ? {} : { Authorization: 'Bearer ' + tokens[principal] } });
    return { status: response.status, body: await response.json() };
  };
}

for (const backend of ['SQLite', 'PostgreSQL']) {
  const options = { skip: backend === 'PostgreSQL' && !process.env.LIVELENS_TEST_POSTGRES_URL };

  test(backend + ': session event filters search the complete journal before stable cursor pagination', options, t => {
    const store = fixture(t, backend), expected = [];
    // Interleave another workspace and session so sequence gaps cannot be treated as offsets.
    for (let batch = 0; batch < 3; batch++) {
      const records = Array.from({ length: 100 }, (_, index) => {
        const n = batch * 100 + index;
        return event('message-' + n, { text: n % 2 === 0 ? 'Later NEEDLE statement ' + n : 'Unrelated ' + n, kind: n % 5 === 0 ? 'observation' : 'chat' });
      });
      const rows = store.append('alpha', 'room', records).map(result => result.evidence);
      expected.push(...rows.filter(row => row.kind === 'chat' && row.text.includes('NEEDLE')));
      store.append('beta', 'room', [event('foreign-' + batch, { text: 'Later NEEDLE foreign' })]);
      store.append('alpha', 'separate', [event('separate-' + batch, { text: 'Later NEEDLE separate' })]);
    }
    assert.equal(store.events('alpha', 'room').length, 100);
    assert.equal(expected.length, 120);
    let after = 0; const collected = [];
    for (;;) {
      const rows = store.events('alpha', 'room', { query: 'needle', kind: 'chat', after, limit: 17 });
      if (!rows.length) break;
      assert.ok(rows.length <= 17); assert.ok(rows[0].sequence > after);
      collected.push(...rows); after = rows.at(-1).sequence;
    }
    assert.deepEqual(collected, expected);
    assert.equal(new Set(collected.map(row => row.id)).size, 120);
    assert.ok(collected.at(-1).sequence > 300);
    assert.equal(collected[0].sourceTimestampMs, null);
    assert.equal(collected[0].capturedAtMs, at + 20);
    assert.equal(collected[0].receivedAtMs, at + 100);
    const appended = store.append('alpha', 'room', [event('appended', { text: 'Needle after pagination' })])[0].evidence;
    assert.deepEqual(store.events('alpha', 'room', { query: 'needle', kind: 'chat', after }), [appended]);
    assert.equal(store.verify('alpha', 'room').ok, true);
  });

  test(backend + ': event search treats wildcard characters literally and uses only current attribution', options, t => {
    const store = fixture(t, backend);
    const rows = store.append('alpha', 'room', [
      event('percent', { text: '100% COMPLETE' }),
      event('underscore', { text: 'under_score', account: 'plain' }),
      event('backslash', { text: 'folder\\capture', account: 'plain' }),
      event('combined', { text: 'literal \\%_ together', account: 'plain' }),
      event('speech', { kind: 'transcript', text: 'Neutral captured speech', account: null, speakerId: 'anonymous_1' }),
    ]).map(result => result.evidence);
    const ids = query => store.events('alpha', 'room', { query }).map(row => row.source.eventId);
    assert.deepEqual(ids('%'), ['percent', 'combined']);
    assert.deepEqual(ids('under_score'), ['underscore']);
    assert.deepEqual(ids('\\'), ['backslash', 'combined']);
    assert.deepEqual(ids('\\%_'), ['combined']);
    assert.deepEqual(ids('100% complete'), ['percent']);
    assert.deepEqual(ids("' OR 1=1 --"), []);
    assert.deepEqual(ids('fictional_viewer'), ['percent']);
    assert.deepEqual(ids('anonymous_1'), []);
    const speech = rows.at(-1);
    store.assertAccount('alpha', speech.id, { account: 'old_guess', reason: 'Initial review' }, 'reviewer');
    assert.deepEqual(ids('OLD_GUESS'), ['speech']);
    store.assertAccount('alpha', speech.id, { account: 'current_guest', reason: 'Corrected review' }, 'reviewer');
    assert.deepEqual(ids('old_guess'), []);
    const current = store.events('alpha', 'room', { query: 'speech current_guest', kind: 'transcript' });
    assert.equal(current.length, 1);
    assert.equal(current[0].account, null);
    assert.equal(current[0].attribution.account, 'current_guest');
    assert.equal(current[0].text, speech.text);
    assert.deepEqual(store.events('alpha', 'room', { query: 'current_guest', kind: 'caption' }), []);
    assert.equal(store.assertionHistory('alpha', speech.id).length, 2);
    assert.equal(store.verify('alpha', 'room').ok, true);
  });

  test(backend + ': session library searches older than 200 receipts and applies stable filtered offsets', options, t => {
    const store = fixture(t, backend), expected = [];
    for (let index = 0; index < 225; index++) {
      const id = 'library-' + String(index).padStart(3, '0');
      const row = store.createSession('alpha', session(id, { title: index < 12 ? 'Rare SUBJECT ' + index : 'Ordinary ' + index, startedAtMs: at + Math.floor(index / 2) }));
      if (index < 12) expected.push(row);
    }
    expected.sort((a, b) => b.startedAtMs - a.startedAtMs || a.id.localeCompare(b.id));
    assert.equal(store.listSessions('alpha').length, 100);
    assert.equal(store.listSessions('alpha', 200).some(row => row.title.includes('Rare')), false);
    assert.deepEqual(store.listSessions('alpha', 5, 0, { query: 'rare subject' }), expected.slice(0, 5));
    assert.deepEqual(store.listSessions('alpha', 5, 5, { query: 'RARE subject' }), expected.slice(5, 10));
    assert.deepEqual(store.listSessions('alpha', 5, 10, { query: 'Rare' }), expected.slice(10));
    assert.deepEqual(store.listSessions('alpha', 5, 12, { query: 'Rare' }), []);
    store.createSession('beta', session('foreign', { title: 'Rare SUBJECT other workspace' }));
    assert.equal(store.listSessions('alpha', 200, 0, { query: 'rare' }).length, 12);
    store.createSession('alpha', session('literal', { title: 'A 100% \\ under_score @notice', account: 'unique_account', platform: 'UniquePlatform' }));
    for (const query of ['%', '\\', 'under_score', '@notice', 'UNIQUE_ACCOUNT', '@UNIQUE_ACCOUNT', 'uniqueplatform']) {
      assert.deepEqual(store.listSessions('alpha', 200, 0, { query }).map(row => row.id), ['literal']);
    }
    assert.deepEqual(store.listSessions('alpha', 200, 0, { query: "' OR 1=1 --" }), []);
  });

  test(backend + ': HTTP filtered pages preserve response contracts, actual cursors, scopes and workspace isolation', options, async t => {
    const store = fixture(t, backend), call = await api(t, store);
    store.append('alpha', 'room', Array.from({ length: 125 }, (_, index) => event('early-' + index)));
    const matching = store.append('alpha', 'room', [event('match-one', { text: 'Search 100% match' }), event('unrelated'), event('match-two', { text: 'Search 100% match again' })]).map(result => result.evidence).filter(row => row.text.includes('100%'));
    store.append('beta', 'room', [event('foreign', { text: 'Search 100% foreign' })]);
    const path = '/v1/sessions/room/events?q=100%25&kind=chat&limit=1';
    const first = await call(path);
    assert.equal(first.status, 200);
    assert.deepEqual(first.body, { events: [matching[0]], nextAfter: matching[0].sequence });
    const next = await call(path + '&after=' + first.body.nextAfter);
    assert.deepEqual(next.body, { events: [matching[1]], nextAfter: matching[1].sequence });
    assert.deepEqual((await call(path + '&after=' + next.body.nextAfter)).body, { events: [], nextAfter: null });
    assert.equal((await call(path + '&workspace=beta')).body.events[0].id, matching[0].id);
    assert.equal((await call(path, 'beta')).body.events[0].source.eventId, 'foreign');
    assert.equal((await call('/v1/sessions/separate/events?q=100%25', 'beta')).status, 404);
    assert.equal((await call(path, 'evidence')).status, 200);
    for (const principal of ['sessions', 'neither']) assert.equal((await call(path, principal)).status, 403);
    assert.equal((await call(path, null)).status, 401);
    for (let index = 0; index < 205; index++) store.createSession('alpha', session('http-' + index, { startedAtMs: at + index + 1 }));
    store.createSession('alpha', session('old-match', { title: 'Old literal 100% conversation', account: 'unique_matcher', startedAtMs: at - 1 }));
    const libraryPath = '/v1/sessions?q=old%20literal%20100%25&limit=1';
    assert.deepEqual((await call(libraryPath)).body.sessions.map(row => row.id), ['old-match']);
    assert.deepEqual((await call(libraryPath + '&offset=1')).body, { sessions: [] });
    assert.deepEqual((await call(libraryPath, 'beta')).body, { sessions: [] });
    for (const query of ['%40UNIQUE_MATCHER', 'unique_matcher']) {
      assert.deepEqual((await call('/v1/sessions?q=' + query)).body.sessions.map(row => row.id), ['old-match']);
    }
    assert.equal((await call(libraryPath, 'sessions')).status, 200);
    for (const principal of ['evidence', 'neither']) assert.equal((await call(libraryPath, principal)).status, 403);
  });

  test(backend + ': invalid session search kinds, queries, limits and cursors fail before returning data', options, async t => {
    const store = fixture(t, backend), call = await api(t, store);
    for (const kind of ['', 'CHAT', 'speech', 'all,chat', null, 1]) assert.throws(() => store.events('alpha', 'room', { kind }), /invalid_event_kind/);
    for (const query of [null, 1, 'x'.repeat(513), '\u0000']) {
      assert.throws(() => store.events('alpha', 'room', { query }), /invalid_text/);
      assert.throws(() => store.listSessions('alpha', 100, 0, { query }), /invalid_text/);
    }
    for (const cursor of [-1, 0.5, NaN, Number.MAX_SAFE_INTEGER + 1, '2']) {
      assert.throws(() => store.events('alpha', 'room', { after: cursor }), /invalid_cursor/);
      assert.throws(() => store.listSessions('alpha', 100, cursor), /invalid_cursor/);
    }
    const invalidQueries = ['q=' + 'x'.repeat(513), 'q=%00', 'limit=201', 'limit=0', 'limit=1.5', 'limit=bad'];
    for (const query of invalidQueries) {
      assert.equal((await call('/v1/sessions/room/events?' + query)).status, 400, query);
      assert.equal((await call('/v1/sessions?' + query)).status, 400, query);
    }
    for (const value of ['-1', '1.5', 'not-a-cursor', '9007199254740992']) {
      assert.equal((await call('/v1/sessions/room/events?after=' + value)).status, 400);
      assert.equal((await call('/v1/sessions?offset=' + value)).status, 400);
    }
    for (const value of ['', 'CHAT', 'speech']) assert.equal((await call('/v1/sessions/room/events?kind=' + value)).status, 400);
    assert.equal((await call('/v1/sessions/room/events?kind=all&q=')).status, 200);
  });
}
