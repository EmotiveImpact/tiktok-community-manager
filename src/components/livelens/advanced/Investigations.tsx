import { useEffect, useState, type FormEvent } from "react";
import {
  ArrowLeft,
  ArrowRight,
  Bookmark,
  Check,
  Download,
  FileText,
  Plus,
  Search,
} from "lucide-react";
import {
  api,
  exportText,
  type Case,
  type Evidence,
} from "../../../lib/livelens/api";
import {
  collection,
  Empty,
  EvidenceList,
  Loading,
  Notice,
  Section,
  stamp,
  Status,
  useAction,
  useEvidenceIds,
  useResource,
  type OpenEvidence,
} from "./shared";

type History = {
  revision?: number;
  status: string;
  reason: string;
  reviewer?: string;
  createdAtMs: number;
  statement?: string;
};
type Note = {
  id: string;
  text: string;
  evidenceIds: string[];
  reviewer: string;
  createdAtMs: number;
};
type Finding = {
  label?: string;
  id: string;
  title: string;
  statement: string;
  topic?: string;
  supportEvidenceIds: string[];
  counterEvidenceIds: string[];
  status: string;
  revision: number;
  history: History[];
};
type Detail = {
  case: Case;
  evidence: Evidence[];
  notes: Note[];
  findings: Finding[];
  truncated?: boolean;
};
type ReportEditor = {
  title: string;
  summary: string;
  redactions: {
    evidenceId: string;
    text: boolean;
    account: boolean;
    reason?: string;
  }[];
  revision: number;
  history: History[];
};

export function ReviewedReport({
  caseId,
  onOpenEvidence,
}: {
  caseId: string;
  onOpenEvidence: OpenEvidence;
}) {
  const resource = useResource<Detail>(
    `/v1/investigations/${encodeURIComponent(caseId)}`,
  );
  return (
    <div className="aw-workspace">
      <Notice error={resource.error} />
      {resource.loading && !resource.data ? (
        <Loading />
      ) : (
        resource.data && (
          <ReportEditorView
            caseId={caseId}
            detail={resource.data}
            onOpenEvidence={onOpenEvidence}
          />
        )
      )}
    </div>
  );
}

export default function Investigations({
  onOpenEvidence,
  initialCaseId,
  onSelectCase,
}: {
  onOpenEvidence: OpenEvidence;
  initialCaseId?: string | null;
  onSelectCase?: (caseId: string | null) => void;
}) {
  const resource = useResource<unknown>("/v1/cases?limit=200");
  const [currentId, setCurrentId] = useState<string | null>(initialCaseId ?? null);
  useEffect(() => {
    setCurrentId(initialCaseId ?? null);
  }, [initialCaseId]);
  const [editor, setEditor] = useState(false);
  const [title, setTitle] = useState("");
  const [question, setQuestion] = useState("");
  const [tab, setTab] = useState("cases");
  const action = useAction();
  const items = collection<Case>(resource.data, "cases");
  const selectCase = (caseId: string | null) => {
    setCurrentId(caseId);
    onSelectCase?.(caseId);
  };
  const create = async (event: FormEvent) => {
    event.preventDefault();
    let newId = "";
    if (
      await action.run(async () => {
        const value = await api<Case | { case: Case }>("/v1/cases", {
          title: title.trim(),
          question: question.trim(),
        });
        newId = "case" in value ? value.case.id : value.id;
      }, "Investigation created.")
    ) {
      resource.reload();
      setEditor(false);
      setTitle("");
      setQuestion("");
      selectCase(newId);
    }
  };
  if (currentId)
    return (
      <InvestigationDetail
        key={currentId}
        caseId={currentId}
        onOpenEvidence={onOpenEvidence}
        onBack={() => selectCase(null)}
      />
    );
  return (
    <>
      <div className="aw-toolbar">
        <div className="aw-segmented" aria-label="Investigation tools">
          {[
            ["cases", "Investigations"],
            ["bookmarks", "Bookmarks"],
            ["compare", "Compare conversations"],
          ].map(([value, label]) => (
            <button
              className={tab === value ? "is-active" : ""}
              key={value}
              onClick={() => setTab(value)}
            >
              {label}
            </button>
          ))}
        </div>
        {tab === "cases" && (
          <button className="aw-primary" onClick={() => setEditor(!editor)}>
            <Plus size={16} />
            {editor ? "Close editor" : "New investigation"}
          </button>
        )}
      </div>
      <Notice error={resource.error || action.error} receipt={action.receipt} />
      {tab === "cases" && (
        <>
          {editor && (
            <Section title="Start with a question">
              <form className="aw-form" onSubmit={create}>
                <label>
                  Investigation name
                  <input
                    required
                    maxLength={200}
                    value={title}
                    onChange={(event) => setTitle(event.target.value)}
                    placeholder="Name the question you are investigating"
                  />
                </label>
                <label>
                  Question
                  <textarea
                    required
                    rows={3}
                    maxLength={4000}
                    value={question}
                    onChange={(event) => setQuestion(event.target.value)}
                    placeholder="What should the captured evidence establish or challenge?"
                  />
                </label>
                <div className="aw-form-footer">
                  <span className="aw-help">
                    Sources and conclusions stay separate throughout review.
                  </span>
                  <button className="aw-primary" disabled={action.busy}>
                    {action.busy ? "Creating…" : "Create investigation"}
                    <ArrowRight size={15} />
                  </button>
                </div>
              </form>
            </Section>
          )}
          <Section
            title="Investigation library"
            description={`${items.length} retained investigations`}
            action={
              <button className="aw-text-button" onClick={resource.reload}>
                Refresh
              </button>
            }
          >
            {resource.loading ? (
              <Loading />
            ) : !items.length ? (
              <Empty title="An investigation begins with a question">
                Create one, then gather supporting and conflicting statements
                from your session library.
              </Empty>
            ) : (
              <div className="aw-item-list">
                {items.map((item) => (
                  <button
                    className="aw-select-row"
                    key={item.id}
                    onClick={() => selectCase(item.id)}
                  >
                    <span className="aw-list-symbol">
                      <FileText size={18} />
                    </span>
                    <span className="aw-row-label">
                      <strong>{item.title}</strong>
                      <small>{item.question}</small>
                      <small>{stamp(item.createdAtMs)}</small>
                    </span>
                    <ArrowRight size={17} />
                  </button>
                ))}
              </div>
            )}
          </Section>
        </>
      )}
      {tab === "bookmarks" && <Bookmarks onOpenEvidence={onOpenEvidence} />}
      {tab === "compare" && <Comparison onOpenEvidence={onOpenEvidence} />}
    </>
  );
}

