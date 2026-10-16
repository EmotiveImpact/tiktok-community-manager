import { randomUUID } from "node:crypto";
import { REVIEW_EVIDENCE_LIMIT } from "./store.mjs";
import {
  canonical,
  digest,
  Fault,
  handle,
  ident,
  object,
  pageLimit,
  text,
  timestamp,
  markdownText,
} from "./validation.mjs";

const schema = `
CREATE TABLE IF NOT EXISTS investigation_notes(workspace TEXT NOT NULL,id TEXT NOT NULL,case_id TEXT NOT NULL,text TEXT NOT NULL,evidence_ids TEXT NOT NULL,reviewer TEXT NOT NULL,created_at INTEGER NOT NULL,PRIMARY KEY(workspace,id),FOREIGN KEY(workspace,case_id) REFERENCES cases(workspace,id));
CREATE TABLE IF NOT EXISTS investigation_bookmarks(workspace TEXT NOT NULL,id TEXT NOT NULL,event_id TEXT NOT NULL,label TEXT NOT NULL,reviewer TEXT NOT NULL,created_at INTEGER NOT NULL,PRIMARY KEY(workspace,id),FOREIGN KEY(workspace,event_id) REFERENCES events(workspace,id));
CREATE TABLE IF NOT EXISTS investigation_findings(workspace TEXT NOT NULL,case_id TEXT NOT NULL,id TEXT NOT NULL,revision INTEGER NOT NULL,payload TEXT NOT NULL,payload_hash TEXT NOT NULL,previous_hash TEXT,reviewer TEXT NOT NULL,reason TEXT NOT NULL,created_at INTEGER NOT NULL,PRIMARY KEY(workspace,id,revision),FOREIGN KEY(workspace,case_id) REFERENCES cases(workspace,id));
CREATE INDEX IF NOT EXISTS investigation_finding_case ON investigation_findings(workspace,case_id,id,revision);
CREATE TABLE IF NOT EXISTS investigation_person_refs(workspace TEXT NOT NULL,id TEXT NOT NULL,label TEXT NOT NULL,declared_by TEXT NOT NULL,created_at INTEGER NOT NULL,PRIMARY KEY(workspace,id));
CREATE TABLE IF NOT EXISTS investigation_relations(workspace TEXT NOT NULL,id TEXT NOT NULL,payload TEXT NOT NULL,reviewer TEXT NOT NULL,created_at INTEGER NOT NULL,PRIMARY KEY(workspace,id));
CREATE TABLE IF NOT EXISTS investigation_missions(workspace TEXT NOT NULL,id TEXT NOT NULL,payload TEXT NOT NULL,reviewer TEXT NOT NULL,created_at INTEGER NOT NULL,PRIMARY KEY(workspace,id));
CREATE TABLE IF NOT EXISTS investigation_mission_revisions(workspace TEXT NOT NULL,mission_id TEXT NOT NULL,revision INTEGER NOT NULL,payload TEXT NOT NULL,payload_hash TEXT NOT NULL,previous_hash TEXT,reviewer TEXT NOT NULL,reason TEXT NOT NULL,created_at INTEGER NOT NULL,PRIMARY KEY(workspace,mission_id,revision),FOREIGN KEY(workspace,mission_id) REFERENCES investigation_missions(workspace,id));
CREATE TABLE IF NOT EXISTS investigation_alerts(workspace TEXT NOT NULL,id TEXT NOT NULL,mission_id TEXT NOT NULL,evidence_id TEXT NOT NULL,rule_id TEXT NOT NULL,payload TEXT NOT NULL,created_at INTEGER NOT NULL,PRIMARY KEY(workspace,id),UNIQUE(workspace,mission_id,evidence_id,rule_id),FOREIGN KEY(workspace,mission_id) REFERENCES investigation_missions(workspace,id),FOREIGN KEY(workspace,evidence_id) REFERENCES events(workspace,id));
CREATE TABLE IF NOT EXISTS investigation_alert_reviews(workspace TEXT NOT NULL,alert_id TEXT NOT NULL,revision INTEGER NOT NULL,status TEXT NOT NULL,reason TEXT NOT NULL,reviewer TEXT NOT NULL,created_at INTEGER NOT NULL,PRIMARY KEY(workspace,alert_id,revision),FOREIGN KEY(workspace,alert_id) REFERENCES investigation_alerts(workspace,id));
CREATE TABLE IF NOT EXISTS investigation_report_revisions(workspace TEXT NOT NULL,case_id TEXT NOT NULL,revision INTEGER NOT NULL,payload TEXT NOT NULL,payload_hash TEXT NOT NULL,previous_hash TEXT,reviewer TEXT NOT NULL,reason TEXT NOT NULL,created_at INTEGER NOT NULL,PRIMARY KEY(workspace,case_id,revision),FOREIGN KEY(workspace,case_id) REFERENCES cases(workspace,id));
CREATE TABLE IF NOT EXISTS investigation_mission_runs(workspace TEXT NOT NULL,mission_id TEXT NOT NULL,id TEXT NOT NULL,payload TEXT NOT NULL,reviewer TEXT NOT NULL,created_at INTEGER NOT NULL,PRIMARY KEY(workspace,id),FOREIGN KEY(workspace,mission_id) REFERENCES investigation_missions(workspace,id));
`;
const parse = (value) => JSON.parse(value);
const escapeHtml = (value) =>
  String(value ?? "").replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ],
  );
const unique = (values) => [...new Set(values)];
function list(values, { max = 200, required = false } = {}) {
  if (
    !Array.isArray(values) ||
    values.length > max ||
    (required && !values.length)
  )
    throw new Fault("invalid_collection");
  return unique(values);
}
function choice(value, choices, code = "invalid_status") {
  if (!choices.includes(value)) throw new Fault(code);
  return value;
}
function terms(values, required = true) {
  return list(values, { max: 20, required }).map((value) =>
    text(value, 128).trim(),
  );
}

