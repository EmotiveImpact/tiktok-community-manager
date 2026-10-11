import test from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { createServer as reserveServer } from 'node:net';
import { request as httpRequest } from 'node:http';
import { randomUUID, createHash } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { EvidenceStore } from '../src/store.mjs';
import { Governance } from '../src/governance.mjs';
import { AccountDirectory } from '../src/accounts.mjs';
import { createIntelligenceServer, SCOPES } from '../src/server.mjs';
import { PostgresDatabase } from '../src/postgres-db.mjs';

const password = 'fictional-owner-password', replacement = 'fictional-replacement-password';
const users = [{ workspace: 'team', username: 'owner', password, scopes: SCOPES }];
function fixture(t, { disk = false } = {}) {
  const root = mkdtempSync(join(tmpdir(), 'livelens-accounts-')), path = disk ? join(root, 'db.sqlite') : ':memory:';
  let store = new EvidenceStore(path), clock = Date.now(), governance, accounts;
  const init = () => { governance = new Governance({ store, now: () => clock, members: [{ workspace: 'team', subject: 'owner', role: 'owner' }] }); accounts = new AccountDirectory({ store, governance, scopes: SCOPES, users, now: () => clock }); };
  init(); t.after(() => { store.close(); rmSync(root, { recursive: true, force: true }); });
  return { get store() { return store; }, get governance() { return governance; }, get accounts() { return accounts; }, advance(ms) { clock += ms; }, restart() { store.close(); store = new EvidenceStore(path); init(); }, owner: () => accounts.principal(accounts.row('team', 'owner')) };
}
const invitation = (f, username, role = 'viewer', extras = {}) => f.accounts.invite('team', { username, role, reason: 'Explicit fictional pilot invitation', ...extras }, f.owner());

test('single-use invitation redemption atomically creates scoped credentials, membership and secret-free audits', async t => {
  const f = fixture(t), created = invitation(f, 'viewer');
  assert.match(created.token, /^[A-Za-z0-9_-]{43}$/); assert.equal(created.url, '/app/#invite=' + created.token);
  assert.equal(f.accounts.inspect(created.token, 'inspect').invitation.username, 'viewer');
  const results = await Promise.allSettled([f.accounts.redeem({ token: created.token, password }, 'a'), f.accounts.redeem({ token: created.token, password }, 'b')]);
  assert.equal(results.filter(r => r.status === 'fulfilled').length, 1); assert.equal(results.find(r => r.status === 'rejected').reason.code, 'invitation_unavailable');
  const principal = await f.accounts.login({ username: 'viewer', password }, 'login'); assert.equal(principal.workspace, 'team'); assert.equal(principal.scopes.has('workspace:admin'), false); assert.equal(principal.scopes.has('cases:write'), false);
  assert.equal(f.governance.role(principal), 'viewer'); assert.equal(f.accounts.invitations('team')[0].state, 'used');
  const row = f.accounts.row('team', 'viewer'); assert.notEqual(row.password_hash, password); assert.equal(Buffer.from(row.password_hash, 'base64url').length, 64);
  const exposed = JSON.stringify({ invitations: f.accounts.invitations('team'), accounts: f.accounts.accounts('team'), audit: f.governance.audit('team') });
  assert.equal(exposed.includes(created.token), false); assert.equal(exposed.includes(password), false); assert.equal(exposed.includes(row.password_hash), false); assert.equal(f.governance.verifyAudit('team').valid, true);
});

