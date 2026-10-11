import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { AlertCircle, ArrowUpRight, RefreshCw } from "lucide-react";
import { api, type Evidence } from "../../../lib/livelens/api";

export type OpenEvidence = (sessionId: string, evidenceId: string) => void;
export const stamp = (value?: number | null) =>
  value
    ? new Date(value).toLocaleString([], {
        dateStyle: "medium",
        timeStyle: "short",
      })
    : "Time unavailable";
export const friendlyError = (error: unknown) => {
  const value =
    error instanceof Error
      ? error.message
      : "The service could not complete this request.";
  if (value.includes("speaker_reference_requires_source"))
    return "Include a retained transcript from this exact anonymous track among your supporting statements.";
  if (value.includes("person_reference_conflict"))
    return "This person reference has a different retained label. Reuse the existing reference or declare a new one.";
  if (value.includes("missing_scope") || value.includes("forbidden"))
    return "Your access does not include this action. Ask your workspace administrator.";
  if (value.includes("not_found"))
    return "This item is no longer available in your workspace.";
  if (value.includes("quota"))
    return "This action would exceed a workspace limit. Review usage before continuing.";
  return value.replaceAll("_", " ");
};
export function collection<T>(value: unknown, ...keys: string[]): T[] {
  if (Array.isArray(value)) return value as T[];
  if (value && typeof value === "object") {
    const object = value as Record<string, unknown>;
    for (const key of [...keys, "items"])
      if (Array.isArray(object[key])) return object[key] as T[];
  }
  return [];
}
export function useResource<T>(path: string | null, revision = 0) {
  const [data, setData] = useState<T | null>(null);
  const [loading, setLoading] = useState(!!path);
  const [error, setError] = useState("");
  const [version, setVersion] = useState(0);
  const previousPath = useRef<string | null>(null);
  const reload = useCallback(() => setVersion((old) => old + 1), []);
  useEffect(() => {
    let alive = true;
    if (previousPath.current !== path) setData(null);
    previousPath.current = path;
    setError("");
    if (!path) {
      setLoading(false);
      return;
    }
    setLoading(true);
    api<T>(path)
      .then((value) => {
        if (alive) setData(value);
      })
      .catch((cause) => {
        if (alive) setError(friendlyError(cause));
      })
      .finally(() => {
        if (alive) setLoading(false);
      });
    return () => {
      alive = false;
    };
  }, [path, version, revision]);
  return {
    data: previousPath.current === path ? data : null,
    loading: loading || (!!path && previousPath.current !== path),
    error,
    reload,
  };
}
export function useEvidenceIds(ids: string[]) {
  const key = [...new Set(ids)].slice(0, 200).join(",");
  const [data, setData] = useState<Evidence[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  useEffect(() => {
    let alive = true;
    setData([]);
    setError("");
    if (!key) {
      setLoading(false);
      return;
    }
    setLoading(true);
    const sourceIds = key.split(",");
    // Keep both network requests and retained UI evidence bounded.
    (async () => {
      const evidence: Evidence[] = [];
      for (let index = 0; index < sourceIds.length; index += 8) {
        const batch = await Promise.all(
          sourceIds.slice(index, index + 8).map(async (id) => {
            const value = await api<Evidence | { evidence: Evidence }>(
              `/v1/evidence/${encodeURIComponent(id)}`,
            );
            return "evidence" in value ? value.evidence : value;
          }),
        );
        evidence.push(...batch);
        if (!alive) return;
      }
      if (alive) setData(evidence);
    })()
      .catch((cause) => {
        if (alive) setError(friendlyError(cause));
      })
      .finally(() => {
        if (alive) setLoading(false);
      });
    return () => {
      alive = false;
    };
  }, [key]);
  return { data, loading, error };
}
export function useAction() {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [receipt, setReceipt] = useState("");
  const run = async (action: () => Promise<unknown>, message: string) => {
    if (busy) return false;
    setBusy(true);
    setError("");
    setReceipt("");
    try {
      await action();
      setReceipt(message);
      return true;
    } catch (cause) {
      setError(friendlyError(cause));
      return false;
    } finally {
      setBusy(false);
    }
  };
  return {
    busy,
    error,
    receipt,
    run,
    clear: () => {
      setError("");
      setReceipt("");
    },
  };
}
export function Status({
  children,
  status = "neutral",
}: {
  children: ReactNode;
  status?: string;
}) {
  return (
    <span className={`aw-status aw-status-${status.replaceAll(/[^a-z]/g, "")}`}>
      {children}
    </span>
  );
}
export function Notice({
  error,
  receipt,
}: {
  error?: string;
  receipt?: string;
}) {
  return (
    <>
      {error && (
        <div className="aw-notice aw-error" role="alert">
          <AlertCircle size={16} />
          <span>{error}</span>
        </div>
      )}
      {receipt && (
        <div className="aw-notice aw-success" role="status">
          {receipt}
        </div>
      )}
    </>
  );
}
export function Loading() {
  return (
    <div className="aw-loading" role="status">
      <RefreshCw size={17} className="aw-spin" /> Loading your workspace…
    </div>
  );
}
export function Empty({
  title,
  children,
}: {
  title: string;
  children?: ReactNode;
}) {
  return (
    <div className="aw-empty">
      <strong>{title}</strong>
      {children && <p>{children}</p>}
    </div>
  );
}
export function Section({
  title,
  description,
  action,
  children,
}: {
  title: string;
  description?: string;
  action?: ReactNode;
  children: ReactNode;
}) {
  return (
    <section className="aw-section">
      <header className="aw-section-head">
        <div>
          <h2>{title}</h2>
          {description && <p>{description}</p>}
        </div>
        {action}
      </header>
      {children}
    </section>
  );
}
export function EvidenceList({
  evidence,
  onOpenEvidence,
  selected,
  onSelect,
}: {
  evidence: Evidence[];
  onOpenEvidence: OpenEvidence;
  selected?: string[];
  onSelect?: (id: string) => void;
}) {
  if (!evidence.length)
    return (
      <Empty title="No linked evidence yet">
        Open a conversation or search and add the relevant statements to this
        investigation.
      </Empty>
    );
  return (
    <div className="aw-evidence-list">
      {evidence.map((item) => (
        <article className="aw-evidence" key={item.id}>
          <div className="aw-evidence-meta">
            {onSelect && (
              <input
                type="checkbox"
                aria-label={`Select evidence: ${item.text.slice(0, 70)}`}
                checked={selected?.includes(item.id) ?? false}
                onChange={() => onSelect(item.id)}
              />
            )}
            <span>
              {item.attribution?.account
                ? `@${item.attribution.account}`
                : "Unidentified speaker"}
            </span>
            <Status>{item.kind}</Status>
            <time>
              {stamp(
                item.sourceTimestampMs ??
                  item.capturedAtMs ??
                  item.receivedAtMs,
              )}
            </time>
          </div>
          <p>{item.text || "Capture gap; no statement available."}</p>
          <button
            className="aw-text-button"
            onClick={() => onOpenEvidence(item.sessionId, item.id)}
          >
            Open original context <ArrowUpRight size={14} />
          </button>
        </article>
      ))}
    </div>
  );
}
