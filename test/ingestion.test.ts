import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import './helpers';
import {
  ingestLiveEvent,
  getFan,
  listGifts,
  clearAll,
  flush,
  setRulesGetter,
  DEFAULT_RULES,
} from '../electron/fans';
import { wipeDataDir } from './helpers';

beforeEach(() => {
  wipeDataDir();
  clearAll();
  setRulesGetter(() => DEFAULT_RULES);
});
afterEach(() => {
  clearAll();
});

const user = (uniqueId: string, nickname = uniqueId) => ({ uniqueId, nickname });

describe('ingestLiveEvent — gift accumulation', () => {
  it('accumulates diamonds = diamondCount * repeatCount and increments giftCount', () => {
    const t0 = 1_700_000_000_000;
    ingestLiveEvent({
      type: 'gift',
      user: user('giftfan', 'Gift Fan'),
      diamondCount: 50,
      repeatCount: 3,
      giftName: 'Rose',
      ts: t0,
    });

    const fan = getFan('giftfan')!;
    expect(fan).toBeTruthy();
    expect(fan.totalDiamonds).toBe(150); // 50 * 3
    expect(fan.giftCount).toBe(1);
    expect(fan.lastGiftAt).toBe(t0);

    // A second gift compounds the total and bumps the count + lastGiftAt.
    const t1 = t0 + 60_000;
    ingestLiveEvent({
      type: 'gift',
      user: user('giftfan'),
      diamondCount: 10,
      repeatCount: 1,
      ts: t1,
    });
    const fan2 = getFan('giftfan')!;
    expect(fan2.totalDiamonds).toBe(160);
    expect(fan2.giftCount).toBe(2);
    expect(fan2.lastGiftAt).toBe(t1);
  });

  it('defaults repeatCount to 1 and writes a durable gift record', () => {
    const t0 = 1_700_000_500_000;
    ingestLiveEvent({
      type: 'gift',
      user: user('rec'),
      diamondCount: 99,
      giftName: 'Lion',
      ts: t0,
    });
    flush();
    const gifts = listGifts({ range: 'all' });
    expect(gifts.total).toBe(1);
    expect(gifts.data[0].diamonds).toBe(99);
    expect(gifts.data[0].repeatCount).toBe(1);
    expect(gifts.data[0].giftName).toBe('Lion');
    expect(gifts.diamondsAll).toBe(99);
  });
});

describe('ingestLiveEvent — presence events update timestamps', () => {
  it('member/follow/chat set firstSeenAt and advance lastSeenAt without touching diamonds', () => {
    const t0 = 1_700_000_000_000;
    ingestLiveEvent({ type: 'member', user: user('lurker'), ts: t0 });
    let fan = getFan('lurker')!;
    expect(fan.firstSeenAt).toBe(t0);
    expect(fan.lastSeenAt).toBe(t0);
    expect(fan.totalDiamonds).toBe(0);
    expect(fan.giftCount).toBe(0);

    const tLater = t0 + 5 * 86400000;
    ingestLiveEvent({ type: 'chat', user: user('lurker'), ts: tLater });
    fan = getFan('lurker')!;
    expect(fan.lastSeenAt).toBe(tLater); // advanced
    expect(fan.firstSeenAt).toBe(t0); // unchanged

    // follow with an EARLIER ts should pull firstSeenAt back, not lastSeenAt.
    const tEarlier = t0 - 86400000;
    ingestLiveEvent({ type: 'follow', user: user('lurker'), ts: tEarlier });
    fan = getFan('lurker')!;
    expect(fan.firstSeenAt).toBe(tEarlier);
    expect(fan.lastSeenAt).toBe(tLater);
  });
});

describe('ingestLiveEvent — never throws on malformed input', () => {
  it('swallows null / undefined / empty events', () => {
    expect(() => ingestLiveEvent(null)).not.toThrow();
    expect(() => ingestLiveEvent(undefined)).not.toThrow();
    expect(() => ingestLiveEvent({})).not.toThrow();
  });

  it('ignores events with a missing or "unknown" user without creating a fan', () => {
    ingestLiveEvent({ type: 'gift', diamondCount: 100 }); // no user
    ingestLiveEvent({ type: 'gift', user: { uniqueId: 'unknown' }, diamondCount: 100 });
    ingestLiveEvent({ type: 'chat', user: {} }); // user without uniqueId

    expect(getFan('unknown')).toBeNull();
    flush();
    expect(listGifts({ range: 'all' }).total).toBe(0);
  });

  it('handles a gift with missing diamond/repeat/giftName fields gracefully', () => {
    expect(() =>
      ingestLiveEvent({ type: 'gift', user: user('partial') }),
    ).not.toThrow();
    const fan = getFan('partial')!;
    expect(fan).toBeTruthy();
    // diamondCount ?? 0 -> 0 diamonds, but the fan + gift record still exist.
    expect(fan.totalDiamonds).toBe(0);
    expect(fan.giftCount).toBe(1);
    flush();
    expect(listGifts({ range: 'all' }).data[0].giftName).toBe('Gift'); // default
  });

  it('ignores unrecognised event types', () => {
    ingestLiveEvent({ type: 'definitely-not-a-real-type', user: user('ghost') });
    expect(getFan('ghost')).toBeNull();
  });
});
