import { DatabaseSync } from 'node:sqlite';
import { randomUUID } from 'node:crypto';
import { canonical, digest, Fault, handle, ident, markdownText, normaliseEvent, object, pageLimit, sourceUrl, text, timestamp } from './validation.mjs';

const eventKinds = new Set(['chat', 'caption', 'transcript', 'observation', 'gap']);
const literalContains = query => '%' + query.replace(/[\\%_]/g, '\\$&') + '%';
export const REVIEW_EVIDENCE_LIMIT = 200;

const schema = `
CREATE TABLE IF NOT EXISTS metadata(version INTEGER NOT NULL);
INSERT INTO metadata SELECT 1 WHERE NOT EXISTS(SELECT 1 FROM metadata);
CREATE TABLE IF NOT EXISTS sessions(
  workspace TEXT NOT NULL, id TEXT NOT NULL, platform TEXT NOT NULL, account TEXT,
  source_url TEXT NOT NULL, title TEXT NOT NULL, started_at INTEGER NOT NULL,
  PRIMARY KEY(workspace,id));
CREATE TABLE IF NOT EXISTS events(
  seq INTEGER PRIMARY KEY AUTOINCREMENT, workspace TEXT NOT NULL, session_id TEXT NOT NULL,
  id TEXT NOT NULL, adapter TEXT NOT NULL, provider_id TEXT NOT NULL,
  kind TEXT NOT NULL, text TEXT NOT NULL, account TEXT, speaker_id TEXT,
  source_ts INTEGER, received_at INTEGER NOT NULL, captured_at INTEGER,
  dedup_hash TEXT NOT NULL, payload TEXT NOT NULL, payload_hash TEXT NOT NULL,
  previous_hash TEXT, entry_hash TEXT NOT NULL,
  UNIQUE(workspace,id), UNIQUE(workspace,session_id,adapter,provider_id),
  FOREIGN KEY(workspace,session_id) REFERENCES sessions(workspace,id));
CREATE INDEX IF NOT EXISTS event_session ON events(workspace,session_id,seq);
CREATE TABLE IF NOT EXISTS assertions(
  seq INTEGER PRIMARY KEY AUTOINCREMENT, workspace TEXT NOT NULL, event_id TEXT NOT NULL,
  account TEXT NOT NULL, reviewer TEXT NOT NULL, reason TEXT NOT NULL, created_at INTEGER NOT NULL,
  FOREIGN KEY(workspace,event_id) REFERENCES events(workspace,id));
CREATE INDEX IF NOT EXISTS assertion_event ON assertions(workspace,event_id,seq);
CREATE TABLE IF NOT EXISTS cases(
  workspace TEXT NOT NULL, id TEXT NOT NULL, title TEXT NOT NULL, question TEXT NOT NULL,
  created_by TEXT NOT NULL, created_at INTEGER NOT NULL, PRIMARY KEY(workspace,id));
CREATE TABLE IF NOT EXISTS case_events(
  workspace TEXT NOT NULL, case_id TEXT NOT NULL, event_id TEXT NOT NULL, linked_by TEXT NOT NULL,
  linked_at INTEGER NOT NULL, PRIMARY KEY(workspace,case_id,event_id),
  FOREIGN KEY(workspace,case_id) REFERENCES cases(workspace,id),
  FOREIGN KEY(workspace,event_id) REFERENCES events(workspace,id));
`;

export class EvidenceStore {
  constructor(path = ':memory:', { now = Date.now, database } = {}) {
    this.now = now;
    this.db = database ?? new DatabaseSync(path);
    this.db.exec('PRAGMA foreign_keys=ON; PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL; PRAGMA busy_timeout=5000;');
    this.db.exec(schema);
    const versions = this.db.prepare('SELECT version FROM metadata').all();
    if (versions.length !== 1 || versions[0].version !== 1) throw new Fault('unsupported_database_version', 500);
  }