function InvestigationDetail({
  caseId,
  onOpenEvidence,
  onBack,
}: {
  caseId: string;
  onOpenEvidence: OpenEvidence;
  onBack: () => void;
}) {
  const resource = useResource<Detail>(
    `/v1/investigations/${encodeURIComponent(caseId)}`,
  );
  const [tab, setTab] = useState("evidence");
  const [note, setNote] = useState("");
  const [selected, setSelected] = useState<string[]>([]);
  const [findingTitle, setFindingTitle] = useState("");
  const [statement, setStatement] = useState("");
  const [topic, setTopic] = useState("");
  const [support, setSupport] = useState<string[]>([]);
  const [counter, setCounter] = useState<string[]>([]);
  const action = useAction();
  const detail = resource.data;
  const toggle = (id: string) =>
    setSelected((old) =>
      old.includes(id) ? old.filter((value) => value !== id) : [...old, id],
    );
  const addNote = async (event: FormEvent) => {
    event.preventDefault();
    if (
      await action.run(
        () =>
          api(`/v1/investigations/${encodeURIComponent(caseId)}/notes`, {
            text: note.trim(),
            evidenceIds: selected,
          }),
        "Note saved with its evidence references.",
      )
    ) {
      setNote("");
      resource.reload();
    }
  };
  const addFinding = async (event: FormEvent) => {
    event.preventDefault();
    if (
      await action.run(
        () =>
          api(`/v1/investigations/${encodeURIComponent(caseId)}/findings`, {
            title: findingTitle.trim(),
            statement: statement.trim(),
            supportEvidenceIds: support,
            counterEvidenceIds: counter,
            topic: topic.trim() || undefined,
          }),
        "Draft finding saved for review.",
      )
    ) {
      setFindingTitle("");
      setStatement("");
      setSupport([]);
      setCounter([]);
      resource.reload();
    }
  };
  return (
    <>
      <button className="aw-text-button aw-back" onClick={onBack}>
        <ArrowLeft size={16} />
        All investigations
      </button>
      <Notice error={resource.error || action.error} receipt={action.receipt} />
      {resource.loading && !detail ? (
        <Loading />
      ) : (
        detail && (
          <>
            <div className="aw-case-heading">
              <div>
                <span className="aw-eyebrow">INVESTIGATION</span>
                <h2>{detail.case.title}</h2>
                <p>{detail.case.question}</p>
              </div>
              <Status>{detail.evidence.length} sources</Status>
            </div>
            {detail.truncated && (
              <div className="aw-notice">
                This investigation contains more evidence than this view can
                show. Review a bounded selection before exporting.
              </div>
            )}
            <div
              className="aw-segmented aw-detail-tabs"
              aria-label="Investigation sections"
            >
              {[
                ["evidence", "Evidence & notes"],
                ["findings", "Findings & review"],
                ["report", "Report editor"],
                ["access", "Access"],
              ].map(([value, label]) => (
                <button
                  className={tab === value ? "is-active" : ""}
                  key={value}
                  onClick={() => setTab(value)}
                >
                  {label}
                </button>
              ))}
            </div>
            {tab === "evidence" && (
              <div className="aw-split aw-split-wide">
                <Section
                  title="Linked statements"
                  description="Select statements to attach precise references to a note."
                >
                  <EvidenceList
                    evidence={detail.evidence}
                    onOpenEvidence={onOpenEvidence}
                    selected={selected}
                    onSelect={toggle}
                  />
                </Section>
                <Section
                  title="Analyst notebook"
                  description="Notes are your interpretation; originals remain unchanged."
                >
                  <div className="aw-detail-content">
                    <form className="aw-form" onSubmit={addNote}>
                      <label>
                        Add a note
                        <textarea
                          required
                          rows={4}
                          maxLength={8000}
                          value={note}
                          onChange={(event) => setNote(event.target.value)}
                          placeholder="Record what matters, including uncertainty or missing context."
                        />
                      </label>
                      <div className="aw-form-footer">
                        <span className="aw-help">
                          {selected.length} statements selected
                        </span>
                        <button
                          className="aw-primary"
                          disabled={action.busy || !note.trim()}
                        >
                          <Plus size={14} />
                          Save note
                        </button>
                      </div>
                    </form>
                    <div className="aw-history">
                      {(detail.notes ?? []).map((item) => (
                        <article className="aw-note" key={item.id}>
                          <p>{item.text}</p>
                          <small>
                            {item.reviewer} · {stamp(item.createdAtMs)}
                          </small>
                          <SourceChips
                            ids={item.evidenceIds}
                            evidence={detail.evidence}
                            onOpenEvidence={onOpenEvidence}
                          />
                        </article>
                      ))}
                      {!detail.notes?.length && (
                        <p className="aw-help">
                          No notes yet. Your first observation can start here.
                        </p>
                      )}
                    </div>
                  </div>
                </Section>
              </div>
            )}
            {tab === "findings" && (
              <>
                <AnalysisSuggestions
                  caseId={caseId}
                  onSaved={resource.reload}
                />
                <Section
                  title="Record a finding"
                  description="Attach supporting and conflicting evidence. This creates a draft interpretation."
                >
                  <form onSubmit={addFinding} className="aw-form">
                    <div className="aw-form-grid">
                      <label>
                        Finding title
                        <input
                          required
                          maxLength={200}
                          value={findingTitle}
                          onChange={(event) =>
                            setFindingTitle(event.target.value)
                          }
                          placeholder="State the finding concisely"
                        />
                      </label>
                      <label>
                        Topic <span className="aw-optional">optional</span>
                        <input
                          maxLength={128}
                          value={topic}
                          onChange={(event) => setTopic(event.target.value)}
                          placeholder="A useful grouping"
                        />
                      </label>
                    </div>
                    <label>
                      Interpretation
                      <textarea
                        required
                        maxLength={8000}
                        rows={3}
                        value={statement}
                        onChange={(event) => setStatement(event.target.value)}
                        placeholder="What do these sources support, and where is the conclusion uncertain?"
                      />
                    </label>
                    <div className="aw-evidence-choice">
                      <div className="aw-choice-head">
                        <span>Linked evidence</span>
                        <span>Supports</span>
                        <span>Challenges</span>
                      </div>
                      {detail.evidence.map((item) => (
                        <div className="aw-choice-row" key={item.id}>
                          <button
                            type="button"
                            onClick={() =>
                              onOpenEvidence(item.sessionId, item.id)
                            }
                          >
                            {item.text.slice(0, 140) || "Capture gap"}
                          </button>
                          <input
                            type="checkbox"
                            aria-label={`Supports finding: ${item.text.slice(0, 60)}`}
                            checked={support.includes(item.id)}
                            onChange={() => {
                              setSupport((old) =>
                                old.includes(item.id)
                                  ? old.filter((id) => id !== item.id)
                                  : [...old, item.id],
                              );
                              setCounter((old) =>
                                old.filter((id) => id !== item.id),
                              );
                            }}
                          />
                          <input
                            type="checkbox"
                            aria-label={`Challenges finding: ${item.text.slice(0, 60)}`}
                            checked={counter.includes(item.id)}
                            onChange={() => {
                              setCounter((old) =>
                                old.includes(item.id)
                                  ? old.filter((id) => id !== item.id)
                                  : [...old, item.id],
                              );
                              setSupport((old) =>
                                old.filter((id) => id !== item.id),
                              );
                            }}
                          />
                        </div>
                      ))}
                    </div>
                    <div className="aw-form-footer">
                      <span className="aw-help">
                        At least one supporting source is required.
                      </span>
                      <button
                        className="aw-primary"
                        disabled={action.busy || !support.length}
                      >
                        Save draft finding
                      </button>
                    </div>
                  </form>
                </Section>
                <Section
                  title="Findings and decisions"
                  description="Review decisions are retained; corrections keep earlier revisions visible."
                >
                  {!detail.findings?.length ? (
                    <Empty title="No findings recorded">
                      Use the editor above to make a source-supported
                      interpretation.
                    </Empty>
                  ) : (
                    <div className="aw-detail-content">
                      {detail.findings.map((finding) => (
                        <FindingReview
                          key={finding.id}
                          finding={finding}
                          detail={detail}
                          onOpenEvidence={onOpenEvidence}
                          onSaved={() => {
                            action.clear();
                            resource.reload();
                          }}
                        />
                      ))}
                    </div>
                  )}
                </Section>
              </>
            )}
            {tab === "report" && (
              <ReportEditorView
                caseId={caseId}
                detail={detail}
                onOpenEvidence={onOpenEvidence}
              />
            )}
            {tab === "access" && <CaseAccess caseId={caseId} />}
          </>
        )
      )}
    </>
  );
}

