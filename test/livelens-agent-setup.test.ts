import { describe, expect, it } from "vitest";
import { execFileSync } from "node:child_process";
import { createAgentSetup, quoteSetupArgument, type AgentSetupInput } from "../src/components/livelens/advanced/agent-setup";

const input = (overrides: Partial<AgentSetupInput> = {}): AgentSetupInput => ({
  baseUrl: "https://livelens.example.com", scope: "personal.scope", workspace: "workspace-one", sourceId: "chosen-source",
  sessionIds: ["session-one", "session-two"], privateDirectory: "/private/livelens", dataDirectory: "/private/alfred", vaultDirectory: "",
  allowCollection: false, recorderSourceId: "unused-recorder", maxDurationSeconds: "60", ...overrides,
});

describe("ALFRED private setup recipe", () => {
  it("builds the exact optional-provider config and an explicit transport check without enabling collection", () => {
    const result = createAgentSetup(input());
    expect(result.issues).toEqual({});
    expect(JSON.parse(result.recipe!.config)).toEqual({ schemaVersion: 1, scope: "personal.scope", workspace: "workspace-one", sourceCredential: "specialist-livelens", baseUrl: "https://livelens.example.com", tokenFile: "/private/livelens/livelens.token", sources: [{ id: "chosen-source", sessionIds: ["session-one", "session-two"] }], maxDurationSeconds: 60, timeoutSeconds: 5 });
    expect(JSON.parse(result.recipe!.read)).toEqual({ operation: "sessions", parameters: { sourceId: "chosen-source" } });
    expect(result.recipe!.commands).toContain("--tool discover");
    expect(result.recipe!.commands).toContain("--tool read --tool-input '/private/livelens/livelens-read.json'");
    expect(result.recipe!.commands).not.toContain("--allow-livelens-collection");
    expect(result.recipe!.commands).not.toContain("--token");
    expect(result.recipe!.guide).toContain("no installation or network verification has run");
  });

  it.each(["http://localhost:4318", "http://127.0.0.1:4318/", "http://[::1]:4318", "https://livelens.example.com:8443/"])("accepts supported origin %s", (baseUrl) => {
    expect(createAgentSetup(input({ baseUrl })).recipe).not.toBeNull();
  });

  it.each(["http://example.com", "http://192.168.1.10", "http://127.1", "http://2130706433", "http://localhost.example.com", "https://user:secret@example.com", "https://example.com/api", "https://example.com/a/..", "https://example.com/?", "https://example.com/#", "https://example.com?token=secret", "file:///private/token", "javascript:alert(1)"])("refuses unsupported or credential-bearing origin %s", (baseUrl) => {
    const result = createAgentSetup(input({ baseUrl }));
    expect(result.recipe).toBeNull();
    expect(result.issues.baseUrl).toBeTruthy();
  });

  it("requires explicit valid sessions and distinct valid ALFRED scope / gateway identifiers", () => {
    expect(createAgentSetup(input({ sessionIds: [] })).issues.sessionIds).toBeTruthy();
    expect(createAgentSetup(input({ sessionIds: ["*"] })).issues.sessionIds).toBeTruthy();
    expect(createAgentSetup(input({ sessionIds: ["invalid.session"] })).issues.sessionIds).toBeTruthy();
    expect(createAgentSetup(input({ sourceId: "-source" })).issues.sourceId).toBeTruthy();
    expect(createAgentSetup(input({ workspace: "other.workspace" })).issues.workspace).toBeTruthy();
    expect(createAgentSetup(input({ scope: "scope with spaces" })).issues.scope).toBeTruthy();
    const recipe = createAgentSetup(input({ sessionIds: ["session-one", "session-one"] })).recipe!;
    expect(JSON.parse(recipe.config).sources[0].sessionIds).toEqual(["session-one"]);
  });

  it("does not prepare files inside a supplied vault or ambiguous/nonabsolute paths", () => {
    for (const privateDirectory of ["relative", "~/private", "/", "/private/../notes", "/private/.git/setup", "/private\nline", "/private//setup"]) {
      expect(createAgentSetup(input({ privateDirectory })).issues.privateDirectory).toBeTruthy();
    }
    expect(createAgentSetup(input({ privateDirectory: "/notes/setup", vaultDirectory: "/notes" })).issues.privateDirectory).toBeTruthy();
    expect(createAgentSetup(input({ dataDirectory: "/notes", vaultDirectory: "/notes" })).issues.dataDirectory).toBeTruthy();
    expect(createAgentSetup(input({ privateDirectory: "/notes-private", vaultDirectory: "/notes" })).recipe).not.toBeNull();
  });

  it("quotes command arguments literally including spaces, quotes, dollars and command substitutions", () => {
    const path = "/private/owner's $(printf injected) `printf unsafe` $TOKEN";
    expect(execFileSync("sh", ["-c", `printf '%s' ${quoteSetupArgument(path)}`], { encoding: "utf8" })).toBe(path);
    const result = createAgentSetup(input({ privateDirectory: path, dataDirectory: "/private/ALFRED data", vaultDirectory: "/notes/owner's vault" }));
    expect(result.recipe).not.toBeNull();
    const commands = result.recipe!.commands.split("\n").filter((line) => line.startsWith("python3 "));
    expect(commands).toHaveLength(4);
    for (const command of commands) {
      expect(command).toContain("--data-dir '/private/ALFRED data'");
      expect(command).toContain("--vault '/notes/owner'\"'\"'s vault'");
    }
  });

  it("adds bounded controls only on explicit opt-in and validates duration/source requirements", () => {
    const result = createAgentSetup(input({ allowCollection: true, recorderSourceId: "selected-recorder", maxDurationSeconds: "180" }));
    expect(JSON.parse(result.recipe!.config).sources[0].recorderSourceId).toBe("selected-recorder");
    expect(JSON.parse(result.recipe!.config).maxDurationSeconds).toBe(180);
    expect(result.recipe!.commands).toContain("--allow-livelens-collection");
    expect(createAgentSetup(input({ allowCollection: true, recorderSourceId: "" })).recipe).toBeNull();
    for (const maxDurationSeconds of ["1", "3601", "2.5", "NaN"]) {
      expect(createAgentSetup(input({ allowCollection: true, maxDurationSeconds })).issues.maxDurationSeconds).toBeTruthy();
    }
    expect(createAgentSetup(input({ maxDurationSeconds: "bad-but-disabled" })).recipe).not.toBeNull();
  });

  it("bounds the private JSON to the actual ALFRED 16 KiB loader limit", () => {
    const sessionIds = Array.from({ length: 200 }, (_, index) => `session-${index}-${"a".repeat(78)}`);
    const result = createAgentSetup(input({ sessionIds }));
    expect(result.recipe).toBeNull();
    expect(result.issues.sessionIds).toContain("16 KiB");
  });
});