  close() { this.db.close(); }

  transaction(operation) {
    this.db.exec('BEGIN IMMEDIATE');
    try { const result = operation(); this.db.exec('COMMIT'); return result; }
    catch (error) { this.db.exec('ROLLBACK'); throw error; }
  }

  session(workspace, id) {
    ident(workspace); ident(id);
    const row = this.db.prepare('SELECT * FROM sessions WHERE workspace=? AND id=?').get(workspace, id);
    if (!row) throw new Fault('session_not_found', 404);
    return { id: row.id, platform: row.platform, account: row.account, sourceUrl: row.source_url, title: row.title, startedAtMs: row.started_at };
  }

  createSession(workspace, value) {
    ident(workspace); object(value, ['id', 'platform', 'account', 'sourceUrl', 'title', 'startedAtMs']);
    const id = value.id === undefined ? randomUUID() : ident(value.id);
    const platform = ident(value.platform);
    const account = handle(value.account);
    const url = sourceUrl(value.sourceUrl);
    const title = text(value.title, 256);
    const startedAt = timestamp(value.startedAtMs);
    return this.transaction(() => {
      if (this.db.prepare('SELECT 1 FROM sessions WHERE workspace=? AND id=?').get(workspace, id)) throw new Fault('session_exists', 409);
      this.db.prepare('INSERT INTO sessions VALUES(?,?,?,?,?,?,?)').run(workspace, id, platform, account, url, title, startedAt);
      return this.session(workspace, id);
    });
  }

  listSessions(workspace, limit = 100, offset = 0, { query = '' } = {}) {
    ident(workspace); limit = pageLimit(limit); text(query, 512, true);
    if (!Number.isSafeInteger(offset) || offset < 0) throw new Fault('invalid_cursor');
    const clauses = ['workspace=?'], args = [workspace];
    if (query) {
      clauses.push("lower(title || ' ' || coalesce('@' || account,'') || ' ' || platform) LIKE lower(?) ESCAPE '\\'");
      args.push(literalContains(query));
    }
    return this.db.prepare(`SELECT id FROM sessions WHERE ${clauses.join(' AND ')} ORDER BY started_at DESC,id LIMIT ? OFFSET ?`).all(...args, limit, offset)
      .map(row => this.session(workspace, row.id));
  }

  append(workspace, sessionId, values) {
    this.session(workspace, sessionId);
    if (!Array.isArray(values) || !values.length || values.length > 200) throw new Fault('invalid_event_batch');
    const prepared = values.map(normaliseEvent);
    return this.transaction(() => prepared.map(({ content, capturedAtMs }) => {
      const contentHash = digest(content);
      const existing = this.db.prepare('SELECT * FROM events WHERE workspace=? AND session_id=? AND adapter=? AND provider_id=?')
        .get(workspace, sessionId, content.source.adapter, content.source.eventId);
      if (existing) {
        if (existing.dedup_hash !== contentHash) throw new Fault('event_identity_conflict', 409);
        return { inserted: false, evidence: this.project(existing) };
      }
      const id = 'ev_' + digest([workspace, sessionId, content.source.adapter, content.source.eventId]);
      const receivedAtMs = timestamp(this.now());
      const envelope = { schemaVersion: 1, workspace, sessionId, id, ...content, capturedAtMs, receivedAtMs };
      const payload = canonical(envelope);
      const payloadHash = digest(payload);
      const previousHash = this.db.prepare('SELECT entry_hash FROM events WHERE workspace=? AND session_id=? ORDER BY seq DESC LIMIT 1')
        .get(workspace, sessionId)?.entry_hash ?? null;
      const entryHash = digest({ id, payloadHash, previousHash });
      this.db.prepare('INSERT INTO events(workspace,session_id,id,adapter,provider_id,kind,text,account,speaker_id,source_ts,received_at,captured_at,dedup_hash,payload,payload_hash,previous_hash,entry_hash) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)')
        .run(workspace, sessionId, id, content.source.adapter, content.source.eventId, content.kind, content.text, content.account, content.speakerId,
          content.sourceTimestampMs, receivedAtMs, capturedAtMs, contentHash, payload, payloadHash, previousHash, entryHash);
      return { inserted: true, evidence: this.evidence(workspace, id) };
    }));
  }

