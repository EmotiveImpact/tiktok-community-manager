/**
 * Fan ledger — permanent CRM store fed by live gift ingestion + manual edits.
 *
 * Persistence:
 *  - fans.json       : versioned envelope { version, fans: {uniqueId -> Fan} }
 *                      (debounced atomic writes; legacy bare-map is migrated
 *                       transparently on read)
 *  - fans.backup-N.json : rolling backups (last 3) taken once on app start
 *  - gifts.jsonl     : append-only gift records, one JSON object per line.
 *                      Gifts are MONEY, so each record is flushed to disk
 *                      synchronously the instant it's logged — the debounce
 *                      only batches the fans.json map, never gift durability.
 *  - reminder-events.json : event-sourced snooze/done actions for reminders
 *
 * Live streams can fire many events per second, so the fans.json map write is
 * batched and flushed at most every FLUSH_MS (plus on app quit). Gift records
 * bypass the batch and append immediately to minimise crash-loss of money data.
 */
import fs from 'node:fs';
import path from 'node:path';
import { appDocumentsDir } from './paths';

export type Fan = {
  uniqueId: string;
  nickname: string;
  displayName?: string;
  avatarUrl?: string | null;
  firstSeenAt: number;
  lastSeenAt: number;
  lastGiftAt?: number;
  totalDiamonds: number;
  giftCount: number;
  tags: string[];
  notes: string;
  /** 'MM-DD' */
  birthday?: string;
  createdManually?: boolean;
  /** last time the creator marked this fan as thanked */
  lastThankedAt?: number;
  /** typed custom-field values keyed by field `key` (defs live in settings). */
  customFields?: Record<string, unknown>;
};

export type FanWithTier = Fan & { tier: Tier };

export type GiftRecord = {
  id: string;
  fanUniqueId: string;
  fanNickname: string;
  giftName: string;
  diamonds: number; // total diamonds for the record (unit * repeat)
  repeatCount: number;
  sessionId?: string;
  manual?: boolean;
  at: number;
};

export type Tier = 'New' | 'Regular' | 'VIP' | 'Whale';

export type CommunityRules = {
  quietDays: number;
  birthdayWindowDays: number;
  tiers: { regular: number; vip: number; whale: number };
};

export const DEFAULT_RULES: CommunityRules = {
  quietDays: 14,
  birthdayWindowDays: 30,
  tiers: { regular: 100, vip: 1000, whale: 10000 },
};

/** Injected by main.ts so thresholds come from the settings store. */
let rulesGetter: () => CommunityRules = () => DEFAULT_RULES;
export function setRulesGetter(fn: () => CommunityRules) {
  rulesGetter = () => {
    try {
      const r = fn();
      if (r && r.tiers) return r;
    } catch { /* fall through */ }
    return DEFAULT_RULES;
  };
}

/** Diamond thresholds (mirrors web tier.ts shape; unit here is diamonds). */
export function tierForDiamonds(d: number): Tier {
  const t = rulesGetter().tiers;
  return d >= t.whale ? 'Whale' : d >= t.vip ? 'VIP' : d >= t.regular ? 'Regular' : 'New';
}

export type ReminderEvent = {
  reminderId: string;
  action: 'done' | 'snooze';
  /** for snooze: epoch ms until which the reminder is hidden */
  until?: number;
  at: number;
};

export type Reminder = {
  id: string;
  kind: 'birthday' | 'quiet' | 'thank';
  fan: FanWithTier;
  /** birthday: days until; quiet: days since last seen */
  days: number;
  date?: string; // birthday MM-DD
};

// ---------------------------------------------------------------------------
// paths

export function fansDir(): string {
  const dir = path.join(appDocumentsDir(), 'fans');
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  return dir;
}
const fansFile = () => path.join(fansDir(), 'fans.json');
const giftsFile = () => path.join(fansDir(), 'gifts.jsonl');
const reminderEventsFile = () => path.join(fansDir(), 'reminder-events.json');
const thankRemindersFile = () => path.join(fansDir(), 'thank-reminders.json');
const backupFile = (n: number) => path.join(fansDir(), `fans.backup-${n}.json`);

/** Current on-disk schema version for fans.json. */
const FANS_SCHEMA_VERSION = 1;
/** How many rolling backups of fans.json to keep. */
const BACKUP_KEEP = 3;

type FansEnvelope = { version: number; fans: Record<string, Fan> };

// ---------------------------------------------------------------------------
// in-memory state + batched persistence

let fans: Map<string, Fan> | null = null;
let reminderEvents: ReminderEvent[] | null = null;
let giftBuffer: string[] = [];
let fansDirty = false;
let flushTimer: NodeJS.Timeout | null = null;
const FLUSH_MS = 2000;

