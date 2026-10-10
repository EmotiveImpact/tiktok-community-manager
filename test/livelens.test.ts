import { describe, expect, it } from 'vitest';
import {
  buildTimeline, createEvidenceReport, nearbyChat, normaliseHandle,
  reportMarkdown, searchEvidence, type FeedItem,
} from '../src/lib/livelens/engine';

const base = Date.parse('2026-10-10T18:00:00Z');
const user = (id: string) => ({ uniqueId: id, nickname: id, profilePictureUrl: null });
const chat = (id: string, offset: number, account: string, comment: string) =>
  ({ id, ts: base + offset, type: 'chat', user: user(account), comment }) as FeedItem;
const caption = (id: string, offset: number, text: string, definite = true) =>
  ({
    id, ts: base + offset, type: 'caption', lang: 'en', sentenceId: id,
    text, definite, durationMs: 4000,
  }) as FeedItem;

describe('LiveLens evidence timeline', () => {
  it('normalises a handle without inventing another identity', () => {
    expect(normaliseHandle(' @Host_Name ')).toBe('host_name');
  });
  it('interleaves chat and captions chronologically and retains original source IDs', () => {
    const rows = buildTimeline('@Host', [chat('c2', 5000, 'bob', 'Second') , chat('c1', 1000, 'ann', 'First')],
      [caption('s1', 3000, 'Spoken')]);
    expect(rows.map((r) => r.text)).toEqual(['First', 'Spoken', 'Second']);
    expect(rows[1].sourceId).toBe('s1');
    expect(rows[1].sourceTs).toBe(base + 3000);
    expect(rows[0].username).toBe('ann');
  });
  it('never assumes TikTok captions belong to the host or guest', () => {
    const rows = buildTimeline('host', [], [caption('s1', 100, 'Not necessarily host speech')]);
    expect(rows[0].username).toBeNull();
    expect(rows[0].attribution).toBe('unknown');
  });
  it('marks manual attributions explicitly, without claiming biometric certainty', () => {
    const original = buildTimeline('host', [], [caption('s1', 0, 'Hello')]);
    const revised = buildTimeline('host', [], [caption('s1', 0, 'Hello')], {
      manualCaptionAttribution: { [original[0].id]: '@GuestOne' },
    });
    expect(revised[0].username).toBe('guestone');
    expect(revised[0].attribution).toBe('operator');
  });
  it('applies calibration only to aligned timestamps, leaving originals untouched', () => {
    const rows = buildTimeline('host', [chat('c1', 2000, 'ann', 'Hi')], [caption('s1', 1000, 'Speech')],
      { captionOffsetMs: 3000 });
    expect(rows[1].ts).toBe(base + 4000);
    expect(rows[1].sourceTs).toBe(base + 1000);
    expect(rows[0].ts).toBe(base + 2000);
  });
  it('removes duplicate IDs within one feed and excludes unfinalised captions', () => {
    const same = chat('c1', 1000, 'ann', 'Hello');
    const rows = buildTimeline('host', [same, same], [caption('s1', 2000, 'Draft', false)]);
    expect(rows).toHaveLength(1);
    expect(rows[0].kind).toBe('chat');
  });
  it('finds only preceding chat in the same room within an explicit window', () => {
    const rows = buildTimeline('host', [
      chat('old', -60000, 'ann', 'Old'),
      chat('recent', -15000, 'ann', 'Recent'),
      chat('future', 1000, 'ann', 'Future'),
    ], [caption('s1', 0, 'Response')]);
    expect(nearbyChat(rows, 'host:caption:s1').map((r) => r.text)).toEqual(['Recent']);
  });
  it('supports filtering by channel, text and chat account', () => {
    const rows = buildTimeline('host', [chat('c1', 0, 'CreatorJames', 'University')], [caption('s1', 1000, 'Careers')]);
    expect(searchEvidence(rows, 'james', 'chat')).toHaveLength(1);
    expect(searchEvidence(rows, 'university', 'caption')).toHaveLength(0);
    expect(searchEvidence(rows, 'careers')).toHaveLength(1);
  });
  it('produces a source-linked report stating the limitations of speaker evidence', () => {
    const rows = buildTimeline('host', [chat('c1', 0, 'ann', 'What about uni?')], [caption('s1', 1000, 'It depends')]);
    const report = createEvidenceReport('host', 'Public discussion', rows, base + 2000);
    expect(report.comments).toBe(1);
    expect(report.captions).toBe(1);
    expect(report.attributedCaptions).toBe(0);
    const md = reportMarkdown(report);
    expect(md).toContain('Evidence ID: host:chat:c1');
    expect(md).toContain('Unattributed speaker');
    expect(md).toContain('Temporal proximity');
  });
  it('neutralises user text that could create misleading report headings', () => {
    const rows = buildTimeline('host', [chat('c1', 0, 'ann', 'Hello\n## FALSE FINDING')], []);
    const md = reportMarkdown(createEvidenceReport('host', '', rows, base));
    expect(md).not.toContain('\n## FALSE FINDING');
    expect(md).toContain('Hello ## FALSE FINDING');
  });
});
