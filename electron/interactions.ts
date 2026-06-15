/**
 * Interaction timeline store — the manual + milestone half of a fan's 360 memory.
 *
 * Persistence:
 *  - interactions.jsonl : append-only, one JSON object per line, keyed by fanId.
 *                         MANUAL events (notes, thank-yous, DMs, shout-outs) and
 *                         MILESTONE events (tier_up, reminder_done, manual_gift_log)
 *                         live here. Gifts do NOT — they already have a durable
 *                         home in gifts.jsonl and would double-write.
 *
 * Writes are flushed to disk immediately (like a gift record) because a manual
 * note is a deliberate, low-frequency user action — there's no live-stream
 * firehose here, so durability beats batching. An in-memory cache + per-fan
 * index keeps `listInteractions` / `buildTimeline` cheap.
 *
 * `buildTimeline(fanId)` MERGES three sources into one reverse-chronological
 * feed the 360 profile renders directly:
 *   (a) gifts        — from the gift ledger (source 'auto')
 *   (b) interactions — manual notes/thank-yous/etc + milestones (this file)
 *   (c) sessions     — attendance derived from sessions where the fan appears,
 *                      plus synthesized 'first_seen' / 'tier_up' milestones from
 *                      the fan record when per-session presence is thin.
 *
 * Comments are NOT stored per-row (too heavy for a live firehose). They surface
 * as a rolled-up count on the fan + a single "commented N times" rollup row.
 *
 * Everything here is fail-safe: a corrupt line is skipped, a read error returns
 * empty, and nothing throws to the renderer.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fansDir, type GiftRecord, type Fan, type Tier } from './fans';

// ---------------------------------------------------------------------------
// types

export type InteractionType =
  | 'note'
  | 'thank_you'
  | 'dm'
  | 'shoutout'
  | 'tier_up'
  | 'reminder_done'
  | 'manual_gift_log';

export type Interaction = {
  id: string;
  fanId: string;
  type: InteractionType;
  /** longer free-text body (e.g. the note contents). */
  body?: string;
  /** one-line headline rendered as the event title. */
  summary?: string;
  occurredAt: number;
  /** arbitrary structured extras (diamonds, fromTier/toTier, reminderKind, …). */
  payload?: Record<string, unknown>;
};

/** A merged, ready-to-render timeline row. */
export type TimelineEvent = {
  id: string;
  type:
    | 'gift'
    | 'note'
    | 'thank_you'
    | 'dm'
    | 'shoutout'
    | 'tier_up'
    | 'reminder_done'
    | 'manual_gift_log'
    | 'session_attend'
    | 'first_seen'
    | 'comment_rollup';
  occurredAt: number;
  source: 'auto' | 'manual' | 'system';
  summary: string;
  body?: string;
  payload?: Record<string, unknown>;
};

// ---------------------------------------------------------------------------
// paths + in-memory state

const interactionsFile = () => path.join(fansDir(), 'interactions.jsonl');

/** Cap how many rows buildTimeline returns — keeps the profile cheap to render. */
const TIMELINE_CAP = 300;

let cache: Interaction[] | null = null;
/** fanId -> interactions[] index, rebuilt lazily alongside the cache. */
let byFan: Map<string, Interaction[]> | null = null;

function load(): Interaction[] {
  if (cache) return cache;
  cache = [];
  byFan = new Map();
  try {
    const raw = fs.readFileSync(interactionsFile(), 'utf8');
    for (const line of raw.split('\n')) {
      if (!line.trim()) continue;
      try {
        const rec = JSON.parse(line) as Interaction;
        if (rec && rec.fanId && rec.type && Number.isFinite(rec.occurredAt)) {
          cache.push(rec);
          indexOne(rec);
        }
      } catch {
        /* skip corrupt line */
      }
    }
  } catch {
    /* no interactions yet — fresh */
  }
  return cache;
}

function indexOne(rec: Interaction) {
  if (!byFan) byFan = new Map();
  const arr = byFan.get(rec.fanId);
  if (arr) arr.push(rec);
  else byFan.set(rec.fanId, [rec]);
}

