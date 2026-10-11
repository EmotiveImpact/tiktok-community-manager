import { randomUUID } from 'node:crypto';
import { existsSync, realpathSync, rmSync } from 'node:fs';
import { resolve, sep } from 'node:path';
import { canonical, digest, Fault, ident, object, pageLimit, text } from './validation.mjs';
import { archiveStorageUsage } from './archive-usage.mjs';

const ROLES = ['owner', 'admin', 'analyst', 'viewer', 'revoked'];
const sqlIdentifier = value => '"' + value.replaceAll('"', '""') + '"';
const DEFAULT_LIMITS = Object.freeze({ maxRecordingSeconds: 36_000, maxStorageBytes: 10 * 1024 ** 3, maxSpeechSeconds: 36_000, maxPendingJobs: 20 });
const schema = `
CREATE TABLE IF NOT EXISTS workspace_members(
 workspace TEXT NOT NULL,subject TEXT NOT NULL,role TEXT NOT NULL,updated_at INTEGER NOT NULL,updated_by TEXT NOT NULL,
 PRIMARY KEY(workspace,subject));
CREATE TABLE IF NOT EXISTS workspace_settings(
 workspace TEXT PRIMARY KEY,limits TEXT NOT NULL,retention_days INTEGER,updated_at INTEGER NOT NULL,updated_by TEXT NOT NULL,reason TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS case_access_policy(
 workspace TEXT NOT NULL,case_id TEXT NOT NULL,visibility TEXT NOT NULL,PRIMARY KEY(workspace,case_id),
 FOREIGN KEY(workspace,case_id) REFERENCES cases(workspace,id));
CREATE TABLE IF NOT EXISTS case_access_grants(
 workspace TEXT NOT NULL,case_id TEXT NOT NULL,subject TEXT NOT NULL,permission TEXT NOT NULL,updated_at INTEGER NOT NULL,updated_by TEXT NOT NULL,
 PRIMARY KEY(workspace,case_id,subject),FOREIGN KEY(workspace,case_id) REFERENCES cases(workspace,id));
CREATE TABLE IF NOT EXISTS workspace_audit(
 seq INTEGER PRIMARY KEY AUTOINCREMENT,id TEXT UNIQUE NOT NULL,workspace TEXT NOT NULL,actor TEXT NOT NULL,action TEXT NOT NULL,
 resource TEXT NOT NULL,details TEXT NOT NULL,created_at INTEGER NOT NULL,previous_hash TEXT,entry_hash TEXT NOT NULL);
CREATE INDEX IF NOT EXISTS audit_workspace ON workspace_audit(workspace,seq);
CREATE TABLE IF NOT EXISTS retention_receipts(
 workspace TEXT NOT NULL,id TEXT NOT NULL,session_id TEXT NOT NULL,actor TEXT NOT NULL,reason TEXT NOT NULL,deleted_at INTEGER NOT NULL,
 evidence_count INTEGER NOT NULL,storage_bytes INTEGER NOT NULL,PRIMARY KEY(workspace,id));
`;

/** Optional role/ACL layer. API scope checks remain independently required. */
export class Governance {
  constructor({ store, recorder, members = [], limits = {}, now = Date.now }) {
    this.store = store; this.db = store.db; this.recorder = recorder; this.now = now;
    this.defaults = this.validateLimits({ ...DEFAULT_LIMITS, ...limits });
    this.db.exec(schema);
    if (!Array.isArray(members) || members.length > 1000) throw new Fault('invalid_workspace_members');
    for (const member of members) {
      object(member, ['workspace', 'subject', 'role']); ident(member.workspace); this.validateSubject(member.subject); this.validateRole(member.role);
      // Seeds never overwrite a persisted revocation or operator role decision on restart.
      this.db.prepare('INSERT OR IGNORE INTO workspace_members VALUES(?,?,?,?,?)').run(member.workspace, member.subject, member.role, this.now(), 'configuration');
      this.ensureSettings(member.workspace);
    }
  }

