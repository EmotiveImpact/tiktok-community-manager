import { describe, expect, it } from "vitest";
import {
  buildRecordingTimelines,
  collectorPosition,
  formatTransportTime,
  retainedPosition,
  type RecordingSegment,
} from "../src/components/livelens/recording-transport-model";

const segment = (id: string, startedAtMs: number, durationMs: number, jobId = "a"): RecordingSegment => ({
  id, jobId, startedAtMs, durationMs, key: `${jobId}/${id}`, sha256: "verified-sha",
});

describe("recording transport retained time", () => {
  it("maps an internal boundary to the next file and the final end to the last file", () => {
    const [timeline] = buildRecordingTimelines([segment("1", 10_000, 2023), segment("2", 12_023, 2000)]);
    expect(retainedPosition(timeline, 2022)?.entry.id).toBe("1");
    expect(retainedPosition(timeline, 2023)).toMatchObject({ entry: { id: "2" }, offsetMs: 0, retainedMs: 2023 });
    expect(retainedPosition(timeline, 4023)).toMatchObject({ entry: { id: "2" }, offsetMs: 2000, retainedMs: 4023 });
  });

  it("clamps skips to the same recording instead of crossing into another job", () => {
    const [timeline] = buildRecordingTimelines([segment("1", 0, 1000), segment("2", 10_000, 1000, "b")]);
    expect(retainedPosition(timeline, -15_000)).toMatchObject({ entry: { jobId: "a" }, offsetMs: 0 });
    expect(retainedPosition(timeline, 15_000)).toMatchObject({ entry: { jobId: "a" }, offsetMs: 1000 });
    expect(retainedPosition(timeline, Infinity)?.retainedMs).toBe(1000);
    expect(retainedPosition(timeline, -Infinity)?.retainedMs).toBe(0);
    expect(retainedPosition(timeline, NaN)?.retainedMs).toBe(0);
  });

  it("excludes capture gaps from saved duration and exposes their collector-clock boundary", () => {
    const [timeline] = buildRecordingTimelines([segment("2", 20_000, 3000), segment("1", 10_000, 2000)]);
    expect(timeline.durationMs).toBe(5000);
    expect(timeline.entries[1]).toMatchObject({ retainedStartMs: 2000, boundaryBefore: { kind: "gap", durationMs: 8000 } });
    expect(collectorPosition([timeline], { capturedAtMs: 15_000 })).toBeNull();
    expect(collectorPosition([timeline], { capturedAtMs: 20_500 })).toMatchObject({ offsetMs: 500, retainedMs: 2500 });
  });

  it("keeps overlapping files explicit without fabricating one continuous collector clock", () => {
    const [timeline] = buildRecordingTimelines([segment("1", 10_000, 3000), segment("2", 12_000, 2000)]);
    expect(timeline.durationMs).toBe(5000);
    expect(timeline.entries[1].boundaryBefore).toEqual({ kind: "overlap", durationMs: 1000 });
    expect(retainedPosition(timeline, 3500)).toMatchObject({ entry: { id: "2" }, offsetMs: 500 });
    expect(collectorPosition([timeline], { capturedAtMs: 12_500 })).toMatchObject({ entry: { id: "1" }, offsetMs: 2500 });
  });

  it("isolates overlapping jobs and prefers the explicitly selected recording for evidence", () => {
    const timelines = buildRecordingTimelines([segment("1", 10_000, 3000), segment("1", 11_000, 4000, "b"), segment("2", 13_000, 2000)]);
    expect(timelines.map((item) => [item.jobId, item.durationMs])).toEqual([["a", 5000], ["b", 4000]]);
    expect(timelines[0].entries.map((item) => item.key)).toEqual(["a/1", "a/2"]);
    expect(collectorPosition(timelines, { capturedAtMs: 12_000 }, "b")).toMatchObject({ entry: { jobId: "b" }, offsetMs: 1000 });
  });

  it("does not invent a gap where a longer earlier file covers nested overlapping files", () => {
    const [timeline] = buildRecordingTimelines([
      segment("long", 0, 10_000), segment("nested-a", 3000, 2000),
      segment("nested-b", 6000, 3000), segment("after", 12_000, 1000),
    ]);
    expect(timeline.durationMs).toBe(16_000);
    expect(timeline.entries.map((entry) => entry.boundaryBefore)).toEqual([
      null, { kind: "overlap", durationMs: 2000 }, { kind: "overlap", durationMs: 3000 },
      { kind: "gap", durationMs: 2000 },
    ]);
    expect(collectorPosition([timeline], { capturedAtMs: 5500 })?.entry.id).toBe("long");
  });

  it("never uses matching provider or receipt timestamps in place of the collector clock", () => {
    const timelines = buildRecordingTimelines([segment("1", 10_000, 3000)]);
    const providerOnly = { capturedAtMs: null, sourceTimestampMs: 11_000, receivedAtMs: 11_000 };
    expect(collectorPosition(timelines, providerOnly)).toBeNull();
    expect(collectorPosition(timelines, { capturedAtMs: NaN })).toBeNull();
    expect(collectorPosition(timelines, { capturedAtMs: 13_000 })).toBeNull();
    expect(collectorPosition(timelines, { capturedAtMs: 10_000 })?.offsetMs).toBe(0);
  });

  it("ignores malformed or duplicate receipts without poisoning the cumulative range", () => {
    const valid = segment("1", 10_000, 2000);
    const [timeline] = buildRecordingTimelines([
      segment("bad-zero", 0, 0), segment("bad-negative", 0, -1), segment("bad-infinite", 0, Infinity),
      segment("bad-start", NaN, 1000), segment("bad-overflow", Number.MAX_SAFE_INTEGER, 1000),
      valid, valid, { ...valid, key: "duplicate-media-with-another-key" }, segment("2", 12_000, 1000),
    ]);
    expect(timeline.entries.map((item) => item.id)).toEqual(["1", "2"]);
    expect(timeline.durationMs).toBe(3000);
    expect(buildRecordingTimelines([segment("invalid", 0, NaN)])).toEqual([]);
  });

  it("formats long recordings without turning hours into wrapped minutes", () => {
    expect(formatTransportTime(0)).toBe("0:00");
    expect(formatTransportTime(65_900)).toBe("1:05");
    expect(formatTransportTime(3_661_000)).toBe("1:01:01");
    expect(formatTransportTime(NaN)).toBe("0:00");
  });
});
