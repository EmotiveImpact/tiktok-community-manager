import { createServer } from 'node:http';
import { createHash, timingSafeEqual } from 'node:crypto';
import { mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { EvidenceStore, reportMarkdown } from './store.mjs';
import { Fault, ident, object, text } from './validation.mjs';

export const SCOPES = Object.freeze(['sessions:read', 'sessions:write', 'evidence:read', 'evidence:write', 'assertions:write', 'cases:read', 'cases:write']);

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

export function createIntelligenceServer({ store, keys: configuredKeys }) {
  const keys = validateKeys(configuredKeys);
  const server = createServer(async (request, response) => {
    try {
      // This is a server/client API. Browser access requires a deliberate transport adapter.
      if (request.headers.origin) throw new Fault('browser_origin_not_enabled', 403);
      const url = new URL(request.url, 'http://localhost');
      if (request.method === 'GET' && url.pathname === '/health') return send(response, 200, { service: 'livelens-intelligence', schemaVersion: 1 });
      const principal = authenticate(request, keys);
      const workspace = principal.workspace;
      const requireScope = scope => { if (!principal.scopes.has(scope)) throw new Fault('scope_denied', 403); };
      const match = pattern => url.pathname.match(pattern);
      let route;
      if (request.method === 'GET' && url.pathname === '/v1/capabilities') return send(response, 200, {
        schemaVersion: 1, workspace, subject: principal.subject, scopes: [...principal.scopes],
        enabled: ['durable-evidence', 'search', 'case-exports', 'manual-attribution-history', 'session-integrity'],
        planned: ['live-capture', 'speech-to-text', 'semantic-analysis', 'alfred-registration'],
      });
      if (url.pathname === '/v1/sessions') {
        if (request.method === 'GET') { requireScope('sessions:read'); return send(response, 200, { sessions: store.listSessions(workspace, url.searchParams.get('limit') ?? 100) }); }
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
      if (request.method === 'POST' && url.pathname === '/v1/cases') {
        requireScope('cases:write'); return send(response, 201, store.createCase(workspace, await readBody(request), principal.subject));
      }
      if ((route = match(/^\/v1\/cases\/([A-Za-z0-9_-]+)\/evidence$/)) && request.method === 'POST') {
        requireScope('cases:write'); requireScope('evidence:read');
        const body = object(await readBody(request), ['evidenceIds']);
        return send(response, 200, store.linkEvidence(workspace, route[1], body.evidenceIds, principal.subject));
      }
      if ((route = match(/^\/v1\/cases\/([A-Za-z0-9_-]+)\/report$/)) && request.method === 'GET') {
        requireScope('cases:read'); requireScope('evidence:read'); const report = store.report(workspace, route[1]);
        if (url.searchParams.get('format') === 'markdown') return send(response, 200, reportMarkdown(report), true);
        return send(response, 200, report);
      }
      throw new Fault('not_found', 404);
    } catch (error) { send(response, error instanceof Fault ? error.status : 500, { error: error instanceof Fault ? error.code : 'internal_error' }); }
  });
  server.requestTimeout = 15_000;
  server.headersTimeout = 10_000;
  return server;
}

export function startFromEnvironment(env = process.env) {
  let keys;
  try { keys = JSON.parse(env.LIVELENS_API_KEYS ?? 'null'); } catch { throw new Fault('invalid_api_keys_json'); }
  validateKeys(keys);
  const path = resolve(env.LIVELENS_DB_PATH ?? './data/intelligence.sqlite');
  mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
  const store = new EvidenceStore(path);
  const server = createIntelligenceServer({ store, keys });
  const host = env.LIVELENS_HOST ?? '127.0.0.1';
  const port = Number(env.LIVELENS_PORT ?? 4318);
  if (!Number.isInteger(port) || port < 1 || port > 65535) { store.close(); throw new Fault('invalid_port'); }
  server.listen(port, host, () => console.log(`LiveLens intelligence service listening at ${host}:${port}`));
  const stop = () => server.close(() => { store.close(); process.exit(0); });
  process.once('SIGTERM', stop); process.once('SIGINT', stop);
  return { server, store };
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try { startFromEnvironment(); } catch (error) { console.error(error instanceof Fault ? error.code : 'service_start_failed'); process.exitCode = 1; }
}
