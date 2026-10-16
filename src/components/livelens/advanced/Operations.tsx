import { useState, type FormEvent } from "react";
import { ArrowUpRight, ChevronLeft, ChevronRight, RefreshCw } from "lucide-react";
import { api } from "../../../lib/livelens/api";
import { Empty, friendlyError, Loading, Notice, stamp, useResource } from "./shared";
import "./operations.css";

type WorkerId = "recording" | "scheduling" | "speech" | "archive";
type Worker = {
  id: WorkerId;
  access: "allowed" | "restricted";
  configured?: boolean;
  state?: "not-configured" | "stopped" | "running" | "idle" | "error";
  error?: string | null;
  counts?: { pending: number; active: number; retrying: number; failed: number; completed: number; stopped: number };
  oldestPendingAtMs?: number | null;
  recordingBudget?: {
    retainedBytes: number;
    reservedBytes: number;
    limitBytes: number;
    availableBytes: number;
    requiredForNextRecordingBytes: number;
    maxConcurrent: number;
    maxWorkspaceConcurrent: number;
    maxWorkspacePending: number;
  };
};
type MeterId = "recordingSeconds" | "storageBytes" | "speechSeconds" | "pendingJobs";
type CapacityMeter = {
  id: MeterId;
  used: number;
  reserved: number;
  committed: number;
  limit: number;
  remaining: number;
  overLimit: boolean;
};
type OperationsInfo = {
  schemaVersion: 1;
  workspace: string;
  observedAtMs: number;
  capacity: {
    available: true;
    measurement: string;
    meters: CapacityMeter[];
    storage: { localBytes: number; archivedBytes: number; reservedArchiveBytes: number; pendingCleanupBytes: number };
  } | { available: false; error: string };
  workers: Worker[];
  attention: { id: string; kind: WorkerId; jobId: string; state: string; error: string | null; createdAtMs: number; sessionId?: string }[];
  cleanup: { canManage: boolean; pendingCount?: number; failedCount?: number };
};
export type CleanupTask = {
  id: string;
  sessionId: string;
  jobId: string;
  state: "pending" | "failed" | "completed";
  bytes: number;
  createdAtMs: number;
  updatedAtMs: number;
  attempts: number;
  error: string | null;
};
export type RetentionResult = {
  deletedSessions: number;
  cleanupFailures: string[];
  cleanupTasks: CleanupTask[];
};
const workerLabels: Record<WorkerId, { name: string; purpose: string }> = {
  recording: { name: "Recording", purpose: "Retain media from selected sources" },
  scheduling: { name: "Source checks", purpose: "Run explicitly scheduled source checks" },
  speech: { name: "Transcription", purpose: "Process retained audio into source-linked text" },
  archive: { name: "Media archive", purpose: "Preserve and restore encrypted media" },
};
const meterLabels: Record<MeterId, { name: string; used: string }> = {
  recordingSeconds: { name: "Recorded media", used: "retained" },
  storageBytes: { name: "Storage", used: "retained" },
  speechSeconds: { name: "Speech", used: "processed" },
  pendingJobs: { name: "Work queue", used: "pending" },
};
export const formatStorage = (value: number) => {
  if (value === 0) return "0 B";
  if (value < 1000) return `${Math.ceil(value)} B`;
  if (value < 1e6) return `${(value / 1e3).toFixed(1)} KB`;
  if (value < 1e9) return `${(value / 1e6).toFixed(1)} MB`;
  return `${(value / 1e9).toFixed(2)} GB`;
};
const formatCapacity = (id: MeterId, value: number) => {
  if (id === "storageBytes") return formatStorage(value);
  if (id === "pendingJobs") return `${value} jobs`;
  if (value < 60) return `${Math.ceil(value)} sec`;
  if (value < 3600) return `${(value / 60).toFixed(1)} min`;
  return `${(value / 3600).toFixed(1)} hr`;
};
const stateLabel = (state?: string) => state === "not-configured" ? "Not configured" : state ? state[0].toUpperCase() + state.slice(1) : "Unavailable";
const readableError = (error: string | null | undefined) => error ? error.replaceAll(/[_-]/g, " ") : "No failure detail was retained.";

