import { create } from 'zustand';
import type { ModerationSettings } from '../types';

export type UserTag = 'vip' | 'regular' | 'troll' | 'blocked';

type ModerationState = {
  blockedUsers: Set<string>;
  blockedKeywords: string[];
  userTags: Map<string, UserTag>;
  spamFilterEnabled: boolean;
  spamThreshold: number;
  loaded: boolean;

  load: () => Promise<void>;
  blockUser: (uniqueId: string) => void;
  unblockUser: (uniqueId: string) => void;
  addKeyword: (kw: string) => void;
  removeKeyword: (kw: string) => void;
  setUserTag: (uniqueId: string, tag: UserTag | null) => void;
  toggleSpamFilter: () => void;
  setSpamThreshold: (n: number) => void;
  isFiltered: (uniqueId: string, text?: string) => boolean;
};

const spamCache = new Map<string, { count: number; firstTs: number }>();

/** Serialize the persistable slice into the IPC-friendly shape (arrays/records). */
function snapshot(s: ModerationState): ModerationSettings {
  return {
    blockedUsers: [...s.blockedUsers],
    blockedKeywords: s.blockedKeywords,
    userTags: Object.fromEntries(s.userTags),
    spamFilterEnabled: s.spamFilterEnabled,
    spamThreshold: s.spamThreshold,
  };
}

/**
 * Persist the current moderation config. Save-on-change, mirroring the
 * watchlist/tracked persistence pattern. Best-effort: failures (e.g. browser
 * demo before the bridge mock is ready) are swallowed.
 */
function persist(get: () => ModerationState): void {
  if (!get().loaded) return; // don't clobber stored config before the initial load
  try {
    void window.tiktok?.setModeration?.(snapshot(get()));
  } catch {
    /* ignore — persistence is best-effort */
  }
}

export const useModeration = create<ModerationState>((set, get) => ({
  blockedUsers: new Set(),
  blockedKeywords: [],
  userTags: new Map(),
  spamFilterEnabled: false,
  spamThreshold: 20,
  loaded: false,

  load: async () => {
    try {
      const settings = await window.tiktok.getSettings();
      const m = settings.moderation;
      if (m) {
        set({
          blockedUsers: new Set(m.blockedUsers ?? []),
          blockedKeywords: m.blockedKeywords ?? [],
          userTags: new Map(Object.entries(m.userTags ?? {}) as [string, UserTag][]),
          spamFilterEnabled: !!m.spamFilterEnabled,
          spamThreshold: m.spamThreshold || 20,
          loaded: true,
        });
        return;
      }
    } catch {
      /* fall through to mark loaded so future changes still persist */
    }
    set({ loaded: true });
  },

  blockUser: (uniqueId) => {
    set((s) => {
      const next = new Set(s.blockedUsers);
      next.add(uniqueId);
      return { blockedUsers: next };
    });
    persist(get);
  },

  unblockUser: (uniqueId) => {
    set((s) => {
      const next = new Set(s.blockedUsers);
      next.delete(uniqueId);
      return { blockedUsers: next };
    });
    persist(get);
  },

  addKeyword: (kw) => {
    set((s) => ({
      blockedKeywords: [...s.blockedKeywords, kw.toLowerCase().trim()],
    }));
    persist(get);
  },

  removeKeyword: (kw) => {
    set((s) => ({
      blockedKeywords: s.blockedKeywords.filter((k) => k !== kw),
    }));
    persist(get);
  },

  setUserTag: (uniqueId, tag) => {
    set((s) => {
      const next = new Map(s.userTags);
      if (tag) next.set(uniqueId, tag);
      else next.delete(uniqueId);
      return { userTags: next };
    });
    persist(get);
  },

  toggleSpamFilter: () => {
    set((s) => ({ spamFilterEnabled: !s.spamFilterEnabled }));
    persist(get);
  },

  setSpamThreshold: (n) => {
    set({ spamThreshold: n });
    persist(get);
  },

  isFiltered: (uniqueId, text) => {
    const s = get();
    if (s.blockedUsers.has(uniqueId)) return true;
    if (s.userTags.get(uniqueId) === 'blocked') return true;
    if (text) {
      const lower = text.toLowerCase();
      for (const kw of s.blockedKeywords) {
        if (lower.includes(kw)) return true;
      }
    }
    if (s.spamFilterEnabled && text) {
      const now = Date.now();
      const entry = spamCache.get(uniqueId);
      if (entry && now - entry.firstTs < 10000) {
        entry.count++;
        if (entry.count > s.spamThreshold) return true;
      } else {
        spamCache.set(uniqueId, { count: 1, firstTs: now });
      }
    }
    return false;
  },
}));