function SourceChips({
  ids,
  evidence,
  onOpenEvidence,
}: {
  ids: string[];
  evidence: Evidence[];
  onOpenEvidence: OpenEvidence;
}) {
  return (
    <div className="aw-tag-list">
      {ids.map((id, index) => {
        const item = evidence.find((value) => value.id === id);
        return (
          item && (
            <button
              className="aw-source-chip"
              key={id}
              onClick={() => onOpenEvidence(item.sessionId, id)}
            >
              Source {index + 1}
            </button>
          )
        );
      })}
    </div>
  );
}

function AnalysisSuggestions({
  caseId,
  onSaved,
}: {
  caseId: string;
  onSaved: () => void;
}) {
  const capabilities = useResource<{
    enabled: boolean;
    model?: string;
    reason?: string;
  }>("/v1/analysis/capabilities");
  const action = useAction();
  const suggest = async () => {
    if (
      await action.run(
        () => api("/v1/analysis", { caseId }),
        "Source-linked model suggestions saved as drafts for human review.",
      )
    )
      onSaved();
  };
  if (!capabilities.data?.enabled) return null;
  return (
    <div className="aw-analysis-strip">
      <div>
        <strong>Draft suggestions</strong>
        <p>
          Ask the configured model to propose findings from this investigation’s
          linked evidence. Every result requires your review.
        </p>
      </div>
      <button className="aw-secondary" disabled={action.busy} onClick={suggest}>
        {action.busy ? "Preparing suggestions…" : "Suggest findings"}
      </button>
      <Notice error={action.error} receipt={action.receipt} />
    </div>
  );
}