/**
 * Pull the uniqueId->Fan map out of either the versioned envelope
 * `{ version, fans }` or the legacy bare-map format. Returns null on anything
 * unrecognisable so callers can treat it as a fresh install.
 */
function extractFanMap(parsed: unknown): Record<string, Fan> | null {
  if (!parsed || typeof parsed !== 'object') return null;
  // Versioned envelope.
  if (
    'fans' in (parsed as any) &&
    (parsed as any).fans &&
    typeof (parsed as any).fans === 'object'
  ) {
    return (parsed as FansEnvelope).fans;
  }
  // Legacy bare map (uniqueId -> Fan). Guard against accidentally treating an
  // envelope's own keys as fans by checking the values look like Fan records.
  return parsed as Record<string, Fan>;
}

function loadFans(): Map<string, Fan> {
  if (fans) return fans;
  fans = new Map();
  let loadedFromDisk = false;
  try {
    const parsed = JSON.parse(fs.readFileSync(fansFile(), 'utf8'));
    const raw = extractFanMap(parsed);
    if (raw) {
      for (const [k, v] of Object.entries(raw)) {
        const rec = v as Partial<Fan> | null;
        if (rec && typeof rec === 'object' && rec.uniqueId) {
          // Backfill defaults for any fields a legacy/partial record may lack.
          fans.set(k, { tags: [], notes: '', totalDiamonds: 0, giftCount: 0, ...rec } as Fan);
        }
      }
      loadedFromDisk = true;
    }
  } catch {
    /* fresh install */
  }
  // Auto-backup on first successful load — cheap crash insurance. Only when
  // there was real data on disk (no point backing up a fresh/empty install).
  if (loadedFromDisk && fans.size > 0) rotateBackup();
  return fans;
}

/**
 * Copy the current fans.json to a rolling backup slot, keeping the last
 * BACKUP_KEEP. Best-effort: never throws, never blocks normal operation.
 */
let backedUpThisSession = false;
function rotateBackup() {
  if (backedUpThisSession) return;
  backedUpThisSession = true;
  try {
    const src = fansFile();
    if (!fs.existsSync(src)) return;
    // Shift older backups down: backup-(N-1) -> backup-N, dropping the oldest.
    for (let i = BACKUP_KEEP - 1; i >= 1; i--) {
      const from = backupFile(i);
      const to = backupFile(i + 1);
      if (fs.existsSync(from)) {
        try { fs.copyFileSync(from, to); } catch { /* keep going */ }
      }
    }
    fs.copyFileSync(src, backupFile(1));
  } catch (err) {
    console.error('[fans] backup failed:', err);
  }
}

function loadReminderEvents(): ReminderEvent[] {
  if (reminderEvents) return reminderEvents;
  try {
    const raw = JSON.parse(fs.readFileSync(reminderEventsFile(), 'utf8'));
    reminderEvents = Array.isArray(raw) ? raw : [];
  } catch {
    reminderEvents = [];
  }
  return reminderEvents;
}

function scheduleFlush() {
  if (flushTimer) return;
  flushTimer = setTimeout(() => {
    flushTimer = null;
    flush();
  }, FLUSH_MS);
}

/**
 * Append a gift record to gifts.jsonl RIGHT NOW (synchronous). Gifts are money
 * data — we never let them sit in the in-memory buffer waiting for the 2s
 * debounce, so the crash-loss window for a gift is effectively zero.
 * Falls back to buffering only if the immediate append fails.
 */
function appendGiftNow(line: string) {
  try {
    // Drain any previously-buffered gifts first to preserve order, then append.
    if (giftBuffer.length > 0) {
      fs.appendFileSync(giftsFile(), giftBuffer.join(''));
      giftBuffer = [];
    }
    fs.appendFileSync(giftsFile(), line);
  } catch (err) {
    console.error('[fans] immediate gift append failed, buffering:', err);
    giftBuffer.push(line); // retried on the next flush()
  }
}

export function flush() {
  try {
    if (giftBuffer.length > 0) {
      fs.appendFileSync(giftsFile(), giftBuffer.join(''));
      giftBuffer = [];
    }
    if (fansDirty && fans) {
      const obj: Record<string, Fan> = {};
      for (const [k, v] of fans) obj[k] = v;
      const envelope: FansEnvelope = { version: FANS_SCHEMA_VERSION, fans: obj };
      const tmp = fansFile() + '.tmp';
      fs.writeFileSync(tmp, JSON.stringify(envelope));
      fs.renameSync(tmp, fansFile());
      fansDirty = false;
    }
  } catch (err) {
    console.error('[fans] flush failed:', err);
  }
}

