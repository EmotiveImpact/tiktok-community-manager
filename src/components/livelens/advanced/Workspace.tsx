import { useState, type FormEvent } from "react";
import {
  Fingerprint,
  ShieldCheck,
  Trash2,
  Users,
} from "lucide-react";
import { api } from "../../../lib/livelens/api";
import WorkspaceInvitations from "./WorkspaceInvitations";
import Operations, { formatStorage, RetentionCleanup, type RetentionResult } from "./Operations";
import {
  collection,
  Empty,
  Loading,
  Notice,
  Section,
  stamp,
  Status,
  useAction,
  useResource,
} from "./shared";

type Limits = {
  maxRecordingSeconds: number;
  maxStorageBytes: number;
  maxSpeechSeconds: number;
  maxPendingJobs: number;
};
type WorkspaceInfo = {
  workspace: string;
  role: string;
  membersCount: number;
  limits: Limits;
  usage: {
    recordingSeconds: number;
    storageBytes: number;
    speechSeconds: number;
    pendingJobs: number;
    reservedRecordingSeconds: number;
    reservedStorageBytes: number;
    reservedSpeechSeconds: number;
    pendingCleanupBytes: number;
  };
  retention: { days: number | null; updatedAtMs?: number; updatedBy?: string };
  billing: { mode: string; providerConfigured: boolean };
};
const bytes = formatStorage;
const time = (value: number) => value < 60 ? `${Math.ceil(value)} sec` : value < 3600 ? `${(value / 60).toFixed(1)} min` : `${(value / 3600).toFixed(1)} hr`;
const metrics = [
  {
    label: "Recorded media",
    usage: "recordingSeconds",
    limit: "maxRecordingSeconds",
    format: time,
  },
  {
    label: "Retained storage",
    usage: "storageBytes",
    limit: "maxStorageBytes",
    format: bytes,
  },
  {
    label: "Processed speech",
    usage: "speechSeconds",
    limit: "maxSpeechSeconds",
    format: time,
  },
  {
    label: "Pending work",
    usage: "pendingJobs",
    limit: "maxPendingJobs",
    format: (value: number) => String(value),
  },
] as const;