  project(row) {
    const original = JSON.parse(row.payload);
    const latest = this.db.prepare('SELECT * FROM assertions WHERE workspace=? AND event_id=? ORDER BY seq DESC LIMIT 1').get(row.workspace, row.id);
    const attribution = latest ? {
      status: 'operator-asserted', account: latest.account, reviewer: latest.reviewer, reason: latest.reason,
      assertionSequence: latest.seq, createdAtMs: latest.created_at,
    } : { status: original.account ? 'platform-account' : 'unknown', account: original.account };
    return { ...original, sequence: row.seq, attribution, integrity: { payloadSha256: row.payload_hash, previousSha256: row.previous_hash, entrySha256: row.entry_hash } };
  }

  evidence(workspace, id) {
    ident(workspace); ident(id);
    const row = this.db.prepare('SELECT * FROM events WHERE workspace=? AND id=?').get(workspace, id);
    if (!row) throw new Fault('evidence_not_found', 404);
    return this.project(row);
  }

  events(workspace, sessionId, { after = 0, limit = 100, query = '', kind = 'all' } = {}) {
    this.session(workspace, sessionId); limit = pageLimit(limit); text(query, 512, true);
    if (!Number.isSafeInteger(after) || after < 0) throw new Fault('invalid_cursor');
    if (kind !== 'all' && !eventKinds.has(kind)) throw new Fault('invalid_event_kind');
    const clauses = ['e.workspace=?', 'e.session_id=?', 'e.seq>?'], args = [workspace, sessionId, after];
    if (kind !== 'all') { clauses.push('e.kind=?'); args.push(kind); }
    if (query) {
      // Match the displayed current attribution without rewriting original evidence.
      // Escaping applies to the bound pattern on both SQLite and PostgreSQL.
      clauses.push("lower(e.text || ' ' || coalesce((SELECT a.account FROM assertions a WHERE a.workspace=e.workspace AND a.event_id=e.id ORDER BY a.seq DESC LIMIT 1),e.account,'')) LIKE lower(?) ESCAPE '\\'");
      args.push(literalContains(query));
    }
    return this.db.prepare(`SELECT e.* FROM events e WHERE ${clauses.join(' AND ')} ORDER BY e.seq LIMIT ?`)
      .all(...args, limit).map(row => this.project(row));
  }

  evidenceFilter(workspace, { query = '', account = null, sessionId = null, kind = 'all' } = {}) {
    ident(workspace); text(query, 512, true);
    account = handle(account);
    if (sessionId !== null) this.session(workspace, sessionId);
    if (kind !== 'all' && !eventKinds.has(kind)) throw new Fault('invalid_event_kind');
    const clauses = ['e.workspace=?']; const args = [workspace];
    const currentAccount = 'coalesce((SELECT a.account FROM assertions a WHERE a.workspace=e.workspace AND a.event_id=e.id ORDER BY a.seq DESC LIMIT 1),e.account)';
    if (query) {
      clauses.push("lower(e.text) LIKE lower(?) ESCAPE '\\'");
      args.push(literalContains(query));
    }
    if (kind !== 'all') { clauses.push('e.kind=?'); args.push(kind); }
    if (sessionId !== null) { clauses.push('e.session_id=?'); args.push(sessionId); }
    if (account !== null) {
      clauses.push(`${currentAccount}=?`);
      args.push(account);
    }
    return { clauses, args };
  }

  search(workspace, options = {}) { return this.searchPage(workspace, options).evidence; }

