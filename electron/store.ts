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
