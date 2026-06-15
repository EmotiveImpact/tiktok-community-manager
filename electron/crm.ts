/**
 * CRM orchestration layer — the "one call powers the whole profile" surface.
 *
 * This is the only place the otherwise-independent stores are composed:
 *   fans.ts        → the Fan record + gift ledger helpers
 *   sessions.ts    → per-fan session attendance (loyalty signal)
 *   interactions.ts→ manual/milestone timeline rows + buildTimeline merge
 *   strength.ts    → pure relationship-strength engine
 *   store.ts       → community rules + custom-field defs
 *
 * Everything here is FAIL-SAFE: CRM reads must never throw to the renderer, so
 * each public function wraps its work and returns safe defaults on error.
 */
import * as fans from './fans';
import * as sessions from './sessions';
import { buildTimeline, listInteractions, type TimelineEvent } from './interactions';
import { computeStrength, type StrengthResult } from './strength';
import { settings, customFieldsStore, DEFAULT_COMMUNITY, type CustomFieldDef } from './store';

const DAY_MS = 86_400_000;

function coldDays(): number {
  try {
    const c = settings.get('community', DEFAULT_COMMUNITY);
    return Number.isFinite(c?.quietDays) && c.quietDays > 0 ? c.quietDays : DEFAULT_COMMUNITY.quietDays;
  } catch {
    return DEFAULT_COMMUNITY.quietDays;
  }
}

/** Last interaction across ALL sources (gift / session / manual / lastSeen). */
function lastInteractionAt(uid: string, fan: fans.Fan | null, attendedAt: number | null): number | null {
  let max = 0;
  if (fan?.lastGiftAt) max = Math.max(max, fan.lastGiftAt);
  if (fan?.lastSeenAt) max = Math.max(max, fan.lastSeenAt);
  if (attendedAt) max = Math.max(max, attendedAt);
  for (const i of listInteractions(uid)) max = Math.max(max, i.occurredAt);
  return max > 0 ? max : null;
}

export type FanProfile = {
  fan: fans.FanWithTier;
  strength: number;
  temperature: StrengthResult['temperature'];
  daysSinceContact: number;
  breakdown: StrengthResult['breakdown'];
  sessionsAttended: number;
  currentStreak: number;
  diamonds30d: number;
  /** open tasks/reminders for this fan (from the event-sourced reminders). */
  reminders: fans.Reminder[];
  customFieldDefs: CustomFieldDef[];
  customFields: Record<string, unknown>;
};

/**
 * Compute the strength bundle for a fan from the live ledger/sessions. Shared by
 * the profile builder AND the fans:list row enrichment so both agree.
 */
export function strengthForFan(uniqueId: string): {
  fan: fans.FanWithTier | null;
  result: StrengthResult;
  sessionsAttended: number;
  diamonds30d: number;
} {
  const uid = String(uniqueId ?? '').replace(/^@/, '').trim();
  const empty: StrengthResult = {
    strength: 0,
    temperature: 'cold',
    daysSinceContact: 9999,
    breakdown: { recency: 0, generosity: 0, frequency: 0, loyalty: 0 },
  };
  try {
    const fan = fans.getFan(uid);
    if (!fan) return { fan: null, result: empty, sessionsAttended: 0, diamonds30d: 0 };
    const now = Date.now();
    const since30 = now - 30 * DAY_MS;
    const diamonds30d = fans.diamondsSince(uid, since30);
    const att = sessions.fanSessionAttendance(uid);
    const recentAttended = att.attended.filter((a) => a.attendedAt >= since30).length;
    const giftsForFan = fans.giftsForFan(uid, 300);
    const gifts30d = giftsForFan.filter((g) => g.at >= since30).length;
    const interactions30d = gifts30d + recentAttended +
      listInteractions(uid).filter((i) => i.occurredAt >= since30).length;
    const last = lastInteractionAt(uid, fans.getRawFan(uid), att.attended[0]?.attendedAt ?? null);

    const result = computeStrength(
      { tier: fan.tier },
      {
        lastInteractionAt: last,
        diamonds30d,
        interactions30d,
        sessionsAttended: att.attendedCount,
        recentSessionsCount: att.totalSessions,
        coldDays: coldDays(),
        now,
      },
    );
    return { fan, result, sessionsAttended: att.attendedCount, diamonds30d };
  } catch (err) {
    console.error('[crm] strengthForFan failed:', err);
    return { fan: fans.getFan(uniqueId), result: empty, sessionsAttended: 0, diamonds30d: 0 };
  }
}

