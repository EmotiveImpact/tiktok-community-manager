import { randomBytes, randomUUID, scrypt, scryptSync, timingSafeEqual, createHash } from 'node:crypto';
import { promisify } from 'node:util';
import { Fault, ident, object, text, canonical } from './validation.mjs';

const derive = promisify(scrypt), PASSWORD_OPTIONS = Object.freeze({ N: 32768, r: 8, p: 1, maxmem: 64 * 1024 ** 2 });
const READER = ['sessions:read', 'evidence:read', 'cases:read', 'recordings:read', 'speech:read', 'missions:read', 'workspace:read'];
const ANALYST = [...READER, 'cases:write', 'assertions:write', 'investigations:write', 'reports:write', 'missions:write'];
const ROLES = ['owner', 'admin', 'analyst', 'viewer'];
const hashToken = token => createHash('sha256').update('livelens-account-token-v1\0' + token).digest('hex');
const schema = `
CREATE TABLE IF NOT EXISTS browser_accounts(
 workspace TEXT NOT NULL,username TEXT NOT NULL,scopes TEXT NOT NULL,status TEXT NOT NULL,
 credential_version INTEGER NOT NULL,password_salt TEXT NOT NULL,password_hash TEXT NOT NULL,
 created_at INTEGER NOT NULL,updated_at INTEGER NOT NULL,PRIMARY KEY(workspace,username));
CREATE TABLE IF NOT EXISTS browser_invitation_tokens(
 workspace TEXT NOT NULL,id TEXT NOT NULL,username TEXT NOT NULL,purpose TEXT NOT NULL,
 token_hash TEXT NOT NULL UNIQUE,role TEXT NOT NULL,scopes TEXT NOT NULL,issuer_scopes TEXT NOT NULL,
 issuer_key_hash TEXT,issuer_version INTEGER,target_version INTEGER,
 created_by TEXT NOT NULL,created_at INTEGER NOT NULL,expires_at INTEGER NOT NULL,
 used_at INTEGER,revoked_at INTEGER,reason TEXT NOT NULL,PRIMARY KEY(workspace,id));
CREATE INDEX IF NOT EXISTS browser_invitation_workspace ON browser_invitation_tokens(workspace,created_at);
`;

/** Opt-in workspace-bound customer credentials. Raw tokens/passwords never persist.
 * Sessions stay in the existing bounded browser map; every request rechecks DB
 * credential version, current membership and scope ceiling. No email is sent.
 */
