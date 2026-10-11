import { useMemo, useRef, useState, type FormEvent } from "react";
import {
  ArrowRight,
  Maximize2,
  Network,
  Plus,
  ZoomIn,
  ZoomOut,
} from "lucide-react";
import { api } from "../../../lib/livelens/api";
import {
  Empty,
  EvidenceList,
  Loading,
  Notice,
  Section,
  Status,
  useAction,
  useEvidenceIds,
  useResource,
  type OpenEvidence,
} from "./shared";

type Node = {
  id: string;
  kind: string;
  sourceId: string;
  label: string;
  evidenceIds?: string[];
  identityStatus?: string;
  declarationStatus?: string;
  declaredBy?: string;
  provenance?: {
    sessionId: string;
    trackScope: string;
    speechJobId?: string | null;
    mediaSegmentId?: string | null;
    engine?: { id: string; version: string; language?: string } | null;
  };
};
const entityKind = (kind: string) =>
  (
    ({
      session: "Session",
      account: "Platform account",
      evidence: "Statement",
      speaker: "Anonymous speaker track",
      person: "Person reference",
      topic: "Topic",
    }) as Record<string, string>
  )[kind] ?? kind;
const entityColumn = (kind: string) =>
  (
    ({
      session: "Sessions",
      account: "Accounts",
      evidence: "Statements",
      speaker: "Anonymous tracks",
      person: "Person references",
      topic: "Topics",
    }) as Record<string, string>
  )[kind] ?? kind;
const identityLimit = (node: Node) =>
  node.kind === "speaker"
    ? "This is an anonymous track within its retained speech source. Its account and real-world identity remain unknown; tracks from different jobs are not merged."
    : node.kind === "person"
      ? "This person reference was declared by an operator. It is not a verified real-world identity or an automatic identification of an account or speaker."
      : "";
const shortEntityLabel = (node: Node) =>
  node.kind === "person"
    ? node.label.replace(/^Person reference:\s*/, "")
    : node.kind === "speaker"
      ? node.label.replace(/^Anonymous speaker\s*/, "Track ")
      : node.label;
const speakerScope = (node?: Node) =>
  node?.kind === "speaker"
    ? node.provenance?.speechJobId
      ? `Speech job ${node.provenance.speechJobId}${node.provenance.mediaSegmentId ? ` · segment ${node.provenance.mediaSegmentId}` : ""}`
      : `Source track ${node.sourceId.slice(-10)}`
    : "";
type Edge = {
  id: string;
  from: string;
  to: string;
  label: string;
  status: string;
  evidenceIds: string[];
  reviewer?: string;
  reason?: string;
};
type Graph = {
  nodes: Node[];
  edges: Edge[];
  bounded?: boolean;
  limitation?: string;
};
type Point = { x: number; y: number };

