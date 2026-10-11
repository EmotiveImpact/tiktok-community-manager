import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { EvidenceStore, reportMarkdown } from '../src/store.mjs';

const directory = mkdtempSync(join(tmpdir(), 'livelens-demo-'));
const path = join(directory, 'evidence.sqlite');
const now = 1_791_657_600_000;
let store = new EvidenceStore(path, { now: () => now });
try {
  // Entirely fictional fixtures. No account connection or live capture occurs.
  const session = store.createSession('demo', { id: 'synthetic-room', platform: 'fixture', account: 'fictional_host', sourceUrl: 'https://example.invalid/synthetic-live', title: 'Synthetic product discussion', startedAtMs: now });
  const results = store.append('demo', session.id, [
    { source: { adapter: 'fixture-chat', eventId: 'chat-1' }, kind: 'chat', text: 'Can we see the supporting evidence?', account: 'fictional_viewer', sourceTimestampMs: now + 1000 },
    { source: { adapter: 'fixture-speech', eventId: 'speech-1' }, kind: 'transcript', text: 'The report should link every quotation to its source.', speakerId: 'speaker-1', sourceTimestampMs: now + 4000 },
  ]);
  store.createCase('demo', { id: 'synthetic-case', title: 'Synthetic conversation review', question: 'What was said about evidence?' }, 'demo-operator');
  store.linkEvidence('demo', 'synthetic-case', results.map(result => result.evidence.id), 'demo-operator');
  store.close();
  store = new EvidenceStore(path, { now: () => now });
  const report = store.report('demo', 'synthetic-case');
  console.log(reportMarkdown(report));
  console.log(JSON.stringify({ persistedAcrossRestart: report.evidence.length === 2, integrity: store.verify('demo', session.id), synthetic: true }));
} finally { store.close(); rmSync(directory, { recursive: true, force: true }); }