export class AccountDirectory {
  constructor({ store, governance, scopes, users = [], now = Date.now, apiPrincipalForHash }) {
    if (!governance || governance.store !== store) throw new Fault('persisted_auth_governance_required');
    this.store = store; this.db = store.db; this.governance = governance; this.scopes = [...scopes]; this.now = now; this.apiPrincipalForHash = apiPrincipalForHash;
    this.attempts = new Map(); this.hashing = 0; this.db.exec(schema);
    this.seed(users);
  }
  roleScopes(role) {
    if (!ROLES.includes(role)) throw new Fault('workspace_membership_denied', 403);
    return role === 'viewer' ? READER.filter(s => this.scopes.includes(s)) : role === 'analyst' ? ANALYST.filter(s => this.scopes.includes(s)) : this.scopes;
  }
  password(value) { text(value, 256); if (value.length < 12) throw new Fault('password_too_short'); return value; }
  validatedScopes(scopes) {
    if (!Array.isArray(scopes) || !scopes.length || scopes.length > this.scopes.length || new Set(scopes).size !== scopes.length || scopes.some(s => !this.scopes.includes(s))) throw new Fault('invalid_account_scopes');
    return scopes;
  }
  row(workspace, username) { return this.db.prepare('SELECT * FROM browser_accounts WHERE workspace=? AND username=?').get(ident(workspace), ident(username)); }
  seed(users) {
    if (!Array.isArray(users) || users.length > 100) throw new Fault('invalid_browser_users');
    const names = new Set();
    for (const user of users) {
      object(user, ['username', 'password', 'workspace', 'scopes']); ident(user.username); ident(user.workspace); this.password(user.password); this.validatedScopes(user.scopes);
      const key = user.workspace + '\0' + user.username; if (names.has(key)) throw new Fault('invalid_browser_user'); names.add(key);
      // Never overwrite operator password changes, reset states or revocations.
      if (this.row(user.workspace, user.username)) continue;
      const salt = randomBytes(16), hash = scryptSync(user.password, salt, 64, PASSWORD_OPTIONS);
      this.db.prepare("INSERT OR IGNORE INTO browser_accounts VALUES(?,?,?,'active',1,?,?,?,?)").run(user.workspace, user.username, canonical(user.scopes), salt.toString('base64url'), hash.toString('base64url'), this.now(), this.now());
    }
  }
  principal(row, version = row?.credential_version) {
    if (!row || row.status !== 'active' || row.credential_version !== version) throw new Fault('unauthorised', 401);
    const identity = { workspace: row.workspace, subject: row.username }, role = this.governance.role(identity);
    const allowed = new Set(this.roleScopes(role));
    return { ...identity, scopes: new Set(JSON.parse(row.scopes).filter(s => allowed.has(s))), credentialVersion: row.credential_version };
  }
  refresh(principal, version) { return this.principal(this.row(principal.workspace, principal.subject), version); }
  throttle(address, kind, failed = false) {
    const now = this.now();
    for (const [key, item] of this.attempts) if (item.until <= now) this.attempts.delete(key);
    const key = createHash('sha256').update(kind + '\0' + (address ?? 'unknown')).digest('hex');
    const item = this.attempts.get(key) ?? { n: 0, until: now + 60_000 };
    if (item.n >= (kind === 'login' ? 5 : 20) || this.attempts.size >= 10_000) throw new Fault('login_rate_limited', 429);
    if (failed || kind !== 'login') { item.n++; this.attempts.set(key, item); }
    return key;
  }
  async passwordHash(password, salt) {
    if (this.hashing >= 4) throw new Fault('authentication_capacity', 429);
    this.hashing++;
    try { return await derive(password, salt, 64, PASSWORD_OPTIONS); } finally { this.hashing--; }
  }
  async login({ username, password, workspace }, address) {
    text(username, 96); text(password, 256); if (workspace !== undefined) ident(workspace);
    const rateKey = this.throttle(address, 'login');
    const matches = workspace ? [this.row(workspace, username)].filter(Boolean) : this.db.prepare('SELECT * FROM browser_accounts WHERE username=? ORDER BY workspace LIMIT 2').all(username);
    const row = matches.length === 1 ? matches[0] : null;
    const salt = row?.password_salt ? Buffer.from(row.password_salt, 'base64url') : Buffer.alloc(16);
    const candidate = await this.passwordHash(password, salt);
    const expected = row?.password_hash ? Buffer.from(row.password_hash, 'base64url') : Buffer.alloc(64);
    let principal;
    try { if (!row || expected.length !== 64 || !timingSafeEqual(candidate, expected)) throw new Fault('unauthorised', 401); principal = this.principal(this.row(row.workspace, row.username), row.credential_version); }
    catch (error) { if (error.status === 429) throw error; this.throttle(address, 'login', true); throw new Fault('unauthorised', 401); }
    this.attempts.delete(rateKey); return principal;
  }
  actor(workspace, principal, targetRole) {
    if (!principal || principal.workspace !== workspace || !principal.scopes?.has('workspace:admin')) throw new Fault('scope_denied', 403);
    if (principal.credentialVersion !== undefined) this.refresh(principal, principal.credentialVersion);
    const role = this.governance.authorize(principal, 'workspace:admin').role;
    if (targetRole === 'owner' && role !== 'owner') throw new Fault('workspace_owner_required', 403);
    return role;
  }
  profile(role, requested, principal) {
    if (!ROLES.includes(role)) throw new Fault('invalid_member_role');
    const scopes = this.validatedScopes(requested ?? this.roleScopes(role));
    const allowed = new Set(this.roleScopes(role));
    if (scopes.some(s => !allowed.has(s) || !principal.scopes.has(s))) throw new Fault('scope_delegation_denied', 403);
    return [...scopes];
  }
  projection(row) {
    if (!row) throw new Fault('account_not_found', 404);
    const membership = this.db.prepare('SELECT role FROM workspace_members WHERE workspace=? AND subject=?').get(row.workspace, row.username);
    const role = membership?.role ?? 'revoked', allowed = new Set(role === 'revoked' ? [] : this.roleScopes(role));
    return { username: row.username, role, scopes: JSON.parse(row.scopes).filter(s => allowed.has(s)), status: row.status, createdAtMs: row.created_at, updatedAtMs: row.updated_at };
  }
  accounts(workspace) { return this.db.prepare('SELECT * FROM browser_accounts WHERE workspace=? ORDER BY username LIMIT 1000').all(ident(workspace)).map(row => this.projection(row)); }
  metadata(row) {
    return { id: row.id, workspace: row.workspace, username: row.username, purpose: row.purpose, role: row.role, scopes: JSON.parse(row.scopes), state: row.revoked_at !== null ? 'revoked' : row.used_at !== null ? 'used' : row.expires_at <= this.now() ? 'expired' : 'pending', createdAtMs: row.created_at, expiresAtMs: row.expires_at, createdBy: row.created_by };
  }
  invitations(workspace) { return this.db.prepare('SELECT * FROM browser_invitation_tokens WHERE workspace=? ORDER BY created_at DESC,id LIMIT 200').all(ident(workspace)).map(row => this.metadata(row)); }
  hours(value, purpose) {
    const hours = value ?? (purpose === 'invite' ? 72 : 1);
    if (!Number.isInteger(hours) || hours < 1 || hours > (purpose === 'invite' ? 168 : 24)) throw new Fault('invalid_invitation_expiry'); return hours;
  }
  issue(workspace, { username, role, scopes, expiresInHours, reason }, principal, purpose, targetVersion = null) {
    const token = randomBytes(32).toString('base64url'), id = randomUUID(), now = this.now(), issuer = principal.tokenHash ? null : this.row(workspace, principal.subject);
    if (this.db.prepare('SELECT count(*) AS n FROM browser_invitation_tokens WHERE workspace=? AND used_at IS NULL AND revoked_at IS NULL AND expires_at>?').get(workspace, now).n >= 100) throw new Fault('invitation_capacity', 429);
    this.db.prepare('INSERT INTO browser_invitation_tokens VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,NULL,NULL,?)').run(workspace, id, username, purpose, hashToken(token), role, canonical(scopes), canonical([...principal.scopes]), principal.tokenHash?.toString('hex') ?? null, issuer?.credential_version ?? null, targetVersion, principal.subject, now, now + this.hours(expiresInHours, purpose) * 3_600_000, reason);
    this.governance.recordAudit(workspace, purpose === 'invite' ? 'account.invitation.created' : 'account.reset.created', username, principal.subject, { invitationId: id, role, scopes, reason, expiresInHours: this.hours(expiresInHours, purpose) });
    const row = this.db.prepare('SELECT * FROM browser_invitation_tokens WHERE workspace=? AND id=?').get(workspace, id);
    return { invitation: this.metadata(row), token, url: '/app/#invite=' + token };
  }
  invite(workspace, value, principal) {
    object(value, ['username', 'role', 'scopes', 'expiresInHours', 'reason']); ident(value.username); text(value.reason, 1000); this.actor(workspace, principal, value.role);
    const scopes = this.profile(value.role, value.scopes, principal); this.hours(value.expiresInHours, 'invite');
    return this.store.transaction(() => {
      this.actor(workspace, principal, value.role);
      if (this.row(workspace, value.username) || this.db.prepare('SELECT 1 FROM workspace_members WHERE workspace=? AND subject=?').get(workspace, value.username)) throw new Fault('account_exists', 409);
      if (this.db.prepare('SELECT 1 FROM browser_invitation_tokens WHERE workspace=? AND username=? AND used_at IS NULL AND revoked_at IS NULL AND expires_at>?').get(workspace, value.username, this.now())) throw new Fault('invitation_exists', 409);
      return this.issue(workspace, { ...value, scopes }, principal, 'invite');
    });
  }
  revokeInvitation(workspace, id, value, principal) {
    object(value, ['reason']); text(value.reason, 1000); ident(id); this.actor(workspace, principal);
    return this.store.transaction(() => {
      const row = this.db.prepare('SELECT * FROM browser_invitation_tokens WHERE workspace=? AND id=?').get(workspace, id);
      if (!row) throw new Fault('invitation_not_found', 404); this.actor(workspace, principal, row.role);
      if (row.used_at !== null) throw new Fault('invitation_already_used', 409);
      this.db.prepare('UPDATE browser_invitation_tokens SET revoked_at=? WHERE workspace=? AND id=?').run(this.now(), workspace, id);
      this.governance.recordAudit(workspace, 'account.invitation.revoked', row.username, principal.subject, { invitationId: id, reason: value.reason });
      return { invitation: this.metadata(this.db.prepare('SELECT * FROM browser_invitation_tokens WHERE workspace=? AND id=?').get(workspace, id)) };
    });
  }
  reset(workspace, username, value, principal) {
    object(value, ['reason', 'expiresInHours']); text(value.reason, 1000); ident(username); this.actor(workspace, principal); this.hours(value.expiresInHours, 'password-reset');
    return this.store.transaction(() => {
      const row = this.row(workspace, username); if (!row) throw new Fault('account_not_found', 404);
      if (row.status === 'revoked') throw new Fault('account_revoked', 409);
      const role = this.governance.role({ workspace, subject: username }); this.actor(workspace, principal, role);
      const scopes = this.profile(role, JSON.parse(row.scopes).filter(s => this.roleScopes(role).includes(s)), principal);
      const version = row.credential_version + 1;
      this.db.prepare("UPDATE browser_accounts SET status='reset-required',credential_version=?,password_salt='',password_hash='',updated_at=? WHERE workspace=? AND username=?").run(version, this.now(), workspace, username);
      this.db.prepare("UPDATE browser_invitation_tokens SET revoked_at=? WHERE workspace=? AND username=? AND purpose='password-reset' AND used_at IS NULL AND revoked_at IS NULL").run(this.now(), workspace, username);
      return this.issue(workspace, { ...value, username, role, scopes }, principal, 'password-reset', version);
    });
  }
  revoke(workspace, username, value, principal) {
    object(value, ['reason']); text(value.reason, 1000); ident(username); this.actor(workspace, principal);
    return this.store.transaction(() => {
      const row = this.row(workspace, username); if (!row) throw new Fault('account_not_found', 404);
      const role = this.governance.role({ workspace, subject: username }); this.actor(workspace, principal, role);
      this.governance.setMemberInTransaction(workspace, { subject: username, role: 'revoked' }, principal);
      this.db.prepare("UPDATE browser_accounts SET status='revoked',credential_version=credential_version+1,password_salt='',password_hash='',updated_at=? WHERE workspace=? AND username=?").run(this.now(), workspace, username);
      this.db.prepare('UPDATE browser_invitation_tokens SET revoked_at=? WHERE workspace=? AND username=? AND used_at IS NULL AND revoked_at IS NULL').run(this.now(), workspace, username);
      this.governance.recordAudit(workspace, 'account.revoked', username, principal.subject, { reason: value.reason }); return { account: this.projection(this.row(workspace, username)) };
    });
  }
  usable(token) {
    if (typeof token !== 'string' || !/^[A-Za-z0-9_-]{43}$/.test(token) || Buffer.from(token, 'base64url').toString('base64url') !== token) throw new Fault('invitation_unavailable');
    const row = this.db.prepare('SELECT * FROM browser_invitation_tokens WHERE token_hash=?').get(hashToken(token));
    try {
      if (!row || row.used_at !== null || row.revoked_at !== null || row.expires_at <= this.now()) throw new Fault('invitation_unavailable');
      let issuer;
      if (row.issuer_key_hash) issuer = this.apiPrincipalForHash?.(row.issuer_key_hash);
      else if (row.issuer_version !== null) {
        const account = this.row(row.workspace, row.created_by);
        if (row.purpose === 'password-reset' && row.created_by === row.username && account?.status === 'reset-required' && account.credential_version === row.issuer_version) {
          const role = this.governance.role({ workspace: row.workspace, subject: row.created_by });
          issuer = { workspace: row.workspace, subject: row.created_by, scopes: new Set(JSON.parse(account.scopes).filter(s => this.roleScopes(role).includes(s))) };
        } else issuer = this.principal(account, row.issuer_version);
      }
      else issuer = { workspace: row.workspace, subject: row.created_by, scopes: new Set(JSON.parse(row.issuer_scopes)) };
      if (issuer?.subject !== row.created_by) throw new Fault('invitation_unavailable');
      this.actor(row.workspace, issuer, row.role);
      const granted = JSON.parse(row.scopes); if (granted.some(s => !issuer.scopes.has(s) || !this.roleScopes(row.role).includes(s))) throw new Fault('invitation_unavailable');
      if (row.purpose === 'invite') {
        if (this.row(row.workspace, row.username) || this.db.prepare('SELECT 1 FROM workspace_members WHERE workspace=? AND subject=?').get(row.workspace, row.username)) throw new Fault('invitation_unavailable');
      } else {
        const account = this.row(row.workspace, row.username);
        if (!account || account.status !== 'reset-required' || account.credential_version !== row.target_version) throw new Fault('invitation_unavailable');
        const role = this.governance.role({ workspace: row.workspace, subject: row.username });
        if (role !== row.role) throw new Fault('invitation_unavailable');
      }
      return { row, issuer };
    } catch { throw new Fault('invitation_unavailable'); }
  }
  inspect(token, address) {
    this.throttle(address, 'invitation'); const { row } = this.usable(token);
    return { invitation: { purpose: row.purpose, workspace: row.workspace, username: row.username, role: row.role, scopes: JSON.parse(row.scopes), expiresAtMs: row.expires_at } };
  }
  async redeem(value, address) {
    object(value, ['token', 'password']); this.throttle(address, 'invitation'); this.password(value.password); this.usable(value.token);
    const salt = randomBytes(16), hash = await this.passwordHash(value.password, salt);
    return this.store.transaction(() => {
      const { row, issuer } = this.usable(value.token), now = this.now();
      if (row.purpose === 'invite') {
        if (this.db.prepare('SELECT count(*) AS n FROM browser_accounts WHERE workspace=?').get(row.workspace).n >= 1000 || this.db.prepare('SELECT count(*) AS n FROM workspace_members WHERE workspace=?').get(row.workspace).n >= 1000) throw new Fault('account_capacity', 429);
        this.db.prepare("INSERT INTO browser_accounts VALUES(?,?,?,'active',1,?,?,?,?)").run(row.workspace, row.username, row.scopes, salt.toString('base64url'), hash.toString('base64url'), now, now);
        this.governance.setMemberInTransaction(row.workspace, { subject: row.username, role: row.role }, issuer);
      } else this.db.prepare("UPDATE browser_accounts SET status='active',password_salt=?,password_hash=?,updated_at=? WHERE workspace=? AND username=? AND credential_version=?").run(salt.toString('base64url'), hash.toString('base64url'), now, row.workspace, row.username, row.target_version);
      const changed = this.db.prepare('UPDATE browser_invitation_tokens SET used_at=? WHERE workspace=? AND id=? AND used_at IS NULL AND revoked_at IS NULL AND expires_at>?').run(now, row.workspace, row.id, now).changes;
      if (changed !== 1) throw new Fault('invitation_unavailable');
      this.governance.recordAudit(row.workspace, row.purpose === 'invite' ? 'account.invitation.redeemed' : 'account.reset.redeemed', row.username, row.username, { invitationId: row.id, role: row.role });
      return this.principal(this.row(row.workspace, row.username));
    });
  }
}