  searchPage(workspace, { limit = 100, offset = 0, ...filters } = {}) {
    limit = pageLimit(limit);
    if (!Number.isSafeInteger(offset) || offset < 0) throw new Fault('invalid_cursor');
    const { clauses, args } = this.evidenceFilter(workspace, filters);
    const rows = this.db.prepare(`SELECT e.* FROM events e WHERE ${clauses.join(' AND ')} ORDER BY e.seq DESC LIMIT ? OFFSET ?`).all(...args, limit + 1, offset);
    const hasMore = rows.length > limit;
    return { evidence: rows.slice(0, limit).map(row => this.project(row)), hasMore, nextOffset: hasMore ? offset + limit : null };
  }

  assertAccount(workspace, eventId, value, reviewer) {
    object(value, ['account', 'reason']); text(reviewer, 100);
    const event = this.evidence(workspace, eventId);
    if (!['caption', 'transcript'].includes(event.kind)) throw new Fault('speech_event_required');
    const account = handle(value.account);
    if (!account) throw new Fault('account_required');
    const reason = text(value.reason, 2048);
    return this.transaction(() => {
      this.db.prepare('INSERT INTO assertions(workspace,event_id,account,reviewer,reason,created_at) VALUES(?,?,?,?,?,?)')
        .run(workspace, eventId, account, reviewer, reason, timestamp(this.now()));
      return this.evidence(workspace, eventId);
    });
  }

  assertionHistory(workspace, eventId) {
    this.evidence(workspace, eventId);
    return this.db.prepare('SELECT seq,account,reviewer,reason,created_at FROM assertions WHERE workspace=? AND event_id=? ORDER BY seq').all(workspace, eventId);
  }

  case(workspace, id) {
    ident(workspace); ident(id);
    const row = this.db.prepare('SELECT * FROM cases WHERE workspace=? AND id=?').get(workspace, id);
    if (!row) throw new Fault('case_not_found', 404);
    return { id: row.id, title: row.title, question: row.question, createdBy: row.created_by, createdAtMs: row.created_at };
  }

  listCases(workspace, limit = 100, offset = 0, options = {}) {
    return this.casePage(workspace, { ...options, limit, offset }).cases;
  }

  casePage(workspace, { limit = 100, offset = 0, query = '', accessibleTo = null } = {}) {
    ident(workspace); limit = pageLimit(limit); text(query, 512, true);
    if (!Number.isSafeInteger(offset) || offset < 0) throw new Fault('invalid_cursor');
    const clauses = ['c.workspace=?'], args = [workspace];
    if (query) { clauses.push("lower(c.title || ' ' || c.question) LIKE lower(?) ESCAPE '\\'"); args.push(literalContains(query)); }
    if (accessibleTo !== null) {
      text(accessibleTo, 100);
      // The authenticated server supplies this subject only when governance is enabled.
      // Apply the same policy as authorize() before pagination, never after its limit.
      clauses.push("(NOT EXISTS(SELECT 1 FROM case_access_policy p WHERE p.workspace=c.workspace AND p.case_id=c.id AND p.visibility='restricted') OR c.created_by=? OR EXISTS(SELECT 1 FROM case_access_grants g WHERE g.workspace=c.workspace AND g.case_id=c.id AND g.subject=? AND g.permission IN('read','write')))");
      args.push(accessibleTo, accessibleTo);
    }
    const rows = this.db.prepare(`SELECT c.id FROM cases c WHERE ${clauses.join(' AND ')} ORDER BY c.created_at DESC,c.id LIMIT ? OFFSET ?`).all(...args, limit + 1, offset);
    const hasMore = rows.length > limit;
    return { cases: rows.slice(0, limit).map(row => this.case(workspace, row.id)), hasMore, nextOffset: hasMore ? offset + limit : null };
  }