export default function Operations({ revision = 0, onOpenSession, onOpenRetention }: {
  revision?: number;
  onOpenSession?: (sessionId: string) => void;
  onOpenRetention: () => void;
}) {
  const resource = useResource<OperationsInfo>("/v1/workspace/operations", revision);
  const info = resource.data;
  const cleanupCount = (info?.cleanup.pendingCount ?? 0) + (info?.cleanup.failedCount ?? 0);
  return (
    <div className="op-desk">
      <header className="op-heading">
        <div>
          <span className="op-eyebrow">WORKSPACE OPERATIONS</span>
          <h2>Keep the work moving.</h2>
          <p>See queued work, available capacity and the next recovery action.</p>
        </div>
        <button className="aw-secondary" onClick={resource.reload} disabled={resource.loading}>
          <RefreshCw size={14} /> Refresh operations
        </button>
      </header>
      <Notice error={resource.error} />
      {resource.loading && !info && <Loading />}
      {info && <>
        <div className="op-observation">
          <span>{resource.error ? "Last available snapshot" : resource.loading ? "Refreshing snapshot" : "Observed"} <time dateTime={new Date(info.observedAtMs).toISOString()}>{stamp(info.observedAtMs)}</time></span>
          <span>Workspace: <strong>{info.workspace}</strong></span>
        </div>
        {resource.error && <p className="op-stale">These details could not be refreshed. Check again before making an operational decision.</p>}
        {(info.attention.length > 0 || cleanupCount > 0) && <div className="op-review-strip">
          <div>
            <span className="op-eyebrow">NEEDS REVIEW</span>
            <strong>{info.attention.length > 0 ? `${info.attention.length} recent work ${info.attention.length === 1 ? "item" : "items"} with a recorded failure` : "Media cleanup is unfinished"}</strong>
            <p>{cleanupCount > 0 ? `${cleanupCount} cleanup ${cleanupCount === 1 ? "task remains" : "tasks remain"}. Storage stays reserved until removal completes.` : "Open the original context and inspect the retained result before starting further work."}</p>
          </div>
          {cleanupCount > 0 && <button className="aw-secondary" onClick={onOpenRetention}>Review cleanup <ArrowUpRight size={14} /></button>}
        </div>}
        <div className="op-columns">
          <section className="op-section" aria-labelledby="op-work-heading">
            <header><div><span className="op-eyebrow">01 / EXECUTION</span><h3 id="op-work-heading">Work in progress</h3></div></header>
            <div className="op-worker-list">
              {info.workers.map((worker) => <WorkerRow key={worker.id} worker={worker} />)}
            </div>
            <p className="op-section-note">State describes the configured worker and its loop at the observation time. It does not verify an external provider or recording quality.</p>
          </section>
          <section className="op-section" aria-labelledby="op-capacity-heading">
            <header><div><span className="op-eyebrow">02 / CAPACITY</span><h3 id="op-capacity-heading">Room for the next job</h3></div></header>
            {info.capacity.available ? <>
              <div className="op-capacity-list">
                {info.capacity.meters.map((meter) => <div className={`op-capacity-row${meter.overLimit ? " is-over-limit" : ""}`} key={meter.id}>
                  <div className="op-capacity-title"><h4>{meterLabels[meter.id].name}</h4><strong>{meter.overLimit ? "Over limit" : `${formatCapacity(meter.id, meter.remaining)} remaining`}</strong></div>
                  <meter min={0} max={meter.limit || 1} value={Math.min(meter.committed, meter.limit || 1)} aria-label={`${meterLabels[meter.id].name} committed capacity`} />
                  <p><span>{formatCapacity(meter.id, meter.used)} {meterLabels[meter.id].used}</span><span>{formatCapacity(meter.id, meter.reserved)} reserved</span><span>{formatCapacity(meter.id, meter.limit)} limit</span></p>
                </div>)}
              </div>
              <details className="op-storage-detail">
                <summary>How storage is counted</summary>
                <dl>
                  <div><dt>Retained locally</dt><dd>{formatStorage(info.capacity.storage.localBytes)}</dd></div>
                  <div><dt>Encrypted archive</dt><dd>{formatStorage(info.capacity.storage.archivedBytes)}</dd></div>
                  <div><dt>Archive reservations</dt><dd>{formatStorage(info.capacity.storage.reservedArchiveBytes)}</dd></div>
                  <div><dt>Awaiting cleanup</dt><dd>{formatStorage(info.capacity.storage.pendingCleanupBytes)}</dd></div>
                </dl>
              </details>
            </> : <div className="op-unavailable"><strong>Capacity unavailable</strong><p>Usage could not be measured. Refresh before admitting more work.</p></div>}
            <p className="op-section-note">Remaining capacity subtracts both retained usage and reservations. These are configured workspace limits, not a measured customer capacity or a bill.</p>
          </section>
        </div>
        <section className="op-section op-attention" aria-labelledby="op-attention-heading">
          <header><div><span className="op-eyebrow">03 / FOLLOW THROUGH</span><h3 id="op-attention-heading">Recent work needing attention</h3></div><span className="op-caption">Latest 20 retained failures</span></header>
          {!info.attention.length ? <Empty title="No recorded failures in accessible work">Refresh after a job runs to inspect its recorded outcome. This does not certify source availability or media quality.</Empty> : <div>
            {info.attention.map((item) => <article className="op-attention-row" key={item.id}>
              <div className="op-attention-kind"><span>{workerLabels[item.kind].name}</span><span className="op-state" data-state="error">{stateLabel(item.state)}</span></div>
              <div className="op-attention-copy"><h4>{readableError(item.error)}</h4><p>Job <code>{item.jobId}</code></p><time dateTime={new Date(item.createdAtMs).toISOString()}>{stamp(item.createdAtMs)}</time></div>
              {item.sessionId && onOpenSession ? <button className="aw-text-button" onClick={() => onOpenSession(item.sessionId!)}>Open conversation<ArrowUpRight size={14} /></button> : <span className="op-caption">Review worker configuration with your administrator.</span>}
            </article>)}
          </div>}
        </section>
        {info.cleanup.canManage && !cleanupCount && <button className="aw-text-button" onClick={onOpenRetention}>Review retention and cleanup history <ArrowUpRight size={14} /></button>}
      </>}
    </div>
  );
}

