import { create } from 'zustand';
import type { ConnectionStatus, LiveEvent, RoomInfo, UserBrief } from '../types';

const FEED_MAX = 5000;
const TPS_WINDOW_MS = 5000;
const TALLIES_MAX = 2000;
const MEMBERS_MAX = 2000;

type FeedItem = LiveEvent & { id: string };

let idCounter = 0;
const nextId = () => `${Date.now()}-${idCounter++}`;

export type Tally = {
  user: UserBrief;
  likes: number;
  diamonds: number;
  comments: number;
};

export type RoomMember = {
  user: UserBrief;
  joinedAt: number;
  lastSeenAt: number;
  inRoom: boolean;
};

type State = {
  status: ConnectionStatus;
  errorMessage: string | null;
  username: string;
  /** The moment YOU connected to the room — drives the host-bar session timer.
   *  Never overwritten by the stream's own start time (see streamStartedAt). */
  connectedAt: number | null;
  /** When the LIVE itself went live (from roomInfo.startedAt), if known.
   *  Kept separate so the session timer stays honest about YOUR uptime. */
  streamStartedAt: number | null;
  roomInfo: RoomInfo | null;

  totalLikes: number;
  totalDiamonds: number;
  viewerCount: number;
  followCount: number;
  shareCount: number;
  giftCount: number;
  subscribeCount: number;
  commentCount: number;

  likeBeats: number[];

  comments: FeedItem[];
  gifts: FeedItem[];
  questions: FeedItem[];
  all: FeedItem[];
  captions: FeedItem[];

  tallies: Map<string, Tally>;
  roomMembers: Map<string, RoomMember>;
  selectedUserId: string | null;
  pinnedMessages: FeedItem[];

  setStatus: (s: ConnectionStatus, error?: string) => void;
  setUsername: (u: string) => void;
  selectUser: (uniqueId: string | null) => void;
  pinMessage: (item: FeedItem) => void;
  unpinMessage: (id: string) => void;
  reset: () => void;
  ingest: (evt: LiveEvent) => void;
  tps: () => number;
  recentForUser: (uniqueId: string, limit?: number) => FeedItem[];
};

const baseStats = {
  totalLikes: 0,
  totalDiamonds: 0,
  viewerCount: 0,
  followCount: 0,
  shareCount: 0,
  giftCount: 0,
  subscribeCount: 0,
  commentCount: 0,
  likeBeats: [] as number[],
  comments: [] as FeedItem[],
  gifts: [] as FeedItem[],
  questions: [] as FeedItem[],
  all: [] as FeedItem[],
  captions: [] as FeedItem[],
  connectedAt: null as number | null,
  streamStartedAt: null as number | null,
  roomInfo: null as RoomInfo | null,
  tallies: new Map<string, Tally>(),
  roomMembers: new Map<string, RoomMember>(),
  selectedUserId: null as string | null,
  pinnedMessages: [] as FeedItem[],
};

function bumpTally(
  map: Map<string, Tally>,
  user: UserBrief,
  patch: Partial<Pick<Tally, 'likes' | 'diamonds' | 'comments'>>,
): Map<string, Tally> {
  const existing = map.get(user.uniqueId);
  const next = new Map(map);
  if (existing) next.delete(user.uniqueId);
  const cur = existing ?? { user, likes: 0, diamonds: 0, comments: 0 };
  next.set(user.uniqueId, {
    user: { ...cur.user, ...user, profilePictureUrl: user.profilePictureUrl ?? cur.user.profilePictureUrl },
    likes: cur.likes + (patch.likes ?? 0),
    diamonds: cur.diamonds + (patch.diamonds ?? 0),
    comments: cur.comments + (patch.comments ?? 0),
  });
  if (next.size > TALLIES_MAX) {
    const overflow = next.size - TALLIES_MAX;
    const keys = next.keys();
    for (let i = 0; i < overflow; i++) next.delete(keys.next().value as string);
  }
  return next;
}

function touchMember(members: Map<string, RoomMember>, user: UserBrief, ts: number): Map<string, RoomMember> {
  const next = new Map(members);
  const existing = next.get(user.uniqueId);
  // Re-insert at the end so Map iteration order tracks recency (mirrors
  // bumpTally): the FIFO eviction below then drops the least-recently-seen.
  if (existing) next.delete(user.uniqueId);
  next.set(user.uniqueId, {
    user,
    joinedAt: existing?.joinedAt ?? ts,
    lastSeenAt: ts,
    inRoom: true,
  });
  if (next.size > MEMBERS_MAX) {
    const overflow = next.size - MEMBERS_MAX;
    const keys = next.keys();
    for (let i = 0; i < overflow; i++) next.delete(keys.next().value as string);
  }
  return next;
}