/** Source-linked, deterministic investigation workflows. Captured text is data; no tools or models are dispatched. */
export class InvestigationEngine {
  constructor({ store, now = Date.now }) {
    if (!store?.db || typeof store.transaction !== "function")
      throw new Fault("store_required", 500);
    this.store = store;
    this.db = store.db;
    this.now = now;
    this.db.exec(schema);
  }
  time() {
    return timestamp(this.now());
  }
  ids(workspace, values, required = false) {
    ident(workspace);
    return list(values, { required }).map(
      (id) => this.store.evidence(workspace, ident(id)).id,
    );
  }
  caseEvidence(workspace, caseId) {
    this.store.case(workspace, caseId);
    const rows = this.db
      .prepare(
        "SELECT event_id FROM case_events WHERE workspace=? AND case_id=? ORDER BY linked_at,event_id LIMIT 201",
      )
      .all(workspace, caseId);
    return {
      evidence: rows
        .slice(0, 200)
        .map((row) => this.store.evidence(workspace, row.event_id)),
      truncated: rows.length > 200,
    };
  }
  link(workspace, caseId, ids, reviewer) {
    const count = this.db
      .prepare(
        "SELECT count(*) AS n FROM case_events WHERE workspace=? AND case_id=?",
      )
      .get(workspace, caseId).n;
    const additional = ids.filter(
      (id) =>
        !this.db
          .prepare(
            "SELECT 1 FROM case_events WHERE workspace=? AND case_id=? AND event_id=?",
          )
          .get(workspace, caseId, id),
    );
    if (count + additional.length > REVIEW_EVIDENCE_LIMIT)
      throw new Fault("investigation_evidence_capacity", 409);
    for (const id of ids)
      this.db
        .prepare("INSERT OR IGNORE INTO case_events VALUES(?,?,?,?,?)")
        .run(workspace, caseId, id, reviewer, this.time());
  }
  addNote(workspace, caseId, value, reviewer) {
    this.store.case(workspace, caseId);
    text(reviewer, 100);
    object(value, ["text", "evidenceIds"]);
    const content = text(value.text, 8192),
      evidenceIds = this.ids(workspace, value.evidenceIds ?? []);
    return this.store.transaction(() => {
      this.capacity("investigation_notes", workspace, "case_id", caseId);
      this.link(workspace, caseId, evidenceIds, reviewer);
      const id = randomUUID(),
        createdAtMs = this.time();
      this.db
        .prepare("INSERT INTO investigation_notes VALUES(?,?,?,?,?,?,?)")
        .run(
          workspace,
          id,
          caseId,
          content,
          canonical(evidenceIds),
          reviewer,
          createdAtMs,
        );
      return {
        id,
        caseId,
        text: content,
        evidenceIds,
        reviewer,
        createdAtMs,
        label: "operator-note",
      };
    });
  }
  capacity(table, workspace, column, value) {
    const allowed = [
      "investigation_notes",
      "investigation_bookmarks",
      "investigation_findings",
      "investigation_relations",
      "investigation_missions",
      "investigation_alert_reviews",
      "investigation_report_revisions",
      "investigation_mission_revisions",
      "investigation_mission_runs",
    ];
    if (
      !allowed.includes(table) ||
      !["case_id", "event_id", "id", "alert_id", "mission_id", null].includes(
        column,
      )
    )
      throw new Fault("invalid_capacity_check", 500);
    const count = this.db
      .prepare(
        `SELECT count(*) AS n FROM ${table} WHERE workspace=?${column ? ` AND ${column}=?` : ""}`,
      )
      .get(...(column ? [workspace, value] : [workspace])).n;
    if (count >= 200) throw new Fault("collection_capacity", 409);
  }
  notes(workspace, caseId) {
    this.store.case(workspace, caseId);
    return this.db
      .prepare(
        "SELECT * FROM investigation_notes WHERE workspace=? AND case_id=? ORDER BY created_at,id LIMIT 200",
      )
      .all(workspace, caseId)
      .map((row) => ({
        id: row.id,
        caseId,
        text: row.text,
        evidenceIds: parse(row.evidence_ids),
        reviewer: row.reviewer,
        createdAtMs: row.created_at,
        label: "operator-note",
      }));
  }
  bookmark(workspace, eventId, value, reviewer) {
    const event = this.store.evidence(workspace, eventId);
    text(reviewer, 100);
    object(value, ["label"]);
    const label = text(value.label ?? "Saved evidence", 256);
    return this.store.transaction(() => {
      this.capacity("investigation_bookmarks", workspace, null);
      const id = randomUUID(),
        createdAtMs = this.time();
      this.db
        .prepare("INSERT INTO investigation_bookmarks VALUES(?,?,?,?,?,?)")
        .run(workspace, id, event.id, label, reviewer, createdAtMs);
      return {
        id,
        evidenceId: event.id,
        sessionId: event.sessionId,
        label,
        reviewer,
        createdAtMs,
      };
    });
  }
  bookmarks(workspace, options = {}) {
    // Preserve the original store-facing bookmark shape for graph/report clients.
    return this.bookmarkPage(workspace, options).bookmarks.map(({ evidence: _evidence, ...bookmark }) => bookmark);
  }
  bookmarkPage(workspace, { limit = 100, offset = 0, query = '', includeEvidence = false, ...filters } = {}) {
    limit = pageLimit(limit); text(query, 512, true);
    if (typeof includeEvidence !== 'boolean') throw new Fault('invalid_include_evidence');
    if (!Number.isSafeInteger(offset) || offset < 0) throw new Fault('invalid_cursor');
    const { clauses, args } = this.store.evidenceFilter(workspace, filters);
    if (query) {
      // Include the operator's saved label while retaining exact original filters.
      clauses.push("(lower(e.text) LIKE lower(?) ESCAPE '\\' OR lower(b.label) LIKE lower(?) ESCAPE '\\')");
      const pattern = '%' + query.replace(/[\\%_]/g, '\\$&') + '%';
      args.push(pattern, pattern);
    }
    const rows = this.db.prepare(`SELECT b.*,e.session_id FROM investigation_bookmarks b JOIN events e ON e.workspace=b.workspace AND e.id=b.event_id WHERE ${clauses.join(' AND ')} ORDER BY b.created_at DESC,b.id LIMIT ? OFFSET ?`)
      .all(...args, limit + 1, offset);
    const hasMore = rows.length > limit;
    return { bookmarks: rows.slice(0, limit).map((row) => ({
        id: row.id,
        evidenceId: row.event_id,
        sessionId: row.session_id,
        label: row.label,
        reviewer: row.reviewer,
        createdAtMs: row.created_at,
        ...(includeEvidence ? { evidence: this.store.evidence(workspace, row.event_id) } : {}),
      })), hasMore, nextOffset: hasMore ? offset + limit : null };
  }
  prepareFinding(workspace, caseId, value, options) {
    object(value, [
      "id",
      "title",
      "statement",
      "supportEvidenceIds",
      "counterEvidenceIds",
      "topic",
    ]);
    object(options, ["origin"]);
    const label =
      options.origin === undefined
        ? "operator-finding"
        : choice(
            options.origin,
            ["operator-finding", "model-proposal"],
            "invalid_finding_origin",
          );
    const id = value.id === undefined ? randomUUID() : ident(value.id);
    const supportEvidenceIds = this.ids(
      workspace,
      value.supportEvidenceIds ?? [],
      true,
    );
    const counterEvidenceIds = this.ids(
      workspace,
      value.counterEvidenceIds ?? [],
    );
    if (supportEvidenceIds.some((id) => counterEvidenceIds.includes(id)))
      throw new Fault("evidence_role_conflict");
    return {
      id,
      caseId,
      title: text(value.title, 256),
      statement: text(value.statement, 8192),
      topic: value.topic == null ? null : text(value.topic, 128),
      supportEvidenceIds,
      counterEvidenceIds,
      status: "draft",
      label,
    };
  }
  createFinding(workspace, caseId, value, reviewer, options = {}) {
    return this.createFindingBatch(
      workspace,
      caseId,
      [value],
      reviewer,
      options,
    )[0];
  }
  createFindingBatch(workspace, caseId, values, reviewer, options = {}) {
    this.store.case(workspace, caseId);
    text(reviewer, 100);
    object(options, ["origin"]);
    if (!Array.isArray(values) || values.length > 200)
      throw new Fault("invalid_collection");
    // Prepare every proposal before beginning any write. This shares exactly the
    // single-finding contract, including evidence roles and trusted-only origin.
    const payloads = values.map((value) =>
      this.prepareFinding(workspace, caseId, value, options),
    );
    if (
      unique(payloads.map((payload) => payload.id)).length !== payloads.length
    )
      throw new Fault("duplicate_finding");
    return this.store.transaction(() => {
      const count = this.db
        .prepare(
          "SELECT count(DISTINCT id) AS n FROM investigation_findings WHERE workspace=? AND case_id=?",
        )
        .get(workspace, caseId).n;
      if (count + payloads.length > 200)
        throw new Fault("collection_capacity", 409);
      for (const payload of payloads) {
        if (
          this.db
            .prepare(
              "SELECT 1 FROM investigation_findings WHERE workspace=? AND id=?",
            )
            .get(workspace, payload.id)
        )
          throw new Fault("finding_exists", 409);
      }
      const sourceIds = unique(
        payloads.flatMap((payload) => [
          ...payload.supportEvidenceIds,
          ...payload.counterEvidenceIds,
        ]),
      );
      this.link(workspace, caseId, sourceIds, reviewer);
      for (const payload of payloads)
        this.db
          .prepare(
            "INSERT INTO investigation_findings VALUES(?,?,?,?,?,?,?,?,?,?)",
          )
          .run(
            workspace,
            caseId,
            payload.id,
            1,
            canonical(payload),
            digest(payload),
            null,
            reviewer,
            payload.label === "model-proposal"
              ? "Initial model proposal; human review required"
              : "Initial operator finding",
            this.time(),
          );
      return payloads.map((payload) =>
        this.finding(workspace, caseId, payload.id),
      );
    });
  }
  finding(workspace, caseId, id) {
    this.store.case(workspace, caseId);
    ident(id);
    const rows = this.db
      .prepare(
        "SELECT * FROM investigation_findings WHERE workspace=? AND case_id=? AND id=? ORDER BY revision LIMIT 200",
      )
      .all(workspace, caseId, id);
    if (!rows.length) throw new Fault("finding_not_found", 404);
    this.verifyRevisions(rows);
    return {
      ...parse(rows.at(-1).payload),
      revision: rows.at(-1).revision,
      history: rows.map((row) => ({
        revision: row.revision,
        ...parse(row.payload),
        reviewer: row.reviewer,
        reason: row.reason,
        createdAtMs: row.created_at,
        payloadSha256: row.payload_hash,
        previousSha256: row.previous_hash,
      })),
    };
  }
  verifyRevisions(rows) {
    let previous = null;
    for (const row of rows) {
      if (
        row.payload_hash !== digest(row.payload) ||
        row.previous_hash !== previous
      )
        throw new Fault("revision_integrity_failed", 409);
      previous = row.payload_hash;
    }
  }
  findings(workspace, caseId) {
    this.store.case(workspace, caseId);
    return this.db
      .prepare(
        "SELECT DISTINCT id FROM investigation_findings WHERE workspace=? AND case_id=? ORDER BY id LIMIT 200",
      )
      .all(workspace, caseId)
      .map((row) => this.finding(workspace, caseId, row.id));
  }
  reviewFinding(workspace, caseId, id, value, reviewer) {
    const current = this.finding(workspace, caseId, id);
    text(reviewer, 100);
    object(value, [
      "status",
      "reason",
      "title",
      "statement",
      "supportEvidenceIds",
      "counterEvidenceIds",
      "topic",
      "expectedRevision",
    ]);
    if (
      value.expectedRevision !== undefined &&
      value.expectedRevision !== current.revision
    )
      throw new Fault("revision_conflict", 409);
    const status = choice(value.status, ["draft", "reviewed", "rejected"]),
      reason = text(value.reason, 2048);
    const supportEvidenceIds = this.ids(
        workspace,
        value.supportEvidenceIds ?? current.supportEvidenceIds,
        true,
      ),
      counterEvidenceIds = this.ids(
        workspace,
        value.counterEvidenceIds ?? current.counterEvidenceIds,
      );
    if (supportEvidenceIds.some((id) => counterEvidenceIds.includes(id)))
      throw new Fault("evidence_role_conflict");
    const payload = {
      id,
      caseId,
      title: text(value.title ?? current.title, 256),
      statement: text(value.statement ?? current.statement, 8192),
      topic:
        value.topic === undefined
          ? current.topic
          : value.topic === null
            ? null
            : text(value.topic, 128),
      supportEvidenceIds,
      counterEvidenceIds,
      status,
      label: current.label,
    };
    return this.store.transaction(() => {
      this.capacity("investigation_findings", workspace, "id", id);
      this.link(
        workspace,
        caseId,
        unique([...supportEvidenceIds, ...counterEvidenceIds]),
        reviewer,
      );
      this.db
        .prepare(
          "INSERT INTO investigation_findings VALUES(?,?,?,?,?,?,?,?,?,?)",
        )
        .run(
          workspace,
          caseId,
          id,
          current.revision + 1,
          canonical(payload),
          digest(payload),
          current.history.at(-1).payloadSha256,
          reviewer,
          reason,
          this.time(),
        );
      return this.finding(workspace, caseId, id);
    });
  }
  caseDetail(workspace, caseId) {
    const caseRecord = this.store.case(workspace, caseId),
      evidence = this.caseEvidence(workspace, caseId);
    return {
      case: caseRecord,
      ...evidence,
      totalEvidence: this.db.prepare('SELECT count(*) AS n FROM case_events WHERE workspace=? AND case_id=?').get(workspace, caseId).n,
      reviewEvidenceLimit: REVIEW_EVIDENCE_LIMIT,
      notes: this.notes(workspace, caseId),
      findings: this.findings(workspace, caseId),
      bookmarks: this.bookmarks(workspace).filter((mark) =>
        evidence.evidence.some((event) => event.id === mark.evidenceId),
      ),
    };
  }
  casesDetail(workspace, caseId) {
    return this.caseDetail(workspace, caseId);
  }
  accountActivity(workspace, account, { limit = 100 } = {}) {
    account = handle(account);
    if (!account) throw new Fault("account_required");
    const evidence = this.store.search(workspace, {
        account,
        limit: pageLimit(limit),
      }),
      sessions = unique(evidence.map((event) => event.sessionId)).map((id) =>
        this.store.session(workspace, id),
      );
    return {
      account,
      evidence,
      sessions,
      limitation:
        "Observed platform accounts and reviewed assertions are not verified real-world identities.",
      bounded: true,
    };
  }
  compare(workspace, value) {
    object(value, ["sessionIds", "terms", "account"]);
    ident(workspace);
    const sessionIds = list(value.sessionIds, { max: 20, required: true }).map(
        (id) => this.store.session(workspace, ident(id)).id,
      ),
      needles = terms(value.terms),
      account = handle(value.account);
    const sessions = sessionIds.map((sessionId) => {
      const all = this.store.events(workspace, sessionId, { limit: 200 }),
        events = all.filter(
          (event) => !account || event.attribution.account === account,
        );
      return {
        session: this.store.session(workspace, sessionId),
        sampledEvidenceCount: all.length,
        bounded: all.length === 200,
        topics: needles.map((term) => {
          const matches = events.filter(
            (event) =>
              event.kind !== "gap" &&
              event.text
                .toLocaleLowerCase("en")
                .includes(term.toLocaleLowerCase("en")),
          );
          return {
            term,
            count: matches.length,
            evidenceIds: matches.map((event) => event.id),
            quotations: matches.map((event) => ({
              evidenceId: event.id,
              text: event.text,
              sourceTimestampMs: event.sourceTimestampMs,
              capturedAtMs: event.capturedAtMs,
            })),
          };
        }),
        gaps: all
          .filter((event) => event.kind === "gap")
          .map((event) => ({ evidenceId: event.id, text: event.text })),
      };
    });
    return {
      method: "literal-substring-comparison",
      account,
      terms: needles,
      sessions,
      interpretation:
        "Literal matches in bounded captured evidence. Differences in counts do not establish meaning, truth, intent or a complete conversation.",
    };
  }
  speakerNode(workspace, event) {
    if (!["transcript", "caption"].includes(event.kind) || !event.speakerId)
      return null;
    const raw = event.raw ?? {};
    const recorded = (value) =>
      typeof value === "string" && value.length <= 256 ? value : null;
    const speechJobId = recorded(raw.speechJobId),
      recordingJobId = recorded(raw.recordingJobId),
      mediaSegmentId = recorded(raw.mediaSegmentId);
    const engine =
      raw.engine && typeof raw.engine === "object" && !Array.isArray(raw.engine)
        ? {
            id: recorded(raw.engine.id),
            version: recorded(raw.engine.version),
            language: recorded(raw.engine.language),
          }
        : null;
    const trackScope =
      speechJobId && raw.speakerTrackScope === "media-segment" && mediaSegmentId
        ? "media-segment"
        : speechJobId && raw.speakerTrackScope === "recording-job-unseparated"
          ? "recording-job-unseparated"
          : "source-event";
    const scope = {
      workspace,
      sessionId: event.sessionId,
      adapter: event.source.adapter,
      speechJobId,
      recordingJobId,
      engine,
      mediaSegmentId: trackScope === "media-segment" ? mediaSegmentId : null,
      sourceEventId: trackScope === "source-event" ? event.id : null,
      speakerId: event.speakerId,
    };
    const sourceId = "sp_" + digest(scope);
    return {
      kind: "speaker",
      sourceId,
      label:
        raw.speakerTrack === "unseparated-audio-track"
          ? "Unseparated audio track"
          : "Anonymous speaker " + event.speakerId,
      identityStatus: "anonymous",
      provenance: {
        sessionId: event.sessionId,
        adapter: event.source.adapter,
        speakerId: event.speakerId,
        speechJobId,
        recordingJobId,
        mediaSegmentId,
        engine,
        trackScope,
      },
      evidenceIds: [event.id],
    };
  }
  node(workspace, value, evidenceIds = []) {
    object(value, ["kind", "id", "label"]);
    const kind = choice(
      value.kind,
      ["account", "session", "evidence", "topic", "speaker", "person"],
      "invalid_node_kind",
    );
    if (kind === "person") {
      const id = ident(value.id),
        existing = this.db
          .prepare(
            "SELECT * FROM investigation_person_refs WHERE workspace=? AND id=?",
          )
          .get(workspace, id);
      const label =
        value.label === undefined && existing
          ? existing.label
          : text(value.label, 128);
      if (existing && existing.label !== label)
        throw new Fault("person_reference_conflict", 409);
      return {
        kind,
        id,
        label,
        declarationStatus: "operator-declared",
        identityStatus: "unverified",
      };
    }
    if (value.label !== undefined) throw new Fault("node_label_not_supported");
    if (kind === "speaker") {
      const id = ident(value.id);
      const source = evidenceIds
        .map((eventId) =>
          this.speakerNode(workspace, this.store.evidence(workspace, eventId)),
        )
        .find((node) => node?.sourceId === id);
      if (!source) throw new Fault("speaker_reference_requires_source", 404);
      const { sourceId, ...metadata } = source;
      return { ...metadata, id: sourceId };
    }
    let id;
    if (kind === "account") {
      id = handle(value.id);
      if (!id) throw new Fault("account_required");
    } else if (kind === "session")
      id = this.store.session(workspace, ident(value.id)).id;
    else if (kind === "evidence")
      id = this.store.evidence(workspace, ident(value.id)).id;
    else id = text(value.id, 128);
    return { kind, id };
  }
  createRelation(workspace, value, reviewer) {
    ident(workspace);
    object(value, ["from", "to", "label", "status", "evidenceIds", "reason"]);
    text(reviewer, 100);
    const evidenceIds = this.ids(workspace, value.evidenceIds, true);
    const payload = {
      from: this.node(workspace, value.from, evidenceIds),
      to: this.node(workspace, value.to, evidenceIds),
      label: text(value.label, 256),
      status: choice(value.status, ["operator-reviewed", "inferred"]),
      evidenceIds,
      reason: text(value.reason, 2048),
    };
    if (
      payload.from.kind === "person" &&
      payload.to.kind === "person" &&
      payload.from.id === payload.to.id &&
      payload.from.label !== payload.to.label
    )
      throw new Fault("person_reference_conflict", 409);
    return this.store.transaction(() => {
      this.capacity("investigation_relations", workspace, null);
      const id = randomUUID(),
        createdAtMs = this.time();
      for (const node of [payload.from, payload.to])
        if (node.kind === "person")
          this.db
            .prepare(
              "INSERT OR IGNORE INTO investigation_person_refs VALUES(?,?,?,?,?)",
            )
            .run(workspace, node.id, node.label, reviewer, createdAtMs);
      this.db
        .prepare("INSERT INTO investigation_relations VALUES(?,?,?,?,?)")
        .run(workspace, id, canonical(payload), reviewer, createdAtMs);
      return { id, ...payload, reviewer, createdAtMs };
    });
  }
  graph(workspace, { sessionIds = [], limit = 100 } = {}) {
    ident(workspace);
    limit = pageLimit(limit);
    sessionIds = list(sessionIds, { max: 20 }).map(
      (id) => this.store.session(workspace, ident(id)).id,
    );
    const rows = this.db
      .prepare(
        `SELECT * FROM events WHERE workspace=?${sessionIds.length ? ` AND session_id IN (${sessionIds.map(() => "?").join(",")})` : ""} ORDER BY seq DESC LIMIT ?`,
      )
      .all(workspace, ...sessionIds, limit);
    const nodes = new Map(),
      edges = [];
    const add = (kind, id, label = id, metadata = {}) => {
      const key = kind + ":" + id,
        existing = nodes.get(key);
      nodes.set(key, {
        ...existing,
        ...metadata,
        id: key,
        kind,
        sourceId: id,
        label,
        evidenceIds: unique([
          ...(existing?.evidenceIds ?? []),
          ...(metadata.evidenceIds ?? []),
        ]),
      });
      return key;
    };
    for (const row of rows) {
      const event = this.store.project(row),
        eventNode = add("evidence", event.id, event.text.slice(0, 100)),
        sessionNode = add(
          "session",
          event.sessionId,
          this.store.session(workspace, event.sessionId).title,
        );
      edges.push({
        id: "session-" + event.id,
        from: sessionNode,
        to: eventNode,
        label: "captured in",
        status: "observed",
        evidenceIds: [event.id],
      });
      const speaker = this.speakerNode(workspace, event);
      if (speaker)
        edges.push({
          id: "speaker-" + event.id,
          from: add(speaker.kind, speaker.sourceId, speaker.label, speaker),
          to: eventNode,
          label:
            speaker.label === "Unseparated audio track"
              ? "unseparated audio track supplied"
              : "anonymous speaker track supplied",
          status: "observed",
          evidenceIds: [event.id],
          identityStatus: "anonymous",
        });
      if (event.account)
        edges.push({
          id: "account-" + event.id,
          from: add("account", event.account, "@" + event.account),
          to: eventNode,
          label: "platform account supplied",
          status: "observed",
          evidenceIds: [event.id],
        });
      else if (event.attribution.account)
        edges.push({
          id: "assertion-" + event.id,
          from: add(
            "account",
            event.attribution.account,
            "@" + event.attribution.account,
          ),
          to: eventNode,
          label: "operator attribution",
          status: "operator-reviewed",
          evidenceIds: [event.id],
          reviewer: event.attribution.reviewer,
          reason: event.attribution.reason,
        });
    }
    const relations = this.db
      .prepare(
        "SELECT * FROM investigation_relations WHERE workspace=? ORDER BY created_at DESC,id LIMIT ?",
      )
      .all(workspace, limit);
    for (const row of relations) {
      const relation = parse(row.payload),
        evidence = relation.evidenceIds.map((id) =>
          this.store.evidence(workspace, id),
        );
      if (
        sessionIds.length &&
        !evidence.some((event) => sessionIds.includes(event.sessionId))
      )
        continue;
      const declared = (node) => {
        if (node.kind === "person") {
          const person = this.db
            .prepare(
              "SELECT * FROM investigation_person_refs WHERE workspace=? AND id=?",
            )
            .get(workspace, node.id);
          if (!person) throw new Fault("person_reference_not_found", 404);
          return add(node.kind, node.id, "Person reference: " + person.label, {
            declarationStatus: "operator-declared",
            identityStatus: "unverified",
            declaredBy: person.declared_by,
            createdAtMs: person.created_at,
            evidenceIds: relation.evidenceIds,
          });
        }
        if (node.kind === "speaker") {
          const source = evidence
            .map((event) => this.speakerNode(workspace, event))
            .find((speaker) => speaker?.sourceId === node.id);
          if (!source)
            throw new Fault("speaker_reference_requires_source", 404);
          return add(source.kind, source.sourceId, source.label, source);
        }
        return add(node.kind, node.id);
      };
      edges.push({
        id: row.id,
        ...relation,
        from: declared(relation.from),
        to: declared(relation.to),
        reviewer: row.reviewer,
        createdAtMs: row.created_at,
      });
    }
    const selectedNodes = new Map(),
      selectedEdges = [];
    for (const edge of edges) {
      const newNodes = unique([edge.from, edge.to]).filter(
        (id) => !selectedNodes.has(id),
      );
      if (
        selectedNodes.size + newNodes.length > 200 ||
        selectedEdges.length >= 200
      )
        continue;
      for (const id of newNodes) selectedNodes.set(id, nodes.get(id));
      selectedEdges.push(edge);
    }
    return {
      nodes: [...selectedNodes.values()],
      edges: selectedEdges,
      bounded: true,
      limitation:
        "Observed links describe retained captures. Speaker tracks stay anonymous and scoped to their source jobs, segments and engines; unscoped tracks stay separate per event. Person references are operator declarations with unverified identity. Reviewed and inferred links are separate assertions; no real-world identity or coordination is established.",
    };
  }
  createMission(workspace, value, reviewer) {
    ident(workspace);
    text(reviewer, 100);
    object(value, [
      "id",
      "title",
      "protectedAccount",
      "sessionIds",
      "sourceIds",
      "rules",
      "delivery",
    ]);
    const protectedAccount = handle(value.protectedAccount);
    if (!protectedAccount) throw new Fault("protected_account_required");
    const id = value.id === undefined ? randomUUID() : ident(value.id),
      sessionIds = list(value.sessionIds, { max: 20, required: true }).map(
        (id) => this.store.session(workspace, ident(id)).id,
      ),
      sourceIds = list(value.sourceIds ?? [], { max: 20 }).map(ident);
    const rules = list(value.rules, { max: 20, required: true }).map(
      (rule, index) => {
        object(rule, ["id", "label", "terms", "match", "contextTerms"]);
        return {
          id: rule.id === undefined ? "rule_" + index : ident(rule.id),
          label: text(rule.label, 256),
          terms: terms(rule.terms),
          match: choice(rule.match ?? "any", ["any", "all"], "invalid_match"),
          contextTerms: terms(rule.contextTerms ?? [], false),
        };
      },
    );
    if (unique(rules.map((rule) => rule.id)).length !== rules.length)
      throw new Fault("duplicate_rule");
    object(value.delivery ?? { inApp: true }, ["inApp"]);
    if ((value.delivery ?? { inApp: true }).inApp !== true)
      throw new Fault("in_app_delivery_required");
    const payload = {
      id,
      title: text(value.title, 256),
      protectedAccount,
      sessionIds,
      sourceIds,
      rules,
      delivery: { inApp: true },
      detection: "bounded-literal-context-review",
      state: "manual-review",
    };
    return this.store.transaction(() => {
      this.capacity("investigation_missions", workspace, null);
      if (
        this.db
          .prepare(
            "SELECT 1 FROM investigation_missions WHERE workspace=? AND id=?",
          )
          .get(workspace, id)
      )
        throw new Fault("mission_exists", 409);
      const createdAtMs = this.time();
      this.db
        .prepare("INSERT INTO investigation_missions VALUES(?,?,?,?,?)")
        .run(workspace, id, canonical(payload), reviewer, createdAtMs);
      this.db
        .prepare(
          "INSERT INTO investigation_mission_revisions VALUES(?,?,?,?,?,?,?,?,?)",
        )
        .run(
          workspace,
          id,
          1,
          canonical(payload),
          digest(payload),
          null,
          reviewer,
          "Initial mission configuration",
          createdAtMs,
        );
      return this.mission(workspace, id);
    });
  }
  mission(workspace, id) {
    ident(workspace);
    ident(id);
    const row = this.db
      .prepare(
        "SELECT * FROM investigation_missions WHERE workspace=? AND id=?",
      )
      .get(workspace, id);
    if (!row) throw new Fault("mission_not_found", 404);
    const revisions = this.db
      .prepare(
        "SELECT * FROM investigation_mission_revisions WHERE workspace=? AND mission_id=? ORDER BY revision LIMIT 200",
      )
      .all(workspace, id);
    this.verifyRevisions(revisions);
    const history = revisions.map((item) => ({
      revision: item.revision,
      ...parse(item.payload),
      reviewer: item.reviewer,
      reason: item.reason,
      createdAtMs: item.created_at,
      payloadSha256: item.payload_hash,
      previousSha256: item.previous_hash,
    }));
    return {
      ...parse(row.payload),
      reviewer: row.reviewer,
      createdAtMs: row.created_at,
      ...(history.at(-1) ?? {}),
      revision: history.at(-1)?.revision ?? 1,
      history,
    };
  }
  updateMission(workspace, id, value, reviewer) {
    const current = this.mission(workspace, id);
    text(reviewer, 100);
    object(value, [
      "title",
      "protectedAccount",
      "sessionIds",
      "sourceIds",
      "rules",
      "delivery",
      "reason",
      "expectedRevision",
    ]);
    if (
      value.expectedRevision !== undefined &&
      value.expectedRevision !== current.revision
    )
      throw new Fault("revision_conflict", 409);
    const protectedAccount = handle(
      value.protectedAccount ?? current.protectedAccount,
    );
    if (!protectedAccount) throw new Fault("protected_account_required");
    const sessionIds = list(value.sessionIds ?? current.sessionIds, {
      max: 20,
      required: true,
    }).map((id) => this.store.session(workspace, ident(id)).id);
    const sourceIds = list(value.sourceIds ?? current.sourceIds, {
      max: 20,
    }).map(ident);
    const rules = list(value.rules ?? current.rules, {
      max: 20,
      required: true,
    }).map((rule, index) => {
      object(rule, ["id", "label", "terms", "match", "contextTerms"]);
      return {
        id: rule.id === undefined ? "rule_" + index : ident(rule.id),
        label: text(rule.label, 256),
        terms: terms(rule.terms),
        match: choice(rule.match ?? "any", ["any", "all"], "invalid_match"),
        contextTerms: terms(rule.contextTerms ?? [], false),
      };
    });
    if (unique(rules.map((rule) => rule.id)).length !== rules.length)
      throw new Fault("duplicate_rule");
    object(value.delivery ?? current.delivery, ["inApp"]);
    if ((value.delivery ?? current.delivery).inApp !== true)
      throw new Fault("in_app_delivery_required");
    const payload = {
      id,
      title: text(value.title ?? current.title, 256),
      protectedAccount,
      sessionIds,
      sourceIds,
      rules,
      delivery: { inApp: true },
      detection: "bounded-literal-context-review",
      state: "manual-review",
    };
    return this.store.transaction(() => {
      this.capacity(
        "investigation_mission_revisions",
        workspace,
        "mission_id",
        id,
      );
      this.db
        .prepare(
          "INSERT INTO investigation_mission_revisions VALUES(?,?,?,?,?,?,?,?,?)",
        )
        .run(
          workspace,
          id,
          current.revision + 1,
          canonical(payload),
          digest(payload),
          current.history.at(-1)?.payloadSha256 ?? null,
          reviewer,
          text(value.reason, 2048),
          this.time(),
        );
      return this.mission(workspace, id);
    });
  }
  missions(workspace, limit = 100) {
    ident(workspace);
    limit = pageLimit(limit);
    return this.db
      .prepare(
        "SELECT id FROM investigation_missions WHERE workspace=? ORDER BY created_at DESC,id LIMIT ?",
      )
      .all(workspace, limit)
      .map((row) => this.mission(workspace, row.id));
  }
  runMission(workspace, id, reviewer) {
    const mission = this.mission(workspace, id);
    text(reviewer, 100);
    const alerts = [],
      scanned = [],
      protectedMention = mission.protectedAccount.toLowerCase();
    let truncated = false;
    // One run has a total 200-event budget across the selected sessions, not 200 per session.
    const rows = this.db
      .prepare(
        `SELECT * FROM events WHERE workspace=? AND session_id IN (${mission.sessionIds.map(() => "?").join(",")}) ORDER BY seq DESC LIMIT 201`,
      )
      .all(workspace, ...mission.sessionIds);
    truncated = rows.length > 200;
    for (const row of rows.slice(0, 200)) {
      const event = this.store.project(row);
      scanned.push(event.id);
      if (event.kind === "gap") continue;
      const context = this.store.context(workspace, event.id, 5),
        neighbours = [...context.before, event, ...context.after],
        content = event.text.toLowerCase(),
        contextText = neighbours
          .map((item) => item.text)
          .join("\n")
          .toLowerCase();
      if (!contextText.includes(protectedMention)) continue;
      for (const rule of mission.rules) {
        const matches = rule.terms.map((term) =>
          content.includes(term.toLowerCase()),
        );
        if (
          !(rule.match === "all"
            ? matches.every(Boolean)
            : matches.some(Boolean))
        )
          continue;
        if (
          rule.contextTerms.length &&
          !rule.contextTerms.some((term) =>
            contextText.includes(term.toLowerCase()),
          )
        )
          continue;
        const alertId =
          "alert_" +
          digest([workspace, id, mission.revision, rule.id, event.id]);
        const gaps = neighbours
          .filter((item) => item.kind === "gap")
          .map((item) => item.id);
        alerts.push({
          id: alertId,
          missionId: id,
          missionRevision: mission.revision,
          ruleId: rule.id,
          ruleLabel: rule.label,
          evidenceId: event.id,
          evidenceIds: [event.id],
          contextEvidenceIds: neighbours.map((item) => item.id),
          gapEvidenceIds: gaps,
          sessionId: event.sessionId,
          protectedAccount: mission.protectedAccount,
          status: "pending",
          matchedTerms: rule.terms.filter((_, i) => matches[i]),
          uncertainty: [
            "Literal rule match requires human review; it is not an allegation or an assessment of intent.",
            ...(gaps.length
              ? ["Capture gaps exist in neighbouring evidence."]
              : ["No nearby gap record does not prove complete capture."]),
            ...(event.sourceTimestampMs == null
              ? ["Provider timestamp is unavailable."]
              : []),
          ],
          delivery: { channel: "in-app", state: "available" },
          createdAtMs: this.time(),
        });
      }
    }
    return this.store.transaction(() => {
      const available = this.db
        .prepare(
          "SELECT count(*) AS n FROM investigation_alerts WHERE workspace=?",
        )
        .get(workspace).n;
      const newAlerts = alerts.filter(
        (alert) =>
          !this.db
            .prepare(
              "SELECT 1 FROM investigation_alerts WHERE workspace=? AND id=?",
            )
            .get(workspace, alert.id),
      );
      if (available + newAlerts.length > 200)
        throw new Fault("alert_capacity", 409);
      for (const alert of newAlerts)
        this.db
          .prepare("INSERT INTO investigation_alerts VALUES(?,?,?,?,?,?,?)")
          .run(
            workspace,
            alert.id,
            id,
            alert.evidenceId,
            mission.revision + "_" + alert.ruleId,
            canonical(alert),
            alert.createdAtMs,
          );
      this.capacity("investigation_mission_runs", workspace, "mission_id", id);
      const run = {
        id: randomUUID(),
        missionId: id,
        missionRevision: mission.revision,
        scannedEvidenceIds: scanned,
        scannedCount: scanned.length,
        created: newAlerts.length,
        matched: alerts.length,
        truncated,
        delivery: "in-app only",
        startedBy: reviewer,
        createdAtMs: this.time(),
      };
      this.db
        .prepare("INSERT INTO investigation_mission_runs VALUES(?,?,?,?,?,?)")
        .run(workspace, id, run.id, canonical(run), reviewer, run.createdAtMs);
      return {
        ...run,
        alerts: alerts.map((alert) => this.alert(workspace, alert.id)),
      };
    });
  }
  alert(workspace, id) {
    ident(workspace);
    ident(id);
    const row = this.db
      .prepare("SELECT * FROM investigation_alerts WHERE workspace=? AND id=?")
      .get(workspace, id);
    if (!row) throw new Fault("alert_not_found", 404);
    const history = this.db
      .prepare(
        "SELECT * FROM investigation_alert_reviews WHERE workspace=? AND alert_id=? ORDER BY revision LIMIT 200",
      )
      .all(workspace, id)
      .map((row) => ({
        revision: row.revision,
        status: row.status,
        reason: row.reason,
        reviewer: row.reviewer,
        createdAtMs: row.created_at,
      }));
    return {
      ...parse(row.payload),
      status: history.at(-1)?.status ?? "pending",
      history,
    };
  }
  alerts(workspace, { missionId = null, limit = 100 } = {}) {
    ident(workspace);
    limit = pageLimit(limit);
    if (missionId !== null) this.mission(workspace, missionId);
    return this.db
      .prepare(
        `SELECT id FROM investigation_alerts WHERE workspace=?${missionId ? " AND mission_id=?" : ""} ORDER BY created_at DESC,id LIMIT ?`,
      )
      .all(...(missionId ? [workspace, missionId, limit] : [workspace, limit]))
      .map((row) => this.alert(workspace, row.id));
  }
  reviewAlert(workspace, id, value, reviewer) {
    const alert = this.alert(workspace, id);
    object(value, ["status", "reason"]);
    text(reviewer, 100);
    const status = choice(value.status, [
        "acknowledged",
        "reviewed",
        "dismissed",
      ]),
      reason = text(value.reason, 2048);
    return this.store.transaction(() => {
      this.capacity("investigation_alert_reviews", workspace, "alert_id", id);
      this.db
        .prepare(
          "INSERT INTO investigation_alert_reviews VALUES(?,?,?,?,?,?,?)",
        )
        .run(
          workspace,
          id,
          alert.history.length + 1,
          status,
          reason,
          reviewer,
          this.time(),
        );
      return this.alert(workspace, id);
    });
  }
  readReport(workspace, caseId) {
    const caseRecord = this.store.case(workspace, caseId);
    const rows = this.db
      .prepare(
        "SELECT * FROM investigation_report_revisions WHERE workspace=? AND case_id=? ORDER BY revision LIMIT 200",
      )
      .all(workspace, caseId);
    this.verifyRevisions(rows);
    const history = rows.map((row) => ({
      revision: row.revision,
      ...parse(row.payload),
      reviewer: row.reviewer,
      reason: row.reason,
      createdAtMs: row.created_at,
      payloadSha256: row.payload_hash,
      previousSha256: row.previous_hash,
    }));
    return {
      caseId,
      title: caseRecord.title,
      summary: "",
      redactions: [],
      ...(history.at(-1) ?? {}),
      revision: history.at(-1)?.revision ?? 0,
      history,
    };
  }
  updateReport(workspace, caseId, value, reviewer) {
    const current = this.readReport(workspace, caseId);
    object(value, [
      "title",
      "summary",
      "redactions",
      "reason",
      "expectedRevision",
    ]);
    text(reviewer, 100);
    if (
      value.expectedRevision !== undefined &&
      value.expectedRevision !== current.revision
    )
      throw new Fault("revision_conflict", 409);
    const redactions = list(value.redactions ?? current.redactions).map(
      (item) => {
        object(item, ["evidenceId", "text", "account", "reason"]);
        this.store.evidence(workspace, item.evidenceId);
        if (
          !this.db
            .prepare(
              "SELECT 1 FROM case_events WHERE workspace=? AND case_id=? AND event_id=?",
            )
            .get(workspace, caseId, item.evidenceId)
        )
          throw new Fault("redaction_evidence_not_linked");
        if (item.text !== true && item.account !== true)
          throw new Fault("redaction_field_required");
        return {
          evidenceId: item.evidenceId,
          text: item.text === true,
          account: item.account === true,
          reason: text(item.reason ?? "Operator requested redaction", 2048),
        };
      },
    );
    if (
      unique(redactions.map((item) => item.evidenceId)).length !==
      redactions.length
    )
      throw new Fault("duplicate_redaction");
    const payload = {
      title: text(value.title ?? current.title, 256),
      summary: text(value.summary ?? current.summary, 8192, true),
      redactions,
    };
    return this.store.transaction(() => {
      this.capacity(
        "investigation_report_revisions",
        workspace,
        "case_id",
        caseId,
      );
      this.db
        .prepare(
          "INSERT INTO investigation_report_revisions VALUES(?,?,?,?,?,?,?,?,?)",
        )
        .run(
          workspace,
          caseId,
          current.revision + 1,
          canonical(payload),
          digest(payload),
          current.history.at(-1)?.payloadSha256 ?? null,
          reviewer,
          text(value.reason, 2048),
          this.time(),
        );
      return this.readReport(workspace, caseId);
    });
  }
  report(workspace, caseId, { media = null } = {}) {
    if (this.caseEvidence(workspace, caseId).truncated)
      throw new Fault("investigation_report_capacity", 409);
    const original = this.store.report(workspace, caseId),
      editor = this.readReport(workspace, caseId),
      findings = this.findings(workspace, caseId),
      notes = this.notes(workspace, caseId);
    const redactions = new Map(
      editor.redactions.map((item) => [item.evidenceId, item]),
    );
    const hiddenTextIds = new Set(
      editor.redactions
        .filter((item) => item.text)
        .map((item) => item.evidenceId),
    );
    const hiddenAccounts = new Set(),
      hiddenQuotes = [];
    for (const event of original.evidence) {
      const redaction = redactions.get(event.id);
      if (redaction?.text && event.text) hiddenQuotes.push(event.text);
      if (redaction?.account)
        for (const account of [
          event.account,
          event.attribution.account,
          ...event.assertionHistory.map((item) => item.account),
        ])
          if (account) hiddenAccounts.add(account);
    }
    const escapeRegex = (value) => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const accountPatterns = [...hiddenAccounts].map(
      (account) =>
        new RegExp(
          "(?<![a-z0-9._-])@?" + escapeRegex(account) + "(?![a-z0-9._-])",
          "gi",
        ),
    );
    const quotePatterns = unique(hiddenQuotes).map(
      (quote) => new RegExp(escapeRegex(quote), "gi"),
    );
    const scrub = (value) => {
      if (typeof value !== "string") return value;
      let result = value;
      for (const pattern of quotePatterns)
        result = result.replace(pattern, "[Quotation redacted]");
      for (const pattern of accountPatterns)
        result = result.replace(pattern, "[Account redacted]");
      return result;
    };
    const hiddenAccount = (account) =>
      account && hiddenAccounts.has(account.toLowerCase());
    const evidence = original.evidence.map((event) => {
      const copy = structuredClone(event),
        redaction = redactions.get(event.id);
      // Raw provider metadata may duplicate a selected quotation or identity.
      // A shared redacted copy excludes it; original journal payloads remain.
      if (redactions.size) {
        copy.raw = {};
        copy.contentRedacted = true;
      }
      copy.text = redaction?.text
        ? "[Text redacted in this report copy]"
        : scrub(copy.text);
      if (redaction)
        copy.redaction = {
          ...redaction,
          reason: scrub(redaction.reason),
          originalPayloadSha256: event.integrity.payloadSha256,
        };
      if (
        redaction?.account ||
        hiddenAccount(copy.account) ||
        hiddenAccount(copy.attribution.account)
      ) {
        copy.account = null;
        copy.attribution = { status: "redacted", account: null };
        copy.assertionHistory = [];
      } else {
        if (copy.attribution.reason)
          copy.attribution.reason = scrub(copy.attribution.reason);
        copy.assertionHistory = copy.assertionHistory.map((item) => ({
          ...item,
          account: hiddenAccount(item.account) ? null : item.account,
          reason: scrub(item.reason),
          reviewer: scrub(item.reviewer),
        }));
      }
      return copy;
    });
    const sharedFindings = findings.map((finding) => {
      const dependent = [
        ...finding.supportEvidenceIds,
        ...finding.counterEvidenceIds,
        ...finding.history.flatMap((item) => [
          ...item.supportEvidenceIds,
          ...item.counterEvidenceIds,
        ]),
      ].some((id) => hiddenTextIds.has(id));
      const redact = (item) => ({
        ...item,
        title: dependent
          ? "[Finding redacted in this report copy]"
          : scrub(item.title),
        statement: dependent
          ? "[Interpretation redacted with its source quotation]"
          : scrub(item.statement),
        topic: dependent ? null : scrub(item.topic),
        ...(item.reason !== undefined
          ? {
              reason: dependent
                ? "[Review reason redacted with dependent finding]"
                : scrub(item.reason),
            }
          : {}),
        ...(item.reviewer !== undefined
          ? { reviewer: scrub(item.reviewer) }
          : {}),
        ...(dependent ? { contentRedacted: true } : {}),
      });
      return { ...redact(finding), history: finding.history.map(redact) };
    });
    const sharedNotes = notes.map((note) => ({
      ...note,
      text: note.evidenceIds.some((id) => hiddenTextIds.has(id))
        ? "[Note redacted with its source quotation]"
        : scrub(note.text),
      reviewer: scrub(note.reviewer),
    }));
    // Editor free text has no evidence references. Conservatively hide it when
    // any quotation is selected rather than retaining a stale paraphrase.
    const redactEditor = (item) => ({
      ...item,
      title: hiddenTextIds.size
        ? "Redacted evidence report"
        : scrub(item.title),
      summary: hiddenTextIds.size
        ? "[Summary redacted with selected source quotations]"
        : scrub(item.summary),
      reason: hiddenTextIds.size
        ? "[Editorial reason redacted in this report copy]"
        : scrub(item.reason),
      reviewer: scrub(item.reviewer),
      redactions: item.redactions.map((redaction) => ({
        ...redaction,
        reason: scrub(redaction.reason),
      })),
      ...(redactions.size ? { contentRedacted: true } : {}),
    });
    const sharedEditor = redactEditor(editor);
    sharedEditor.history = editor.history.map(redactEditor);
    const sharedCase = {
      ...original.case,
      title: hiddenTextIds.size
        ? "Redacted investigation"
        : scrub(original.case.title),
      question: hiddenTextIds.size
        ? "[Investigation question redacted with selected source quotations]"
        : scrub(original.case.question),
      createdBy: scrub(original.case.createdBy),
    };
    const sessions = original.sessions.map((session) => {
      const sourceUrl = scrub(session.sourceUrl);
      return {
        ...session,
        account: hiddenAccount(session.account) ? null : session.account,
        title: scrub(session.title),
        sourceUrl: sourceUrl === session.sourceUrl ? session.sourceUrl : null,
        ...(sourceUrl !== session.sourceUrl
          ? {
              sourceReferenceSha256: digest(session.sourceUrl),
              provenanceRedacted: true,
            }
          : {}),
      };
    });
    // Retain media hashes and clocks, without carrying replay URLs or local
    // filesystem references into a redacted share copy.
    const mediaCopy =
      redactions.size && Array.isArray(media)
        ? media.map((job) => {
            const pick = (value, keys) =>
              Object.fromEntries(
                keys
                  .filter((key) => value[key] !== undefined)
                  .map((key) => [key, value[key]]),
              );
            return {
              ...pick(job, [
                "id",
                "sessionId",
                "state",
                "createdAtMs",
                "deadlineMs",
                "maxDurationSeconds",
              ]),
              segments: (job.segments ?? []).map((segment) =>
                pick(segment, [
                  "id",
                  "attempt",
                  "startedAtMs",
                  "durationMs",
                  "bytes",
                  "sha256",
                  "timestampBasis",
                ]),
              ),
              contentRedacted: true,
            };
          })
        : media;
    const bundle = {
      schemaVersion: 2,
      workspace,
      case: sharedCase,
      title: sharedEditor.title,
      summary: sharedEditor.summary,
      generatedAtMs: this.time(),
      editor: {
        revision: sharedEditor.revision,
        history: sharedEditor.history,
      },
      findings: sharedFindings,
      notes: sharedNotes,
      evidence,
      sessions,
      media: mediaCopy,
      manifest: {
        originalReportSha256: original.reportSha256,
        evidence: evidence.map((event) => ({
          id: event.id,
          sessionId: event.sessionId,
          source: event.source,
          sourceTimestampMs: event.sourceTimestampMs,
          capturedAtMs: event.capturedAtMs,
          receivedAtMs: event.receivedAtMs,
          payloadSha256: event.integrity.payloadSha256,
          entrySha256: event.integrity.entrySha256,
          redacted: redactions.has(event.id) || event.contentRedacted === true,
        })),
      },
      limitations: [
        ...original.limitations.filter(
          (line) =>
            !line.startsWith("This export contains captured evidence") &&
            !line.startsWith("Independent transcription,"),
        ),
        "Findings retain their operator-authored or model-proposed provenance, source references and revision history. Model proposals require review; literal detection is not semantic AI analysis.",
        "Redactions produce a separate export copy and conservatively mask dependent notes, findings, editorial history and matching account/quotation text. Original evidence and revision hashes remain unchanged. Review before sharing: paraphrases, retained identifiers and identifying media content are not automatically anonymised.",
        "Printable HTML supports browser print-to-PDF. The evidence manifest contains hash receipts, not an external signature.",
      ],
    };
    return { ...bundle, reportSha256: digest(bundle) };
  }
  exportReport(workspace, caseId, { format = "json", media = null } = {}) {
    choice(format, ["json", "html", "markdown"], "invalid_format");
    const report = this.report(workspace, caseId, { media }),
      filename = "livelens-" + caseId;
    if (format === "json")
      return {
        format,
        content: JSON.stringify(report, null, 2),
        contentType: "application/json",
        filename: filename + ".json",
      };
    if (format === "markdown") {
      const lines = [
        "# " + markdownText(report.title),
        "",
        markdownText(report.summary),
        "",
        `Report SHA-256: ${report.reportSha256}`,
        "",
        "## Findings",
      ];
      for (const finding of report.findings)
        lines.push(
          "",
          `### ${markdownText(finding.title)} (${finding.status})`,
          markdownText(finding.statement),
          "Supporting evidence: " + finding.supportEvidenceIds.join(", "),
          "Counterevidence: " +
            (finding.counterEvidenceIds.join(", ") || "None linked"),
          ...finding.history.map(
            (item) =>
              `Revision ${item.revision}: ${markdownText(item.reason)} — ${markdownText(item.reviewer)}`,
          ),
        );
      lines.push("", "## Source evidence");
      for (const event of report.evidence)
        lines.push(
          "",
          `### ${event.id}`,
          markdownText(event.text),
          `Source: ${markdownText(event.sessionId)}; provider time: ${event.sourceTimestampMs ?? "unavailable"}; collector: ${event.capturedAtMs ?? "unavailable"}`,
        );
      lines.push(
        "",
        "## Retained media receipts",
        markdownText(
          report.media === null
            ? "Media receipts were not requested for this export."
            : JSON.stringify(report.media),
        ),
        "",
        "## Limitations",
        ...report.limitations.map((line) => "- " + markdownText(line)),
      );
      return {
        format,
        content: lines.join("\n"),
        contentType: "text/markdown; charset=utf-8",
        filename: filename + ".md",
      };
    }
    const links = (ids) =>
      ids
        .map((id) => `<a href="#${escapeHtml(id)}">${escapeHtml(id)}</a>`)
        .join(", ") || "None linked";
    const content = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; img-src 'none'; base-uri 'none'; form-action 'none'"><title>${escapeHtml(report.title)}</title><style>body{font:16px/1.6 system-ui,sans-serif;color:#15202a;max-width:900px;margin:40px auto;padding:0 24px}h1,h2,h3{line-height:1.2}article{margin:24px 0;border-top:1px solid #ddd;padding-top:12px}blockquote{white-space:pre-wrap;border-left:3px solid #698279;padding-left:16px}small{overflow-wrap:anywhere}.badge{font-size:12px;text-transform:uppercase}a{color:#244d70}@media print{body{margin:0;max-width:none}article{break-inside:avoid}a{color:inherit}}</style></head><body><h1>${escapeHtml(report.title)}</h1><p>${escapeHtml(report.summary)}</p><p>Investigation question: ${escapeHtml(report.case.question)}</p><small>Report SHA-256: ${report.reportSha256}</small><h2>Findings and review</h2>${report.findings.map((finding) => `<article><span class="badge">${escapeHtml(finding.status)} · ${escapeHtml(finding.label)}</span><h3>${escapeHtml(finding.title)}</h3><p>${escapeHtml(finding.statement)}</p><p>Support: ${links(finding.supportEvidenceIds)}</p><p>Counterevidence: ${links(finding.counterEvidenceIds)}</p><details><summary>${finding.history.length} retained revisions</summary>${finding.history.map((item) => `<p>Revision ${item.revision} — ${escapeHtml(item.status)}, ${escapeHtml(item.reviewer)}: ${escapeHtml(item.reason)}</p>`).join("")}</details></article>`).join("")}<h2>Original context and evidence copies</h2>${report.evidence.map((event) => `<article id="${escapeHtml(event.id)}"><span class="badge">${escapeHtml(event.kind)} · ${escapeHtml(event.attribution.status)}</span><h3>${escapeHtml(event.attribution.account ? "@" + event.attribution.account : "Unknown / redacted account")}</h3><blockquote>${escapeHtml(event.text)}</blockquote><small>Evidence ${escapeHtml(event.id)}<br>Session ${escapeHtml(event.sessionId)}<br>Provider time ${event.sourceTimestampMs ?? "unavailable"} · collector time ${event.capturedAtMs ?? "unavailable"} · receipt time ${event.receivedAtMs}<br>Original payload SHA-256 ${event.integrity.payloadSha256}${event.redaction ? "<br>Redacted copy: " + escapeHtml(event.redaction.reason) : ""}</small></article>`).join("")}<h2>Operator notes</h2>${report.notes.map((note) => `<p>${escapeHtml(note.text)}<br><small>${escapeHtml(note.reviewer)} · ${links(note.evidenceIds)}</small></p>`).join("")}<h2>Source manifests</h2>${report.sessions.map((session) => `<p>${escapeHtml(session.title)}<br><small>${escapeHtml(session.sourceUrl ?? "Source URL redacted in this copy")}${session.sourceReferenceSha256 ? "<br>Original source-reference SHA-256 " + session.sourceReferenceSha256 : ""}<br>Session ${escapeHtml(session.id)}; local chain ${session.integrity.ok ? "verified" : "unavailable"}; ${escapeHtml(session.integrity.headSha256)}</small></p>`).join("")}<h2>Retained media receipts</h2><pre>${escapeHtml(report.media === null ? "Media receipts were not requested for this export." : JSON.stringify(report.media, null, 2))}</pre><h2>Limitations</h2><ul>${report.limitations.map((line) => "<li>" + escapeHtml(line) + "</li>").join("")}</ul></body></html>`;
    return {
      format,
      content,
      contentType: "text/html; charset=utf-8",
      filename: filename + ".html",
    };
  }
}
