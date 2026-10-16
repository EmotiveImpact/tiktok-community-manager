import { describe, expect, it } from "vitest";
import { formatSavedDuration, indexLibraryMedia, recordingState, type LibraryRecording } from "../src/components/livelens/recording-library-model";

const job = (overrides: Partial<LibraryRecording>): LibraryRecording => ({
  id: "capture", sessionId: "session", state: "completed", createdAtMs: 1,
  stopRequested: false, error: null, segments: [], ...overrides,
});
describe("recording library receipt summaries", () => {
  it("keeps an older interrupted capture when a newer request has no saved media", () => {
    const retained = job({ id: "saved", state: "failed", segments: [{ id: "a", durationMs: 2300, bytes: 10 }] });
    const pending = job({ id: "new", createdAtMs: 2, state: "queued" });
    const value = indexLibraryMedia([pending, retained]).get("session")!;
    expect(value.latest?.id).toBe("new");
    expect(value.saved?.id).toBe("saved");
    expect(value.durationMs).toBe(2300);
  });
  it("uses the latest saved capture's retained duration without combining separate jobs", () => {
    const older = job({ id: "old", segments: [{ id: "a", durationMs: 8000, bytes: 10 }] });
    const newer = job({ id: "new", createdAtMs: 2, state: "stopped", segments: [{ id: "b", durationMs: 3000, bytes: 10 }, { id: "b", durationMs: 3000, bytes: 10 }] });
    const value = indexLibraryMedia([older, newer]).get("session")!;
    expect(value.saved?.id).toBe("new");
    expect(value.durationMs).toBe(3000);
  });
  it("leaves sessions absent from a bounded receipt snapshot unknown", () => {
    const value = indexLibraryMedia([job({ sessionId: "another-session" })]);
    expect(value.has("session")).toBe(false);
    expect(value.get("another-session")?.saved).toBeNull();
  });
  it("does not present a running empty capture as recorded video", () => {
    expect(recordingState(job({ state: "recording" }))).toBe("Starting");
    expect(recordingState(job({ state: "recording", stopRequested: true }))).toBe("Stopping");
    expect(formatSavedDuration(0)).toBe("Duration unavailable");
    expect(formatSavedDuration(3_661_000)).toBe("1:01:01");
  });
});
