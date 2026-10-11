import { useState, type FormEvent } from "react";
import {
  ArrowRight,
  Bell,
  ChevronDown,
  Play,
  Plus,
  ShieldCheck,
} from "lucide-react";
import { api, type Evidence, type Session } from "../../../lib/livelens/api";
import {
  collection,
  Empty,
  EvidenceList,
  Loading,
  Notice,
  Section,
  stamp,
  Status,
  useAction,
  useEvidenceIds,
  useResource,
  type OpenEvidence,
} from "./shared";

type MissionRule = {
  label: string;
  terms: string[];
  match: "any" | "all";
  contextTerms?: string[];
};
type Mission = {
  id: string;
  title: string;
  protectedAccount?: string | null;
  sessionIds: string[];
  sourceIds?: string[];
  rules: MissionRule[];
  revision: number;
  history?: {
    revision: number;
    reason: string;
    reviewer: string;
    createdAtMs: number;
  }[];
  createdAtMs?: number;
  updatedAtMs?: number;
  delivery?: { inApp: boolean };
};
type Alert = {
  id: string;
  missionId: string;
  missionTitle?: string;
  ruleLabel?: string;
  status: string;
  evidenceId: string;
  evidenceIds: string[];
  contextEvidenceIds: string[];
  gapEvidenceIds: string[];
  protectedAccount: string;
  matchedTerms: string[];
  uncertainty: string[];
  createdAtMs?: number;
  history: {
    status: string;
    reason: string;
    reviewer?: string;
    createdAtMs: number;
  }[];
};
const split = (value: string) =>
  value
    .split(",")
    .map((part) => part.trim())
    .filter(Boolean);