function markDirty() {
  fansDirty = true;
  scheduleFlush();
}

function saveReminderEvents() {
  try {
    fs.writeFileSync(reminderEventsFile(), JSON.stringify(loadReminderEvents()));
  } catch (err) {
    console.error('[fans] reminder events save failed:', err);
  }
}

// ---------------------------------------------------------------------------
// ingestion (called from the live pipeline — must never throw)

type Brief = { uniqueId: string; nickname: string; profilePictureUrl?: string | null };

function upsertSeen(user: Brief, ts: number): Fan {
  const map = loadFans();
  let fan = map.get(user.uniqueId);
  if (!fan) {
    fan = {
      uniqueId: user.uniqueId,
      nickname: user.nickname || user.uniqueId,
      avatarUrl: user.profilePictureUrl ?? null,
      firstSeenAt: ts,
      lastSeenAt: ts,
      totalDiamonds: 0,
      giftCount: 0,
      tags: [],
      notes: '',
    };
    map.set(user.uniqueId, fan);
  } else {
    if (user.nickname) fan.nickname = user.nickname;
    if (user.profilePictureUrl) fan.avatarUrl = user.profilePictureUrl;
    if (ts > fan.lastSeenAt) fan.lastSeenAt = ts;
    if (ts < fan.firstSeenAt) fan.firstSeenAt = ts;
  }
  markDirty();
  return fan;
}

/** Live-event hook. Resilient: catches everything so the stream pipeline never breaks. */
export function ingestLiveEvent(evt: any, sessionId?: string | null) {
  try {
    if (!evt || !evt.user?.uniqueId || evt.user.uniqueId === 'unknown') return;
    const ts = evt.ts ?? Date.now();
    switch (evt.type) {
      case 'gift': {
        const fan = upsertSeen(evt.user, ts);
        const diamonds = (evt.diamondCount ?? 0) * (evt.repeatCount ?? 1);
        fan.totalDiamonds += diamonds;
        fan.giftCount += 1;
        fan.lastGiftAt = ts;
        const rec: GiftRecord = {
          id: `${ts}-${Math.random().toString(36).slice(2, 8)}`,
          fanUniqueId: fan.uniqueId,
          fanNickname: fan.nickname,
          giftName: evt.giftName ?? 'Gift',
          diamonds,
          repeatCount: evt.repeatCount ?? 1,
          sessionId: sessionId ?? undefined,
          at: ts,
        };
        // Gifts are money — persist the record to disk immediately rather than
        // waiting for the debounced flush. The fans.json map (totals) still
        // rides the debounce via markDirty().
        appendGiftNow(JSON.stringify(rec) + '\n');
        markDirty();
        break;
      }
      case 'chat':
      case 'follow':
      case 'member':
      case 'like':
      case 'share':
      case 'subscribe':
        upsertSeen(evt.user, ts);
        break;
    }
  } catch (err) {
    console.error('[fans] ingest failed:', err);
  }
}

// ---------------------------------------------------------------------------
// CRUD

export type ListFansQuery = {
  search?: string;
  tag?: string;
  tier?: Tier;
  page?: number;
  pageSize?: number;
  sort?: 'diamonds' | 'lastSeen' | 'name';
};

export type ListFansResult = {
  data: FanWithTier[];
  total: number;
  page: number;
  pageSize: number;
  allTags: string[];
};

function withTier(f: Fan): FanWithTier {
  return { ...f, tier: tierForDiamonds(f.totalDiamonds) };
}

export function listFans(q: ListFansQuery = {}): ListFansResult {
  const page = Math.max(1, q.page ?? 1);
  const pageSize = Math.min(200, Math.max(1, q.pageSize ?? 25));
  const search = (q.search ?? '').trim().toLowerCase();
  const allTags = new Set<string>();
  let rows: FanWithTier[] = [];
  for (const f of loadFans().values()) {
    for (const t of f.tags) allTags.add(t);
    const fwt = withTier(f);
    if (search) {
      const hay = `${f.uniqueId} ${f.nickname} ${f.displayName ?? ''} ${f.notes}`.toLowerCase();
      if (!hay.includes(search)) continue;
    }
    if (q.tag && !f.tags.includes(q.tag)) continue;
    if (q.tier && fwt.tier !== q.tier) continue;
    rows.push(fwt);
  }
  const sort = q.sort ?? 'diamonds';
  rows.sort((a, b) =>
    sort === 'name'
      ? (a.displayName || a.nickname).localeCompare(b.displayName || b.nickname)
      : sort === 'lastSeen'
        ? b.lastSeenAt - a.lastSeenAt
        : b.totalDiamonds - a.totalDiamonds,
  );
  const total = rows.length;
  rows = rows.slice((page - 1) * pageSize, page * pageSize);
  return { data: rows, total, page, pageSize, allTags: [...allTags].sort() };
}

