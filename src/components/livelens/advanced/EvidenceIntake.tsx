import { useEffect, useRef, useState } from "react";
import {
  ArrowLeft,
  ArrowRight,
  ArrowUpRight,
  Bookmark,
  Check,
  ChevronDown,
  Plus,
  Search,
  X,
} from "lucide-react";
import { api, type Evidence } from "../../../lib/livelens/api";
import {
  Empty,
  friendlyError,
  Loading,
  Notice,
  stamp,
  useResource,
  type OpenEvidence,
} from "./shared";

type SavedSource = { id: string; label: string; evidence: Evidence };
type SearchPage = {
  evidence?: Evidence[];
  bookmarks?: SavedSource[];
  hasMore: boolean;
  nextOffset: number | null;
};
type Selection = { evidence: Evidence; label?: string; savedId?: string };

/** The tray owns original objects, so changing the query/page cannot change its contents. */
export default function EvidenceIntake({
  caseId,
  linkedIds,
  canWrite,
  onLinked,
  onOpenEvidence,
  revision,
  totalEvidence,
}: {
  caseId: string;
  linkedIds: string[];
  canWrite: boolean;
  onLinked: () => void;
  onOpenEvidence: OpenEvidence;
  revision: number;
  totalEvidence: number;
}) {
  const [query, setQuery] = useState("");
  const [settledQuery, setSettledQuery] = useState("");
  const [account, setAccount] = useState("");
  const [settledAccount, setSettledAccount] = useState("");
  const [kind, setKind] = useState("all");
  const [savedOnly, setSavedOnly] = useState(false);
  const [offsets, setOffsets] = useState([0]);
  const [selection, setSelection] = useState<Selection[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [receipt, setReceipt] = useState("");
  const submitting = useRef(false);
  const alive = useRef(true);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);
  useEffect(() => {
    const timer = window.setTimeout(() => {
      setSettledQuery(query);
      setSettledAccount(account);
    }, 300);
    return () => window.clearTimeout(timer);
  }, [query, account]);
  const offset = offsets[offsets.length - 1];
  const parameters = new URLSearchParams({
    q: settledQuery.trim(),
    ...(settledAccount.trim() ? { account: settledAccount.trim() } : {}),
    kind,
    limit: "50",
    offset: String(offset),
    ...(savedOnly ? { includeEvidence: "true" } : {}),
  });
  const page = useResource<SearchPage>(
    `${savedOnly ? "/v1/bookmarks" : "/v1/evidence/search"}?${parameters}`,
    revision,
  );
  const waiting =
    query !== settledQuery || account !== settledAccount || page.loading;
  const rows: Selection[] = waiting
    ? []
    : savedOnly
      ? (page.data?.bookmarks ?? []).map((saved) => ({
          evidence: saved.evidence,
          label: saved.label,
          savedId: saved.id,
        }))
      : (page.data?.evidence ?? []).map((evidence) => ({ evidence }));
  const linked = new Set(linkedIds);
  const pending = selection.filter((item) => !linked.has(item.evidence.id));
  const remaining = Math.max(0, 200 - totalEvidence);
  const selectionLimit = Math.min(50, remaining);
  const selectedIds = new Set(selection.map((item) => item.evidence.id));
  const toggle = (item: Selection) => {
    if (!canWrite || busy || linked.has(item.evidence.id)) return;
    setError("");
    setReceipt("");
    setSelection((old) =>
      old.some((value) => value.evidence.id === item.evidence.id)
        ? old.filter((value) => value.evidence.id !== item.evidence.id)
        : old.length < 50 &&
            old.filter((value) => !linked.has(value.evidence.id)).length <
              remaining
          ? [...old, item]
          : old,
    );
  };
  const add = async () => {
    if (
      submitting.current ||
      !canWrite ||
      !pending.length ||
      pending.length > remaining
    )
      return;
    submitting.current = true;
    setBusy(true);
    setError("");
    setReceipt("");
    const ids = pending.map((item) => item.evidence.id);
    try {
      const result = await api<{
        linked: number;
        existing: number;
        total: number;
      }>(`/v1/cases/${encodeURIComponent(caseId)}/evidence`, {
        evidenceIds: ids,
        forReview: true,
      });
      if (!alive.current) return;
      setReceipt(
        `${result.linked} ${result.linked === 1 ? "source added" : "sources added"}${result.existing ? `; ${result.existing} already linked` : ""}. Originals are preserved.`,
      );
      setSelection([]);
      onLinked();
      page.reload();
    } catch (cause) {
      if (alive.current) {
        const message =
          cause instanceof Error &&
          /scope_denied|workspace_role_denied|case_access_denied|workspace_membership_denied/.test(
            cause.message,
          )
            ? "Your current access does not allow adding evidence."
            : cause instanceof Error &&
                cause.message.includes("investigation_evidence_capacity")
              ? "This investigation has reached its review capacity. Refresh to check the available space."
              : friendlyError(cause);
        setError(`${message} Your selection is kept for retry.`);
      }
    } finally {
      submitting.current = false;
      if (alive.current) setBusy(false);
    }
  };
  return (
    <div className="id-intake">
      <section
        className="id-source-browser"
        aria-label="Find investigation evidence"
      >
        <header className="id-section-heading">
          <div>
            <span className="id-kicker">SOURCE LIBRARY</span>
            <h3>Gather evidence</h3>
            <p>Find the statements that support or challenge your question.</p>
          </div>
          <Search size={19} aria-hidden="true" />
        </header>
        <div className="id-search-controls">
          <div className="id-source-switch" aria-label="Evidence source">
            <button
              aria-pressed={!savedOnly}
              onClick={() => {
                setSavedOnly(false);
                setOffsets([0]);
              }}
            >
              All retained evidence
            </button>
            <button
              aria-pressed={savedOnly}
              onClick={() => {
                setSavedOnly(true);
                setOffsets([0]);
              }}
            >
              <Bookmark size={14} />
              Saved moments
            </button>
          </div>
          <div className="id-search-line">
            <label className="id-search-input">
              <Search size={17} aria-hidden="true" />
              <input
                aria-label="Search retained evidence"
                type="search"
                placeholder={
                  savedOnly
                    ? "Search saved statements or labels"
                    : "Search retained statements"
                }
                maxLength={512}
                value={query}
                onChange={(event) => {
                  setQuery(event.target.value);
                  setOffsets([0]);
                }}
              />
            </label>
            <label className="id-kind-filter">
              <span>Evidence kind</span>
              <select
                aria-label="Evidence kind"
                value={kind}
                onChange={(event) => {
                  setKind(event.target.value);
                  setOffsets([0]);
                }}
              >
                <option value="all">All kinds</option>
                <option value="chat">Chat</option>
                <option value="caption">Captions</option>
                <option value="transcript">Transcripts</option>
                <option value="observation">Observations</option>
                <option value="gap">Capture gaps</option>
              </select>
            </label>
          </div>
          <label className="id-account-filter">
            <span>Observed account</span>
            <input
              aria-label="Filter evidence by account"
              placeholder="@account · optional"
              maxLength={100}
              value={account}
              onChange={(event) => {
                setAccount(event.target.value);
                setOffsets([0]);
              }}
            />
            <span>Exact current attribution</span>
          </label>
          <p className="id-search-hint">
            Literal search across retained evidence in this workspace. Selection
            stays with you across pages.
          </p>
        </div>
        {page.error && !waiting && (
          <div className="id-inline-notice">
            <Notice error={page.error} />
            <button className="aw-secondary" onClick={page.reload}>
              Retry search
            </button>
          </div>
        )}
        <div className="id-search-results" aria-busy={waiting}>
          {waiting ? (
            <Loading />
          ) : !page.error && !rows.length ? (
            <Empty
              title={
                offset
                  ? "End of these results"
                  : savedOnly
                    ? "No saved moments match"
                    : "No matching evidence"
              }
            >
              {offset
                ? "Return to the previous page or change your search."
                : "Try a different phrase or kind. Your selected sources stay in the tray."}
            </Empty>
          ) : (
            rows.map((row) => {
              const item = row.evidence;
              const alreadyLinked = linked.has(item.id);
              const selected = selectedIds.has(item.id);
              return (
                <article
                  key={row.savedId ?? item.id}
                  className={`id-source-row${selected ? " is-selected" : ""}`}
                >
                  <label className="id-source-check">
                    <input
                      type="checkbox"
                      aria-label={`Select source: ${item.text.slice(0, 70) || "Capture gap"}`}
                      checked={alreadyLinked || selected}
                      disabled={
                        !canWrite ||
                        busy ||
                        alreadyLinked ||
                        (!selected &&
                          (selection.length >= 50 ||
                            pending.length >= remaining))
                      }
                      onChange={() => toggle(row)}
                    />
                  </label>
                  <div className="id-source-content">
                    <div className="id-source-meta">
                      <strong>
                        {item.attribution?.account
                          ? `@${item.attribution.account}`
                          : item.kind === "gap"
                            ? "Capture gap"
                            : "Unattributed source"}
                      </strong>
                      <span>{item.kind}</span>
                      {alreadyLinked && (
                        <span className="id-linked">
                          <Check size={12} />
                          Linked
                        </span>
                      )}
                    </div>
                    {row.label && (
                      <span className="id-saved-label">
                        <Bookmark size={12} />
                        {row.label}
                      </span>
                    )}
                    <p className="id-source-quote">
                      {item.text ||
                        "A recorded gap; no statement was captured."}
                    </p>
                    <div className="id-source-context">
                      <span>Collected {stamp(item.capturedAtMs)}</span>
                      <span title={item.sessionId}>
                        Session {item.sessionId.slice(0, 12)}
                      </span>
                    </div>
                    <details className="id-source-preview">
                      <summary
                        aria-label={`Preview source: ${item.text.slice(0, 70) || "Capture gap"}`}
                      >
                        Inspect original <ChevronDown size={13} />
                      </summary>
                      <SourceProvenance
                        evidence={item}
                        onOpenEvidence={onOpenEvidence}
                      />
                    </details>
                  </div>
                </article>
              );
            })
          )}
        </div>
        <nav className="id-pagination" aria-label="Evidence pages">
          <button
            className="aw-text-button"
            aria-label="Previous evidence page"
            disabled={offsets.length === 1 || waiting}
            onClick={() => setOffsets((old) => old.slice(0, -1))}
          >
            <ArrowLeft size={15} />
            Previous
          </button>
          <span>
            {waiting
              ? "Finding sources…"
              : `${rows.length} shown · Page ${offsets.length}`}
          </span>
          <button
            className="aw-text-button"
            aria-label="Next evidence page"
            disabled={
              waiting || !page.data?.hasMore || page.data.nextOffset == null
            }
            onClick={() => {
              if (page.data?.nextOffset != null)
                setOffsets((old) => [...old, page.data!.nextOffset!]);
            }}
          >
            Next
            <ArrowRight size={15} />
          </button>
        </nav>
      </section>
      <aside className="id-selection-tray" aria-label="Selected evidence">
        <header className="id-section-heading">
          <div>
            <span className="id-kicker">READY TO LINK</span>
            <h3>
              Your selection <span>{selection.length}</span>
            </h3>
            <p>Review these sources before adding them.</p>
          </div>
        </header>
        {!canWrite && (
          <div className="id-inline-notice">
            <Notice error="You have read-only access to this investigation. You can inspect sources; an editor must add them." />
          </div>
        )}
        {remaining === 0 && (
          <div className="id-inline-notice">
            <p className="id-capacity-notice" role="status">
              {totalEvidence > 200
                ? "This investigation exceeds the 200-source review limit. The review shows a bounded selection; start another investigation to gather more."
                : "This review holds 200 sources. Start another investigation to gather more."}
            </p>
          </div>
        )}
        <div className="id-tray-items">
          {!selection.length ? (
            <div className="id-tray-empty">
              <Plus size={23} />
              <strong>Build the evidence set</strong>
              <p>
                Select a statement from the library. Include conflicting context
                as well as support.
              </p>
            </div>
          ) : (
            selection.map(({ evidence }) => (
              <article className="id-tray-item" key={evidence.id}>
                <div>
                  <span>
                    {evidence.attribution?.account
                      ? `@${evidence.attribution.account}`
                      : evidence.kind}
                  </span>
                  <button
                    aria-label={`Remove selected source: ${evidence.text.slice(0, 70) || "Capture gap"}`}
                    disabled={busy}
                    onClick={() =>
                      setSelection((old) =>
                        old.filter((item) => item.evidence.id !== evidence.id),
                      )
                    }
                  >
                    <X size={15} />
                  </button>
                </div>
                <p>{evidence.text || "Capture gap"}</p>
                {linked.has(evidence.id) && (
                  <small>Already linked to this investigation</small>
                )}
                <button
                  className="aw-text-button"
                  onClick={() =>
                    onOpenEvidence(evidence.sessionId, evidence.id)
                  }
                >
                  Open original
                  <ArrowUpRight size={12} />
                </button>
              </article>
            ))
          )}
        </div>
        <footer className="id-tray-footer">
          <Notice error={error} receipt={receipt} />
          <p className="id-review-capacity">
            {totalEvidence} of 200 sources linked · {remaining} spaces available
          </p>
          <div className="id-tray-capacity">
            <span>{selection.length} of 50 selected</span>
            {selection.length > 0 && (
              <button
                className="aw-text-button"
                disabled={busy}
                onClick={() => {
                  setSelection([]);
                  setError("");
                }}
              >
                Clear selection
              </button>
            )}
          </div>
          {selection.length >= 50 && (
            <p className="id-capacity-notice" role="status">
              Selection limit reached. Add this set, then gather more.
            </p>
          )}
          {selectionLimit < 50 && remaining > 0 && (
            <p className="id-capacity-notice" role="status">
              {remaining} more {remaining === 1 ? "source fits" : "sources fit"}{" "}
              in this review. {totalEvidence} of 200 linked.
            </p>
          )}
          {pending.length > remaining && (
            <p className="id-capacity-notice" role="status">
              The investigation changed. Remove {pending.length - remaining}{" "}
              selected sources to fit the remaining space.
            </p>
          )}
          <button
            className="aw-primary id-add-sources"
            disabled={
              busy || !canWrite || !pending.length || pending.length > remaining
            }
            onClick={add}
          >
            <Plus size={16} />
            {busy
              ? "Adding sources…"
              : `Add ${pending.length} ${pending.length === 1 ? "source" : "sources"} to investigation`}
          </button>
          <p>
            Sources keep their original text and provenance. Findings and
            interpretation come next.
          </p>
        </footer>
      </aside>
    </div>
  );
}

function SourceProvenance({
  evidence,
  onOpenEvidence,
}: {
  evidence: Evidence;
  onOpenEvidence: OpenEvidence;
}) {
  return (
    <div className="id-provenance">
      <dl>
        <div>
          <dt>Source time</dt>
          <dd>{stamp(evidence.sourceTimestampMs)}</dd>
        </div>
        <div>
          <dt>Collector time</dt>
          <dd>{stamp(evidence.capturedAtMs)}</dd>
        </div>
        <div>
          <dt>Receipt time</dt>
          <dd>{stamp(evidence.receivedAtMs)}</dd>
        </div>
        <div>
          <dt>Attribution</dt>
          <dd>{evidence.attribution?.status || "Unavailable"}</dd>
        </div>
        <div>
          <dt>Original ID</dt>
          <dd>{evidence.id}</dd>
        </div>
      </dl>
      <button
        className="aw-text-button"
        onClick={() => onOpenEvidence(evidence.sessionId, evidence.id)}
      >
        Open original context
        <ArrowUpRight size={14} />
      </button>
    </div>
  );
}