test('expiry, revocation and live inviter authority refuse redemption without partial accounts or membership', async t => {
  const f = fixture(t), expired = invitation(f, 'expired', 'viewer', { expiresInHours: 1 }); f.advance(3_600_001);
  await assert.rejects(f.accounts.redeem({ token: expired.token, password }, 'expired'), /invitation_unavailable/);
  const revoked = invitation(f, 'revoked'); f.accounts.revokeInvitation('team', revoked.invitation.id, { reason: 'Withdraw pilot invitation' }, f.owner());
  assert.throws(() => f.accounts.inspect(revoked.token, 'revoked'), /invitation_unavailable/);
  const live = invitation(f, 'live'); f.governance.db.prepare("UPDATE workspace_members SET role='revoked' WHERE workspace=? AND subject=?").run('team', 'owner');
  await assert.rejects(f.accounts.redeem({ token: live.token, password }, 'live'), /invitation_unavailable/);
  for (const username of ['expired', 'revoked', 'live']) { assert.equal(f.accounts.row('team', username), undefined); assert.equal(f.governance.db.prepare('SELECT 1 FROM workspace_members WHERE workspace=? AND subject=?').get('team', username), undefined); }
});

test('profiles cannot exceed issuer grants or role ceilings; promotion does not expand stored grants', async t => {
  const f = fixture(t);
  assert.throws(() => invitation(f, 'elevated', 'viewer', { scopes: ['workspace:admin'] }), /scope_delegation_denied/);
  assert.throws(() => invitation(f, 'elevated', 'analyst', { scopes: ['workspace:admin'] }), /scope_delegation_denied/);
  const narrow = { ...f.owner(), scopes: new Set(['workspace:admin']) };
  assert.throws(() => f.accounts.invite('team', { username: 'narrow', role: 'viewer', reason: 'Explicit' }, narrow), /scope_delegation_denied/);
  const created = invitation(f, 'viewer'); const original = await f.accounts.redeem({ token: created.token, password }, 'viewer');
  f.governance.setMember('team', { subject: 'viewer', role: 'owner' }, 'owner');
  assert.equal(f.accounts.refresh(original, original.credentialVersion).scopes.has('workspace:admin'), false);
  f.governance.setMember('team', { subject: 'viewer', role: 'admin' }, 'owner');
  const admin = { workspace: 'team', subject: 'viewer', scopes: new Set(SCOPES) };
  assert.throws(() => f.accounts.invite('team', { username: 'new_owner', role: 'owner', reason: 'Explicit' }, admin), /workspace_owner_required/);
});

test('admin reset invalidates old credentials and fresh sessions; bootstrap never restores old password or revoked access', async t => {
  const f = fixture(t, { disk: true }), created = invitation(f, 'viewer');
  const prior = await f.accounts.redeem({ token: created.token, password }, 'viewer');
  const reset = f.accounts.reset('team', 'viewer', { reason: 'Manual customer recovery' }, f.owner());
  assert.throws(() => f.accounts.refresh(prior, prior.credentialVersion), /unauthorised/);
  await assert.rejects(f.accounts.login({ username: 'viewer', password }, 'login'), /unauthorised/);
  assert.equal(f.accounts.inspect(reset.token, 'inspect').invitation.purpose, 'password-reset');
  const current = await f.accounts.redeem({ token: reset.token, password: replacement }, 'redeem'); assert.equal(current.credentialVersion, prior.credentialVersion + 1);
  f.restart(); assert.equal((await f.accounts.login({ workspace: 'team', username: 'viewer', password: replacement }, 'restart')).subject, 'viewer');
  await assert.rejects(f.accounts.login({ username: 'viewer', password }, 'restart-old'), /unauthorised/);
  f.accounts.revoke('team', 'viewer', { reason: 'End pilot access' }, f.owner()); f.restart();
  await assert.rejects(f.accounts.login({ username: 'viewer', password: replacement }, 'revoked'), /unauthorised/);
  assert.equal(f.accounts.row('team', 'viewer').status, 'revoked'); assert.equal(f.accounts.projection(f.accounts.row('team', 'viewer')).role, 'revoked');
  assert.throws(() => f.accounts.reset('team', 'viewer', { reason: 'Cannot recover revoked credentials' }, f.owner()), /account_revoked/);
  f.governance.setMember('team', { subject: 'viewer', role: 'viewer' }, 'owner');
  assert.throws(() => f.accounts.reset('team', 'viewer', { reason: 'Membership restoration cannot restore credentials' }, f.owner()), /account_revoked/);
  await assert.rejects(f.accounts.login({ username: 'viewer', password: replacement }, 'revoked-restored-member'), /unauthorised/);
  assert.throws(() => f.accounts.revoke('team', 'owner', { reason: 'Would remove sole owner' }, f.owner()), /last_workspace_owner/);
  assert.equal(f.accounts.row('team', 'owner').status, 'active');
});