export function getFan(uniqueId: string): FanWithTier | null {
  const f = loadFans().get(uniqueId);
  return f ? withTier(f) : null;
}

/** Raw (untiered) fan record — used by the CRM profile builder for strength signals. */
export function getRawFan(uniqueId: string): Fan | null {
  return loadFans().get((uniqueId ?? '').replace(/^@/, '').trim()) ?? null;
}

/**
 * Set a single typed custom-field VALUE on a fan (defs are global, in settings).
 * Fail-safe: returns ok:false rather than throwing. A null/undefined value
 * deletes the key. Ensures the fan exists (creates a manual stub if not) so the
 * 360 profile can set fields on a fan the creator just opened.
 */
export function setFanField(
  uniqueId: string,
  key: string,
  value: unknown,
): { ok: boolean; fan?: FanWithTier; error?: string } {
  const uid = (uniqueId ?? '').replace(/^@/, '').trim();
  const k = String(key ?? '').trim();
  if (!uid) return { ok: false, error: 'Username is required' };
  if (!k) return { ok: false, error: 'Field key is required' };
  let fan = loadFans().get(uid);
  if (!fan) {
    const res = upsertFan({ uniqueId: uid });
    if (!res.ok) return { ok: false, error: res.error ?? 'Could not create fan' };
    fan = loadFans().get(uid)!;
  }
  const cf = { ...(fan.customFields ?? {}) };
  if (value === null || value === undefined || value === '') delete cf[k];
  else cf[k] = value;
  fan.customFields = cf;
  markDirty();
  flush();
  return { ok: true, fan: withTier(fan) };
}

export type UpsertFanPayload = {
  uniqueId: string;
  nickname?: string;
  displayName?: string;
  tags?: string[];
  notes?: string;
  birthday?: string | null; // MM-DD
  totalDiamonds?: number;
};

/** Normalize birthday into 'MM-DD' or undefined. Accepts MM-DD, YYYY-MM-DD, DD/MM. */
export function normalizeBirthday(input: string | null | undefined): string | undefined {
  if (!input) return undefined;
  const s = String(input).trim();
  if (!s) return undefined;
  let m = s.match(/^(\d{4})-(\d{2})-(\d{2})/); // ISO
  if (m) return `${m[2]}-${m[3]}`;
  m = s.match(/^(\d{1,2})-(\d{1,2})$/);
  if (m) return `${m[1].padStart(2, '0')}-${m[2].padStart(2, '0')}`;
  m = s.match(/^(\d{1,2})\/(\d{1,2})/); // DD/MM
  if (m) return `${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}`;
  return undefined;
}

export function upsertFan(payload: UpsertFanPayload): { ok: boolean; fan?: FanWithTier; created?: boolean; error?: string } {
  const uid = (payload.uniqueId ?? '').replace(/^@/, '').trim();
  if (!uid) return { ok: false, error: 'Username is required' };
  const map = loadFans();
  const now = Date.now();
  let fan = map.get(uid);
  const created = !fan;
  if (!fan) {
    fan = {
      uniqueId: uid,
      nickname: payload.nickname || payload.displayName || uid,
      firstSeenAt: now,
      lastSeenAt: now,
      totalDiamonds: 0,
      giftCount: 0,
      tags: [],
      notes: '',
      createdManually: true,
    };
    map.set(uid, fan);
  }
  if (payload.nickname !== undefined) fan.nickname = payload.nickname || fan.nickname;
  if (payload.displayName !== undefined) fan.displayName = payload.displayName || undefined;
  if (payload.tags !== undefined) fan.tags = dedupeTags(payload.tags);
  if (payload.notes !== undefined) fan.notes = payload.notes.slice(0, 5000);
  if (payload.birthday !== undefined) fan.birthday = normalizeBirthday(payload.birthday);
  if (payload.totalDiamonds !== undefined && created) fan.totalDiamonds = Math.max(0, Math.floor(payload.totalDiamonds));
  markDirty();
  return { ok: true, fan: withTier(fan), created };
}

function dedupeTags(tags: string[]): string[] {
  const out: string[] = [];
  for (const t of tags) {
    const v = t.trim();
    if (v && !out.some((x) => x.toLowerCase() === v.toLowerCase())) out.push(v);
  }
  return out.slice(0, 50);
}

