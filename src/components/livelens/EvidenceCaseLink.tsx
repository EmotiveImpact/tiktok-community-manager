import { useEffect, useRef, useState, type FormEvent } from "react";
import { ArrowRight, Check, FolderOpen, Plus, Search, X } from "lucide-react";
import { api, type Case, type Evidence } from "../../lib/livelens/api";
import { friendlyError, useResource } from "./advanced/shared";
import "./evidence-case-link.css";

type WritableCase = Case & { canWrite?: boolean };
type CasePage = {
  cases: WritableCase[];
  hasMore: boolean;
  nextOffset: number | null;
};

/** A source-bound handoff: closing this component never silently changes sources. */
export default function EvidenceCaseLink({
  evidence,
  canCreate,
  onOpenCase,
  onSaved,
}: {
  evidence: Evidence;
  canCreate: boolean;
  onOpenCase: (id: string) => void;
  onSaved: () => void;
}) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button className="ll-primary" onClick={() => setOpen(true)}>
        <FolderOpen size={16} />
        Add to investigation
      </button>
      {open && (
        <CasePicker
          evidence={evidence}
          canCreate={canCreate}
          onClose={() => setOpen(false)}
          onOpenCase={onOpenCase}
          onSaved={onSaved}
        />
      )}
    </>
  );
}