function WorkerRow({ worker }: { worker: Worker }) {
  const label = workerLabels[worker.id];
  return <article className="op-worker-row">
    <div className="op-worker-title"><div><h4>{label.name}</h4><p>{label.purpose}</p></div><span className="op-state" data-state={worker.access === "restricted" ? "restricted" : worker.state}>{worker.access === "restricted" ? "Restricted" : stateLabel(worker.state)}</span></div>
    {worker.access === "restricted" ? <p className="op-worker-note">Your access does not include this worker’s activity.</p> : <>
      <div className="op-worker-facts"><span>{worker.configured ? "Configured" : "Not configured"}</span>{worker.counts && <><span><strong>{worker.counts.pending}</strong> unfinished</span><span><strong>{worker.counts.active}</strong> active</span><span><strong>{worker.counts.retrying}</strong> retrying</span><span><strong>{worker.counts.failed}</strong> failed</span></>}</div>
      {worker.oldestPendingAtMs && <p className="op-worker-note">Oldest unfinished work: {stamp(worker.oldestPendingAtMs)}</p>}
      {worker.error && <p className="op-worker-error">{readableError(worker.error)}</p>}
      {worker.configured && worker.state === "stopped" && <p className="op-worker-note">Configured, but the worker loop is stopped. An administrator must start it.</p>}
      {worker.recordingBudget && <div className="op-recording-budget">
        <p><strong>{formatStorage(worker.recordingBudget.availableBytes)} available</strong> in recorder allocation · {formatStorage(worker.recordingBudget.requiredForNextRecordingBytes)} required for a new recording.</p>
        <details><summary>Recording allocation</summary>
          <p>{formatStorage(worker.recordingBudget.retainedBytes)} retained · {formatStorage(worker.recordingBudget.reservedBytes)} reserved · {formatStorage(worker.recordingBudget.limitBytes)} limit.</p>
          <p>Workspace bounds: {worker.recordingBudget.maxWorkspaceConcurrent} concurrent recordings, {worker.recordingBudget.maxWorkspacePending} pending. The recorder supports up to {worker.recordingBudget.maxConcurrent} concurrent jobs.</p>
          <p>Workspace capacity and recorder allocation must both admit the next job.</p>
        </details>
      </div>}
      {worker.counts && <details className="op-worker-history"><summary>Retained outcomes</summary><span>{worker.counts.completed} completed · {worker.counts.stopped} stopped</span></details>}
    </>}
  </article>;
}

