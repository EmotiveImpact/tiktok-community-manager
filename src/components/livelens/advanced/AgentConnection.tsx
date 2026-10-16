import { useMemo, useRef, useState, type FormEvent } from "react";
import { ArrowLeft, ArrowRight, Bot, Check, Copy, Download, ExternalLink, FileJson, KeyRound, RefreshCw, Terminal } from "lucide-react";
import { exportText, type Session } from "../../../lib/livelens/api";
import { createAgentSetup, type AgentSetupInput, type SetupField } from "./agent-setup";
import { collection, Loading, Notice, Status, useResource } from "./shared";
import "./agent-connection.css";

type Tool = { name: string; description: string; scopes?: string[]; policy?: string };
type AgentManifest = { readTools?: Tool[]; controlTools?: Tool[]; workspace?: string; subject?: string; transport?: string };
type Source = { id: string; label: string; account?: string | null; fixture?: boolean };
const GUIDE = "https://github.com/EmotiveImpact/Alfred/blob/5b37ba41353cfcd0cae4243482520e25175e21d9/docs/LIVELENS_INTEGRATION.md";

export default function AgentConnection() {
  const resource = useResource<AgentManifest>("/v1/agent");
  const capabilities = useResource<{ scopes: string[] }>("/v1/capabilities");
  const manifest = resource.error ? null : resource.data;
  return (
    <div className="ac-connection">
      <div className="ac-intro">
        <div className="ac-symbol"><Bot size={27} aria-hidden="true" /></div>
        <div><span className="aw-eyebrow">ALFRED + LIVELENS</span><h2>Put your recordings to work.</h2><p>Give ALFRED a precise set of conversations to search, reference and investigate.</p></div>
        <a className="aw-text-button" href={GUIDE} target="_blank" rel="noopener noreferrer">Connection guide <ExternalLink size={14} aria-hidden="true" /></a>
      </div>
      <div className="ac-readiness" aria-label="Connection readiness">
        <div><span className={`ac-state-dot ${manifest && !resource.loading ? "is-ready" : ""}`} /><div><strong>LiveLens service</strong><span>{resource.loading ? "Checking tool catalogue…" : manifest ? `Available · ${manifest.workspace ?? "Current workspace"}` : "Tool catalogue unavailable"}</span></div></div>
        <div><span className="ac-state-dot" /><div><strong>ALFRED runtime</strong><span>Connection not checked · verify on your private host</span></div></div>
        <button className="aw-text-button" type="button" disabled={resource.loading} onClick={resource.reload}><RefreshCw size={14} aria-hidden="true" />Refresh service status</button>
      </div>
      <Notice error={resource.error} />
      <div className="ac-layout">
        <section className="ac-setup" aria-labelledby="ac-setup-title">
          <div className="ac-panel-head"><div><span className="aw-eyebrow">PRIVATE CONNECTION</span><h2 id="ac-setup-title">Set up the connection</h2></div><Status>Guided setup</Status></div>
          {resource.loading && !manifest ? <Loading /> : manifest?.workspace ? <SetupForm key={manifest.workspace} workspace={manifest.workspace} canReadSources={!capabilities.error && (capabilities.data?.scopes.includes("recordings:read") ?? false)} /> : <div className="ac-unavailable"><KeyRound size={23} /><h3>Check workspace access to build your recipe.</h3><p>Refresh the service status after signing in with session access. The connection guide remains available; no ALFRED installation has been checked.</p><a className="aw-secondary" href={GUIDE} target="_blank" rel="noopener noreferrer">Open ALFRED connection guide</a></div>}
        </section>
        <aside className="ac-context" aria-label="ALFRED setup information">
          <div><span className="aw-eyebrow">WHAT YOU CAN DO</span><h3>Keep the original context.</h3><ul className="ac-benefits"><li>Find statements across selected sessions.</li><li>Reopen source evidence and reviewed reports.</li><li>Request a bounded recording with separate approval.</li></ul></div>
          <div className="ac-context-rule"><KeyRound size={19} /><h3>Your host holds the keys.</h3><p>This builder creates setup files only. Your private token stays on the ALFRED host.</p><p>Source grants, collection approval, model access and memory acceptance remain separate.</p></div>
          {manifest && <details className="ac-catalogue"><summary>LiveLens tool catalogue <span>{(manifest.readTools?.length ?? 0) + (manifest.controlTools?.length ?? 0)}</span></summary><p>These are service capabilities. The private token and ALFRED grants determine actual access.</p><h3>Available read tools</h3><ToolList tools={manifest.readTools ?? []} /><h3>Bounded control tools</h3><ToolList tools={manifest.controlTools ?? []} /></details>}
        </aside>
      </div>
    </div>
  );
}

