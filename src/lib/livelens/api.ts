export type Session = {
  id: string;
  platform: string;
  account: string | null;
  title: string;
  sourceUrl: string;
  startedAtMs: number;
};
export type Evidence = {
  id: string;
  sessionId: string;
  kind: string;
  text: string;
  sourceTimestampMs: number | null;
  capturedAtMs: number | null;
  receivedAtMs: number;
  sequence: number;
  source: { adapter: string; eventId: string };
  attribution: { status: string; account: string | null };
  integrity: { payloadSha256: string };
};
export type Case = {
  id: string;
  title: string;
  question: string;
  createdAtMs: number;
};
export type Report = {
  case: Case;
  evidence: Evidence[];
  sessions: Session[];
  limitations: string[];
  reportSha256: string;
};
export type Identity = { workspace: string; subject: string; csrf: string };
let csrf = "";
export function setIdentity(identity: Identity | null) {
  csrf = identity?.csrf ?? "";
}
export async function api<T>(path: string, body?: unknown): Promise<T> {
  const response = await fetch(path, {
    method: body === undefined ? "GET" : "POST",
    credentials: "same-origin",
    redirect: "error",
    signal: AbortSignal.timeout(15_000),
    headers:
      body === undefined
        ? {}
        : { "Content-Type": "application/json", "X-LiveLens-CSRF": csrf },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  if (!response.ok) {
    const value = await response.json().catch(() => ({}));
    throw new Error(value.error ?? `Service returned ${response.status}`);
  }
  return response.json();
}
export function exportText(
  content: string,
  name: string,
  mime = "application/json",
) {
  const url = URL.createObjectURL(new Blob([content], { type: mime }));
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