test('self reset remains redeemable and an issuer reset invalidates its earlier invitations', async t => {
  const f = fixture(t, { disk: true }), old = invitation(f, 'pending');
  const reset = f.accounts.reset('team', 'owner', { reason: 'Owner credential recovery' }, f.owner());
  assert.throws(() => f.accounts.inspect(old.token, 'old'), /invitation_unavailable/);
  const fresh = await f.accounts.redeem({ token: reset.token, password: replacement }, 'self');
  assert.equal(fresh.subject, 'owner'); assert.equal(fresh.scopes.has('workspace:admin'), true);
  f.restart();
  assert.equal((await f.accounts.login({ username: 'owner', password: replacement }, 'login')).subject, 'owner');
  await assert.rejects(f.accounts.login({ username: 'owner', password }, 'bootstrap-old'), /unauthorised/);
});

test('live API issuer key rotation and scope narrowing invalidate its outstanding invitations', t => {
  const f = fixture(t), tokenHash = createHash('sha256').update('fictional-admin-token').digest();
  let key = { ...f.owner(), tokenHash }; delete key.credentialVersion;
  f.accounts.apiPrincipalForHash = hash => key?.tokenHash.toString('hex') === hash ? key : undefined;
  const invite = f.accounts.invite('team', { username: 'pending', role: 'viewer', reason: 'API-authorised pilot' }, key);
  assert.equal(f.accounts.inspect(invite.token, 'before').invitation.username, 'pending');
  key = { ...key, scopes: new Set(['workspace:admin']) };
  assert.throws(() => f.accounts.inspect(invite.token, 'narrowed'), /invitation_unavailable/);
  f.governance.setMember('team', { subject: 'other_owner', role: 'owner' }, 'owner');
  key = { ...key, subject: 'other_owner', scopes: new Set(SCOPES) };
  assert.throws(() => f.accounts.inspect(invite.token, 'rebound'), /invitation_unavailable/);
  key = undefined;
  assert.throws(() => f.accounts.inspect(invite.token, 'rotated'), /invitation_unavailable/);
  f.accounts.apiPrincipalForHash = undefined;
  assert.throws(() => f.accounts.inspect(invite.token, 'no-key-resolver'), /invitation_unavailable/);
  assert.equal(f.accounts.row('team', 'pending'), undefined);
  // API service subjects retain their existing text contract, independent of
  // the stricter identifier format for browser usernames.
  f.governance.setMember('team', { subject: 'Operator Admin', role: 'admin' }, 'owner');
  key = { workspace: 'team', subject: 'Operator Admin', scopes: new Set(SCOPES), tokenHash };
  f.accounts.apiPrincipalForHash = hash => key.tokenHash.toString('hex') === hash ? key : undefined;
  const issued = f.accounts.invite('team', { username: 'second_viewer', role: 'viewer', reason: 'Existing API identity compatibility' }, key);
  assert.equal(f.accounts.inspect(issued.token, 'text-api-subject').invitation.username, 'second_viewer');
});