  context(workspace, id, limit = 25) {
    const event = this.evidence(workspace, id); limit = pageLimit(limit);
    const before = this.db.prepare('SELECT * FROM events WHERE workspace=? AND session_id=? AND seq<? ORDER BY seq DESC LIMIT ?').all(workspace, event.sessionId, event.sequence, limit).reverse();
    const after = this.db.prepare('SELECT * FROM events WHERE workspace=? AND session_id=? AND seq>? ORDER BY seq LIMIT ?').all(workspace, event.sessionId, event.sequence, limit);
    return { event, session: this.session(workspace, event.sessionId), before: before.map(row => this.project(row)), after: after.map(row => this.project(row)), relationship: 'temporal-only' };
  }

  createCase(workspace, value, reviewer) {
    ident(workspace); object(value, ['id', 'title', 'question', 'evidenceIds']); text(reviewer, 100);
    const id = value.id === undefined ? randomUUID() : ident(value.id);
    const title = text(value.title, 256); const question = text(value.question, 2048);
    return this.transaction(() => {
      if (this.db.prepare('SELECT 1 FROM cases WHERE workspace=? AND id=?').get(workspace, id)) throw new Fault('case_exists', 409);
      this.db.prepare('INSERT INTO cases VALUES(?,?,?,?,?,?)').run(workspace, id, title, question, reviewer, timestamp(this.now()));
      if (value.evidenceIds !== undefined) {
        if (!Array.isArray(value.evidenceIds) || value.evidenceIds.length > 200) throw new Fault('invalid_evidence_batch');
        if (value.evidenceIds.length) this.linkEvidenceInTransaction(workspace, id, value.evidenceIds, reviewer);
      }
      return this.case(workspace, id);
    });
  }

  linkEvidence(workspace, caseId, ids, reviewer, options = {}) {
    this.case(workspace, caseId); text(reviewer, 100);
    return this.transaction(() => this.linkEvidenceInTransaction(workspace, caseId, ids, reviewer, options));
  }

  linkEvidenceInTransaction(workspace, caseId, ids, reviewer, { forReview = false } = {}) {
    if (!this.db.isTransaction) throw new Fault('evidence_link_transaction_required', 500);
    if (typeof forReview !== 'boolean') throw new Fault('invalid_for_review');
    if (!Array.isArray(ids) || !ids.length || ids.length > 200) throw new Fault('invalid_evidence_batch');
    const uniqueIds = [...new Set(ids)];
    uniqueIds.forEach(id => this.evidence(workspace, id));
    const current = this.db.prepare('SELECT count(*) AS n FROM case_events WHERE workspace=? AND case_id=?').get(workspace, caseId).n;
    const newIds = uniqueIds.filter(id => !this.db.prepare('SELECT 1 FROM case_events WHERE workspace=? AND case_id=? AND event_id=?').get(workspace, caseId, id));
    if (forReview && current + newIds.length > REVIEW_EVIDENCE_LIMIT) throw new Fault('investigation_evidence_capacity', 409);
    if (current + newIds.length > 1000) throw new Fault('case_evidence_capacity', 409);
    for (const id of newIds) this.db.prepare('INSERT INTO case_events VALUES(?,?,?,?,?)').run(workspace, caseId, id, reviewer, timestamp(this.now()));
    return { linked: newIds.length, total: current + newIds.length, existing: uniqueIds.length - newIds.length };
  }