export function Missions({ onOpenEvidence }: { onOpenEvidence: OpenEvidence }) {
  const resource = useResource<unknown>("/v1/missions");
  const sessions = useResource<unknown>("/v1/sessions?limit=200");
  const [editor, setEditor] = useState(false);
  const [title, setTitle] = useState("");
  const [protectedAccount, setProtectedAccount] = useState("");
  const [editingMission, setEditingMission] = useState<Mission | null>(null);
  const [editReason, setEditReason] = useState("");
  const [sessionIds, setSessionIds] = useState<string[]>([]);
  const [rules, setRules] = useState([
    { label: "", terms: "", match: "any" as "any" | "all", contextTerms: "" },
  ]);
  const [runResult, setRunResult] = useState<Record<string, unknown> | null>(
    null,
  );
  const action = useAction();
  const items = collection<Mission>(resource.data, "missions");
  const sessionItems = collection<Session>(sessions.data, "sessions");
  const create = async (event: FormEvent) => {
    event.preventDefault();
    const saved = await action.run(
      () =>
        api(
          editingMission
            ? `/v1/missions/${encodeURIComponent(editingMission.id)}`
            : "/v1/missions",
          {
            title: title.trim(),
            protectedAccount: protectedAccount.replace(/^@/, "").trim(),
            sessionIds,
            rules: rules.map((rule) => ({
              label: rule.label.trim(),
              terms: split(rule.terms),
              match: rule.match,
              contextTerms: split(rule.contextTerms),
            })),
            delivery: { inApp: true },
            ...(editingMission
              ? {
                  reason: editReason,
                  expectedRevision: editingMission.revision,
                }
              : {}),
          },
        ),
      "Mission saved. Run it against retained evidence when you are ready.",
    );
    if (saved) {
      setEditor(false);
      setEditingMission(null);
      setTitle("");
      setSessionIds([]);
      setEditReason("");
      resource.reload();
    }
  };
  const run = async (mission: Mission) => {
    await action.run(async () => {
      const value = await api<Record<string, unknown>>(
        `/v1/missions/${encodeURIComponent(mission.id)}/run`,
        {},
      );
      setRunResult(value);
    }, `“${mission.title}” checked. Review any matches in Protection & alerts.`);
  };
  return (
    <>
      <div className="aw-intro">
        <div>
          <ShieldCheck size={22} />
          <p>
            Protect an account with explicit rules over selected conversations.
            Every match remains a signal for human review.
          </p>
        </div>
        <button
          className="aw-primary"
          onClick={() => {
            setEditor(!editor);
            setEditingMission(null);
            setTitle("");
            setProtectedAccount("");
            setSessionIds([]);
            setRules([
              { label: "", terms: "", match: "any", contextTerms: "" },
            ]);
            action.clear();
          }}
        >
          <Plus size={16} />
          {editor ? "Close editor" : "New mission"}
        </button>
      </div>
      <Notice error={resource.error || action.error} receipt={action.receipt} />
      {runResult && (
        <div className="aw-receipt">
          <strong>Latest run receipt</strong>
          <span>
            {Object.entries(runResult)
              .filter(
                ([key, value]) =>
                  typeof value !== "object" && !/workspace|id/i.test(key),
              )
              .map(
                ([key, value]) =>
                  `${key.replaceAll(/([A-Z])/g, " $1")}: ${String(value)}`,
              )
              .join(" · ") || "The service accepted the bounded rule run."}
          </span>
        </div>
      )}
      {editor && (
        <Section
          title={
            editingMission ? `Edit ${editingMission.title}` : "Design a mission"
          }
          description="Rules search retained statements and nearby mentions of the protected account literally. They do not decide whether an allegation is true."
        >
          <form onSubmit={create} className="aw-form">
            <div className="aw-form-grid">
              <label>
                Mission name
                <input
                  required
                  maxLength={160}
                  value={title}
                  onChange={(event) => setTitle(event.target.value)}
                  placeholder="What are you watching for?"
                />
              </label>
              <label>
                Protected account
                <input
                  required
                  maxLength={100}
                  value={protectedAccount}
                  onChange={(event) => setProtectedAccount(event.target.value)}
                  placeholder="@account"
                />
              </label>
            </div>
            <fieldset>
              <legend>Conversations in scope</legend>
              <p className="aw-help">
                Select only the captured conversations this mission should
                examine.
              </p>
              {sessions.loading ? (
                <Loading />
              ) : (
                <div className="aw-selection-list">
                  {sessionItems.map((session) => (
                    <label key={session.id}>
                      <input
                        type="checkbox"
                        checked={sessionIds.includes(session.id)}
                        onChange={() =>
                          setSessionIds((old) =>
                            old.includes(session.id)
                              ? old.filter((id) => id !== session.id)
                              : [...old, session.id],
                          )
                        }
                      />
                      <span>
                        {session.title}
                        <small>
                          {session.account ? `@${session.account} · ` : ""}
                          {stamp(session.startedAtMs)}
                        </small>
                      </span>
                    </label>
                  ))}
                  {!sessionItems.length && (
                    <Empty title="No retained sessions available">
                      Capture a conversation before adding a mission.
                    </Empty>
                  )}
                </div>
              )}
              <Notice error={sessions.error} />
            </fieldset>
            <fieldset>
              <legend>Detection rules</legend>
              <div className="aw-rule-list">
                {rules.map((rule, index) => (
                  <div className="aw-rule-editor" key={index}>
                    <div className="aw-form-grid">
                      <label>
                        Rule name
                        <input
                          required
                          maxLength={100}
                          value={rule.label}
                          onChange={(event) =>
                            setRules((old) =>
                              old.map((item, position) =>
                                position === index
                                  ? { ...item, label: event.target.value }
                                  : item,
                              ),
                            )
                          }
                          placeholder="Name this signal"
                        />
                      </label>
                      <label>
                        Match
                        <select
                          value={rule.match}
                          onChange={(event) =>
                            setRules((old) =>
                              old.map((item, position) =>
                                position === index
                                  ? {
                                      ...item,
                                      match: event.target.value as
                                        | "any"
                                        | "all",
                                    }
                                  : item,
                              ),
                            )
                          }
                        >
                          <option value="any">Any of these terms</option>
                          <option value="all">All of these terms</option>
                        </select>
                      </label>
                    </div>
                    <label>
                      Terms, separated by commas
                      <input
                        required
                        maxLength={1000}
                        value={rule.terms}
                        onChange={(event) =>
                          setRules((old) =>
                            old.map((item, position) =>
                              position === index
                                ? { ...item, terms: event.target.value }
                                : item,
                            ),
                          )
                        }
                        placeholder="term, phrase, another phrase"
                      />
                    </label>
                    <label>
                      Context terms{" "}
                      <span className="aw-optional">optional</span>
                      <input
                        maxLength={1000}
                        value={rule.contextTerms}
                        onChange={(event) =>
                          setRules((old) =>
                            old.map((item, position) =>
                              position === index
                                ? { ...item, contextTerms: event.target.value }
                                : item,
                            ),
                          )
                        }
                        placeholder="Require additional context in nearby statements"
                      />
                    </label>
                    {rules.length > 1 && (
                      <button
                        type="button"
                        className="aw-text-button"
                        onClick={() =>
                          setRules((old) =>
                            old.filter((_, position) => position !== index),
                          )
                        }
                      >
                        Remove rule
                      </button>
                    )}
                  </div>
                ))}
              </div>
              <button
                type="button"
                className="aw-secondary"
                disabled={rules.length >= 20}
                onClick={() =>
                  setRules((old) => [
                    ...old,
                    { label: "", terms: "", match: "any", contextTerms: "" },
                  ])
                }
              >
                <Plus size={14} />
                Add rule
              </button>
            </fieldset>
            {editingMission && (
              <label>
                Revision reason
                <input
                  required
                  maxLength={2000}
                  value={editReason}
                  onChange={(event) => setEditReason(event.target.value)}
                  placeholder="Explain this change to the mission"
                />
              </label>
            )}
            <div className="aw-form-footer">
              <span className="aw-help">
                <Bell size={14} /> Alerts are delivered inside this workspace.
              </span>
              <button
                className="aw-primary"
                disabled={action.busy || !sessionIds.length}
              >
                {action.busy ? "Saving…" : "Save mission"}
                <ArrowRight size={15} />
              </button>
            </div>
          </form>
        </Section>
      )}
      <Section
        title="Your missions"
        description={`${items.length} saved ${items.length === 1 ? "mission" : "missions"}`}
        action={
          <button className="aw-text-button" onClick={resource.reload}>
            Refresh
          </button>
        }
      >
        {resource.loading ? (
          <Loading />
        ) : !items.length ? (
          <Empty title="Give your research a purpose">
            Create a mission, choose conversations and define the statements you
            want to review.
          </Empty>
        ) : (
          <div className="aw-mission-list">
            {items.map((mission) => (
              <article className="aw-mission" key={mission.id}>
                <div className="aw-mission-icon">
                  <ShieldCheck size={20} />
                </div>
                <div className="aw-grow">
                  <h3>{mission.title}</h3>
                  <p>
                    {mission.protectedAccount
                      ? `Protecting @${mission.protectedAccount} · `
                      : "Research mission · "}
                    {mission.sessionIds.length} conversations ·{" "}
                    {mission.rules.length} rules
                  </p>
                  <div className="aw-tag-list">
                    {mission.rules.map((rule, index) => (
                      <Status key={index}>{rule.label}</Status>
                    ))}
                  </div>
                  <details className="aw-details">
                    <summary>
                      Inspect rules <ChevronDown size={14} />
                    </summary>
                    {mission.rules.map((rule, index) => (
                      <p key={index}>
                        <strong>{rule.label}:</strong>{" "}
                        {rule.match === "all" ? "All" : "Any"} of{" "}
                        {rule.terms.join(", ")}
                        {rule.contextTerms?.length
                          ? `; context: ${rule.contextTerms.join(", ")}`
                          : ""}
                      </p>
                    ))}
                  </details>
                  {mission.history?.length ? (
                    <details className="aw-details">
                      <summary>
                        {mission.history.length} retained revisions
                      </summary>
                      {mission.history.map((entry) => (
                        <p key={entry.revision}>
                          {entry.reason}
                          <small>
                            {entry.reviewer} · {stamp(entry.createdAtMs)}
                          </small>
                        </p>
                      ))}
                    </details>
                  ) : null}
                </div>
                <div className="aw-button-row">
                  <button
                    className="aw-text-button"
                    onClick={() => {
                      setEditingMission(mission);
                      setEditor(true);
                      setTitle(mission.title);
                      setProtectedAccount(mission.protectedAccount ?? "");
                      setSessionIds(mission.sessionIds);
                      setRules(
                        mission.rules.map((rule) => ({
                          label: rule.label,
                          terms: rule.terms.join(", "),
                          match: rule.match,
                          contextTerms: rule.contextTerms?.join(", ") ?? "",
                        })),
                      );
                      setEditReason("");
                      action.clear();
                    }}
                  >
                    Edit
                  </button>
                  <button
                    className="aw-secondary"
                    disabled={action.busy}
                    onClick={() => run(mission)}
                  >
                    <Play size={14} />
                    Run rules
                  </button>
                </div>
              </article>
            ))}
          </div>
        )}
      </Section>
    </>
  );
}