test('workspace-bound usernames reject ambiguous login and cross-workspace account administration', async t => {
  const f = fixture(t);
  const governance = new Governance({ store: f.store, members: [{ workspace: 'other', subject: 'owner', role: 'owner' }] });
  const accounts = new AccountDirectory({ store: f.store, governance, scopes: SCOPES, users: [{ ...users[0], workspace: 'other', password: replacement }] });
  await assert.rejects(accounts.login({ username: 'owner', password }, 'ambiguous'), /unauthorised/);
  assert.equal((await accounts.login({ workspace: 'team', username: 'owner', password }, 'team')).workspace, 'team');
  assert.equal((await accounts.login({ workspace: 'other', username: 'owner', password: replacement }, 'other')).workspace, 'other');
  await assert.rejects(accounts.login({ workspace: 'other', username: 'owner', password }, 'wrong-workspace-password'), /unauthorised/);
  assert.throws(() => accounts.invite('other', { username: 'viewer', role: 'viewer', reason: 'Cross workspace attempted' }, f.owner()), /scope_denied/);
  assert.throws(() => accounts.reset('other', 'owner', { reason: 'Cross workspace attempted' }, f.owner()), /scope_denied/);
  const created = invitation(f, 'pending');
  const other = accounts.principal(accounts.row('other', 'owner'));
  assert.throws(() => accounts.revokeInvitation('other', created.invitation.id, { reason: 'Cross workspace attempted' }, other), /invitation_not_found/);
  assert.equal(accounts.invitations('other').length, 0);
});

test('asynchronous password work rechecks issuer and login credential versions before committing', async t => {
  const f = fixture(t), invite = invitation(f, 'pending'), hash = f.accounts.passwordHash.bind(f.accounts);
  let release, entered;
  const gate = new Promise(resolve => { entered = resolve; });
  f.accounts.passwordHash = async (...args) => { entered(); await new Promise(resolve => { release = resolve; }); return hash(...args); };
  const pending = f.accounts.redeem({ token: invite.token, password }, 'redeem'); await gate;
  const reset = f.accounts.reset('team', 'owner', { reason: 'Revoke issuer during password work' }, f.owner());
  release(); await assert.rejects(pending, /invitation_unavailable/);
  assert.equal(f.accounts.row('team', 'pending'), undefined);
  assert.equal(f.governance.members('team').some(member => member.subject === 'pending'), false);
  f.accounts.passwordHash = hash;
  await f.accounts.redeem({ token: reset.token, password: replacement }, 'restore-owner');
  let loginRelease, loginEntered;
  const loginGate = new Promise(resolve => { loginEntered = resolve; });
  f.accounts.passwordHash = async (...args) => { loginEntered(); await new Promise(resolve => { loginRelease = resolve; }); return hash(...args); };
  const login = f.accounts.login({ username: 'owner', password: replacement }, 'login'); await loginGate;
  f.accounts.reset('team', 'owner', { reason: 'Reset during login password comparison' }, f.owner());
  loginRelease(); await assert.rejects(login, /unauthorised/);
});

test('actual PostgreSQL persists account credentials, atomically redeems once and preserves reset/revocation across reconnect', { skip: !process.env.LIVELENS_TEST_POSTGRES_URL }, async t => {
  const schema = 'll_accounts_' + randomUUID().replaceAll('-', '');
  let db, store, governance, accounts;
  const open = () => {
    db = new PostgresDatabase({ connectionString: process.env.LIVELENS_TEST_POSTGRES_URL, schema }); store = new EvidenceStore(':memory:', { database: db });
    governance = new Governance({ store, members: [{ workspace: 'team', subject: 'owner', role: 'owner' }] });
    accounts = new AccountDirectory({ store, governance, scopes: SCOPES, users });
  };
  open(); t.after(() => { db.exec('DROP SCHEMA "' + schema + '" CASCADE'); store.close(); });
  const owner = () => accounts.principal(accounts.row('team', 'owner'));
  const invite = accounts.invite('team', { username: 'viewer', role: 'viewer', reason: 'PostgreSQL invitation parity' }, owner());
  const results = await Promise.allSettled([accounts.redeem({ token: invite.token, password }, 'a'), accounts.redeem({ token: invite.token, password }, 'b')]);
  assert.equal(results.filter(result => result.status === 'fulfilled').length, 1);
  assert.equal(accounts.accounts('team').length, 2); assert.equal(accounts.invitations('team')[0].state, 'used');
  assert.equal(governance.members('team').find(member => member.subject === 'viewer').role, 'viewer');
  const reset = accounts.reset('team', 'viewer', { reason: 'PostgreSQL persisted credential reset' }, owner());
  store.close(); open(); assert.equal(accounts.accounts('team').find(account => account.username === 'viewer').status, 'reset-required');
  await accounts.redeem({ token: reset.token, password: replacement }, 'reset');
  await assert.rejects(accounts.login({ username: 'viewer', password }, 'old'), /unauthorised/);
  assert.equal((await accounts.login({ username: 'viewer', password: replacement }, 'new')).subject, 'viewer');
  accounts.revoke('team', 'viewer', { reason: 'PostgreSQL persistent revocation' }, owner());
  store.close(); open(); await assert.rejects(accounts.login({ username: 'viewer', password: replacement }, 'revoked'), /unauthorised/);
  assert.equal(governance.verifyAudit('team').valid, true);
});