export const useStore = create<State>((set, get) => ({
  status: 'idle',
  errorMessage: null,
  username: '',
  ...baseStats,

  setStatus: (status, error) =>
    set((s) => ({
      status,
      errorMessage: error ?? null,
      connectedAt:
        status === 'connected' && !s.connectedAt ? Date.now() : status === 'connected' ? s.connectedAt : null,
    })),

  setUsername: (username) => set({ username }),

  selectUser: (uniqueId) => set({ selectedUserId: uniqueId }),

  pinMessage: (item) =>
    set((s) => ({
      pinnedMessages: s.pinnedMessages.some((p) => p.id === item.id)
        ? s.pinnedMessages
        : [item, ...s.pinnedMessages],
    })),

  unpinMessage: (id) =>
    set((s) => ({
      pinnedMessages: s.pinnedMessages.filter((p) => p.id !== id),
    })),

  reset: () => set({ ...baseStats, errorMessage: null }),

  ingest: (evt) => {
    const item: FeedItem = { ...evt, id: nextId() };
    const cutoff = Date.now() - TPS_WINDOW_MS;

    set((s) => {
      const all = [item, ...s.all].slice(0, FEED_MAX);
      switch (evt.type) {
        case 'like': {
          const beats = [...s.likeBeats.filter((t) => t > cutoff), evt.ts];
          return {
            all,
            totalLikes: Math.max(s.totalLikes + (evt.likeCount || 1), evt.totalLikeCount || 0),
            likeBeats: beats,
            tallies: bumpTally(s.tallies, evt.user, { likes: evt.likeCount || 1 }),
            roomMembers: touchMember(s.roomMembers, evt.user, evt.ts),
          };
        }
        case 'chat':
          return {
            all,
            comments: [item, ...s.comments].slice(0, FEED_MAX),
            commentCount: s.commentCount + 1,
            tallies: bumpTally(s.tallies, evt.user, { comments: 1 }),
            roomMembers: touchMember(s.roomMembers, evt.user, evt.ts),
          };
        case 'gift': {
          const total = (evt.diamondCount || 0) * (evt.repeatCount || 1);
          return {
            all,
            gifts: [item, ...s.gifts].slice(0, FEED_MAX),
            giftCount: s.giftCount + 1,
            totalDiamonds: s.totalDiamonds + total,
            tallies: bumpTally(s.tallies, evt.user, { diamonds: total }),
            roomMembers: touchMember(s.roomMembers, evt.user, evt.ts),
          };
        }
        case 'follow':
          return { all, followCount: s.followCount + 1, roomMembers: touchMember(s.roomMembers, evt.user, evt.ts) };
        case 'share':
          return { all, shareCount: s.shareCount + 1 };
        case 'subscribe':
          return { all, subscribeCount: s.subscribeCount + 1 };
        case 'questionNew':
          return { all, questions: [item, ...s.questions].slice(0, FEED_MAX) };
        case 'caption': {
          const last = s.captions[0];
          if (last && last.type === 'caption' && (last as any).sentenceId === evt.sentenceId) {
            if (!evt.definite) return { all: s.all };
            const updated = [item, ...s.captions.slice(1)];
            return { all: s.all, captions: updated };
          }
          if (!evt.definite) return { all: s.all };
          return { all: s.all, captions: [item, ...s.captions].slice(0, 500) };
        }
        case 'member':
          return { all, roomMembers: touchMember(s.roomMembers, evt.user, evt.ts) };
        case 'envelope':
        case 'emote':
        case 'linkMicBattle':
          return { all };
        case 'roomUser':
          return { all: s.all, viewerCount: evt.viewerCount };
        case 'roomInfo':
          return {
            all: s.all,
            roomInfo: evt.info,
            totalLikes: Math.max(s.totalLikes, evt.info.likeCount || 0),
            viewerCount: Math.max(s.viewerCount, evt.info.totalUserCount || 0),
            // Stream's own start time goes to streamStartedAt — connectedAt must
            // stay YOUR connect moment so the host-bar timer reads your uptime.
            streamStartedAt: evt.info.startedAt ?? s.streamStartedAt,
          };
        case 'streamEnd':
          return { all };
        default:
          return { all };
      }
    });
  },

  tps: () => {
    const cutoff = Date.now() - TPS_WINDOW_MS;
    const beats = get().likeBeats.filter((t) => t > cutoff);
    return beats.length / (TPS_WINDOW_MS / 1000);
  },

  recentForUser: (uniqueId, limit = 30) => {
    return get()
      .all.filter((e) => 'user' in e && (e as any).user?.uniqueId === uniqueId)
      .slice(0, limit);
  },
}));
