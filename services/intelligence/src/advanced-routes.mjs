import { Fault, ident, object } from './validation.mjs';
import { renderPdf } from './pdf.mjs';

// The HTTP principal supplies workspace and reviewer. Captured content never
// selects a tenant, a command, an executable or an agent permission.
export async function advancedRoute({ request, response, url, principal, requireScope, readBody, send, investigation, scheduler, speech, governance, analysis, recorder, pdf, mediaArchive }) {
  const workspace = principal.workspace, actor = principal.subject;
  const get = request.method === 'GET', post = request.method === 'POST';
  const match = pattern => url.pathname.match(pattern);
  const body = () => readBody(request);
  const empty = async () => object(await body(), []);
  const validateSources = value => {
    object(value);
    if (value.sourceIds === undefined) return;
    if (!Array.isArray(value.sourceIds) || value.sourceIds.length > 20) throw new Fault('invalid_source_selection');
    for (const sourceId of value.sourceIds) { const id = ident(sourceId); if (!scheduler?.sourcesFor(workspace).some(s => s.id === id) && !recorder?.sourcesFor(workspace).some(s => s.id === id)) throw new Fault('source_unavailable', 404); }
  };
  const result = value => { if (post) governance?.recordAudit(workspace, 'api.write', url.pathname, actor, { method: request.method }); send(response, post ? 201 : 200, value); return true; };
  let route;

  if (url.pathname === '/v1/media-archives') {
    if (get) { requireScope('recordings:read'); return result({ archives: mediaArchive?.list(workspace, { limit: url.searchParams.get('limit') ?? 100 }) ?? [] }); }
    if (post) { requireScope('recordings:write'); if (!mediaArchive) throw new Fault('media_archive_unavailable', 503); return result(mediaArchive.create(workspace, await body())); }
  }
  if ((route = match(/^\/v1\/media-archives\/([A-Za-z0-9_-]+)(\/restore)?$/))) {
    if (route[2] && post) { requireScope('recordings:write'); if (!mediaArchive) throw new Fault('media_archive_unavailable', 503); await empty(); return result(mediaArchive.restore(workspace, route[1])); }
    if (!route[2] && get) { requireScope('recordings:read'); if (!mediaArchive) throw new Fault('media_archive_unavailable', 503); return result(mediaArchive.job(workspace, route[1])); }
  }

  if (url.pathname === '/v1/analysis/capabilities' && get) { requireScope('evidence:read'); return result(analysis?.capabilities() ?? { enabled: false, reason: 'analysis_provider_not_configured' }); }
  if (url.pathname === '/v1/analysis' && post) { requireScope('analysis:write'); requireScope('investigations:write'); requireScope('evidence:read'); const value = object(await body()); requireScope('cases:write', { caseId: ident(value.caseId) }); if (!analysis) throw new Fault('analysis_provider_unavailable', 503); return result(await analysis.create(workspace, value, actor)); }

  if (url.pathname === '/v1/speech/capabilities' && get) {
    requireScope('evidence:read');
    return result(speech?.capabilities() ?? { enabled: false, reason: 'recognizer_not_configured', diarization: false });
  }
  if (url.pathname === '/v1/speech/jobs') {
    if (!speech) throw new Fault('speech_unavailable', 503);
    if (get) { requireScope('speech:read'); return result({ jobs: speech.list(workspace, { sessionId: url.searchParams.get('session') || undefined, limit: url.searchParams.get('limit') ?? 100 }) }); }
    if (post) {
      requireScope('speech:write'); const value = object(await body());
      if (value.segmentIds !== undefined && !Array.isArray(value.segmentIds)) throw new Fault('invalid_speech_inputs');
      const requestId = value.id == null ? null : ident(value.id);
      const existing = requestId && speech.db.prepare('SELECT 1 FROM speech_jobs WHERE workspace=? AND id=?').get(workspace, requestId);
      if (!existing) {
        const recording = recorder.job(workspace, ident(value.recordingJobId));
        const selected = value.segmentIds ? recording.segments.filter(s => value.segmentIds.includes(s.id)) : recording.segments;
        governance?.checkQuota(workspace, { speechSeconds: selected.reduce((sum, s) => sum + s.durationMs, 0) / 1000, pendingJobs: 1 });
      }
      return result(await speech.create(workspace, value));
    }
  }
  if ((route = match(/^\/v1\/speech\/jobs\/([A-Za-z0-9_-]+)(\/stop)?$/))) {
    if (!speech) throw new Fault('speech_unavailable', 503);
    if (route[2] && post) { requireScope('speech:write'); await empty(); return result(speech.stop(workspace, route[1])); }
    if (!route[2] && get) { requireScope('speech:read'); return result(speech.job(workspace, route[1])); }
  }
  if (url.pathname === '/v1/schedules') {
    if (!scheduler) throw new Fault('scheduler_unavailable', 503);
    if (get) { requireScope('recordings:read'); return result({ schedules: scheduler.list(workspace) }); }
    if (post) { requireScope('recordings:write'); return result(scheduler.create(workspace, await body())); }
  }
  if ((route = match(/^\/v1\/schedules\/([A-Za-z0-9_-]+)\/stop$/)) && post) {
    requireScope('recordings:write'); if (!scheduler) throw new Fault('scheduler_unavailable', 503);
    await empty(); return result(scheduler.stop(workspace, route[1]));
  }
  if ((route = match(/^\/v1\/investigations\/([A-Za-z0-9_-]+)$/)) && get) {
    requireScope('cases:read', { caseId: route[1] }); requireScope('evidence:read');
    return result(investigation.caseDetail(workspace, route[1]));
  }
  if ((route = match(/^\/v1\/investigations\/([A-Za-z0-9_-]+)\/notes$/)) && post) {
    requireScope('cases:write', { caseId: route[1] }); requireScope('evidence:read');
    return result(investigation.addNote(workspace, route[1], await body(), actor));
  }
  if ((route = match(/^\/v1\/investigations\/([A-Za-z0-9_-]+)\/findings$/)) && post) {
    requireScope('cases:write', { caseId: route[1] }); requireScope('evidence:read');
    return result(investigation.createFinding(workspace, route[1], await body(), actor));
  }
  if ((route = match(/^\/v1\/investigations\/([A-Za-z0-9_-]+)\/findings\/([A-Za-z0-9_-]+)\/review$/)) && post) {
    requireScope('cases:write', { caseId: route[1] }); requireScope('evidence:read');
    return result(investigation.reviewFinding(workspace, route[1], route[2], await body(), actor));
  }
  if (url.pathname === '/v1/bookmarks') {
    requireScope('evidence:read');
    if (get) return result({ bookmarks: investigation.bookmarks(workspace, { sessionId: url.searchParams.get('session') || undefined, limit: url.searchParams.get('limit') ?? 100 }) });
    if (post) { requireScope('investigations:write'); const value = object(await body(), ['evidenceId', 'label']); return result(investigation.bookmark(workspace, ident(value.evidenceId), { label: value.label }, actor)); }
  }
  if ((route = match(/^\/v1\/accounts\/([A-Za-z0-9._-]+)\/activity$/)) && get) {
    requireScope('evidence:read'); requireScope('sessions:read');
    return result(investigation.accountActivity(workspace, route[1], { limit: url.searchParams.get('limit') ?? 100 }));
  }
  if (url.pathname === '/v1/comparisons' && post) {
    requireScope('evidence:read'); requireScope('sessions:read'); return result(investigation.compare(workspace, await body()));
  }
  if (url.pathname === '/v1/graph') {
    requireScope('evidence:read');
    if (get) { requireScope('sessions:read'); return result(investigation.graph(workspace, { limit: url.searchParams.get('limit') ?? 100, ...(url.searchParams.get('sessions') ? { sessionIds: url.searchParams.get('sessions').split(',') } : {}) })); }
    if (post) { requireScope('investigations:write'); return result(investigation.createRelation(workspace, await body(), actor)); }
  }
  if (url.pathname === '/v1/missions') {
    if (get) { requireScope('missions:read'); return result({ missions: investigation.missions(workspace) }); }
    if (post) { requireScope('missions:write'); requireScope('evidence:read'); const value = await body(); validateSources(value); return result(investigation.createMission(workspace, value, actor)); }
  }
  if ((route = match(/^\/v1\/missions\/([A-Za-z0-9_-]+)$/)) && post) {
    requireScope('missions:write'); requireScope('evidence:read'); const value = await body(); validateSources(value); return result(investigation.updateMission(workspace, route[1], value, actor));
  }
  if ((route = match(/^\/v1\/missions\/([A-Za-z0-9_-]+)\/run$/)) && post) {
    requireScope('missions:write'); requireScope('evidence:read'); await empty(); return result(investigation.runMission(workspace, route[1], actor));
  }
  if (url.pathname === '/v1/alerts' && get) {
    requireScope('missions:read'); requireScope('evidence:read'); return result({ alerts: investigation.alerts(workspace, { missionId: url.searchParams.get('mission') || undefined, limit: url.searchParams.get('limit') ?? 100 }) });
  }
  if ((route = match(/^\/v1\/alerts\/([A-Za-z0-9_-]+)\/review$/)) && post) {
    requireScope('missions:write'); return result(investigation.reviewAlert(workspace, route[1], await body(), actor));
  }
  if ((route = match(/^\/v1\/investigations\/([A-Za-z0-9_-]+)\/report$/))) {
    requireScope('cases:read', { caseId: route[1] }); requireScope('evidence:read');
    if (post) { requireScope('reports:write', { caseId: route[1] }); requireScope('cases:write', { caseId: route[1] }); return result(investigation.updateReport(workspace, route[1], await body(), actor)); }
    if (get) {
      const format = url.searchParams.get('format');
      if (!format) return result(investigation.readReport(workspace, route[1]));
      if (!['json', 'html', 'markdown', 'pdf'].includes(format)) throw new Fault('invalid_report_format');
      let media = null;
      if (recorder && principal.scopes.has('recordings:read')) {
        requireScope('recordings:read');
        const report = investigation.caseDetail(workspace, route[1]);
        media = [...new Set(report.evidence.map(e => e.sessionId))].flatMap(id => recorder.list(workspace, { sessionId: id }));
        for (const job of media) for (const segment of job.segments) await recorder.media(workspace, job.id, segment.id);
      }
      const exported = investigation.exportReport(workspace, route[1], { format: format === 'pdf' ? 'html' : format, media });
      if (format === 'pdf') {
        if (!pdf) throw new Fault('pdf_renderer_unavailable', 503);
        const content = await renderPdf(exported.content, pdf);
        response.writeHead(200, { 'Content-Type': 'application/pdf', 'Content-Length': content.length, 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff', 'Content-Disposition': `attachment; filename="livelens-${route[1]}.pdf"` }); response.end(content); return true;
      }
      response.writeHead(200, { 'Content-Type': exported.contentType, 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff', 'Content-Disposition': `attachment; filename="${exported.filename}"`, 'Content-Security-Policy': "default-src 'none'; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'" });
      response.end(typeof exported.content === 'string' ? exported.content : JSON.stringify(exported.content)); return true;
    }
  }
  if (url.pathname.startsWith('/v1/workspace')) {
    if (!governance) throw new Fault('workspace_controls_unavailable', 503);
    if (url.pathname === '/v1/workspace' && get) { requireScope('workspace:read'); return result(governance.workspace(workspace, principal)); }
    if (url.pathname === '/v1/workspace/usage' && get) { requireScope('workspace:read'); return result(governance.usage(workspace)); }
    if (url.pathname === '/v1/workspace/limits' && post) { requireScope('workspace:admin'); return result(governance.setLimits(workspace, await body(), actor)); }
    if (url.pathname === '/v1/workspace/members') {
      if (get) { requireScope('workspace:read'); return result({ members: governance.members(workspace) }); }
      if (post) { requireScope('workspace:admin'); return result(governance.setMember(workspace, await body(), actor)); }
    }
    if (url.pathname === '/v1/workspace/audit' && get) { requireScope('workspace:admin'); return result({ entries: governance.audit(workspace, { limit: url.searchParams.get('limit') ?? 100 }) }); }
    if (url.pathname === '/v1/workspace/retention' && post) { requireScope('workspace:admin'); return result(governance.configureRetention(workspace, await body(), actor)); }
    if (url.pathname === '/v1/workspace/retention/preview' && get) { requireScope('workspace:admin'); return result(governance.previewRetention(workspace)); }
    if (url.pathname === '/v1/workspace/retention/apply' && post) { requireScope('workspace:admin'); return result(await governance.runRetention(workspace, await body(), actor)); }
    if ((route = match(/^\/v1\/workspace\/cases\/([A-Za-z0-9_-]+)\/access$/))) {
      requireScope('workspace:admin');
      if (get) return result(governance.caseAccess(workspace, route[1]));
      if (post) return result(governance.grantCase(workspace, route[1], await body(), actor));
    }
  }
  if (url.pathname === '/v1/agent' && get) {
    requireScope('sessions:read');
    return result({ workspace, subject: actor, registered: false, transport: 'http', status: 'adapter-ready', readTools: [{ name: 'livelens_search', description: 'Search captured statements and retain evidence receipts.', scopes: ['evidence:read'] }, { name: 'livelens_report', description: 'Reopen a source-backed investigation report.', scopes: ['cases:read', 'evidence:read'] }, { name: 'livelens_sessions', description: 'List captured sessions.', scopes: ['sessions:read'] }], controlTools: [{ name: 'livelens_start_capture', description: 'Request a configured source with an explicit duration cap.', scopes: ['recordings:write'], policy: 'independent-dispatch-grant' }, { name: 'livelens_stop_capture', description: 'Stop a selected bounded job.', scopes: ['recordings:write'], policy: 'independent-dispatch-grant' }], memoryImport: 'explicit-policy-required', modelEgress: 'separate-permission' });
  }
  return false;
}
