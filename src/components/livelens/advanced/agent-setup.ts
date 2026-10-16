/** Matches the optional ALFRED LiveLens provider's configuration, not a browser connection. */
export type AgentSetupInput = {
  baseUrl: string;
  scope: string;
  workspace: string;
  sourceId: string;
  sessionIds: string[];
  privateDirectory: string;
  dataDirectory: string;
  vaultDirectory: string;
  allowCollection: boolean;
  recorderSourceId: string;
  maxDurationSeconds: string;
};

export type SetupField = keyof AgentSetupInput;
export type SetupIssues = Partial<Record<SetupField, string>>;
export type AgentSetupRecipe = {
  config: string;
  read: string;
  commands: string;
  guide: string;
  configPath: string;
  tokenPath: string;
  readPath: string;
};

const gatewayId = /^[A-Za-z0-9][A-Za-z0-9_-]{0,95}$/;
const scopeId = /^[A-Za-z0-9][A-Za-z0-9_.-]{0,79}$/;
const control = /[\u0000-\u001f\u007f]/;
const cleanPath = (value: string) => value.trim().replace(/\/+$/, "");
const validPath = (value: string) => value.startsWith("/") && value.length > 1 && value.length <= 1024 && !control.test(value) && !value.split("/").some((part) => [".", "..", ".git"].includes(part)) && !value.includes("//");
const inside = (path: string, directory: string) => path === directory || path.startsWith(`${directory}/`);

/** Every user-controlled shell argument is a single literal POSIX argument. */
export const quoteSetupArgument = (value: string) => `'${value.replaceAll("'", `'"'"'`)}'`;

