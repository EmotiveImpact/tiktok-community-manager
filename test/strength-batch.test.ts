import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import './helpers';
import {
  ingestLiveEvent,
  upsertFan,
  logGift,
  getFan,
  clearAll,
  flush,
  setRulesGetter,
  DEFAULT_RULES,
} from '../electron/fans';
import { strengthForFan, strengthForAll } from '../electron/crm';
import { addInteraction, _resetCache } from '../electron/interactions';
import { _resetAttendanceCache } from '../electron/sessions';
import { wipeDataDir, appDir } from './helpers';
import fs from 'node:fs';
import path from 'node:path';

/**
 * Equivalence + perf-shape test for the batched strength path.
 *
 * Proves the O(ledger + N_fans) batched `strengthForAll` returns IDENTICAL
 * strength/temperature/breakdown to the per-fan `strengthForFan` it replaces in
 * fans:list / listReminders, across a mix of gift / session / interaction
 * signals. This is the safety net for the pure-perf refactor.
 */

function sessionsDir(): string {
  const dir = path.join(appDir(), 'sessions');
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

function writeSession(id: string, roomTitle: string, startedAt: number, events: any[]) {
  const rec = {
    id,
    hostUniqueId: 'host',
    hostNickname: 'Host',
    roomTitle,
    startedAt,
    endedAt: startedAt + 3_600_000,
    totals: { likes: 0, diamonds: 0, comments: 0, follows: 0, shares: 0, subs: 0, gifts: 0, questions: 0, peakViewers: 0 },
    events,
  };
  fs.writeFileSync(path.join(sessionsDir(), `${id}.json`), JSON.stringify(rec));
}

const DAY = 86_400_000;

beforeEach(() => {
  wipeDataDir();
  clearAll();
  _resetCache();
  _resetAttendanceCache();
  setRulesGetter(() => DEFAULT_RULES);
});
afterEach(() => {
  clearAll();
  _resetCache();
  _resetAttendanceCache();
});

describe('strengthForAll — batched/single equivalence', () => {
  it('matches strengthForFan exactly for a mixed cohort of fans', () => {
    const now = Date.now();

    // --- fan A: recent whale with gifts, sessions, an interaction ----------
    ingestLiveEvent({ type: 'gift', user: { uniqueId: 'whale', nickname: 'Whale' }, diamondCount: 5000, repeatCount: 3, giftName: 'Lion', ts: now - 2 * DAY });
    ingestLiveEvent({ type: 'gift', user: { uniqueId: 'whale', nickname: 'Whale' }, diamondCount: 2000, repeatCount: 1, giftName: 'Rocket', ts: now - 10 * DAY });
    addInteraction({ fanId: 'whale', type: 'note', summary: 'VIP note', occurredAt: now - 1 * DAY });

    // --- fan B: a lapsed VIP (cold-override territory) ----------------------
    upsertFan({ uniqueId: 'lapsed', totalDiamonds: 4000 }); // VIP by diamonds
    logGift({ uniqueId: 'lapsed', giftName: 'Old', diamonds: 1500, at: now - 40 * DAY });

    // --- fan C: chatty regular, no gifts -----------------------------------
    upsertFan({ uniqueId: 'chatty' });
    addInteraction({ fanId: 'chatty', type: 'dm', summary: 'hi', occurredAt: now - 3 * DAY });

    // --- fan D: never-contacted import -------------------------------------
    upsertFan({ uniqueId: 'ghost' });

    flush();

    // sessions: 3 total. whale + chatty attend some; lapsed/ghost none.
    writeSession('s1', 'Friday Live', now - 5 * DAY, [
      { ts: now - 5 * DAY, type: 'chat', user: { uniqueId: 'whale', nickname: 'Whale' }, comment: 'hey' },
      { ts: now - 5 * DAY + 1000, type: 'chat', user: { uniqueId: 'chatty', nickname: 'Chatty' }, comment: 'yo' },
    ]);
    writeSession('s2', 'Saturday Live', now - 3 * DAY, [
      { ts: now - 3 * DAY, type: 'gift', user: { uniqueId: 'whale', nickname: 'Whale' }, giftName: 'Rose', diamondCount: 1, repeatCount: 1 },
    ]);
    writeSession('s3', 'Sunday Live', now - 60 * DAY, [
      { ts: now - 60 * DAY, type: 'chat', user: { uniqueId: 'chatty', nickname: 'Chatty' }, comment: 'old' },
    ]);
    _resetAttendanceCache(); // sessions seeded directly on disk — drop stale index

    const ids = ['whale', 'lapsed', 'chatty', 'ghost'];
    const fanInputs = ids.map((uid) => ({ uniqueId: uid, tier: getFan(uid)!.tier }));

    const batched = strengthForAll(fanInputs);

    for (const uid of ids) {
      const single = strengthForFan(uid);
      const b = batched.get(uid)!;
      expect(b, `missing batched result for ${uid}`).toBeTruthy();
      // identical strength, temperature, days, breakdown, and aggregates
      expect(b.result.strength, `strength ${uid}`).toBe(single.result.strength);
      expect(b.result.temperature, `temperature ${uid}`).toBe(single.result.temperature);
      expect(b.result.daysSinceContact, `days ${uid}`).toBe(single.result.daysSinceContact);
      expect(b.result.breakdown, `breakdown ${uid}`).toEqual(single.result.breakdown);
      expect(b.diamonds30d, `diamonds30d ${uid}`).toBe(single.diamonds30d);
      expect(b.sessionsAttended, `sessionsAttended ${uid}`).toBe(single.sessionsAttended);
    }

    // sanity: the recent whale (gift 2d ago + note 1d ago) has real signal
    expect(batched.get('whale')!.result.strength).toBeGreaterThan(0);
    expect(batched.get('whale')!.diamonds30d).toBeGreaterThan(0);
    // sanity: whale attended 2 of 3 sessions → loyalty reflects it
    expect(batched.get('whale')!.sessionsAttended).toBe(2);
  });

  it('a freshly logged gift is reflected without a stale cache (cache coherence)', () => {
    const now = Date.now();
    upsertFan({ uniqueId: 'fresh' });
    flush();
    // prime the gifts cache via a read
    let r = strengthForFan('fresh');
    expect(r.diamonds30d).toBe(0);
    // log a gift now — cache must update, not serve stale 0
    logGift({ uniqueId: 'fresh', giftName: 'New', diamonds: 1234, at: now - 1 * DAY });
    r = strengthForFan('fresh');
    expect(r.diamonds30d).toBe(1234);
    const batched = strengthForAll([{ uniqueId: 'fresh', tier: getFan('fresh')!.tier }]);
    expect(batched.get('fresh')!.diamonds30d).toBe(1234);
  });
});