function FindingReview({
  finding,
  detail,
  onOpenEvidence,
  onSaved,
}: {
  finding: Finding;
  detail: Detail;
  onOpenEvidence: OpenEvidence;
  onSaved: () => void;
}) {
  const [reason, setReason] = useState("");
  const [statement, setStatement] = useState(finding.statement);
  const action = useAction();
  const review = async (status: string) => {
    if (
      await action.run(
        () =>
          api(
            `/v1/investigations/${encodeURIComponent(detail.case.id)}/findings/${encodeURIComponent(finding.id)}/review`,
            {
              status,
              reason: reason.trim(),
              expectedRevision: finding.revision,
              ...(statement !== finding.statement ? { statement } : {}),
            },
          ),
        "Finding decision saved.",
      )
    ) {
      setReason("");
      onSaved();
    }
  };
  return (
    <article className="aw-finding">
      <div className="aw-section-head">
        <h3>
          {finding.title}
          <small>
            {finding.label === "model-proposal"
              ? "Model suggestion — requires review"
              : "Operator interpretation"}
          </small>
        </h3>
        <Status status={finding.status}>{finding.status}</Status>
      </div>
      <p>{finding.statement}</p>
      <div className="aw-finding-sources">
        <strong>Supporting</strong>
        <SourceChips
          ids={finding.supportEvidenceIds ?? []}
          evidence={detail.evidence}
          onOpenEvidence={onOpenEvidence}
        />
      </div>
      <div className="aw-finding-sources">
        <strong>Conflicting</strong>
        {finding.counterEvidenceIds?.length ? (
          <SourceChips
            ids={finding.counterEvidenceIds}
            evidence={detail.evidence}
            onOpenEvidence={onOpenEvidence}
          />
        ) : (
          <span className="aw-help">None recorded</span>
        )}
      </div>
      <details className="aw-details">
        <summary>Review or correct this finding</summary>
        <div className="aw-form">
          <label>
            Statement
            <textarea
              rows={3}
              value={statement}
              maxLength={8000}
              onChange={(event) => setStatement(event.target.value)}
            />
          </label>
          <label>
            Reason for this decision
            <textarea
              rows={2}
              value={reason}
              maxLength={4000}
              onChange={(event) => setReason(event.target.value)}
              placeholder="What did you check? What changed?"
            />
          </label>
          <Notice error={action.error} receipt={action.receipt} />
          <div className="aw-button-row">
            <button
              className="aw-primary"
              disabled={action.busy || !reason.trim() || !statement.trim()}
              onClick={() => review("reviewed")}
            >
              <Check size={14} />
              Mark reviewed
            </button>
            <button
              className="aw-secondary"
              disabled={action.busy || !reason.trim()}
              onClick={() => review("draft")}
            >
              Return to draft
            </button>
            <button
              className="aw-text-button"
              disabled={action.busy || !reason.trim()}
              onClick={() => review("rejected")}
            >
              Reject finding
            </button>
          </div>
        </div>
      </details>
      {finding.history?.length > 0 && (
        <details className="aw-details">
          <summary>{finding.history.length} retained revisions</summary>
          <div className="aw-history">
            {finding.history.map((item, index) => (
              <p key={index}>
                <Status status={item.status}>{item.status}</Status>{" "}
                {item.reason}
                <small>
                  {item.reviewer} · {stamp(item.createdAtMs)}
                </small>
                {item.statement && (
                  <span className="aw-prior-statement">{item.statement}</span>
                )}
              </p>
            ))}
          </div>
        </details>
      )}
    </article>
  );
}