function SetupForm({ workspace, canReadSources }: { workspace: string; canReadSources: boolean }) {
  const sessionsResource = useResource<unknown>("/v1/sessions?limit=200");
  const [input, setInput] = useState<AgentSetupInput>({ baseUrl: "", scope: "", workspace, sourceId: "livelens-recordings", sessionIds: [], privateDirectory: "", dataDirectory: "", vaultDirectory: "", allowCollection: false, recorderSourceId: "", maxDurationSeconds: "60" });
  const sourcesResource = useResource<{ sources: Source[] }>(input.allowCollection && canReadSources ? "/v1/sources" : null);
  const [step, setStep] = useState(0);
  const [attempted, setAttempted] = useState(false);
  const [query, setQuery] = useState("");
  const [document, setDocument] = useState<"config" | "commands" | "read">("config");
  const [notice, setNotice] = useState("");
  const [copyError, setCopyError] = useState("");
  const stepHeading = useRef<HTMLHeadingElement>(null);
  const sessions = collection<Session>(sessionsResource.data, "sessions");
  const availableIds = new Set(sessionsResource.error ? [] : sessions.map((session) => session.id));
  const selectedIds = input.sessionIds.filter((id) => availableIds.has(id));
  const sources = sourcesResource.error ? [] : sourcesResource.data?.sources ?? [];
  const recorderAllowed = !input.allowCollection || (canReadSources && sources.some((source) => source.id === input.recorderSourceId));
  const result = useMemo(() => createAgentSetup({ ...input, sessionIds: selectedIds, recorderSourceId: recorderAllowed ? input.recorderSourceId : "" }), [input, selectedIds.join("\0"), recorderAllowed]);
  const shown = sessions.filter((session) => `${session.title} ${session.account ?? ""} ${session.id}`.toLowerCase().includes(query.toLowerCase()));
  const update = <K extends SetupField>(key: K, value: AgentSetupInput[K]) => { setInput((old) => ({ ...old, [key]: value })); setNotice(""); setCopyError(""); };
  const changeStep = (value: number) => { setStep(value); setAttempted(false); setNotice(""); setCopyError(""); requestAnimationFrame(() => stepHeading.current?.focus()); };
  const fieldsForStep: SetupField[] = step === 0 ? ["sourceId", "sessionIds", "recorderSourceId", "maxDurationSeconds"] : Object.keys(input) as SetupField[];
  const next = (event: FormEvent) => {
    event.preventDefault();
    if (step >= 2) return;
    setAttempted(true);
    if (fieldsForStep.some((field) => result.issues[field])) {
      requestAnimationFrame(() => globalThis.document.querySelector<HTMLElement>(".ac-setup [aria-invalid='true']")?.focus());
      return;
    }
    changeStep(step + 1);
  };
  const error = (field: SetupField) => attempted ? result.issues[field] : undefined;
  const field = (key: Exclude<SetupField, "sessionIds" | "allowCollection">, label: string, hint: string, placeholder = "") => <label className="ac-field" htmlFor={`ac-${key}`}><span>{label}</span><input id={`ac-${key}`} aria-label={label} value={String(input[key])} onChange={(event) => update(key, event.target.value)} placeholder={placeholder} autoComplete="off" spellCheck={false} aria-invalid={!!error(key)} aria-describedby={`ac-${key}-help${error(key) ? ` ac-${key}-error` : ""}`} /><small id={`ac-${key}-help`}>{hint}</small>{error(key) && <span className="ac-field-error" id={`ac-${key}-error`}>{error(key)}</span>}</label>;
  const recipe = result.recipe;
  const outputs = recipe ? { config: { name: "livelens-connection.json", value: recipe.config, path: recipe.configPath }, commands: { name: "livelens-setup.sh", value: recipe.commands, path: "Run from the existing ALFRED checkout" }, read: { name: "livelens-read.json", value: recipe.read, path: recipe.readPath } } : null;
  const output = outputs?.[document];
  const copy = async () => {
    if (!output) return;
    setCopyError(""); setNotice("");
    try { await navigator.clipboard.writeText(output.value); setNotice(`${output.name} copied. No connection has been made.`); }
    catch { setCopyError("Clipboard unavailable here. Select the text below to copy, or download the file."); }
  };
  return <>
    <ol className="ac-steps" aria-label="Connection setup steps">{["Choose access", "Private host", "Review & install"].map((label, index) => <li key={label} className={step === index ? "is-current" : step > index ? "is-complete" : ""} aria-current={step === index ? "step" : undefined}><span>{step > index ? <Check size={14} aria-hidden="true" /> : `0${index + 1}`}</span>{label}</li>)}</ol>
    <form className="ac-form" onSubmit={next} noValidate>
      <div className="ac-step-heading"><h3 ref={stepHeading} tabIndex={-1}>{["Choose what ALFRED can access.", "Point to your private host.", "Your setup recipe is ready."][step]}</h3><p>{["Only selected session IDs enter the source catalogue. Start with read access.", "Use the paths and scope from your existing ALFRED installation. All values stay in this page until you copy or download them.", "Save these files privately, then install and verify from ALFRED. Generating this recipe makes no connection."][step]}</p></div>
      {step === 0 && <>
        <div className="ac-workspace-line"><span>LiveLens workspace</span><strong>{workspace}</strong></div>
        {field("sourceId", "Source name in ALFRED", "An exact catalogue ID for these selected sessions.")}
        <fieldset className="ac-sessions" aria-describedby={error("sessionIds") ? "ac-session-error" : undefined}><legend>Retained sessions <span>{selectedIds.length} selected</span></legend><input className="ac-session-search" aria-label="Find sessions for ALFRED" placeholder="Find by title, account or session ID…" value={query} onChange={(event) => setQuery(event.target.value)} />
          <Notice error={sessionsResource.error} />
          {sessionsResource.loading ? <Loading /> : sessionsResource.error ? <button type="button" className="aw-secondary" onClick={sessionsResource.reload}>Retry session list</button> : <div className="ac-session-list" role="group" aria-label="Sessions available to ALFRED" tabIndex={error("sessionIds") ? 0 : undefined} aria-invalid={!!error("sessionIds")} aria-describedby={error("sessionIds") ? "ac-session-error" : undefined}>{shown.map((session) => <label className="ac-session-row" key={session.id}><input type="checkbox" checked={selectedIds.includes(session.id)} onChange={(event) => update("sessionIds", event.target.checked ? [...selectedIds, session.id] : selectedIds.filter((id) => id !== session.id))} /><span><strong>{session.title || session.id}</strong><small>{session.account ? `@${session.account.replace(/^@/, "")} · ` : ""}{session.id}</small></span></label>)}{!shown.length && <p className="ac-list-empty">{sessions.length ? "No sessions match this search." : "No retained sessions yet. Capture a session in LiveLens first, then return to set up access."}</p>}</div>}
          <small className="ac-field-hint">Showing up to 200 recent sessions. Future sessions need an explicit catalogue update.</small>
          {error("sessionIds") && <span className="ac-field-error" id="ac-session-error">{error("sessionIds")}</span>}
        </fieldset>
        <div className="ac-collection"><label className="ac-collection-toggle"><input type="checkbox" aria-label="Include bounded recording controls" checked={input.allowCollection} disabled={!canReadSources} onChange={(event) => { update("allowCollection", event.target.checked); update("recorderSourceId", ""); }} /><span><strong>Include bounded recording controls</strong><small>Optional. Installation requests a separate collection grant; every start and stop still needs exact approval in ALFRED.</small></span></label>{!canReadSources && <small className="ac-field-hint">Recorder source access is required to prepare collection controls.</small>}
          {input.allowCollection && <div className="ac-collection-fields"><Notice error={sourcesResource.error} /><label className="ac-field" htmlFor="ac-recorderSourceId"><span>Configured recorder source</span><select id="ac-recorderSourceId" value={input.recorderSourceId} disabled={sourcesResource.loading} onChange={(event) => update("recorderSourceId", event.target.value)} aria-invalid={!!error("recorderSourceId")} aria-describedby={error("recorderSourceId") ? "ac-recorderSourceId-error" : undefined}><option value="">{sourcesResource.loading ? "Loading configured sources…" : "Choose a source"}</option>{sources.map((source) => <option key={source.id} value={source.id}>{source.label} · {source.id}{source.fixture ? " (fixture)" : ""}</option>)}</select>{error("recorderSourceId") && <span className="ac-field-error" id="ac-recorderSourceId-error">{error("recorderSourceId")}</span>}</label>{sourcesResource.error && <button className="aw-text-button" type="button" onClick={sourcesResource.reload}>Retry recorder sources</button>}{field("maxDurationSeconds", "Maximum recording seconds", "2–3600 seconds, within your workspace allowance. LiveLens enforces its own limits.")}</div>}
        </div>
      </>}
      {step === 1 && <>
        <div className="ac-fields-grid">{field("baseUrl", "LiveLens API origin", "An address reachable from ALFRED. Use HTTPS, or loopback HTTP on the same host.", "https://livelens.example.com")}{field("scope", "Existing ALFRED scope ID", "Your ALFRED scope can differ from the LiveLens workspace.", "personal")}{field("privateDirectory", "Private setup directory", "Absolute directory on the ALFRED host, outside Git, vaults and synced folders.", "/home/you/.private/livelens")}{field("dataDirectory", "Existing ALFRED data directory", "Use the data directory containing your existing owner credential.", "/home/you/.local/share/alfred")}</div>
        <details className="ac-vault"><summary>Using a custom vault?</summary>{field("vaultDirectory", "Existing custom vault directory", "Optional. The same --vault option is included in every ALFRED command.", "/home/you/notes")}</details>
        <div className="ac-private-note"><KeyRound size={19} aria-hidden="true" /><p>Privately create <code>livelens.token</code> in the setup directory with the intended workspace token. This page never asks for the token itself.</p></div>
      </>}
      {step === 2 && <>
        {!recipe ? <Notice error="The available sessions or source access changed. Go back and review your selections before exporting." /> : <>
          <div className="ac-recipe-summary"><span><strong>{selectedIds.length}</strong> selected {selectedIds.length === 1 ? "session" : "sessions"}</span><span>{input.allowCollection ? "Separate collection grant requested" : "Read access only"}</span><span>Not installed</span></div>
          <div className="ac-output-tabs" role="tablist" aria-label="Setup files">{([ ["config", "Connection JSON", FileJson], ["read", "Test read JSON", FileJson], ["commands", "Host commands", Terminal] ] as const).map(([key, label, Icon]) => <button type="button" key={key} id={`ac-tab-${key}`} role="tab" aria-selected={document === key} aria-controls="ac-output" tabIndex={document === key ? 0 : -1} onClick={() => { setDocument(key); setNotice(""); setCopyError(""); }} onKeyDown={(event) => { if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return; event.preventDefault(); const keys = ["config", "read", "commands"] as const; const index = keys.indexOf(key); const nextKey = keys[event.key === "Home" ? 0 : event.key === "End" ? 2 : (index + (event.key === "ArrowRight" ? 1 : 2)) % 3]; setDocument(nextKey); setNotice(""); setCopyError(""); globalThis.document.getElementById(`ac-tab-${nextKey}`)?.focus(); }}><Icon size={15} aria-hidden="true" />{label}</button>)}</div>
          <div className="ac-output" id="ac-output" role="tabpanel" aria-labelledby={`ac-tab-${document}`}><div className="ac-output-header"><span>{output?.path}</span><div><button type="button" className="aw-text-button" onClick={copy}><Copy size={14} aria-hidden="true" />Copy file</button><button type="button" className="aw-text-button" onClick={() => { if (output) exportText(output.value, output.name, document === "commands" ? "text/plain" : "application/json"); setNotice(document === "commands" ? "Host commands download requested. Review them before running on the private ALFRED host." : `${output?.name} download requested. Move it to the private path shown above and set mode 0600.`); }}><Download size={14} aria-hidden="true" />Download file</button></div></div><textarea aria-label={output?.name} value={output?.value ?? ""} readOnly spellCheck={false} rows={15} /></div>
          <Notice error={copyError} receipt={notice} />
          <ol className="ac-install"><li><strong>Prepare the private files.</strong><p>Save both JSON files at the paths shown. Privately provision the token file; set all three files to mode 0600. Keep them outside Git, vaults and sync.</p></li><li><strong>Stop ALFRED, then install.</strong><p>Run the host commands from the existing checkout with LiveLens support. Installation enables explicit source policy in this scope; other sources may need their own grants. Installing without collection access revokes that grant and leaves accepted jobs running.</p></li><li><strong>Verify registration, then an actual read.</strong><p>Discovery should report <code>configured: true</code>, <code>registeredInAlfred: true</code> and read permission. The following sessions read contacts LiveLens: check its workspace, source and returned session IDs before restarting ALFRED.</p></li></ol>
          <p className="ac-verification-note">This console cannot inspect your ALFRED host. A generated recipe, successful discovery or empty sessions list does not prove selected-session access. Installation starts no monitoring, recording, model calls or memory import.</p>
        </>}
      </>}
      <div className="ac-form-footer"><span>{step === 0 ? "No sessions selected automatically." : step === 1 ? "Private host paths only. No tokens." : "Keep the recipe with your private setup files."}</span><div>{step > 0 && <button type="button" className="aw-secondary" onClick={() => changeStep(step - 1)}><ArrowLeft size={15} aria-hidden="true" />Back</button>}{step < 2 ? <button type="submit" className="aw-primary">{step === 0 ? "Continue to private host" : "Generate setup recipe"}<ArrowRight size={15} aria-hidden="true" /></button> : <button type="button" className="aw-primary" disabled={!recipe} onClick={() => { if (recipe) exportText(recipe.guide, "livelens-alfred-setup.md", "text/markdown"); setNotice("Setup recipe download requested. ALFRED remains unverified here."); }}><Download size={15} aria-hidden="true" />Download complete recipe</button>}</div></div>
    </form>
  </>;
}

function ToolList({ tools }: { tools: Tool[] }) {
  return <ul>{tools.map((tool) => <li key={tool.name}><strong>{tool.name.replaceAll(/[_.]/g, " ")}</strong><p>{tool.description}</p>{tool.scopes?.length ? <small>{tool.scopes.join(" · ")}</small> : null}</li>)}</ul>;
}