export function Alerts({ onOpenEvidence }: { onOpenEvidence: OpenEvidence }) {
  const resource = useResource<unknown>("/v1/alerts");
  const [selected, setSelected] = useState<string | null>(null);
  const [filter, setFilter] = useState("all");
  const [reason, setReason] = useState("");
  const action = useAction();
  const items = collection<Alert>(resource.data, "alerts");
  const current = items.find((item) => item.id === selected);
  const evidence = useEvidenceIds(
    current?.evidenceIds ?? (current?.evidenceId ? [current.evidenceId] : []),
  );
  const context = useEvidenceIds(
    current?.contextEvidenceIds?.filter(
      (id) => !current.evidenceIds?.includes(id),
    ) ?? [],
  );
  const currentEvidence = evidence.data;
  const review = async (status: string) => {
    if (!current) return;
    const saved = await action.run(
      () =>
        api(`/v1/alerts/${encodeURIComponent(current.id)}/review`, {
          status,
          reason: reason.trim(),
        }),
      "Your review has been saved with its reason.",
    );
    if (saved) {
      setReason("");
      resource.reload();
    }
  };
  return (
    <>
      <Notice error={resource.error || action.error} receipt={action.receipt} />
      <div className="aw-toolbar">
        <div className="aw-segmented" aria-label="Filter alerts">
          {["all", "pending", "acknowledged", "reviewed", "dismissed"].map(
            (status) => (
              <button
                className={filter === status ? "is-active" : ""}
                key={status}
                onClick={() => setFilter(status)}
              >
                {status === "all" ? "All signals" : status}
              </button>
            ),
          )}
        </div>
        <button className="aw-text-button" onClick={resource.reload}>
          Refresh
        </button>
      </div>
      <div className="aw-split">
        <Section
          title="Captured signals"
          description="Open each match in context before deciding what it means."
        >
          {resource.loading ? (
            <Loading />
          ) : !items.length ? (
            <Empty title="No signals to review">
              Save and run a mission to check selected conversations.
            </Empty>
          ) : (
            <div className="aw-item-list">
              {items
                .filter(
                  (item) =>
                    filter === "all" ||
                    item.status === filter ||
                    (filter === "pending" &&
                      ["new", "unreviewed"].includes(item.status)),
                )
                .map((item) => (
                  <button
                    key={item.id}
                    className={`aw-select-row ${selected === item.id ? "is-selected" : ""}`}
                    onClick={() => {
                      setSelected(item.id);
                      setReason("");
                      action.clear();
                    }}
                  >
                    <span className="aw-row-label">
                      <strong>{item.ruleLabel ?? "Rule matched"}</strong>
                      <small>
                        {item.missionTitle ??
                          "Protecting @" + item.protectedAccount}{" "}
                        · {stamp(item.createdAtMs)}
                      </small>
                    </span>
                    <Status status={item.status}>{item.status}</Status>
                  </button>
                ))}
            </div>
          )}
        </Section>
        <Section
          title={
            current ? (current.ruleLabel ?? "Signal review") : "Review context"
          }
        >
          {!current ? (
            <Empty title="Select a signal">
              Supporting statements, review history and your decision appear
              here.
            </Empty>
          ) : (
            <div className="aw-detail-content">
              <div className="aw-notice">
                A rule match is a request for review. Nearby evidence may change
                its meaning.
              </div>
              {evidence.loading ? (
                <Loading />
              ) : (
                <EvidenceList
                  evidence={currentEvidence}
                  onOpenEvidence={onOpenEvidence}
                />
              )}
              <Notice error={evidence.error} />
              {current.uncertainty?.map((value, index) => (
                <p className="aw-help aw-alert-limit" key={index}>
                  {value}
                </p>
              ))}
              <details className="aw-details">
                <summary>
                  Nearby context ({context.data.length} statements)
                </summary>
                <Notice error={context.error} />
                {context.loading ? (
                  <Loading />
                ) : (
                  <EvidenceList
                    evidence={context.data}
                    onOpenEvidence={onOpenEvidence}
                  />
                )}
              </details>
              <label>
                Review reason
                <textarea
                  required
                  value={reason}
                  onChange={(event) => setReason(event.target.value)}
                  rows={3}
                  maxLength={4000}
                  placeholder="Explain your decision in the context of the captured evidence."
                />
              </label>
              <div className="aw-button-row">
                <button
                  className="aw-secondary"
                  disabled={action.busy || !reason.trim()}
                  onClick={() => review("acknowledged")}
                >
                  Acknowledge
                </button>
                <button
                  className="aw-primary"
                  disabled={action.busy || !reason.trim()}
                  onClick={() => review("reviewed")}
                >
                  Mark reviewed
                </button>
                <button
                  className="aw-text-button"
                  disabled={action.busy || !reason.trim()}
                  onClick={() => review("dismissed")}
                >
                  Dismiss
                </button>
              </div>
              {current.history?.length ? (
                <div className="aw-history">
                  <h3>Review history</h3>
                  {current.history.map((entry, index) => (
                    <p key={index}>
                      <Status status={entry.status}>{entry.status}</Status>{" "}
                      {entry.reason}
                      <small>
                        {entry.reviewer ?? "Workspace reviewer"} ·{" "}
                        {stamp(entry.createdAtMs)}
                      </small>
                    </p>
                  ))}
                </div>
              ) : null}
            </div>
          )}
        </Section>
      </div>
    </>
  );
}
