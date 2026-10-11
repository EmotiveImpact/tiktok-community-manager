import type { Evidence } from "../../lib/livelens/api";

export type RecordingSegment = {
  key: string;
  id: string;
  jobId: string;
  startedAtMs: number;
  durationMs: number;
  sha256: string;
};

export type RecordingEntry = RecordingSegment & {
  retainedStartMs: number;
  retainedEndMs: number;
  boundaryBefore: { kind: "gap" | "overlap"; durationMs: number } | null;
};

export type RecordingTimeline = {
  jobId: string;
  entries: RecordingEntry[];
  durationMs: number;
};

export type RecordingPosition = { entry: RecordingEntry; offsetMs: number; retainedMs: number };

/** Saved time is a concatenation of verified files, not elapsed wall-clock time. */
export function buildRecordingTimelines(segments: readonly RecordingSegment[]): RecordingTimeline[] {
  const seen = new Set<string>();
  const seenMedia = new Set<string>();
  const jobs = new Map<string, RecordingSegment[]>();
  for (const segment of segments) {
    if (!segment.key || !segment.id || !segment.jobId ||
        !Number.isFinite(segment.startedAtMs) || !Number.isFinite(segment.durationMs) ||
        segment.durationMs <= 0 || segment.durationMs > Number.MAX_SAFE_INTEGER ||
        Math.abs(segment.startedAtMs) > Number.MAX_SAFE_INTEGER ||
        Math.abs(segment.startedAtMs + segment.durationMs) > Number.MAX_SAFE_INTEGER ||
        seen.has(segment.key) || seenMedia.has(JSON.stringify([segment.jobId, segment.id]))) continue;
    seen.add(segment.key);
    seenMedia.add(JSON.stringify([segment.jobId, segment.id]));
    const entries = jobs.get(segment.jobId) ?? [];
    entries.push(segment);
    jobs.set(segment.jobId, entries);
  }
  const timelines: RecordingTimeline[] = [];
  for (const [jobId, segmentsForJob] of jobs) {
    segmentsForJob.sort((a, b) => a.startedAtMs - b.startedAtMs || a.key.localeCompare(b.key));
    const entries: RecordingEntry[] = [];
    let durationMs = 0;
    let coverageEnd: number | null = null;
    for (const segment of segmentsForJob) {
      if (durationMs + segment.durationMs > Number.MAX_SAFE_INTEGER) continue;
      // Compare with the union of all prior coverage. A short, nested duplicate
      // must not create a false "gap" inside a longer retained file.
      const delta = coverageEnd == null ? 0 : segment.startedAtMs - coverageEnd;
      entries.push({
        ...segment,
        retainedStartMs: durationMs,
        retainedEndMs: durationMs + segment.durationMs,
        boundaryBefore: delta === 0 ? null : {
          kind: delta > 0 ? "gap" : "overlap",
          durationMs: delta > 0 ? delta : Math.min(segment.durationMs, Math.abs(delta)),
        },
      });
      durationMs += segment.durationMs;
      coverageEnd = Math.max(coverageEnd ?? -Infinity, segment.startedAtMs + segment.durationMs);
    }
    if (entries.length) timelines.push({ jobId, entries, durationMs });
  }
  return timelines.sort((a, b) =>
    a.entries[0].startedAtMs - b.entries[0].startedAtMs || a.jobId.localeCompare(b.jobId));
}

/** An exact internal boundary belongs to the following file; the final end stays in the last file. */
export function retainedPosition(timeline: RecordingTimeline, requestedMs: number): RecordingPosition | null {
  if (!timeline.entries.length) return null;
  const finiteMs = Number.isNaN(requestedMs) ? 0 : requestedMs;
  const retainedMs = Math.max(0, Math.min(timeline.durationMs, finiteMs));
  const entry = timeline.entries.find((segment) => retainedMs < segment.retainedEndMs) ?? timeline.entries.at(-1)!;
  return { entry, offsetMs: retainedMs - entry.retainedStartMs, retainedMs };
}

/** Only the collector clock establishes an offset into captured media. */
export function collectorPosition(
  timelines: readonly RecordingTimeline[],
  evidence: Pick<Evidence, "capturedAtMs">,
  preferredJobId?: string,
): RecordingPosition | null {
  const timestamp = evidence.capturedAtMs;
  if (timestamp == null || !Number.isFinite(timestamp)) return null;
  const preferred = timelines.find((timeline) => timeline.jobId === preferredJobId);
  const ordered = preferred ? [preferred, ...timelines.filter((timeline) => timeline !== preferred)] : timelines;
  for (const timeline of ordered) {
    const entry = timeline.entries.find((segment) =>
      timestamp >= segment.startedAtMs && timestamp < segment.startedAtMs + segment.durationMs);
    if (entry) {
      const offsetMs = timestamp - entry.startedAtMs;
      return { entry, offsetMs, retainedMs: entry.retainedStartMs + offsetMs };
    }
  }
  return null;
}

export function formatTransportTime(milliseconds: number): string {
  const seconds = Math.floor(Math.max(0, Number.isFinite(milliseconds) ? milliseconds : 0) / 1000);
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor(seconds / 60) % 60;
  return hours
    ? `${hours}:${String(minutes).padStart(2, "0")}:${String(seconds % 60).padStart(2, "0")}`
    : `${minutes}:${String(seconds % 60).padStart(2, "0")}`;
}