async function httpFixture(t) {
  const f = fixture(t), reservation = reserveServer(); reservation.listen(0, '127.0.0.1'); await once(reservation, 'listening'); const port = reservation.address().port; await new Promise(r => reservation.close(r));
  const origin = 'http://127.0.0.1:' + port;
  const server = createIntelligenceServer({ store: f.store, governance: f.governance, accounts: f.accounts, keys: [{ token: 'k'.repeat(43), workspace: 'team', subject: 'owner', scopes: SCOPES }], browser: { authMode: 'persisted', origin } });
  server.listen(port, '127.0.0.1'); await once(server, 'listening'); t.after(async () => { server.closeAllConnections(); await new Promise(r => server.close(r)); });
  // Raw HTTP preserves a deliberately forged Host header; fetch replaces it.
  const request = (path, { body, cookie, csrf, requestOrigin = body ? origin : undefined, host = new URL(origin).host, fetchSite, bearer } = {}) => new Promise((resolve, reject) => {
    const request = httpRequest(origin + path, { method: body ? 'POST' : 'GET', headers: { Host: host, ...(requestOrigin ? { Origin: requestOrigin } : {}), ...(cookie ? { Cookie: cookie } : {}), ...(csrf ? { 'X-LiveLens-CSRF': csrf } : {}), ...(fetchSite ? { 'Sec-Fetch-Site': fetchSite } : {}), ...(bearer ? { Authorization: 'Bearer ' + bearer } : {}), ...(body ? { 'Content-Type': 'application/json' } : {}) } }, response => {
      const chunks = []; response.on('data', chunk => chunks.push(chunk)); response.on('error', reject);
      response.on('end', () => resolve(new Response(Buffer.concat(chunks), { status: response.statusCode, headers: response.headers })));
    });
    request.on('error', reject); request.end(body ? JSON.stringify(body) : undefined);
  });
  const login = await request('/console/login', { body: { username: 'owner', password } }); assert.equal(login.status, 200);
  return { ...f, origin, request, ownerCookie: login.headers.get('set-cookie').split(';')[0], ownerIdentity: await login.json(), directory: f.accounts };
}

