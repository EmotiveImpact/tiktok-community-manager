import { describe, expect, it } from "vitest";
import {
  buildDeskItems,
  filterDeskItems,
  sourceForDeskItem,
  actionForDeskItem,
} from "../src/components/livelens/ReviewDesk";
import type { Evidence, Session } from "../src/lib/livelens/api";

const event = (
  id: string,
  kind = "transcript",
  receivedAtMs = 100,
  sessionId = "session-a",
): Evidence => ({
  id,
  sessionId,
  kind,
  text: `Original statement ${id}`,
  sourceTimestampMs: null,
  capturedAtMs: 20,
  receivedAtMs,
  sequence: 1,
  source: { adapter: "known-fixture", eventId: `provider-${id}` },
  attribution: { status: "unknown", account: null },
  integrity: { payloadSha256: "original-hash" },
});
const session = (id: string): Session => ({
  id,
  platform: "fixture",
  account: null,
  title: `Conversation ${id}`,
  sourceUrl: "https://example.invalid/source",
  startedAtMs: 500,
});
const alert = (id: string, status = "pending") => ({
  id,
  missionId: "mission-a",
  ruleLabel: "Operator-selected literal rule",
  status,
  sessionId: "session-a",
  evidenceId: "support",
  evidenceIds: ["support"],
  contextEvidenceIds: ["gap"],
  gapEvidenceIds: ["gap"],
  matchedTerms: ["literal"],
  uncertainty: ["Not a determination of intent."],
  createdAtMs: 50,
});
const detail = (status = "draft", label = "operator-finding") => ({
  case: {
    id: "case-a",
    title: "Question",
    question: "What was said?",
    createdAtMs: 5,
  },
  evidence: [event("support"), event("counter")],
  findings: [
    {
      id: "finding-a",
      title: "Operator title",
      statement: "Retained draft interpretation",
      status,
      label,
      supportEvidenceIds: ["support"],
      counterEvidenceIds: ["counter"],
      history: [{ createdAtMs: 60, reviewer: "reviewer-a" }],
    },
  ],
});
const empty = {
  evidence: [] as Evidence[],
  alerts: [] as ReturnType<typeof alert>[],
  details: [] as ReturnType<typeof detail>[],
  sessions: [] as Session[],
};

