import fs from 'node:fs';
import path from 'node:path';
import { sessionsDir } from './paths';

export type StoredEvent = {
  ts: number;
  type: string;
  user?: { uniqueId: string; nickname: string };
  comment?: string;
  giftName?: string;
  diamondCount?: number;
  repeatCount?: number;
  question?: string;
};

export type SessionRecord = {
  id: string;
  hostUniqueId: string;
  hostNickname: string;
  roomTitle: string;
  startedAt: number;
  endedAt: number | null;
  totals: {
    likes: number;
    diamonds: number;
    comments: number;
    follows: number;
    shares: number;
    subs: number;
    gifts: number;
    questions: number;
    peakViewers: number;
  };
  events: StoredEvent[];
};

export type SessionSummary = Omit<SessionRecord, 'events'> & { eventCount: number };

function dir(): string {
  return sessionsDir();
}

function fileFor(id: string): string {
  return path.join(dir(), `${id}.json`);
}

// ---------------------------------------------------------------------------
// In-memory active session + debounced atomic persistence.
//
// Live streams fire many events/sec. The previous implementation did
// read-full-JSON + write-full-file on EVERY event (O(n²) over a session and a
// non-atomic write that corrupts the file if the process dies mid-write).
//
// We now keep the active SessionRecord in RAM, mutate totals/events there, and
// flush to disk debounced (atomic .tmp + rename) — mirroring fans.ts. Inactive
// sessions are still read straight from disk on demand (list/get/search/etc.).
let currentId: string | null = null;
let activeRecord: SessionRecord | null = null;
let dirty = false;
let flushTimer: NodeJS.Timeout | null = null;
const FLUSH_MS = 2000;

/**
 * Cached one-pass attendance index, shared by the batched fans:list / reminders
 * strength path AND the single-fan profile. Without it, computing attendance for
 * N fans re-read + re-parsed EVERY session file N times (the O(N_fans × sessions)
 * half of the slow-Followers bug).
 *
 * `perFan` maps fanUniqueId -> per-session FIRST-event timestamps (their join in
 * each session they actually appeared in). `totalSessions` is the denominator
 * for the loyalty rate. Sessions only change during a live stream, so the cache
 * is safe to hold and is invalidated whenever a session is written/removed (and
 * we always fold the in-RAM active session in fresh, since it lags disk).
 */
type AttendanceIndex = {
  perFan: Map<string, Map<string, number>>; // uid -> (sessionId -> firstEventTs)
  sessionMeta: Map<string, { roomTitle: string }>;
  totalSessions: number;
};
let attendanceCache: AttendanceIndex | null = null;
function invalidateAttendanceCache() {
  attendanceCache = null;
}

function scheduleFlush() {
  if (flushTimer) return;
  flushTimer = setTimeout(() => {
    flushTimer = null;
    flushActive();
  }, FLUSH_MS);
}

function markDirty() {
  dirty = true;
  scheduleFlush();
}

/** Atomically persist the active record if it has unsaved changes. */
export function flushActive() {
  if (!dirty || !activeRecord) return;
  try {
    write(activeRecord);
    dirty = false;
  } catch (err) {
    console.error('[sessions] flush failed:', err);
  }
}

function emptyTotals(): SessionRecord['totals'] {
  return {
    likes: 0,
    diamonds: 0,
    comments: 0,
    follows: 0,
    shares: 0,
    subs: 0,
    gifts: 0,
    questions: 0,
    peakViewers: 0,
  };
}

const REJOIN_WINDOW_MS = 60 * 60 * 1000; // 60 minutes

export function start(hostUniqueId: string, hostNickname: string, roomTitle: string): string {
  // Look for the most recent session with the same host that ended within REJOIN_WINDOW_MS
  // (or never ended cleanly — likely an app crash or quick reconnect)
  const recent = list().find((s) => {
    if (s.hostUniqueId !== hostUniqueId) return false;
    if (s.endedAt === null) return true; // session was never closed; resume
    return Date.now() - s.endedAt < REJOIN_WINDOW_MS;
  });

  if (recent) {
    const rec = read(recent.id);
    if (rec) {
      rec.endedAt = null;
      rec.roomTitle = roomTitle || rec.roomTitle;
      rec.hostNickname = hostNickname || rec.hostNickname;
      currentId = rec.id;
      activeRecord = rec;
      markDirty();
      flushActive(); // persist the resume immediately
      return rec.id;
    }
  }

  const id = `${Date.now()}-${hostUniqueId.replace(/[^a-z0-9_-]/gi, '_')}`;
  const rec: SessionRecord = {
    id,
    hostUniqueId,
    hostNickname,
    roomTitle,
    startedAt: Date.now(),
    endedAt: null,
    totals: emptyTotals(),
    events: [],
  };
  currentId = id;
  activeRecord = rec;
  write(rec); // create the file up front so list()/get() see it
  dirty = false;
  return id;
}