test('actual HTTP invite onboarding checks Host/Origin/fetch metadata, JSON shape, scopes and CSRF', async t => {
  const f = await httpFixture(t);
  const capabilities = await (await f.request('/v1/capabilities', { cookie: f.ownerCookie })).json(); assert.ok(capabilities.enabled.includes('workspace-invitations'));
  const body = { username: 'viewer', role: 'viewer', reason: 'Explicit pilot' };
  assert.equal((await f.request('/v1/workspace/invitations', { body, cookie: f.ownerCookie })).status, 403);
  const create = await f.request('/v1/workspace/invitations', { body, cookie: f.ownerCookie, csrf: f.ownerIdentity.csrf }); assert.equal(create.status, 201); const invited = await create.json();
  for (const options of [{ requestOrigin: 'https://other.invalid' }, { host: 'other.invalid' }, { fetchSite: 'cross-site' }, { requestOrigin: null }]) assert.equal((await f.request('/console/invitations/inspect', { body: { token: invited.token }, ...options })).status, 403, JSON.stringify(options));
  assert.equal((await f.request('/console/invitations/redeem', { body: { token: invited.token, password, role: 'owner' } })).status, 400);
  const redeem = await f.request('/console/invitations/redeem', { body: { token: invited.token, password } }); assert.equal(redeem.status, 200); assert.match(redeem.headers.get('set-cookie'), /HttpOnly; SameSite=Strict/);
  const cookie = redeem.headers.get('set-cookie').split(';')[0], identity = await redeem.json();
  assert.equal(identity.subject, 'viewer'); assert.equal(identity.workspace, 'team'); assert.ok(identity.csrf);
  assert.equal((await f.request('/v1/workspace/invitations', { cookie })).status, 403);
  assert.equal((await f.request('/v1/cases', { body: { title: 'Denied', question: 'Denied' }, cookie, csrf: identity.csrf })).status, 403);
  const list = await (await f.request('/v1/workspace/invitations', { cookie: f.ownerCookie })).json(); assert.equal(JSON.stringify(list).includes(invited.token), false);
  assert.equal((await f.request('/console/invitations/inspect', { body: { token: invited.token } })).status, 400);
});

test('actual HTTP admin reset and membership revocation invalidate console session and previously authenticated API writes', async t => {
  const f = await httpFixture(t), invited = invitation(f, 'analyst', 'analyst');
  const redeem = await f.request('/console/invitations/redeem', { body: { token: invited.token, password } }); assert.equal(redeem.status, 200);
  const cookie = redeem.headers.get('set-cookie').split(';')[0], identity = await redeem.json();
  assert.equal((await f.request('/v1/cases', { body: { title: 'Pilot', question: 'Review?' }, cookie, csrf: identity.csrf })).status, 201);
  const reset = await f.request('/v1/workspace/accounts/analyst/reset', { body: { reason: 'Manual reset' }, cookie: f.ownerCookie, csrf: f.ownerIdentity.csrf }); assert.equal(reset.status, 201); const token = (await reset.json()).token;
  assert.equal((await f.request('/console/session', { cookie })).status, 401);
  assert.equal((await f.request('/v1/cases', { body: { title: 'Old session', question: 'Denied?' }, cookie, csrf: identity.csrf })).status, 401);
  const renewed = await f.request('/console/invitations/redeem', { body: { token, password: replacement } }); assert.equal(renewed.status, 200); const newCookie = renewed.headers.get('set-cookie').split(';')[0];
  const revoked = await f.request('/v1/workspace/accounts/analyst/revoke', { body: { reason: 'End pilot' }, cookie: f.ownerCookie, csrf: f.ownerIdentity.csrf }); assert.equal(revoked.status, 200);
  assert.equal((await f.request('/console/session', { cookie: newCookie })).status, 401);
});

test('bounded public auth rate and password policy reject repeated requests without account creation', async t => {
  const f = fixture(t), invited = invitation(f, 'pending');
  await assert.rejects(f.accounts.redeem({ token: invited.token, password: 'short' }, 'weak'), /password_too_short/);
  for (let n = 0; n < 20; n++) assert.throws(() => f.accounts.inspect('x'.repeat(43), 'attacker'), /invitation_unavailable/);
  assert.throws(() => f.accounts.inspect(invited.token, 'attacker'), /login_rate_limited/); assert.equal(f.accounts.row('team', 'pending'), undefined);
  assert.throws(() => new AccountDirectory({ store: f.store, scopes: SCOPES }), /persisted_auth_governance_required/);
  assert.throws(() => createIntelligenceServer({ store: f.store, keys: [{ token: 'k'.repeat(43), workspace: 'team', subject: 'owner', scopes: SCOPES }], browser: { authMode: 'persisted', origin: 'http://127.0.0.1:4318', users } }), /persisted_auth_governance_required/);
});
