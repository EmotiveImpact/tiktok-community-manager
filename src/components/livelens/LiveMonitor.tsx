import { useEffect, useRef, useState, type FormEvent, type ReactNode } from "react";
import { ArrowRight, Circle, Clock3, MessageSquare, Plus, Radio, Square, Video } from "lucide-react";
import { api, type Evidence, type Session } from "../../lib/livelens/api";
import "./live-monitor.css";

type Source = { id: string; label: string; kind: string; account?: string | null; sessionId?: string | null; fixture?: boolean };
type Job = { id: string; sourceId: string; sessionId: string; state: string; createdAtMs: number; deadlineMs: number | null; maxDurationSeconds: number; stopRequested: boolean; error: string | null; segments: { id: string; bytes: number; durationMs: number }[] };
type Schedule = { id: string; sourceId: string; state: string; status: string; createdAtMs: number; endAtMs: number; lastCheckedAtMs: number | null; sessionId: string | null; jobId: string | null; autoRecord: boolean; error: string | null };
type Snapshot = { sources: Source[]; jobs: Job[]; schedules: Schedule[] };
const terminal = (state: string) => ["completed", "stopped", "failed"].includes(state);
const time = (value: number) => new Date(value).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" });
const duration = (seconds: number) => `${Math.floor(seconds / 60)}:${String(Math.floor(seconds % 60)).padStart(2, "0")}`;
const bytes = (value: number) => value >= 1024 * 1024 ? `${(value / 1024 / 1024).toFixed(1)} MB` : `${Math.round(value / 1024)} KB`;
const sourceName = (source: Source) => source.account ? `@${source.account}` : source.label;
const errorText = (error: unknown) => error instanceof Error ? error.message.replaceAll("_", " ") : "Service unavailable";

