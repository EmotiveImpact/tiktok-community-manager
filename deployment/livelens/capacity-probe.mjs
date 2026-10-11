import { performance } from 'node:perf_hooks';
import { once } from 'node:events';
import { EvidenceStore } from '../../services/intelligence/src/store.mjs';
import { createIntelligenceServer } from '../../services/intelligence/src/server.mjs';

// Isolated synthetic read workload. Never visits a provider or existing database.
const concurrency = Number(process.argv[2] ?? 10), requests = Number(process.argv[3] ?? 200);
if (!Number.isInteger(concurrency) || concurrency < 1 || concurrency > 100 || !Number.isInteger(requests) || requests < concurrency || requests > 10_000) throw new Error('invalid_probe_bounds');
const store = new EvidenceStore(':memory:'), token = 'fixture-capacity-only-'.padEnd(43, 'x');
store.createSession('probe', { id: 'session', platform: 'fixture', title: 'Synthetic capacity probe', sourceUrl: 'https://example.invalid/probe', startedAtMs: Date.now() });
for (let batch = 0; batch < 10; batch++) store.append('probe', 'session', Array.from({ length: 100 }, (_, i) => ({ source: { adapter: 'fixture', eventId: String(batch * 100 + i) }, kind: 'chat', text: 'Measured synthetic conversation ' + i })));
const server = createIntelligenceServer({ store, keys: [{ workspace: 'probe', subject: 'probe', token, scopes: ['sessions:read', 'evidence:read', 'cases:read'] }] });
server.listen(0, '127.0.0.1'); await once(server, 'listening'); const base = 'http://127.0.0.1:' + server.address().port;
let next = 0, errors = 0; const latency = [], began = performance.now();
try {
  await Promise.all(Array.from({ length: concurrency }, async () => {
    while (next++ < requests) {
      const start = performance.now();
      try { const response = await fetch(base + '/v1/evidence/search?q=Measured&limit=50', { headers: { Authorization: 'Bearer ' + token } }); if (!response.ok) throw new Error('http_failure'); const result = await response.json(); if (result.evidence.length !== 50) throw new Error('result_count'); } catch { errors++; }
      latency.push(performance.now() - start);
    }
  }));
  const elapsedMs = performance.now() - began; latency.sort((a, b) => a - b);
  const percentile = p => Number(latency[Math.min(latency.length - 1, Math.floor(latency.length * p))].toFixed(2));
  console.log(JSON.stringify({ schemaVersion: 1, fixture: true, storage: 'SQLite-memory', evidenceCount: 1000, requestConcurrency: concurrency, requestCount: requests, errors, elapsedMs: Number(elapsedMs.toFixed(2)), requestsPerSecond: Number((requests / elapsedMs * 1000).toFixed(2)), latencyMs: { p50: percentile(.5), p95: percentile(.95), p99: percentile(.99) }, recordingConcurrency: 'not measured', speechConcurrency: 'not measured', customerCapacity: 'not established', billedCost: 'not measured' }));
} finally { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); store.close(); }
