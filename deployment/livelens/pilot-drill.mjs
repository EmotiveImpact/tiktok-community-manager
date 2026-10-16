import { fork, execFile } from 'node:child_process';
import { randomBytes, createHash } from 'node:crypto';
import { once } from 'node:events';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { cpus, totalmem, tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { monitorEventLoopDelay, performance } from 'node:perf_hooks';
import { setTimeout as delay } from 'node:timers/promises';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
import { EvidenceStore } from '../../services/intelligence/src/store.mjs';
import { Recorder } from '../../services/intelligence/src/recorder.mjs';
import { Governance } from '../../services/intelligence/src/governance.mjs';
import { InvestigationEngine } from '../../services/intelligence/src/investigations.mjs';
import { createIntelligenceServer, SCOPES } from '../../services/intelligence/src/server.mjs';
import { digest } from '../../services/intelligence/src/validation.mjs';
import { createBackup, restoreBackup } from './backup.mjs';

// Synthetic, loopback-only operational proof. This never opens an existing
// database, provider, remote bucket, browser session, model or private account.
const run = promisify(execFile);
const filename = fileURLToPath(import.meta.url);
const repository = resolve(dirname(filename), '../..');
const terminal = new Set(['completed', 'stopped', 'failed']);
const check = (value, code) => { if (!value) throw new Error(code); };
const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');
const rounded = value => Number(value.toFixed(3));
function diskBytes(path) {
  if (!existsSync(path)) return 0;
  const entry = statSync(path);
  return entry.isDirectory() ? readdirSync(path).reduce((sum, name) => sum + diskBytes(join(path, name)), 0) : entry.size;
}
function latency(values) {
  const sorted = [...values].sort((a, b) => a - b);
  const at = p => sorted.length ? rounded(sorted[Math.max(0, Math.ceil(sorted.length * p) - 1)]) : null;
  return { count: sorted.length, p50: at(.5), p95: at(.95), p99: at(.99), max: at(1) };
}
async function terminate(child) {
  if (child.exitCode !== null || child.signalCode !== null) return;
  const ended = once(child, 'exit'); child.kill('SIGTERM');
  const kill = setTimeout(() => child.kill('SIGKILL'), 5000);
  try { await ended; } finally { clearTimeout(kill); }
}
function sourcePins() {
  const files = ['package-lock.json', 'services/intelligence/package-lock.json', 'deployment/livelens/backup.mjs', 'deployment/livelens/backup_archive.py', 'deployment/livelens/pilot-drill.mjs'];
  for (const name of readdirSync(join(repository, 'services/intelligence/src')).sort()) {
    if (/\.(mjs|py)$/.test(name)) files.push('services/intelligence/src/' + name);
  }
  return Object.fromEntries(files.sort().map(path => [path, sha256(readFileSync(join(repository, path)))]));
}

async function serveFixture() {
  // Child setup arrives through a private IPC pipe, never command-line tokens.
  check(!!process.send, 'fixture_ipc_required');
  const [configuration] = await once(process, 'message');
  const { root, input, ffmpeg, keys, members } = configuration;
  const store = new EvidenceStore(join(root, 'intelligence.sqlite'));
  const recorder = new Recorder({ store, ffmpeg, mediaRoot: join(root, 'media'),
    sources: input.map((path, index) => ({ id: 'source-' + index, workspace: 'pilot', sessionId: 'session-' + index, kind: 'file', input: path, label: 'Fictional source ' + index })),
    maxConcurrent: 2, maxWorkspaceConcurrent: 2, maxWorkspacePending: 10 });
  const governance = new Governance({ store, recorder, members });
  const server = createIntelligenceServer({ store, recorder, governance, investigation: new InvestigationEngine({ store }), keys });
  server.listen(0, '127.0.0.1'); await once(server, 'listening');
  let timer, histogram, began, previous, cpuStart, closing = false;
  let samples = 0, peakRssBytes = 0, peakHeapUsedBytes = 0, peakRetainedBytes = 0;
  let peakActiveCaptures = 0, peakPendingJobs = 0, concurrentCaptureMs = 0;
  function sample() {
    const now = performance.now(), memory = process.memoryUsage();
    if (recorder.activeJobs.size === 2) concurrentCaptureMs += now - previous;
    previous = now; samples++;
    peakRssBytes = Math.max(peakRssBytes, memory.rss);
    peakHeapUsedBytes = Math.max(peakHeapUsedBytes, memory.heapUsed);
    peakActiveCaptures = Math.max(peakActiveCaptures, recorder.activeJobs.size);
    peakPendingJobs = Math.max(peakPendingJobs, store.db.prepare("SELECT count(*) AS n FROM recording_jobs WHERE state NOT IN('completed','stopped','failed')").get().n);
    if (samples % 10 === 1) peakRetainedBytes = Math.max(peakRetainedBytes, diskBytes(root));
  }
  async function stop() {
    if (closing) return; closing = true;
    clearInterval(timer); histogram?.disable();
    await recorder.close();
    server.closeAllConnections(); await new Promise(resolve => server.close(resolve));
    store.close();
  }
  process.on('disconnect', () => { void stop().finally(() => process.exit()); });
  process.on('SIGTERM', () => { void stop().finally(() => process.exit()); });
  process.on('message', async ({ id, command }) => {
    try {
      let result;
      if (command === 'begin') {
        began = previous = performance.now(); cpuStart = process.cpuUsage();
        histogram = monitorEventLoopDelay({ resolution: 20 }); histogram.enable();
        sample(); timer = setInterval(sample, 100); recorder.start(); result = { started: true };
      } else if (command === 'metrics') {
        sample(); clearInterval(timer); histogram.disable();
        const cpu = process.cpuUsage(cpuStart);
        result = { measuredMs: rounded(performance.now() - began), sampleIntervalMs: 100, samples,
          serviceProcess: { peakRssBytes, peakHeapUsedBytes, cpuUserMs: rounded(cpu.user / 1000), cpuSystemMs: rounded(cpu.system / 1000), excludes: ['load-generator process', 'FFmpeg child processes'] },
          eventLoopDelayMs: { resolutionMs: 20, p50: rounded(histogram.percentile(50) / 1e6), p95: rounded(histogram.percentile(95) / 1e6), p99: rounded(histogram.percentile(99) / 1e6), max: rounded(histogram.max / 1e6) },
          peakActiveCaptures, peakPendingJobs, concurrentCaptureMs: rounded(concurrentCaptureMs),
          disk: { sampledEveryMs: 1000, peakRetainedBytes: Math.max(peakRetainedBytes, diskBytes(root)), finalDatabaseBytes: diskBytes(join(root, 'intelligence.sqlite')), finalWalBytes: diskBytes(join(root, 'intelligence.sqlite-wal')), finalMediaBytes: diskBytes(join(root, 'media')) } };
      } else if (command === 'audit') result = governance.verifyAudit('pilot');
      else if (command === 'stop') { await stop(); result = { stopped: true }; }
      else throw new Error('unknown_fixture_command');
      process.send({ id, result }, () => { if (command === 'stop') process.exit(); });
    } catch (error) {
      process.send({ id, error: /^[a-z][a-z0-9_]+$/.test(error.message) ? error.message : 'fixture_command_failed' });
    }
  });
  process.send({ ready: true, base: 'http://127.0.0.1:' + server.address().port });
}

async function startFixture(configuration) {
  const child = fork(filename, ['--serve'], { stdio: ['ignore', 'ignore', 'ignore', 'ipc'] });
  const pending = new Map(); let next = 0, readyResolve, readyReject;
  const ready = new Promise((resolve, reject) => { readyResolve = resolve; readyReject = reject; });
  child.on('message', message => {
    if (message.ready) return readyResolve(message.base);
    const waiting = pending.get(message.id); if (!waiting) return;
    pending.delete(message.id); clearTimeout(waiting.timer);
    if (message.error) waiting.reject(new Error(message.error)); else waiting.resolve(message.result);
  });
  child.on('error', () => readyReject(new Error('fixture_process_unavailable')));
  child.on('exit', () => {
    readyReject(new Error('fixture_process_exited'));
    for (const waiting of pending.values()) { clearTimeout(waiting.timer); waiting.reject(new Error('fixture_process_exited')); }
    pending.clear();
  });
  child.send(configuration);
  const startup = setTimeout(() => readyReject(new Error('fixture_start_timeout')), 10_000);
  let base;
  try { base = await ready; } catch (error) { await terminate(child); throw error; } finally { clearTimeout(startup); }
  const command = command => new Promise((resolve, reject) => {
    const id = ++next, timer = setTimeout(() => { pending.delete(id); reject(new Error('fixture_command_timeout')); }, 15_000);
    pending.set(id, { resolve, reject, timer }); child.send({ id, command });
  });
  return { base, command, async close() {
    if (child.exitCode !== null || child.signalCode !== null) return;
    const ended = once(child, 'exit');
    try { await command('stop'); } catch { child.kill('SIGTERM'); }
    const kill = setTimeout(() => child.kill('SIGKILL'), 5000);
    try { await ended; } finally { clearTimeout(kill); }
  } };
}

function options(args) {
  const result = { durationSeconds: 12, concurrency: 6, requests: 600, seedEvents: 2000, ffmpeg: process.env.LIVELENS_FFMPEG_PATH ?? '/usr/bin/ffmpeg' };
  const names = { '--output': 'output', '--duration': 'durationSeconds', '--concurrency': 'concurrency', '--requests': 'requests', '--events': 'seedEvents', '--ffmpeg': 'ffmpeg' };
  for (let i = 0; i < args.length; i += 2) {
    check(names[args[i]] && args[i + 1], 'use_output_duration_concurrency_requests_events_ffmpeg');
    result[names[args[i]]] = ['--output', '--ffmpeg'].includes(args[i]) ? args[i + 1] : Number(args[i + 1]);
  }
  check(typeof result.output === 'string', 'explicit_output_required'); result.output = resolve(result.output); result.ffmpeg = resolve(result.ffmpeg);
  check(!existsSync(result.output), 'receipt_destination_exists');
  for (const [key, min, max] of [['durationSeconds', 8, 120], ['concurrency', 1, 32], ['requests', 20, 20_000], ['seedEvents', 200, 20_000]]) {
    check(Number.isSafeInteger(result[key]) && result[key] >= min && result[key] <= max, 'invalid_' + key.toLowerCase());
  }
  check(result.requests >= result.concurrency * 2, 'insufficient_requests_for_concurrency');
  return result;
}

async function main(settings) {
  const directory = mkdtempSync(join(tmpdir(), 'livelens-pilot-drill-'));
  const root = join(directory, 'original'), restored = join(directory, 'restored'); mkdirSync(root, { mode: 0o700 });
  const input = [0, 1].map(index => join(directory, 'fictional-source-' + index + '.mp4'));
  const names = ['owner', 'collector', 'analyst', 'reader', 'foreign', 'limited'];
  const tokens = Object.fromEntries(names.map(name => [name, randomBytes(32).toString('base64url')]));
  const readScopes = SCOPES.filter(scope => scope.endsWith(':read'));
  const keys = names.map(subject => ({ subject, token: tokens[subject], workspace: subject === 'foreign' ? 'other' : 'pilot', scopes:
    subject === 'limited' ? ['sessions:read'] : subject === 'reader' ? readScopes : subject === 'collector' ? ['sessions:read', 'sessions:write', 'evidence:read', 'evidence:write'] : subject === 'analyst' ? [...readScopes, 'cases:write', 'investigations:write'] : SCOPES }));
  const members = keys.map(({ subject, workspace }) => ({ subject, workspace, role: ['owner', 'foreign'].includes(subject) ? 'owner' : subject === 'reader' ? 'viewer' : 'analyst' }));
  const configuration = { root, input, ffmpeg: settings.ffmpeg, keys, members };
  const acknowledged = new Map();
  function remember(result, values) {
    check(result.results.length === values.length, 'append_result_mismatch');
    for (let index = 0; index < values.length; index++) {
      const row = result.results[index], value = values[index];
      check(row.inserted === true && row.evidence.text === value.text && row.evidence.source.eventId === value.source.eventId && row.evidence.sourceTimestampMs === value.sourceTimestampMs && row.evidence.capturedAtMs === value.capturedAtMs, 'acknowledged_original_mismatch');
      acknowledged.set(row.evidence.id, digest(row.evidence));
    }
  }
  const receipt = { schemaVersion: 1, fixture: true, startedAt: new Date().toISOString(), status: 'running',
    workload: { storage: 'SQLite file with WAL and synchronous FULL', transport: 'actual loopback HTTP bearer API', serviceProcess: 'separate child process', durationSeconds: settings.durationSeconds, requestConcurrency: settings.concurrency, requestCount: settings.requests, seededEvidence: settings.seedEvents, workspaceCount: 2, principalCount: keys.length, workloadPrincipalCount: 3, recordingConcurrency: 2, recordingCapSeconds: settings.durationSeconds + 4, requestTimeoutMs: 5000, workloadDeadlineSeconds: settings.durationSeconds + 30, pacing: 'concurrent client waves evenly scheduled over duration; no retries', mix: ['nominal 20% append two original events', 'nominal 20% literal evidence search', 'nominal 20% session listing', 'nominal 20% reviewed investigation detail', 'nominal 20% recording receipts'], scheduledTasks: false },
    runtime: { node: process.version, platform: process.platform, architecture: process.arch, visibleLogicalCpus: cpus().length, visibleMemoryBytes: totalmem() },
    sourceSha256: sourcePins(),
    boundaries: { provider: 'none; generated distinct bars/tone files', customerCapacity: 'not established', liveSourceQuality: 'not measured', speechConcurrency: 'not measured', browserUserLoad: 'not measured', externalStorage: 'not measured', postgresRecovery: 'not measured', distributedQueue: 'not measured', billedCost: 'not measured', longDurationSoak: 'not measured' } };
  let fixture;
  const raw = async (path, { actor = 'owner', method = 'GET', body } = {}) => fetch(fixture.base + path, {
    method, headers: { ...(actor ? { Authorization: 'Bearer ' + tokens[actor] } : {}), ...(body === undefined ? {} : { 'Content-Type': 'application/json' }) },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }), signal: AbortSignal.timeout(5000) });
  const request = async (path, { expected = 200, ...parameters } = {}) => {
    const response = await raw(path, parameters), value = await response.json();
    check(response.status === expected, 'unexpected_http_' + response.status);
    return value;
  };
  const post = (path, body, expected = 201, actor = 'owner') => request(path, { body, method: 'POST', expected, actor });
  async function isolation() {
    const checks = [];
    for (const [label, path, parameters] of [
      ['anonymous_refused', '/v1/sessions', { actor: null, expected: 401 }],
      ['other_workspace_case_refused', '/v1/investigations/pilot-case', { actor: 'foreign', expected: 404 }],
      ['other_workspace_recording_refused', '/v1/jobs/capture-0', { actor: 'foreign', expected: 404 }],
      ['unconfigured_read_scope_refused', '/v1/evidence/search?q=Fictional', { actor: 'limited', expected: 403 }],
      ['unconfigured_write_scope_refused', '/v1/sessions/session-0/events', { actor: 'reader', expected: 403, method: 'POST', body: { events: [] } }],
    ]) { await request(path, parameters); checks.push(label); }
    check((await request('/v1/evidence/search?q=Fictional', { actor: 'foreign' })).evidence.length === 0, 'other_workspace_search_leaked');
    checks.push('other_workspace_search_empty'); return checks;
  }
  async function snapshot() {
    const events = [];
    for (let index = 0; index < 2; index++) {
      let after = 0;
      while (true) {
        const page = await request(`/v1/sessions/session-${index}/events?after=${after}&limit=200`);
        events.push(...page.events); if (!page.events.length) break; after = page.nextAfter;
      }
    }
    const detail = await request('/v1/investigations/pilot-case');
    const report = await request('/v1/investigations/pilot-case/report?format=json');
    const { reportSha256, ...exported } = report; check(reportSha256 === digest(exported), 'export_hash_invalid');
    // A newly generated export necessarily has a new timestamp and derived
    // digest. Compare every persisted field and source receipt, not that clock.
    delete exported.generatedAtMs; delete exported.manifest.originalReportSha256;
    return { events, detail, reportContent: exported, editor: await request('/v1/investigations/pilot-case/report'), bookmarks: await request('/v1/bookmarks?limit=200'),
      access: await request('/v1/workspace/cases/pilot-case/access'), audit: await request('/v1/workspace/audit?limit=200'), auditIntegrity: await fixture.command('audit'),
      sessionIntegrity: await Promise.all([0, 1].map(index => request(`/v1/sessions/session-${index}/integrity`))),
      jobs: await request('/v1/jobs?limit=100') };
  }
  try {
    receipt.runtime.ffmpegVersion = (await run(settings.ffmpeg, ['-version'], { timeout: 5000 })).stdout.split('\n')[0];
    receipt.runtime.ffmpegExecutableSha256 = sha256(readFileSync(settings.ffmpeg));
    for (let index = 0; index < 2; index++) await run(settings.ffmpeg, ['-v', 'error', '-f', 'lavfi', '-i', index ? 'smptebars=size=160x90:rate=10' : 'testsrc2=size=160x90:rate=10', '-f', 'lavfi', '-i', `sine=frequency=${440 + index * 220}:sample_rate=44100`, '-t', String(settings.durationSeconds + 6), '-c:v', 'libx264', '-threads', '1', '-pix_fmt', 'yuv420p', '-g', '20', '-c:a', 'aac', input[index]], { timeout: 60_000 });
    receipt.generatedSourceSha256 = input.map(path => sha256(readFileSync(path)));
    check(receipt.generatedSourceSha256[0] !== receipt.generatedSourceSha256[1], 'fixture_sources_must_differ');
    fixture = await startFixture(configuration);
    const at = Date.now();
    for (let index = 0; index < 2; index++) await post('/v1/sessions', { id: 'session-' + index, platform: 'fixture', account: 'fictional_host_' + index, title: 'Fictional pilot source ' + index, sourceUrl: 'https://example.invalid/pilot/' + index, startedAtMs: at }, 201, 'collector');
    const originals = [];
    for (let begin = 0; begin < settings.seedEvents; begin += 200) {
      const values = Array.from({ length: Math.min(200, settings.seedEvents - begin) }, (_, offset) => ({ source: { adapter: 'pilot_fixture', eventId: 'seed-' + (begin + offset) }, kind: 'chat', account: 'fictional_viewer_' + (offset % 3), text: 'Fictional retained statement ' + (begin + offset) + ': compare the original with its surrounding context.', sourceTimestampMs: offset % 2 ? null : at + begin + offset, capturedAtMs: at + begin + offset + 5 }));
      const result = await post('/v1/sessions/session-' + ((begin / 200) % 2) + '/events', { events: values }, 200, 'collector');
      remember(result, values);
      if (!originals.length) originals.push(result.results[0].evidence, result.results[1].evidence);
    }
    const [claim, counter] = originals;
    await post('/v1/cases', { id: 'pilot-case', title: 'Fictional pilot recovery investigation', question: 'Can the reviewed original and challenge be recovered intact?', evidenceIds: [claim.id, counter.id] });
    await post('/v1/investigations/pilot-case/notes', { text: 'Read this fictional original alongside its conflicting explanation.', evidenceIds: [claim.id, counter.id] }, 201, 'analyst');
    await post('/v1/bookmarks', { evidenceId: claim.id, label: 'Fictional recovery bookmark' }, 201, 'analyst');
    const finding = await post('/v1/investigations/pilot-case/findings', { id: 'reviewed-finding', title: 'Context changes interpretation', statement: 'The fictional source contains a claim and a challenge.', supportEvidenceIds: [claim.id], counterEvidenceIds: [counter.id], topic: 'recovery' }, 201, 'analyst');
    await post('/v1/investigations/pilot-case/findings/reviewed-finding/review', { status: 'reviewed', reason: 'Checked both source statements in this fixture.', expectedRevision: finding.revision });
    await post('/v1/investigations/pilot-case/report', { title: 'Reviewed fictional recovery brief', summary: 'The source-backed review and redactions must survive a complete restore.', redactions: [{ evidenceId: claim.id, text: true, account: true, reason: 'Fictional share-copy redaction.' }], reason: 'First reviewed fixture edition.', expectedRevision: 0 });
    await post('/v1/workspace/cases/pilot-case/access', { visibility: 'restricted', reason: 'Fixture private case.' });
    await post('/v1/workspace/cases/pilot-case/access', { subject: 'analyst', permission: 'write', reason: 'Fixture investigator.' });
    for (let index = 0; index < 2; index++) await post('/v1/jobs', { id: 'capture-' + index, sessionId: 'session-' + index, sourceId: 'source-' + index, maxDurationSeconds: settings.durationSeconds + 4, segmentSeconds: 2 });
    receipt.accessBeforeRestore = await isolation();
    await request('/v1/investigations/pilot-case', { actor: 'reader', expected: 403 });
    receipt.accessBeforeRestore.push('restricted_case_reader_refused');

    await fixture.command('begin');
    const timings = [], buckets = {}, errors = {}, started = performance.now();
    let successfulWrites = 0, inFlight = 0, peakInFlight = 0;
    const work = await Promise.allSettled(Array.from({ length: settings.concurrency }, async (_, worker) => {
      for (let index = worker; index < settings.requests; index += settings.concurrency) {
        const due = started + Math.floor(index / settings.concurrency) * settings.durationSeconds * 1000 / Math.ceil(settings.requests / settings.concurrency);
        if (due > performance.now()) await delay(due - performance.now());
        check(performance.now() - started < (settings.durationSeconds + 30) * 1000, 'workload_deadline_exceeded');
        const kind = ['append', 'search', 'sessions', 'investigation', 'recordings'][index % 5];
        const before = performance.now();
        inFlight++; peakInFlight = Math.max(peakInFlight, inFlight);
        try {
          if (kind === 'append') {
            const values = [0, 1].map(offset => ({ source: { adapter: 'pilot_workload', eventId: `request-${index}-${offset}` }, kind: 'chat', account: 'fictional_live_viewer', text: `Fictional mixed workload request ${index} statement ${offset}.`, sourceTimestampMs: null, capturedAtMs: Date.now() }));
            const result = await post(`/v1/sessions/session-${index % 2}/events`, { events: values }, 200, 'collector');
            remember(result, values); successfulWrites += 2;
          } else if (kind === 'search') check((await request('/v1/evidence/search?q=Fictional&limit=50', { actor: 'reader' })).evidence.length === 50, 'search_result_mismatch');
          else if (kind === 'sessions') check((await request('/v1/sessions?limit=50', { actor: 'reader' })).sessions.length === 2, 'session_result_mismatch');
          else if (kind === 'investigation') check((await request('/v1/investigations/pilot-case', { actor: 'analyst' })).findings[0].status === 'reviewed', 'review_result_mismatch');
          else check((await request('/v1/jobs?limit=50', { actor: 'reader' })).jobs.length === 2, 'recording_result_mismatch');
        } catch (error) { const code = /^[a-z][a-z0-9_]+$/.test(error.message) ? error.message : 'request_or_assertion_failed'; errors[code] = (errors[code] ?? 0) + 1; }
        inFlight--;
        const elapsed = performance.now() - before; timings.push(elapsed); (buckets[kind] ??= []).push(elapsed);
      }
    }));
    for (const result of work) if (result.status === 'rejected') errors.workload_deadline_exceeded = (errors.workload_deadline_exceeded ?? 0) + 1;
    const elapsedMs = performance.now() - started;
    receipt.load = { elapsedMs: rounded(elapsedMs), completedRequests: timings.length, peakInFlightRequests: peakInFlight, errors: Object.values(errors).reduce((a, b) => a + b, 0), errorCodes: errors, successfulAppendedEvents: successfulWrites, requestsPerSecond: rounded(timings.length / elapsedMs * 1000), latencyMs: latency(timings), byOperationLatencyMs: Object.fromEntries(Object.entries(buckets).map(([kind, values]) => [kind, latency(values)])), server: await fixture.command('metrics') };
    check(receipt.load.errors === 0, 'mixed_workload_failed');
    check(receipt.load.server.peakActiveCaptures === 2 && receipt.load.server.concurrentCaptureMs > 1000, 'concurrent_recording_not_observed');
    const deadline = Date.now() + 20_000; let jobs;
    do { jobs = (await request('/v1/jobs')).jobs; if (jobs.every(job => terminal.has(job.state))) break; await delay(200); } while (Date.now() < deadline);
    check(jobs.length === 2 && jobs.every(job => job.state === 'completed' && job.segments.length >= 2), 'recording_completion_failed');
    check(jobs.every(job => job.sessionId === 'session-' + job.id.slice(-1)), 'recording_session_mismatch');
    check(!jobs[0].segments.some(first => jobs[1].segments.some(second => first.sha256 === second.sha256)), 'recording_sources_mixed');
    const before = await snapshot();
    check(before.events.filter(event => event.source.adapter === 'pilot_workload').length === successfulWrites, 'persisted_write_count_mismatch');
    check(before.events.filter(event => event.source.adapter === 'pilot_fixture').length === settings.seedEvents, 'seed_count_mismatch');
    let matchedAcknowledged = 0;
    for (const event of before.events) if (acknowledged.has(event.id)) { check(digest(event) === acknowledged.get(event.id), 'persisted_acknowledged_event_changed'); matchedAcknowledged++; }
    check(matchedAcknowledged === acknowledged.size, 'acknowledged_event_missing');
    check(before.reportContent.evidence.find(event => event.id === claim.id).text === '[Text redacted in this report copy]', 'redaction_missing');
    check(!JSON.stringify(before.reportContent).includes(claim.text), 'redacted_text_leaked');
    const recoveryPointAt = new Date().toISOString();
    await fixture.close(); fixture = null;
    const key = randomBytes(32).toString('base64url'), archive = join(directory, 'sealed.llbackup');
    let began = performance.now(); const backup = await createBackup({ databasePath: join(root, 'intelligence.sqlite'), mediaRoot: join(root, 'media'), outputPath: archive, key }); const backupMs = performance.now() - began;
    // Only this command's unique temporary originals are removed. Recovery
    // must stand on the sealed archive, not accidentally reopen the old files.
    rmSync(root, { recursive: true, force: true });
    for (const path of input) rmSync(path);
    began = performance.now(); const restoredReceipt = await restoreBackup({ inputPath: archive, destination: restored, key }); const restoreMs = performance.now() - began;
    began = performance.now(); fixture = await startFixture({ ...configuration, root: restored, input: [] });
    const after = await snapshot();
    for (const category of Object.keys(before)) check(digest(before[category]) === digest(after[category]), 'recovery_mismatch_' + category.toLowerCase());
    receipt.accessAfterRestore = await isolation();
    await request('/v1/investigations/pilot-case', { actor: 'reader', expected: 403 });
    receipt.accessAfterRestore.push('restricted_case_reader_refused');
    const media = [];
    for (const job of after.jobs.jobs) for (const segment of job.segments) {
      const response = await raw(`/v1/media/${job.id}/${segment.id}`); check(response.status === 200, 'restored_media_unavailable');
      const bytes = Buffer.from(await response.arrayBuffer()); check(bytes.length === segment.bytes && sha256(bytes) === segment.sha256, 'restored_http_media_hash_mismatch');
      const path = join(directory, 'decode-' + media.length + '.mp4'); writeFileSync(path, bytes, { mode: 0o600 });
      const decoded = await run(settings.ffmpeg, ['-v', 'error', '-nostats', '-i', path, '-map', '0:v:0', '-map', '0:a:0', '-progress', 'pipe:1', '-f', 'null', '-'], { timeout: 15_000 }); rmSync(path);
      const decodedDurationMs = Number([...decoded.stdout.matchAll(/^out_time_us=(\d+)$/gm)].at(-1)?.[1] ?? 0) / 1000;
      const decodedVideoFrames = Number([...decoded.stdout.matchAll(/^frame=(\d+)$/gm)].at(-1)?.[1] ?? 0);
      check(decoded.stderr.trim() === '' && decodedDurationMs > 0 && decodedVideoFrames > 0 && decoded.stdout.includes('progress=end'), 'restored_media_decode_failed');
      media.push({ jobId: job.id, sessionId: job.sessionId, segmentId: segment.id, bytes: bytes.length, sha256: segment.sha256, decoded: true, receiptDurationMs: segment.durationMs, decodedDurationMs, decodedVideoFrames });
    }
    const reopenAndVerifyMs = performance.now() - began;
    receipt.recovery = { recoveryPointAt, boundary: 'all acknowledged fixture writes and terminal recordings; writers and recorder stopped before snapshot', unacknowledgedOrInFlightLoss: 'not exercised; this is a quiesced backup restore, not crash RPO', backupMs: rounded(backupMs), restoreMs: rounded(restoreMs), reopenAndVerifyMs: rounded(reopenAndVerifyMs), totalRestoreAndVerificationMs: rounded(restoreMs + reopenAndVerifyMs), backup, restore: restoredReceipt,
      originalDatabaseRetainedDuringCheck: false, originalDatabaseMediaAndGeneratedInputsRemovedBeforeRestore: !existsSync(root) && input.every(path => !existsSync(path)), target: 'new directory and fresh API process without capture sources', restoredDatabaseBytes: diskBytes(join(restored, 'intelligence.sqlite')), comparedCategories: Object.keys(before), preservedCategorySha256: Object.fromEntries(Object.entries(before).map(([name, value]) => [name, digest(value)])), originalEvents: before.events.length, acknowledgedWorkloadEvents: successfulWrites, reportComparisonExclusions: ['generatedAtMs', 'reportSha256 (each full export verified independently)', 'manifest.originalReportSha256 (includes export-generation timestamp)'], media };
    check(media.length === backup.mediaVerified && media.length === restoredReceipt.mediaVerified, 'restored_media_count_mismatch');
    receipt.sourceFilesUnchangedDuringRun = digest(receipt.sourceSha256) === digest(sourcePins());
    check(receipt.sourceFilesUnchangedDuringRun, 'source_changed_during_drill');
    receipt.status = 'passed';
  } catch (error) {
    receipt.status = 'failed'; receipt.failure = /^[a-z][a-z0-9_]+$/.test(error.message) ? error.message : 'pilot_drill_failed';
    process.exitCode = 1;
  } finally {
    let fixtureProcessesStopped = true;
    try { await fixture?.close(); } catch { fixtureProcessesStopped = false; receipt.status = 'failed'; receipt.failure = 'fixture_cleanup_failed'; process.exitCode = 1; }
    finally { rmSync(directory, { recursive: true, force: true }); }
    receipt.cleanup = { fixtureProcessesStopped, temporaryDatabaseMediaAndEncryptedArchiveRemoved: !existsSync(directory), credentials: 'ephemeral process memory only; omitted from receipt', backupKey: 'ephemeral process memory only; omitted from receipt' };
    receipt.finishedAt = new Date().toISOString();
    mkdirSync(dirname(settings.output), { recursive: true }); writeFileSync(settings.output, JSON.stringify(receipt, null, 2) + '\n', { mode: 0o600, flag: 'wx' });
    console.log(JSON.stringify({ status: receipt.status, requests: receipt.load?.completedRequests ?? 0, errors: receipt.load?.errors ?? null, restoredSegments: receipt.recovery?.media.length ?? 0, failure: receipt.failure ?? null }));
  }
}

if (process.argv[2] === '--serve') {
  serveFixture().catch(() => { process.exitCode = 1; process.disconnect?.(); });
} else {
  try { await main(options(process.argv.slice(2))); }
  catch (error) { console.error(/^[a-z][a-z0-9_]+$/.test(error.message) ? error.message : 'pilot_drill_failed'); process.exitCode = 1; }
}
