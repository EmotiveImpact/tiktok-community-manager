import {
  useEffect,
  useRef,
  useState,
  type FormEvent,
  type ReactNode,
} from "react";
import {
  Activity,
  Archive,
  ArrowLeft,
  ArrowUpRight,
  Check,
  ChevronRight,
  FileText,
  FolderOpen,
  LogOut,
  Menu,
  Search,
  Settings,
  ShieldCheck,
  Users,
  Video,
} from "lucide-react";
import {
  api,
  exportText,
  setIdentity,
  type Case,
  type Evidence,
  type Identity,
  type Report,
  type Session,
} from "../lib/livelens/api";
import "./livelens.css";

type View =
  | "overview"
  | "sources"
  | "sessions"
  | "search"
  | "cases"
  | "settings";
const nav = [
  ["overview", "Overview", Activity],
  ["sources", "Sources & captures", Video],
  ["sessions", "Session library", Archive],
  ["search", "Observed accounts", Users],
  ["cases", "Cases & reports", FolderOpen],
  ["settings", "Workspace settings", Settings],
] as const;
const stamp = (ms: number | null) =>
  ms === null ? "Unavailable" : new Date(ms).toLocaleString();
const message = (e: unknown) =>
  e instanceof Error ? e.message.replaceAll("_", " ") : "Service unavailable";
function Empty({ title, children }: { title: string; children?: ReactNode }) {
  return (
    <div className="ll-empty">
      <Archive size={28} aria-hidden />
      <h3>{title}</h3>
      <p>{children}</p>
    </div>
  );
}
function useResource<T>(path: string | null, revision = 0) {
  const [state, setState] = useState<{
    data: T | null;
    loading: boolean;
    error: string;
  }>({ data: null, loading: !!path, error: "" });
  useEffect(() => {
    let active = true;
    setState({ data: null, loading: !!path, error: "" });
    if (path)
      api<T>(path)
        .then((data) => active && setState({ data, loading: false, error: "" }))
        .catch(
          (e) =>
            active &&
            setState({ data: null, loading: false, error: message(e) }),
        );
    return () => {
      active = false;
    };
  }, [path, revision]);
  return state;
}
function Status({ loading, error }: { loading: boolean; error: string }) {
  return (
    <>
      {loading && (
        <p role="status" className="ll-status">
          Loading retained records…
        </p>
      )}
      {error && (
        <p role="alert" className="ll-error">
          {error}. Check the connection or sign in again.
        </p>
      )}
    </>
  );
}

