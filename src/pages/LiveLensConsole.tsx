import {
  useEffect,
  useRef,
  useState,
  type FormEvent,
  type ReactNode,
} from "react";
import {
  Activity,
  ArrowRight,
  Archive,
  ArrowLeft,
  ArrowUpRight,
  Check,
  ChevronDown,
  ChevronRight,
  Clock3,
  Compass,
  FileText,
  FolderOpen,
  Headphones,
  Layers3,
  LogOut,
  Menu,
  Mic,
  Network,
  Radio,
  RefreshCw,
  Search,
  Settings,
  Shield,
  ShieldCheck,
  Bell,
  Bot,
  Users,
  Video,
  X,
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
import AdvancedWorkspace, {
  ReviewedReport,
} from "../components/livelens/AdvancedWorkspace";
import ReviewDesk from "../components/livelens/ReviewDesk";
import LiveMonitor from "../components/livelens/LiveMonitor";
import InvitationAcceptance from "../components/livelens/InvitationAcceptance";
import "./livelens.css";
import "./livelens-shell.css";

type View =
  | "overview"
  | "review"
  | "sources"
  | "sessions"
  | "search"
  | "cases"
  | "settings"
  | "missions"
  | "investigations"
  | "graph"
  | "alerts"
  | "workspace"
  | "agent";
const nav = [
  ["overview", "Live monitor", Radio, "WORKSPACE"],
  ["sessions", "Session library", Layers3, "WORKSPACE"],
  ["review", "Review desk", Activity, "INVESTIGATE"],
  ["investigations", "Investigations", FolderOpen, "INVESTIGATE"],
  ["search", "Observed accounts", Users, "INVESTIGATE"],
  ["graph", "Context graph", Network, "INVESTIGATE"],
  ["cases", "Reports", FileText, "INVESTIGATE"],
  ["missions", "Missions", Compass, "COLLECT"],
  ["sources", "Sources & captures", Radio, "COLLECT"],
  ["alerts", "Protection & alerts", Shield, "MANAGE"],
  ["agent", "Agent connection", Bot, "MANAGE"],
  ["workspace", "Workspace & access", Users, "MANAGE"],
  ["settings", "Workspace settings", Settings, "MANAGE"],
] as const;
const descriptions: Record<View, string> = {
  overview: "Choose accounts. Record their broadcasts. Follow video and chat in one place.",
  review: "Review what was captured. Keep the original context close.",
  sources: "Choose a source. Set a limit. Keep a reliable record.",
  sessions: "Reopen a conversation and follow the original evidence.",
  search: "Find captured statements and follow an account’s observed activity.",
  cases: "Turn selected evidence into a report you can review and share.",
  settings:
    "Your service connection and the tools available to this workspace.",
  missions: "Give collection a purpose and keep every mission bounded.",
  investigations:
    "Ask a question. Review the evidence. Record what you conclude.",
  graph: "Explore connections that lead back to their supporting evidence.",
  alerts: "Review captured signals in context and decide what needs attention.",
  workspace: "Manage access, usage and the lifecycle of your retained records.",
  agent: "A scoped connection to the same evidence your team can inspect.",
};
const clockTime = (ms: number) =>
  new Date(ms).toLocaleTimeString([], {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
const shortDate = (ms: number) =>
  new Date(ms).toLocaleDateString([], {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
const speakerTrack = (event: Evidence) =>
  (event as Evidence & { speakerId?: string | null }).speakerId ?? null;
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
  const previousPath = useRef<string | null>(path);
  const [state, setState] = useState<{
    data: T | null;
    loading: boolean;
    error: string;
  }>({ data: null, loading: !!path, error: "" });
  useEffect(() => {
    let active = true;
    const changed = previousPath.current !== path;
    previousPath.current = path;
    setState((current) => ({
      data: changed || !path ? null : current.data,
      loading: !!path && (changed || current.data === null),
      error: "",
    }));
    if (path)
      api<T>(path)
        .then((data) => active && setState({ data, loading: false, error: "" }))
        .catch(
          (e) =>
            active &&
            setState((current) => ({
              data: current.data,
              loading: false,
              error: message(e),
            })),
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
  const readToken = () => new URLSearchParams(location.hash.slice(1)).get("invite");
  const [invitationToken, setInvitationToken] = useState(readToken);
  const [generation, setGeneration] = useState(0);
  useEffect(() => {
    const changed = () => setInvitationToken(readToken());
    window.addEventListener("hashchange", changed);
    return () => window.removeEventListener("hashchange", changed);
  }, []);
  const closeInvitation = (identity?: Identity) => {
    if (identity) setIdentity(identity);
    history.replaceState(null, "", `${location.pathname}?view=overview`);
    setInvitationToken(null);
    // Mount fresh resources after a link changes the authenticated operator.
    setGeneration((value) => value + 1);
  };
  return invitationToken
    ? <InvitationAcceptance token={invitationToken} onSignedIn={closeInvitation} onCancel={() => closeInvitation()} />
    : <OperatorConsole key={generation} />;
}

function OperatorConsole() {
  const [identity, updateIdentity] = useState<Identity | null>(null),
    [checking, setChecking] = useState(true),
    [error, setError] = useState("");
  const [view, setView] = useState<View>(() => {
    const candidate = new URLSearchParams(location.search).get("view");
    return nav.some(([id]) => id === candidate)
      ? (candidate as View)
      : "overview";
  });
  const [sessionId, setSessionId] = useState<string | null>(
    new URLSearchParams(location.search).get("session"),
  );
  const [evidenceId, setEvidenceId] = useState<string | null>(
    new URLSearchParams(location.search).get("evidence"),
  );
  const [caseId, setCaseId] = useState<string | null>(null),
    [menu, setMenu] = useState(false),
    [revision, setRevision] = useState(0);
  const [investigationId, setInvestigationId] = useState<string | null>(
    new URLSearchParams(location.search).get("case"),
  );
  const [query, setQuery] = useState(""),
    [account, setAccount] = useState(""),
    [searchPath, setSearchPath] = useState("/v1/evidence/search?limit=100");
  const [globalQuery, setGlobalQuery] = useState(""),
    [libraryQuery, setLibraryQuery] = useState("");
  const [timelineQuery, setTimelineQuery] = useState(""),
    [timelineKind, setTimelineKind] = useState("all");
  const [addingSource, setAddingSource] = useState(false);
  const [globalSearchOpen, setGlobalSearchOpen] = useState(false);
  const [reportView, setReportView] = useState<"original" | "reviewed">(
    "reviewed",
  );
  const [notice, setNotice] = useState(""),
    [busy, setBusy] = useState(false);
  const [noticeIsError, setNoticeIsError] = useState(false);
  const main = useRef<HTMLElement>(null);
  const contextPanel = useRef<HTMLElement>(null);
  const headerSearch = useRef<HTMLInputElement>(null);
  const navigation = useRef<HTMLElement>(null);
  const menuToggle = useRef<HTMLButtonElement>(null);
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
  useEffect(() => {
    function shortcut(event: KeyboardEvent) {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        setMenu(false);
        setGlobalSearchOpen(true);
        requestAnimationFrame(() => headerSearch.current?.focus());
      }
      if (event.key === "Escape") {
        setMenu(false);
        setGlobalSearchOpen(false);
      }
    }
    document.addEventListener("keydown", shortcut);
    return () => document.removeEventListener("keydown", shortcut);
  }, []);
  useEffect(() => {
    if (!menu || !navigation.current) return;
    const drawer = navigation.current;
    const work = main.current?.closest<HTMLElement>(".ll-work");
    const skip = drawer.parentElement?.querySelector<HTMLElement>(".ll-skip");
    const oldOverflow = document.body.style.overflow;
    const wasWorkInert = work?.inert ?? false;
    const wasSkipInert = skip?.inert ?? false;
    if (work) work.inert = true;
    if (skip) skip.inert = true;
    document.body.style.overflow = "hidden";
    drawer.querySelector<HTMLElement>('[aria-current="page"]')?.focus();
    function trapFocus(event: KeyboardEvent) {
      if (event.key !== "Tab") return;
      const controls = Array.from(drawer.querySelectorAll<HTMLElement>('button:not(:disabled), a[href], [tabindex="0"]')).filter((element) => element.getClientRects().length > 0);
      const first = controls[0], last = controls[controls.length - 1];
      if (!first || !last) return;
      if (!drawer.contains(document.activeElement) || (event.shiftKey && document.activeElement === first)) {
        event.preventDefault(); (event.shiftKey ? last : first).focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault(); first.focus();
      }
    }
    const desktop = matchMedia("(min-width: 761px)");
    const closeOnDesktop = () => { if (desktop.matches) setMenu(false); };
    document.addEventListener("keydown", trapFocus);
    desktop.addEventListener("change", closeOnDesktop);
    return () => {
      document.removeEventListener("keydown", trapFocus);
      desktop.removeEventListener("change", closeOnDesktop);
      if (work) work.inert = wasWorkInert;
      if (skip) skip.inert = wasSkipInert;
      document.body.style.overflow = oldOverflow;
      if (drawer.contains(document.activeElement) || document.activeElement === document.body) menuToggle.current?.focus();
    };
  }, [menu]);
  const [libraryOffset, setLibraryOffset] = useState(0);
  const overview = useResource<{
    sessions: number;
    cases: number;
    evidence: number;
    gaps: number;
  }>(identity ? "/v1/overview" : null, revision);
  const sources = useResource<{
    sources: {
      id: string;
      sessionId?: string | null;
      kind: string;
      label: string;
    }[];
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
  }>(
    identity && view === "sources" ? "/v1/jobs" : null,
    revision,
  );
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
  const searchedAccount = new URLSearchParams(
    searchPath.split("?")[1] ?? "",
  ).get("account");
  const accountActivity = useResource<{
    account: string;
    evidence: Evidence[];
    sessions: Session[];
    limitation: string;
    bounded: boolean;
  }>(
    identity && view === "search" && searchedAccount
      ? `/v1/accounts/${encodeURIComponent(searchedAccount)}/activity?limit=200`
      : null,
    revision,
  );
  const session = useResource<Session>(
    identity && sessionId ? `/v1/sessions/${sessionId}` : null,
    revision,
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
  }>(
    identity && evidenceId ? `/v1/evidence/${evidenceId}/context` : null,
    revision,
  );
  const report = useResource<Report>(
    identity && caseId ? `/v1/cases/${caseId}/report` : null,
    revision,
  );
  const capabilities = useResource<{
    enabled: string[];
    planned: string[];
    scopes: string[];
    workers?: { mediaArchive?: MediaArchiveConfiguration };
  }>(identity ? "/v1/capabilities" : null, revision);
  useEffect(() => {
    if (!identity || view !== "sources") return;
    const active = jobs.data?.jobs.some(
      (job) => !["completed", "stopped", "failed"].includes(job.state),
    );
    if (!active) return;
    const timer = setInterval(() => setRevision((r) => r + 1), 3000);
    return () => clearInterval(timer);
  }, [identity, view, jobs.data]);
  function go(next: View) {
    setView(next);
    setLibraryOffset(0);
    setSessionId(null);
    setEvidenceId(null);
    setCaseId(null);
    setInvestigationId(null);
    setMenu(false);
    setNotice("");
    history.replaceState(null, "", `?view=${next}`);
    requestAnimationFrame(() => main.current?.focus());
  }
  function openSession(id: string) {
    setSessionId(id);
    setEvidenceId(null);
    setCursor(0);
    setTimelineQuery("");
    setTimelineKind("all");
    setView("sessions");
    history.replaceState(null, "", `?view=sessions&session=${id}`);
  }
  function openInvestigation(id: string) {
    go("investigations");
    selectInvestigation(id);
  }
  function selectInvestigation(id: string | null) {
    setInvestigationId(id);
    history.replaceState(
      null,
      "",
      id
        ? `?view=investigations&case=${encodeURIComponent(id)}`
        : "?view=investigations",
    );
    main.current?.focus();
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
    requestAnimationFrame(() => {
      if (matchMedia("(max-width: 760px)").matches)
        contextPanel.current?.scrollIntoView({
          block: "start",
          behavior: matchMedia("(prefers-reduced-motion: reduce)").matches
            ? "auto"
            : "smooth",
        });
    });
  }
  function openEvidenceById(session: string, evidence: string) {
    setSessionId(session);
    setEvidenceId(evidence);
    setCursor(0);
    setView("sessions");
    setMenu(false);
    history.replaceState(
      null,
      "",
      `?view=sessions&session=${encodeURIComponent(session)}&evidence=${encodeURIComponent(evidence)}`,
    );
    requestAnimationFrame(() => {
      if (matchMedia("(max-width: 760px)").matches)
        contextPanel.current?.scrollIntoView({ block: "start" });
    });
  }
  function runSearch(value: string) {
    go("search");
    setQuery(value.trim());
    setAccount("");
    setSearchPath(
      "/v1/evidence/search?" +
        new URLSearchParams({ q: value.trim(), limit: "200" }),
    );
    setGlobalQuery("");
    setGlobalSearchOpen(false);
  }
  async function mutate(operation: () => Promise<unknown>, success: string) {
    setBusy(true);
    setNotice("");
    setNoticeIsError(false);
    try {
      await operation();
      setRevision((r) => r + 1);
      setNotice(success);
    } catch (e) {
      setNoticeIsError(true);
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
          ...(String(data.get("workspace") ?? "").trim()
            ? { workspace: String(data.get("workspace")).trim() }
            : {}),
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
        <section className="ll-login-story" aria-label="About LiveLens">
          <div className="ll-brand">
            <span className="ll-mark">
              <Radio size={22} />
            </span>
            LiveLens
          </div>
          <div className="ll-login-intro">
            <p className="ll-eyebrow">LIVE RECORDING & CONVERSATION TOOLS</p>
            <h1>
              Record the broadcast.
              <br />
              <span>Keep the conversation.</span>
            </h1>
            <p>
              Monitor selected accounts, record bounded sessions and reopen
              video, chat and transcripts together.
            </p>
            <div className="ll-login-journey">
              <div>
                <Radio size={21} />
                <span>Capture</span>
                <small>Selected conversations</small>
              </div>
              <ChevronRight size={18} />
              <div>
                <Search size={21} />
                <span>Investigate</span>
                <small>Evidence in context</small>
              </div>
              <ChevronRight size={18} />
              <div>
                <FileText size={21} />
                <span>Report</span>
                <small>Sources you can reopen</small>
              </div>
            </div>
          </div>
          <p className="ll-login-footnote">
            <ShieldCheck size={15} /> Private workspaces. Original sources.
            Human judgement.
          </p>
        </section>
        <div className="ll-login-card">
          <div className="ll-login-icon">
            <ShieldCheck size={26} />
          </div>
          <p className="ll-eyebrow">YOUR WORKSPACE</p>
          <h2>Welcome back.</h2>
          <p>Sign in to your accounts, recordings and workspace.</p>
          {checking ? (
            <p role="status">Checking your session…</p>
          ) : location.protocol === "file:" ? (
            <>
              <p>
                Open the authenticated browser console configured by your
                operator.
              </p>
              <button
                className="ll-primary"
                disabled={!window.tiktok?.livelensOpenConsole}
                onClick={async () => {
                  const result = await window.tiktok.livelensOpenConsole?.();
                  if (!result?.ok)
                    setError(
                      result?.error ?? "Desktop console access unavailable",
                    );
                }}
              >
                Open browser console
              </button>
              {error && (
                <p role="alert" className="ll-error">
                  {error}
                </p>
              )}
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
              <label>
                Workspace (optional)
                <input name="workspace" autoComplete="off" maxLength={100} placeholder="For names shared by several workspaces" />
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
            Access is managed by your workspace operator.
          </p>
        </div>
      </div>
    );
  const title = sessionId
    ? "Conversation"
    : (nav.find((n) => n[0] === view)?.[1] ?? "Overview");
  const visibleEvents =
    events.data?.events.filter(
      (event) =>
        (timelineKind === "all" || event.kind === timelineKind) &&
        `${event.text} ${event.attribution.account ?? ""}`
          .toLowerCase()
          .includes(timelineQuery.toLowerCase()),
    ) ?? [];
  const visibleSessions =
    sessions.data?.sessions.filter((captured) =>
      `${captured.title} ${captured.account ?? ""} ${captured.platform}`
        .toLowerCase()
        .includes(libraryQuery.toLowerCase()),
    ) ?? [];
  const evidenceList = (items: Evidence[]) => (
    <div className="ll-evidence-list">
      {items.map((e) => (
        <button
          className={`ll-evidence ${e.id === evidenceId ? "selected" : ""}`}
          key={e.id}
          onClick={() => openEvidence(e)}
        >
          <span className="ll-evidence-time">
            <span>
              {clockTime(
                e.sourceTimestampMs ?? e.capturedAtMs ?? e.receivedAtMs,
              )}
            </span>
            <small>
              {e.sourceTimestampMs === null
                ? "Capture / receipt clock"
                : "Source clock"}
            </small>
          </span>
          <span className="ll-evidence-body">
            <span className="ll-evidence-author">
              <strong>
                {e.attribution.account
                  ? `@${e.attribution.account}`
                  : e.kind === "gap"
                    ? "Capture interruption"
                    : e.kind === "transcript" || e.kind === "caption"
                      ? speakerTrack(e)
                        ? `Anonymous track · ${speakerTrack(e)}`
                        : "Unattributed voice"
                      : "Unattributed account"}
              </strong>
              <span className={`ll-tag ${e.kind === "gap" ? "ll-gap" : ""}`}>
                {e.kind}
              </span>
            </span>
            <p>{e.text || "(No text)"}</p>
            <small>
              {shortDate(
                e.sourceTimestampMs ?? e.capturedAtMs ?? e.receivedAtMs,
              )}{" "}
              · {e.attribution.status.replaceAll("_", " ")} · {e.source.adapter}
            </small>
          </span>
          <ChevronRight size={16} aria-hidden />
        </button>
      ))}
    </div>
  );
  return (
    <div className={`ll-app ll-product-shell ${view === "overview" ? "ll-monitor-home" : view === "review" ? "ll-review-home" : ""}`}>
      <a className="ll-skip" href="#ll-main">
        Skip to content
      </a>
      <aside ref={navigation} className={`ll-sidebar ${menu ? "open" : ""}`} role={menu ? "dialog" : undefined} aria-modal={menu || undefined} aria-label={menu ? "Navigation" : undefined}>
        <button className="ll-nav-close" aria-label="Close navigation" onClick={() => setMenu(false)}><X size={18} /></button>
        <div className="ll-brand">
          <span className="ll-mark">
            <Radio size={21} />
          </span>
          LiveLens
        </div>
        <div className="ll-workspace">
          <span className="ll-workspace-icon">
            {identity.workspace.slice(0, 1).toUpperCase()}
          </span>
          <div>
            <strong>{identity.workspace}</strong>
            <small>Private workspace</small>
          </div>
          <ShieldCheck size={14} />
        </div>
        <nav aria-label="LiveLens navigation">
          {nav.map(([id, label, Icon, group], index) => (
            <div key={id}>
              {index > 0 && group !== nav[index - 1][3] && (
                <p className="ll-nav-group">{group}</p>
              )}
              <button
                aria-current={view === id ? "page" : undefined}
                aria-label={id === "cases" ? "Cases & reports" : undefined}
                onClick={() => go(id)}
              >
                <Icon size={17} />
                <span>{label}</span>
                {id === "sessions" && overview.data && (
                  <small className="ll-nav-count" aria-hidden="true">
                    {overview.data.sessions}
                  </small>
                )}
              </button>
            </div>
          ))}
        </nav>
        <div className="ll-nav-bottom">
          <a href="?page=dashboard">
            <Users size={18} />
            Community & CRM
            <ArrowUpRight size={14} />
          </a>
          <button
            className="ll-user"
            onClick={() =>
              mutate(async () => {
                await api("/console/logout", {});
                signedIn(null);
              }, "Signed out")
            }
          >
            <span className="ll-avatar">
              {identity.subject.slice(0, 2).toUpperCase()}
            </span>
            <span>
              <strong>{identity.subject}</strong>
              <small>Sign out</small>
            </span>
            <LogOut size={15} />
          </button>
        </div>
      </aside>
      {menu && (
        <button
          className="ll-nav-backdrop"
          aria-hidden="true"
          tabIndex={-1}
          onClick={() => setMenu(false)}
        />
      )}
      <div className="ll-work">
        <header className="ll-top">
          <button
            className="ll-mobile-menu"
            ref={menuToggle}
            aria-label="Toggle navigation"
            aria-expanded={menu}
            onClick={() => setMenu(!menu)}
          >
            <Menu size={20} />
          </button>
          <span className="ll-breadcrumb">
            <span>{identity.workspace}</span> <ChevronRight size={13} />{" "}
            <strong>{title}</strong>
          </span>
          <button
            className="ll-mobile-search"
            aria-label="Open evidence search"
            onClick={() => {
              setGlobalSearchOpen(true);
              requestAnimationFrame(() => headerSearch.current?.focus());
            }}
          >
            <Search size={17} />
          </button>
          <form
            className={`ll-header-search ${globalSearchOpen ? "open" : ""}`}
            onSubmit={(event) => {
              event.preventDefault();
              runSearch(globalQuery);
            }}
          >
            <Search size={15} />
            <input
              ref={headerSearch}
              aria-label="Search all captured evidence"
                    placeholder="Search captured statements"
              value={globalQuery}
              onChange={(event) => setGlobalQuery(event.target.value)}
              maxLength={512}
            />
            <kbd>⌘ K</kbd>
            {globalSearchOpen && (
              <button
                className="ll-search-close"
                type="button"
                aria-label="Close evidence search"
                onClick={() => setGlobalSearchOpen(false)}
              >
                Esc
              </button>
            )}
          </form>
          <button
            className="ll-icon-button"
            aria-label="Open protection and alerts"
            onClick={() => go("alerts")}
          >
            <Bell size={17} />
          </button>
          <span
            className="ll-connected"
            title="Signed in to a scoped workspace"
          >
            <span />
            Secure session
          </span>
        </header>
        <main id="ll-main" tabIndex={-1} ref={main}>
          <div className="ll-heading">
            <div>
              {view !== "overview" && <p className="ll-eyebrow">
                {sessionId
                  ? "CONVERSATION / ORIGINAL SOURCE"
                  : "LIVELENS / " + nav.find(([id]) => id === view)?.[3]}
              </p>}
              <h1>{view === "overview" ? "Live monitor" : view === "review" ? "Your review desk" : session.data?.title ?? title}</h1>
              <p>
                {sessionId
                  ? "The recording, its words and the source behind each moment."
                  : view === "review"
                    ? new Date().toLocaleDateString(undefined, {
                        weekday: "long",
                        day: "numeric",
                        month: "long",
                        year: "numeric",
                      })
                    : descriptions[view]}
              </p>
            </div>
            <button
              className="ll-refresh"
              onClick={() => setRevision((r) => r + 1)}
              disabled={busy}
            >
              <RefreshCw size={14} />
              Refresh records
            </button>
          </div>
          {notice && (
            <p
              role={noticeIsError ? "alert" : "status"}
              className={noticeIsError ? "ll-error" : "ll-notice"}
            >
              {notice}
            </p>
          )}
          {view === "overview" && (
            <LiveMonitor
              scopes={capabilities.data?.scopes ?? []}
              enabled={capabilities.data?.enabled ?? []}
              revision={revision}
              sessions={sessions.data?.sessions ?? []}
              onRefresh={() => setRevision((value) => value + 1)}
              onOpenSession={openSession}
              onOpenEvidence={openEvidenceById}
              onSources={() => go("sources")}
              renderMedia={(selectedSessionId, selectedEvidence, monitorRevision, selectedJobId) => (
                <MediaReplay
                  key={selectedSessionId}
                  sessionId={selectedSessionId}
                  evidence={selectedEvidence}
                  revision={monitorRevision}
                  preferredJobId={selectedJobId}
                  openSources={() => go("sources")}
                  archiveWrite={false}
                  mutate={mutate}
                  busy={busy}
                  compact
                />
              )}
            />
          )}
          {view === "review" && (
            <>
              <Status
                loading={overview.loading || sessions.loading || cases.loading}
                error={overview.error || sessions.error || cases.error}
              />
              <ReviewDesk
                identity={identity}
                sessions={sessions.data?.sessions ?? []}
                cases={cases.data?.cases ?? []}
                sources={sources.data?.sources ?? []}
                revision={revision}
                capabilities={capabilities.data ?? undefined}
                onNavigate={go}
                onOpenSession={openSession}
                onOpenEvidence={openEvidenceById}
                onOpenInvestigation={openInvestigation}
                renderMedia={(selectedSessionId, selectedEvidence) => (
                  <MediaReplay
                    key={selectedSessionId}
                    sessionId={selectedSessionId}
                    evidence={selectedEvidence ?? undefined}
                    revision={revision}
                    openSources={() => go("sources")}
                    archiveConfiguration={capabilities.data?.workers?.mediaArchive}
                    archiveWrite={false}
                    mutate={mutate}
                    busy={busy}
                    compact
                  />
                )}
              />
            </>
          )}
          {view === "sources" && (
            <>
              <Status
                loading={sources.loading || jobs.loading}
                error={sources.error || jobs.error}
              />
              <div className="ll-source-toolbar">
                <span>
                  <ShieldCheck size={15} />
                  Only sources selected for this workspace
                </span>
                {capabilities.data?.scopes.includes("workspace:admin") &&
                  capabilities.data.scopes.includes("recordings:write") && (
                    <button
                      className="ll-primary"
                      onClick={() => setAddingSource((value) => !value)}
                    >
                      <Radio size={14} />
                      {addingSource ? "Close source setup" : "Add a source"}
                    </button>
                  )}
              </div>
              {addingSource && <SourceSetup mutate={mutate} busy={busy} />}
              <div className="ll-settings-grid">
                <section className="ll-form-card">
                  <h2>Selected sources</h2>
                  <p>
                    Record from a source configured for this workspace. Set a
                    duration before you start; completed media stays available
                    in the conversation.
                  </p>
                  {sources.data?.sources.map((source) => (
                    <form
                      key={source.id}
                      onSubmit={(e) => {
                        e.preventDefault();
                        if (!source.sessionId) return;
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
                      <div className="ll-source-card-heading">
                        <span className="ll-source-card-icon">
                          <Radio size={20} />
                        </span>
                        <div>
                          <h3>{source.label}</h3>
                          <small>
                            {source.kind === "file"
                              ? "Fixture file · synthetic capture"
                              : source.kind.includes("tiktok")
                                ? "Selected TikTok account · checked within your collection window"
                                : "Selected HTTPS media · checked within your collection window"}
                          </small>
                        </div>
                      </div>
                      {source.sessionId ? (
                        <>
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
                          <button
                            className="ll-primary"
                            disabled={busy || !source.sessionId}
                          >
                            Start bounded capture
                          </button>
                          <button
                            type="button"
                            disabled={!source.sessionId}
                            onClick={() =>
                              source.sessionId && openSession(source.sessionId)
                            }
                          >
                            Open conversation
                          </button>
                        </>
                      ) : (
                        <>
                          <p className="ll-muted">
                            Schedule this source below to discover an available
                            broadcast and keep each conversation separate.
                          </p>
                          <button
                            type="button"
                            onClick={() =>
                              document
                                .getElementById("ll-capture-schedules")
                                ?.scrollIntoView({ block: "center" })
                            }
                          >
                            <Clock3 size={14} />
                            Set a collection window
                          </button>
                        </>
                      )}
                    </form>
                  ))}
                  {!sources.loading && !sources.data?.sources.length && (
                    <Empty title="No sources configured">
                      Add a permitted source for this workspace, then choose a
                      collection window. If source setup is unavailable, ask
                      your workspace operator for access.
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
                    Recording state reflects written media. Capture
                    interruptions and unfinished segments remain visible in the
                    record.
                  </p>
                </section>
              </div>
              <CaptureScheduler
                sources={sources.data?.sources ?? []}
                enabled={
                  capabilities.data?.enabled.includes(
                    "bounded-source-schedules",
                  ) ?? false
                }
                revision={revision}
                mutate={mutate}
                busy={busy}
                openSession={openSession}
              />
            </>
          )}
          {view === "sessions" && !sessionId && (
            <>
              <div className="ll-library-toolbar">
                <span>
                  <Layers3 size={17} />
                  <strong>All conversations</strong>
                  <small>
                    {sessions.data?.sessions.length ?? 0} on this page
                  </small>
                </span>
                <label>
                  <Search size={15} />
                  <input
                    aria-label="Filter session library"
                    placeholder="Filter by title or account…"
                    value={libraryQuery}
                    onChange={(e) => setLibraryQuery(e.target.value)}
                  />
                </label>
              </div>
              {libraryOffset > 0 && (
                <button
                  onClick={() => setLibraryOffset((n) => Math.max(0, n - 200))}
                >
                  Previous sessions
                </button>
              )}
              <Status {...sessions} />
              {libraryQuery && !visibleSessions.length && !sessions.loading ? (
                <Empty title="No conversations match this filter">
                  Try another title or account. This filter searches the current
                  library page.
                </Empty>
              ) : (
                <SessionList sessions={visibleSessions} open={openSession} />
              )}
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
                    key={sessionId}
                    sessionId={sessionId}
                    evidence={context.data?.event}
                    revision={revision}
                    openSources={() => go("sources")}
                    archiveConfiguration={
                      capabilities.data?.workers?.mediaArchive
                    }
                    archiveWrite={
                      capabilities.data?.scopes.includes("recordings:write") ??
                      false
                    }
                    mutate={mutate}
                    busy={busy}
                  />
                  <SpeechProcessing
                    key={`speech-${sessionId}`}
                    sessionId={sessionId}
                    revision={revision}
                    mutate={mutate}
                    busy={busy}
                    refresh={() => setRevision((r) => r + 1)}
                  />
                  <div className="ll-section-head">
                    <div>
                      <h2>Captured timeline</h2>
                      <p>
                        {events.data?.events.length ?? 0} records on this page ·
                        original clocks preserved
                      </p>
                    </div>
                    <span className="ll-tag">Source-linked</span>
                  </div>
                  <div className="ll-timeline-toolbar">
                    <div
                      className="ll-segmented"
                      aria-label="Filter timeline by event kind"
                    >
                      {[
                        ["all", "All evidence"],
                        ["chat", "Chat"],
                        ["transcript", "Speech"],
                        ["caption", "Captions"],
                      ].map(([kind, label]) => (
                        <button
                          key={kind}
                          aria-pressed={timelineKind === kind}
                          onClick={() => setTimelineKind(kind)}
                        >
                          {label}
                        </button>
                      ))}
                    </div>
                    <label>
                      <Search size={14} />
                      <input
                        aria-label="Filter captured timeline"
                        placeholder="Find a moment…"
                        value={timelineQuery}
                        onChange={(e) => setTimelineQuery(e.target.value)}
                      />
                    </label>
                  </div>
                  {events.data?.events.length ? (
                    visibleEvents.length ? (
                      evidenceList(visibleEvents)
                    ) : (
                      <Empty title="No records match this filter">
                        Choose another event type or try a different phrase.
                        This filter searches the current page of captured
                        evidence.
                      </Empty>
                    )
                  ) : (
                    !events.loading && (
                      <Empty title="No captured evidence yet">
                        Archive a selected desktop session or capture events
                        with the scoped API.
                      </Empty>
                    )
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
                <aside className="ll-context" ref={contextPanel}>
                  <div className="ll-context-title">
                    <ShieldCheck size={17} />
                    <h2>Evidence & context</h2>
                  </div>
                  {evidenceId ? (
                    <>
                      <Status {...context} />
                      {context.data && (
                        <>
                          <span className="ll-tag">
                            {context.data.event.kind}
                          </span>
                          <blockquote>{context.data.event.text}</blockquote>
                          <button
                            className="ll-context-replay"
                            onClick={() =>
                              document
                                .getElementById("ll-media-replay")
                                ?.scrollIntoView({
                                  block: "center",
                                  behavior: matchMedia(
                                    "(prefers-reduced-motion: reduce)",
                                  ).matches
                                    ? "auto"
                                    : "smooth",
                                })
                            }
                          >
                            <Video size={14} />
                            Open media view
                            <ArrowUpRight size={13} />
                          </button>
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
                            {speakerTrack(context.data.event) && (
                              <>
                                <dt>Anonymous track</dt>
                                <dd>{speakerTrack(context.data.event)}</dd>
                              </>
                            )}
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
                          {capabilities.data?.scopes.includes(
                            "investigations:write",
                          ) && (
                            <button
                              className="ll-bookmark"
                              disabled={busy}
                              onClick={() =>
                                mutate(
                                  () =>
                                    api("/v1/bookmarks", {
                                      evidenceId,
                                      label:
                                        context.data!.event.text.slice(
                                          0,
                                          120,
                                        ) || "Saved evidence",
                                    }),
                                  "Evidence bookmarked.",
                                )
                              }
                            >
                              <Archive size={14} />
                              Bookmark evidence
                            </button>
                          )}
                          {["caption", "transcript"].includes(
                            context.data.event.kind,
                          ) && (
                            <AttributionReview
                              event={context.data.event}
                              revision={revision}
                              canWrite={
                                capabilities.data?.scopes.includes(
                                  "assertions:write",
                                ) ?? false
                              }
                              mutate={mutate}
                              busy={busy}
                            />
                          )}
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
              {searchedAccount && (
                <section className="ll-account-summary">
                  <span className="ll-account-avatar">
                    {searchedAccount.slice(0, 2).toUpperCase()}
                  </span>
                  <div>
                    <p className="ll-eyebrow">OBSERVED ACCOUNT</p>
                    <h2>@{searchedAccount}</h2>
                    <p>
                      {accountActivity.data?.evidence.length ?? "—"} retained
                      records shown across{" "}
                      {accountActivity.data?.sessions.length ?? "—"}{" "}
                      conversations
                    </p>
                  </div>
                  <div>
                    <span className="ll-tag">Platform account</span>
                    <small>Real-world identity is unverified</small>
                  </div>
                  {accountActivity.error && (
                    <p className="ll-muted">
                      Account activity unavailable: {accountActivity.error}
                    </p>
                  )}
                  {!!accountActivity.data?.sessions.length && (
                    <div className="ll-account-conversations">
                      <span>Captured in</span>
                      {accountActivity.data.sessions.map((captured) => (
                        <button
                          key={captured.id}
                          onClick={() => openSession(captured.id)}
                        >
                          <Video size={13} />
                          {captured.title}
                          <ArrowUpRight size={12} />
                        </button>
                      ))}
                    </div>
                  )}
                </section>
              )}
              <Status {...search} />
              {!!search.data?.evidence.length && (
                <div className="ll-section-head">
                  <h2>Captured statements</h2>
                  <small>
                    {search.data.evidence.length} matching records · maximum 200
                    per search
                  </small>
                </div>
              )}
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
                  {caseId &&
                    capabilities.data?.enabled.includes(
                      "reviewed-investigations",
                    ) && (
                      <div className="ll-report-tabs">
                        <button
                          aria-pressed={reportView === "original"}
                          onClick={() => setReportView("original")}
                        >
                          <Archive size={14} />
                          Original evidence
                        </button>
                        <button
                          aria-pressed={reportView === "reviewed"}
                          onClick={() => setReportView("reviewed")}
                        >
                          <FileText size={14} />
                          Reviewed brief
                        </button>
                      </div>
                    )}
                  <Status {...report} />
                  {reportView === "reviewed" &&
                  caseId &&
                  capabilities.data?.enabled.includes(
                    "reviewed-investigations",
                  ) ? (
                    <ReviewedReport
                      key={caseId}
                      caseId={caseId}
                      onOpenEvidence={openEvidenceById}
                    />
                  ) : report.data ? (
                    <>
                      <p className="ll-eyebrow">
                        ORIGINAL EVIDENCE / UNREDACTED
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
                  {capabilities.data?.planned.filter((c) => c !== "alfred-registration").map((c) => (
                    <p key={c}>
                      <span className="ll-tag">Planned</span>
                      {c.replaceAll("-", " ")}
                    </p>
                  ))}
                  <h3>ALFRED</h3>
                  <p>
                    The optional LiveLens provider is available in ALFRED.
                    Set up its workspace and source access, then verify the
                    connection from ALFRED.
                  </p>
                  <button onClick={() => go("agent")}>
                    <Bot size={16} />Set up ALFRED<ArrowRight size={16} />
                  </button>
                  <h3>Private pilot</h3>
                  <p>
                    Workspace access and retention controls run on this service.
                    Commercial hosting, provider billing and tested customer
                    capacity remain future work.
                  </p>
                </section>
              </div>
            </>
          )}
          {[
            "missions",
            "investigations",
            "graph",
            "alerts",
            "workspace",
            "agent",
          ].includes(view) && (
            <AdvancedWorkspace
              revision={revision}
              view={view}
              onOpenEvidence={openEvidenceById}
              initialCaseId={investigationId}
              onSelectCase={selectInvestigation}
            />
          )}
        </main>
        <footer className="ll-footer">
          <span>
            <ShieldCheck size={12} />
            Private workspace · sources stay with the evidence
          </span>
          <span>
            Search evidence <kbd>⌘ K</kbd>
          </span>
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
      <div className="ll-session-table-head" aria-hidden>
        <span>CONVERSATION</span>
        <span>SOURCE</span>
        <span>CAPTURED</span>
      </div>
      {sessions.map((s) => (
        <button key={s.id} onClick={() => open(s.id)}>
          <span className="ll-session-icon">
            <Layers3 size={19} />
          </span>
          <span className="ll-session-title">
            <strong>{s.title}</strong>
            <small>
              {s.platform === "fixture"
                ? "Labelled demo conversation"
                : "Retained conversation"}
            </small>
          </span>
          <span
            className={`ll-session-source ${s.platform === "fixture" ? "ll-session-fixture" : ""}`}
          >
            {s.account ? "@" + s.account : "Account unavailable"}
            <small>
              {s.platform === "fixture" ? "Synthetic fixture" : s.platform}
            </small>
          </span>
          <span className="ll-session-date">
            {shortDate(s.startedAtMs)}
            <small>{clockTime(s.startedAtMs)}</small>
          </span>
          <ChevronRight size={17} />
        </button>
      ))}
    </div>
  ) : (
    <Empty title="Your captured conversations belong here">
      Start a capture from a selected source, or archive a session from the
      desktop community manager. Your recordings and evidence will appear here.
    </Empty>
  );
}

type Mutation = (
  operation: () => Promise<unknown>,
  success: string,
) => Promise<void>;
function SourceSetup({ mutate, busy }: { mutate: Mutation; busy: boolean }) {
  const [kind, setKind] = useState("tiktok-public");
  return (
    <section className="ll-form-card ll-source-setup">
      <div className="ll-section-head">
        <div>
          <h2>Add a selected source</h2>
          <p>
            Store a source here, then choose when and how long to collect it.
          </p>
        </div>
        <span className="ll-tag">Workspace configuration</span>
      </div>
      <form
        onSubmit={(event) => {
          event.preventDefault();
          const data = new FormData(event.currentTarget);
          mutate(
            () =>
              api("/v1/sources", {
                kind,
                label: String(data.get("label") || "").trim() || undefined,
                ...(kind === "tiktok-public"
                  ? {
                      account: String(data.get("account") || "")
                        .trim()
                        .replace(/^@/, ""),
                    }
                  : { input: String(data.get("url") || "").trim() }),
              }),
            "Selected source saved. Create a bounded schedule when you are ready to collect.",
          );
        }}
      >
        <div className="ll-source-setup-fields">
          <label>
            Source type
            <select
              value={kind}
              onChange={(event) => setKind(event.target.value)}
            >
              <option value="tiktok-public">Public TikTok account</option>
              <option value="https">Permitted HTTPS media</option>
            </select>
          </label>
          <label>
            Source label <span className="ll-muted">optional</span>
            <input
              name="label"
              placeholder="A name you will recognise"
              maxLength={256}
            />
          </label>
          {kind === "tiktok-public" ? (
            <label>
              Public TikTok account
              <input
                name="account"
                placeholder="@creator"
                required
                maxLength={64}
                pattern="@?[A-Za-z0-9_.]+"
                autoComplete="off"
              />
            </label>
          ) : (
            <label>
              Permitted HTTPS media URL
              <input
                name="url"
                type="url"
                placeholder="https://example.com/stream.m3u8"
                pattern="https://.*"
                required
                maxLength={4096}
                autoComplete="off"
              />
            </label>
          )}
        </div>
        <div className="ll-source-setup-footer">
          <p>
            <ShieldCheck size={14} />
            Select sources you are permitted to capture. Saving a source starts
            no watching or recording. Access depends on the configured provider.
          </p>
          <button className="ll-primary" disabled={busy}>
            <Check size={14} />
            Save selected source
          </button>
        </div>
      </form>
    </section>
  );
}

function AttributionReview({
  event,
  revision,
  canWrite,
  mutate,
  busy,
}: {
  event: Evidence;
  revision: number;
  canWrite: boolean;
  mutate: Mutation;
  busy: boolean;
}) {
  const history = useResource<{
    assertions: {
      seq: number;
      account: string;
      reviewer: string;
      reason: string;
      created_at: number;
    }[];
  }>(`/v1/evidence/${encodeURIComponent(event.id)}/assertions`, revision);
  return (
    <details className="ll-attribution">
      <summary>
        <Users size={14} />
        <span>Speaker attribution & history</span>
        <ChevronDown size={13} />
      </summary>
      <p>
        A speaker track does not identify an account. Your attribution is a
        reviewed assertion, kept separately from the original record.
      </p>
      {history.data?.assertions.map((assertion) => (
        <div className="ll-attribution-revision" key={assertion.seq}>
          <strong>@{assertion.account}</strong>
          <small>
            {assertion.reviewer} · {stamp(assertion.created_at)}
          </small>
          <p>{assertion.reason}</p>
        </div>
      ))}
      {history.error && (
        <p role="status">Attribution history unavailable: {history.error}</p>
      )}
      {canWrite && (
        <form
          onSubmit={(submit) => {
            submit.preventDefault();
            const data = new FormData(submit.currentTarget);
            mutate(
              () =>
                api(`/v1/evidence/${encodeURIComponent(event.id)}/assertions`, {
                  account: String(data.get("account") || "").replace(/^@/, ""),
                  reason: data.get("reason"),
                }),
              "Reviewed attribution saved. Previous assertions remain in the history.",
            );
          }}
        >
          <label>
            Reviewed account attribution
            <input
              name="account"
              required
              maxLength={64}
              placeholder="@account"
              pattern="@?[A-Za-z0-9_.]+"
            />
          </label>
          <label>
            Reason for this attribution
            <textarea
              name="reason"
              required
              maxLength={2048}
              placeholder="What source supports this account mapping?"
            />
          </label>
          <button disabled={busy}>
            <Check size={13} />
            Save reviewed attribution
          </button>
        </form>
      )}
    </details>
  );
}

function CaptureScheduler({
  sources,
  enabled,
  revision,
  mutate,
  busy,
  openSession,
}: {
  sources: {
    id: string;
    sessionId?: string | null;
    kind: string;
    label: string;
  }[];
  enabled: boolean;
  revision: number;
  mutate: Mutation;
  busy: boolean;
  openSession: (id: string) => void;
}) {
  const schedules = useResource<{
    schedules: {
      id: string;
      sourceId: string;
      state: string;
      status: string;
      endAtMs: number;
      sessionId: string | null;
      error: string | null;
    }[];
  }>(enabled ? "/v1/schedules" : null, revision);
  if (!enabled) return null;
  return (
    <section className="ll-form-card ll-schedule" id="ll-capture-schedules">
      <div className="ll-section-head">
        <div>
          <h2>
            <Clock3 size={17} />
            Schedule a selected source
          </h2>
          <p>Check for available broadcasts within a window you choose.</p>
        </div>
        <span className="ll-tag">Bounded watch</span>
      </div>
      <Status {...schedules} />
      {sources.length ? (
        <form
          onSubmit={(event) => {
            event.preventDefault();
            const form = new FormData(event.currentTarget);
            mutate(
              () =>
                api("/v1/schedules", {
                  sourceId: form.get("source"),
                  endAtMs: Date.now() + Number(form.get("minutes")) * 60_000,
                  maxDurationSeconds: Number(form.get("seconds")),
                  segmentSeconds: 2,
                  pollSeconds: 30,
                  autoRecord: form.get("autoRecord") === "on",
                }),
              "Source schedule created. Collection remains within your selected limits.",
            );
          }}
        >
          <div className="ll-schedule-fields">
            <label>
              Selected source
              <select name="source" aria-label="Selected source" required>
                {sources.map((source) => (
                  <option value={source.id} key={source.id}>
                    {source.label}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Watch window (minutes)
              <input
                name="minutes"
                type="number"
                min="1"
                max="1440"
                defaultValue="10"
                required
              />
            </label>
            <label>
              Recording limit per broadcast (seconds)
              <input
                name="seconds"
                type="number"
                min="2"
                max="3600"
                defaultValue="60"
                required
              />
            </label>
          </div>
          <label className="ll-checkbox">
            <input type="checkbox" name="autoRecord" defaultChecked />
            Record when this source becomes available
          </label>
          <div className="ll-schedule-actions">
            <p>
              The schedule checks only your selected source and stops at the
              deadline. Guest appearances do not identify other rooms.
            </p>
            <button className="ll-primary" disabled={busy}>
              <Clock3 size={15} />
              Start bounded schedule
            </button>
          </div>
        </form>
      ) : (
        <p className="ll-muted">
          Add a permitted source through service configuration to create a
          schedule.
        </p>
      )}
      {schedules.data?.schedules.map((schedule) => (
        <div className="ll-schedule-row" key={schedule.id}>
          <span className="ll-tag">{schedule.state}</span>
          <div>
            <strong>
              {sources.find((source) => source.id === schedule.sourceId)
                ?.label ?? "Selected source"}
            </strong>
            <small>
              {schedule.status} · window closes {stamp(schedule.endAtMs)}
              {schedule.error
                ? " · " + schedule.error.replaceAll("_", " ")
                : ""}
            </small>
          </div>
          {schedule.sessionId && (
            <button onClick={() => openSession(schedule.sessionId!)}>
              Open discovered conversation
            </button>
          )}
          {!["completed", "failed", "stopped"].includes(schedule.state) && (
            <button
              disabled={busy}
              onClick={() =>
                mutate(
                  () => api(`/v1/schedules/${schedule.id}/stop`, {}),
                  "Source schedule stopped.",
                )
              }
            >
              Stop schedule
            </button>
          )}
        </div>
      ))}
    </section>
  );
}

function SpeechProcessing({
  sessionId,
  revision,
  mutate,
  busy,
  refresh,
}: {
  sessionId: string;
  revision: number;
  mutate: Mutation;
  busy: boolean;
  refresh: () => void;
}) {
  const capabilities = useResource<{
    enabled: boolean;
    engine?: string;
    reason?: string;
    diarization: boolean;
  }>("/v1/speech/capabilities", revision);
  const jobs = useResource<{
    jobs: {
      id: string;
      state: string;
      engine: string;
      completedSegments: number;
      transcriptCount: number;
      error: string | null;
    }[];
  }>(
    capabilities.data?.enabled
      ? `/v1/speech/jobs?session=${encodeURIComponent(sessionId)}`
      : null,
    revision,
  );
  const media = useResource<{
    jobs: { id: string; segments: { id: string }[] }[];
  }>(
    capabilities.data?.enabled
      ? `/v1/sessions/${encodeURIComponent(sessionId)}/media`
      : null,
    revision,
  );
  const recording = media.data?.jobs.find((job) => job.segments.length > 0);
  const pending = jobs.data?.jobs.some(
    (job) => !["completed", "failed", "stopped"].includes(job.state),
  );
  useEffect(() => {
    if (!pending) return;
    const timer = setInterval(refresh, 3000);
    return () => clearInterval(timer);
  }, [pending, refresh]);
  return (
    <section className="ll-speech" aria-label="Independent transcription">
      <div className="ll-speech-heading">
        <Mic size={17} />
        <div>
          <h3>Independent transcription</h3>
          <small>
            {capabilities.loading
              ? "Checking speech availability…"
              : capabilities.data?.enabled
                ? `${capabilities.data.engine} · ${capabilities.data.diarization ? "anonymous speaker tracks" : "unseparated audio track"}`
                : "Speech engine is not configured. Captions remain separate."}
          </small>
        </div>
        {capabilities.data?.enabled && (
          <button
            disabled={busy || !recording || pending}
            onClick={() =>
              mutate(
                () =>
                  api("/v1/speech/jobs", {
                    sessionId,
                    recordingJobId: recording!.id,
                    maxDurationSeconds: 120,
                  }),
                "Transcription queued. Returned words will be added to this timeline.",
              )
            }
          >
            <Headphones size={12} />
            {pending ? "Processing…" : "Transcribe audio"}
          </button>
        )}
      </div>
      {(jobs.error || media.error || capabilities.error) && (
        <p role="status" className="ll-speech-note">
          Speech unavailable: {jobs.error || media.error || capabilities.error}
        </p>
      )}
      {capabilities.data?.enabled && !recording && !media.loading && (
        <p className="ll-speech-note">
          Retained, verified media is required before audio can be transcribed.
        </p>
      )}
      {jobs.data?.jobs.slice(0, 3).map((job) => (
        <div className="ll-speech-job" key={job.id}>
          <span className="ll-tag">{job.state}</span>
          <span>
            {job.transcriptCount} returned segments · {job.completedSegments}{" "}
            media segments processed
            {job.error ? " · " + job.error.replaceAll("_", " ") : ""}
          </span>
          {!["completed", "failed", "stopped"].includes(job.state) && (
            <button
              disabled={busy}
              onClick={() =>
                mutate(
                  () => api(`/v1/speech/jobs/${job.id}/stop`, {}),
                  "Transcription stop requested.",
                )
              }
            >
              Stop
            </button>
          )}
        </div>
      ))}
    </section>
  );
}

function MediaReplay({
  sessionId,
  evidence,
  revision,
  openSources,
  archiveConfiguration,
  archiveWrite,
  mutate,
  busy,
  compact = false,
  preferredJobId,
}: {
  sessionId: string;
  evidence?: Evidence;
  revision: number;
  openSources: () => void;
  archiveConfiguration?: MediaArchiveConfiguration;
  archiveWrite: boolean;
  mutate: Mutation;
  busy: boolean;
  compact?: boolean;
  preferredJobId?: string;
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
  const appliedSeek = useRef<string | null>(null);
  const continuePlayback = useRef(false);
  const segments =
    resource.data?.jobs
      .filter((job) => !preferredJobId || job.id === preferredJobId)
      .flatMap((j) =>
        j.segments.map((s) => ({ ...s, jobId: j.id, key: `${j.id}/${s.id}` })),
      )
      .sort(
        (a, b) => a.startedAtMs - b.startedAtMs || a.key.localeCompare(b.key),
      ) ?? [];
  const current = segments.find((s) => s.key === selected) ?? segments.find((s) => s.jobId === preferredJobId) ?? segments[0];
  useEffect(() => { setSelected(null); }, [preferredJobId]);
  useEffect(() => {
    if (!evidence || appliedSeek.current === evidence.id) return;
    const t =
      evidence.capturedAtMs ??
      evidence.sourceTimestampMs ??
      evidence.receivedAtMs;
    const s = segments.find(
      (s) => t >= s.startedAtMs && t < s.startedAtMs + s.durationMs,
    );
    if (s) {
      appliedSeek.current = evidence.id;
      setSelected(s.key);
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
    <section
      className={`ll-media ${compact ? "ll-media-compact" : ""}`}
      id={compact ? "ll-desk-media-replay" : "ll-media-replay"}
    >
      {!compact && <div className="ll-section-head">
        <h2>
          <Video size={17} />
          Retained media
        </h2>
        <span className="ll-tag">
          {resource.data?.jobs.find((job) => job.id === current?.jobId)
            ?.state ?? "Unavailable"}
        </span>
      </div>}
      {current ? (
        <>
          <video
            ref={video}
            controls
            preload="metadata"
            src={`/v1/media/${current.jobId}/${current.id}`}
            onEnded={() => {
              const index = segments.findIndex(
                (segment) => segment.key === current.key,
              );
              const next = segments[index + 1];
              if (next) {
                continuePlayback.current = true;
                setSelected(next.key);
              }
            }}
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
              if (continuePlayback.current && video.current) {
                continuePlayback.current = false;
                video.current
                  .play()
                  .catch(() =>
                    setPlaybackError(
                      "Press play to continue with the next retained segment.",
                    ),
                  );
              }
            }}
            aria-label="Captured conversation video"
          />
          {(!compact || segments.length > 1) && <label>
            Media segment
            <select
              aria-label="Media segment"
              value={current.key}
              onChange={(e) => setSelected(e.target.value)}
            >
              {segments.map((s) => (
                <option key={s.key} value={s.key}>
                  {stamp(s.startedAtMs)} · {(s.durationMs / 1000).toFixed(1)}s
                </option>
              ))}
            </select>
          </label>}
          {!covered && (
            <p role="status">
              No retained segment covers this evidence timestamp.
            </p>
          )}
          {playbackError && <p role="alert">{playbackError}</p>}
          {!compact && <small className="ll-id">Segment SHA-256: {current.sha256}</small>}
        </>
      ) : resource.loading ? (
        <p role="status" className="ll-status">Loading retained media…</p>
      ) : (
        <div className="ll-media-empty">
          <Video size={30} />
          <p>No retained media for this session.</p>
          <small>
            The session’s captured evidence can still be reviewed below. Start a
            capture to retain available audio and video.
          </small>
          <button onClick={openSources}>
            Open sources
            <ArrowRight size={13} />
          </button>
        </div>
      )}
      {resource.error && (
        <p className="ll-muted">Media service unavailable: {resource.error}</p>
      )}
      {!compact && resource.data?.jobs
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
      {!compact && <MediaArchiveControls
        configuration={archiveConfiguration}
        recordingJobId={current?.jobId}
        recordingJobIds={resource.data?.jobs.map((job) => job.id) ?? []}
        verifiedSegments={
          current
            ? segments.filter((segment) => segment.jobId === current.jobId)
                .length
            : 0
        }
        revision={revision}
        canWrite={archiveWrite}
        mutate={mutate}
        busy={busy}
        onRestored={(jobId) => {
          if (jobId === current?.jobId) {
            setPlaybackError("");
            video.current?.load();
          }
        }}
      />}
    </section>
  );
}

type MediaArchiveConfiguration = { enabled: boolean; encrypted?: boolean };
type MediaArchiveReceipt = {
  id: string;
  recordingJobId: string;
  state: string;
  manifestSha256: string;
  totalBytes: number;
  snapshotAtMs: number;
  segments: { id: string; state: string }[];
  restore: { state: string; error: string | null };
  error: string | null;
};
function MediaArchiveControls({
  configuration,
  recordingJobId,
  recordingJobIds,
  verifiedSegments,
  revision,
  canWrite,
  mutate,
  busy,
  onRestored,
}: {
  configuration?: MediaArchiveConfiguration;
  recordingJobId?: string;
  recordingJobIds: string[];
  verifiedSegments: number;
  revision: number;
  canWrite: boolean;
  mutate: Mutation;
  busy: boolean;
  onRestored: (recordingJobId: string) => void;
}) {
  const restoreStates = useRef(new Map<string, string>());
  const [archiveRevision, setArchiveRevision] = useState(0);
  const resource = useResource<{ archives: MediaArchiveReceipt[] }>(
    configuration?.enabled ? "/v1/media-archives" : null,
    revision + archiveRevision,
  );
  const receipts =
    resource.data?.archives.filter((receipt) =>
      recordingJobIds.includes(receipt.recordingJobId),
    ) ?? [];
  const pending = receipts.some(
    (receipt) =>
      !["completed", "failed"].includes(receipt.state) ||
      ["queued", "restoring", "retrying"].includes(receipt.restore.state),
  );
  const currentPending = receipts.some(
    (receipt) =>
      receipt.recordingJobId === recordingJobId &&
      !["completed", "failed"].includes(receipt.state),
  );
  useEffect(() => {
    if (!pending) return;
    const timer = setInterval(
      () => setArchiveRevision((value) => value + 1),
      2000,
    );
    return () => clearInterval(timer);
  }, [pending]);
  useEffect(() => {
    for (const receipt of receipts) {
      const previous = restoreStates.current.get(receipt.id);
      if (
        previous &&
        previous !== "completed" &&
        receipt.restore.state === "completed"
      )
        onRestored(receipt.recordingJobId);
      restoreStates.current.set(receipt.id, receipt.restore.state);
    }
  }, [resource.data, onRestored]);
  const size = (bytes: number) =>
    bytes >= 1024 ** 2
      ? `${(bytes / 1024 ** 2).toFixed(1)} MB`
      : `${Math.max(1, Math.round(bytes / 1024))} KB`;
  return (
    <section className="ll-media-archive" aria-label="Verified media archive">
      <div className="ll-archive-heading">
        <Archive size={16} />
        <div>
          <h3>Media archive</h3>
          <small>
            {configuration?.enabled
              ? configuration.encrypted
                ? "Encrypted storage configured · verified copies"
                : "Storage configured · verified copies"
              : "Archive storage is not configured"}
          </small>
        </div>
        <button
          disabled={
            !configuration?.enabled ||
            !recordingJobId ||
            !verifiedSegments ||
            !canWrite ||
            busy ||
            currentPending
          }
          onClick={() =>
            mutate(
              () =>
                api("/v1/media-archives", {
                  recordingJobId,
                  maxDurationSeconds: 120,
                  maxAttempts: 3,
                }),
              "Media archive queued. Completion requires verified stored copies.",
            )
          }
        >
          <Archive size={12} />
          {currentPending ? "Archiving…" : "Archive verified segments"}
        </button>
      </div>
      <p className="ll-archive-explanation">
        {configuration?.enabled
          ? `Archive ${verifiedSegments} verified segments from the selected recording. Each archive is a snapshot; later segments require a new archive.`
          : "Configure archive storage through your service operator to preserve and restore verified media copies."}
      </p>
      {configuration?.enabled && !canWrite && (
        <p className="ll-archive-explanation">
          Recording write access is required to archive or restore media.
        </p>
      )}
      {resource.error && (
        <p className="ll-archive-error" role="alert">
          Archive unavailable: {resource.error}
        </p>
      )}
      {receipts.map((receipt) => (
        <div className="ll-archive-receipt" key={receipt.id}>
          <div>
            <span
              className={`ll-tag ${receipt.state === "failed" ? "ll-gap" : ""}`}
            >
              {receipt.state}
            </span>
            <strong>
              {receipt.segments.length} segments · {size(receipt.totalBytes)}
            </strong>
            <small>
              Snapshot {stamp(receipt.snapshotAtMs)}
              {receipt.restore.state !== "not-requested"
                ? ` · restore ${receipt.restore.state}`
                : ""}
            </small>
          </div>
          {receipt.error && (
            <p role="status" className="ll-archive-error">
              {receipt.error.replaceAll("_", " ")}
            </p>
          )}
          {receipt.restore.error && (
            <p role="status" className="ll-archive-error">
              Restore: {receipt.restore.error.replaceAll("_", " ")}
            </p>
          )}
          <div className="ll-archive-receipt-actions">
            <details>
              <summary>Verification receipt</summary>
              <small className="ll-id">
                Manifest SHA-256: {receipt.manifestSha256}
              </small>
              <small>
                {
                  receipt.segments.filter(
                    (segment) => segment.state === "verified",
                  ).length
                }{" "}
                stored segments verified
              </small>
            </details>
            {receipt.state === "completed" && (
              <button
                disabled={
                  !canWrite ||
                  busy ||
                  ["queued", "restoring", "retrying"].includes(
                    receipt.restore.state,
                  )
                }
                onClick={() =>
                  mutate(
                    () =>
                      api(
                        `/v1/media-archives/${encodeURIComponent(receipt.id)}/restore`,
                        {},
                      ),
                    "Restore requested. Original segment hashes will be checked before media is available.",
                  )
                }
              >
                {["queued", "restoring", "retrying"].includes(
                  receipt.restore.state,
                )
                  ? "Restoring…"
                  : "Restore exact originals"}
                <ArrowRight size={12} />
              </button>
            )}
          </div>
        </div>
      ))}
    </section>
  );
}