function appendNow(rec: Interaction): boolean {
  try {
    fs.appendFileSync(interactionsFile(), JSON.stringify(rec) + '\n');
    return true;
  } catch (err) {
    console.error('[interactions] append failed:', err);
    return false;
  }
}

// ---------------------------------------------------------------------------
// public API — add / list

export type AddInteractionPayload = {
  fanId: string;
  type: InteractionType;
  body?: string;
  summary?: string;
  occurredAt?: number;
  payload?: Record<string, unknown>;
};

/**
 * Append a manual/milestone interaction. Fail-safe: returns ok:false rather
 * than throwing so callers (and the renderer) never crash. Flushes to disk
 * immediately like a gift record.
 */
export function addInteraction(p: AddInteractionPayload): { ok: boolean; event?: TimelineEvent; error?: string } {
  try {
    const fanId = String(p?.fanId ?? '').replace(/^@/, '').trim();
    if (!fanId) return { ok: false, error: 'fanId is required' };
    if (!p?.type) return { ok: false, error: 'type is required' };
    const occurredAt = Number.isFinite(p.occurredAt as number) && (p.occurredAt as number) > 0
      ? (p.occurredAt as number)
      : Date.now();
    const rec: Interaction = {
      id: `${occurredAt}-${Math.random().toString(36).slice(2, 8)}`,
      fanId,
      type: p.type,
      body: typeof p.body === 'string' ? p.body.slice(0, 5000) : undefined,
      summary: typeof p.summary === 'string' ? p.summary.slice(0, 280) : undefined,
      occurredAt,
      payload: p.payload && typeof p.payload === 'object' ? p.payload : undefined,
    };
    load(); // ensure cache hydrated before we mutate it
    cache!.push(rec);
    indexOne(rec);
    appendNow(rec);
    return { ok: true, event: interactionToTimeline(rec) };
  } catch (err: any) {
    console.error('[interactions] addInteraction failed:', err);
    return { ok: false, error: err?.message ?? String(err) };
  }
}

/** All raw interactions for a fan, newest-first. Never throws. */
export function listInteractions(fanId: string): Interaction[] {
  try {
    const uid = String(fanId ?? '').replace(/^@/, '').trim();
    if (!uid) return [];
    load();
    const arr = byFan?.get(uid) ?? [];
    return [...arr].sort((a, b) => b.occurredAt - a.occurredAt);
  } catch {
    return [];
  }
}

// ---------------------------------------------------------------------------
// timeline merge

function interactionToTimeline(rec: Interaction): TimelineEvent {
  const manualTypes: InteractionType[] = ['note', 'thank_you', 'dm', 'shoutout', 'manual_gift_log'];
  const source: TimelineEvent['source'] = manualTypes.includes(rec.type) ? 'manual' : 'system';
  return {
    id: rec.id,
    type: rec.type,
    occurredAt: rec.occurredAt,
    source,
    summary: rec.summary ?? defaultSummaryFor(rec),
    body: rec.body,
    payload: rec.payload,
  };
}

function defaultSummaryFor(rec: Interaction): string {
  switch (rec.type) {
    case 'note': return 'Note added';
    case 'thank_you': return 'Thank-you sent';
    case 'dm': return 'DM sent';
    case 'shoutout': return 'Shout-out given';
    case 'tier_up': return 'Tier upgraded';
    case 'reminder_done': return 'Reminder completed';
    case 'manual_gift_log': return 'Gift logged manually';
    default: return 'Interaction';
  }
}

function giftToTimeline(g: GiftRecord): TimelineEvent {
  const n = g.repeatCount && g.repeatCount > 1 ? ` ×${g.repeatCount}` : '';
  return {
    id: `gift-${g.id}`,
    type: 'gift',
    occurredAt: g.at,
    source: 'auto',
    summary: `gave ${g.giftName}${n}`,
    payload: { diamonds: g.diamonds, repeatCount: g.repeatCount, sessionId: g.sessionId, manual: g.manual },
  };
}

/** Minimal session shape buildTimeline needs — supplied by the caller. */
export type TimelineSessionAttend = {
  sessionId: string;
  roomTitle?: string;
  attendedAt: number;
};