  validateSubject(subject) { return text(subject, 100); }
  validateRole(role) { if (!ROLES.includes(role)) throw new Fault('invalid_member_role'); return role; }
  hasTable(table) { return !!this.db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name=?").get(table); }
  columns(table) { return this.db.prepare(`PRAGMA table_info(${sqlIdentifier(table)})`).all().map(row => row.name); }
  ensureSettings(workspace) {
    ident(workspace);
    this.db.prepare('INSERT OR IGNORE INTO workspace_settings VALUES(?,?,NULL,?,?,?)').run(workspace, canonical(this.defaults), this.now(), 'configuration', 'Initial private-pilot entitlement');
    return this.db.prepare('SELECT * FROM workspace_settings WHERE workspace=?').get(workspace);
  }
  role(principal) {
    ident(principal.workspace); this.validateSubject(principal.subject);
    const role = this.db.prepare('SELECT role FROM workspace_members WHERE workspace=? AND subject=?').get(principal.workspace, principal.subject)?.role;
    if (!role || role === 'revoked') throw new Fault('workspace_membership_denied', 403);
    return role;
  }
  authorize(principal, action, { caseId } = {}) {
    const role = this.role(principal); text(action, 100);
    const isAdmin = role === 'owner' || role === 'admin';
    if (action === 'workspace:admin' && !isAdmin) throw new Fault('workspace_admin_required', 403);
    if (role === 'viewer' && !action.endsWith(':read') && action !== 'agent:query') throw new Fault('workspace_role_denied', 403);
    if (caseId) {
      const item = this.store.case(principal.workspace, caseId);
      const visibility = this.db.prepare('SELECT visibility FROM case_access_policy WHERE workspace=? AND case_id=?').get(principal.workspace, caseId)?.visibility ?? 'workspace';
      if (visibility === 'restricted' && !isAdmin && item.createdBy !== principal.subject) {
        const grant = this.db.prepare('SELECT permission FROM case_access_grants WHERE workspace=? AND case_id=? AND subject=?').get(principal.workspace, caseId, principal.subject)?.permission;
        if (!grant || (action.endsWith(':write') && grant !== 'write')) throw new Fault('case_access_denied', 403);
      }
    }
    return { role, workspace: principal.workspace, subject: principal.subject };
  }
  actor(workspace, actor, action = 'workspace:admin') {
    const principal = typeof actor === 'string' ? { workspace, subject: actor } : actor;
    if (!principal || principal.workspace !== workspace) throw new Fault('workspace_membership_denied', 403);
    this.authorize(principal, action); return principal.subject;
  }
  workspace(workspace, principal) {
    const settings = this.ensureSettings(workspace);
    return { workspace, role: principal ? this.role(principal) : null, membersCount: this.members(workspace).filter(m => m.role !== 'revoked').length,
      limits: JSON.parse(settings.limits), usage: this.usage(workspace), retention: { days: settings.retention_days, updatedAtMs: settings.updated_at, updatedBy: settings.updated_by, reason: settings.reason },
      billing: { mode: 'manual-entitlement', providerConfigured: false } };
  }
  members(workspace) {
    ident(workspace);
    return this.db.prepare('SELECT subject,role,updated_at AS updatedAtMs,updated_by AS updatedBy FROM workspace_members WHERE workspace=? ORDER BY subject LIMIT 1000').all(workspace);
  }
  setMember(workspace, value, actor) {
    return this.store.transaction(() => this.setMemberInTransaction(workspace, value, actor));
  }
  setMemberInTransaction(workspace, value, actor) {
    if (!this.db.isTransaction) throw new Fault('member_transaction_required', 500);
    const subjectActor = this.actor(workspace, actor); object(value, ['subject', 'role']);
    const subject = this.validateSubject(value.subject), role = this.validateRole(value.role);
    const existing = this.db.prepare('SELECT role FROM workspace_members WHERE workspace=? AND subject=?').get(workspace, subject);
    if (existing?.role === 'owner' && role !== 'owner' && this.db.prepare("SELECT count(*) AS n FROM workspace_members WHERE workspace=? AND role='owner'").get(workspace).n <= 1) throw new Fault('last_workspace_owner', 409);
    const callerRole = this.role({ workspace, subject: subjectActor });
    if (callerRole !== 'owner' && (role === 'owner' || existing?.role === 'owner')) throw new Fault('workspace_owner_required', 403);
    this.db.prepare('INSERT INTO workspace_members VALUES(?,?,?,?,?) ON CONFLICT(workspace,subject) DO UPDATE SET role=excluded.role,updated_at=excluded.updated_at,updated_by=excluded.updated_by').run(workspace, subject, role, this.now(), subjectActor);
    this.recordAudit(workspace, 'member.role.changed', subject, subjectActor, { previousRole: existing?.role ?? null, role });
    return this.members(workspace).find(member => member.subject === subject);
  }
  caseAccess(workspace, caseId) {
    this.store.case(workspace, caseId);
    return { caseId, visibility: this.db.prepare('SELECT visibility FROM case_access_policy WHERE workspace=? AND case_id=?').get(workspace, caseId)?.visibility ?? 'workspace',
      grants: this.db.prepare('SELECT subject,permission,updated_at AS updatedAtMs,updated_by AS updatedBy FROM case_access_grants WHERE workspace=? AND case_id=? ORDER BY subject').all(workspace, caseId) };
  }
  grantCase(workspace, caseId, value, actor) {
    const subjectActor = this.actor(workspace, actor); this.store.case(workspace, caseId);
    object(value, ['visibility', 'subject', 'permission', 'reason']); text(value.reason, 1000);
    if (value.visibility !== undefined && !['workspace', 'restricted'].includes(value.visibility)) throw new Fault('invalid_case_visibility');
    if (value.subject !== undefined) {
      this.validateSubject(value.subject);
      if (!['read', 'write', 'none'].includes(value.permission)) throw new Fault('invalid_case_permission');
      if (!this.db.prepare("SELECT 1 FROM workspace_members WHERE workspace=? AND subject=? AND role!='revoked'").get(workspace, value.subject)) throw new Fault('member_not_found', 404);
    } else if (value.permission !== undefined) throw new Fault('case_subject_required');
    if (value.visibility === undefined && value.subject === undefined) throw new Fault('case_access_change_required');
    return this.store.transaction(() => {
      if (value.visibility !== undefined) this.db.prepare('INSERT INTO case_access_policy VALUES(?,?,?) ON CONFLICT(workspace,case_id) DO UPDATE SET visibility=excluded.visibility').run(workspace, caseId, value.visibility);
      if (value.subject !== undefined && value.permission === 'none') this.db.prepare('DELETE FROM case_access_grants WHERE workspace=? AND case_id=? AND subject=?').run(workspace, caseId, value.subject);
      else if (value.subject !== undefined) this.db.prepare('INSERT INTO case_access_grants VALUES(?,?,?,?,?,?) ON CONFLICT(workspace,case_id,subject) DO UPDATE SET permission=excluded.permission,updated_at=excluded.updated_at,updated_by=excluded.updated_by').run(workspace, caseId, value.subject, value.permission, this.now(), subjectActor);
      this.recordAudit(workspace, 'case.access.changed', caseId, subjectActor, value);
      return this.caseAccess(workspace, caseId);
    });
  }
  recordAudit(workspace, action, resource, actor, details = {}) {
    if (!this.db.isTransaction) return this.store.transaction(() => this.recordAudit(workspace, action, resource, actor, details));
    ident(workspace); text(action, 100); text(resource, 256); this.validateSubject(actor); object(details);
    const detailsJson = canonical(details);
    if (Buffer.byteLength(detailsJson) > 16_384) throw new Fault('audit_details_too_large');
    const previousSha256 = this.db.prepare('SELECT entry_hash FROM workspace_audit WHERE workspace=? ORDER BY seq DESC LIMIT 1').get(workspace)?.entry_hash ?? null;
    const entry = { id: randomUUID(), workspace, actor, action, resource, details: JSON.parse(detailsJson), createdAtMs: this.now(), previousSha256 };
    const entrySha256 = digest(entry);
    this.db.prepare('INSERT INTO workspace_audit(id,workspace,actor,action,resource,details,created_at,previous_hash,entry_hash) VALUES(?,?,?,?,?,?,?,?,?)').run(entry.id, workspace, actor, action, resource, detailsJson, entry.createdAtMs, previousSha256, entrySha256);
    return { ...entry, entrySha256 };
  }
  audit(workspace, { limit = 100 } = {}) {
    ident(workspace); limit = pageLimit(limit);
    return this.db.prepare('SELECT * FROM workspace_audit WHERE workspace=? ORDER BY seq DESC LIMIT ?').all(workspace, limit).map(row => ({ id: row.id, workspace, actor: row.actor, action: row.action, resource: row.resource, details: JSON.parse(row.details), createdAtMs: row.created_at, previousSha256: row.previous_hash, entrySha256: row.entry_hash }));
  }
  verifyAudit(workspace) {
    const rows = this.db.prepare('SELECT * FROM workspace_audit WHERE workspace=? ORDER BY seq').all(ident(workspace)); let previous = null;
    for (const row of rows) {
      const entry = { id: row.id, workspace, actor: row.actor, action: row.action, resource: row.resource, details: JSON.parse(row.details), createdAtMs: row.created_at, previousSha256: row.previous_hash };
      if (row.previous_hash !== previous || row.entry_hash !== digest(entry)) throw new Fault('audit_integrity_failed', 409);
      previous = row.entry_hash;
    }
    return { valid: true, entries: rows.length, lastSha256: previous, assurance: 'local-hash-chain' };
  }
  usage(workspace) {
    ident(workspace); let recordingMs = 0, storageBytes = 0, pendingJobs = 0, reservedRecordingSeconds = 0, reservedSpeechSeconds = 0, speechMs = 0;
    if (this.hasTable('media_segments')) {
      const row = this.db.prepare('SELECT coalesce(sum(duration_ms),0) AS ms,coalesce(sum(bytes),0) AS bytes FROM media_segments WHERE workspace=?').get(workspace);
      recordingMs = row.ms; storageBytes = row.bytes;
    }
    if (this.hasTable('recording_jobs')) {
      const row = this.hasTable('media_segments')
        ? this.db.prepare("SELECT count(*) AS n,coalesce(sum(max(0,j.max_seconds-coalesce((SELECT sum(m.duration_ms)/1000.0 FROM media_segments m WHERE m.workspace=j.workspace AND m.job_id=j.id),0))),0) AS seconds FROM recording_jobs j WHERE j.workspace=? AND j.state NOT IN('completed','stopped','failed')").get(workspace)
        : this.db.prepare("SELECT count(*) AS n,coalesce(sum(max_seconds),0) AS seconds FROM recording_jobs WHERE workspace=? AND state NOT IN('completed','stopped','failed')").get(workspace);
      pendingJobs = row.n; reservedRecordingSeconds = row.seconds;
    }
    if (this.hasTable('speech_inputs')) {
      speechMs = this.db.prepare("SELECT coalesce(sum(duration_ms),0) AS ms FROM speech_inputs WHERE workspace=? AND state='completed'").get(workspace).ms;
      reservedSpeechSeconds = this.db.prepare("SELECT coalesce(sum(i.duration_ms),0) AS ms FROM speech_inputs i JOIN speech_jobs j ON i.workspace=j.workspace AND i.job_id=j.id WHERE j.workspace=? AND j.state NOT IN('completed','stopped','failed') AND i.state!='completed'").get(workspace).ms / 1000;
    }
    else if (this.hasTable('speech_segments') && this.columns('speech_segments').includes('duration_ms')) speechMs = this.db.prepare('SELECT coalesce(sum(duration_ms),0) AS ms FROM speech_segments WHERE workspace=?').get(workspace).ms;
    else if (this.hasTable('speech_jobs') && this.columns('speech_jobs').includes('audio_duration_ms')) speechMs = this.db.prepare("SELECT coalesce(sum(audio_duration_ms),0) AS ms FROM speech_jobs WHERE workspace=? AND state='completed'").get(workspace).ms;
    if (this.hasTable('speech_jobs')) pendingJobs += this.db.prepare("SELECT count(*) AS n FROM speech_jobs WHERE workspace=? AND state NOT IN('completed','stopped','failed')").get(workspace).n;
    const localStorageBytes = storageBytes;
    const archived = this.hasTable('media_archives')
      ? archiveStorageUsage(this.db, workspace)
      : { archivedStorageBytes: 0, reservedStorageBytes: 0, pendingJobs: 0, uniqueObjectKeys: 0 };
    storageBytes += archived.archivedStorageBytes;
    pendingJobs += archived.pendingJobs;
    return { recordingSeconds: recordingMs / 1000, storageBytes, localStorageBytes,
      archivedStorageBytes: archived.archivedStorageBytes, reservedStorageBytes: archived.reservedStorageBytes,
      archivedObjectKeys: archived.uniqueObjectKeys, speechSeconds: speechMs / 1000, pendingJobs,
      reservedRecordingSeconds, reservedSpeechSeconds, measurement: 'retained-media-speech-and-logical-encrypted-archive', billedAmount: null };
  }
  validateLimits(value) {
    object(value, Object.keys(DEFAULT_LIMITS));
    for (const [key, number] of Object.entries(value)) if (!Number.isSafeInteger(number) || number < 1 || (key === 'maxPendingJobs' && number > 1000)) throw new Fault('invalid_workspace_limit');
    return value;
  }
  setLimits(workspace, value, actor) {
    const subject = this.actor(workspace, actor); object(value, [...Object.keys(DEFAULT_LIMITS), 'reason']); text(value.reason, 1000);
    const { reason, ...changes } = value; if (!Object.keys(changes).length) throw new Fault('workspace_limit_change_required'); this.validateLimits(changes);
    return this.store.transaction(() => {
      const settings = this.ensureSettings(workspace), limits = { ...JSON.parse(settings.limits), ...changes };
      this.db.prepare('UPDATE workspace_settings SET limits=?,updated_at=?,updated_by=?,reason=? WHERE workspace=?').run(canonical(limits), this.now(), subject, reason, workspace);
      this.recordAudit(workspace, 'workspace.limits.changed', workspace, subject, { ...changes, reason }); return limits;
    });
  }
  checkQuota(workspace, additions = {}) {
    object(additions, ['recordingSeconds', 'storageBytes', 'speechSeconds', 'pendingJobs']);
    const limits = JSON.parse(this.ensureSettings(workspace).limits), usage = this.usage(workspace);
    for (const [meter, limit] of [['recordingSeconds', 'maxRecordingSeconds'], ['storageBytes', 'maxStorageBytes'], ['speechSeconds', 'maxSpeechSeconds'], ['pendingJobs', 'maxPendingJobs']]) {
      const addition = additions[meter] ?? 0;
      if (typeof addition !== 'number' || !Number.isFinite(addition) || addition < 0) throw new Fault('invalid_usage_addition');
      const reserved = meter === 'recordingSeconds' ? usage.reservedRecordingSeconds : meter === 'speechSeconds' ? usage.reservedSpeechSeconds : meter === 'storageBytes' ? usage.reservedStorageBytes : 0;
      if (usage[meter] + reserved + addition > limits[limit]) throw new Fault('workspace_quota_exceeded', 429);
    }
    return { allowed: true, usage, limits };
  }
  configureRetention(workspace, value, actor) {
    const subject = this.actor(workspace, actor); object(value, ['days', 'reason']); text(value.reason, 1000);
    if (value.days !== null && (!Number.isSafeInteger(value.days) || value.days < 1 || value.days > 3650)) throw new Fault('invalid_retention_days');
    return this.store.transaction(() => {
      this.ensureSettings(workspace);
      this.db.prepare('UPDATE workspace_settings SET retention_days=?,updated_at=?,updated_by=?,reason=? WHERE workspace=?').run(value.days, this.now(), subject, value.reason, workspace);
      this.recordAudit(workspace, 'retention.policy.changed', workspace, subject, value); return this.workspace(workspace).retention;
    });
  }
  retentionBlock(workspace, sessionId) {
    if (this.db.prepare('SELECT 1 FROM case_events ce JOIN events e ON ce.workspace=e.workspace AND ce.event_id=e.id WHERE e.workspace=? AND e.session_id=? LIMIT 1').get(workspace, sessionId)) return 'Referenced by an investigation';
    if (this.hasTable('recording_jobs') && this.db.prepare("SELECT 1 FROM recording_jobs WHERE workspace=? AND session_id=? AND state NOT IN('completed','stopped','failed') LIMIT 1").get(workspace, sessionId)) return 'Recording job is active or pending';
    if (this.hasTable('speech_jobs') && this.db.prepare("SELECT 1 FROM speech_jobs WHERE workspace=? AND session_id=? AND state NOT IN('completed','stopped','failed') LIMIT 1").get(workspace, sessionId)) return 'Speech job is active or pending';
    // Refuse extension-owned relations rather than silently breaking their provenance.
    const safe = new Set(['sessions', 'events', 'assertions', 'recording_jobs', 'media_segments', 'recording_budgets', 'recording_job_leases', 'retention_receipts', 'speech_jobs', 'speech_inputs']);
    const referencedIds = new Set([sessionId, ...this.db.prepare('SELECT id FROM events WHERE workspace=? AND session_id=?').all(workspace, sessionId).map(row => row.id)]);
    const containsReference = value => typeof value === 'string' ? referencedIds.has(value) : Array.isArray(value) ? value.some(containsReference) : value && typeof value === 'object' ? Object.values(value).some(containsReference) : false;
    for (const { name } of this.db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'").all()) {
      if (safe.has(name)) continue;
      const columns = this.columns(name);
      if (columns.includes('workspace') && columns.includes('session_id') && this.db.prepare(`SELECT 1 FROM ${sqlIdentifier(name)} WHERE workspace=? AND session_id=? LIMIT 1`).get(workspace, sessionId)) return `Retained ${name.replaceAll('_', ' ')} references`;
      if (columns.includes('workspace') && columns.includes('event_id') && this.db.prepare(`SELECT 1 FROM ${sqlIdentifier(name)} r JOIN events e ON r.workspace=e.workspace AND r.event_id=e.id WHERE e.workspace=? AND e.session_id=? LIMIT 1`).get(workspace, sessionId)) return 'Referenced by retained reviewed records';
      if (columns.includes('workspace') && columns.includes('evidence_id') && this.db.prepare(`SELECT 1 FROM ${sqlIdentifier(name)} r JOIN events e ON r.workspace=e.workspace AND r.evidence_id=e.id WHERE e.workspace=? AND e.session_id=? LIMIT 1`).get(workspace, sessionId)) return 'Referenced by retained alerts';
      if (columns.includes('workspace') && columns.includes('recording_job_id') && this.hasTable('recording_jobs') && this.db.prepare(`SELECT 1 FROM ${sqlIdentifier(name)} r JOIN recording_jobs j ON r.workspace=j.workspace AND r.recording_job_id=j.id WHERE j.workspace=? AND j.session_id=? LIMIT 1`).get(workspace, sessionId)) return 'Referenced by a retained media archive';
      if (columns.includes('workspace')) for (const field of ['payload', 'configuration', 'evidence_ids', 'manifest']) if (columns.includes(field)) {
        for (const row of this.db.prepare(`SELECT ${sqlIdentifier(field)} AS value FROM ${sqlIdentifier(name)} WHERE workspace=?`).iterate(workspace)) {
          try { if (containsReference(JSON.parse(row.value))) return 'Referenced by retained configuration or reviewed records'; } catch { return 'Retained reference cannot be verified'; }
        }
      }
    }
    return null;
  }
  previewRetention(workspace) {
    const settings = this.ensureSettings(workspace), cutoffAtMs = settings.retention_days === null ? null : this.now() - settings.retention_days * 86_400_000;
    const sessions = cutoffAtMs === null ? [] : this.db.prepare('SELECT id,title,started_at FROM sessions WHERE workspace=? AND started_at<? ORDER BY started_at,id LIMIT 100').all(workspace, cutoffAtMs).map(row => {
      const blockedReason = this.retentionBlock(workspace, row.id), evidenceCount = this.db.prepare('SELECT count(*) AS n FROM events WHERE workspace=? AND session_id=?').get(workspace, row.id).n;
      const storageBytes = this.hasTable('media_segments') ? this.db.prepare('SELECT coalesce(sum(m.bytes),0) AS n FROM media_segments m JOIN recording_jobs j ON m.workspace=j.workspace AND m.job_id=j.id WHERE j.workspace=? AND j.session_id=?').get(workspace, row.id).n : 0;
      return { id: row.id, title: row.title, startedAtMs: row.started_at, evidenceCount, storageBytes, eligible: !blockedReason, blockedReason };
    });
    // Stable policy version/candidate content, so a user can inspect then apply without racing a ticking clock.
    const previewHash = digest({ workspace, days: settings.retention_days, policyUpdatedAtMs: settings.updated_at, sessions });
    return { previewHash, cutoffAtMs, sessions, eligibleSessionIds: sessions.filter(s => s.eligible).map(s => s.id), maxApply: 100 };
  }
  runRetention(workspace, value, actor) {
    const subject = this.actor(workspace, actor); object(value, ['previewHash', 'sessionIds', 'reason']); text(value.reason, 1000);
    if (!Array.isArray(value.sessionIds) || !value.sessionIds.length || value.sessionIds.length > 100 || new Set(value.sessionIds).size !== value.sessionIds.length) throw new Fault('invalid_retention_selection');
    value.sessionIds.forEach(ident);
    const directories = [], receipts = this.store.transaction(() => {
      const preview = this.previewRetention(workspace);
      if (value.previewHash !== preview.previewHash) throw new Fault('retention_preview_changed', 409);
      for (const id of value.sessionIds) if (!preview.eligibleSessionIds.includes(id)) throw new Fault('retention_session_protected', 409);
      return value.sessionIds.map(sessionId => {
        const session = preview.sessions.find(s => s.id === sessionId);
        if (this.hasTable('speech_jobs')) {
          if (this.hasTable('speech_inputs')) this.db.prepare('DELETE FROM speech_inputs WHERE workspace=? AND job_id IN(SELECT id FROM speech_jobs WHERE workspace=? AND session_id=?)').run(workspace, workspace, sessionId);
          this.db.prepare('DELETE FROM speech_jobs WHERE workspace=? AND session_id=?').run(workspace, sessionId);
        }
        if (this.hasTable('recording_jobs')) {
          const jobs = this.db.prepare('SELECT id FROM recording_jobs WHERE workspace=? AND session_id=?').all(workspace, sessionId);
          for (const job of jobs) {
            for (const table of ['media_segments', 'recording_budgets', 'recording_job_leases']) if (this.hasTable(table)) this.db.prepare(`DELETE FROM ${table} WHERE workspace=? AND job_id=?`).run(workspace, job.id);
            if (this.recorder) directories.push(resolve(this.recorder.root, workspace, job.id));
          }
          this.db.prepare('DELETE FROM recording_jobs WHERE workspace=? AND session_id=?').run(workspace, sessionId);
        }
        this.db.prepare('DELETE FROM assertions WHERE workspace=? AND event_id IN(SELECT id FROM events WHERE workspace=? AND session_id=?)').run(workspace, workspace, sessionId);
        this.db.prepare('DELETE FROM events WHERE workspace=? AND session_id=?').run(workspace, sessionId);
        this.db.prepare('DELETE FROM sessions WHERE workspace=? AND id=?').run(workspace, sessionId);
        const receipt = { id: randomUUID(), sessionId, deletedAtMs: this.now(), evidenceCount: session.evidenceCount, storageBytes: session.storageBytes, reason: value.reason };
        this.db.prepare('INSERT INTO retention_receipts VALUES(?,?,?,?,?,?,?,?)').run(workspace, receipt.id, sessionId, subject, value.reason, receipt.deletedAtMs, receipt.evidenceCount, receipt.storageBytes);
        this.recordAudit(workspace, 'retention.session.deleted', sessionId, subject, receipt); return receipt;
      });
    });
    // Data deletion commits first. Failed filesystem cleanup is explicit and recoverable, never hidden.
    const cleanupFailures = [];
    for (const directory of directories) {
      try {
        if (!existsSync(directory)) continue;
        const root = realpathSync(this.recorder.root), target = realpathSync(directory);
        if (!target.startsWith(root + sep)) throw new Error('outside_media_root');
        rmSync(target, { recursive: true, force: true });
      } catch { cleanupFailures.push(directory.split(sep).slice(-1)[0]); }
    }
    if (cleanupFailures.length) this.recordAudit(workspace, 'retention.cleanup.failed', workspace, subject, { jobIds: cleanupFailures });
    return { receipts, cleanupFailures, deletedSessions: receipts.length };
  }
}