function ReportEditorView({
  caseId,
  detail,
  onOpenEvidence,
}: {
  caseId: string;
  detail: Detail;
  onOpenEvidence: OpenEvidence;
}) {
  const resource = useResource<ReportEditor>(
    `/v1/investigations/${encodeURIComponent(caseId)}/report`,
  );
  const capabilities = useResource<{ enabled: string[] }>("/v1/capabilities");
  const [title, setTitle] = useState(detail.case.title);
  const [summary, setSummary] = useState("");
  const [reason, setReason] = useState("");
  const [redactions, setRedactions] = useState<string[]>([]);
  const [readyFor, setReadyFor] = useState("");
  const action = useAction();
  useEffect(() => {
    if (resource.data) {
      setTitle(resource.data.title ?? detail.case.title);
      setSummary(resource.data.summary ?? "");
      setRedactions(
        (resource.data.redactions ?? []).map((item) => item.evidenceId),
      );
      setReadyFor(caseId);
    }
  }, [resource.data, detail.case.title, caseId]);
  const save = async (event: FormEvent) => {
    event.preventDefault();
    if (
      await action.run(
        () =>
          api(`/v1/investigations/${encodeURIComponent(caseId)}/report`, {
            title,
            summary,
            redactions: redactions.map((evidenceId) => ({
              evidenceId,
              text: true,
              account: true,
              reason,
            })),
            reason,
            expectedRevision: resource.data?.revision,
          }),
        "Report revision saved. Retained originals stay available to authorised reviewers.",
      )
    ) {
      setReason("");
      resource.reload();
    }
  };
  const download = async (format: string) => {
    await action.run(
      async () => {
        const response = await fetch(
          `/v1/investigations/${encodeURIComponent(caseId)}/report?format=${format}`,
          {
            credentials: "same-origin",
            redirect: "error",
            signal: AbortSignal.timeout(15_000),
          },
        );
        if (!response.ok) {
          const value = await response.json().catch(() => ({}));
          throw new Error(value.error ?? "Report export unavailable");
        }
        if (format === "pdf") {
          const blob = await response.blob();
          const url = URL.createObjectURL(blob);
          const anchor = document.createElement("a");
          anchor.href = url;
          anchor.download = `livelens-${caseId}.pdf`;
          anchor.click();
          setTimeout(() => URL.revokeObjectURL(url), 1000);
          return;
        }
        const mime = response.headers.get("content-type") ?? "";
        let content = await response.text();
        let filename = `livelens-${caseId}.${format === "markdown" ? "md" : format}`;
        let contentType =
          format === "html"
            ? "text/html"
            : format === "markdown"
              ? "text/markdown"
              : "application/json";
        if (mime.includes("json")) {
          const value = JSON.parse(content);
          if (typeof value.content === "string") {
            content = value.content;
            filename = value.filename ?? filename;
            contentType = value.contentType ?? contentType;
          }
        }
        exportText(content, filename, contentType);
      },
      `Report exported as ${format === "html" ? "printable HTML" : format.toUpperCase()}.`,
    );
  };
  return (
    <>
      <Notice error={resource.error || action.error} receipt={action.receipt} />
      <Section
        title="Shape the reviewed brief"
        description="Write your summary, protect sensitive quotations and keep the evidence trail."
      >
        {resource.loading || !resource.data || readyFor !== caseId ? (
          <Loading />
        ) : (
          <form className="aw-form" onSubmit={save}>
            <label>
              Report title
              <input
                required
                maxLength={200}
                value={title}
                onChange={(event) => setTitle(event.target.value)}
              />
            </label>
            <label>
              Executive summary
              <textarea
                rows={5}
                maxLength={16000}
                value={summary}
                onChange={(event) => setSummary(event.target.value)}
                placeholder="Describe conclusions, conflicting evidence and limitations."
              />
            </label>
            <fieldset>
              <legend>Redact quotations and account labels</legend>
              <p className="aw-help">
                Selected text and account labels are withheld in this report.
                Originals remain in the evidence journal.
              </p>
              <EvidenceList
                evidence={detail.evidence}
                onOpenEvidence={onOpenEvidence}
                selected={redactions}
                onSelect={(id) =>
                  setRedactions((old) =>
                    old.includes(id)
                      ? old.filter((value) => value !== id)
                      : [...old, id],
                  )
                }
              />
            </fieldset>
            <label>
              Revision reason
              <input
                required
                maxLength={2000}
                value={reason}
                onChange={(event) => setReason(event.target.value)}
                placeholder="Describe what changed"
              />
            </label>
            <div className="aw-form-footer">
              <span className="aw-help">
                {redactions.length} redacted sources
              </span>
              <button
                className="aw-primary"
                disabled={action.busy || !reason.trim()}
              >
                Save report revision
              </button>
            </div>
          </form>
        )}
      </Section>
      <Section
        title="Export the saved brief"
        description="Review saved content and redactions before sharing. Notes, summaries and other free-text fields need a separate privacy review."
      >
        <div className="aw-export-row">
          {[
            ["json", "Evidence bundle", "Source-linked JSON"],
            ["markdown", "Markdown brief", "Portable text report"],
            ["html", "Printable report", "HTML for printing"],
            ...(capabilities.data?.enabled.includes("pdf-reports")
              ? [["pdf", "PDF report", "Rendered document"]]
              : []),
          ].map(([format, label, hint]) => (
            <button
              className="aw-export-option"
              key={format}
              disabled={action.busy}
              onClick={() => download(format)}
            >
              <Download size={20} />
              <span>
                <strong>{label}</strong>
                <small>{hint}</small>
              </span>
              <ArrowRight size={16} />
            </button>
          ))}
        </div>
      </Section>
    </>
  );
}