function read(id: string): SessionRecord | null {
  // The active session lives in RAM and may have unflushed mutations — always
  // serve it from memory so callers never see a stale on-disk copy.
  if (activeRecord && activeRecord.id === id) return activeRecord;
  try {
    return JSON.parse(fs.readFileSync(fileFor(id), 'utf8')) as SessionRecord;
  } catch {
    return null;
  }
}

/** Atomic write: tmp + rename so a crash mid-write can't corrupt the file. */
function write(rec: SessionRecord) {
  const dest = fileFor(rec.id);
  const tmp = dest + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(rec, null, 2));
  fs.renameSync(tmp, dest);
  // A session's on-disk events changed → the cached attendance index is stale.
  invalidateAttendanceCache();
}

export function append(evt: any) {
  if (!currentId || !activeRecord) return;
  const rec = activeRecord;
  const stored: StoredEvent = {
    ts: evt.ts ?? Date.now(),
    type: evt.type,
    user: evt.user
      ? { uniqueId: evt.user.uniqueId, nickname: evt.user.nickname }
      : undefined,
    comment: evt.comment,
    giftName: evt.giftName,
    diamondCount: evt.diamondCount,
    repeatCount: evt.repeatCount,
    question: evt.question,
  };

  switch (evt.type) {
    case 'like':
      rec.totals.likes += evt.likeCount || 1;
      break;
    case 'chat':
      rec.totals.comments++;
      rec.events.push(stored);
      break;
    case 'gift':
      rec.totals.gifts++;
      rec.totals.diamonds += (evt.diamondCount || 0) * (evt.repeatCount || 1);
      rec.events.push(stored);
      break;
    case 'follow':
      rec.totals.follows++;
      break;
    case 'share':
      rec.totals.shares++;
      break;
    case 'subscribe':
      rec.totals.subs++;
      break;
    case 'questionNew':
      rec.totals.questions++;
      rec.events.push(stored);
      break;
    case 'roomUser':
      if (evt.viewerCount > rec.totals.peakViewers) {
        rec.totals.peakViewers = evt.viewerCount;
        markDirty();
      }
      return;
    default:
      return;
  }
  markDirty();
}

export function end() {
  if (!currentId || !activeRecord) return;
  activeRecord.endedAt = Date.now();
  dirty = true;
  if (flushTimer) {
    clearTimeout(flushTimer);
    flushTimer = null;
  }
  flushActive(); // persist final state synchronously
  currentId = null;
  activeRecord = null;
}

export function list(): SessionSummary[] {
  // tmp files are named "<id>.json.tmp" so the .json suffix check excludes them.
  const files = fs.readdirSync(dir()).filter((f) => f.endsWith('.json'));
  const out: SessionSummary[] = [];
  for (const f of files) {
    try {
      // Serve the active session from RAM so its totals/eventCount aren't stale
      // (the on-disk copy lags by up to FLUSH_MS).
      const id = f.replace(/\.json$/, '');
      const rec =
        activeRecord && activeRecord.id === id
          ? activeRecord
          : (JSON.parse(fs.readFileSync(path.join(dir(), f), 'utf8')) as SessionRecord);
      const { events, ...rest } = rec;
      out.push({ ...rest, eventCount: events.length });
    } catch {
      /* skip corrupt */
    }
  }
  out.sort((a, b) => b.startedAt - a.startedAt);
  return out;
}

export function get(id: string): SessionRecord | null {
  return read(id);
}

export function remove(id: string) {
  if (currentId === id) {
    // Removing the live session: drop the in-memory copy and cancel any pending
    // flush so it can't be re-written after deletion.
    currentId = null;
    activeRecord = null;
    dirty = false;
    if (flushTimer) {
      clearTimeout(flushTimer);
      flushTimer = null;
    }
  }
  try {
    fs.unlinkSync(fileFor(id));
  } catch {
    /* ignore */
  }
  invalidateAttendanceCache();
}

export type UserHistoricalTally = {
  uniqueId: string;
  nickname: string;
  likes: number;
  diamonds: number;
  comments: number;
  gifts: number;
  sessionsAppeared: number;
};

