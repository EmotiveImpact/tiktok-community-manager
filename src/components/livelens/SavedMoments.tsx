import { useEffect, useId, useMemo, useRef, useState } from "react";
import { Bookmark, ChevronRight, Plus } from "lucide-react";
import { api, type Evidence } from "../../lib/livelens/api";
import "./saved-moments.css";

type SavedMoment = {
  id: string;
  sessionId: string;
  evidenceId: string;
  label: string;
  createdAtMs: number;
};
type Segment = {
  jobId: string;
  id: string;
  startedAtMs: number;
  durationMs: number;
};
export type SavedMomentsProps = {
  sessionId: string;
  revision: number;
  canRead: boolean;
  events: Evidence[];
  selectedEvidenceId: string | null;
  segments: Segment[];
  onOpenEvidence: (sessionId: string, evidenceId: string) => void;
  onChooseMoment: () => void;
  canWrite: boolean;
};
type Frame = { key: string; path: string; offsetSeconds: number };

function validTime(value: number | null | undefined): value is number {
  return typeof value === "number" && Number.isFinite(value) &&
    Math.abs(value) <= 8_640_000_000_000_000;
}

function clock(event: Evidence | undefined) {
  if (!event) return null;
  if (validTime(event.sourceTimestampMs))
    return { atMs: event.sourceTimestampMs, label: "Source time" };
  if (validTime(event.capturedAtMs))
    return { atMs: event.capturedAtMs, label: "Capture time" };
  if (validTime(event.receivedAtMs))
    return { atMs: event.receivedAtMs, label: "Receipt time" };
  return null;
}

function frameFor(event: Evidence | undefined, segments: Segment[]): Frame | null {
  if (!event) return null;
  // Media is on the collector's clock. A source or receipt time that happens
  // to fit a segment does not prove alignment with that collector clock.
  const atMs = event.capturedAtMs;
  if (!validTime(atMs)) return null;
  const segment = segments.find((item) =>
    validTime(item.startedAtMs) && Number.isFinite(item.durationMs) &&
    item.durationMs > 0 && atMs >= item.startedAtMs &&
    atMs < item.startedAtMs + item.durationMs,
  );
  if (!segment) return null;
  const offsetSeconds = (atMs - segment.startedAtMs) / 1_000;
  return {
    key: JSON.stringify([segment.jobId, segment.id, atMs]),
    path: `/v1/media/${encodeURIComponent(segment.jobId)}/${encodeURIComponent(segment.id)}`,
    offsetSeconds,
  };
}

function readFrame(frame: Frame, signal: AbortSignal): Promise<string | null> {
  return new Promise((resolve) => {
    if (signal.aborted) { resolve(null); return; }
    const video = document.createElement("video");
    const canvas = document.createElement("canvas");
    let finished = false;
    const timer = window.setTimeout(() => finish(null), 6_000);
    const cleanup = () => {
      window.clearTimeout(timer);
      signal.removeEventListener("abort", cancelled);
      video.removeEventListener("loadedmetadata", seek);
      video.removeEventListener("loadeddata", captureAtStart);
      video.removeEventListener("seeked", capture);
      video.removeEventListener("error", failed);
      video.pause();
      video.removeAttribute("src");
      video.load();
      canvas.width = 0;
      canvas.height = 0;
    };
    const finish = (value: string | null) => {
      if (finished) return;
      finished = true;
      cleanup();
      resolve(value);
    };
    const cancelled = () => finish(null);
    const failed = () => finish(null);
    const capture = () => {
      if (finished || signal.aborted || video.readyState < 2) return;
      if (!video.videoWidth || !video.videoHeight) { finish(null); return; }
      try {
        // Bound decoded-frame output even for unusual retained aspect ratios.
        const scale = 256 / Math.max(video.videoWidth, video.videoHeight);
        canvas.width = Math.max(1, Math.round(video.videoWidth * scale));
        canvas.height = Math.max(1, Math.round(video.videoHeight * scale));
        const context = canvas.getContext("2d");
        if (!context) { finish(null); return; }
        context.drawImage(video, 0, 0, canvas.width, canvas.height);
        finish(canvas.toDataURL("image/jpeg", 0.75));
      } catch { finish(null); }
    };
    const captureAtStart = () => {
      if (frame.offsetSeconds === 0) capture();
    };
    const seek = () => {
      if (!Number.isFinite(video.duration) || frame.offsetSeconds >= video.duration) {
        finish(null);
        return;
      }
      // Never substitute the last frame for a moment outside actual media.
      if (frame.offsetSeconds === 0) capture();
      else {
        try { video.currentTime = frame.offsetSeconds; }
        catch { finish(null); }
      }
    };
    signal.addEventListener("abort", cancelled, { once: true });
    video.addEventListener("loadedmetadata", seek);
    video.addEventListener("loadeddata", captureAtStart);
    video.addEventListener("seeked", capture);
    video.addEventListener("error", failed);
    video.muted = true;
    video.playsInline = true;
    video.preload = "auto";
    video.src = frame.path;
    video.load();
  });
}

