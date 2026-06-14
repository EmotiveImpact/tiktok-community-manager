import { app } from 'electron';
import fs from 'node:fs';
import path from 'node:path';
import { settingsFile } from './paths';

export type UserNote = {
  uniqueId: string;
  nickname: string;
  notes: string;
  updatedAt: number;
};

export type WebhookConfig = {
  discordUrl: string;
  slackUrl: string;
  customUrl: string;
  events: {
    gifts: boolean;
    follows: boolean;
    keywords: boolean;
    milestones: boolean;
  };
};

export type TrackedUser = {
  uniqueId: string;
  nickname: string;
  addedAt: number;
};

export type WatchEntry = {
  username: string;
  notify: boolean;
  /** epoch ms of the last time this user was detected live, or null if never */
  lastSeen: number | null;
};

export type ModerationUserTag = 'vip' | 'regular' | 'troll' | 'blocked';

export type ModerationSettings = {
  blockedUsers: string[];
  blockedKeywords: string[];
  userTags: Record<string, ModerationUserTag>;
  spamFilterEnabled: boolean;
  spamThreshold: number;
};

export const DEFAULT_MODERATION: ModerationSettings = {
  blockedUsers: [],
  blockedKeywords: [],
  userTags: {},
  spamFilterEnabled: false,
  spamThreshold: 20,
};

export type EarningsSettings = {
  enabled: boolean;
  /** payout per 1,000 diamonds, in the selected currency */
  ratePer1000: number;
  currency: '£' | '$' | '€';
};

export type CommunitySettings = {
  /** VIP/Whale counts as "quiet" after this many days unseen */
  quietDays: number;
  /** birthday reminders surface within this many days */
  birthdayWindowDays: number;
  /** diamond cutoffs for tiers (must be ascending) */
  tiers: { regular: number; vip: number; whale: number };
};

export const DEFAULT_EARNINGS: EarningsSettings = { enabled: false, ratePer1000: 10, currency: '£' };
export const DEFAULT_COMMUNITY: CommunitySettings = {
  quietDays: 14,
  birthdayWindowDays: 30,
  tiers: { regular: 100, vip: 1000, whale: 10000 },
};
export const DEFAULT_THANK_TEMPLATE =
  'Hey {nickname}! Thank you so much for the {giftName} 💕 You made my stream!';

type Schema = {
  lastUsername: string;
  signApiKey: string;
  anthropicApiKey: string;
  autoConnect: boolean;
  chatLogEnabled: boolean;
  notes: Record<string, UserNote>;
  webhooks: WebhookConfig;
  watchlist: WatchEntry[];
  trackedUsers: TrackedUser[];
  thankTemplate: string;
  earnings: EarningsSettings;
  community: CommunitySettings;
  moderation: ModerationSettings;
};

const DEFAULTS: Schema = {
  lastUsername: '',
  signApiKey: '',
  anthropicApiKey: '',
  autoConnect: false,
  chatLogEnabled: false,
  notes: {},
  webhooks: {
    discordUrl: '',
    slackUrl: '',
    customUrl: '',
    events: { gifts: true, follows: true, keywords: false, milestones: true },
  },
  watchlist: [],
  trackedUsers: [],
  thankTemplate: DEFAULT_THANK_TEMPLATE,
  earnings: DEFAULT_EARNINGS,
  community: DEFAULT_COMMUNITY,
  moderation: DEFAULT_MODERATION,
};

let cache: Schema | null = null;

function file(): string {
  return settingsFile();
}

function legacyFile(): string {
  return path.join(app.getPath('userData'), 'settings.json');
}

function load(): Schema {
  if (cache) return cache;
  // Try Documents first, fall back to legacy userData (one-time migration)
  let raw: string | null = null;
  try {
    raw = fs.readFileSync(file(), 'utf8');
  } catch {
    try {
      raw = fs.readFileSync(legacyFile(), 'utf8');
      // migrate: write to new location
      fs.mkdirSync(path.dirname(file()), { recursive: true });
      fs.writeFileSync(file(), raw);
    } catch { /* nothing to migrate */ }
  }
  try {
    cache = raw ? { ...DEFAULTS, ...JSON.parse(raw) } : { ...DEFAULTS };
  } catch {
    cache = { ...DEFAULTS };
  }
  cache!.watchlist = normalizeWatchlist(cache!.watchlist);
  return cache!;
}

/**
 * Backward-compatible watchlist loader. Older builds persisted `string[]`;
 * current builds persist `WatchEntry[]`. Map any legacy string entries to
 * `{ username, notify: true, lastSeen: null }` and fill in missing fields on
 * partial objects so the rest of the app can rely on the shape.
 */
function normalizeWatchlist(raw: unknown): WatchEntry[] {
  if (!Array.isArray(raw)) return [];
  const out: WatchEntry[] = [];
  for (const item of raw) {
    if (typeof item === 'string') {
      const username = item.trim();
      if (username) out.push({ username, notify: true, lastSeen: null });
    } else if (item && typeof item === 'object' && typeof (item as any).username === 'string') {
      const e = item as Partial<WatchEntry>;
      const username = String(e.username).trim();
      if (!username) continue;
      out.push({
        username,
        notify: e.notify !== false,
        lastSeen: typeof e.lastSeen === 'number' ? e.lastSeen : null,
      });
    }
  }
  return out;
}

function save(data: Schema) {
  fs.mkdirSync(path.dirname(file()), { recursive: true });
  fs.writeFileSync(file(), JSON.stringify(data, null, 2));
}

export const settings = {
  get<K extends keyof Schema>(key: K, fallback?: Schema[K]): Schema[K] {
    const v = load()[key];
    return (v ?? fallback) as Schema[K];
  },
  set<K extends keyof Schema>(key: K, value: Schema[K]) {
    const data = load();
    data[key] = value;
    cache = data;
    save(data);
  },
};

/**
 * Record that a watchlist user was seen live at `at`. Persists `lastSeen` on
 * the matching watchlist entry. No-op if the user isn't on the watchlist.
 * Returns the updated entry (or null when not found) so callers can broadcast.
 */
export function recordWatchlistSeen(username: string, at: number): WatchEntry | null {
  const data = load();
  const list = normalizeWatchlist(data.watchlist);
  const idx = list.findIndex((e) => e.username === username);
  if (idx === -1) return null;
  const updated = { ...list[idx], lastSeen: at };
  list[idx] = updated;
  data.watchlist = list;
  cache = data;
  save(data);
  return updated;
}

export const notesStore = {
  all(): Record<string, UserNote> {
    return load().notes ?? {};
  },
  get(uniqueId: string): UserNote | null {
    return load().notes?.[uniqueId] ?? null;
  },
  set(uniqueId: string, nickname: string, notes: string): UserNote {
    const data = load();
    const next: UserNote = {
      uniqueId,
      nickname,
      notes,
      updatedAt: Date.now(),
    };
    data.notes = { ...data.notes, [uniqueId]: next };
    cache = data;
    save(data);
    return next;
  },
  delete(uniqueId: string) {
    const data = load();
    if (!data.notes?.[uniqueId]) return;
    const { [uniqueId]: _, ...rest } = data.notes;
    data.notes = rest;
    cache = data;
    save(data);
  },
};