  verify(workspace, sessionId) {
    this.session(workspace, sessionId);
    const rows = this.db.prepare('SELECT * FROM events WHERE workspace=? AND session_id=? ORDER BY seq').all(workspace, sessionId);
    let previousHash = null;
    for (const row of rows) {
      const payloadHash = digest(row.payload);
      const entryHash = digest({ id: row.id, payloadHash, previousHash });
      let original;
      try { original = JSON.parse(row.payload); } catch { return { ok: false, count: rows.length, failedEvidenceId: row.id }; }
      const matches = canonical(original) === row.payload && original.workspace === workspace && original.sessionId === sessionId && original.id === row.id &&
        original.text === row.text && original.kind === row.kind && original.account === row.account && original.speakerId === row.speaker_id &&
        original.sourceTimestampMs === row.source_ts && original.receivedAtMs === row.received_at && original.capturedAtMs === row.captured_at &&
        original.source.adapter === row.adapter && original.source.eventId === row.provider_id;
      if (!matches || row.previous_hash !== previousHash || row.payload_hash !== payloadHash || row.entry_hash !== entryHash) return { ok: false, count: rows.length, failedEvidenceId: row.id };
      previousHash = entryHash;
    }
    return { ok: true, count: rows.length, headSha256: previousHash, assurance: 'local hash chain; no external signature or trusted timestamp' };
  }

  report(workspace, caseId) {
    const caseRecord = this.case(workspace, caseId);
    const rows = this.db.prepare('SELECT e.* FROM case_events c JOIN events e ON e.workspace=c.workspace AND e.id=c.event_id WHERE c.workspace=? AND c.case_id=? ORDER BY coalesce(e.source_ts,e.captured_at,e.received_at),e.seq')
      .all(workspace, caseId);
    const sessions = [...new Set(rows.map(row => row.session_id))].map(id => ({ ...this.session(workspace, id), integrity: this.verify(workspace, id) }));
    if (sessions.some(session => !session.integrity.ok)) throw new Fault('evidence_integrity_failed', 409);
    const evidence = rows.map(row => ({ ...this.project(row), assertionHistory: this.assertionHistory(workspace, row.id) }));
    const report = { schemaVersion: 1, workspace, case: caseRecord, generatedAtMs: timestamp(this.now()), sessions, evidence,
      limitations: [
        'This export contains captured evidence and operator assertions, not automated factual findings.',
        'Account handles identify observed accounts, not verified real-world people. Speaker IDs are anonymous tracks.',
        'Temporal proximity does not prove a reply, coordination or intent. Collection gaps remain possible.',
        'A local hash chain detects changes against retained hashes; it is not an external signature or a trusted timestamp.',
        'This original evidence export does not establish speech accuracy, semantic facts or registered agent integration. Media coverage is limited to retained recorder segments when supplied.',
      ] };
    return { ...report, reportSha256: digest(report) };
  }
}

export function reportMarkdown(report) {
  const lines = ['# LiveLens evidence report', '', `Case: ${markdownText(report.case.title)}`, `Question: ${markdownText(report.case.question)}`, `Report SHA-256: ${report.reportSha256}`, '', '## Captured evidence'];
  for (const event of report.evidence) {
    const who = event.attribution.account ? '@' + event.attribution.account + ' [' + event.attribution.status + ']' : 'Unknown speaker/account';
    lines.push('', `- ${markdownText(event.id)} | ${markdownText(event.kind)} | ${markdownText(who)}`, `  Source timestamp: ${event.sourceTimestampMs ?? 'unavailable'}; received: ${event.receivedAtMs}; session: ${markdownText(event.sessionId)}`, '  > ' + markdownText(event.text));
  }
  if (!report.evidence.length) lines.push('', 'No evidence has been linked to this case.');
  lines.push('', '## Collection sources');
  for (const session of report.sessions) lines.push('- ' + markdownText(session.sourceUrl));
  if (report.media) {
    lines.push('', '## Retained media');
    for (const job of report.media) for (const segment of job.segments) lines.push(`- Session ${markdownText(job.sessionId)} | job ${markdownText(job.id)} | segment ${markdownText(segment.id)} | collector-media start ${segment.startedAtMs} | duration ${segment.durationMs}ms | SHA-256 ${segment.sha256} | replay /v1/media/${job.id}/${segment.id}`);
  }
  lines.push('', '## Scope');
  for (const item of report.limitations) lines.push('- ' + item);
  return lines.join('\n') + '\n';
}