function MomentsContent(props: SavedMomentsProps) {
  const { sessionId, revision, events, segments, selectedEvidenceId,
    onOpenEvidence, onChooseMoment, canWrite } = props;
  const headingId = useId();
  const [moments, setMoments] = useState<SavedMoment[] | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [visibleCount, setVisibleCount] = useState(6);
  const [frames, setFrames] = useState<Record<string, string | null>>({});
  const frameCache = useRef(new Map<string, string | null>());

  useEffect(() => {
    let current = true;
    setLoading(true);
    setError("");
    api<{ bookmarks: SavedMoment[] }>(
      `/v1/bookmarks?session=${encodeURIComponent(sessionId)}&limit=100`,
    ).then((value) => {
      if (!current) return;
      if (!Array.isArray(value.bookmarks)) throw new Error("Invalid saved moments response");
      setMoments(value.bookmarks.filter((item) =>
        item.sessionId === sessionId && typeof item.id === "string" &&
        typeof item.evidenceId === "string" && typeof item.label === "string",
      ).slice(0, 100));
    }).catch((value: unknown) => {
      if (!current) return;
      setMoments(null);
      setError(value instanceof Error ? value.message.replaceAll(/[_-]/g, " ") :
        "Saved moments could not be loaded.");
    }).finally(() => { if (current) setLoading(false); });
    return () => { current = false; };
  }, [sessionId, revision]);

  const evidence = useMemo(() => new Map(events
    .filter((event) => event.sessionId === sessionId)
    .map((event) => [event.id, event] as const)), [events, sessionId]);
  const visible = (moments ?? []).slice(0, visibleCount);
  const descriptors = visible.map((moment) => frameFor(evidence.get(moment.evidenceId), segments));
  const frameSignature = JSON.stringify(descriptors.filter((frame): frame is Frame => frame !== null));

  useEffect(() => {
    const controller = new AbortController();
    const requested: Frame[] = JSON.parse(frameSignature);
    const wanted = new Set(requested.map((frame) => frame.key));
    for (const key of frameCache.current.keys()) {
      if (!wanted.has(key)) frameCache.current.delete(key);
    }
    setFrames(Object.fromEntries(frameCache.current));
    const queue = requested.filter((frame, index) =>
      !frameCache.current.has(frame.key) &&
      requested.findIndex((item) => item.key === frame.key) === index,
    );
    let cursor = 0;
    async function worker() {
      while (!controller.signal.aborted && cursor < queue.length) {
        const frame = queue[cursor++];
        const result = await readFrame(frame, controller.signal);
        if (controller.signal.aborted) return;
        frameCache.current.set(frame.key, result);
        setFrames(Object.fromEntries(frameCache.current));
      }
    }
    // No more than six off-DOM media reads; each is cancelled and released on
    // a session/scope unmount or when the visible evidence selection changes.
    for (let index = 0; index < Math.min(6, queue.length); index++) void worker();
    return () => { controller.abort(); };
  }, [frameSignature]);

  return (
    <section className="ll-saved-moments" aria-labelledby={headingId} aria-busy={loading}>
      <div className="ll-saved-moments-heading">
        <div>
          <h2 id={headingId}>Saved moments</h2>
          {moments !== null && <span className="ll-saved-moments-count">
            {moments.length} {moments.length === 1 ? "moment" : "moments"}
          </span>}
        </div>
        {canWrite && <button type="button" className="ll-saved-moments-add" onClick={onChooseMoment}>
          <Plus size={14} aria-hidden="true" /> Add moment
        </button>}
      </div>
      {error && <p className="ll-saved-moments-error" role="alert">{error}</p>}
      {moments === null && loading && <p className="ll-saved-moments-empty" role="status">Loading saved moments…</p>}
      {moments?.length === 0 && <p className="ll-saved-moments-empty">
        No moments saved for this recording yet.
      </p>}
      {visible.length > 0 && <ul className="ll-saved-moments-list">
        {visible.map((moment, index) => {
          const event = evidence.get(moment.evidenceId);
          const time = clock(event);
          const frame = descriptors[index];
          const image = frame ? frames[frame.key] : null;
          return <li key={moment.id}>
            <button type="button" className="ll-saved-moment"
              data-evidence-id={moment.evidenceId}
              aria-pressed={selectedEvidenceId === moment.evidenceId}
              onClick={() => onOpenEvidence(moment.sessionId, moment.evidenceId)}>
              <span className="ll-saved-moment-thumb" aria-hidden="true">
                {image ? <img src={image} alt="" /> : <Bookmark size={18} />}
              </span>
              <span className="ll-saved-moment-clock">
                {time ? <>
                  <time dateTime={new Date(time.atMs).toISOString()} title={new Date(time.atMs).toLocaleString()}>
                    {new Date(time.atMs).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false })}
                  </time>
                  <small>{time.label}</small>
                </> : <small>Original context</small>}
              </span>
              <span className="ll-saved-moment-copy">
                <strong>{moment.label || "Saved moment"}</strong>
                <span>{event ? (event.text || "Original record contains no text.") : "Open original context"}</span>
              </span>
              <ChevronRight className="ll-saved-moment-open" size={16} aria-hidden="true" />
            </button>
          </li>;
        })}
      </ul>}
      {moments !== null && moments.length > visibleCount && <button type="button"
        className="ll-saved-moments-more"
        onClick={() => setVisibleCount((count) => Math.min(count + 6, 100))}>
        Show more moments <span>({moments.length - visibleCount} loaded)</span>
      </button>}
      {moments?.length === 100 && <p className="ll-saved-moments-limit">
        The latest 100 saved moments are loaded for this recording.
      </p>}
    </section>
  );
}

export default function SavedMoments(props: SavedMomentsProps) {
  // Unmounting clears source-bound rows and media on loss of read scope. The
  // caller also keys by workspace identity, including across identical IDs.
  return props.canRead && props.sessionId ? <MomentsContent key={props.sessionId} {...props} /> : null;
}