export function LiveLensConsole() {
  const [identity, updateIdentity] = useState<Identity | null>(null),
    [checking, setChecking] = useState(true),
    [error, setError] = useState("");
  const [view, setView] = useState<View>(
    () =>
      (new URLSearchParams(location.search).get("view") as View) || "overview",
  );
  const [sessionId, setSessionId] = useState<string | null>(
    new URLSearchParams(location.search).get("session"),
  );
  const [evidenceId, setEvidenceId] = useState<string | null>(
    new URLSearchParams(location.search).get("evidence"),
  );
  const [caseId, setCaseId] = useState<string | null>(null),
    [menu, setMenu] = useState(false),
    [revision, setRevision] = useState(0);
  const [query, setQuery] = useState(""),
    [account, setAccount] = useState(""),
    [searchPath, setSearchPath] = useState("/v1/evidence/search?limit=100");
  const [notice, setNotice] = useState(""),
    [busy, setBusy] = useState(false);
  const main = useRef<HTMLElement>(null);
  const signedIn = (value: Identity | null) => {
    setIdentity(value);
    updateIdentity(value);
  };
  useEffect(() => {
    api<Identity>("/console/session")
      .then(signedIn)
      .catch(() => {})
      .finally(() => setChecking(false));
  }, []);
  const [libraryOffset, setLibraryOffset] = useState(0);
  const overview = useResource<{
    sessions: number;
    cases: number;
    evidence: number;
    gaps: number;
  }>(identity ? "/v1/overview" : null, revision);
  const sources = useResource<{
    sources: { id: string; sessionId: string; kind: string; label: string }[];
    worker: { mode: string; error: string | null } | null;
  }>(identity ? "/v1/sources" : null, revision);
  const jobs = useResource<{
    jobs: {
      id: string;
      sessionId: string;
      state: string;
      attempts: number;
      error: string | null;
      segments: unknown[];
    }[];
  }>(identity && view === "sources" ? "/v1/jobs" : null, revision);
  const sessions = useResource<{ sessions: Session[] }>(
    identity ? `/v1/sessions?limit=200&offset=${libraryOffset}` : null,
    revision,
  );
  const cases = useResource<{ cases: Case[] }>(
    identity ? "/v1/cases?limit=200" : null,
    revision,
  );
  const search = useResource<{ evidence: Evidence[] }>(
    identity && view === "search" ? searchPath : null,
    revision,
  );
  const session = useResource<Session>(
    identity && sessionId ? `/v1/sessions/${sessionId}` : null,
  );
  const [cursor, setCursor] = useState(0);
  const events = useResource<{ events: Evidence[]; nextAfter: number | null }>(
    identity && sessionId
      ? `/v1/sessions/${sessionId}/events?limit=100&after=${cursor}`
      : null,
    revision,
  );
  const context = useResource<{
    event: Evidence;
    session: Session;
    before: Evidence[];
    after: Evidence[];
  }>(identity && evidenceId ? `/v1/evidence/${evidenceId}/context` : null);
  const report = useResource<Report>(
    identity && caseId ? `/v1/cases/${caseId}/report` : null,
    revision,
  );
  const capabilities = useResource<{
    enabled: string[];
    planned: string[];
    scopes: string[];
  }>(identity ? "/v1/capabilities" : null);
  function go(next: View) {
    setView(next);
    setLibraryOffset(0);
    setSessionId(null);
    setEvidenceId(null);
    setCaseId(null);
    setMenu(false);
    setNotice("");
    history.replaceState(null, "", `?view=${next}`);
    main.current?.focus();
  }
  function openSession(id: string) {
    setSessionId(id);
    setEvidenceId(null);
    setCursor(0);
    setView("sessions");
    history.replaceState(null, "", `?view=sessions&session=${id}`);
  }
  function openEvidence(e: Evidence) {
    setEvidenceId(e.id);
    setSessionId(e.sessionId);
    setView("sessions");
    history.replaceState(
      null,
      "",
      `?view=sessions&session=${e.sessionId}&evidence=${e.id}`,
    );
  }
  async function mutate(operation: () => Promise<unknown>, success: string) {
    setBusy(true);
    setNotice("");
    try {
      await operation();
      setRevision((r) => r + 1);
      setNotice(success);
    } catch (e) {
      setNotice(message(e));
    } finally {
      setBusy(false);
    }
  }
  async function login(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const data = new FormData(e.currentTarget);
    setBusy(true);
    setError("");
    try {
      signedIn(
        await api<Identity>("/console/login", {
          username: data.get("username"),
          password: data.get("password"),
        }),
      );
    } catch (e) {
      setError(message(e));
    } finally {
      setBusy(false);
    }
  }
  if (!identity)
    return (
      <div className="ll-app ll-login">
        <div className="ll-login-card">
          <div className="ll-brand">
            <span className="ll-mark">L</span>LiveLens
          </div>
          <p className="ll-eyebrow">PRIVATE OPERATOR WORKSPACE</p>
          <h1>
            Keep the conversation.
            <br />
            Find the context.
          </h1>
          <p>
            Reopen captured evidence, investigate with context and build a
            source-linked report.
          </p>
          {checking ? (
            <p role="status">Checking your session…</p>
          ) : location.protocol === "file:" ? (
            <>
              <p>
                Open the authenticated browser console configured by your
                operator.
              </p>
              <button className="ll-primary" disabled={!window.tiktok?.livelensOpenConsole} onClick={async () => {
                const result = await window.tiktok.livelensOpenConsole?.();
                if (!result?.ok) setError(result?.error ?? 'Desktop console access unavailable');
              }}>Open browser console</button>
              {error && <p role="alert" className="ll-error">{error}</p>}
              <a className="ll-button" href="?page=dashboard">
                Open desktop community manager
              </a>
            </>
          ) : (
            <form onSubmit={login}>
              <label>
                Operator name
                <input
                  name="username"
                  autoComplete="username"
                  required
                  maxLength={96}
                />
              </label>
              <label>
                Password
                <input
                  name="password"
                  type="password"
                  autoComplete="current-password"
                  required
                  maxLength={256}
                />
              </label>
              <button className="ll-primary" disabled={busy}>
                {busy ? "Signing in…" : "Open workspace"}
                <ArrowUpRight size={16} />
              </button>
              {error && (
                <p role="alert" className="ll-error">
                  {error}. Check operator access and service configuration.
                </p>
              )}
            </form>
          )}
          <p className="ll-muted">
            Selected captures only. Unknown speakers stay unknown.
          </p>
        </div>
      </div>
    );
  const title = sessionId
    ? "Conversation"
    : (nav.find((n) => n[0] === view)?.[1] ?? "Overview");
  const evidenceList = (items: Evidence[]) => (
    <div className="ll-evidence-list">
      {items.map((e) => (
        <button
          className={`ll-evidence ${e.id === evidenceId ? "selected" : ""}`}
          key={e.id}
          onClick={() => openEvidence(e)}
        >
          <span className="ll-evidence-time">
            {stamp(e.sourceTimestampMs ?? e.capturedAtMs ?? e.receivedAtMs)}
            <small>
              {e.sourceTimestampMs === null
                ? "Capture / receipt clock"
                : "Source clock"}
            </small>
          </span>
          <span>
            <span className={`ll-tag ${e.kind === "gap" ? "ll-gap" : ""}`}>
              {e.kind}
            </span>
            <strong>
              {e.attribution.account
                ? `@${e.attribution.account}`
                : "Unknown speaker/account"}
            </strong>
            <p>{e.text || "(No text)"}</p>
            <small>
              {e.attribution.status} · {e.source.adapter}
            </small>
          </span>
          <ChevronRight size={16} aria-hidden />
        </button>
      ))}
    </div>
  );
  return (
    <div className="ll-app">
      <a className="ll-skip" href="#ll-main">
        Skip to content
      </a>
      <aside className={`ll-sidebar ${menu ? "open" : ""}`}>
        <div className="ll-brand">
          <span className="ll-mark">L</span>LiveLens
          <span className="ll-pilot">PILOT</span>
        </div>
        <div className="ll-workspace">
          <ShieldCheck size={16} />
          <div>
            <strong>{identity.workspace}</strong>
            <small>Private operator workspace</small>
          </div>
        </div>
        <p className="ll-eyebrow">INTELLIGENCE</p>
        <nav aria-label="LiveLens navigation">
          {nav.map(([id, label, Icon]) => (
            <button
              key={id}
              aria-current={view === id ? "page" : undefined}
              onClick={() => go(id)}
            >
              <Icon size={18} />
              {label}
            </button>
          ))}
        </nav>
        <div className="ll-nav-bottom">
          <a href="?page=dashboard">
            <Users size={18} />
            Community & CRM
            <ArrowUpRight size={14} />
          </a>
          <p>Evidence before interpretation.</p>
          <button
            onClick={() =>
              mutate(async () => {
                await api("/console/logout", {});
                signedIn(null);
              }, "Signed out")
            }
          >
            <LogOut size={16} />
            Sign out · {identity.subject}
          </button>
        </div>
      </aside>
      <div className="ll-work">
        <header className="ll-top">
          <button
            className="ll-mobile-menu"
            aria-label="Toggle navigation"
            aria-expanded={menu}
            onClick={() => setMenu(!menu)}
          >
            <Menu size={20} />
          </button>
          <span>
            WORKSPACE <ChevronRight size={13} /> {title}
          </span>
          <span className="ll-connected">
            <span />
            Authenticated
          </span>
        </header>
        <main id="ll-main" tabIndex={-1} ref={main}>
          <div className="ll-heading">
            <div>
              <p className="ll-eyebrow">
                {sessionId ? "RETAINED SOURCE" : "LIVELENS / OPERATIONS"}
              </p>
              <h1>{session.data?.title ?? title}</h1>
              <p>
                {view === "overview"
                  ? "The records you have. The context you can return to."
                  : view === "search"
                    ? "Search captured statements and observed account activity."
                    : view === "cases"
                      ? "A question, its sources and a report you can reopen."
                      : view === "settings"
                        ? "Your connection, access and available capabilities."
                        : "Original evidence, with capture boundaries kept visible."}
              </p>
            </div>
            <button onClick={() => setRevision((r) => r + 1)} disabled={busy}>
              Refresh records
            </button>
          </div>
          {notice && (
            <p role="status" className="ll-notice">
              {notice}
            </p>
          )}
          {view === "overview" && (
            <>
              <Status
                loading={sessions.loading || cases.loading}
                error={sessions.error || cases.error}
              />
              <div className="ll-stats">
                <button onClick={() => go("sessions")}>
                  <span>Retained sessions</span>
                  <strong>{overview.data?.sessions ?? "—"}</strong>
                  <small>
                    Open session library <ArrowUpRight size={14} />
                  </small>
                </button>
                <button onClick={() => go("cases")}>
                  <span>Investigations</span>
                  <strong>{overview.data?.cases ?? "—"}</strong>
                  <small>
                    Review cases & reports <ArrowUpRight size={14} />
                  </small>
                </button>
                <div>
                  <span>Independent speech</span>
                  <strong className="ll-stat-word">Planned</strong>
                  <small>Captions are labelled separately</small>
                </div>
              </div>
              <div className="ll-section-head">
                <h2>Recent conversations</h2>
                <button onClick={() => go("sessions")}>
                  View library <ArrowUpRight size={14} />
                </button>
              </div>
              <SessionList
                sessions={sessions.data?.sessions.slice(0, 6) ?? []}
                open={openSession}
              />
              <div className="ll-callout">
                <ShieldCheck size={22} />
                <div>
                  <h3>Start with what was captured</h3>
                  <p>
                    Search a statement, inspect its surrounding conversation and
                    link the original evidence to a case. Capture gaps and
                    operator assertions remain visible.
                  </p>
                </div>
                <button onClick={() => go("search")}>Search evidence</button>
              </div>
            </>
          )}
          {view === "sources" && (
            <>
              <Status
                loading={sources.loading || jobs.loading}
                error={sources.error || jobs.error}
              />
              <div className="ll-settings-grid">
                <section className="ll-form-card">
                  <h2>Selected sources</h2>
                  <p>
                    Sources are configured by the service operator and bound to
                    one workspace and session. No automatic watching is enabled.
                  </p>
                  {sources.data?.sources.map((source) => (
                    <form
                      key={source.id}
                      onSubmit={(e) => {
                        e.preventDefault();
                        const seconds = Number(
                          new FormData(e.currentTarget).get("seconds"),
                        );
                        mutate(
                          () =>
                            api("/v1/jobs", {
                              sessionId: source.sessionId,
                              sourceId: source.id,
                              maxDurationSeconds: seconds,
                              segmentSeconds: 2,
                            }),
                          "Capture queued. Recording is confirmed only after media is written.",
                        );
                      }}
                    >
                      <h3>{source.label}</h3>
                      <small>
                        {source.kind === "file"
                          ? "Fixture file · synthetic capture"
                          : "Operator-selected HTTPS media"}
                      </small>
                      <label>
                        Maximum capture seconds
                        <input
                          type="number"
                          name="seconds"
                          min="2"
                          max="3600"
                          defaultValue="16"
                          required
                        />
                      </label>
                      <button className="ll-primary" disabled={busy}>
                        Start bounded capture
                      </button>
                      <button
                        type="button"
                        onClick={() => openSession(source.sessionId)}
                      >
                        Open conversation
                      </button>
                    </form>
                  ))}
                  {!sources.loading && !sources.data?.sources.length && (
                    <Empty title="No sources configured">
                      Ask the service operator to configure a permitted media
                      source. The browser cannot supply arbitrary URLs or paths.
                    </Empty>
                  )}
                </section>
                <section className="ll-form-card">
                  <h2>Capture receipts</h2>
                  <button onClick={() => setRevision((r) => r + 1)}>
                    Refresh capture state
                  </button>
                  {jobs.data?.jobs.map((job) => (
                    <div className="ll-job" key={job.id}>
                      <span className="ll-tag">{job.state}</span>
                      <p>
                        {job.segments.length} verified segments · attempt{" "}
                        {job.attempts}/3
                      </p>
                      {job.error && (
                        <p role="status">{job.error.replaceAll("_", " ")}</p>
                      )}
                      <button onClick={() => openSession(job.sessionId)}>
                        Replay conversation
                      </button>
                      {!["completed", "stopped", "failed"].includes(
                        job.state,
                      ) && (
                        <button
                          disabled={busy}
                          onClick={() =>
                            mutate(
                              () => api(`/v1/jobs/${job.id}/stop`, {}),
                              "Stop requested; finalised media remains available.",
                            )
                          }
                        >
                          Stop capture
                        </button>
                      )}
                    </div>
                  ))}
                  {!jobs.loading && !jobs.data?.jobs.length && (
                    <Empty title="No capture jobs">
                      Start a bounded capture from a configured source. Pending
                      and failed jobs remain visible.
                    </Empty>
                  )}
                  <p className="ll-muted">
                    One recorder worker. Interrupted tails are quarantined and
                    capture gaps are retained. This is not a capacity benchmark.
                  </p>
                </section>
              </div>
            </>
          )}
          {view === "sessions" && !sessionId && (
            <>
              {libraryOffset > 0 && (
                <button
                  onClick={() => setLibraryOffset((n) => Math.max(0, n - 200))}
                >
                  Previous sessions
                </button>
              )}
              <Status {...sessions} />
              <SessionList
                sessions={sessions.data?.sessions ?? []}
                open={openSession}
              />
              {sessions.data?.sessions.length === 200 && (
                <button onClick={() => setLibraryOffset((n) => n + 200)}>
                  Next 200 sessions
                </button>
              )}
            </>
          )}
          {view === "sessions" && sessionId && (
            <>
              <button className="ll-back" onClick={() => go("sessions")}>
                <ArrowLeft size={16} />
                Session library
              </button>
              <Status
                loading={session.loading || events.loading}
                error={session.error || events.error}
              />
              {session.data && (
                <div className="ll-source">
                  <span className="ll-tag">{session.data.platform}</span>
                  <span>
                    {session.data.account
                      ? `@${session.data.account}`
                      : "Account unavailable"}
                  </span>
                  <span>{stamp(session.data.startedAtMs)}</span>
                  <a
                    href={session.data.sourceUrl}
                    target="_blank"
                    rel="noreferrer"
                  >
                    Original source <ArrowUpRight size={14} />
                  </a>
                </div>
              )}
              <div className="ll-conversation">
                <div>
                  <MediaReplay
                    sessionId={sessionId}
                    evidence={context.data?.event}
                    revision={revision}
                  />
                  <div className="ll-section-head">
                    <h2>Captured timeline</h2>
                    <small>Original clocks preserved</small>
                  </div>
                  {events.data?.events.length
                    ? evidenceList(events.data.events)
                    : !events.loading && (
                        <Empty title="No captured evidence yet">
                          Archive a selected desktop session or capture events
                          with the scoped API.
                        </Empty>
                      )}
                  {events.data?.events.length === 100 && (
                    <button onClick={() => setCursor(events.data!.nextAfter!)}>
                      Next 100 events
                    </button>
                  )}
                  {cursor > 0 && (
                    <button onClick={() => setCursor(0)}>
                      Return to first events
                    </button>
                  )}
                </div>
                <aside className="ll-context">
                  <h2>Evidence & context</h2>
                  {evidenceId ? (
                    <>
                      <Status {...context} />
                      {context.data && (
                        <>
                          <span className="ll-tag">
                            {context.data.event.kind}
                          </span>
                          <blockquote>{context.data.event.text}</blockquote>
                          <dl>
                            <dt>Source time</dt>
                            <dd>
                              {stamp(context.data.event.sourceTimestampMs)}
                            </dd>
                            <dt>Collector time</dt>
                            <dd>{stamp(context.data.event.capturedAtMs)}</dd>
                            <dt>Received</dt>
                            <dd>{stamp(context.data.event.receivedAtMs)}</dd>
                            <dt>Attribution</dt>
                            <dd>{context.data.event.attribution.status}</dd>
                            <dt>Evidence ID</dt>
                            <dd className="ll-id">{context.data.event.id}</dd>
                          </dl>
                          <form
                            onSubmit={(e) => {
                              e.preventDefault();
                              const id = new FormData(e.currentTarget).get(
                                "case",
                              );
                              if (id)
                                mutate(
                                  () =>
                                    api(`/v1/cases/${id}/evidence`, {
                                      evidenceIds: [evidenceId],
                                    }),
                                  "Original evidence linked to case.",
                                );
                            }}
                          >
                            <label>
                              Link to investigation
                              <select name="case" required>
                                <option value="">Choose a case</option>
                                {cases.data?.cases.map((c) => (
                                  <option value={c.id} key={c.id}>
                                    {c.title}
                                  </option>
                                ))}
                              </select>
                            </label>
                            <button
                              className="ll-primary"
                              disabled={busy || !cases.data?.cases.length}
                            >
                              <FolderOpen size={16} />
                              Link evidence
                            </button>
                          </form>
                          <button onClick={() => go("cases")}>
                            Create an investigation
                          </button>
                          <h3>Surrounding conversation</h3>
                          <p className="ll-muted">
                            Nearby events show timing, not causation.
                          </p>
                          {evidenceList([
                            ...context.data.before,
                            ...context.data.after,
                          ])}
                        </>
                      )}
                    </>
                  ) : (
                    <Empty title="Select an evidence row">
                      Inspect its original clocks and nearby events, then link
                      it to an investigation.
                    </Empty>
                  )}
                </aside>
              </div>
            </>
          )}
          {view === "search" && (
            <>
              <form
                className="ll-search"
                onSubmit={(e) => {
                  e.preventDefault();
                  setSearchPath(
                    "/v1/evidence/search?" +
                      new URLSearchParams({
                        q: query,
                        ...(account.trim()
                          ? { account: account.trim().replace(/^@/, "") }
                          : {}),
                        limit: "200",
                      }).toString(),
                  );
                }}
              >
                <label>
                  Statement or phrase
                  <div>
                    <Search size={17} />
                    <input
                      placeholder="Search captured words…"
                      value={query}
                      onChange={(e) => setQuery(e.target.value)}
                      maxLength={512}
                    />
                  </div>
                </label>
                <label>
                  Observed account
                  <input
                    placeholder="@account (optional)"
                    value={account}
                    onChange={(e) => setAccount(e.target.value)}
                    maxLength={64}
                  />
                </label>
                <button className="ll-primary">Search captures</button>
              </form>
              <p className="ll-muted">
                Observed activity across retained sessions. Account handles are
                not verified identities; this is not universal guest tracking.
              </p>
              <Status {...search} />
              {search.data?.evidence.length
                ? evidenceList(search.data.evidence)
                : !search.loading && (
                    <Empty title="No matching evidence">
                      Try a captured phrase or account. Only your workspace’s
                      retained events are searched.
                    </Empty>
                  )}
            </>
          )}
          {view === "cases" && (
            <>
              <div className="ll-case-layout">
                <section>
                  <h2>Investigations</h2>
                  <Status {...cases} />
                  {cases.data?.cases.map((c) => (
                    <button
                      className="ll-case-row"
                      key={c.id}
                      onClick={() => setCaseId(c.id)}
                    >
                      <FolderOpen size={18} />
                      <span>
                        <strong>{c.title}</strong>
                        <small>{c.question}</small>
                      </span>
                      <ChevronRight size={16} />
                    </button>
                  ))}
                  <form
                    className="ll-form-card"
                    onSubmit={(e) => {
                      e.preventDefault();
                      const form = e.currentTarget,
                        data = new FormData(form);
                      mutate(async () => {
                        const c = await api<Case>("/v1/cases", {
                          title: data.get("title"),
                          question: data.get("question"),
                        });
                        setCaseId(c.id);
                        form.reset();
                      }, "Investigation created.");
                    }}
                  >
                    <h3>New investigation</h3>
                    <label>
                      Case title
                      <input
                        name="title"
                        required
                        maxLength={256}
                        placeholder="A clear subject"
                      />
                    </label>
                    <label>
                      Question to investigate
                      <textarea
                        name="question"
                        required
                        maxLength={2048}
                        placeholder="What does the captured evidence show?"
                      />
                    </label>
                    <button className="ll-primary" disabled={busy}>
                      Create case
                    </button>
                  </form>
                </section>
                <section className="ll-report">
                  <h2>Report preview</h2>
                  <Status {...report} />
                  {report.data ? (
                    <>
                      <p className="ll-eyebrow">
                        CAPTURED EVIDENCE / OPERATOR REVIEW REQUIRED
                      </p>
                      <h3>{report.data.case.title}</h3>
                      <p>{report.data.case.question}</p>
                      <div className="ll-report-actions">
                        <button
                          onClick={() =>
                            exportText(
                              JSON.stringify(report.data, null, 2),
                              `livelens-${caseId}.json`,
                            )
                          }
                        >
                          <FileText size={16} />
                          Export JSON
                        </button>
                        <button
                          onClick={() =>
                            mutate(async () => {
                              const r = await fetch(
                                `/v1/cases/${caseId}/report?format=markdown`,
                                { credentials: "same-origin" },
                              );
                              if (!r.ok)
                                throw new Error("Report export failed");
                              exportText(
                                await r.text(),
                                `livelens-${caseId}.md`,
                                "text/markdown",
                              );
                            }, "Report exported.")
                          }
                        >
                          <FileText size={16} />
                          Export Markdown
                        </button>
                      </div>
                      {report.data.evidence.length ? (
                        evidenceList(report.data.evidence)
                      ) : (
                        <Empty title="Build a source-backed report">
                          Open a captured session and link selected evidence to
                          this case.
                        </Empty>
                      )}
                      <h3>Scope & limitations</h3>
                      <ul>
                        {report.data.limitations.map((l) => (
                          <li key={l}>{l}</li>
                        ))}
                      </ul>
                      <small className="ll-id">
                        Report SHA-256: {report.data.reportSha256}
                      </small>
                    </>
                  ) : (
                    !report.loading && (
                      <Empty title="Select a case">
                        Preview original quotations, reopen their context and
                        export a source-linked report.
                      </Empty>
                    )
                  )}
                </section>
              </div>
            </>
          )}
          {view === "settings" && (
            <>
              <div className="ll-settings-grid">
                <section className="ll-form-card">
                  <h2>Workspace connection</h2>
                  <dl>
                    <dt>Service</dt>
                    <dd>{location.origin}</dd>
                    <dt>Workspace</dt>
                    <dd>{identity.workspace}</dd>
                    <dt>Operator</dt>
                    <dd>{identity.subject}</dd>
                    <dt>Authentication</dt>
                    <dd>Scoped browser session</dd>
                  </dl>
                  <p>
                    Operator access is configured on the service. API
                    credentials stay outside the browser.
                  </p>
                  <Status {...capabilities} />
                  <h3>Available capabilities</h3>
                  {capabilities.data?.enabled.map((c) => (
                    <p key={c}>
                      <Check size={15} />
                      {c.replaceAll("-", " ")}
                    </p>
                  ))}
                </section>
                <section className="ll-form-card">
                  <h2>Next capabilities</h2>
                  {capabilities.data?.planned.map((c) => (
                    <p key={c}>
                      <span className="ll-tag">Planned</span>
                      {c.replaceAll("-", " ")}
                    </p>
                  ))}
                  <h3>ALFRED</h3>
                  <p>
                    Scoped JavaScript and Python clients are available.
                    Registered ALFRED tools are planned.
                  </p>
                  <h3>Private pilot</h3>
                  <p>
                    Customer roles, billing, retention controls and measured
                    commercial capacity belong to later milestones.
                  </p>
                </section>
              </div>
            </>
          )}
        </main>
        <footer className="ll-footer">
          LiveLens · Retained evidence, explicit uncertainty{" "}
          <span>Private operator pilot</span>
        </footer>
      </div>
    </div>
  );
}

