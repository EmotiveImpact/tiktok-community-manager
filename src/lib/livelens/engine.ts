/**
 * LiveLens v0.1: evidence-first conversation timeline.
 *
 * This is a deliberately small, pure domain module. It combines the existing
 * TikTok event feed with host-provided captions without inventing speaker
 * identities or asserting that temporally adjacent chat is a direct reply.
 * A future VPS worker and speech-to-text adapter will emit the same event shape.
 */
import type { LiveEvent } from '../../types';

export type FeedItem = LiveEvent & { id: string };
export type EvidenceKind = 'chat' | 'caption';
export type Attribution = 'platform-chat' | 'operator' | 'unknown';

export type EvidenceRow = {
  id: string;
  kind: EvidenceKind;
  room: string;
  /** Original platform/event clock, never overwritten. */
  sourceTs: number;
  /** Aligned UTC clock, in milliseconds. */
  ts: number;
  text: string;
  username: string | null;
  attribution: Attribution;
  source: 'tiktok-chat' | 'tiktok-caption';
  /** Raw ID retained to trace to source event. */
  sourceId: string;
};

export type TimelineOptions = {
  /** Corrects latency differences; applied ONLY to captions, not original sourceTs. */
  captionOffsetMs?: number;
  /** Exact evidence-row ID -> manually asserted TikTok handle. */
  manualCaptionAttribution?: Record<string, string>;
};

export function normaliseHandle(handle: string): string {
  return String(handle ?? '').trim().replace(/^@+/, '').toLowerCase();
}

function plainText(s: unknown): string {
  return String(s ?? '').replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim();
}

export function buildTimeline(
  roomHandle: string,
  comments: FeedItem[],
  captions: FeedItem[],
  options: TimelineOptions = {},
): EvidenceRow[] {
  const room = normaliseHandle(roomHandle);
  const offset = Number.isFinite(options.captionOffsetMs) ? options.captionOffsetMs! : 0;
  const attribution = options.manualCaptionAttribution ?? {};
  const rows = new Map<string, EvidenceRow>();

  for (const entry of comments) {
    if (entry.type !== 'chat' || !Number.isFinite(entry.ts)) continue;
    const id = room + ':chat:' + entry.id;
    rows.set(id, {
      id, kind: 'chat', room, sourceTs: entry.ts, ts: entry.ts,
      sourceId: entry.id, source: 'tiktok-chat',
      text: plainText(entry.comment),
      username: normaliseHandle(entry.user?.uniqueId ?? '') || null,
      attribution: 'platform-chat',
    });
  }
  for (const entry of captions) {
    if (entry.type !== 'caption' || !entry.definite || !Number.isFinite(entry.ts)) continue;
    const id = room + ':caption:' + entry.id;
    const asserted = normaliseHandle(attribution[id] ?? '');
    rows.set(id, {
      id, kind: 'caption', room, sourceTs: entry.ts, ts: entry.ts + offset,
      sourceId: entry.id, source: 'tiktok-caption',
      text: plainText(entry.text),
      username: asserted || null,
      attribution: asserted ? 'operator' : 'unknown',
    });
  }
  return [...rows.values()].sort(
    (a, b) => a.ts - b.ts || a.kind.localeCompare(b.kind) || a.id.localeCompare(b.id),
  );
}

/**
 * Returns chat messages immediately PRECEDING a spoken segment in the same room.
 * Temporal adjacency is NOT evidence that a speaker responded to a comment.
 */
export function nearbyChat(
  rows: EvidenceRow[],
  captionId: string,
  windowMs = 45_000,
): EvidenceRow[] {
  const selected = rows.find((r) => r.id === captionId && r.kind === 'caption');
  if (!selected) return [];
  const window = Math.max(0, Math.min(5 * 60_000, windowMs));
  return rows.filter(
    (r) => r.kind === 'chat' && r.room === selected.room &&
      r.ts <= selected.ts && selected.ts - r.ts <= window,
  );
}

export function searchEvidence(
  rows: EvidenceRow[],
  query: string,
  kind: 'all' | EvidenceKind = 'all',
): EvidenceRow[] {
  const q = query.trim().toLowerCase();
  return rows.filter((r) =>
    (kind === 'all' || r.kind === kind) &&
    (!q || r.text.toLowerCase().includes(q) || (r.username ?? '').includes(q)),
  );
}

function stamp(ts: number): string {
  return new Date(ts).toISOString().replace('T', ' ').replace('.000Z', 'Z');
}
function quote(text: string): string {
  // Prevent a comment from silently injecting extra report headings/claims.
  return plainText(text).replace(/[\\*_\[\]~|]/g, '\\$&');
}

export type EvidenceReport = {
  schemaVersion: 1;
  room: string;
  title: string;
  generatedAt: number;
  count: number;
  comments: number;
  captions: number;
  attributedCaptions: number;
  rows: EvidenceRow[];
  limitations: string[];
};

export function createEvidenceReport(
  roomHandle: string,
  title: string,
  timeline: EvidenceRow[],
  generatedAt = Date.now(),
): EvidenceReport {
  const room = normaliseHandle(roomHandle);
  const rows = timeline.filter((r) => r.room === room).slice().sort((a, b) => a.ts - b.ts);
  return {
    schemaVersion: 1,
    room,
    title: plainText(title),
    generatedAt,
    count: rows.length,
    comments: rows.filter((r) => r.kind === 'chat').length,
    captions: rows.filter((r) => r.kind === 'caption').length,
    attributedCaptions: rows.filter((r) => r.kind === 'caption' && r.attribution === 'operator').length,
    rows,
    limitations: [
      'TikTok captions are only available when the broadcaster enables them; this version does not independently transcribe audio.',
      'A caption is not automatically attributed to the LIVE host or any guest.',
      'Manually attributed captions are operator assertions, not biometric identification.',
      'Temporal proximity between chat and speech does not prove that one prompted the other.',
      'This report covers only events actually captured by the connected client; gaps may exist.',
    ],
  };
}

export function reportMarkdown(report: EvidenceReport): string {
  const lines = [
    '# LiveLens session evidence',
    '',
    'Room: @' + report.room,
    'Title: ' + (report.title || '(not supplied)'),
    'Report generated: ' + stamp(report.generatedAt),
    'Captured events: ' + report.count + ' (' + report.comments + ' chat, ' + report.captions + ' captions)',
    '',
    '## Evidence timeline',
  ];
  if (!report.rows.length) lines.push('', 'No chat or caption events were captured.');
  for (const row of report.rows) {
    const person = row.username
      ? '@' + row.username + (row.attribution === 'operator' ? ' [operator attributed]' : '')
      : 'Unattributed speaker';
    lines.push(
      '',
      '- ' + stamp(row.ts) + ' | ' + row.kind + ' | ' + person +
      ' | ' + quote(row.text) + ' | Evidence ID: ' + row.id +
      ' | Original timestamp: ' + stamp(row.sourceTs),
    );
  }
  lines.push('', '## Scope and limitations');
  for (const limitation of report.limitations) lines.push('- ' + limitation);
  return lines.join('\n') + '\n';
}