export function userTallies(uniqueId: string): UserHistoricalTally {
  const tally: UserHistoricalTally = {
    uniqueId,
    nickname: uniqueId,
    likes: 0,
    diamonds: 0,
    comments: 0,
    gifts: 0,
    sessionsAppeared: 0,
  };
  for (const summary of list()) {
    const rec = read(summary.id);
    if (!rec) continue;
    let appeared = false;
    for (const e of rec.events) {
      if (e.user?.uniqueId !== uniqueId) continue;
      if (!appeared) {
        appeared = true;
        tally.sessionsAppeared++;
        tally.nickname = e.user.nickname;
      }
      switch (e.type) {
        case 'chat':
          tally.comments++;
          break;
        case 'gift':
          tally.gifts++;
          tally.diamonds += (e.diamondCount ?? 0) * (e.repeatCount ?? 1);
          break;
      }
    }
  }
  return tally;
}

export type FanSessionAttend = {
  sessionId: string;
  roomTitle: string;
  /** epoch ms of the fan's FIRST recorded event in that session (their join). */
  attendedAt: number;
};

/**
 * Fold one session record into an attendance index: record, per fan, the FIRST
 * event timestamp the fan produced in this session, plus the session's room
 * title. Used by both the cached finished-session pass and the fresh active-
 * session overlay.
 */
function indexSession(rec: SessionRecord, idx: AttendanceIndex) {
  idx.sessionMeta.set(rec.id, { roomTitle: rec.roomTitle });
  for (const e of rec.events) {
    const uid = e.user?.uniqueId;
    if (!uid) continue;
    let perSession = idx.perFan.get(uid);
    if (!perSession) {
      perSession = new Map();
      idx.perFan.set(uid, perSession);
    }
    const prev = perSession.get(rec.id);
    if (prev === undefined || e.ts < prev) perSession.set(rec.id, e.ts);
  }
}

/**
 * Build (or return cached) the attendance index across ALL sessions in a single
 * pass. Finished sessions are read from disk once and cached; the in-RAM active
 * session is always folded in fresh (its events grow between flushes, so a stale
 * disk copy would under-count). `totalSessions` counts every session file.
 */
function buildAttendanceIndex(): AttendanceIndex {
  let base = attendanceCache;
  if (!base) {
    base = { perFan: new Map(), sessionMeta: new Map(), totalSessions: 0 };
    try {
      const files = fs.readdirSync(dir()).filter((f) => f.endsWith('.json'));
      for (const f of files) {
        const id = f.replace(/\.json$/, '');
        // Skip the live session here — it's folded in fresh below from RAM.
        if (activeRecord && activeRecord.id === id) continue;
        try {
          const rec = JSON.parse(fs.readFileSync(path.join(dir(), f), 'utf8')) as SessionRecord;
          base.totalSessions++;
          indexSession(rec, base);
        } catch {
          /* skip corrupt */
        }
      }
    } catch {
      /* no sessions dir yet */
    }
    attendanceCache = base;
  }
  // Overlay the live session fresh (not cached — it mutates every event).
  if (activeRecord) {
    const overlay: AttendanceIndex = {
      perFan: new Map(base.perFan),
      sessionMeta: new Map(base.sessionMeta),
      totalSessions: base.totalSessions + 1,
    };
    // Build the live session's contribution in isolation, then merge into the
    // overlay without ever mutating the cached `base` maps.
    const liveIdx: AttendanceIndex = { perFan: new Map(), sessionMeta: new Map(), totalSessions: 0 };
    indexSession(activeRecord, liveIdx);
    for (const [uid, perSession] of liveIdx.perFan) {
      const merged = new Map(overlay.perFan.get(uid) ?? new Map<string, number>());
      for (const [sid, ts] of perSession) merged.set(sid, ts);
      overlay.perFan.set(uid, merged);
    }
    for (const [sid, meta] of liveIdx.sessionMeta) overlay.sessionMeta.set(sid, meta);
    return overlay;
  }
  return base;
}

/**
 * Per-session attendance for a fan, derived from the session ledgers.
 *
 * "Attended" = the fan produced at least one recorded event (chat / gift /
 * question) in that session — that's the only honest presence signal we have
 * (likes/follows aren't stored per-user in the events array). Returns the
 * matched sessions (newest-first) plus `totalSessions` so the caller can
 * compute a loyalty/attendance rate. Bounded + fail-safe.
 *
 * Now backed by the shared one-pass attendance index instead of re-reading every
 * session file on each call.
 */
