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
  watchlist: string[];
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
  return cache!;
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
