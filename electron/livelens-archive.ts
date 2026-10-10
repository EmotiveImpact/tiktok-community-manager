import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { appDocumentsDir } from "./paths";
import type { SessionRecord } from "./sessions";

export type ArchiveState = {
  state: "unavailable" | "pending" | "failed" | "archived";
  sessionId?: string;
  archivedEvents?: number;
  attempts?: number;
  error?: string;
};
export function archivePayload(record: SessionRecord) {
  const id =
    "desktop_" +
    createHash("sha256").update(record.id).digest("hex").slice(0, 48);
  return {
    session: {
      id,
      platform: "tiktok",
      account: record.hostUniqueId,
      sourceUrl: `https://www.tiktok.com/@${encodeURIComponent(record.hostUniqueId)}/live`,
      title: record.roomTitle || `Captured @${record.hostUniqueId}`,
      startedAtMs: record.startedAt,
    },
    events: record.events.flatMap((event, index) => {
      if (
        event.type !== "chat" &&
        !(event.type === "caption" && event.definite)
      )
        return [];
      return [
        {
          source: {
            adapter: "desktop-tiktok",
            eventId: event.sourceEventId || `retained-${index}`,
          },
          kind: event.type,
          text:
            event.type === "chat" ? (event.comment ?? "") : (event.text ?? ""),
          ...(event.type === "chat" ? { account: event.user?.uniqueId } : {}),
          sourceTimestampMs: event.sourceTimestampMs ?? null,
          capturedAtMs: event.capturedAtMs ?? event.ts,
          raw: {
            desktopSessionId: record.id,
            broadcastId: record.broadcastId ?? null,
            timestampBasis:
              event.sourceTimestampMs == null
                ? "collector-only"
                : "provider-and-collector",
            retainedIndex: index,
          },
        },
      ];
    }),
  };
}

// Transport is injectable so retry conflicts are tested without Electron GUI.
export async function uploadArchive(
  record: SessionRecord,
  request: (method: string, route: string, body?: unknown) => Promise<any>,
) {
  const payload = archivePayload(record);
  try {
    await request("POST", "/v1/sessions", payload.session);
  } catch (e) {
    if (!(e instanceof Error) || e.message !== "http_409") throw e;
    const existing = await request("GET", `/v1/sessions/${payload.session.id}`);
    if (
      Object.keys(payload.session).some(
        (key) =>
          existing[key] !==
          payload.session[key as keyof typeof payload.session],
      )
    )
      throw new Error("session_identity_conflict");
  }
  for (let i = 0; i < payload.events.length; i += 100)
    await request("POST", `/v1/sessions/${payload.session.id}/events`, {
      events: payload.events.slice(i, i + 100),
    });
  return {
    sessionId: payload.session.id,
    archivedEvents: record.events.length,
  };
}

const active = new Set<string>();
function statusFile(record: SessionRecord) {
  return path.join(
    appDocumentsDir(),
    "livelens-archive-" +
      createHash("sha256").update(record.id).digest("hex") +
      ".json",
  );
}
function save(record: SessionRecord, value: ArchiveState) {
  const file = statusFile(record);
  fs.writeFileSync(file + ".tmp", JSON.stringify(value), { mode: 0o600 });
  fs.renameSync(file + ".tmp", file);
}
export function archiveStatus(record: SessionRecord): ArchiveState {
  let value: ArchiveState;
  try {
    value = JSON.parse(fs.readFileSync(statusFile(record), "utf8"));
  } catch {
    return { state: "unavailable", error: "Not archived" };
  }
  if (value.state === "pending" && !active.has(record.id))
    return {
      ...value,
      state: "failed",
      error: "Upload interrupted; retry explicitly",
    };
  if (
    value.state === "archived" &&
    value.archivedEvents !== record.events.length
  )
    return {
      ...value,
      state: "pending",
      error: "New events require explicit archiving",
    };
  return value;
}
export async function archiveRecord(
  record: SessionRecord,
): Promise<ArchiveState> {
  if (active.has(record.id)) return archiveStatus(record);
  const base = process.env.LIVELENS_DESKTOP_URL,
    token = process.env.LIVELENS_DESKTOP_TOKEN;
  if (!base || !token)
    return {
      state: "unavailable",
      error: "Configure desktop service access in the main-process environment",
    };
  const url = new URL(base);
  if (
    url.pathname !== "/" ||
    url.username ||
    url.password ||
    url.search ||
    url.hash ||
    (url.protocol !== "https:" &&
      !(
        url.protocol === "http:" &&
        ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname)
      ))
  )
    return { state: "failed", error: "Invalid service address" };
  const request = async (method: string, route: string, body?: unknown) => {
    const response = await fetch(url.origin + route, {
      method,
      redirect: "error",
      signal: AbortSignal.timeout(10_000),
      headers: {
        Authorization: `Bearer ${token}`,
        ...(body === undefined ? {} : { "Content-Type": "application/json" }),
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    if (!response.ok) throw new Error(`http_${response.status}`);
    return response.json();
  };
  active.add(record.id);
  try {
    for (let attempt = 1; attempt <= 3; attempt++) {
      save(record, { state: "pending", attempts: attempt });
      try {
        const result = await uploadArchive(record, request);
        const value: ArchiveState = {
          state: "archived",
          ...result,
          attempts: attempt,
        };
        save(record, value);
        return value;
      } catch (e) {
        const code =
          e instanceof Error &&
          /^(http_\d+|session_identity_conflict)$/.test(e.message)
            ? e.message
            : "service_unavailable";
        if (attempt === 3 || /^http_4|conflict/.test(code)) {
          const value: ArchiveState = {
            state: "failed",
            attempts: attempt,
            error: code,
          };
          save(record, value);
          return value;
        }
        await new Promise((resolve) => setTimeout(resolve, attempt * 500));
      }
    }
    return { state: "failed", error: "Retry limit reached" };
  } finally {
    active.delete(record.id);
  }
}