/** Consecutive-week streak: count back-to-back ISO weeks the fan was active. */
function currentStreak(uid: string, attendedAtList: number[], gifts: fans.GiftRecord[]): number {
  try {
    const weeks = new Set<number>();
    const weekOf = (ms: number) => Math.floor(ms / (7 * DAY_MS));
    for (const a of attendedAtList) weeks.add(weekOf(a));
    for (const g of gifts) weeks.add(weekOf(g.at));
    if (weeks.size === 0) return 0;
    const thisWeek = weekOf(Date.now());
    let streak = 0;
    // Allow the streak to anchor on either this week or last week (grace for a
    // fan who hasn't shown up yet in the current, partial week).
    let cursor = weeks.has(thisWeek) ? thisWeek : weeks.has(thisWeek - 1) ? thisWeek - 1 : null;
    if (cursor === null) return 0;
    while (weeks.has(cursor)) {
      streak++;
      cursor--;
    }
    return streak;
  } catch {
    return 0;
  }
}

/**
 * THE 360 profile: Fan + derived strength bundle + open reminders + custom-field
 * defs + this fan's values. One call powers the whole header + stats + sidebars.
 */
export function fanProfile(uniqueId: string): FanProfile | null {
  try {
    const uid = String(uniqueId ?? '').replace(/^@/, '').trim();
    if (!uid) return null;
    const { fan, result, sessionsAttended, diamonds30d } = strengthForFan(uid);
    if (!fan) return null;

    const att = sessions.fanSessionAttendance(uid);
    const gifts = fans.giftsForFan(uid, 300);
    const streak = currentStreak(uid, att.attended.map((a) => a.attendedAt), gifts);

    let reminders: fans.Reminder[] = [];
    try {
      reminders = fans.listReminders().filter((r) => r.fan.uniqueId === uid);
    } catch { reminders = []; }

    let defs: CustomFieldDef[] = [];
    try { defs = customFieldsStore.list(); } catch { defs = []; }

    return {
      fan,
      strength: result.strength,
      temperature: result.temperature,
      daysSinceContact: result.daysSinceContact,
      breakdown: result.breakdown,
      sessionsAttended,
      currentStreak: streak,
      diamonds30d,
      reminders,
      customFieldDefs: defs,
      customFields: fans.getRawFan(uid)?.customFields ?? {},
    };
  } catch (err) {
    console.error('[crm] fanProfile failed:', err);
    return null;
  }
}

export type TimelineFilter = 'all' | 'gift' | 'comment' | 'note' | 'session';

/** Merged, filtered, reverse-chronological timeline for the 360 profile. */
export function fanTimeline(
  uniqueId: string,
  opts: { filter?: TimelineFilter; limit?: number } = {},
): TimelineEvent[] {
  try {
    const uid = String(uniqueId ?? '').replace(/^@/, '').trim();
    if (!uid) return [];
    const fan = fans.getRawFan(uid);
    const tier = fans.getFan(uid)?.tier;
    const gifts = fans.giftsForFan(uid, 300);
    const att = sessions.fanSessionAttendance(uid);
    // Rolled-up comment count (comments are a count on the fan, never per-row).
    const tallies = (() => { try { return sessions.userTallies(uid); } catch { return null; } })();
    const commentCount = tallies?.comments ?? 0;

    let events = buildTimeline(uid, {
      fan,
      gifts,
      sessions: att.attended,
      commentCount,
      tier,
      limit: opts.limit,
    });

    const filter = opts.filter ?? 'all';
    if (filter !== 'all') {
      events = events.filter((e) => {
        switch (filter) {
          case 'gift': return e.type === 'gift' || e.type === 'manual_gift_log';
          case 'comment': return e.type === 'comment_rollup';
          case 'note': return e.type === 'note' || e.type === 'thank_you' || e.type === 'dm' || e.type === 'shoutout';
          case 'session': return e.type === 'session_attend';
          default: return true;
        }
      });
    }
    return events;
  } catch (err) {
    console.error('[crm] fanTimeline failed:', err);
    return [];
  }
}