export default function LiveMonitor({ scopes, enabled, revision, sessions, onRefresh, onOpenSession, onOpenEvidence, onSources, renderMedia }: {
  scopes: string[]; enabled: string[]; revision: number; sessions: Session[];
  onRefresh: () => void; onOpenSession: (id: string) => void; onOpenEvidence: (session: string, evidence: string) => void;
  onSources: () => void; renderMedia: (session: string, evidence: Evidence | undefined, revision: number, jobId?: string) => ReactNode;
}) {
  const [snapshot, setSnapshot] = useState<Snapshot>({ sources: [], jobs: [], schedules: [] });
  const [tick, setTick] = useState(0), [loading, setLoading] = useState(true), [error, setError] = useState("");
  const [selectedId, setSelectedId] = useState<string | null>(null), [replayId, setReplayId] = useState<string | null>(null);
  const [replayJobId, setReplayJobId] = useState<string | undefined>();
  const [busy, setBusy] = useState(false), [notice, setNotice] = useState("");
  const [limit, setLimit] = useState(16), [windowMinutes, setWindowMinutes] = useState(5);
  const [events, setEvents] = useState<Evidence[]>([]), [eventsError, setEventsError] = useState("");
  const [moreEvents, setMoreEvents] = useState(false);
  const eventCursor = useRef(0);
  const [tab, setTab] = useState("chat"), [selectedEvidence, setSelectedEvidence] = useState<Evidence>();
  const requestGeneration = useRef(0);
  const readable = scopes.includes("recordings:read");
  const writable = scopes.includes("recordings:write");
  const canAdd = writable && scopes.includes("workspace:admin");
  const scheduling = enabled.includes("bounded-source-schedules");
  const recording = enabled.includes("bounded-recording");
  const validLimit = Number.isInteger(limit) && limit >= 2 && limit <= 3600;
  const validWindow = Number.isInteger(windowMinutes) && windowMinutes >= 1 && windowMinutes <= 1440;
  const refreshKey = revision + tick;

  useEffect(() => {
    let active = true;
    if (!readable) { setLoading(false); return; }
    Promise.all([
      api<{ sources: Source[] }>("/v1/sources"),
      recording ? api<{ jobs: Job[] }>("/v1/jobs?limit=100") : Promise.resolve({ jobs: [] }),
      recording ? api<{ jobs: Job[] }>("/v1/jobs?active=true&limit=200") : Promise.resolve({ jobs: [] }),
      scheduling ? api<{ schedules: Schedule[] }>("/v1/schedules") : Promise.resolve({ schedules: [] }),
    ]).then(([sourceResult, jobResult, activeResult, scheduleResult]) => {
      if (!active) return;
      const jobs = [...new Map([...jobResult.jobs, ...activeResult.jobs].map((job) => [job.id, job])).values()].sort((a, b) => b.createdAtMs - a.createdAtMs);
      setSnapshot({ sources: sourceResult.sources, jobs, schedules: scheduleResult.schedules });
      setError(""); setLoading(false);
      setSelectedId((current) => sourceResult.sources.some((source) => source.id === current) ? current : sourceResult.sources[0]?.id ?? null);
    }).catch((failure) => { if (active) { setError(errorText(failure)); setLoading(false); } });
    return () => { active = false; };
  }, [readable, recording, scheduling, refreshKey]);

  const activeJobs = snapshot.jobs.filter((job) => !terminal(job.state));
  const activeSchedules = snapshot.schedules.filter((schedule) => !terminal(schedule.state));
  useEffect(() => {
    if (!activeJobs.length && !activeSchedules.length) return;
    const timer = setInterval(() => setTick((value) => value + 1), 2000);
    return () => clearInterval(timer);
  }, [activeJobs.length, activeSchedules.length]);
  const selected = snapshot.sources.find((source) => source.id === selectedId);
  const latestSchedule = (source: Source) => snapshot.schedules.filter((schedule) => schedule.sourceId === source.id).sort((a, b) => b.createdAtMs - a.createdAtMs)[0];
  const sourceJobs = (source: Source) => {
    const linkedIds = snapshot.schedules.filter((schedule) => schedule.sourceId === source.id).map((schedule) => schedule.jobId);
    return snapshot.jobs.filter((job) => job.sourceId === source.id || linkedIds.includes(job.id)).sort((a, b) => b.createdAtMs - a.createdAtMs);
  };
  const selectedJobs = selected ? sourceJobs(selected) : [];
  const selectedJob = selectedJobs.find((job) => !terminal(job.state));
  const selectedSchedule = selected ? latestSchedule(selected) : undefined;
  const selectedWatches = activeSchedules.filter((schedule) => schedule.sourceId === selectedId);
  const previewId = replayId ?? selectedJob?.sessionId ?? selectedSchedule?.sessionId ?? selected?.sessionId ?? selectedJobs[0]?.sessionId ?? null;
  const previewSession = sessions.find((session) => session.id === previewId);
  const preferredJobId = replayJobId ?? selectedJob?.id ?? selectedJobs[0]?.id;
  const mediaJob = snapshot.jobs.find((job) => job.sessionId === previewId && (!preferredJobId || job.id === preferredJobId) && job.segments.length > 0);
  useEffect(() => {
    eventCursor.current = 0;
    setSelectedEvidence(undefined); setEvents([]); setEventsError(""); setMoreEvents(false);
  }, [previewId]);
  useEffect(() => {
    let active = true;
    if (!previewId || !scopes.includes("evidence:read")) return;
    api<{ events: Evidence[]; nextAfter: number | null }>(`/v1/sessions/${encodeURIComponent(previewId)}/events?limit=100&after=${eventCursor.current}`)
      .then((value) => { if (active) {
        if (value.nextAfter !== null) eventCursor.current = value.nextAfter;
        setEvents((current) => [...new Map([...current, ...value.events].map((event) => [event.id, event])).values()].slice(-100));
        setMoreEvents(value.events.length === 100); setEventsError("");
      } })
      .catch((failure) => { if (active) setEventsError(errorText(failure)); });
    return () => { active = false; };
  }, [previewId, refreshKey, scopes.join(",")]);
  async function run(operation: () => Promise<unknown>, message: string) {
    const generation = ++requestGeneration.current;
    setBusy(true); setError(""); setNotice("");
    try { await operation(); setTick((value) => value + 1); onRefresh(); if (generation === requestGeneration.current) setNotice(message); }
    catch (failure) { if (generation === requestGeneration.current) setError(errorText(failure)); }
    finally { setBusy(false); }
  }
  function select(source: Source) { ++requestGeneration.current; setSelectedId(source.id); setReplayId(null); setReplayJobId(undefined); setSelectedEvidence(undefined); setNotice(""); setError(""); }
  function watch(autoRecord: boolean, checkOnly = false) {
    if (!selected) return;
    const startAtMs = Date.now();
    void run(() => api("/v1/schedules", {
      sourceId: selected.id, startAtMs, endAtMs: startAtMs + (checkOnly ? 15_000 : windowMinutes * 60_000),
      maxDurationSeconds: limit, segmentSeconds: 2, pollSeconds: 10, autoRecord,
    }), checkOnly ? "Source check started. It ends within 15 seconds." : `Watching this source for ${windowMinutes} minutes${autoRecord ? `; each recording is limited to ${limit} seconds` : "; recording is off"}.`);
  }
  function record() {
    if (!selected) return;
    setReplayId(null); setReplayJobId(undefined); setSelectedEvidence(undefined);
    if (!selected.sessionId) { watch(true); return; }
    void run(() => api("/v1/jobs", { sourceId: selected.id, sessionId: selected.sessionId, maxDurationSeconds: limit, segmentSeconds: 2 }), `Recording requested, limited to ${limit} seconds. Preview appears after media is saved.`);
  }
  function add(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const account = String(new FormData(form).get("account") ?? "").trim().replace(/^@/, "");
    void run(async () => {
      const source = await api<Source>("/v1/sources", { kind: "tiktok-public", account });
      setSelectedId(source.id); setReplayId(null); setReplayJobId(undefined); form.reset();
    }, `@${account} added. Choose Check LIVE or a bounded watch when ready.`);
  }
  function status(source: Source) {
    const job = sourceJobs(source).find((value) => !terminal(value.state));
    if (job) return job.stopRequested ? "Stopping" : job.state === "recording" ? job.segments.length > 0 ? "Recording" : "Starting" : job.state.replaceAll("_", " ");
    const schedule = latestSchedule(source);
    if (!schedule) return "Unchecked";
    if (schedule.error) return "Check failed";
    if (!schedule.lastCheckedAtMs) return terminal(schedule.state) ? "Not checked" : "Checking";
    // A historical result never asserts that an account is LIVE now.
    return schedule.status === "available" || schedule.status === "live"
      ? source.kind === "tiktok-public" ? "LIVE at last check" : "Available at last check"
      : schedule.status === "offline" ? "Offline at last check" : schedule.status === "unavailable" ? "Unavailable at last check" : schedule.status.replaceAll("_", " ");
  }
  const recent = snapshot.jobs.filter((job) => job.segments.length > 0).slice(0, 8);
  const displayedEvents = events.filter((event) => tab === "all" || (tab === "chat" ? event.kind === "chat" : ["transcript", "caption"].includes(event.kind)));
  return <div className="lm-console">
    {notice && <p className="ll-notice" role="status">{notice}</p>}
    {error && <p className="lm-error" role="alert">{error}. Refresh to retry or check service configuration.</p>}
    {!readable ? <div className="lm-empty">Recording access is not granted to this operator.</div> : loading ? <p role="status">Loading selected accounts…</p> : <>
      <div className="lm-layout">
        <aside className="lm-watchlist" aria-label="Selected account watchlist" data-source-count={snapshot.sources.length}>
          <div className="lm-section-header"><h2>Accounts</h2><span>{snapshot.sources.length}</span></div>
          {canAdd && <form className="lm-add-form" onSubmit={add}>
            <label className="sr-only" htmlFor="lm-account">TikTok account to add</label>
            <input id="lm-account" name="account" placeholder="@account" required maxLength={64} pattern="@?[A-Za-z0-9_.]+" autoComplete="off" />
            <button disabled={busy}><Plus size={14} />Add account</button>
          </form>}
          {snapshot.sources.map((source) => <button key={source.id} className={`lm-source-row ${source.id === selectedId ? "selected" : ""}`} aria-pressed={source.id === selectedId} onClick={() => select(source)}>
            <span className="lm-source-avatar"><Radio size={17} /></span>
            <span className="lm-source-meta"><strong>{sourceName(source)}</strong><small>{source.kind === "file" || source.fixture ? "Synthetic fixture" : source.kind === "tiktok-public" ? "TikTok" : "Permitted media"}</small><span className="lm-status" data-state={status(source).toLowerCase()}>{status(source)}</span></span>
          </button>)}
          {!snapshot.sources.length && <div className="lm-empty"><p>No accounts yet.</p><small>Add a TikTok account above to get started.</small></div>}
          <button className="lm-manage" onClick={onSources}>Manage accounts <ArrowRight size={14} /></button>
        </aside>
        <section className="lm-stage" aria-label="Selected source monitor">
          <div className="lm-stage-header">
            <div><h2>{replayId ? previewSession?.account ? `@${previewSession.account}` : previewSession?.title ?? "Saved recording" : selected ? sourceName(selected) : "Select an account"}</h2>
              <p>{replayId ? "Saved recording" : selected ? status(selected) : "Add an account to check and record its broadcasts."}{selectedSchedule?.lastCheckedAtMs && !replayId ? ` · checked ${time(selectedSchedule.lastCheckedAtMs)}` : ""}</p></div>
            {selected && <div className="lm-control-actions">
              {scheduling && <button disabled={!writable || busy || selectedWatches.length > 0 || !validLimit} onClick={() => watch(false, true)}><Radio size={14} />{selected.kind === "tiktok-public" ? "Check LIVE" : "Check source"}</button>}
              {scheduling && <button disabled={!writable || busy || selectedWatches.length > 0 || !validWindow || !validLimit} onClick={() => watch(false)}><Clock3 size={14} />Watch only</button>}
              {selectedJob ? <button className="ll-primary" disabled={!writable || busy || selectedJob.stopRequested} onClick={() => run(() => api(`/v1/jobs/${selectedJob.id}/stop`, {}), "Recording stop requested. Saved segments remain replayable.")}><Square size={13} />{selectedJob.stopRequested ? "Stopping…" : "Stop recording"}</button>
                : <button className="ll-primary" disabled={!recording || !writable || busy || (!selected.sessionId && (!scheduling || selectedWatches.length > 0 || !validWindow)) || !validLimit} onClick={record}><Circle size={13} />{selected.sessionId ? "Record now" : "Record when LIVE"}</button>}
            </div>}
          </div>
          <div className="lm-stage-body">
            <div className="lm-media-column">
            <div className="lm-player">
              <div className="lm-player-label"><Video size={14} /><span>{replayId ? "Saved recording" : "Recording preview"}</span><small>{selected?.kind === "file" ? "Synthetic media" : "Saved segments · preview is delayed"}</small></div>
              {previewId && mediaJob ? renderMedia(previewId, selectedEvidence, refreshKey, preferredJobId) : <div className="lm-player-empty"><span className="lm-empty-camera"><Video size={28} /></span><h3>{selectedJob ? "Saving the first segment" : "Your recording starts here"}</h3><p>{selectedJob ? "Verified video will appear as capture progresses." : selected ? selected.sessionId ? "Choose Record now to capture this source." : "Choose Record when LIVE to watch and capture." : "Select an account to get started."}</p><small>Preview uses saved video and is delayed.</small></div>}
            </div>
          {selected && <div className="lm-controls">
            <label>Recording limit <input type="number" aria-label="Recording limit (seconds)" min={2} max={3600} required value={limit} onChange={(event) => setLimit(Number(event.target.value))} /><span>sec</span></label>
            {scheduling && <label>Watch window <input type="number" aria-label="Watch window (minutes)" min={1} max={1440} required value={windowMinutes} onChange={(event) => setWindowMinutes(Number(event.target.value))} /><span>min</span></label>}
            {previewId && <button className="lm-open-conversation" onClick={() => onOpenSession(previewId)}>Open conversation <ArrowRight size={14} /></button>}
            {selectedWatches.map((schedule) => <div className="lm-watch-receipt" key={schedule.id}><span>{schedule.autoRecord ? "Watching & recording when available" : "Watching only"} · ends {time(schedule.endAtMs)}</span><button disabled={!writable || busy} onClick={() => run(() => api(`/v1/schedules/${schedule.id}/stop`, {}), schedule.jobId ? "Watch stopped and its linked recording stop requested. Saved segments remain replayable." : "Watch stopped. Recordings started separately keep their own limit and Stop recording control.")}>Stop watch</button></div>)}
            {selectedSchedule?.error && <p className="lm-error" role="alert">Source check: {selectedSchedule.error.replaceAll("_", " ")}</p>}
            {selectedJobs[0]?.error && <p className="lm-error" role="alert">Last recording: {selectedJobs[0].state} · {selectedJobs[0].error.replaceAll("_", " ")}. Previously saved segments remain available.</p>}
          </div>}
            </div>
            <aside className="lm-chat" aria-label="Captured conversation feed">
              <div className="lm-chat-tabs" role="group" aria-label="Conversation feed filter">{[["chat", "Chat"], ["speech", "Transcript"], ["all", "All events"]].map(([value, label]) => <button key={value} aria-pressed={tab === value} onClick={() => setTab(value)}>{label}</button>)}</div>
              <div className="lm-chat-list">{displayedEvents.map((event) => <button className={`lm-message ${event.id === selectedEvidence?.id ? "selected" : ""}`} key={event.id} onClick={() => setSelectedEvidence(event)}>
                <span><strong>{event.attribution.account ? `@${event.attribution.account}` : event.kind === "gap" ? "Capture gap" : event.kind === "caption" ? "Source caption" : event.kind === "transcript" ? "Unattributed speech" : "Unattributed account"}</strong><time>{time(event.sourceTimestampMs ?? event.capturedAtMs ?? event.receivedAtMs)}</time></span><p>{event.text || "No text"}</p><small>{event.kind} · {event.sourceTimestampMs === null ? "Capture / receipt time" : "Source time"}</small>
              </button>)}{!displayedEvents.length && <div className="lm-empty"><MessageSquare size={24} /><p>{previewId ? "No captured events in this view." : "Captured chat appears here."}</p><small>{tab === "speech" ? "Captions and independent transcripts keep their own labels." : "Only messages actually received from the selected session are shown."}</small></div>}</div>
              {eventsError && <p className="lm-error" role="alert">{eventsError}</p>}
              {selectedEvidence && <button className="lm-context-link" onClick={() => onOpenEvidence(selectedEvidence.sessionId, selectedEvidence.id)}>Open original context <ArrowRight size={14} /></button>}
              {events.length >= 100 && <small className="lm-muted">Latest 100 loaded events. Earlier messages stay in the full conversation.</small>}
              {moreEvents && <button onClick={() => setTick((value) => value + 1)}>Load newer events</button>}
              {events.length >= 100 && previewId && <button onClick={() => onOpenSession(previewId)}>Open full conversation</button>}
            </aside>
          </div>
          {!writable && <p className="lm-muted">Read-only access. A collector can check sources and start or stop recording.</p>}
        </section>
      </div>
      <section className={`lm-jobs ${activeJobs.length ? "" : "lm-jobs-idle"}`} aria-label="Active recordings"><div className="lm-section-header"><h2>Active recordings</h2><span>{activeJobs.length}</span></div>
        {!activeJobs.length && <p className="lm-muted">Recorder idle</p>}
        {activeJobs.map((job) => <div className="lm-job" key={job.id}>
          <div><strong>{sessions.find((session) => session.id === job.sessionId)?.title ?? snapshot.sources.find((source) => source.id === job.sourceId)?.label ?? "Recording"}</strong><small>{job.state.replaceAll("_", " ")}{job.stopRequested ? " · stop requested" : ""} · {duration(job.segments.reduce((sum, segment) => sum + segment.durationMs, 0) / 1000)} saved · {bytes(job.segments.reduce((sum, segment) => sum + segment.bytes, 0))} · {job.maxDurationSeconds}s limit</small></div>
          <button disabled={!writable || busy || job.stopRequested} onClick={() => run(() => api(`/v1/jobs/${job.id}/stop`, {}), "Recording stop requested.")} aria-label={`Stop recording ${job.id}`}><Square size={13} />Stop</button>
          {job.error && <p className="lm-error">{job.error.replaceAll("_", " ")}</p>}
        </div>)}
      </section>
      <section aria-label="Recent recordings"><div className="lm-section-header"><h2>Recent recordings</h2><button onClick={onSources}>All capture receipts <ArrowRight size={14} /></button></div>
        <div className="lm-recordings">{recent.map((job) => <button className="lm-recording" key={job.id} onClick={() => { setReplayId(job.sessionId); setReplayJobId(job.id); setSelectedEvidence(undefined); }} aria-label={`Replay recording ${job.id}`}>
          <span className="lm-recording-icon"><Video size={21} /></span><span><strong>{sessions.find((session) => session.id === job.sessionId)?.title ?? "Saved recording"}</strong><small>{time(job.createdAtMs)} · {duration(job.segments.reduce((sum, segment) => sum + segment.durationMs, 0) / 1000)} · {bytes(job.segments.reduce((sum, segment) => sum + segment.bytes, 0))}</small><span className="lm-status" data-state={job.state}>{job.state} · {job.segments.length} saved segments</span>{job.error && <small className="lm-error">{job.error.replaceAll("_", " ")}</small>}</span><ArrowRight size={15} />
        </button>)}</div>{!recent.length && <div className="lm-empty">Your saved recordings will appear here. Interrupted captures remain available when verified media was retained.</div>}
      </section>
    </>}
  </div>;
}