export function Workspace({ revision = 0, onOpenSession }: { revision?: number; onOpenSession?: (sessionId: string) => void }) {
  const resource = useResource<WorkspaceInfo>("/v1/workspace", revision);
  const capabilities = useResource<{ enabled: string[]; scopes: string[] }>("/v1/capabilities", revision);
  const [tab, setTab] = useState("usage");
  const info = resource.data;
  const canManage = !!info && !resource.error && !capabilities.error && ["owner", "admin"].includes(info.role) && !!capabilities.data?.scopes.includes("workspace:admin");
  const canOpenSession = !capabilities.error && ["sessions:read", "evidence:read"].every((scope) => capabilities.data?.scopes.includes(scope));
  return (
    <>
      {tab !== "operations" && <Notice error={resource.error} />}
      {info && (
            <div className="aw-workspace-summary">
              <div>
                <span className="aw-eyebrow">CURRENT WORKSPACE</span>
                <h2>{info.workspace}</h2>
              </div>
              <div>
                <Status status="reviewed">{info.role}</Status>
                <span className="aw-help">
                  <Users size={14} />
                  {info.membersCount} members
                </span>
              </div>
            </div>
      )}
            <div
              className="aw-segmented aw-detail-tabs"
              aria-label="Workspace administration"
            >
              {[
                ["usage", "Usage & limits"],
                ["operations", "Operations"],
                ["members", "Members"],
                ["retention", "Retention"],
                ["audit", "Audit trail"],
              ].map(([value, label]) => (
                <button
                  className={tab === value ? "is-active" : ""}
                  key={value}
                  onClick={() => setTab(value)}
                  aria-pressed={tab === value}
                >
                  {label}
                </button>
              ))}
            </div>
            {tab === "operations" && <Operations revision={revision} onOpenSession={canOpenSession ? onOpenSession : undefined} onOpenRetention={() => setTab("retention")} />}
            {tab !== "operations" && resource.loading && !info && <Loading />}
            {tab !== "operations" && resource.error && <Empty title="Workspace details unavailable">
              Usage and administration could not be loaded. Operations can still show worker activity and recovery information.
              <button className="aw-text-button" onClick={() => setTab("operations")}>Open Operations</button>
            </Empty>}
            {tab === "usage" && info && !resource.error && (
              <>
                <div className="aw-meter-grid">
                  {metrics.map((metric) => {
                    const used = info.usage[metric.usage],
                      maximum = info.limits[metric.limit];
                    const reserved = metric.usage === "recordingSeconds" ? info.usage.reservedRecordingSeconds ?? 0 : metric.usage === "storageBytes" ? info.usage.reservedStorageBytes ?? 0 : metric.usage === "speechSeconds" ? info.usage.reservedSpeechSeconds ?? 0 : 0;
                    const committed = used + reserved;
                    return (
                      <article className="aw-meter" key={metric.usage}>
                        <h3>{metric.label}</h3>
                        <strong>{metric.format(used)}</strong>
                        <span>of {metric.format(maximum)} limit</span>
                        <meter
                          min={0}
                          max={maximum || 1}
                          value={Math.min(committed, maximum || 1)}
                          aria-label={`${metric.label} usage and reservations`}
                        />
                        <p className="op-reservation">{metric.format(reserved)} reserved</p>
                        <p className="op-remaining">{committed > maximum ? `Over limit by ${metric.format(committed - maximum)}` : `${metric.format(Math.max(0, maximum - committed))} remaining`}</p>
                      </article>
                    );
                  })}
                </div>
                <p className="aw-help">
                  Usage includes retained media, encrypted archives and completed speech.
                  Reservations cover admitted work and unfinished media cleanup.
                  Usage does not imply a tested customer capacity or a payment
                  charge.
                </p>
                {canManage && <LimitsEditor info={info} onSaved={resource.reload} />}
                <Section title="Workspace entitlement">
                  <div className="aw-detail-content aw-inline-info">
                    <ShieldCheck size={24} />
                    <div>
                      <h3>
                        {info.billing.mode === "manual-entitlement"
                          ? "Managed pilot access"
                          : info.billing.mode}
                      </h3>
                      <p>
                        {info.billing.providerConfigured
                          ? "A billing provider is configured for this workspace."
                          : "Access and limits are managed by your administrator. No payment provider is connected."}
                      </p>
                    </div>
                  </div>
                </Section>
              </>
            )}
            {tab === "members" && info && !resource.error && (
              <>
              {capabilities.data?.enabled.includes("workspace-invitations") &&
                capabilities.data.scopes.includes("workspace:admin") &&
                ["owner", "admin"].includes(info.role) &&
                <WorkspaceInvitations onSaved={resource.reload} revision={revision} />}
              <Members
                revision={revision}
                canManage={canManage}
                onSaved={resource.reload}
              />
              </>
            )}
            {tab === "retention" && info && !resource.error && (
              <Retention info={info} onSaved={resource.reload} canManage={canManage} revision={revision} />
            )}
            {tab === "audit" && info && !resource.error && <AuditTrail />}
    </>
  );
}

function LimitsEditor({
  info,
  onSaved,
}: {
  info: WorkspaceInfo;
  onSaved: () => void;
}) {
  const [limits, setLimits] = useState(info.limits);
  const [reason, setReason] = useState("");
  const action = useAction();
  const save = async (event: FormEvent) => {
    event.preventDefault();
    if (
      await action.run(
        () => api("/v1/workspace/limits", { ...limits, reason }),
        "Workspace limits updated.",
      )
    ) {
      setReason("");
      onSaved();
    }
  };
  if (!["owner", "admin"].includes(info.role)) return null;
  return (
    <Section
      title="Set workspace limits"
      description="Bound recording, storage and queue use before inviting more operators."
    >
      <Notice error={action.error} receipt={action.receipt} />
      <form className="aw-form" onSubmit={save}>
        <div className="aw-form-grid">
          {metrics.map((metric) => (
            <label key={metric.limit}>
              {metric.label} limit{" "}
              <span className="aw-optional">
                {metric.limit.includes("Bytes")
                  ? "bytes"
                  : metric.limit.includes("Seconds")
                    ? "seconds"
                    : "jobs"}
              </span>
              <input
                type="number"
                required
                min={1}
                max={metric.limit === "maxPendingJobs" ? 1000 : undefined}
                step={1}
                value={limits[metric.limit]}
                onChange={(event) =>
                  setLimits((old) => ({
                    ...old,
                    [metric.limit]: Number(event.target.value),
                  }))
                }
              />
            </label>
          ))}
        </div>
        <label>
          Change reason
          <input
            required
            maxLength={1000}
            value={reason}
            onChange={(event) => setReason(event.target.value)}
            placeholder="Why are these limits changing?"
          />
        </label>
        <div className="aw-form-footer">
          <span className="aw-help">
            Changes are recorded in the audit trail.
          </span>
          <button
            className="aw-primary"
            disabled={action.busy || !reason.trim()}
          >
            Save limits
          </button>
        </div>
      </form>
    </Section>
  );
}