function Bookmarks({ onOpenEvidence }: { onOpenEvidence: OpenEvidence }) {
  const resource = useResource<unknown>("/v1/bookmarks");
  const [id, setId] = useState("");
  const [label, setLabel] = useState("");
  const action = useAction();
  const items = collection<{
    id?: string;
    evidenceId: string;
    sessionId: string;
    label: string;
    evidence?: Evidence;
    createdAtMs: number;
  }>(resource.data, "bookmarks");
  const originals = useEvidenceIds(items.map((item) => item.evidenceId));
  const save = async (event: FormEvent) => {
    event.preventDefault();
    if (
      await action.run(
        () =>
          api("/v1/bookmarks", {
            evidenceId: id.trim(),
            label: label.trim() || "Saved evidence",
          }),
        "Bookmark saved.",
      )
    ) {
      setId("");
      setLabel("");
      resource.reload();
    }
  };
  return (
    <>
      <Notice
        error={resource.error || originals.error || action.error}
        receipt={action.receipt}
      />
      <Section
        title="Your saved evidence"
        description="Keep useful statements close while you work across investigations."
      >
        {resource.loading ? (
          <Loading />
        ) : !items.length ? (
          <Empty title="No bookmarks yet">
            Save a statement from its conversation, or paste its evidence ID
            below.
          </Empty>
        ) : (
          <div className="aw-item-list">
            {items.map((item) => (
              <div className="aw-bookmark" key={item.id ?? item.evidenceId}>
                <Bookmark size={16} />
                <div className="aw-grow">
                  <strong>{item.label || "Saved statement"}</strong>
                  <p>
                    {originals.data.find(
                      (value) => value.id === item.evidenceId,
                    )?.text ?? item.evidenceId}
                  </p>
                  <small>{stamp(item.createdAtMs)}</small>
                </div>
                <button
                  className="aw-text-button"
                  onClick={() =>
                    onOpenEvidence(item.sessionId, item.evidenceId)
                  }
                >
                  Open context
                  <ArrowRight size={14} />
                </button>
              </div>
            ))}
          </div>
        )}
        <form className="aw-form aw-inline-form" onSubmit={save}>
          <label>
            Evidence ID
            <input
              required
              value={id}
              maxLength={200}
              onChange={(event) => setId(event.target.value)}
            />
          </label>
          <label>
            Label <span className="aw-optional">optional</span>
            <input
              value={label}
              maxLength={200}
              onChange={(event) => setLabel(event.target.value)}
            />
          </label>
          <button className="aw-primary" disabled={action.busy}>
            <Bookmark size={14} />
            Save bookmark
          </button>
        </form>
      </Section>
    </>
  );
}

