import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import './helpers';
import {
  upsertFan,
  ingestLiveEvent,
  logGift,
  listReminders,
  reminderAction,
  addThankReminder,
  clearAll,
  setRulesGetter,
  DEFAULT_RULES,
} from '../electron/fans';
import { wipeDataDir } from './helpers';

// A fixed "now" well clear of year boundaries so birthday rollover math is
// stable: 2024-06-15T12:00:00Z.
const NOW = new Date('2024-06-15T12:00:00Z').getTime();

beforeEach(() => {
  wipeDataDir();
  clearAll();
  setRulesGetter(() => DEFAULT_RULES);
  vi.useFakeTimers();
  vi.setSystemTime(NOW);
});
afterEach(() => {
  vi.useRealTimers();
  clearAll();
});

const daysAgo = (n: number) => NOW - n * 86400000;

describe('listReminders — birthday', () => {
  it('surfaces a birthday inside the window and encodes year in the id', () => {
    // 10 days from 2024-06-15 -> 2024-06-25 == "06-25".
    upsertFan({ uniqueId: 'bday', birthday: '06-25' });
    const rems = listReminders();
    const b = rems.find((r) => r.kind === 'birthday');
    expect(b).toBeTruthy();
    expect(b!.fan.uniqueId).toBe('bday');
    expect(b!.days).toBe(10);
    expect(b!.id).toBe('bday:bday:2024'); // kind:uniqueId:year
  });

  it('omits a birthday outside the window', () => {
    // default birthdayWindowDays = 30; pick a date ~3 months out.
    upsertFan({ uniqueId: 'far', birthday: '09-20' });
    const rems = listReminders();
    expect(rems.find((r) => r.kind === 'birthday' && r.fan.uniqueId === 'far')).toBeUndefined();
  });
});

describe('listReminders — quiet VIP', () => {
  it('surfaces a VIP unseen past quietDays and not a recently-seen VIP', () => {
    // VIP needs >= 1000 diamonds AND lastSeenAt > quietDays(14) ago.
    // Create the fan via an OLD presence event first (stamps lastSeenAt to 20d
    // ago), then push diamonds via logGift — which upserts an *existing* fan and
    // therefore does NOT reset lastSeenAt to "now".
    ingestLiveEvent({ type: 'member', user: { uniqueId: 'quietvip', nickname: 'QV' }, ts: daysAgo(20) });
    logGift({ uniqueId: 'quietvip', giftName: 'Lion', diamonds: 5000, at: daysAgo(20) });

    // A second VIP seen yesterday should NOT be quiet.
    ingestLiveEvent({ type: 'member', user: { uniqueId: 'activevip', nickname: 'AV' }, ts: daysAgo(1) });
    logGift({ uniqueId: 'activevip', giftName: 'Lion', diamonds: 5000, at: daysAgo(1) });

    const rems = listReminders();
    const quiet = rems.filter((r) => r.kind === 'quiet');
    expect(quiet.map((r) => r.fan.uniqueId)).toContain('quietvip');
    expect(quiet.map((r) => r.fan.uniqueId)).not.toContain('activevip');

    const q = quiet.find((r) => r.fan.uniqueId === 'quietvip')!;
    expect(q.days).toBe(20);
    expect(q.id).toMatch(/^quiet:quietvip:\d+$/);
  });

  it('does not surface a quiet reminder for a non-VIP regular', () => {
    upsertFan({ uniqueId: 'reg', totalDiamonds: 200 }); // Regular, not VIP
    ingestLiveEvent({ type: 'member', user: { uniqueId: 'reg', nickname: 'R' }, ts: daysAgo(60) });
    const rems = listReminders();
    expect(rems.find((r) => r.kind === 'quiet' && r.fan.uniqueId === 'reg')).toBeUndefined();
  });
});

describe('listReminders — thank', () => {
  it('surfaces a queued thank reminder for an existing fan', () => {
    upsertFan({ uniqueId: 'thanky', displayName: 'Thanky' });
    const res = addThankReminder('thanky');
    expect(res.ok).toBe(true);
    const rems = listReminders();
    const t = rems.find((r) => r.kind === 'thank');
    expect(t).toBeTruthy();
    expect(t!.fan.uniqueId).toBe('thanky');
    expect(t!.id).toBe('thank:thanky:2024-06-15'); // kind:uniqueId:date
  });

  it('dedupes a second thank request for the same fan on the same day', () => {
    upsertFan({ uniqueId: 'dup' });
    addThankReminder('dup');
    const second = addThankReminder('dup');
    expect(second.deduped).toBe(true);
    const thanks = listReminders().filter((r) => r.kind === 'thank' && r.fan.uniqueId === 'dup');
    expect(thanks).toHaveLength(1);
  });
});

describe('reminderAction — done suppresses, snooze hides then re-surfaces', () => {
  it("'done' suppresses the reminder for the cycle", () => {
    upsertFan({ uniqueId: 'd1', birthday: '06-20' });
    const before = listReminders().find((r) => r.kind === 'birthday')!;
    expect(before).toBeTruthy();

    reminderAction(before.id, 'done');
    const after = listReminders().find((r) => r.kind === 'birthday' && r.fan.uniqueId === 'd1');
    expect(after).toBeUndefined();
  });

  it("'snooze' hides until the until-date, then the reminder re-surfaces", () => {
    upsertFan({ uniqueId: 's1', birthday: '06-22' });
    const r = listReminders().find((r) => r.kind === 'birthday')!;
    expect(r).toBeTruthy();

    // Snooze 3 days.
    reminderAction(r.id, 'snooze', 3);
    expect(
      listReminders().find((x) => x.kind === 'birthday' && x.fan.uniqueId === 's1'),
    ).toBeUndefined();

    // Advance time past the snooze window -> reminder comes back.
    vi.setSystemTime(NOW + 4 * 86400000);
    const back = listReminders().find((x) => x.kind === 'birthday' && x.fan.uniqueId === 's1');
    expect(back).toBeTruthy();
  });

  it('rejects an action with a missing id', () => {
    expect(reminderAction('', 'done').ok).toBe(false);
  });
});