function CasePicker({
  evidence,
  canCreate,
  onClose,
  onOpenCase,
  onSaved,
}: {
  evidence: Evidence;
  canCreate: boolean;
  onClose: () => void;
  onOpenCase: (id: string) => void;
  onSaved: () => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const alive = useRef(false);
  const [mode, setMode] = useState<"existing" | "new">("existing");
  const [query, setQuery] = useState("");
  const [search, setSearch] = useState("");
  const [offset, setOffset] = useState(0);
  const [selected, setSelected] = useState<WritableCase | null>(null);
  const [title, setTitle] = useState("");
  const [question, setQuestion] = useState("");
  const [busy, setBusy] = useState(false);
  const sending = useRef(false);
  const creationIntent = useRef<{
    id: string;
    title: string;
    question: string;
  } | null>(null);
  const [error, setError] = useState("");
  const [saved, setSaved] = useState<{
    id: string;
    title: string;
    duplicate: boolean;
  } | null>(null);
  const resource = useResource<CasePage>(
    mode === "existing" && !saved
      ? `/v1/cases?limit=20&offset=${offset}&q=${encodeURIComponent(search)}`
      : null,
  );
  const pending = query.trim() !== search;

  useEffect(() => {
    alive.current = true;
    dialog.current?.showModal();
    return () => {
      alive.current = false;
    };
  }, []);
  useEffect(() => {
    const timer = setTimeout(() => {
      setSearch(query.trim());
      setOffset(0);
    }, 250);
    return () => clearTimeout(timer);
  }, [query]);

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (sending.current || saved || (mode === "existing" && !selected)) return;
    sending.current = true;
    setBusy(true);
    setError("");
    try {
      let result: { id: string; title: string; duplicate: boolean };
      if (mode === "new") {
        // Keep the same explicit identity on retries, including a lost success
        // response. Reconcile against saved originals before showing success.
        const intent = creationIntent.current ?? {
          id: crypto.randomUUID(),
          title: title.trim(),
          question: question.trim(),
        };
        creationIntent.current = intent;
        let created: Case;
        try {
          created = await api<Case>("/v1/cases", {
            ...intent,
            evidenceIds: [evidence.id],
          });
        } catch (cause) {
          const recovered = await api<{ case: Case; evidence: Evidence[] }>(
            `/v1/cases/${encodeURIComponent(intent.id)}/report`,
          ).catch(() => null);
          if (
            !recovered ||
            recovered.case.id !== intent.id ||
            recovered.case.title !== intent.title ||
            recovered.case.question !== intent.question ||
            !recovered.evidence.some(
              (item) =>
                item.id === evidence.id &&
                item.sessionId === evidence.sessionId,
            )
          )
            throw cause;
          created = recovered.case;
        }
        result = { id: created.id, title: created.title, duplicate: false };
      } else {
        const receipt = await api<{ linked: number }>(
          `/v1/cases/${encodeURIComponent(selected!.id)}/evidence`,
          { evidenceIds: [evidence.id], forReview: true },
        );
        result = {
          id: selected!.id,
          title: selected!.title,
          duplicate: receipt.linked === 0,
        };
      }
      if (alive.current) {
        setSaved(result);
        onSaved();
      }
    } catch (cause) {
      if (alive.current)
        setError(
          cause instanceof Error &&
            /(?:investigation|review)_evidence_capacity/.test(cause.message)
            ? "This investigation has reached the 200-source review limit. Choose another investigation or create one."
            : friendlyError(cause),
        );
    } finally {
      sending.current = false;
      if (alive.current) setBusy(false);
    }
  }

  return (
    <dialog
      ref={dialog}
      className="ec-dialog"
      aria-labelledby="ec-title"
      onCancel={(event) => {
        event.preventDefault();
        if (!busy) onClose();
      }}
    >
      <div className="ec-heading">
        <div>
          <span className="ec-eyebrow">KEEP THE ORIGINAL CLOSE</span>
          <h2 id="ec-title">Add evidence to investigation</h2>
        </div>
        <button
          type="button"
          onClick={onClose}
          disabled={busy}
          aria-label="Close investigation picker"
        >
          <X size={20} />
        </button>
      </div>
      <div className="ec-original">
        <span>
          {evidence.kind} ·{" "}
          {evidence.attribution.account
            ? `@${evidence.attribution.account}`
            : "Unknown account"}
        </span>
        <blockquote>{evidence.text || "No captured text"}</blockquote>
        <small>The original statement and its source stay linked.</small>
      </div>
      {saved ? (
        <div className="ec-saved" role="status">
          <Check size={24} />
          <h3>
            {saved.duplicate
              ? "Already in this investigation"
              : "Evidence added"}
          </h3>
          <p>{saved.title}</p>
          <button
            className="ec-primary"
            onClick={() => {
              onClose();
              onOpenCase(saved.id);
            }}
          >
            Open investigation
            <ArrowRight size={16} />
          </button>
          <button onClick={onClose}>Keep reviewing this conversation</button>
        </div>
      ) : (
        <form onSubmit={submit}>
          <div className="ec-tabs" aria-label="Investigation destination">
            <button
              type="button"
              aria-pressed={mode === "existing"}
              disabled={busy || !!creationIntent.current}
              onClick={() => {
                setMode("existing");
                setError("");
              }}
            >
              Existing investigation
            </button>
            <button
              type="button"
              aria-pressed={mode === "new"}
              disabled={busy || !canCreate}
              title={
                !canCreate
                  ? "Your access does not allow creating investigations"
                  : undefined
              }
              onClick={() => {
                setMode("new");
                setError("");
              }}
            >
              <Plus size={14} />
              New investigation
            </button>
          </div>
          {mode === "existing" ? (
            <>
              <label className="ec-search">
                Find an investigation
                <div>
                  <Search size={16} />
                  <input
                    autoFocus
                    value={query}
                    maxLength={512}
                    disabled={busy}
                    onChange={(event) => {
                      setQuery(event.target.value);
                      setOffset(0);
                    }}
                    placeholder="Search names or questions"
                  />
                </div>
              </label>
              {resource.error && (
                <p role="alert" className="ec-error">
                  {resource.error}
                  <button type="button" onClick={resource.reload}>
                    Try again
                  </button>
                </p>
              )}
              <div
                className="ec-cases"
                role="group"
                aria-label="Accessible investigations"
                aria-busy={pending || resource.loading}
              >
                {pending || resource.loading ? (
                  <p className="ec-help">Finding investigations…</p>
                ) : !resource.data?.cases.length ? (
                  <p className="ec-help">
                    {query.trim()
                      ? "No matching investigations. Try another search or create one."
                      : "No investigations yet. Create one around this statement."}
                  </p>
                ) : (
                  resource.data.cases.map((item) => (
                    <label
                      className={`ec-case ${selected?.id === item.id ? "is-selected" : ""}`}
                      key={item.id}
                    >
                      <input
                        type="radio"
                        name="case-destination"
                        value={item.id}
                        checked={selected?.id === item.id}
                        disabled={busy || item.canWrite === false}
                        onChange={() => setSelected(item)}
                      />
                      <span>
                        <strong>{item.title}</strong>
                        <small>{item.question}</small>
                        {item.canWrite === false && (
                          <small>Read access only</small>
                        )}
                      </span>
                    </label>
                  ))
                )}
              </div>
              <div className="ec-pagination">
                <button
                  type="button"
                  disabled={busy || pending || resource.loading || offset === 0}
                  onClick={() => setOffset(Math.max(0, offset - 20))}
                >
                  Previous
                </button>
                <span>Page {Math.floor(offset / 20) + 1}</span>
                <button
                  type="button"
                  disabled={
                    busy ||
                    pending ||
                    resource.loading ||
                    !resource.data?.hasMore
                  }
                  onClick={() => setOffset(resource.data?.nextOffset ?? offset)}
                >
                  Next
                </button>
              </div>
              {selected && (
                <p className="ec-chosen">
                  Selected: <strong>{selected.title}</strong>
                  <button
                    type="button"
                    disabled={busy}
                    aria-label="Clear selected investigation"
                    onClick={() => setSelected(null)}
                  >
                    <X size={14} />
                  </button>
                </p>
              )}
            </>
          ) : (
            <div className="ec-create">
              <label>
                Investigation name
                <input
                  required
                  maxLength={200}
                  value={title}
                  disabled={busy || !!creationIntent.current}
                  onChange={(event) => setTitle(event.target.value)}
                  placeholder="Give the investigation a clear name"
                />
              </label>
              <label>
                Question
                <textarea
                  required
                  rows={3}
                  maxLength={2048}
                  value={question}
                  disabled={busy || !!creationIntent.current}
                  onChange={(event) => setQuestion(event.target.value)}
                  placeholder="What should the captured evidence establish or challenge?"
                />
              </label>
              <p className="ec-help">
                Creates the investigation with this original statement as its
                first source.
              </p>
            </div>
          )}
          {error && (
            <p role="alert" className="ec-error">
              {error}
            </p>
          )}
          {error && creationIntent.current && (
            <p className="ec-help">
              The original question is kept for a safe retry. Retrying checks
              the same investigation and cannot create a second copy.
            </p>
          )}
          <div className="ec-footer">
            <span>1 original statement</span>
            <button
              className="ec-primary"
              disabled={
                busy ||
                (mode === "existing"
                  ? !selected
                  : !title.trim() || !question.trim())
              }
            >
              {busy
                ? "Saving…"
                : mode === "new"
                  ? "Create with evidence"
                  : "Add evidence"}
              <ArrowRight size={16} />
            </button>
          </div>
        </form>
      )}
    </dialog>
  );
}
