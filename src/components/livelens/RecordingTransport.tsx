import { useEffect, useRef, useState, type CSSProperties, type RefObject } from "react";
import { RotateCcw, RotateCw } from "lucide-react";
import type { Evidence } from "../../lib/livelens/api";
import {
  buildRecordingTimelines,
  collectorPosition,
  formatTransportTime,
  retainedPosition,
  type RecordingPosition,
  type RecordingSegment,
} from "./recording-transport-model";
import "./recording-transport.css";

type SeekIntent = RecordingPosition & { resume: boolean; origin: "evidence" | "operator" | "advance" };
const playbackSpeeds = [0.5, 0.75, 1, 1.25, 1.5, 2];
const segmentUrl = (segment: RecordingSegment) => `/v1/media/${encodeURIComponent(segment.jobId)}/${encodeURIComponent(segment.id)}`;
const captureTime = (timestamp: number) => new Date(timestamp).toLocaleString();
const gapDuration = (milliseconds: number) => milliseconds < 1000
  ? `${Math.round(milliseconds)} ms`
  : `${(milliseconds / 1000).toLocaleString(undefined, { maximumFractionDigits: 3 })}s`;

export default function RecordingTransport({
  segments,
  selectedKey,
  onSelectSegment,
  evidence,
  seekRevision,
  compact,
  videoRef,
  onError,
}: {
  segments: RecordingSegment[];
  selectedKey: string | null;
  onSelectSegment: (key: string) => void;
  evidence?: Evidence;
  seekRevision: number;
  compact: boolean;
  videoRef: RefObject<HTMLVideoElement>;
  onError: (message: string) => void;
}) {
  const timelines = buildRecordingTimelines(segments);
  const timeline = timelines.find((item) => item.entries.some((entry) => entry.key === selectedKey)) ?? timelines[0];
  const current = timeline?.entries.find((entry) => entry.key === selectedKey) ?? timeline?.entries[0];
  const [position, setPosition] = useState<{ key: string; offsetMs: number } | null>(null);
  const [speed, setSpeed] = useState(1);
  const speedRef = useRef(1);
  const loadedKey = useRef<string | null>(null);
  const pendingSeek = useRef<SeekIntent | null>(null);
  const appliedEvidence = useRef<string | null>(null);
  const previousKey = useRef(current?.key);
  const sourceSignature = timelines.map((item) => item.entries.map((entry) =>
    `${entry.key}:${entry.startedAtMs}:${entry.durationMs}`).join("|")).join(";");
  const offsetMs = position?.key === current?.key ? position?.offsetMs ?? 0 : 0;
  const elapsedMs = current ? Math.min(timeline.durationMs, current.retainedStartMs + offsetMs) : 0;
  const collectorAligned = evidence ? collectorPosition(timelines, evidence, timeline?.jobId) : null;

  function updatePosition() {
    const video = videoRef.current;
    if (video && current && loadedKey.current === current.key) {
      setPosition({ key: current.key, offsetMs: Math.min(current.durationMs, Math.max(0, video.currentTime * 1000)) });
    }
  }

  function applyPendingSeek() {
    const video = videoRef.current;
    const intent = pendingSeek.current;
    if (!video || !intent || !current || loadedKey.current !== intent.entry.key ||
        current.key !== intent.entry.key || video.readyState < 1) return;
    // Clear before assigning currentTime: subsequent native seeks must stay authoritative.
    pendingSeek.current = null;
    const seconds = Math.max(0, Math.min(intent.offsetMs / 1000,
      Number.isFinite(video.duration) ? video.duration : intent.entry.durationMs / 1000));
    try {
      video.currentTime = seconds;
      setPosition({ key: current.key, offsetMs: seconds * 1000 });
      if (intent.resume) video.play().catch(() => {
        if (loadedKey.current === intent.entry.key) onError("Press play to continue with the next retained segment.");
      });
    } catch {
      onError("This recording position is not available yet. Try again after the segment loads.");
    }
  }

  function seek(target: RecordingPosition | null, origin: SeekIntent["origin"], resume?: boolean) {
    if (!target) return;
    const video = videoRef.current;
    if (resume === false) video?.pause();
    pendingSeek.current = { ...target, origin, resume: resume ?? Boolean(video && !video.paused && !video.ended) };
    setPosition({ key: target.entry.key, offsetMs: target.offsetMs });
    if (target.entry.key !== current?.key) onSelectSegment(target.entry.key);
    else applyPendingSeek();
  }

  useEffect(() => {
    if (previousKey.current !== current?.key && pendingSeek.current && pendingSeek.current.entry.key !== current?.key) {
      pendingSeek.current = null;
    }
    previousKey.current = current?.key;
    if (loadedKey.current !== current?.key) onError("");
  }, [current?.key]);

  // Resource polling changes metadata identities, not the operator's playback intent.
  useEffect(() => {
    if (!evidence) {
      appliedEvidence.current = null;
      if (pendingSeek.current?.origin === "evidence") pendingSeek.current = null;
      return;
    }
    const intent = `${evidence.sessionId}/${evidence.id}/${seekRevision}`;
    if (appliedEvidence.current === intent) return;
    if (pendingSeek.current?.origin === "evidence") pendingSeek.current = null;
    const target = collectorPosition(timelines, evidence, timeline?.jobId);
    if (!target) return;
    appliedEvidence.current = intent;
    seek(target, "evidence");
  }, [evidence?.sessionId, evidence?.id, evidence?.capturedAtMs, seekRevision, sourceSignature]);

  if (!current || !timeline) return <p role="status">No valid retained segment metadata is available for playback.</p>;
  const discontinuities = timeline.entries.filter((entry) => entry.boundaryBefore);
  const percent = timeline.durationMs ? elapsedMs / timeline.durationMs * 100 : 0;
  const currentIndex = timeline.entries.findIndex((entry) => entry.key === current.key);

  return <div className={`ll-recording-transport${compact ? " ll-recording-transport-compact" : ""}`} data-recording-job={timeline.jobId}>
    <video
      ref={videoRef}
      controls
      preload="metadata"
      src={segmentUrl(current)}
      aria-label="Captured conversation video"
      onTimeUpdate={updatePosition}
      onSeeking={updatePosition}
      onSeeked={updatePosition}
      onEmptied={() => { loadedKey.current = null; }}
      onEnded={() => {
        setPosition({ key: current.key, offsetMs: current.durationMs });
        const next = timeline.entries[currentIndex + 1];
        if (next) seek({ entry: next, offsetMs: 0, retainedMs: next.retainedStartMs }, "advance", true);
      }}
      onError={() => {
        pendingSeek.current = null;
        onError("Retained segment could not be played. Check media integrity and availability.");
      }}
      onLoadedMetadata={() => {
        const video = videoRef.current;
        if (!video || new URL(video.currentSrc || video.src, location.href).pathname !== segmentUrl(current)) return;
        loadedKey.current = current.key;
        onError("");
        video.playbackRate = speedRef.current;
        if (pendingSeek.current?.entry.key === current.key) applyPendingSeek();
        else updatePosition();
      }}
      onRateChange={() => {
        const video = videoRef.current;
        if (video && video.readyState >= 1 && loadedKey.current === current.key) {
          speedRef.current = video.playbackRate;
          setSpeed(video.playbackRate);
        }
      }}
    />
    <div className="ll-transport-controls">
      <div className="ll-transport-clock">
        <span>Retained time <span aria-hidden="true">·</span> gaps excluded</span>
        <output aria-label="Recording elapsed time">{formatTransportTime(elapsedMs)} <span>/ {formatTransportTime(timeline.durationMs)}</span></output>
      </div>
      <div className="ll-transport-track" style={{ "--ll-transport-progress": `${percent}%` } as CSSProperties}>
        <input
          type="range"
          aria-label="Recording position"
          aria-valuetext={`${formatTransportTime(elapsedMs)} of ${formatTransportTime(timeline.durationMs)} retained`}
          min={0}
          max={timeline.durationMs}
          step={1}
          value={elapsedMs}
          onChange={(event) => seek(retainedPosition(timeline, event.currentTarget.valueAsNumber), "operator")}
          onKeyDown={(event) => {
            const requested = event.key === "Home" ? 0 : event.key === "End" ? timeline.durationMs
              : ["ArrowLeft", "ArrowDown"].includes(event.key) ? elapsedMs - 5000
              : ["ArrowRight", "ArrowUp"].includes(event.key) ? elapsedMs + 5000 : null;
            if (requested == null) return;
            event.preventDefault();
            seek(retainedPosition(timeline, requested), "operator");
          }}
        />
        <div className="ll-transport-boundaries" aria-hidden="true">
          {timeline.entries.slice(1).map((entry) => <span
            key={entry.key}
            className={entry.boundaryBefore ? `ll-transport-boundary-${entry.boundaryBefore.kind}` : ""}
            style={{ left: `${entry.retainedStartMs / timeline.durationMs * 100}%` }}
            title={entry.boundaryBefore ? `${gapDuration(entry.boundaryBefore.durationMs)} ${entry.boundaryBefore.kind} before segment ${timeline.entries.indexOf(entry) + 1}` : "Segment boundary"}
          />)}
        </div>
      </div>
      <div className="ll-transport-actions">
        <div className="ll-transport-skips">
          <button type="button" aria-label="Back 15 seconds" title="Back 15 seconds" disabled={elapsedMs <= 0} onClick={() => seek(retainedPosition(timeline, elapsedMs - 15_000), "operator")}><RotateCcw size={15} /><span>15</span></button>
          <button type="button" aria-label="Forward 15 seconds" title="Forward 15 seconds" disabled={elapsedMs >= timeline.durationMs} onClick={() => seek(retainedPosition(timeline, elapsedMs + 15_000), "operator")}><RotateCw size={15} /><span>15</span></button>
        </div>
        <label className="ll-transport-speed"><span>Speed</span><select aria-label="Playback speed" value={speed} onChange={(event) => {
          const next = Number(event.target.value);
          speedRef.current = next;
          setSpeed(next);
          if (videoRef.current) videoRef.current.playbackRate = next;
        }}>{!playbackSpeeds.includes(speed) && <option value={speed}>{speed}×</option>}{playbackSpeeds.map((value) => <option key={value} value={value}>{value}×</option>)}</select></label>
        {(!compact || timeline.entries.length > 1) && <label className="ll-transport-segment"><span>Media segment</span><select aria-label="Media segment" value={current.key} onChange={(event) => {
          const entry = timeline.entries.find((item) => item.key === event.target.value);
          if (entry) seek({ entry, offsetMs: 0, retainedMs: entry.retainedStartMs }, "operator");
        }}>{timeline.entries.map((entry, index) => <option key={entry.key} value={entry.key}>{index + 1} of {timeline.entries.length} · {captureTime(entry.startedAtMs)} · {(entry.durationMs / 1000).toFixed(1)}s</option>)}</select></label>}
      </div>
      {timelines.length > 1 && <label className="ll-transport-recording"><span>Recording</span><select aria-label="Recording" value={timeline.jobId} onChange={(event) => {
        const next = timelines.find((item) => item.jobId === event.target.value);
        if (next) seek(retainedPosition(next, 0), "operator", false);
      }}>{timelines.map((item) => <option key={item.jobId} value={item.jobId}>{captureTime(item.entries[0].startedAtMs)} · {formatTransportTime(item.durationMs)} saved · {item.jobId.slice(0, 8)}</option>)}</select></label>}
      {discontinuities.length > 0 && <details className="ll-transport-gaps">
        <summary>Recording gaps &amp; overlaps <span>{discontinuities.length}</span></summary>
        <p>Playback joins saved files. Gaps add no retained time; overlapping files remain separate.</p>
        <ul>{discontinuities.map((entry) => <li key={entry.key}>
          <time>{formatTransportTime(entry.retainedStartMs)}</time><span>{gapDuration(entry.boundaryBefore!.durationMs)} {entry.boundaryBefore!.kind} before segment {timeline.entries.indexOf(entry) + 1} <small>· collector time {captureTime(entry.startedAtMs)}</small></span>
        </li>)}</ul>
      </details>}
      {evidence && (evidence.capturedAtMs == null || !Number.isFinite(evidence.capturedAtMs)) && <p className="ll-transport-alignment" role="status">This evidence has no collector timestamp for media alignment.</p>}
      {evidence && evidence.capturedAtMs != null && Number.isFinite(evidence.capturedAtMs) && !collectorAligned && <p className="ll-transport-alignment" role="status">No retained segment covers this evidence's collector timestamp.</p>}
    </div>
  </div>;
}