export function updateFan(
  uniqueId: string,
  patch: { tags?: string[]; notes?: string; birthday?: string | null; displayName?: string },
): { ok: boolean; fan?: FanWithTier; error?: string } {
  const fan = loadFans().get(uniqueId);
  if (!fan) return { ok: false, error: 'Fan not found' };
  if (patch.tags !== undefined) fan.tags = dedupeTags(patch.tags);
  if (patch.notes !== undefined) fan.notes = patch.notes.slice(0, 5000);
  if (patch.birthday !== undefined) fan.birthday = normalizeBirthday(patch.birthday);
  if (patch.displayName !== undefined) fan.displayName = patch.displayName.trim() || undefined;
  markDirty();
  return { ok: true, fan: withTier(fan) };
}

export function bulkTag(ids: string[], add: string[], remove: string[]): { ok: boolean; updated: number } {
  const map = loadFans();
  let updated = 0;
  for (const id of ids) {
    const fan = map.get(id);
    if (!fan) continue;
    const before = fan.tags.join(' ');
    fan.tags = dedupeTags([...fan.tags.filter((t) => !remove.some((r) => r.toLowerCase() === t.toLowerCase())), ...add]);
    if (fan.tags.join(' ') !== before) updated++;
  }
  if (updated) markDirty();
  return { ok: true, updated };
}

// ---------------------------------------------------------------------------
// gifts

export function logGift(payload: {
  uniqueId: string;
  nickname?: string;
  giftName: string;
  diamonds: number;
  at?: number;
}): { ok: boolean; error?: string } {
  const uid = (payload.uniqueId ?? '').replace(/^@/, '').trim();
  if (!uid) return { ok: false, error: 'Fan username is required' };
  if (!payload.giftName?.trim()) return { ok: false, error: 'Gift name is required' };
  const diamonds = Math.floor(payload.diamonds);
  if (!Number.isFinite(diamonds) || diamonds <= 0) return { ok: false, error: 'Diamonds must be a positive number' };
  const at = payload.at && payload.at > 0 ? payload.at : Date.now();
  const res = upsertFan({ uniqueId: uid, nickname: payload.nickname });
  if (!res.ok || !res.fan) return { ok: false, error: res.error ?? 'Could not upsert fan' };
  const fan = loadFans().get(uid)!;
  fan.totalDiamonds += diamonds;
  fan.giftCount += 1;
  if (!fan.lastGiftAt || at > fan.lastGiftAt) fan.lastGiftAt = at;
  const rec: GiftRecord = {
    id: `${at}-${Math.random().toString(36).slice(2, 8)}`,
    fanUniqueId: uid,
    fanNickname: fan.nickname,
    giftName: payload.giftName.trim(),
    diamonds,
    repeatCount: 1,
    manual: true,
    at,
  };
  appendGiftNow(JSON.stringify(rec) + '\n');
  markDirty();
  flush(); // manual actions persist the fans-map immediately too
  return { ok: true };
}

function readAllGifts(): GiftRecord[] {
  flush();
  const out: GiftRecord[] = [];
  try {
    const raw = fs.readFileSync(giftsFile(), 'utf8');
    for (const line of raw.split('\n')) {
      if (!line.trim()) continue;
      try {
        const rec = JSON.parse(line);
        if (rec && rec.fanUniqueId) out.push(rec);
      } catch {
        /* skip corrupt line */
      }
    }
  } catch {
    /* no gifts yet */
  }
  return out;
}

/** All gift records for a single fan, newest-first. Used by the CRM timeline. */
export function giftsForFan(uniqueId: string, limit = 300): GiftRecord[] {
  const uid = (uniqueId ?? '').replace(/^@/, '').trim();
  if (!uid) return [];
  const rows = readAllGifts().filter((g) => g.fanUniqueId === uid);
  rows.sort((a, b) => b.at - a.at);
  return rows.slice(0, Math.max(1, limit));
}

/** Sum of diamonds a fan received since `sinceMs`. */
export function diamondsSince(uniqueId: string, sinceMs: number): number {
  const uid = (uniqueId ?? '').replace(/^@/, '').trim();
  if (!uid) return 0;
  let sum = 0;
  for (const g of readAllGifts()) {
    if (g.fanUniqueId === uid && g.at >= sinceMs) sum += g.diamonds;
  }
  return sum;
}

export type ListGiftsQuery = {
  range?: '7d' | '30d' | '90d' | 'all';
  fan?: string;
  page?: number;
  pageSize?: number;
};

export type ListGiftsResult = {
  data: GiftRecord[];
  total: number;
  page: number;
  pageSize: number;
  diamondsWeek: number;
  diamondsMonth: number;
  diamondsAll: number;
};