function SessionList({
  sessions,
  open,
}: {
  sessions: Session[];
  open: (id: string) => void;
}) {
  return sessions.length ? (
    <div className="ll-sessions">
      {sessions.map((s) => (
        <button key={s.id} onClick={() => open(s.id)}>
          <span className="ll-session-icon">
            <Video size={19} />
          </span>
          <span>
            <strong>{s.title}</strong>
            <small>
              {s.platform} ·{" "}
              {s.account ? "@" + s.account : "No account supplied"}
            </small>
          </span>
          <span className="ll-session-date">{stamp(s.startedAtMs)}</span>
          <ChevronRight size={17} />
        </button>
      ))}
    </div>
  ) : (
    <Empty title="Your captured conversations belong here">
      Archive a desktop session or start a bounded recording through the
      service. No live activity is invented.
    </Empty>
  );
}

// Stage B fills this view from authenticated media/job receipts.
function MediaReplay({
  sessionId,
  evidence,
  revision,
}: {
  sessionId: string;
  evidence?: Evidence;
  revision: number;
}) {
  const resource = useResource<{
    jobs: {
      id: string;
      state: string;
      segments: {
        id: string;
        durationMs: number;
        startedAtMs: number;
        sha256: string;
      }[];
    }[];
  }>(`/v1/sessions/${sessionId}/media`, revision);
  const [selected, setSelected] = useState<string | null>(null),
    [playbackError, setPlaybackError] = useState("");
  const video = useRef<HTMLVideoElement>(null);
  const segments =
    resource.data?.jobs.flatMap((j) =>
      j.segments.map((s) => ({ ...s, jobId: j.id })),
    ) ?? [];
  const current = segments.find((s) => s.id === selected) ?? segments[0];
  useEffect(() => {
    if (!evidence) return;
    const t =
      evidence.capturedAtMs ??
      evidence.sourceTimestampMs ??
      evidence.receivedAtMs;
    const s = segments.find(
      (s) => t >= s.startedAtMs && t < s.startedAtMs + s.durationMs,
    );
    if (s) {
      setSelected(s.id);
      if (video.current) video.current.currentTime = (t - s.startedAtMs) / 1000;
    }
  }, [evidence?.id, resource.data]);
  const evidenceTime =
    evidence?.capturedAtMs ??
    evidence?.sourceTimestampMs ??
    evidence?.receivedAtMs;
  const covered =
    evidenceTime == null ||
    segments.some(
      (s) =>
        evidenceTime >= s.startedAtMs &&
        evidenceTime < s.startedAtMs + s.durationMs,
    );
  return (
    <section className="ll-media">
      <div className="ll-section-head">
        <h2>
          <Video size={17} />
          Retained media
        </h2>
        <span className="ll-tag">
          {resource.data?.jobs[0]?.state ?? "Unavailable"}
        </span>
      </div>
      {current ? (
        <>
          <video
            ref={video}
            controls
            preload="metadata"
            src={`/v1/media/${current.jobId}/${current.id}`}
            onError={() =>
              setPlaybackError(
                "Retained segment could not be played. Check media integrity and availability.",
              )
            }
            onLoadedMetadata={() => {
              setPlaybackError("");
              const t =
                evidence?.capturedAtMs ??
                evidence?.sourceTimestampMs ??
                evidence?.receivedAtMs;
              if (
                t != null &&
                video.current &&
                t >= current.startedAtMs &&
                t < current.startedAtMs + current.durationMs
              )
                video.current.currentTime = (t - current.startedAtMs) / 1000;
            }}
            aria-label="Captured conversation video"
          />
          <label>
            Media segment
            <select
              value={current.id}
              onChange={(e) => setSelected(e.target.value)}
            >
              {segments.map((s) => (
                <option key={s.id} value={s.id}>
                  {stamp(s.startedAtMs)} · {(s.durationMs / 1000).toFixed(1)}s
                </option>
              ))}
            </select>
          </label>
          {!covered && (
            <p role="status">
              No retained segment covers this evidence timestamp.
            </p>
          )}
          {playbackError && <p role="alert">{playbackError}</p>}
          <small className="ll-id">Segment SHA-256: {current.sha256}</small>
        </>
      ) : (
        <div className="ll-media-empty">
          <Video size={30} />
          <p>No retained media for this session.</p>
          <small>
            Written, verified segments appear here. A running process alone is
            not a recording.
          </small>
        </div>
      )}
      {resource.error && (
        <p className="ll-muted">Media service unavailable: {resource.error}</p>
      )}
      {resource.data?.jobs
        .filter((j) =>
          [
            "queued",
            "starting",
            "recording",
            "retrying",
            "stopping",
            "recovering",
          ].includes(j.state),
        )
        .map((j) => (
          <button
            key={j.id}
            onClick={() =>
              api(`/v1/jobs/${j.id}/stop`, {})
                .then(() => location.reload())
                .catch((e) => setPlaybackError(message(e)))
            }
          >
            Stop recording
          </button>
        ))}
    </section>
  );
}