export default function ContextGraph({
  onOpenEvidence,
}: {
  onOpenEvidence: OpenEvidence;
}) {
  const resource = useResource<Graph>("/v1/graph?limit=80");
  const [selection, setSelection] = useState<{
    kind: "node" | "edge";
    id: string;
  } | null>(null);
  const [status, setStatus] = useState("all");
  const [zoom, setZoom] = useState(1);
  const [presentation, setPresentation] = useState(() =>
    typeof window !== "undefined" &&
    window.matchMedia("(max-width: 560px)").matches
      ? "connections"
      : "map",
  );
  const canvas = useRef<HTMLDivElement>(null);
  const [editor, setEditor] = useState(false);
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [fromTopic, setFromTopic] = useState("");
  const [toTopic, setToTopic] = useState("");
  const [fromPerson, setFromPerson] = useState("");
  const [toPerson, setToPerson] = useState("");
  const [fromPersonId, setFromPersonId] = useState(() => crypto.randomUUID());
  const [toPersonId, setToPersonId] = useState(() => crypto.randomUUID());
  const [label, setLabel] = useState("");
  const [relationStatus, setRelationStatus] = useState("operator-reviewed");
  const [ids, setIds] = useState("");
  const [reason, setReason] = useState("");
  const action = useAction();
  const graph = resource.data;
  const chooseEntity = (side: "from" | "to", value: string) => {
    (side === "from" ? setFrom : setTo)(value);
    const node = graph?.nodes.find((item) => item.id === value);
    if (node?.kind === "speaker" && node.evidenceIds?.length)
      setIds((current) =>
        [
          ...new Set([
            ...(node.evidenceIds ?? []),
            ...current.split(",").filter(Boolean),
          ]),
        ]
          .slice(0, 200)
          .join(","),
      );
  };
  const selectedNode = graph?.nodes.find(
    (node) => selection?.kind === "node" && node.id === selection.id,
  );
  const selectedEdge = graph?.edges.find(
    (edge) => selection?.kind === "edge" && edge.id === selection.id,
  );
  const identityEndpoints = selectedEdge
    ? (graph?.nodes.filter(
        (node) =>
          [selectedEdge.from, selectedEdge.to].includes(node.id) &&
          ["speaker", "person"].includes(node.kind),
      ) ?? [])
    : [];
  const related =
    graph?.edges.filter(
      (edge) => edge.from === selectedNode?.id || edge.to === selectedNode?.id,
    ) ?? [];
  const sourceIds =
    selectedEdge?.evidenceIds ?? related.flatMap((edge) => edge.evidenceIds);
  const evidence = useEvidenceIds(sourceIds);
  const visibleEdges =
    graph?.edges.filter((edge) => status === "all" || edge.status === status) ??
    [];
  const visibleNodes =
    graph?.nodes.filter((node) =>
      visibleEdges.some((edge) => edge.from === node.id || edge.to === node.id),
    ) ?? [];
  const layout = useMemo(() => {
    const kinds = [
      "session",
      "account",
      "evidence",
      "speaker",
      "person",
      "topic",
    ].filter((kind) => visibleNodes.some((node) => node.kind === kind));
    const positions = new Map<string, Point>();
    const columns = kinds.map((kind) =>
      visibleNodes.filter((node) => node.kind === kind),
    );
    const height = Math.max(
      480,
      Math.max(...columns.map((column) => column.length), 1) * 72 + 90,
    );
    columns.forEach((column, index) =>
      column.forEach((node, position) =>
        positions.set(node.id, { x: 130 + index * 260, y: 92 + position * 72 }),
      ),
    );
    return {
      positions,
      height,
      kinds,
      width: Math.max(390, kinds.length * 260),
    };
  }, [graph, status]);
  const add = async (event: FormEvent) => {
    event.preventDefault();
    const parse = (
      id: string,
      topic: string,
      person: string,
      personId: string,
    ) => {
      if (id === "__topic") return { kind: "topic", id: topic.trim() };
      if (id === "__person")
        return { kind: "person", id: personId, label: person.trim() };
      const node = graph?.nodes.find((item) => item.id === id);
      if (!node) throw new Error("Choose an entity from the current map.");
      return { kind: node.kind, id: node.sourceId };
    };
    if (
      await action.run(
        () =>
          api("/v1/graph", {
            from: parse(from, fromTopic, fromPerson, fromPersonId),
            to: parse(to, toTopic, toPerson, toPersonId),
            label,
            status: relationStatus,
            evidenceIds: ids
              .split(",")
              .map((id) => id.trim())
              .filter(Boolean),
            reason,
          }),
        "Source-supported relationship saved.",
      )
    ) {
      setEditor(false);
      setLabel("");
      setReason("");
      setFrom("");
      setTo("");
      setFromPerson("");
      setToPerson("");
      setFromPersonId(crypto.randomUUID());
      setToPersonId(crypto.randomUUID());
      resource.reload();
    }
  };
  const activate = (kind: "node" | "edge", id: string) =>
    setSelection({ kind, id });
  const curve = (a: Point, b: Point) =>
    `M ${a.x + 75} ${a.y} C ${a.x + 160} ${a.y}, ${b.x - 160} ${b.y}, ${b.x - 75} ${b.y}`;
  return (
    <>
      <Notice error={resource.error || action.error} receipt={action.receipt} />
      <div className="aw-toolbar">
        <div className="aw-segmented" aria-label="Relationship status">
          {[
            ["all", "All relationships"],
            ["observed", "Observed"],
            ["operator-reviewed", "Reviewed"],
            ["inferred", "Inferred"],
          ].map(([value, label]) => (
            <button
              key={value}
              className={status === value ? "is-active" : ""}
              onClick={() => setStatus(value)}
            >
              {label}
            </button>
          ))}
        </div>
        <button className="aw-secondary" onClick={() => setEditor(!editor)}>
          <Plus size={15} />
          Add relationship
        </button>
      </div>
      {editor && (
        <Section
          title="Describe a supported relationship"
          description="Choose an existing entity, add a topic or declare a person reference. Platform accounts, anonymous voice tracks and person references remain distinct."
        >
          <form className="aw-form" onSubmit={add}>
            <div className="aw-form-grid">
              <label>
                From
                <select
                  required
                  value={from}
                  onChange={(event) => chooseEntity("from", event.target.value)}
                >
                  <option value="">Choose an entity</option>
                  {graph?.nodes.map((node) => (
                    <option value={node.id} key={node.id}>
                      {entityKind(node.kind)}: {shortEntityLabel(node)}
                    </option>
                  ))}
                  <option value="__topic">Create a new topic…</option>
                  <option value="__person">Declare a person reference…</option>
                </select>
                {from === "__topic" && (
                  <input
                    required
                    aria-label="New source topic"
                    maxLength={128}
                    value={fromTopic}
                    onChange={(event) => setFromTopic(event.target.value)}
                    placeholder="Name a topic"
                  />
                )}
                {from === "__person" && (
                  <>
                    <input
                      required
                      aria-label="New source person reference"
                      maxLength={128}
                      value={fromPerson}
                      onChange={(event) => setFromPerson(event.target.value)}
                      placeholder="Reference label; identity is unverified"
                    />
                    <span className="aw-help">
                      Your declared reference does not verify identity.
                    </span>
                  </>
                )}
              </label>
              <label>
                To
                <select
                  required
                  value={to}
                  onChange={(event) => chooseEntity("to", event.target.value)}
                >
                  <option value="">Choose an entity</option>
                  {graph?.nodes.map((node) => (
                    <option value={node.id} key={node.id}>
                      {entityKind(node.kind)}: {shortEntityLabel(node)}
                    </option>
                  ))}
                  <option value="__topic">Create a new topic…</option>
                  <option value="__person">Declare a person reference…</option>
                </select>
                {to === "__topic" && (
                  <input
                    required
                    aria-label="New destination topic"
                    maxLength={128}
                    value={toTopic}
                    onChange={(event) => setToTopic(event.target.value)}
                    placeholder="Name a topic"
                  />
                )}
                {to === "__person" && (
                  <>
                    <input
                      required
                      aria-label="New destination person reference"
                      maxLength={128}
                      value={toPerson}
                      onChange={(event) => setToPerson(event.target.value)}
                      placeholder="Reference label; identity is unverified"
                    />
                    <span className="aw-help">
                      Your declared reference does not verify identity.
                    </span>
                  </>
                )}
              </label>
              <label>
                Relationship label
                <input
                  required
                  maxLength={200}
                  value={label}
                  onChange={(event) => setLabel(event.target.value)}
                  placeholder="What does the evidence support?"
                />
              </label>
              <label>
                Interpretation
                <select
                  value={relationStatus}
                  onChange={(event) => setRelationStatus(event.target.value)}
                >
                  <option value="operator-reviewed">Operator reviewed</option>
                  <option value="inferred">Inferred; needs review</option>
                </select>
              </label>
            </div>
            <fieldset>
              <legend>Supporting statements</legend>
              <div className="aw-selection-list">
                {graph?.nodes
                  .filter((node) => node.kind === "evidence")
                  .map((node) => (
                    <label key={node.id}>
                      <input
                        type="checkbox"
                        checked={ids.split(",").includes(node.sourceId)}
                        onChange={() =>
                          setIds((current) => {
                            const selected = current.split(",").filter(Boolean);
                            return (
                              selected.includes(node.sourceId)
                                ? selected.filter((id) => id !== node.sourceId)
                                : [...selected, node.sourceId]
                            ).join(",");
                          })
                        }
                      />
                      <span>{node.label || "Capture gap"}</span>
                    </label>
                  ))}
              </div>
              <details className="aw-details">
                <summary>Reference other retained evidence</summary>
                <label>
                  Evidence IDs, separated by commas
                  <input
                    maxLength={8000}
                    value={ids}
                    onChange={(event) => setIds(event.target.value)}
                    placeholder="Use exact evidence IDs for sources outside this map"
                  />
                </label>
              </details>
            </fieldset>
            <label>
              Reason
              <textarea
                required
                maxLength={2000}
                rows={3}
                value={reason}
                onChange={(event) => setReason(event.target.value)}
                placeholder="Describe the source-supported connection and its limits."
              />
            </label>
            <div className="aw-form-footer">
              <span className="aw-help">
                Every relationship must reopen its sources.
              </span>
              <button
                className="aw-primary"
                disabled={action.busy || !ids.trim()}
              >
                Save relationship
                <ArrowRight size={14} />
              </button>
            </div>
          </form>
        </Section>
      )}
      <div className="aw-graph-layout">
        <Section
          title="Evidence map"
          description={`${visibleNodes.length} entities · ${visibleEdges.length} relationships`}
          action={
            presentation === "map" ? (
              <div className="aw-button-row">
                <button
                  className="aw-icon-button"
                  aria-label="Zoom out"
                  disabled={zoom <= 0.25}
                  onClick={() =>
                    setZoom((value) => Math.max(0.25, value - 0.2))
                  }
                >
                  <ZoomOut size={16} />
                </button>
                <button
                  className="aw-icon-button"
                  aria-label="Zoom in"
                  disabled={zoom >= 1.8}
                  onClick={() => setZoom((value) => Math.min(1.8, value + 0.2))}
                >
                  <ZoomIn size={16} />
                </button>
                <button
                  className="aw-icon-button"
                  aria-label="Fit graph to view"
                  onClick={() => {
                    setZoom(
                      Math.min(
                        1,
                        Math.max(
                          0.25,
                          (canvas.current?.clientWidth ?? layout.width) /
                            layout.width,
                        ),
                      ),
                    );
                    canvas.current?.scrollTo({ left: 0, top: 0 });
                  }}
                >
                  <Maximize2 size={16} />
                </button>
              </div>
            ) : undefined
          }
        >
          {resource.loading ? (
            <Loading />
          ) : !visibleNodes.length ? (
            <Empty title="The evidence map is empty">
              Capture or archive a conversation to see its observed links. Add
              reviewed relationships when sources support them.
            </Empty>
          ) : (
            <>
              <div className="aw-graph-view-toolbar">
                <div className="aw-segmented" aria-label="Graph presentation">
                  <button
                    className={presentation === "map" ? "is-active" : ""}
                    onClick={() => setPresentation("map")}
                  >
                    Map
                  </button>
                  <button
                    className={
                      presentation === "connections" ? "is-active" : ""
                    }
                    onClick={() => setPresentation("connections")}
                  >
                    Connections
                  </button>
                </div>
                {presentation === "map" && (
                  <span className="aw-help">Swipe to follow connections</span>
                )}
              </div>
              {presentation === "map" && (
                <div
                  className="aw-graph-column-nav"
                  aria-label="Navigate graph columns"
                >
                  {layout.kinds.map((kind, index) => (
                    <button
                      className="aw-text-button"
                      key={kind}
                      onClick={() =>
                        canvas.current?.scrollTo({
                          left: index * 260 * zoom,
                          top: 0,
                          behavior: window.matchMedia(
                            "(prefers-reduced-motion: reduce)",
                          ).matches
                            ? "instant"
                            : "smooth",
                        })
                      }
                    >
                      {entityColumn(kind)}
                      <ArrowRight size={12} />
                    </button>
                  ))}
                </div>
              )}
              {presentation === "connections" ? (
                <div className="aw-graph-connections">
                  {visibleEdges.map((edge) => (
                    <button
                      key={edge.id}
                      className={`aw-select-row ${selectedEdge?.id === edge.id ? "is-selected" : ""}`}
                      aria-label={`${edge.label}, ${edge.status}; inspect sources`}
                      onClick={() => activate("edge", edge.id)}
                    >
                      <span className="aw-row-label">
                        <strong>
                          <span className="aw-entity-kind">
                            {entityKind(
                              graph?.nodes.find((node) => node.id === edge.from)
                                ?.kind ?? "entity",
                            )}
                          </span>
                          {graph?.nodes.find((node) => node.id === edge.from)
                            ?.label ?? edge.from}
                        </strong>
                        {speakerScope(
                          graph?.nodes.find((node) => node.id === edge.from),
                        ) && (
                          <small className="aw-track-scope">
                            {speakerScope(
                              graph?.nodes.find(
                                (node) => node.id === edge.from,
                              ),
                            )}
                          </small>
                        )}
                        <small>{edge.label}</small>
                        <span>
                          <span className="aw-entity-kind">
                            {entityKind(
                              graph?.nodes.find((node) => node.id === edge.to)
                                ?.kind ?? "entity",
                            )}
                          </span>
                          {graph?.nodes.find((node) => node.id === edge.to)
                            ?.label ?? edge.to}
                        </span>
                        {speakerScope(
                          graph?.nodes.find((node) => node.id === edge.to),
                        ) && (
                          <small className="aw-track-scope">
                            {speakerScope(
                              graph?.nodes.find((node) => node.id === edge.to),
                            )}
                          </small>
                        )}
                      </span>
                      <Status status={edge.status}>{edge.status}</Status>
                      <ArrowRight size={14} />
                    </button>
                  ))}
                </div>
              ) : (
                <>
                  <div
                    className="aw-graph-canvas"
                    ref={canvas}
                    tabIndex={0}
                    aria-label="Scrollable source-supported relationship map"
                  >
                    <svg
                      width={layout.width * zoom}
                      height={layout.height * zoom}
                      viewBox={`0 0 ${layout.width} ${layout.height}`}
                      role="group"
                      aria-label="Accounts, sessions, statements and topics connected by source-supported relationships"
                    >
                      {layout.kinds.map((kind, index) => (
                        <text
                          className="aw-graph-column"
                          key={kind}
                          x={130 + index * 260}
                          y={36}
                          textAnchor="middle"
                        >
                          {entityColumn(kind).toUpperCase()}
                        </text>
                      ))}
                      {visibleEdges.map((edge) => {
                        const a = layout.positions.get(edge.from),
                          b = layout.positions.get(edge.to);
                        if (!a || !b) return null;
                        const path = curve(a, b);
                        const active =
                          selection?.id === edge.id ||
                          selectedNode?.id === edge.from ||
                          selectedNode?.id === edge.to;
                        return (
                          <g
                            className={`aw-graph-edge aw-edge-${edge.status} ${active ? "is-selected" : ""}`}
                            key={edge.id}
                            role="button"
                            tabIndex={0}
                            aria-label={`${edge.label}, ${edge.status}; inspect sources`}
                            onClick={() => activate("edge", edge.id)}
                            onKeyDown={(event) => {
                              if (event.key === "Enter" || event.key === " ") {
                                event.preventDefault();
                                activate("edge", edge.id);
                              }
                            }}
                          >
                            <title>
                              {edge.label} · {edge.status}
                            </title>
                            <path className="aw-edge-hit" d={path} />
                            <path className="aw-edge-line" d={path} />
                          </g>
                        );
                      })}
                      {visibleNodes.map((node) => {
                        const point = layout.positions.get(node.id);
                        if (!point) return null;
                        return (
                          <g
                            className={`aw-graph-node aw-node-${node.kind} ${selectedNode?.id === node.id ? "is-selected" : ""}`}
                            key={node.id}
                            transform={`translate(${point.x},${point.y})`}
                            role="button"
                            tabIndex={0}
                            aria-label={`${entityKind(node.kind)}: ${node.label}; inspect connected evidence`}
                            onClick={() => activate("node", node.id)}
                            onKeyDown={(event) => {
                              if (event.key === "Enter" || event.key === " ") {
                                event.preventDefault();
                                activate("node", node.id);
                              }
                            }}
                          >
                            <title>
                              {node.label}
                              {speakerScope(node)
                                ? ` · ${speakerScope(node)}`
                                : ""}
                              {identityLimit(node)
                                ? ` · ${identityLimit(node)}`
                                : ""}
                            </title>
                            <rect
                              x={-76}
                              y={-24}
                              width={152}
                              height={48}
                              rx={7}
                            />
                            <text textAnchor="middle" y={4}>
                              {shortEntityLabel(node).length > 20
                                ? `${shortEntityLabel(node).slice(0, 19)}…`
                                : shortEntityLabel(node)}
                            </text>
                          </g>
                        );
                      })}
                    </svg>
                  </div>
                </>
              )}
              <div className="aw-graph-legend">
                <span>
                  <i className="aw-legend-observed" />
                  Observed
                </span>
                <span>
                  <i className="aw-legend-reviewed" />
                  Operator reviewed
                </span>
                <span>
                  <i className="aw-legend-inferred" />
                  Inferred
                </span>
              </div>
              {graph?.bounded && (
                <p className="aw-help aw-inset">
                  This map is a bounded view of recent retained evidence.
                </p>
              )}
            </>
          )}
        </Section>
        <Section
          title={
            selectedNode?.label ?? selectedEdge?.label ?? "Follow a connection"
          }
          description={
            selectedNode
              ? `${entityKind(selectedNode.kind)} · ${related.length} connected relationships${speakerScope(selectedNode) ? ` · ${speakerScope(selectedNode)}` : ""}`
              : selectedEdge
                ? "Source-supported relationship"
                : "Select any node or line to inspect its evidence."
          }
        >
          {!selection ? (
            <Empty title="Every link leads to a source">
              <Network size={28} />
              Observed links come from captured events. Reviewed and inferred
              links are separate operator interpretations.
            </Empty>
          ) : (
            <div className="aw-detail-content">
              {selectedNode && identityLimit(selectedNode) && (
                <div className="aw-notice">{identityLimit(selectedNode)}</div>
              )}
              {selectedNode?.kind === "speaker" && selectedNode.provenance && (
                <dl className="aw-key-values aw-track-provenance">
                  <div>
                    <dt>Track scope</dt>
                    <dd>
                      {(
                        {
                          "media-segment": "One media segment",
                          "recording-job-unseparated":
                            "Unseparated recording job",
                          "source-event": "One source event",
                        } as Record<string, string>
                      )[selectedNode.provenance.trackScope] ??
                        selectedNode.provenance.trackScope}
                    </dd>
                  </div>
                  <div>
                    <dt>Source conversation</dt>
                    <dd>
                      {graph?.nodes.find(
                        (node) =>
                          node.kind === "session" &&
                          node.sourceId === selectedNode.provenance?.sessionId,
                      )?.label ?? "Retained conversation"}
                    </dd>
                  </div>
                  {selectedNode.provenance.speechJobId && (
                    <div>
                      <dt>Speech job</dt>
                      <dd>{selectedNode.provenance.speechJobId}</dd>
                    </div>
                  )}
                  {selectedNode.provenance.mediaSegmentId && (
                    <div>
                      <dt>Media segment</dt>
                      <dd>{selectedNode.provenance.mediaSegmentId}</dd>
                    </div>
                  )}
                  {selectedNode.provenance.engine && (
                    <div>
                      <dt>Recognizer</dt>
                      <dd>
                        {selectedNode.provenance.engine.id} ·{" "}
                        {selectedNode.provenance.engine.version}
                      </dd>
                    </div>
                  )}
                </dl>
              )}
              {selectedNode?.kind === "person" && (
                <div className="aw-person-declaration">
                  <Status>Unverified identity</Status>
                  {selectedNode.declaredBy && (
                    <p className="aw-help">
                      Declared by {selectedNode.declaredBy}
                    </p>
                  )}
                </div>
              )}
              {selectedEdge && (
                <>
                  <Status status={selectedEdge.status}>
                    {selectedEdge.status}
                  </Status>
                  {selectedEdge.reason && <p>{selectedEdge.reason}</p>}
                  {selectedEdge.reviewer && (
                    <p className="aw-help">
                      Reviewed by {selectedEdge.reviewer}
                    </p>
                  )}
                  {identityEndpoints.map((node) => (
                    <div className="aw-identity-endpoint" key={node.id}>
                      <p>
                        {node.kind === "person"
                          ? `Person reference “${shortEntityLabel(node)}” · operator-declared; identity unverified.`
                          : `“${node.label}” · anonymous within its retained source.`}
                      </p>
                      {speakerScope(node) && (
                        <p className="aw-track-scope">{speakerScope(node)}</p>
                      )}
                      <button
                        className="aw-text-button"
                        onClick={() => activate("node", node.id)}
                      >
                        Inspect{" "}
                        {node.kind === "person"
                          ? "person reference"
                          : "speaker track"}
                        <ArrowRight size={14} />
                      </button>
                    </div>
                  ))}
                </>
              )}
              {selectedNode && (
                <div className="aw-related-list">
                  {related.map((edge) => (
                    <button
                      className="aw-select-row"
                      key={edge.id}
                      onClick={() => activate("edge", edge.id)}
                    >
                      <span>
                        {edge.label}
                        <small>{edge.status}</small>
                      </span>
                      <ArrowRight size={14} />
                    </button>
                  ))}
                </div>
              )}
              <Notice error={evidence.error} />
              {evidence.loading ? (
                <Loading />
              ) : (
                <EvidenceList
                  evidence={evidence.data}
                  onOpenEvidence={onOpenEvidence}
                />
              )}
            </div>
          )}
        </Section>
      </div>
      {graph?.limitation && <p className="aw-help">{graph.limitation}</p>}
    </>
  );
}