export function listGifts(q: ListGiftsQuery = {}): ListGiftsResult {
  const page = Math.max(1, q.page ?? 1);
  const pageSize = Math.min(200, Math.max(1, q.pageSize ?? 25));
  const all = readAllGifts();
  const now = Date.now();
  const week = now - 7 * 86400000;
  const month = now - 30 * 86400000;
  let diamondsWeek = 0, diamondsMonth = 0, diamondsAll = 0;
  for (const g of all) {
    diamondsAll += g.diamonds;
    if (g.at >= week) diamondsWeek += g.diamonds;
    if (g.at >= month) diamondsMonth += g.diamonds;
  }
  const cutoff =
    q.range === '7d' ? week : q.range === '90d' ? now - 90 * 86400000 : q.range === 'all' ? 0 : month;
  const fanQ = (q.fan ?? '').replace(/^@/, '').trim().toLowerCase();
  let rows = all.filter(
    (g) =>
      g.at >= cutoff &&
      (!fanQ || g.fanUniqueId.toLowerCase().includes(fanQ) || g.fanNickname.toLowerCase().includes(fanQ)),
  );
  rows.sort((a, b) => b.at - a.at);
  const total = rows.length;
  rows = rows.slice((page - 1) * pageSize, page * pageSize);
  return { data: rows, total, page, pageSize, diamondsWeek, diamondsMonth, diamondsAll };
}

// ---------------------------------------------------------------------------
// thank-after-LIVE reminders (event-sourced like reminder-events)

type ThankRequest = { uniqueId: string; date: string; at: number };
let thankRequests: ThankRequest[] | null = null;

function loadThankRequests(): ThankRequest[] {
  if (thankRequests) return thankRequests;
  try {
    const raw = JSON.parse(fs.readFileSync(thankRemindersFile(), 'utf8'));
    thankRequests = Array.isArray(raw) ? raw : [];
  } catch {
    thankRequests = [];
  }
  return thankRequests;
}

function saveThankRequests() {
  try {
    fs.writeFileSync(thankRemindersFile(), JSON.stringify(loadThankRequests()));
  } catch (err) {
    console.error('[fans] thank reminders save failed:', err);
  }
}

/** Queue a "thank after LIVE" reminder due today. Dedup per fan per day. */
export function addThankReminder(uniqueId: string): { ok: boolean; deduped?: boolean; error?: string } {
  const uid = (uniqueId ?? '').replace(/^@/, '').trim();
  if (!uid) return { ok: false, error: 'Username is required' };
  // Ensure the fan exists in the ledger so the reminder can render.
  if (!loadFans().get(uid)) upsertFan({ uniqueId: uid });
  const date = new Date().toISOString().slice(0, 10);
  const list = loadThankRequests();
  if (list.some((t) => t.uniqueId === uid && t.date === date)) return { ok: true, deduped: true };
  list.push({ uniqueId: uid, date, at: Date.now() });
  saveThankRequests();
  return { ok: true };
}

// ---------------------------------------------------------------------------
// reminders

function birthdayDaysAway(mmdd: string, now = new Date()): number | null {
  const m = mmdd.match(/^(\d{2})-(\d{2})$/);
  if (!m) return null;
  const month = Number(m[1]), day = Number(m[2]);
  if (month < 1 || month > 12 || day < 1 || day > 31) return null;
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  let next = new Date(now.getFullYear(), month - 1, day);
  if (next < today) next = new Date(now.getFullYear() + 1, month - 1, day);
  return Math.round((next.getTime() - today.getTime()) / 86400000);
}

export function listReminders(withinDays?: number): Reminder[] {
  const rules = rulesGetter();
  const window = withinDays ?? rules.birthdayWindowDays;
  const events = loadReminderEvents();
  const now = Date.now();
  const yearKey = new Date().getFullYear();
  const isSuppressed = (id: string, doneKey: string): boolean => {
    for (let i = events.length - 1; i >= 0; i--) {
      const e = events[i];
      if (e.reminderId !== id) continue;
      if (e.action === 'done') {
        // done suppresses for the same cycle (id already encodes year/bucket)
        return true;
      }
      if (e.action === 'snooze' && e.until && e.until > now) return true;
      // an expired snooze is the latest event → not suppressed
      return false;
    }
    void doneKey;
    return false;
  };

  const out: Reminder[] = [];
  for (const f of loadFans().values()) {
    const fan = withTier(f);
    if (f.birthday) {
      const days = birthdayDaysAway(f.birthday);
      if (days !== null && days <= window) {
        const id = `bday:${f.uniqueId}:${yearKey}`;
        if (!isSuppressed(id, String(yearKey))) {
          out.push({ id, kind: 'birthday', fan, days, date: f.birthday });
        }
      }
    }
    if ((fan.tier === 'VIP' || fan.tier === 'Whale') && f.lastSeenAt) {
      const daysSince = Math.floor((now - f.lastSeenAt) / 86400000);
      if (daysSince > rules.quietDays) {
        // bucket by month so a "done" silences it for ~30 days
        const bucket = Math.floor(now / (30 * 86400000));
        const id = `quiet:${f.uniqueId}:${bucket}`;
        if (!isSuppressed(id, String(bucket))) {
          out.push({ id, kind: 'quiet', fan, days: daysSince });
        }
      }
    }
  }
  for (const t of loadThankRequests()) {
    const f = loadFans().get(t.uniqueId);
    if (!f) continue;
    const days = Math.max(0, Math.floor((now - new Date(t.date + 'T00:00:00').getTime()) / 86400000));
    if (days > window) continue;
    const id = `thank:${t.uniqueId}:${t.date}`;
    if (!isSuppressed(id, t.date)) out.push({ id, kind: 'thank', fan: withTier(f), days });
  }
  out.sort((a, b) => (a.kind === b.kind ? a.days - b.days : a.kind === 'birthday' ? -1 : a.kind === 'thank' && b.kind === 'quiet' ? -1 : 1));
  return out;
}

