import { useEffect, useMemo, useState } from "react";
import { ArrowRight, Check, ChevronRight, Clock3, Film, Layers3, MessageSquare, Search, ShieldAlert, TriangleAlert, Video, X } from "lucide-react";
import { api, type Session } from "../../lib/livelens/api";
import { formatSavedDuration, indexLibraryMedia, recordingState, type LibraryMedia, type LibraryRecording } from "./recording-library-model";
import "./recording-library.css";

export type RecordingLibraryProps = {
  sessions: Session[];
  revision: number;
  scopes: string[];
  query: string;
  onQueryChange: (query: string) => void;
  onOpenSession: (id: string) => void;
};
type ReceiptState = { jobs: LibraryRecording[]; loading: boolean; loaded: boolean; error: string };
const terminal = (state: string) => ["completed", "failed", "stopped"].includes(state);
const platformName = (platform: string) => platform === "fixture" ? "Synthetic fixture" : platform === "tiktok" ? "TikTok" : platform.replaceAll("_", " ");
const calendarDate = (value: number) => Number.isFinite(value) ? new Date(value).toLocaleDateString([], { month: "short", day: "numeric", year: "numeric" }) : "Date unavailable";
const clockTime = (value: number) => Number.isFinite(value) ? new Date(value).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }) : "Time unavailable";
const receiptError = (error: unknown) => {
  const message = error instanceof Error ? error.message : "Service unavailable";
  if (message.includes("missing_scope") || message.includes("forbidden")) return "Your current access does not include recording receipts.";
  if (message.includes("recorder_unavailable")) return "The recording service is not configured.";
  return message.replaceAll("_", " ");
};

function MediaStatus({ summary, loading, available, denied }: {
  summary?: LibraryMedia; loading: boolean; available: boolean; denied: boolean;
}) {
  const saved = summary?.saved;
  if (denied) return <span className="rl-capture rl-capture-unknown"><span>Media access unavailable</span><small>Conversation access only</small></span>;
  if (saved) return <span className="rl-capture"><span className="rl-duration">{formatSavedDuration(summary?.durationMs ?? 0)} <small>saved</small></span><small className="rl-state" data-state={saved.state}>{saved.state === "completed" && <Check size={12} aria-hidden />}{recordingState(saved)} · latest saved capture</small></span>;
  if (loading && !available) return <span className="rl-capture rl-capture-unknown"><span>Checking media…</span><small>Recording receipts</small></span>;
  const latest = summary?.latest;
  if (latest && !terminal(latest.state)) return <span className="rl-capture"><span className="rl-state" data-state={latest.state}><Clock3 size={13} aria-hidden />{recordingState(latest)}</span><small>No segments saved yet</small></span>;
  if (latest?.state === "failed") return <span className="rl-capture"><span className="rl-state" data-state="failed"><TriangleAlert size={13} aria-hidden />Capture failed</span><small>No video saved in this capture</small></span>;
  return <span className="rl-capture rl-capture-unknown"><span>{available ? "Video not shown here" : "Media status unavailable"}</span><small>{available ? "Open conversation to check" : "Conversation remains available"}</small></span>;
}