export function fanSessionAttendance(uniqueId: string, cap = 200): {
  attended: FanSessionAttend[];
  attendedCount: number;
  totalSessions: number;
} {
  const uid = String(uniqueId ?? '').replace(/^@/, '').trim();
  const out: FanSessionAttend[] = [];
  if (!uid) return { attended: out, attendedCount: 0, totalSessions: 0 };
  try {
    const idx = buildAttendanceIndex();
    const perSession = idx.perFan.get(uid);
    if (perSession) {
      for (const [sessionId, attendedAt] of perSession) {
        out.push({
          sessionId,
          roomTitle: idx.sessionMeta.get(sessionId)?.roomTitle ?? '',
          attendedAt,
        });
      }
    }
    out.sort((a, b) => b.attendedAt - a.attendedAt);
    if (out.length > cap) out.length = cap;
    return { attended: out, attendedCount: out.length, totalSessions: idx.totalSessions };
  } catch (err) {
    console.error('[sessions] fanSessionAttendance failed:', err);
    return { attended: out, attendedCount: out.length, totalSessions: 0 };
  }
}

export type FanAttendanceAggregate = {
  attendedCount: number;
  /** epoch ms of the fan's most-recent session join, or null. */
  lastAttendedAt: number | null;
  /** sessions attended in the [sinceMs, ∞) window (for recent-interaction counts). */
  recentAttendedCount: number;
};

/**
 * Batched attendance for ALL fans in a SINGLE session-ledger pass. Returns the
 * per-fan aggregates plus the shared `totalSessions` denominator, so the
 * fans:list / reminders strength pass can look attendance up from a map instead
 * of re-scanning sessions per fan. Fail-safe.
 */
export function allFansAttendance(sinceMs = 0): {
  byFan: Map<string, FanAttendanceAggregate>;
  totalSessions: number;
} {
  const byFan = new Map<string, FanAttendanceAggregate>();
  try {
    const idx = buildAttendanceIndex();
    for (const [uid, perSession] of idx.perFan) {
      let attendedCount = 0;
      let recentAttendedCount = 0;
      let lastAttendedAt: number | null = null;
      for (const ts of perSession.values()) {
        attendedCount++;
        if (ts >= sinceMs) recentAttendedCount++;
        if (lastAttendedAt === null || ts > lastAttendedAt) lastAttendedAt = ts;
      }
      byFan.set(uid, { attendedCount, lastAttendedAt, recentAttendedCount });
    }
    return { byFan, totalSessions: idx.totalSessions };
  } catch (err) {
    console.error('[sessions] allFansAttendance failed:', err);
    return { byFan, totalSessions: 0 };
  }
}

/**
 * Test/maintenance hook: drop the cached attendance index so the next read
 * re-scans from disk. Used by tests that seed session files directly (bypassing
 * write()), and safe to call any time.
 */
export function _resetAttendanceCache(): void {
  invalidateAttendanceCache();
}

export function allTimeLeaderboard(limit = 50): UserHistoricalTally[] {
  const map = new Map<string, UserHistoricalTally>();
  for (const summary of list()) {
    const rec = read(summary.id);
    if (!rec) continue;
    const seen = new Set<string>();
    for (const e of rec.events) {
      if (!e.user?.uniqueId) continue;
      const uid = e.user.uniqueId;
      if (!map.has(uid)) {
        map.set(uid, {
          uniqueId: uid,
          nickname: e.user.nickname,
          likes: 0,
          diamonds: 0,
          comments: 0,
          gifts: 0,
          sessionsAppeared: 0,
        });
      }
      const t = map.get(uid)!;
      t.nickname = e.user.nickname;
      if (!seen.has(uid)) {
        seen.add(uid);
        t.sessionsAppeared++;
      }
      switch (e.type) {
        case 'chat':
          t.comments++;
          break;
        case 'gift':
          t.gifts++;
          t.diamonds += (e.diamondCount ?? 0) * (e.repeatCount ?? 1);
          break;
      }
    }
  }
  return [...map.values()]
    .sort((a, b) => b.diamonds - a.diamonds)
    .slice(0, limit);
}

export function search(query: string, limit = 200): {
  sessionId: string;
  hostNickname: string;
  startedAt: number;
  ts: number;
  user: string;
  comment: string;
}[] {
  const q = query.trim().toLowerCase();
  if (!q) return [];
  const results: ReturnType<typeof search> = [];
  for (const summary of list()) {
    const rec = read(summary.id);
    if (!rec) continue;
    for (const e of rec.events) {
      if (e.type !== 'chat' || !e.comment) continue;
      if (e.comment.toLowerCase().includes(q) || e.user?.nickname.toLowerCase().includes(q)) {
        results.push({
          sessionId: rec.id,
          hostNickname: rec.hostNickname,
          startedAt: rec.startedAt,
          ts: e.ts,
          user: e.user?.nickname ?? '',
          comment: e.comment,
        });
        if (results.length >= limit) return results;
      }
    }
  }
  return results;
}