describe("LiveLens review desk source derivation", () => {
  it("orders explicit review categories without inventing severity or review state for captures", () => {
    const source = Object.freeze(event("support", "transcript", 900));
    const queue = buildDeskItems({
      ...empty,
      evidence: [source, event("gap", "gap", 800)],
      alerts: [alert("alert-a")],
      details: [detail()],
      sessions: [session("session-a")],
    });
    expect(queue.items.map((item) => item.kind)).toEqual([
      "alert",
      "finding",
      "gap",
      "evidence",
    ]);
    expect(queue.items.map((item) => item.state)).toEqual([
      "Needs review",
      "Draft",
      "Capture gap",
      "Retained",
    ]);
    expect(
      filterDeskItems(queue.items, "review").map((item) => item.kind),
    ).toEqual(["alert", "finding"]);
    expect(
      filterDeskItems(queue.items, "evidence").map((item) => item.kind),
    ).toEqual(["gap", "evidence"]);
    expect(
      queue.items.some(
        (item) => item.state === "New" || item.state === "Unread",
      ),
    ).toBe(false);
    expect(source.sourceTimestampMs).toBeNull();
    expect(queue.items.find((item) => item.kind === "evidence")?.atMs).toBe(
      900,
    );
    expect(
      queue.items.find((item) => item.kind === "evidence")?.evidence[0],
    ).toBe(source);
  });
  it("keeps real signal states in All while only pending signals and drafts need review, preserving exact sources and model origin", () => {
    const queue = buildDeskItems({
      ...empty,
      alerts: [
        alert("pending"),
        alert("ack", "acknowledged"),
        alert("reviewed", "reviewed"),
        alert("dismissed", "dismissed"),
      ],
      details: [
        detail("draft", "model-proposal"),
        { ...detail("reviewed"), case: { ...detail().case, id: "other-case" } },
      ],
    });
    expect(queue.items.map((item) => item.id)).toEqual([
      "alert:ack",
      "alert:dismissed",
      "alert:pending",
      "alert:reviewed",
      "finding:case-a:finding-a",
    ]);
    expect(
      filterDeskItems(queue.items, "review").map((item) => item.id),
    ).toEqual(["alert:pending", "finding:case-a:finding-a"]);
    const finding = queue.items.at(-1)!;
    expect(finding.finding?.label).toBe("model-proposal");
    expect(finding.supportIds).toEqual(["support"]);
    expect(finding.counterIds).toEqual(["counter"]);
    expect(finding.evidenceId).toBe("support");
    expect(finding.sessionId).toBe("session-a");
    expect(finding.atMs).toBe(60);
  });
  it("keeps conversations without loaded evidence available without duplicating represented sessions", () => {
    const queue = buildDeskItems({
      ...empty,
      evidence: [event("known")],
      sessions: [session("session-a"), session("session-b")],
    });
    expect(
      queue.items
        .filter((item) => item.kind === "session")
        .map((item) => item.sessionId),
    ).toEqual(["session-b"]);
    expect(queue.items.at(-1)?.needsReview).toBe(false);
    expect(queue.items.at(-1)?.evidenceId).toBeUndefined();
  });
  it("deduplicates retained IDs, makes ties deterministic, and bounds the displayed selection", () => {
    const same = event("duplicate");
    const queue = buildDeskItems({
      ...empty,
      evidence: [
        same,
        same,
        ...Array.from({ length: 205 }, (_, index) =>
          event(`source-${String(index).padStart(3, "0")}`, "chat", index),
        ),
      ],
    });
    expect(queue.items).toHaveLength(200);
    expect(queue.truncated).toBe(true);
    expect(new Set(queue.items.map((item) => item.id)).size).toBe(200);
    expect(queue.items[0].id).toBe("evidence:source-204");
  });
  it("carries server truncation and leaves unavailable clocks and anonymous accounts unchanged", () => {
    const original = event("anonymous");
    const caseDetail = {
      ...detail(),
      truncated: true,
      evidence: [original],
      findings: [],
    };
    const queue = buildDeskItems({
      ...empty,
      evidence: [original],
      details: [caseDetail],
    });
    expect(queue.truncated).toBe(true);
    expect(queue.items[0].evidence[0].attribution.account).toBeNull();
    expect(queue.items[0].evidence[0].sourceTimestampMs).toBeNull();
    expect(queue.items[0].evidence[0].capturedAtMs).toBe(20);
  });
  it("revalidates the selected statement against current finding source roles after a revision refresh", () => {
    const finding = buildDeskItems({ ...empty, details: [detail()] }).items[0];
    const choice = { itemId: finding.id, evidenceId: "counter" };
    expect(sourceForDeskItem(finding, choice)).toBe("counter");
    const corrected = { ...finding, counterIds: [], supportIds: ["support"] };
    expect(sourceForDeskItem(corrected, choice)).toBe("support");
    const replacement = {
      ...corrected,
      supportIds: ["replacement"],
      evidenceId: "replacement",
    };
    expect(sourceForDeskItem(replacement, choice)).toBe("replacement");
    expect(
      sourceForDeskItem(replacement, {
        itemId: "other-item",
        evidenceId: "replacement",
      }),
    ).toBe("replacement");
    expect(sourceForDeskItem(null, choice)).toBeUndefined();
  });
  it("scopes pending, successful and failed acknowledgement state to its exact selected signal", () => {
    const before = buildDeskItems({
      ...empty,
      alerts: [alert("pending")],
      details: [detail()],
    });
    const signal = before.items[0];
    const draft = before.items[1];
    const pending = { itemId: signal.id, busy: true, error: "", receipt: "" };
    expect(actionForDeskItem(pending, signal).busy).toBe(true);
    expect(actionForDeskItem(pending, draft).busy).toBe(false);
    const receipt = {
      itemId: signal.id,
      busy: false,
      error: "",
      receipt: "Signal acknowledged",
    };
    const after = filterDeskItems(
      buildDeskItems({
        ...empty,
        alerts: [alert("pending", "acknowledged")],
        details: [detail()],
      }).items,
      "review",
    );
    expect(after[0].kind).toBe("finding");
    expect(actionForDeskItem(receipt, after[0]).receipt).toBe("");
    expect(actionForDeskItem(receipt, signal).receipt).toBe(
      "Signal acknowledged",
    );
    expect(
      actionForDeskItem(
        { ...receipt, error: "scope denied", receipt: "" },
        draft,
      ).error,
    ).toBe("");
  });
});