export default function RecordingLibrary({ sessions, revision, scopes, query, onQueryChange, onOpenSession }: RecordingLibraryProps) {
  const canReadMedia = scopes.includes("recordings:read");
  const [receipts, setReceipts] = useState<ReceiptState>({ jobs: [], loading: canReadMedia, loaded: false, error: "" });
  const [receiptRevision, setReceiptRevision] = useState(0);
  const [filter, setFilter] = useState<"all" | "video">("all");
  useEffect(() => {
    let active = true;
    if (!canReadMedia) {
      setReceipts({ jobs: [], loading: false, loaded: false, error: "" });
      setFilter("all");
      return;
    }
    setReceipts((previous) => ({ ...previous, loading: true, error: "" }));
    // One bounded request covers the page; no per-row media requests or players.
    api<{ jobs: LibraryRecording[] }>("/v1/jobs?limit=200")
      .then((result) => { if (active) setReceipts({ jobs: result.jobs, loading: false, loaded: true, error: "" }); })
      .catch((error) => { if (active) setReceipts({ jobs: [], loading: false, loaded: false, error: receiptError(error) }); });
    return () => { active = false; };
  }, [canReadMedia, revision, receiptRevision]);
  const media = useMemo(() => indexLibraryMedia(canReadMedia ? receipts.jobs : []), [canReadMedia, receipts.jobs]);
  const relevantActive = sessions.some((session) => {
    const job = media.get(session.id)?.latest;
    return job && !terminal(job.state);
  });
  useEffect(() => {
    if (!canReadMedia || !relevantActive) return;
    const timer = setInterval(() => setReceiptRevision((value) => value + 1), 5000);
    return () => clearInterval(timer);
  }, [canReadMedia, relevantActive]);
  const videoCount = sessions.filter((session) => media.get(session.id)?.saved).length;
  const normalizedQuery = query.trim().toLowerCase();
  const visible = sessions.filter((session) =>
    `${session.title} ${session.account ? `@${session.account}` : ""} ${session.platform} ${platformName(session.platform)}`.toLowerCase().includes(normalizedQuery) &&
    (filter === "all" || !!media.get(session.id)?.saved),
  );
  const clearFilters = () => { onQueryChange(""); setFilter("all"); };
  return <section className="rl-library" aria-label="Conversation and recording library">
    <div className="rl-toolbar">
      <div className="rl-filters" role="group" aria-label="Library view">
        <button aria-pressed={filter === "all"} onClick={() => setFilter("all")}><Layers3 size={15} aria-hidden />All conversations <span>{sessions.length}</span></button>
        <button aria-pressed={filter === "video"} onClick={() => setFilter("video")} disabled={!canReadMedia || !receipts.loaded} title={!canReadMedia ? "Recording access is needed to filter saved video" : !receipts.loaded ? "Load recording receipts before filtering video" : undefined}><Video size={15} aria-hidden />With video {receipts.loaded && <span>{videoCount}</span>}</button>
      </div>
      <label className="rl-search"><Search size={15} aria-hidden /><input aria-label="Filter session library" placeholder="Find a title or account…" value={query} onChange={(event) => onQueryChange(event.target.value)} />{query && <button type="button" aria-label="Clear library filter" onClick={() => onQueryChange("")}><X size={14} /></button>}</label>
    </div>
    <div className="rl-result-heading"><span><strong>{visible.length}</strong> {visible.length === 1 ? "conversation" : "conversations"}{normalizedQuery ? " matching your filter" : " on this page"}</span><details className="rl-data-note"><summary>About video status</summary><p>Video details describe the latest saved capture found in up to 200 recent recording receipts. Missing receipts mean media was not loaded here; open a conversation for its retained history. Duration sums saved segments and does not imply uninterrupted coverage. Playback checks the media when opened.</p></details></div>
    {!canReadMedia && <p className="rl-notice" role="status"><ShieldAlert size={15} aria-hidden />Recording receipts are outside your current access. You can still open permitted conversations.</p>}
    {receipts.error && <div className="rl-notice rl-notice-error" role="alert"><TriangleAlert size={15} aria-hidden /><p>Media status unavailable. {receipts.error} Conversations can still be opened.</p><button onClick={() => setReceiptRevision((value) => value + 1)}>Retry media status</button></div>}
    {receipts.loading && canReadMedia && <p className="rl-loading" role="status">{receipts.loaded ? "Refreshing recording details…" : "Loading recording details…"}</p>}
    {visible.length ? <div className="rl-record-list">
      <div className="rl-column-head" aria-hidden><span className="rl-column-conversation">Conversation</span><span>Latest saved capture</span><span>Session started</span><span /></div>
      {visible.map((session) => {
        const summary = media.get(session.id);
        const hasVideo = !!summary?.saved;
        const Icon = hasVideo ? Video : MessageSquare;
        return <button className={`rl-row${hasVideo ? " rl-row-video" : ""}`} key={session.id} onClick={() => onOpenSession(session.id)}>
          <span className="rl-media-tile" aria-hidden><Icon size={24} strokeWidth={1.5} /><small>{hasVideo ? "Saved video" : "Conversation"}</small></span>
          <span className="rl-conversation"><strong>{session.title}</strong><span className="rl-source"><span className="rl-source-account">{session.account ? `@${session.account}` : "Account unavailable"}</span><span className={`rl-platform${session.platform === "fixture" ? " rl-platform-demo" : ""}`}>{platformName(session.platform)}</span></span></span>
          <MediaStatus summary={summary} loading={receipts.loading} available={receipts.loaded} denied={!canReadMedia} />
          <span className="rl-date"><span className="rl-date-label">Session started</span><time dateTime={new Date(session.startedAtMs).toISOString()} aria-label={`Session started ${calendarDate(session.startedAtMs)} at ${clockTime(session.startedAtMs)}`}>{calendarDate(session.startedAtMs)}</time><small>{clockTime(session.startedAtMs)}</small></span>
          <ChevronRight className="rl-open-arrow" size={17} aria-hidden />
        </button>;
      })}
    </div> : <div className="rl-empty"><span className="rl-empty-icon">{filter === "video" ? <Film size={27} /> : <Search size={27} />}</span><h2>{normalizedQuery ? "No conversations match" : filter === "video" ? "No video in this view" : "Your conversation library is ready"}</h2><p>{normalizedQuery ? "Try another title or account. This filter searches the current library page." : filter === "video" ? "Open a conversation to check its retained history, or show all conversations. About video status explains which recent captures this view includes." : "Conversations appear here after a source is captured or imported. Their original context stays with them."}</p>{(normalizedQuery || filter !== "all") && <button onClick={clearFilters}>Show all conversations <ArrowRight size={15} /></button>}</div>}
  </section>;
}