export function reminderAction(id: string, action: 'done' | 'snooze', days?: number): { ok: boolean; error?: string } {
  if (!id) return { ok: false, error: 'Missing reminder id' };
  const d = Math.min(30, Math.max(1, Math.floor(days ?? 7)));
  const evt: ReminderEvent = {
    reminderId: id,
    action,
    until: action === 'snooze' ? Date.now() + d * 86400000 : undefined,
    at: Date.now(),
  };
  loadReminderEvents().push(evt);
  saveReminderEvents();
  return { ok: true };
}

/**
 * Record a thank-you: stamps `lastThankedAt` on the fan and marks any open
 * thank/birthday reminders for them as done.
 */
export function markThanked(uniqueId: string): { ok: boolean; fan?: FanWithTier; error?: string } {
  const uid = (uniqueId ?? '').replace(/^@/, '').trim();
  if (!uid) return { ok: false, error: 'Username is required' };
  const fan = loadFans().get(uid);
  if (!fan) return { ok: false, error: 'Fan not found' };
  fan.lastThankedAt = Date.now();
  markDirty();
  // Close any open thank / birthday reminders for this fan.
  const events = loadReminderEvents();
  let changed = false;
  for (const r of listReminders()) {
    if (r.fan.uniqueId !== uid) continue;
    if (r.kind !== 'thank' && r.kind !== 'birthday') continue;
    events.push({ reminderId: r.id, action: 'done', at: Date.now() });
    changed = true;
  }
  if (changed) saveReminderEvents();
  flush();
  return { ok: true, fan: withTier(fan) };
}

// ---------------------------------------------------------------------------
// CSV import / export

export function escapeCsv(val: string): string {
  if (val.includes(',') || val.includes('"') || val.includes('\n') || val.includes('\r')) {
    return `"${val.replace(/"/g, '""')}"`;
  }
  return val;
}

/** RFC-4180-ish CSV parser: quoted cells, doubled inner quotes, CRLF. */
export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = '';
  let inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (inQuotes) {
      if (ch === '"') {
        if (text[i + 1] === '"') { cell += '"'; i++; }
        else inQuotes = false;
      } else cell += ch;
    } else if (ch === '"') {
      inQuotes = true;
    } else if (ch === ',') {
      row.push(cell); cell = '';
    } else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && text[i + 1] === '\n') i++;
      row.push(cell); cell = '';
      if (row.length > 1 || row[0] !== '') rows.push(row);
      row = [];
    } else cell += ch;
  }
  row.push(cell);
  if (row.length > 1 || row[0] !== '') rows.push(row);
  return rows;
}

export type ImportResult = { ok: boolean; created: number; updated: number; skipped: number; errors: string[] };

