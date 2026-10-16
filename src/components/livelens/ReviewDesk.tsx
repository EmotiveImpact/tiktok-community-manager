import {
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import {
  ArrowLeft,
  ArrowRight,
  Bell,
  CalendarClock,
  Check,
  ChevronRight,
  FileText,
  FolderOpen,
  Layers3,
  MessageSquare,
  Radio,
  RefreshCw,
  ShieldCheck,
  TriangleAlert,
} from "lucide-react";
import {
  api,
  type Case,
  type Evidence,
  type Identity,
  type Session,
} from "../../lib/livelens/api";
import "./review-desk.css";

type DeskView =
  | "sources"
  | "sessions"
  | "missions"
  | "investigations"
  | "alerts";
type Source = {
  id: string;
  sessionId?: string | null;
  kind: string;
  label: string;
};
type Capabilities = { enabled: string[]; scopes: string[] };
type Finding = {
  id: string;
  title: string;
  statement: string;
  status: string;
  label?: string;
  supportEvidenceIds: string[];
  counterEvidenceIds: string[];
  history: { createdAtMs: number; reviewer?: string; reason?: string }[];
};
type Detail = {
  case: Case;
  evidence: Evidence[];
  findings: Finding[];
  truncated?: boolean;
};
type Alert = {
  id: string;
  missionId: string;
  ruleLabel: string;
  status: string;
  sessionId: string;
  evidenceId: string;
  evidenceIds: string[];
  contextEvidenceIds: string[];
  gapEvidenceIds: string[];
  matchedTerms: string[];
  uncertainty: string[];
  createdAtMs: number;
};
type Schedule = {
  id: string;
  sourceId: string;
  state: string;
  status: string;
  startAtMs: number;
  endAtMs: number;
  lastCheckedAtMs: number | null;
  nextPollAtMs: number;
  sessionId: string | null;
  error: string | null;
};
type Context = {
  event: Evidence;
  session: Session;
  before: Evidence[];
  after: Evidence[];
  relationship?: string;
};
type Tab = "all" | "review" | "evidence";
export type DeskItem = {
  id: string;
  kind: "alert" | "finding" | "gap" | "evidence" | "session";
  title: string;
  summary: string;
  atMs: number;
  state: string;
  needsReview: boolean;
  sessionId?: string;
  evidenceId?: string;
  caseId?: string;
  evidence: Evidence[];
  supportIds: string[];
  counterIds: string[];
  finding?: Finding;
  alert?: Alert;
};
export type DeskAction = {
  itemId: string | null;
  busy: boolean;
  error: string;
  receipt: string;
};
const emptyAction: DeskAction = {
  itemId: null,
  busy: false,
  error: "",
  receipt: "",
};
export function actionForDeskItem(
  action: DeskAction,
  item: DeskItem | null,
): DeskAction {
  return item && action.itemId === item.id ? action : emptyAction;
}
export function sourceForDeskItem(
  item: DeskItem | null,
  choice: { itemId: string; evidenceId: string } | null,
): string | undefined {
  if (
    item &&
    choice?.itemId === item.id &&
    [...item.supportIds, ...item.counterIds].includes(choice.evidenceId)
  )
    return choice.evidenceId;
  return item?.evidenceId;
}
const excerpt = (value: string, limit = 170) =>
  value.length > limit ? value.slice(0, limit).trimEnd() + "…" : value;
const date = (value: number | null | undefined) =>
  value == null
    ? "Unavailable"
    : new Date(value).toLocaleString([], {
        month: "short",
        day: "numeric",
        hour: "2-digit",
        minute: "2-digit",
      });
const fullDate = (value: number | null | undefined) =>
  value == null ? "Unavailable" : new Date(value).toLocaleString();
const readable = (value: string) => value.replaceAll(/[_-]/g, " ");
const failure = (value: unknown) =>
  value instanceof Error
    ? readable(value.message)
    : "The service could not load these records.";
const eventTitle = (event: Evidence) =>
  ({
    chat: "Captured chat",
    caption: "Captured caption",
    transcript: "Captured speech",
    observation: "Source observation",
    gap: "Capture gap",
  })[event.kind] ?? "Retained evidence";
const iconFor = (kind: DeskItem["kind"]) =>
  ({
    alert: Bell,
    finding: FileText,
    gap: TriangleAlert,
    evidence: MessageSquare,
    session: Layers3,
  })[kind];
const kindLabel = (kind: DeskItem["kind"]) =>
  ({
    alert: "Protection signal",
    finding: "Draft finding",
    gap: "Capture gap",
    evidence: "Retained evidence",
    session: "Retained conversation",
  })[kind];

// Category order is an operator navigation aid, never a risk or truth score.
export function buildDeskItems({
  evidence,
  alerts,
  details,
  sessions,
}: {
  evidence: Evidence[];
  alerts: Alert[];
  details: Detail[];
  sessions: Session[];
}): { items: DeskItem[]; truncated: boolean } {
  const items: DeskItem[] = [];
  const knownEvidence = new Map(evidence.map((item) => [item.id, item]));
  for (const detail of details)
    for (const item of detail.evidence) knownEvidence.set(item.id, item);
  for (const alert of alerts) {
    items.push({
      id: `alert:${alert.id}`,
      kind: "alert",
      title: alert.ruleLabel || "Protection signal",
      summary: alert.matchedTerms.length
        ? `Literal match: ${alert.matchedTerms.join(", ")}. Review the original context.`
        : "A retained rule match needs human review.",
      atMs: alert.createdAtMs,
      state:
        alert.status === "pending"
          ? "Needs review"
          : readable(alert.status).replace(/^./, (letter) =>
              letter.toUpperCase(),
            ),
      needsReview: alert.status === "pending",
      sessionId: alert.sessionId,
      evidenceId: alert.evidenceId,
      evidence: alert.evidenceIds
        .map((id) => knownEvidence.get(id))
        .filter((event): event is Evidence => !!event),
      supportIds: alert.evidenceIds,
      counterIds: [],
      alert,
    });
  }
  for (const detail of details)
    for (const finding of detail.findings) {
      if (finding.status !== "draft") continue;
      const source = finding.supportEvidenceIds
        .map((id) => knownEvidence.get(id))
        .find((event) => !!event);
      items.push({
        id: `finding:${detail.case.id}:${finding.id}`,
        kind: "finding",
        title: finding.title,
        summary: finding.statement,
        atMs: finding.history.at(-1)?.createdAtMs ?? detail.case.createdAtMs,
        state: "Draft",
        needsReview: true,
        caseId: detail.case.id,
        sessionId: source?.sessionId,
        evidenceId: source?.id ?? finding.supportEvidenceIds[0],
        evidence: detail.evidence,
        supportIds: finding.supportEvidenceIds,
        counterIds: finding.counterEvidenceIds,
        finding,
      });
    }
  for (const event of evidence)
    items.push({
      id: `evidence:${event.id}`,
      kind: event.kind === "gap" ? "gap" : "evidence",
      title: eventTitle(event),
      summary: event.text || "The original source record contains no text.",
      atMs: event.receivedAtMs,
      state: event.kind === "gap" ? "Capture gap" : "Retained",
      needsReview: false,
      sessionId: event.sessionId,
      evidenceId: event.id,
      evidence: [event],
      supportIds: [],
      counterIds: [],
    });
  // Conversations without a loaded evidence row remain available. Their age is
  // a source start time, not an invented capture/review timestamp.
  const representedSessions = new Set(
    items.map((item) => item.sessionId).filter(Boolean),
  );
  for (const session of sessions.slice(0, 6))
    if (!representedSessions.has(session.id))
      items.push({
        id: `session:${session.id}`,
        kind: "session",
        title: session.title,
        summary:
          "Open the retained conversation and inspect its original records.",
        atMs: session.startedAtMs,
        state: "Retained",
        needsReview: false,
        sessionId: session.id,
        evidence: [],
        supportIds: [],
        counterIds: [],
      });
  const category = { alert: 0, finding: 1, gap: 2, evidence: 3, session: 4 };
  const unique = [
    ...new Map(items.map((item) => [item.id, item])).values(),
  ].sort(
    (a, b) =>
      category[a.kind] - category[b.kind] ||
      b.atMs - a.atMs ||
      a.id.localeCompare(b.id),
  );
  return {
    items: unique.slice(0, 200),
    truncated:
      unique.length > 200 || details.some((detail) => detail.truncated),
  };
}
export function filterDeskItems(items: DeskItem[], tab: Tab) {
  return items.filter(
    (item) =>
      tab === "all" ||
      (tab === "review"
        ? item.needsReview
        : ["evidence", "gap", "session"].includes(item.kind)),
  );
}

function useDeskResource<T>(
  path: string | null,
  revision: number,
  identityKey: string,
) {
  const key = `${identityKey}:${path ?? ""}`;
  const [state, setState] = useState<{
    key: string;
    data: T | null;
    loading: boolean;
    error: string;
  }>({ key, data: null, loading: !!path, error: "" });
  useEffect(() => {
    let active = true;
    setState((old) => ({
      key,
      data: old.key === key && path ? old.data : null,
      loading: !!path,
      error: "",
    }));
    if (path)
      api<T>(path)
        .then((data) => {
          if (active) setState({ key, data, loading: false, error: "" });
        })
        .catch((error) => {
          if (active)
            setState((old) => ({
              key,
              data: old.key === key ? old.data : null,
              loading: false,
              error: failure(error),
            }));
        });
    return () => {
      active = false;
    };
  }, [path, revision, key]);
  return state.key === key
    ? state
    : { key, data: null, loading: !!path, error: "" };
}
function useCaseDetails(
  cases: Case[],
  enabled: boolean,
  revision: number,
  identityKey: string,
) {
  const ids = enabled
    ? cases
        .slice(0, 6)
        .map((item) => item.id)
        .join(",")
    : "";
  const key = `${identityKey}:${ids}`;
  const [state, setState] = useState<{
    key: string;
    data: Detail[];
    loading: boolean;
    error: string;
  }>({ key, data: [], loading: !!ids, error: "" });
  useEffect(() => {
    let active = true;
    setState((old) => ({
      key,
      data: old.key === key ? old.data : [],
      loading: !!ids,
      error: "",
    }));
    if (ids)
      Promise.allSettled(
        ids
          .split(",")
          .map((id) =>
            api<Detail>(`/v1/investigations/${encodeURIComponent(id)}`),
          ),
      ).then((results) => {
        if (!active) return;
        const data = results.flatMap((result) =>
          result.status === "fulfilled" ? [result.value] : [],
        );
        const failed = results.length - data.length;
        setState({
          key,
          data,
          loading: false,
          error: failed
            ? `${failed} investigation${failed === 1 ? "" : "s"} could not be loaded. The inbox includes only accessible results.`
            : "",
        });
      });
    return () => {
      active = false;
    };
  }, [ids, revision, key]);
  return state.key === key
    ? state
    : { key, data: [], loading: !!ids, error: "" };
}
function ResourceNotice({
  loading,
  error,
}: {
  loading: boolean;
  error: string;
}) {
  return (
    <>
      {loading && (
        <p className="ll-desk-status" role="status">
          <RefreshCw size={14} aria-hidden /> Loading retained records…
        </p>
      )}
      {error && (
        <p className="ll-desk-error" role="alert">
          {error}
        </p>
      )}
    </>
  );
}
function Attribution({ event }: { event: Evidence }) {
  const speaker = (event as Evidence & { speakerId?: string | null }).speakerId;
  return (
    <p className="ll-desk-attribution">
      {event.attribution.account
        ? `@${event.attribution.account} · ${readable(event.attribution.status)}`
        : "Account unknown"}
      {speaker
        ? speaker === "unseparated"
          ? " · Unseparated audio track"
          : ` · Anonymous track ${speaker}`
        : ["caption", "transcript"].includes(event.kind)
          ? " · Speaker identity unassigned"
          : ""}
    </p>
  );
}

export default function ReviewDesk({
  identity,
  sessions,
  cases,
  sources,
  revision,
  capabilities,
  onNavigate,
  onOpenSession,
  onOpenEvidence,
  onOpenInvestigation,
  renderMedia,
}: {
  identity: Identity;
  sessions: Session[];
  cases: Case[];
  sources: Source[];
  revision: number;
  capabilities?: Capabilities;
  onNavigate: (view: DeskView) => void;
  onOpenSession: (id: string) => void;
  onOpenEvidence: (sessionId: string, evidenceId: string) => void;
  onOpenInvestigation: (caseId: string) => void;
  renderMedia: (sessionId: string, event: Evidence | null) => ReactNode;
}) {
  const identityKey = `${identity.workspace}:${identity.subject}`;
  const has = (...scopes: string[]) =>
    scopes.every((scope) => capabilities?.scopes.includes(scope));
  const enabled = (capability: string) =>
    capabilities?.enabled.includes(capability) ?? false;
  const [localRevision, setLocalRevision] = useState(0);
  const refresh = revision + localRevision;
  const evidence = useDeskResource<{ evidence: Evidence[] }>(
    has("evidence:read") ? "/v1/evidence/search?limit=100" : null,
    refresh,
    identityKey,
  );
  const alerts = useDeskResource<{ alerts: Alert[] }>(
    has("missions:read", "evidence:read") && enabled("reviewed-alerts")
      ? "/v1/alerts?limit=100"
      : null,
    refresh,
    identityKey,
  );
  const details = useCaseDetails(
    cases,
    !!has("cases:read", "evidence:read"),
    refresh,
    identityKey,
  );
  const schedules = useDeskResource<{ schedules: Schedule[] }>(
    has("recordings:read") && enabled("bounded-source-schedules")
      ? "/v1/schedules"
      : null,
    refresh,
    identityKey,
  );
  const queue = useMemo(
    () =>
      buildDeskItems({
        evidence: evidence.data?.evidence ?? [],
        alerts: alerts.data?.alerts ?? [],
        details: details.data,
        sessions,
      }),
    [evidence.data, alerts.data, details.data, sessions],
  );
  const [tab, setTab] = useState<Tab>("all");
  const visible = filterDeskItems(queue.items, tab);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [previewOpen, setPreviewOpen] = useState(false);
  const selected =
    visible.find((item) => item.id === selectedId) ?? visible[0] ?? null;
  const [sourceChoice, setSourceChoice] = useState<{
    itemId: string;
    evidenceId: string;
  } | null>(null);
  const selectedEvidenceId = sourceForDeskItem(selected, sourceChoice);
  const context = useDeskResource<Context>(
    selectedEvidenceId && has("sessions:read", "evidence:read")
      ? `/v1/evidence/${encodeURIComponent(selectedEvidenceId)}/context?limit=4`
      : null,
    refresh,
    identityKey,
  );
  const exactEvent =
    context.data?.event ??
    selected?.evidence.find((event) => event.id === selectedEvidenceId) ??
    null;
  const previewSessionId =
    context.data?.session.id ?? exactEvent?.sessionId ?? selected?.sessionId;
  const previewSession =
    context.data?.session ??
    sessions.find((item) => item.id === previewSessionId);
  const [action, setAction] = useState<DeskAction>(emptyAction);
  const itemAction = actionForDeskItem(action, selected);
  const actionToken = useRef(0);
  const inspector = useRef<HTMLElement>(null);
  const itemButtons = useRef(new Map<string, HTMLButtonElement>());
  const tabButtons = useRef(new Map<Tab, HTMLButtonElement>());
  const tabId = useId();
  const listId = useId();
  const previousIdentity = useRef(identityKey);
  useEffect(() => {
    if (previousIdentity.current !== identityKey) {
      actionToken.current += 1;
      setSelectedId(null);
      setSourceChoice(null);
      setPreviewOpen(false);
      setAction(emptyAction);
    }
    previousIdentity.current = identityKey;
  }, [identityKey]);
  const select = (item: DeskItem) => {
    actionToken.current += 1;
    setSelectedId(item.id);
    setSourceChoice(null);
    setPreviewOpen(true);
    setAction(emptyAction);
    requestAnimationFrame(() => {
      if (matchMedia("(max-width: 760px)").matches) inspector.current?.focus();
    });
  };
  const back = () => {
    setPreviewOpen(false);
    requestAnimationFrame(() => {
      if (selected) itemButtons.current.get(selected.id)?.focus();
    });
  };
  const changeTab = (value: Tab) => {
    actionToken.current += 1;
    setTab(value);
    setPreviewOpen(false);
    setAction(emptyAction);
  };
  const acknowledge = async () => {
    if (!selected?.alert || itemAction.busy) return;
    const itemId = selected.id;
    const alertId = selected.alert.id;
    const token = ++actionToken.current;
    setAction({ itemId, busy: true, error: "", receipt: "" });
    try {
      await api(`/v1/alerts/${encodeURIComponent(alertId)}/review`, {
        status: "acknowledged",
        reason:
          "Acknowledged from the review desk; original context remains available for review.",
      });
      if (actionToken.current === token)
        setAction({
          itemId,
          busy: false,
          error: "",
          receipt:
            "Signal acknowledged. A source-backed review is still required.",
        });
      setLocalRevision((value) => value + 1);
    } catch (error) {
      if (actionToken.current === token)
        setAction({ itemId, busy: false, error: failure(error), receipt: "" });
    }
  };
  const needsReview = queue.items.filter((item) => item.needsReview).length;
  const recent = filterDeskItems(queue.items, "evidence").length;
  const runningSchedules = (schedules.data?.schedules ?? []).filter(
    (schedule) => !["completed", "failed", "stopped"].includes(schedule.state),
  );
  const runningScheduleKey = runningSchedules
    .map((schedule) => schedule.id)
    .sort()
    .join("|");
  const [scheduleExpanded, setScheduleExpanded] = useState(false);
  useEffect(() => setScheduleExpanded(false), [identityKey]);
  useEffect(() => {
    if (runningScheduleKey) setScheduleExpanded(true);
  }, [identityKey, runningScheduleKey]);
  const activeSchedules = [...(schedules.data?.schedules ?? [])]
    .sort(
      (a, b) =>
        Number(["completed", "failed", "stopped"].includes(a.state)) -
          Number(["completed", "failed", "stopped"].includes(b.state)) ||
        a.endAtMs - b.endAtMs,
    )
    .slice(0, 2);
  const nextWindowClose = runningSchedules.length
    ? Math.min(...runningSchedules.map((schedule) => schedule.endAtMs))
    : null;
  const scheduleContext = schedules.error
    ? `Schedules unavailable${runningSchedules.length ? ` · ${runningSchedules.length} active in the last loaded records` : ""}`
    : runningSchedules.length
      ? `${runningSchedules.length} active window${runningSchedules.length === 1 ? "" : "s"} · next closes ${date(nextWindowClose)}`
      : schedules.loading
        ? "Loading schedules…"
        : !has("recordings:read")
          ? "Schedule access unavailable"
          : !enabled("bounded-source-schedules")
            ? "Schedules not configured"
            : `${sources.length} selected source${sources.length === 1 ? "" : "s"} · no active window loaded`;
  const clockRows = exactEvent
    ? ([
        ["Provider time", exactEvent.sourceTimestampMs],
        ["Collector time", exactEvent.capturedAtMs],
        ["Receipt time", exactEvent.receivedAtMs],
      ] as const)
    : [];
  const neighbouring = context.data
    ? [...context.data.before.slice(-2), ...context.data.after.slice(0, 2)]
    : [];
  const sourceIds = selected
    ? [...new Set([...selected.supportIds, ...selected.counterIds])]
    : [];
  const ready = !!capabilities;
  const queueLoading =
    !ready || evidence.loading || alerts.loading || details.loading;
  return (
    <div
      className={`ll-desk${previewOpen && selected ? " has-selection" : ""}`}
    >
      <div className="ll-desk-body">
        <section className="ll-desk-inbox" aria-label="Review inbox">
          <details
            className="ll-desk-collection"
            open={scheduleExpanded}
            onToggle={(event) => setScheduleExpanded(event.currentTarget.open)}
          >
            <summary>
              <CalendarClock size={16} aria-hidden />
              <span className="ll-desk-collection-title">Collection schedule</span>
              <span className="ll-desk-collection-context">{scheduleContext}</span>
              <ChevronRight size={15} aria-hidden />
            </summary>
          <section
            className="ll-desk-schedule-strip"
            aria-label="Selected source schedules"
          >
            <div className="ll-desk-schedule-head">
              <div>
                <h2>Selected sources</h2>
                <p>Bounded collection windows for this workspace</p>
              </div>
              <button onClick={() => onNavigate("missions")}>
                View missions <ArrowRight size={14} aria-hidden />
              </button>
            </div>
            <ResourceNotice
              loading={schedules.loading}
              error={schedules.error}
            />
            {activeSchedules.length
              ? activeSchedules.map((schedule) => {
                  const source = sources.find(
                    (item) => item.id === schedule.sourceId,
                  );
                  return (
                    <article className="ll-desk-source" key={schedule.id}>
                      <span className="ll-desk-source-icon">
                        <Radio size={20} aria-hidden />
                      </span>
                      <div className="ll-desk-source-main">
                        <strong>{source?.label ?? "Selected source"}</strong>
                        <small>
                          {readable(schedule.state)} · closes{" "}
                          {date(schedule.endAtMs)}
                        </small>
                        <small>
                          {schedule.lastCheckedAtMs == null
                            ? "Provider status has not been checked"
                            : `Last observed: ${readable(schedule.status)} · ${date(schedule.lastCheckedAtMs)}`}
                          {schedule.error
                            ? ` · ${readable(schedule.error)}`
                            : ""}
                        </small>
                      </div>
                      <span className="ll-desk-source-state">
                        <CalendarClock size={14} aria-hidden />
                        {date(schedule.startAtMs)}
                      </span>
                    </article>
                  );
                })
              : sources.length
                ? sources.slice(0, 2).map((source) => (
                    <article className="ll-desk-source" key={source.id}>
                      <span className="ll-desk-source-icon">
                        <Radio size={20} aria-hidden />
                      </span>
                      <div className="ll-desk-source-main">
                        <strong>{source.label}</strong>
                        <small>
                          {readable(source.kind)} · configured source
                        </small>
                      </div>
                      <span className="ll-desk-source-state">
                        {schedules.loading
                          ? "Loading schedules"
                          : schedules.error
                            ? "Schedules unavailable"
                            : !has("recordings:read")
                              ? "Schedule access unavailable"
                              : !enabled("bounded-source-schedules")
                                ? "Schedules not configured"
                                : "No loaded schedule"}
                      </span>
                    </article>
                  ))
                : !schedules.loading && (
                    <p className="ll-desk-empty">
                      No selected sources are available. Add a permitted source
                      to start a bounded capture.
                    </p>
                  )}
            <div className="ll-desk-schedule-foot">
              <span>
                {sources.length} configured source
                {sources.length === 1 ? "" : "s"}
                {activeSchedules.length
                  ? ` · ${activeSchedules.length} schedules shown`
                  : ""}
              </span>
              <button onClick={() => onNavigate("sources")}>
                View schedules <ArrowRight size={14} aria-hidden />
              </button>
            </div>
          </section>
          </details>
          <div className="ll-desk-heading ll-desk-inbox-head">
            <div>
              <h2>{tab === "review" ? "Needs your review" : tab === "evidence" ? "Recent evidence" : "Review inbox"}</h2>
              <p>Captured sources, signals and draft interpretations</p>
            </div>
            <div
              className="ll-desk-tabs"
              role="tablist"
              aria-label="Review inbox filters"
            >
              {(
                [
                  ["all", "All", queue.items.length],
                  ["review", "Needs review", needsReview],
                  ["evidence", "Recent evidence", recent],
                ] as const
              ).map(([value, label, count]) => (
                <button
                  key={value}
                  id={`${tabId}-${value}`}
                  role="tab"
                  aria-selected={tab === value}
                  aria-controls={listId}
                  tabIndex={tab === value ? 0 : -1}
                  ref={(element) => {
                    if (element) tabButtons.current.set(value, element);
                    else tabButtons.current.delete(value);
                  }}
                  onClick={() => changeTab(value)}
                  onKeyDown={(event) => {
                    const values: Tab[] = ["all", "review", "evidence"];
                    const index = values.indexOf(value);
                    const next =
                      event.key === "ArrowRight"
                        ? values[(index + 1) % values.length]
                        : event.key === "ArrowLeft"
                          ? values[(index + values.length - 1) % values.length]
                          : event.key === "Home"
                            ? values[0]
                            : event.key === "End"
                              ? values.at(-1)!
                              : null;
                    if (next) {
                      event.preventDefault();
                      changeTab(next);
                      tabButtons.current.get(next)?.focus();
                    }
                  }}
                >
                  {label} <span>{count}</span>
                </button>
              ))}
            </div>
          </div>
          <ResourceNotice
            loading={queueLoading}
            error={[evidence.error, alerts.error, details.error]
              .filter(Boolean)
              .join(" ")}
          />
          {!has("evidence:read") && ready && (
            <p className="ll-desk-status">
              Your access includes retained conversations. Evidence review needs
              evidence access.
            </p>
          )}
          <div
            className="ll-desk-list"
            id={listId}
            role="tabpanel"
            aria-labelledby={`${tabId}-${tab}`}
          >
            {visible.map((item) => {
              const Icon = iconFor(item.kind);
              const source = item.evidence.find(
                (event) => event.id === item.evidenceId,
              );
              const session = sessions.find(
                (entry) => entry.id === item.sessionId,
              );
              return (
                <button
                  className={`ll-desk-item${selected?.id === item.id ? " is-selected" : ""}`}
                  key={item.id}
                  aria-pressed={selected?.id === item.id}
                  onClick={() => select(item)}
                  ref={(element) => {
                    if (element) itemButtons.current.set(item.id, element);
                    else itemButtons.current.delete(item.id);
                  }}
                >
                  <span
                    className={`ll-desk-item-visual ll-desk-item-visual-${item.kind}`}
                  >
                    <Icon size={24} aria-hidden />
                    <small>{kindLabel(item.kind)}</small>
                  </span>
                  <span className="ll-desk-item-main">
                    <span className="ll-desk-item-kind">
                      {item.kind === "finding" &&
                      item.finding?.label === "model-proposal"
                        ? "Model proposal · review required"
                        : kindLabel(item.kind)}
                    </span>
                    <strong className="ll-desk-item-title">{item.title}</strong>
                    <span className="ll-desk-item-summary">
                      {excerpt(item.summary)}
                    </span>
                    <small className="ll-desk-item-meta">
                      {source?.attribution.account
                        ? `@${source.attribution.account}`
                        : (session?.title ??
                          (item.caseId
                            ? "Investigation"
                            : "Account unknown"))}{" "}
                      · {date(item.atMs)}
                      {item.kind === "session"
                        ? " · source start"
                        : " · retained"}
                    </small>
                  </span>
                  <span
                    className={`ll-desk-item-state ll-desk-item-state-${item.kind}`}
                  >
                    {item.kind === "gap" && (
                      <TriangleAlert size={13} aria-hidden />
                    )}
                    {item.state}
                  </span>
                  <ChevronRight size={16} aria-hidden />
                </button>
              );
            })}
            {!queueLoading && !visible.length && (
              <div className="ll-desk-empty">
                <FolderOpen size={24} aria-hidden />
                <h3>
                  {tab === "review"
                    ? "No loaded signals need review"
                    : tab === "evidence"
                      ? "No recent evidence is available"
                      : "Your review desk is ready"}
                </h3>
                <p>
                  {tab === "review"
                    ? "Draft findings and pending protection signals will appear here. Recent evidence remains available in the other tabs."
                    : "Capture a selected source or open your conversation library to begin."}
                </p>
                <button onClick={() => onNavigate("sources")}>
                  View sources <ArrowRight size={14} aria-hidden />
                </button>
              </div>
            )}
          </div>
          <details className="ll-desk-partial">
            <summary>Showing recent accessible records</summary>
            <p>
              This desk shows up to 100 recent evidence records, 100 protection
              signals and drafts from up to six accessible investigations.
              {queue.truncated
                ? " The displayed inbox is capped at 200 items; open the libraries for the full retained record."
                : " Counts describe this loaded selection."}{" "}
              Ordinary evidence has no persisted review status.
            </p>
          </details>
        </section>
        <aside
          className={`ll-desk-inspector${previewOpen && selected ? " is-open" : ""}`}
          ref={inspector}
          tabIndex={-1}
          aria-label="Selected source inspector"
        >
          <button className="ll-desk-preview-back" onClick={back}>
            <ArrowLeft size={16} aria-hidden /> Back to inbox
          </button>
          {selected ? (
            <>
              <div className="ll-desk-inspector-head">
                <span>Selected item</span>
                {exactEvent && (
                  <button
                    onClick={() =>
                      onOpenEvidence(exactEvent.sessionId, exactEvent.id)
                    }
                  >
                    View source <ArrowRight size={14} aria-hidden />
                  </button>
                )}
              </div>
              <h2>{selected.title}</h2>
              <p className="ll-desk-item-kind">
                {kindLabel(selected.kind)} · {selected.state}
              </p>
              {sourceIds.length > 1 && (
                <label className="ll-desk-source-select">
                  Source statement
                  <select
                    aria-label="Source statement"
                    value={selectedEvidenceId ?? ""}
                    onChange={(event) =>
                      setSourceChoice({
                        itemId: selected.id,
                        evidenceId: event.target.value,
                      })
                    }
                  >
                    {sourceIds.map((id) => {
                      const source = selected.evidence.find(
                        (event) => event.id === id,
                      );
                      const role = selected.counterIds.includes(id)
                        ? selected.supportIds.includes(id)
                          ? "Support and counterevidence"
                          : "Counterevidence"
                        : "Support";
                      return (
                        <option key={id} value={id}>
                          {role}:{" "}
                          {source
                            ? excerpt(source.text || eventTitle(source), 72)
                            : "Source unavailable"}
                        </option>
                      );
                    })}
                  </select>
                </label>
              )}
              <ResourceNotice loading={context.loading} error={context.error} />
              {previewSessionId &&
                has("sessions:read", "recordings:read") &&
                enabled("retained-media-replay") && (
                  <div className="ll-desk-media">
                    {renderMedia(previewSessionId, exactEvent)}
                  </div>
                )}
              {previewSession?.platform === "fixture" && (
                <p className="ll-desk-provenance">Labelled demo conversation</p>
              )}
              {exactEvent ? (
                <>
                  <blockquote className="ll-desk-quote">
                    {exactEvent.text || "The source record contains no text."}
                  </blockquote>
                  <Attribution event={exactEvent} />
                  <details className="ll-desk-source-details">
                    <summary>Source details and clocks</summary>
                    <dl className="ll-desk-clocks">
                      {clockRows.map(([label, value]) => (
                        <div key={label}>
                          <dt>{label}</dt>
                          <dd>{fullDate(value)}</dd>
                        </div>
                      ))}
                    </dl>
                    <small className="ll-desk-provenance">
                      {readable(exactEvent.kind)} · {exactEvent.source.adapter}{" "}
                      · Evidence {exactEvent.id}
                    </small>
                    <p className="ll-desk-provenance">
                      Provider event {exactEvent.source.eventId}
                      <br />
                      Original payload SHA-256{" "}
                      {exactEvent.integrity.payloadSha256}
                    </p>
                  </details>
                </>
              ) : selected.kind === "session" ? (
                <div className="ll-desk-context">
                  <h3>Retained conversation</h3>
                  <p>{previewSession?.title ?? selected.title}</p>
                  <p>
                    Open the library to inspect this conversation’s original
                    evidence.
                  </p>
                </div>
              ) : (
                !context.loading && (
                  <p className="ll-desk-empty">
                    The original statement is unavailable in this preview.
                    Reopen the retained conversation or investigation to check
                    access and context.
                  </p>
                )
              )}
              <div className="ll-desk-actions">
                {selected.caseId ? (
                  <button
                    className="ll-primary"
                    onClick={() => onOpenInvestigation(selected.caseId!)}
                  >
                    <FolderOpen size={17} aria-hidden /> Open investigation{" "}
                    <ArrowRight size={16} aria-hidden />
                  </button>
                ) : exactEvent ? (
                  <button
                    className="ll-primary"
                    onClick={() =>
                      onOpenEvidence(exactEvent.sessionId, exactEvent.id)
                    }
                  >
                    Open original context <ArrowRight size={16} aria-hidden />
                  </button>
                ) : previewSessionId ? (
                  <button
                    className="ll-primary"
                    onClick={() => onOpenSession(previewSessionId)}
                  >
                    Open conversation <ArrowRight size={16} aria-hidden />
                  </button>
                ) : (
                  <button
                    className="ll-primary"
                    onClick={() => onNavigate("sessions")}
                  >
                    Open library <ArrowRight size={16} aria-hidden />
                  </button>
                )}
                {selected.alert && (
                  <button onClick={() => onNavigate("alerts")}>
                    Review protection signal{" "}
                    <ArrowRight size={15} aria-hidden />
                  </button>
                )}
                {selected.alert?.status === "pending" &&
                  has("missions:write") && (
                    <button disabled={itemAction.busy} onClick={acknowledge}>
                      <Check size={15} aria-hidden />{" "}
                      {itemAction.busy
                        ? "Acknowledging…"
                        : "Acknowledge signal"}
                    </button>
                  )}
              </div>
              {itemAction.error && (
                <p className="ll-desk-error" role="alert">
                  {itemAction.error}
                </p>
              )}
              {itemAction.receipt && (
                <p className="ll-desk-status" role="status">
                  {itemAction.receipt}
                </p>
              )}
              {context.data && (
                <section className="ll-desk-context">
                  <h3>Original context</h3>
                  {neighbouring.length ? (
                    neighbouring.map((event) => (
                      <button
                        className={`ll-desk-context-row${event.kind === "gap" ? " is-gap" : ""}`}
                        key={event.id}
                        onClick={() =>
                          onOpenEvidence(event.sessionId, event.id)
                        }
                      >
                        <span>
                          {event.sourceTimestampMs == null
                            ? "Provider time unavailable"
                            : date(event.sourceTimestampMs)}
                        </span>
                        <span>
                          <strong>{eventTitle(event)}</strong>
                          <span>{excerpt(event.text, 220)}</span>
                        </span>
                      </button>
                    ))
                  ) : (
                    <p>
                      No neighbouring evidence is retained in this context
                      window.
                    </p>
                  )}
                  <p className="ll-desk-provenance">
                    Nearby records show temporal context; proximity does not
                    establish causation or complete capture.
                  </p>
                </section>
              )}
              {selected.finding && (
                <section className="ll-desk-interpretation">
                  <h3>
                    <FileText size={15} aria-hidden /> Draft interpretation
                  </h3>
                  <p>{selected.finding.statement}</p>
                  <small>
                    {selected.finding.label === "model-proposal"
                      ? "Model proposal; human review required"
                      : "Operator finding; human review required"}{" "}
                    · {selected.supportIds.length} supporting statement
                    {selected.supportIds.length === 1 ? "" : "s"} ·{" "}
                    {selected.counterIds.length} counterevidence statement
                    {selected.counterIds.length === 1 ? "" : "s"}
                  </small>
                </section>
              )}
              {selected.alert && (
                <section className="ll-desk-interpretation">
                  <h3>
                    <ShieldCheck size={15} aria-hidden /> Signal context
                  </h3>
                  <p>
                    Literal matches:{" "}
                    {selected.alert.matchedTerms.join(", ") || "None recorded"}
                  </p>
                  {selected.alert.uncertainty.map((note, index) => (
                    <p className="ll-desk-provenance" key={index}>
                      {note}
                    </p>
                  ))}
                  <small>
                    {selected.alert.gapEvidenceIds.length} linked capture gap
                    {selected.alert.gapEvidenceIds.length === 1 ? "" : "s"} ·
                    Signal {selected.alert.id}
                  </small>
                </section>
              )}
              {selected.kind === "gap" && (
                <p className="ll-desk-provenance">
                  This is an original capture-gap record. Duration and missing
                  content are not inferred from neighbouring statements.
                </p>
              )}
            </>
          ) : (
            <div className="ll-desk-empty">
              <Layers3 size={28} aria-hidden />
              <h3>Inspect the original source</h3>
              <p>
                Select a retained item to see its words, clocks, media and
                context.
              </p>
            </div>
          )}
        </aside>
      </div>
    </div>
  );
}
