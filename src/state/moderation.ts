import { create } from 'zustand';

export type UserTag = 'vip' | 'regular' | 'troll' | 'blocked';

type ModerationState = {
  blockedUsers: Set<string>;
  blockedKeywords: string[];
  userTags: Map<string, UserTag>;
  spamFilterEnabled: boolean;
  spamThreshold: number;

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

export const useModeration = create<ModerationState>((set, get) => ({
  blockedUsers: new Set(),
  blockedKeywords: [],
  userTags: new Map(),
  spamFilterEnabled: false,
  spamThreshold: 20,

  blockUser: (uniqueId) =>
    set((s) => {
      const next = new Set(s.blockedUsers);
      next.add(uniqueId);
      return { blockedUsers: next };
    }),

  unblockUser: (uniqueId) =>
    set((s) => {
      const next = new Set(s.blockedUsers);
      next.delete(uniqueId);
      return { blockedUsers: next };
    }),

  addKeyword: (kw) =>
    set((s) => ({
      blockedKeywords: [...s.blockedKeywords, kw.toLowerCase().trim()],
    })),

  removeKeyword: (kw) =>
    set((s) => ({
      blockedKeywords: s.blockedKeywords.filter((k) => k !== kw),
    })),

  setUserTag: (uniqueId, tag) =>
    set((s) => {
      const next = new Map(s.userTags);
      if (tag) next.set(uniqueId, tag);
      else next.delete(uniqueId);
      return { userTags: next };
    }),

  toggleSpamFilter: () => set((s) => ({ spamFilterEnabled: !s.spamFilterEnabled })),

  setSpamThreshold: (n) => set({ spamThreshold: n }),

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