/** Expected columns: username, displayName, birthday, tags, notes, totalDiamonds (header row required; order free). */
export function importCsv(csvText: string): ImportResult {
  const result: ImportResult = { ok: true, created: 0, updated: 0, skipped: 0, errors: [] };
  const rows = parseCsv(csvText);
  if (rows.length === 0) return { ...result, ok: false, errors: ['CSV is empty'] };
  const header = rows[0].map((h) => h.trim().toLowerCase());
  const col = (name: string) => header.indexOf(name.toLowerCase());
  const iUser = col('username');
  if (iUser === -1) return { ...result, ok: false, errors: ['Missing required "username" column in header row'] };
  const iDisplay = col('displayname');
  const iBirthday = col('birthday');
  const iTags = col('tags');
  const iNotes = col('notes');
  const iDiamonds = col('totaldiamonds');

  for (let r = 1; r < rows.length; r++) {
    const cells = rows[r];
    const username = (cells[iUser] ?? '').replace(/^@/, '').trim();
    if (!username) { result.skipped++; continue; }
    try {
      const tags = iTags >= 0 && cells[iTags] ? cells[iTags].split(/[;|]/).map((t) => t.trim()).filter(Boolean) : undefined;
      const diamondsRaw = iDiamonds >= 0 ? Number(cells[iDiamonds]) : NaN;
      const existing = loadFans().get(username);
      const res = upsertFan({
        uniqueId: username,
        displayName: iDisplay >= 0 ? cells[iDisplay] || undefined : undefined,
        birthday: iBirthday >= 0 ? cells[iBirthday] || undefined : undefined,
        tags: tags !== undefined ? dedupeTags([...(existing?.tags ?? []), ...tags]) : undefined,
        notes: iNotes >= 0 && cells[iNotes] ? cells[iNotes] : undefined,
        totalDiamonds: Number.isFinite(diamondsRaw) && diamondsRaw > 0 ? diamondsRaw : undefined,
      });
      if (!res.ok) {
        result.errors.push(`Row ${r + 1}: ${res.error}`);
      } else if (res.created) result.created++;
      else result.updated++;
    } catch (err: any) {
      result.errors.push(`Row ${r + 1}: ${err?.message ?? String(err)}`);
    }
  }
  flush();
  return result;
}

export function exportCsvText(): string {
  const rows = [['username', 'displayName', 'nickname', 'tier', 'totalDiamonds', 'giftCount', 'tags', 'notes', 'birthday', 'firstSeenAt', 'lastSeenAt', 'lastGiftAt'].join(',')];
  const fansSorted = [...loadFans().values()].sort((a, b) => b.totalDiamonds - a.totalDiamonds);
  for (const f of fansSorted) {
    rows.push([
      escapeCsv(f.uniqueId),
      escapeCsv(f.displayName ?? ''),
      escapeCsv(f.nickname),
      tierForDiamonds(f.totalDiamonds),
      String(f.totalDiamonds),
      String(f.giftCount),
      escapeCsv(f.tags.join('; ')),
      escapeCsv(f.notes),
      f.birthday ?? '',
      new Date(f.firstSeenAt).toISOString(),
      new Date(f.lastSeenAt).toISOString(),
      f.lastGiftAt ? new Date(f.lastGiftAt).toISOString() : '',
    ].join(','));
  }
  return rows.join('\n');
}

/**
 * Gifts ledger as CSV. Optionally filtered to the same range/fan the UI is
 * showing so "Export CSV" exports exactly what's on screen, newest first.
 */
export function exportGiftsCsvText(q: ListGiftsQuery = {}): string {
  const all = readAllGifts();
  const now = Date.now();
  const cutoff =
    q.range === '7d' ? now - 7 * 86400000
    : q.range === '90d' ? now - 90 * 86400000
    : q.range === 'all' ? 0
    : q.range === '30d' ? now - 30 * 86400000
    : 0;
  const fanQ = (q.fan ?? '').replace(/^@/, '').trim().toLowerCase();
  const rows = all
    .filter(
      (g) =>
        g.at >= cutoff &&
        (!fanQ || g.fanUniqueId.toLowerCase().includes(fanQ) || g.fanNickname.toLowerCase().includes(fanQ)),
    )
    .sort((a, b) => b.at - a.at);
  const out = [['date', 'fanUsername', 'fanNickname', 'giftName', 'diamonds', 'repeatCount', 'source', 'sessionId'].join(',')];
  for (const g of rows) {
    const source = g.manual ? 'Manual' : g.sessionId?.startsWith('multi:') ? 'Multi-room' : g.sessionId ? 'LIVE' : '';
    out.push([
      new Date(g.at).toISOString(),
      escapeCsv(g.fanUniqueId),
      escapeCsv(g.fanNickname),
      escapeCsv(g.giftName),
      String(g.diamonds),
      String(g.repeatCount),
      source,
      escapeCsv(g.sessionId ?? ''),
    ].join(','));
  }
  return out.join('\n');
}

export function clearAll(): { ok: boolean } {
  fans = new Map();
  reminderEvents = [];
  thankRequests = [];
  giftBuffer = [];
  fansDirty = true;
  try {
    fs.rmSync(giftsFile(), { force: true });
    fs.rmSync(reminderEventsFile(), { force: true });
    fs.rmSync(thankRemindersFile(), { force: true });
  } catch (err) {
    console.error('[fans] clear failed:', err);
  }
  flush();
  return { ok: true };
}

export function fanCount(): number {
  return loadFans().size;
}