function Comparison({ onOpenEvidence }: { onOpenEvidence: OpenEvidence }) {
  const sessions = useResource<unknown>("/v1/sessions?limit=200");
  const [selected, setSelected] = useState<string[]>([]);
  const [terms, setTerms] = useState("");
  const [account, setAccount] = useState("");
  const [result, setResult] = useState<Record<string, unknown> | null>(null);
  const action = useAction();
  const items = collection<{ id: string; title: string; startedAtMs: number }>(
    sessions.data,
    "sessions",
  );
  const compare = async (event: FormEvent) => {
    event.preventDefault();
    await action.run(async () => {
      setResult(
        await api<Record<string, unknown>>("/v1/comparisons", {
          sessionIds: selected,
          terms: terms
            .split(",")
            .map((term) => term.trim())
            .filter(Boolean),
          account: account.replace(/^@/, "").trim() || undefined,
        }),
      );
    }, "Comparison completed using retained statements.");
  };
  const groups = collection<{
    session: { id: string; title: string };
    topics: { term: string; count: number; evidenceIds: string[] }[];
    gaps: { evidenceId: string; text: string }[];
    bounded?: boolean;
    sampledEvidenceCount?: number;
  }>(result, "sessions");
  const originals = useEvidenceIds(
    groups.flatMap((group) =>
      group.topics.flatMap((topic) => topic.evidenceIds),
    ),
  );
  return (
    <>
      <Notice error={sessions.error || action.error} receipt={action.receipt} />
      <Section
        title="Compare captured conversations"
        description="A literal comparison shows matching statements across sessions. Interpretation remains yours."
      >
        <form className="aw-form" onSubmit={compare}>
          <div className="aw-form-grid">
            <label>
              Terms, separated by commas
              <input
                value={terms}
                maxLength={1000}
                onChange={(event) => setTerms(event.target.value)}
                placeholder="topic, phrase"
              />
            </label>
            <label>
              Observed account <span className="aw-optional">optional</span>
              <input
                value={account}
                maxLength={100}
                onChange={(event) => setAccount(event.target.value)}
                placeholder="@account"
              />
            </label>
          </div>
          <fieldset>
            <legend>Select conversations</legend>
            {sessions.loading ? (
              <Loading />
            ) : (
              <div className="aw-selection-list">
                {items.map((item) => (
                  <label key={item.id}>
                    <input
                      type="checkbox"
                      checked={selected.includes(item.id)}
                      onChange={() =>
                        setSelected((old) =>
                          old.includes(item.id)
                            ? old.filter((id) => id !== item.id)
                            : [...old, item.id],
                        )
                      }
                    />
                    <span>
                      {item.title}
                      <small>{stamp(item.startedAtMs)}</small>
                    </span>
                  </label>
                ))}
              </div>
            )}
          </fieldset>
          <div className="aw-form-footer">
            <span className="aw-help">Choose at least two conversations.</span>
            <button
              className="aw-primary"
              disabled={action.busy || selected.length < 2}
            >
              <Search size={15} />
              {action.busy ? "Comparing…" : "Compare statements"}
            </button>
          </div>
        </form>
      </Section>
      {result && (
        <Section
          title="Comparison evidence"
          description="Similar wording or timing does not establish a causal relationship."
        >
          <div className="aw-detail-content">
            <Notice error={originals.error} />
            {originals.loading ? (
              <Loading />
            ) : (
              groups.map((group) => (
                <div className="aw-comparison-group" key={group.session.id}>
                  <h3>{group.session.title}</h3>
                  <p className="aw-help">
                    {group.sampledEvidenceCount ?? 0} sampled statements
                    {group.bounded ? " · bounded sample" : ""}
                  </p>
                  {group.topics.map((topic) => (
                    <div key={topic.term}>
                      <h3>
                        {topic.term}: {topic.count} literal matches
                      </h3>
                      <EvidenceList
                        evidence={originals.data.filter((item) =>
                          topic.evidenceIds.includes(item.id),
                        )}
                        onOpenEvidence={onOpenEvidence}
                      />
                    </div>
                  ))}
                  {group.gaps.length > 0 && (
                    <p className="aw-help">
                      {group.gaps.length} capture gaps in this sample.
                    </p>
                  )}
                </div>
              ))
            )}
          </div>
        </Section>
      )}
    </>
  );
}