function Members({
  canManage,
  onSaved,
  revision = 0,
}: {
  canManage: boolean;
  onSaved: () => void;
  revision?: number;
}) {
  const resource = useResource<unknown>("/v1/workspace/members", revision);
  const [subject, setSubject] = useState("");
  const [role, setRole] = useState("analyst");
  const action = useAction();
  const items = collection<{
    subject: string;
    role: string;
    updatedAtMs: number;
    updatedBy: string;
  }>(resource.data, "members");
  const save = async (event: FormEvent) => {
    event.preventDefault();
    if (
      await action.run(
        () => api("/v1/workspace/members", { subject: subject.trim(), role }),
        "Member role saved. Granted API scopes still bound access.",
      )
    ) {
      setSubject("");
      resource.reload();
      onSaved();
    }
  };
  return (
    <Section
      title="People and permissions"
      description="Roles bound what an authenticated operator can read or change."
    >
      <Notice error={resource.error || action.error} receipt={action.receipt} />
      {resource.loading ? (
        <Loading />
      ) : !items.length ? (
        <Empty title="No member roles recorded">
          Configured operator access is available until your administrator
          assigns workspace roles.
        </Empty>
      ) : (
        <div className="aw-table-scroll">
          <table className="aw-table">
            <thead>
              <tr>
                <th>Member</th>
                <th>Role</th>
                <th>Last changed</th>
              </tr>
            </thead>
            <tbody>
              {items.map((member) => (
                <tr key={member.subject}>
                  <td>
                    <strong>{member.subject}</strong>
                  </td>
                  <td>
                    <Status>{member.role}</Status>
                  </td>
                  <td>
                    {stamp(member.updatedAtMs)}
                    <small>by {member.updatedBy}</small>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {canManage && (
        <form onSubmit={save} className="aw-form">
          <div className="aw-form-grid">
            <label>
              Member identifier
              <input
                required
                maxLength={100}
                value={subject}
                onChange={(event) => setSubject(event.target.value)}
                placeholder="Configured operator subject"
              />
            </label>
            <label>
              Workspace role
              <select
                aria-label="Workspace role"
                value={role}
                onChange={(event) => setRole(event.target.value)}
              >
                <option value="viewer">Viewer — read evidence</option>
                <option value="analyst">Analyst — investigate</option>
                <option value="admin">Administrator — manage workspace</option>
                <option value="owner">Owner — manage all access</option>
              </select>
            </label>
          </div>
          <div className="aw-form-footer">
            <span className="aw-help">
              Adding a role does not create login credentials.
            </span>
            <button className="aw-primary" disabled={action.busy}>
              <Users size={15} />
              Save member role
            </button>
          </div>
        </form>
      )}
    </Section>
  );
}

function AuditTrail() {
  const resource = useResource<unknown>("/v1/workspace/audit?limit=100");
  const entries = collection<{
    id: string;
    actor: string;
    action: string;
    resource: string;
    details: Record<string, unknown>;
    createdAtMs: number;
    entrySha256: string;
    previousSha256: string | null;
  }>(resource.data, "entries");
  return (
    <Section
      title="Recorded actions"
      description="A linked receipt chain records workspace changes and their operator."
      action={
        <button className="aw-text-button" onClick={resource.reload}>
          Refresh
        </button>
      }
    >
      <Notice error={resource.error} />
      {resource.loading ? (
        <Loading />
      ) : !entries.length ? (
        <Empty title="No administrative actions recorded">
          Role, limit, retention and access changes appear here.
        </Empty>
      ) : (
        <div className="aw-table-scroll">
          <table className="aw-table">
            <thead>
              <tr>
                <th>Action</th>
                <th>Operator</th>
                <th>Time</th>
                <th>Receipt</th>
              </tr>
            </thead>
            <tbody>
              {entries.map((entry) => (
                <tr key={entry.id}>
                  <td>
                    <strong>{entry.action.replaceAll(/[_.]/g, " ")}</strong>
                    <small>{entry.resource}</small>
                  </td>
                  <td>{entry.actor}</td>
                  <td>{stamp(entry.createdAtMs)}</td>
                  <td>
                    <details className="aw-details">
                      <summary>
                        <Fingerprint size={14} />
                        {entry.entrySha256.slice(0, 10)}…
                      </summary>
                      <dl className="aw-key-values">
                        {Object.entries(entry.details ?? {}).map(
                          ([key, value]) => (
                            <div key={key}>
                              <dt>{key}</dt>
                              <dd>
                                {typeof value === "object"
                                  ? JSON.stringify(value)
                                  : String(value)}
                              </dd>
                            </div>
                          ),
                        )}
                      </dl>
                      <p className="aw-hash">{entry.entrySha256}</p>
                      <p className="aw-help">
                        Previous: {entry.previousSha256 ?? "First receipt"}
                      </p>
                    </details>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Section>
  );
}

function Retention({
  info,
  onSaved,
  canManage,
  revision,
}: {
  info: WorkspaceInfo;
  onSaved: () => void;
  canManage: boolean;
  revision: number;
}) {
  const [days, setDays] = useState(info.retention.days?.toString() ?? "");
  const [reason, setReason] = useState("");
  const [preview, setPreview] = useState<{
    previewHash: string;
    cutoffAtMs: number;
    sessions: {
      id: string;
      title: string;
      evidenceCount: number;
      storageBytes: number;
      eligible: boolean;
      blockedReason?: string;
    }[];
    maxApply: number;
  } | null>(null);
  const [selected, setSelected] = useState<string[]>([]);
  const [confirmed, setConfirmed] = useState(false);
  const [result, setResult] = useState<RetentionResult | null>(null);
  const [cleanupRevision, setCleanupRevision] = useState(0);
  const action = useAction();
  const unfinishedCleanup = result ? Math.max(result.cleanupFailures.length, result.cleanupTasks.filter((task) => task.state !== "completed").length) : 0;
  const changed = () => { setCleanupRevision((old) => old + 1); onSaved(); };
  const save = async (event: FormEvent) => {
    event.preventDefault();
    setResult(null);
    if (
      await action.run(
        () =>
          api("/v1/workspace/retention", {
            days: days ? Number(days) : null,
            reason,
          }),
        "Retention preference saved. No records were deleted.",
      )
    ) {
      setReason("");
      setPreview(null);
      setSelected([]);
      onSaved();
    }
  };
  const inspect = async () => {
    setResult(null);
    setPreview(null);
    setSelected([]);
    setConfirmed(false);
    await action.run(async () => {
      setPreview(await api("/v1/workspace/retention/preview"));
      setSelected([]);
      setConfirmed(false);
    }, "Deletion preview prepared. Select only eligible sessions you intend to remove.");
  };
  const apply = async () => {
    if (!preview || !confirmed || !selected.length || action.busy || !canManage) return;
    setResult(null);
    if (
      await action.run(
        async () => {
          const receipt = await api<RetentionResult>("/v1/workspace/retention/apply", {
            previewHash: preview.previewHash,
            sessionIds: selected,
            reason,
          });
          setResult(receipt);
        },
        "",
      )
    ) {
      setPreview(null);
      setSelected([]);
      setConfirmed(false);
      setReason("");
      changed();
    } else {
      // A lost response may follow a committed deletion. Require a fresh preview
      // and reload durable cleanup receipts before another attempt.
      setPreview(null);
      setSelected([]);
      setConfirmed(false);
      changed();
    }
  };
  return (
    <>
      <Notice error={action.error} receipt={action.receipt} />
      {result && <div className={`op-retention-result${unfinishedCleanup ? " is-partial" : ""}`} role={unfinishedCleanup ? "alert" : "status"}>
        <strong>{result.deletedSessions} {result.deletedSessions === 1 ? "session removed" : "sessions removed"} from the workspace.</strong>
        <p>{unfinishedCleanup ? `${unfinishedCleanup} media cleanup ${unfinishedCleanup === 1 ? "task remains" : "tasks remain"} unfinished. Storage stays reserved until removal completes. Review the durable cleanup tasks below.` : "Selected records and their eligible media were removed. An audit receipt was retained."}</p>
      </div>}
      <Section
        title="Keep evidence for the right amount of time"
        description="A preference defines an eligibility window. Deletion requires a current preview and an explicit selection."
      >
        <form className="aw-form" onSubmit={save}>
          <div className="aw-form-grid">
            <label>
              Retain for days{" "}
              <span className="aw-optional">blank means indefinitely</span>
              <input
                type="number"
                min={1}
                max={3650}
                step={1}
                value={days}
                disabled={!canManage || action.busy}
                onChange={(event) => setDays(event.target.value)}
              />
            </label>
            <label>
              Change or deletion reason
              <input
                required
                maxLength={1000}
                value={reason}
                disabled={!canManage || action.busy}
                onChange={(event) => setReason(event.target.value)}
                placeholder="Explain this retention decision"
              />
            </label>
          </div>
          {canManage && (
            <div className="aw-button-row">
              <button
                className="aw-primary"
                disabled={action.busy || !reason.trim()}
              >
                Save preference
              </button>
              <button
                type="button"
                className="aw-secondary"
                disabled={action.busy || info.retention.days === null}
                onClick={inspect}
              >
                Preview eligible records
              </button>
            </div>
          )}
          <p className="aw-help">
            Current preference:{" "}
            {info.retention.days === null
              ? "Indefinite retention"
              : `${info.retention.days} days`}
            . Case-linked evidence and active work can block deletion.
          </p>
        </form>
      </Section>
      {preview && (
        <Section
          title="Review before deleting"
          description={`Cutoff: ${stamp(preview.cutoffAtMs)}. Select up to ${preview.maxApply} eligible sessions.`}
        >
          <div className="aw-selection-list">
            {preview.sessions.map((session) => (
              <label
                key={session.id}
                className={!session.eligible ? "is-disabled" : ""}
              >
                <input
                  type="checkbox"
                  disabled={
                    !session.eligible ||
                    action.busy ||
                    !canManage ||
                    (!selected.includes(session.id) &&
                      selected.length >= preview.maxApply)
                  }
                  checked={selected.includes(session.id)}
                  onChange={() => {
                    setConfirmed(false);
                    setSelected((old) =>
                      old.includes(session.id)
                        ? old.filter((id) => id !== session.id)
                        : [...old, session.id],
                    );
                  }}
                />
                <span>
                  {session.title}
                  <small>
                    {session.evidenceCount} records ·{" "}
                    {bytes(session.storageBytes)} ·{" "}
                    {session.eligible
                      ? "Eligible"
                      : (session.blockedReason ??
                        "Retained to protect referenced evidence")}
                  </small>
                </span>
              </label>
            ))}
          </div>
          {!preview.sessions.length && (
            <Empty title="No records match this window" />
          )}
          <div className="aw-delete-confirm">
            <label>
              <input
                type="checkbox"
                checked={confirmed}
                disabled={!selected.length || action.busy || !canManage}
                onChange={(event) => setConfirmed(event.target.checked)}
              />
              <span>
                I intend to delete these {selected.length} selected sessions and
                their eligible retained data.
              </span>
            </label>
            <button
              className="aw-danger"
              disabled={
                action.busy || !canManage || !confirmed || !selected.length || !reason.trim()
              }
              onClick={apply}
            >
              <Trash2 size={15} />
              Delete selected eligible records
            </button>
          </div>
        </Section>
      )}
      {canManage && <RetentionCleanup revision={revision + cleanupRevision} onChanged={() => { setResult(null); changed(); }} />}
    </>
  );
}

export { default as AgentConnection } from "./AgentConnection";
