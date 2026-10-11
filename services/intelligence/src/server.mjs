import { createServer } from 'node:http';
import { createHash, timingSafeEqual } from 'node:crypto';
import { mkdirSync, createReadStream } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { EvidenceStore, reportMarkdown } from './store.mjs';
import { Fault, ident, object, text, digest } from './validation.mjs';
import { browserTransport } from './browser.mjs';
import { Recorder } from './recorder.mjs';
import { InvestigationEngine } from './investigations.mjs';
import { advancedRoute } from './advanced-routes.mjs';
import { SpeechWorker } from './speech.mjs';
import { Scheduler } from './scheduler.mjs';
import { Governance } from './governance.mjs';
import { createSourceAdapters } from './source-adapters.mjs';
import { AnalysisProvider } from './analysis.mjs';
import { SourceCatalog } from './source-catalog.mjs';
import { PostgresDatabase } from './postgres-db.mjs';
import { MediaArchive } from './media-archive.mjs';
import { objectStorageFromEnvironment } from './storage-config.mjs';

export const SCOPES = Object.freeze(['sessions:read', 'sessions:write', 'evidence:read', 'evidence:write', 'assertions:write', 'cases:read', 'cases:write', 'recordings:read', 'recordings:write', 'speech:read', 'speech:write', 'analysis:write', 'investigations:write', 'missions:read', 'missions:write', 'reports:write', 'workspace:read', 'workspace:admin']);

export function validateKeys(keys) {
  if (!Array.isArray(keys) || !keys.length || keys.length > 100) throw new Fault('api_keys_required');
  const seen = new Set();
  return keys.map(value => {
    object(value, ['token', 'workspace', 'subject', 'scopes']);
    if (typeof value.token !== 'string' || !/^[A-Za-z0-9_-]{32,128}$/.test(value.token) || seen.has(value.token)) throw new Fault('invalid_api_key');
    seen.add(value.token); ident(value.workspace); text(value.subject, 100);
    if (!Array.isArray(value.scopes) || !value.scopes.length || value.scopes.some(scope => !SCOPES.includes(scope))) throw new Fault('invalid_scope');
    return { workspace: value.workspace, subject: value.subject, scopes: new Set(value.scopes), tokenHash: createHash('sha256').update(value.token).digest() };
  });
}

function authenticate(request, keys) {
  const auth = request.headers.authorization ?? '';
  if (!/^Bearer [A-Za-z0-9_-]{32,128}$/.test(auth)) throw new Fault('unauthorised', 401);
  const supplied = createHash('sha256').update(auth.slice(7)).digest();
  let principal;
  for (const key of keys) if (timingSafeEqual(supplied, key.tokenHash)) principal = key;
  if (!principal) throw new Fault('unauthorised', 401);
  return principal;
}

async function readBody(request) {
  if (!/^application\/json(?:\s*;|$)/i.test(request.headers['content-type'] ?? '')) throw new Fault('json_content_type_required', 415);
  let bytes = 0; const parts = [];
  for await (const part of request) {
    bytes += part.length;
    if (bytes > 1_048_576) throw new Fault('request_too_large', 413);
    parts.push(part);
  }
  try { return JSON.parse(Buffer.concat(parts).toString('utf8')); } catch { throw new Fault('invalid_json'); }
}

function send(response, status, value, markdown = false) {
  response.writeHead(status, {
    'Content-Type': markdown ? 'text/markdown; charset=utf-8' : 'application/json; charset=utf-8',
    'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff',
  });
  response.end(markdown ? value : JSON.stringify(value));
}