function CaseAccess({ caseId }: { caseId: string }) {
  const resource = useResource<{
    visibility: string;
    grants: { subject: string; permission: string }[];
  }>(`/v1/workspace/cases/${encodeURIComponent(caseId)}/access`);
  const [subject, setSubject] = useState("");
  const [permission, setPermission] = useState("read");
  const [reason, setReason] = useState("");
  const action = useAction();
  const save = async (body: Record<string, unknown>) => {
    if (
      await action.run(
        () =>
          api(`/v1/workspace/cases/${encodeURIComponent(caseId)}/access`, {
            ...body,
            reason,
          }),
        "Investigation access updated.",
      )
    ) {
      setSubject("");
      setReason("");
      resource.reload();
    }
  };
  return (
    <Section
      title="Investigation access"
      description="Restrict a sensitive investigation to named members when necessary."
    >
      <Notice error={resource.error || action.error} receipt={action.receipt} />
      {resource.loading ? (
        <Loading />
      ) : (
        resource.data && (
          <div className="aw-detail-content">
            <div className="aw-receipt">
              <strong>Visibility</strong>
              <Status>{resource.data.visibility}</Status>
            </div>
            <div className="aw-item-list">
              {resource.data.grants.map((grant) => (
                <div className="aw-access-row" key={grant.subject}>
                  <span>{grant.subject}</span>
                  <Status>{grant.permission}</Status>
                </div>
              ))}
            </div>
            <form
              className="aw-form"
              onSubmit={(event) => {
                event.preventDefault();
                save({ subject, permission });
              }}
            >
              <div className="aw-form-grid">
                <label>
                  Member identifier
                  <input
                    required
                    value={subject}
                    maxLength={160}
                    onChange={(event) => setSubject(event.target.value)}
                  />
                </label>
                <label>
                  Permission
                  <select
                    value={permission}
                    onChange={(event) => setPermission(event.target.value)}
                  >
                    <option value="read">Read</option>
                    <option value="write">Read and edit</option>
                    <option value="none">Remove grant</option>
                  </select>
                </label>
              </div>
              <label>
                Reason
                <input
                  required
                  maxLength={2000}
                  value={reason}
                  onChange={(event) => setReason(event.target.value)}
                />
              </label>
              <div className="aw-button-row">
                <button
                  className="aw-primary"
                  disabled={action.busy || !reason.trim()}
                >
                  Save member access
                </button>
                <button
                  type="button"
                  className="aw-secondary"
                  disabled={action.busy || !reason.trim()}
                  onClick={() =>
                    save({
                      visibility:
                        resource.data?.visibility === "restricted"
                          ? "workspace"
                          : "restricted",
                    })
                  }
                >
                  {resource.data.visibility === "restricted"
                    ? "Open to workspace"
                    : "Restrict access"}
                </button>
              </div>
            </form>
          </div>
        )
      )}
    </Section>
  );
}
