export type LibraryRecording = {
  id: string;
  sessionId: string;
  state: string;
  createdAtMs: number;
  stopRequested: boolean;
  error: string | null;
  segments: { id: string; durationMs: number; bytes: number }[];
};

export type LibraryMedia = {
  latest: LibraryRecording | null;
  saved: LibraryRecording | null;
  durationMs: number;
};

/** A saved capture is one job's retained segments, not the conversation's length. */
export function indexLibraryMedia(jobs: LibraryRecording[]) {
  const result = new Map<string, LibraryMedia>();
  const newest = [...jobs].sort(
    (a, b) => b.createdAtMs - a.createdAtMs || b.id.localeCompare(a.id),
  );
  for (const job of newest) {
    const summary = result.get(job.sessionId) ?? {
      latest: job,
      saved: null,
      durationMs: 0,
    };
    if (!summary.saved && job.segments.length) {
      summary.saved = job;
      // Retry receipts must not inflate duration if a segment occurs twice.
      summary.durationMs = [...new Map(job.segments.map((segment) => [segment.id, segment])).values()]
        .reduce((total, segment) => total + (Number.isFinite(segment.durationMs) && segment.durationMs > 0 ? segment.durationMs : 0), 0);
    }
    result.set(job.sessionId, summary);
  }
  return result;
}

export function formatSavedDuration(milliseconds: number) {
  if (!Number.isFinite(milliseconds) || milliseconds <= 0) return "Duration unavailable";
  const seconds = Math.floor(milliseconds / 1000);
  if (seconds < 1) return "Under 1 sec";
  return seconds >= 3600
    ? `${Math.floor(seconds / 3600)}:${String(Math.floor(seconds / 60) % 60).padStart(2, "0")}:${String(seconds % 60).padStart(2, "0")}`
    : `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;
}

export function recordingState(job: LibraryRecording) {
  if (job.stopRequested && !["completed", "failed", "stopped"].includes(job.state)) return "Stopping";
  const states: Record<string, string> = {
    completed: "Completed", stopped: "Stopped", failed: "Interrupted",
    recording: job.segments.length ? "Recording" : "Starting",
    queued: "Queued", starting: "Starting", recovering: "Recovering", retrying: "Retrying",
  };
  return states[job.state] ?? job.state.replaceAll("_", " ");
}