export function createIntelligenceServer({ store, keys: configuredKeys, browser: browserOptions, recorder, investigation = new InvestigationEngine({ store }), scheduler, speech, governance, analysis, pdf, sourceCatalog, mediaArchive }) {
  const keys = validateKeys(configuredKeys);
  const browser = browserOptions ? browserTransport(browserOptions, SCOPES) : null;
  const server = createServer(async (request, response) => {
    try {
      const url = new URL(request.url, 'http://localhost');
      if (browser && await browser.route(request, response, url.pathname, readBody, send)) return;
      if (request.headers.origin && (!browser || request.headers.authorization)) throw new Fault('browser_origin_not_enabled', 403);
      if (request.method === 'GET' && url.pathname === '/health') return send(response, 200, { service: 'livelens-intelligence', schemaVersion: 1 });
      const principal = request.headers.authorization ? authenticate(request, keys) : browser ? browser.authenticate(request) : authenticate(request, keys);
      governance?.role(principal);
      const workspace = principal.workspace;
      const requireScope = (scope, context = {}) => { if (!principal.scopes.has(scope)) throw new Fault('scope_denied', 403); governance?.authorize(principal, scope, context); };
      const match = pattern => url.pathname.match(pattern);
      let route;
      if (request.method === 'GET' && url.pathname === '/v1/capabilities') return send(response, 200, {
        schemaVersion: 1, workspace, subject: principal.subject, scopes: [...principal.scopes],
        enabled: ['durable-evidence', 'search', 'case-exports', 'manual-attribution-history', 'session-integrity', 'reviewed-investigations', 'source-supported-graph', 'protection-missions', 'reviewed-alerts', 'redacted-report-exports', 'agent-gateway-adapter', ...(browser ? ['authenticated-console'] : []), ...(recorder ? ['bounded-recording', 'retained-media-replay', 'concurrent-recording'] : []), ...(scheduler ? ['bounded-source-schedules'] : []), ...(speech ? ['speech-to-text'] : []), ...(governance ? ['workspace-roles', 'case-permissions', 'usage-and-retention'] : []), ...(analysis ? ['model-suggested-findings'] : []), ...(pdf ? ['pdf-reports'] : []), ...(mediaArchive ? ['verified-media-archive'] : []), ...(store.db.dialect === 'postgres' ? ['postgresql-store'] : [])],
        planned: ['validated-live-provider', 'validated-multi-speaker-diarisation', 'semantic-model-analysis', 'alfred-registration', 'production-postgresql-rollout', 'paid-provider-billing', 'measured-customer-capacity'],
        workers: { recording: !!recorder, scheduling: !!scheduler, speech: speech?.capabilities() ?? { enabled: false, reason: 'recognizer_not_configured', diarization: false }, mediaArchive: { enabled: !!mediaArchive, encrypted: !!mediaArchive?.encrypted } },
      });
      if (await advancedRoute({ request, response, url, principal, requireScope, readBody, send, investigation, scheduler, speech, governance, analysis, recorder, pdf, mediaArchive })) return;
      if (url.pathname === '/v1/overview' && request.method === 'GET') {
        requireScope('sessions:read'); requireScope('cases:read'); requireScope('evidence:read');
        const count = table => store.db.prepare(`SELECT count(*) AS n FROM ${table} WHERE workspace=?`).get(workspace).n;
        const role = governance?.role(principal);
        const cases = governance && !['owner', 'admin'].includes(role) ? store.db.prepare("SELECT count(*) AS n FROM cases c LEFT JOIN case_access_policy p ON p.workspace=c.workspace AND p.case_id=c.id WHERE c.workspace=? AND (coalesce(p.visibility,'workspace')='workspace' OR c.created_by=? OR EXISTS(SELECT 1 FROM case_access_grants g WHERE g.workspace=c.workspace AND g.case_id=c.id AND g.subject=? AND g.permission IN('read','write')))").get(workspace, principal.subject, principal.subject).n : count('cases');
        const recordingRead = principal.scopes.has('recordings:read');
        if (recordingRead) requireScope('recordings:read');
        return send(response, 200, { sessions: count('sessions'), cases, evidence: count('events'), gaps: store.db.prepare("SELECT count(*) AS n FROM events WHERE workspace=? AND kind='gap'").get(workspace).n, recordings: recordingRead ? recorder?.list(workspace) ?? [] : [], worker: recorder && recordingRead ? { mode: 'bounded-concurrent-jobs', error: recorder.workerError ?? null } : null });
      }
      if (url.pathname === '/v1/sources') {
        if (request.method === 'GET') { requireScope('recordings:read'); return send(response, 200, { sources: sourceCatalog?.sourcesFor(workspace) ?? scheduler?.sourcesFor(workspace) ?? recorder?.sourcesFor(workspace) ?? [], worker: recorder ? { mode: 'bounded-concurrent-jobs', maxConcurrent: recorder.maxConcurrent, error: recorder.workerError ?? null } : null }); }
        if (request.method === 'POST') { requireScope('workspace:admin'); requireScope('recordings:write'); if (!sourceCatalog) throw new Fault('source_configuration_unavailable', 503); const created = sourceCatalog.create(workspace, await readBody(request)); governance?.recordAudit(workspace, 'source.created', created.id, principal.subject, { kind: created.kind }); return send(response, 201, created); }
      }
      if (url.pathname === '/v1/jobs') {
        if (!recorder) throw new Fault('recorder_unavailable', 503);
        if (request.method === 'GET') { requireScope('recordings:read'); return send(response, 200, { jobs: recorder.list(workspace, { limit: url.searchParams.get('limit') ?? 100 }) }); }
        if (request.method === 'POST') { requireScope('recordings:write'); const value = object(await readBody(request)); const requestId = value.id == null ? null : ident(value.id); const existing = requestId && store.db.prepare('SELECT 1 FROM recording_jobs WHERE workspace=? AND id=?').get(workspace, requestId); if (!existing) governance?.checkQuota(workspace, { recordingSeconds: value.maxDurationSeconds ?? 60, pendingJobs: 1 }); const job = recorder.create(workspace, value); governance?.recordAudit(workspace, 'capture.created', job.id, principal.subject, { sourceId: job.sourceId, maxDurationSeconds: job.maxDurationSeconds }); return send(response, 201, job); }
      }
      if ((route = match(/^\/v1\/jobs\/([A-Za-z0-9_-]+)(\/stop)?$/))) {
        if (!recorder) throw new Fault('recorder_unavailable', 503);
        if (route[2] && request.method === 'POST') { requireScope('recordings:write'); object(await readBody(request), []); return send(response, 200, recorder.stop(workspace, route[1])); }
        if (!route[2] && request.method === 'GET') { requireScope('recordings:read'); return send(response, 200, recorder.job(workspace, route[1])); }
      }
      if ((route = match(/^\/v1\/sessions\/([A-Za-z0-9_-]+)\/media$/)) && request.method === 'GET') {
        requireScope('recordings:read'); requireScope('sessions:read'); store.session(workspace, route[1]);
        return send(response, 200, { jobs: recorder?.list(workspace, { sessionId: route[1] }) ?? [] });
      }
      if ((route = match(/^\/v1\/media\/([A-Za-z0-9_-]+)\/([A-Za-z0-9_-]+)$/)) && request.method === 'GET') {
        requireScope('recordings:read');
        if (!recorder) throw new Fault('recorder_unavailable', 503);
        const media = await recorder.media(workspace, route[1], route[2]);
        let start = 0, end = media.bytes - 1, status = 200;
        if (request.headers.range) {
          const range = /^bytes=(\d+)-(\d*)$/.exec(request.headers.range);
          if (!range) throw new Fault('invalid_media_range', 416);
          start = Number(range[1]); end = range[2] ? Math.min(Number(range[2]), end) : end;
          if (!Number.isSafeInteger(start) || start > end || start >= media.bytes) throw new Fault('invalid_media_range', 416);
          status = 206;
        }
        response.writeHead(status, { 'Content-Type': 'video/mp4', 'Content-Length': end - start + 1, 'Accept-Ranges': 'bytes', ...(status === 206 ? { 'Content-Range': `bytes ${start}-${end}/${media.bytes}` } : {}), 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' });
        createReadStream(media.path, { start, end }).on('error', () => response.destroy()).pipe(response); return;
      }
      if (url.pathname === '/v1/sessions') {
        if (request.method === 'GET') { requireScope('sessions:read'); return send(response, 200, { sessions: store.listSessions(workspace, url.searchParams.get('limit') ?? 100, Number(url.searchParams.get('offset') ?? 0)) }); }
        if (request.method === 'POST') { requireScope('sessions:write'); return send(response, 201, store.createSession(workspace, await readBody(request))); }
      }
      if ((route = match(/^\/v1\/sessions\/([A-Za-z0-9_-]+)$/)) && request.method === 'GET') {
        requireScope('sessions:read'); return send(response, 200, store.session(workspace, route[1]));
      }
      if ((route = match(/^\/v1\/sessions\/([A-Za-z0-9_-]+)\/events$/))) {
        if (request.method === 'GET') {
          requireScope('evidence:read'); const events = store.events(workspace, route[1], { after: Number(url.searchParams.get('after') ?? 0), limit: url.searchParams.get('limit') ?? 100 });
          return send(response, 200, { events, nextAfter: events.at(-1)?.sequence ?? null });
        }
        if (request.method === 'POST') {
          requireScope('evidence:write'); const body = object(await readBody(request), ['events']);
          return send(response, 200, { results: store.append(workspace, route[1], body.events) });
        }
      }
      if ((route = match(/^\/v1\/sessions\/([A-Za-z0-9_-]+)\/integrity$/)) && request.method === 'GET') {
        requireScope('evidence:read'); return send(response, 200, store.verify(workspace, route[1]));
      }
      if (request.method === 'GET' && url.pathname === '/v1/evidence/search') {
        requireScope('evidence:read'); return send(response, 200, { evidence: store.search(workspace, {
          query: url.searchParams.get('q') ?? '', account: url.searchParams.get('account'), sessionId: url.searchParams.get('session'), limit: url.searchParams.get('limit') ?? 100,
        }) });
      }
      if ((route = match(/^\/v1\/evidence\/([A-Za-z0-9_-]+)\/assertions$/))) {
        if (request.method === 'GET') { requireScope('evidence:read'); return send(response, 200, { assertions: store.assertionHistory(workspace, route[1]) }); }
        if (request.method === 'POST') { requireScope('assertions:write'); return send(response, 201, store.assertAccount(workspace, route[1], await readBody(request), principal.subject)); }
      }
      if ((route = match(/^\/v1\/evidence\/([A-Za-z0-9_-]+)$/)) && request.method === 'GET') {
        requireScope('evidence:read'); return send(response, 200, store.evidence(workspace, route[1]));
      }
      if ((route = match(/^\/v1\/evidence\/([A-Za-z0-9_-]+)\/context$/)) && request.method === 'GET') {
        requireScope('evidence:read'); requireScope('sessions:read'); return send(response, 200, store.context(workspace, route[1], url.searchParams.get('limit') ?? 25));
      }
      if (request.method === 'GET' && url.pathname === '/v1/cases') {
        requireScope('cases:read'); const cases = store.listCases(workspace, url.searchParams.get('limit') ?? 100, Number(url.searchParams.get('offset') ?? 0)).filter(c => { if (!governance) return true; try { governance.authorize(principal, 'cases:read', { caseId: c.id }); return true; } catch { return false; } }); return send(response, 200, { cases });
      }
      if ((route = match(/^\/v1\/cases\/([A-Za-z0-9_-]+)$/)) && request.method === 'GET') {
        requireScope('cases:read', { caseId: route[1] }); return send(response, 200, store.case(workspace, route[1]));
      }
      if (request.method === 'POST' && url.pathname === '/v1/cases') {
        requireScope('cases:write'); const created = store.createCase(workspace, await readBody(request), principal.subject); governance?.recordAudit(workspace, 'case.created', created.id, principal.subject, {}); return send(response, 201, created);
      }
      if ((route = match(/^\/v1\/cases\/([A-Za-z0-9_-]+)\/evidence$/)) && request.method === 'POST') {
        requireScope('cases:write', { caseId: route[1] }); requireScope('evidence:read');
        const body = object(await readBody(request), ['evidenceIds']);
        return send(response, 200, store.linkEvidence(workspace, route[1], body.evidenceIds, principal.subject));
      }
      if ((route = match(/^\/v1\/cases\/([A-Za-z0-9_-]+)\/report$/)) && request.method === 'GET') {
        requireScope('cases:read', { caseId: route[1] }); requireScope('evidence:read'); let report = store.report(workspace, route[1]);
        if (recorder && principal.scopes.has('recordings:read')) {
          const media = report.sessions.flatMap(s => recorder.list(workspace, { sessionId: s.id }));
          for (const job of media) for (const segment of job.segments) await recorder.media(workspace, job.id, segment.id);
          const { reportSha256: _old, ...content } = report;
          report = { ...content, media, reportSha256: digest({ ...content, media }) };
        }
        if (url.searchParams.get('format') === 'markdown') return send(response, 200, reportMarkdown(report), true);
        return send(response, 200, report);
      }
      throw new Fault('not_found', 404);
    } catch (error) { if (response.headersSent) response.destroy(); else send(response, error instanceof Fault ? error.status : 500, { error: error instanceof Fault ? error.code : 'internal_error' }); }
  });
  server.requestTimeout = 15_000;
  server.headersTimeout = 10_000;
  return server;
}

export function startFromEnvironment(env = process.env) {
  let keys;
  try { keys = JSON.parse(env.LIVELENS_API_KEYS ?? 'null'); } catch { throw new Fault('invalid_api_keys_json'); }
  validateKeys(keys);
  const host = env.LIVELENS_HOST ?? '127.0.0.1';
  const port = Number(env.LIVELENS_PORT ?? 4318);
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Fault('invalid_port');
  const path = resolve(env.LIVELENS_DB_PATH ?? './data/intelligence.sqlite');
  if (!env.LIVELENS_POSTGRES_URL) mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
  const store = new EvidenceStore(path, { database: env.LIVELENS_POSTGRES_URL ? new PostgresDatabase({ connectionString: env.LIVELENS_POSTGRES_URL, schema: env.LIVELENS_POSTGRES_SCHEMA ?? 'livelens' }) : undefined });
  let browser;
  if (env.LIVELENS_BROWSER_USERS) {
    browser = { origin: env.LIVELENS_CONSOLE_ORIGIN, users: JSON.parse(env.LIVELENS_BROWSER_USERS), bundleDir: env.LIVELENS_BUNDLE_DIR ? resolve(env.LIVELENS_BUNDLE_DIR) : undefined };
  }
  const recorderSources = env.LIVELENS_RECORDER_SOURCES ? JSON.parse(env.LIVELENS_RECORDER_SOURCES) : [];
  const adapterConfig = env.LIVELENS_SOURCE_ADAPTERS ? JSON.parse(env.LIVELENS_SOURCE_ADAPTERS) : recorderSources;
  let recorder;
  if (recorderSources.length || adapterConfig.length || browser || env.LIVELENS_ENABLE_RECORDER === '1') recorder = new Recorder({ store, sources: recorderSources, mediaRoot: resolve(env.LIVELENS_MEDIA_ROOT ?? './data/media'), ffmpeg: env.LIVELENS_FFMPEG_PATH ?? '/usr/bin/ffmpeg', maxConcurrent: Number(env.LIVELENS_MAX_RECORDINGS ?? 2) });
  const scheduler = recorder ? new Scheduler({ store, recorder, adapters: createSourceAdapters(adapterConfig, { env }) }) : undefined;
  const speech = env.LIVELENS_SPEECH_RECOGNIZER && recorder ? new SpeechWorker({ store, recorder, recognizer: JSON.parse(env.LIVELENS_SPEECH_RECOGNIZER) }) : undefined;
  const governance = env.LIVELENS_WORKSPACE_MEMBERS ? new Governance({ store, recorder, members: JSON.parse(env.LIVELENS_WORKSPACE_MEMBERS) }) : undefined;
  if (recorder && governance) recorder.admission = (workspace, additions) => governance.checkQuota(workspace, additions);
  const sourceCatalog = scheduler ? new SourceCatalog({ store, scheduler, governance, adaptersOptions: { env } }) : undefined;
  const investigation = new InvestigationEngine({ store });
  const analysis = env.LIVELENS_ANALYSIS_PROVIDER ? new AnalysisProvider({ store, investigation, provider: JSON.parse(env.LIVELENS_ANALYSIS_PROVIDER), env }) : undefined;
  const pdf = env.LIVELENS_PDF_RENDERER ? JSON.parse(env.LIVELENS_PDF_RENDERER) : undefined;
  const storage = objectStorageFromEnvironment(env);
  if (storage && !recorder) throw new Fault('archive_recorder_required');
  const mediaArchive = storage ? new MediaArchive({ store, recorder, storage }) : undefined;
  if (mediaArchive) {
    mediaArchive.encrypted = true;
    if (governance) mediaArchive.admission = (workspace, additions) => governance.checkQuota(workspace, additions);
  }
  const server = createIntelligenceServer({ store, keys, browser, recorder, scheduler, speech, governance, investigation, analysis, pdf, sourceCatalog, mediaArchive });
  server.listen(port, host, () => { recorder?.start(); scheduler?.start(); speech?.start(); mediaArchive?.start(); console.log(`LiveLens intelligence service listening at ${host}:${port}`); });
  server.once('error', async () => { await scheduler?.close(); await speech?.close(); await mediaArchive?.close(); await recorder?.close(); store.close(); process.exitCode = 1; });
  let stopping = false;
  const stop = () => { if (stopping) return; stopping = true; server.close(async () => { await scheduler?.close(); await speech?.close(); await mediaArchive?.close(); await recorder?.close(); store.close(); process.exit(0); }); };
  process.once('SIGTERM', stop); process.once('SIGINT', stop);
  return { server, store, recorder, scheduler, speech, governance, investigation, analysis, sourceCatalog, mediaArchive };
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try { startFromEnvironment(); } catch (error) { console.error(error instanceof Fault ? error.code : 'service_start_failed'); process.exitCode = 1; }
}