export type BuildTimelineInput = {
  fan?: Fan | null;
  gifts?: GiftRecord[];
  /** sessions the fan actually appeared in (derived from session events by the caller). */
  sessions?: TimelineSessionAttend[];
  /** rolled-up comment count for the fan (NOT stored per-row). */
  commentCount?: number;
  /** the fan's tier, for the synthesized tier_up milestone. */
  tier?: Tier;
  limit?: number;
};

/**
 * Merge gifts + manual interactions + session attendance + synthesized
 * milestones into one reverse-chronological, bounded timeline.
 *
 * Honest-best derivation:
 *  - session_attend rows come from real per-session presence when the caller can
 *    supply it; otherwise none are emitted (we don't fabricate attendance).
 *  - first_seen is synthesized from fan.firstSeenAt (always real).
 *  - tier_up is synthesized from the fan's CURRENT tier at lastGiftAt|lastSeenAt
 *    as a single "reached {tier}" milestone — we don't have historical tier
 *    transitions, so we surface the meaningful current standing rather than
 *    inventing a fake transition date.
 *  - comment_rollup is a single row when commentCount > 0 (comments are a count,
 *    never per-row).
 */
export function buildTimeline(fanId: string, input: BuildTimelineInput = {}): TimelineEvent[] {
  try {
    const uid = String(fanId ?? '').replace(/^@/, '').trim();
    if (!uid) return [];
    const limit = Number.isFinite(input.limit as number) && (input.limit as number) > 0
      ? Math.min(TIMELINE_CAP, input.limit as number)
      : TIMELINE_CAP;

    const events: TimelineEvent[] = [];

    // (a) gifts
    for (const g of input.gifts ?? []) {
      if (g && g.fanUniqueId === uid) events.push(giftToTimeline(g));
    }

    // (b) manual + milestone interactions
    for (const rec of listInteractions(uid)) {
      events.push(interactionToTimeline(rec));
    }

    // (c) session attendance (real presence only)
    for (const s of input.sessions ?? []) {
      if (!s || !Number.isFinite(s.attendedAt)) continue;
      events.push({
        id: `session-${s.sessionId}`,
        type: 'session_attend',
        occurredAt: s.attendedAt,
        source: 'auto',
        summary: s.roomTitle ? `Attended "${s.roomTitle}"` : 'Attended a live session',
        payload: { sessionId: s.sessionId },
      });
    }

    // (d) synthesized milestones from the fan record
    const fan = input.fan;
    if (fan) {
      if (Number.isFinite(fan.firstSeenAt)) {
        events.push({
          id: `firstseen-${uid}`,
          type: 'first_seen',
          occurredAt: fan.firstSeenAt,
          source: 'system',
          summary: 'First seen in your community',
          payload: {},
        });
      }
      const tier = input.tier;
      if (tier && tier !== 'New') {
        // Anchor the "reached {tier}" milestone to their most recent real signal.
        const anchor = fan.lastGiftAt ?? fan.lastSeenAt ?? fan.firstSeenAt;
        if (Number.isFinite(anchor)) {
          events.push({
            id: `tierup-${uid}-${tier}`,
            type: 'tier_up',
            occurredAt: anchor as number,
            source: 'system',
            summary: `Reached ${tier} tier`,
            payload: { tier },
          });
        }
      }
    }

    // comment rollup (single row, never per-comment)
    const commentCount = Math.max(0, Number(input.commentCount) || 0);
    if (commentCount > 0) {
      const anchor = fan?.lastSeenAt ?? Date.now();
      events.push({
        id: `comments-${uid}`,
        type: 'comment_rollup',
        occurredAt: anchor,
        source: 'auto',
        summary: `${commentCount.toLocaleString()} comment${commentCount === 1 ? '' : 's'} across your streams`,
        payload: { count: commentCount },
      });
    }

    events.sort((a, b) => b.occurredAt - a.occurredAt);
    return events.slice(0, limit);
  } catch (err) {
    console.error('[interactions] buildTimeline failed:', err);
    return [];
  }
}

/** Test/maintenance hook: drop the in-memory cache so the next read re-hydrates. */
export function _resetCache(): void {
  cache = null;
  byFan = null;
}