export function createAgentSetup(input: AgentSetupInput): { issues: SetupIssues; recipe: AgentSetupRecipe | null } {
  const issues: SetupIssues = {};
  const baseUrl = input.baseUrl.trim();
  let origin = "";
  try {
    const url = new URL(baseUrl);
    const rawOrigin = baseUrl.match(/^https?:\/\/([^/?#\\]+)\/?$/);
    const authority = rawOrigin?.[1];
    const loopback = /^(localhost|127\.0\.0\.1|\[::1\])(?::\d+)?$/.test(authority ?? "");
    if (!rawOrigin || !url.hostname || url.username || url.password || control.test(baseUrl) || url.pathname !== "/" || (url.protocol !== "https:" && !(url.protocol === "http:" && loopback))) throw new Error("invalid");
    origin = url.origin;
  } catch {
    issues.baseUrl = "Use an HTTPS service origin, or http://127.0.0.1:4318 on the same host. Omit credentials, paths, queries and fragments.";
  }
  const scope = input.scope.trim();
  const workspace = input.workspace.trim();
  const sourceId = input.sourceId.trim();
  if (!scopeId.test(scope)) issues.scope = "Enter the existing ALFRED scope ID (1–80 letters, numbers, dots, hyphens or underscores; start with a letter or number).";
  if (!gatewayId.test(workspace)) issues.workspace = "The current workspace ID must be compatible with ALFRED (1–96 letters, numbers, hyphens or underscores).";
  if (!gatewayId.test(sourceId)) issues.sourceId = "Use 1–96 letters, numbers, hyphens or underscores, starting with a letter or number.";
  const sessionIds = [...new Set(input.sessionIds)];
  if (!sessionIds.length || sessionIds.length > 1000 || sessionIds.some((id) => !gatewayId.test(id))) issues.sessionIds = "Select at least one retained session with a valid ID. Wildcards are not supported.";
  const privateDirectory = cleanPath(input.privateDirectory);
  const dataDirectory = cleanPath(input.dataDirectory);
  const vaultDirectory = cleanPath(input.vaultDirectory);
  if (!validPath(privateDirectory)) issues.privateDirectory = "Enter an absolute private directory on the ALFRED host, outside Git and vaults; omit dot path segments.";
  if (!validPath(dataDirectory)) issues.dataDirectory = "Enter the existing absolute ALFRED data directory, outside Git and vaults.";
  if (input.vaultDirectory.trim() && !validPath(vaultDirectory)) issues.vaultDirectory = "Enter an absolute existing vault directory, or leave blank for the default vault.";
  if (validPath(vaultDirectory)) {
    if (inside(privateDirectory, vaultDirectory)) issues.privateDirectory = "Setup files must be outside the selected vault.";
    if (inside(dataDirectory, vaultDirectory)) issues.dataDirectory = "ALFRED data must be outside the selected vault.";
  }
  const recorderSourceId = input.recorderSourceId.trim();
  if (input.allowCollection && !gatewayId.test(recorderSourceId)) issues.recorderSourceId = "Choose an explicitly configured recorder source.";
  const maxDurationSeconds = input.allowCollection ? Number(input.maxDurationSeconds) : 60;
  if (!Number.isInteger(maxDurationSeconds) || maxDurationSeconds < 2 || maxDurationSeconds > 3600) issues.maxDurationSeconds = "Use a whole number from 2 to 3600 seconds, within your workspace allowance.";
  if (Object.keys(issues).length) return { issues, recipe: null };
  const configPath = `${privateDirectory}/livelens-connection.json`;
  const tokenPath = `${privateDirectory}/livelens.token`;
  const readPath = `${privateDirectory}/livelens-read.json`;
  const config = JSON.stringify({
    schemaVersion: 1, scope, workspace, sourceCredential: "specialist-livelens", baseUrl: origin, tokenFile: tokenPath,
    sources: [{ id: sourceId, sessionIds, ...(input.allowCollection ? { recorderSourceId } : {}) }],
    maxDurationSeconds, timeoutSeconds: 5,
  }, null, 2);
  if (new TextEncoder().encode(config).byteLength > 16384) return { issues: { sessionIds: "Select fewer sessions: ALFRED's connection configuration is limited to 16 KiB." }, recipe: null };
  const read = JSON.stringify({ operation: "sessions", parameters: { sourceId } }, null, 2);
  const common = `--data-dir ${quoteSetupArgument(dataDirectory)}${vaultDirectory ? ` --vault ${quoteSetupArgument(vaultDirectory)}` : ""}`;
  const commands = [
    "#!/bin/sh",
    "set -eu",
    "# Run on the ALFRED host, from its existing checkout (Python 3.11+).",
    "# Stop ALFRED first. Save the JSON files and privately provision the token file.",
    `chmod 600 ${[tokenPath, configPath, readPath].map(quoteSetupArgument).join(" ")}`,
    "# Installs this source and its explicit read grants. Other sources may need grants.",
    `python3 -m alfred.desk livelens-connect ${common} --livelens-config ${quoteSetupArgument(configPath)}${input.allowCollection ? " --allow-livelens-collection" : ""}`,
    "# Discovery checks installation and current ALFRED permissions, not the network.",
    `python3 -m alfred.desk livelens ${common} --tool discover`,
    "# This explicit read checks the LiveLens token, workspace and selected sessions.",
    `python3 -m alfred.desk livelens ${common} --tool read --tool-input ${quoteSetupArgument(readPath)}`,
    "# After successful verification, restart the existing private host.",
    `python3 -m alfred.desk serve ${common}`,
  ].join("\n");
  const guide = [
    "# Connect ALFRED to LiveLens", "", "Generated setup recipe; no installation or network verification has run.", "",
    `LiveLens workspace: ${workspace}`, `ALFRED scope: ${scope}`, `Selected sessions: ${sessionIds.length}`,
    `Collection controls: ${input.allowCollection ? "explicit install grant requested; every start/stop still needs exact approval" : "disabled (read-only installation)"}`, "",
    "## 1. Prepare the private host", "",
    "Use the existing ALFRED checkout with its LiveLens integration installed (PR #20). Stop the running host before installation. Keep the data, JSON, token and tool-input files outside Git, vaults and synced directories. This recipe cannot check the host's files, ownership, symlinks or existing grants; ALFRED checks those at installation and use.", "",
    `Privately provision the intended workspace's service token in ${tokenPath} (mode 0600). Never put the token in browser fields or command arguments. HTTP loopback works only when ALFRED and LiveLens run on the same host.`, "",
    "## 2. Save the files", "", `Save as ${configPath}:`, "```json", config, "```", "", `Save as ${readPath}:`, "```json", read, "```", "",
    "## 3. Install and verify", "", "Installation enables explicit source policy in this ALFRED scope; other note sources may need their own grants. Existing private-data release requirements still apply. Reinstalling without collection permission revokes the owner's collection grant. It does not stop already accepted recording jobs.", "",
    "```sh", commands, "```", "",
    "Discovery should report configured:true, manifest.registeredInAlfred:true and permissions.read:true for the selected ALFRED scope. It is a local registration/permission check. The explicit sessions read must return a receipt for the expected LiveLens workspace and source; it contacts LiveLens. Check the returned session IDs. An empty sessions result does not confirm visibility of selected sessions.", "",
    "Installation starts no monitoring, recording, model calls or automatic memory import. A configured endpoint or copied file is not a verified connection. Source grants expire and require deliberate renewal; failures must be resolved on the private host.", "",
    "Operating guide: https://github.com/EmotiveImpact/Alfred/blob/5b37ba41353cfcd0cae4243482520e25175e21d9/docs/LIVELENS_INTEGRATION.md", "",
  ].join("\n");
  return { issues, recipe: { config, read, commands, guide, configPath, tokenPath, readPath } };
}