export function RetentionCleanup({ revision = 0, onChanged }: { revision?: number; onChanged: () => void }) {
  const [offset, setOffset] = useState(0);
  const resource = useResource<{ tasks: CleanupTask[]; hasMore: boolean; nextOffset: number | null }>(`/v1/workspace/retention/cleanup?limit=50&offset=${offset}`, revision);
  const [selected, setSelected] = useState<string | null>(null);
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [receipt, setReceipt] = useState("");
  const task = resource.data?.tasks.find((item) => item.id === selected);
  const retry = async (event: FormEvent) => {
    event.preventDefault();
    if (!task || task.state === "completed" || busy || resource.loading || resource.error || !reason.trim()) return;
    setBusy(true); setError(""); setReceipt("");
    try {
      const result = await api<CleanupTask>(`/v1/workspace/retention/cleanup/${encodeURIComponent(task.id)}/retry`, { reason: reason.trim() });
      if (result.state === "completed") {
        setReceipt("Media cleanup completed. Its storage reservation has been released.");
        setSelected(null); setReason("");
      } else {
        setError(`Cleanup is still ${result.state}. ${readableError(result.error)}. Storage remains reserved.`);
      }
      resource.reload(); onChanged();
    } catch (cause) {
      setError(`${friendlyError(cause)} Refresh the cleanup list to check the recorded outcome before retrying.`);
      resource.reload();
    } finally { setBusy(false); }
  };
  return <section className="op-desk op-section op-cleanup" aria-labelledby="op-cleanup-heading">
    <header><div><span className="op-eyebrow">DURABLE RECOVERY</span><h3 id="op-cleanup-heading">Media cleanup</h3><p>Deleted sessions can leave media awaiting removal. These tasks survive service restarts and keep storage reserved until removal succeeds.</p></div><button className="aw-text-button" disabled={busy || resource.loading} onClick={() => { setReceipt(""); resource.reload(); }}>Refresh cleanup</button></header>
    <div className="op-cleanup-notices"><Notice error={resource.error || error} receipt={resource.error ? "" : receipt} /></div>
    {resource.loading && !resource.data ? <Loading /> : resource.data && <>
      {!resource.data.tasks.length ? <Empty title="No cleanup tasks recorded">Explicit retention deletion creates a receipt for each media cleanup task.</Empty> : <div className="op-cleanup-list">
        {resource.data.tasks.map((item) => <article className="op-cleanup-row" key={item.id}>
          <div className="op-cleanup-title"><span className="op-state" data-state={item.state === "failed" ? "error" : item.state}>{stateLabel(item.state)}</span><strong>Media from <code>{item.jobId}</code></strong><span>{formatStorage(item.bytes)}</span></div>
          <p>Session <code>{item.sessionId}</code> · {item.attempts} {item.attempts === 1 ? "attempt" : "attempts"} · Updated {stamp(item.updatedAtMs)}</p>
          {item.error && <p className="op-worker-error">{readableError(item.error)}</p>}
          {item.state !== "completed" && <button className="aw-text-button" aria-label={`Review cleanup for ${item.jobId}`} disabled={busy || resource.loading || !!resource.error} onClick={() => { setSelected(item.id); setReason(""); setError(""); setReceipt(""); }}>Review cleanup retry <ArrowUpRight size={14} /></button>}
          {task?.id === item.id && item.state !== "completed" && <form className="op-cleanup-form" onSubmit={retry}>
            <p>This retries removal of the selected task’s retained media. It does not restore the deleted session.</p>
            <label>Cleanup retry reason<input required maxLength={1000} value={reason} disabled={busy} onChange={(event) => setReason(event.target.value)} placeholder="What was corrected before retrying?" /></label>
            <div className="aw-button-row"><button className="aw-primary" disabled={busy || resource.loading || !!resource.error || !reason.trim()}>{busy ? "Retrying cleanup…" : "Retry selected cleanup"}</button><button type="button" className="aw-secondary" disabled={busy} onClick={() => { setSelected(null); setReason(""); }}>Cancel retry</button></div>
          </form>}
        </article>)}
      </div>}
      {(offset > 0 || resource.data.hasMore) && <div className="op-pagination"><button className="aw-secondary" disabled={busy || resource.loading || offset === 0} onClick={() => { setOffset(Math.max(0, offset - 50)); setSelected(null); setReceipt(""); }}><ChevronLeft size={14} />Previous cleanup tasks</button><span>Showing {offset + 1}–{offset + resource.data.tasks.length}</span><button className="aw-secondary" disabled={busy || resource.loading || !resource.data.hasMore || resource.data.nextOffset === null} onClick={() => { setOffset(resource.data!.nextOffset!); setSelected(null); setReceipt(""); }}>Next cleanup tasks<ChevronRight size={14} /></button></div>}
    </>}
  </section>;
}
