/**
 * Browser-dev bridge mock.
 *
 * The renderer normally talks to Electron through `window.tiktok` (preload bridge).
 * When the app is opened in a plain browser (vite dev / screenshots), that bridge
 * is absent. `installBridgeMock()` installs a type-safe stand-in that:
 *   - resolves every IPC call with sensible empty/no-op results
 *   - simulates a connection and emits a small stream of demo events so the
 *     feeds, stats and leaderboards render with data.
 */
import type {
  ConnectionStatus,
  LiveEvent,
  RoomInfo,
  SessionRecord,
  SessionSummary,
  UserBrief,
  UserNote,
  WebhookConfig,
} from '../types';

type TikTokBridge = Window['tiktok'];

const ok = { ok: true as const };

const DEMO_USERS: UserBrief[] = [
  { uniqueId: 'kendraaax2', nickname: 'Kendra ✨', profilePictureUrl: null, isFollower: true, topGifterRank: 1 },
  { uniqueId: 'autumnstar01', nickname: 'Autumn', profilePictureUrl: null, isSubscriber: true, isFollower: true, topGifterRank: 2 },
  { uniqueId: 'mochi.eats', nickname: 'Mochi', profilePictureUrl: null, isFollower: true, topGifterRank: 3 },
  { uniqueId: 'wandererSO', nickname: 'Wanderer', profilePictureUrl: null, isModerator: true },
  { uniqueId: 'gaminglittlelao', nickname: 'GamingLittleLao', profilePictureUrl: null, isFollower: true },
  { uniqueId: 'sarahbear', nickname: 'SarahBear 🐻', profilePictureUrl: null },
  { uniqueId: 'liamthekid', nickname: 'Liam', profilePictureUrl: null, isFollower: true },
  { uniqueId: 'pixie.dust', nickname: 'Pixie', profilePictureUrl: null, isSubscriber: true },
];

const DEMO_COMMENTS = [
  'This stream is amazing tonight!! 🔥',
  'first time catching you live!',
  'W host fr fr',
  'can you say hi to my sister Maya?',
  'the new setup looks so clean',
  'How long have you been streaming?',
  'LETS GOOO 🎉',
  'sending love from Toronto 🇨🇦',
  'what camera do you use?',
  'this song is a vibe',
];

const DEMO_GIFTS: { giftId: number; giftName: string; diamondCount: number }[] = [
  { giftId: 5655, giftName: 'Rose', diamondCount: 1 },
  { giftId: 5827, giftName: 'Finger Heart', diamondCount: 5 },
  { giftId: 6064, giftName: 'GG', diamondCount: 1 },
  { giftId: 5269, giftName: 'Galaxy', diamondCount: 1000 },
  { giftId: 6149, giftName: 'Lion', diamondCount: 29999 },
  { giftId: 5879, giftName: 'Doughnut', diamondCount: 30 },
];

const DEMO_ROOM: RoomInfo = {
  title: 'Friday night hangout 💖 come chat!',
  hostNickname: 'Rella',
  hostUniqueId: 'rella.live',
  hostAvatar: null,
  followerCount: 12846,
  totalUserCount: 1248,
  likeCount: 38420,
  hlsUrl: null,
  flvUrl: null,
  startedAt: Date.now() - 42 * 60 * 1000,
};

function pick<T>(arr: T[]): T {
  return arr[Math.floor(Math.random() * arr.length)];
}

export function installBridgeMock(): void {
  const statusListeners = new Set<(s: { status: ConnectionStatus; error?: string }) => void>();
  const eventListeners = new Set<(evt: LiveEvent) => void>();
  let timer: ReturnType<typeof setInterval> | null = null;
  let viewerCount = 1180;
  let totalLikes = 38420;
  const notes: Record<string, UserNote> = {};
  let tracked: Array<{ uniqueId: string; nickname: string; addedAt: number }> = [
    { uniqueId: 'kendraaax2', nickname: 'Kendra ✨', addedAt: Date.now() - 86400000 },
    { uniqueId: 'autumnstar01', nickname: 'Autumn', addedAt: Date.now() - 43200000 },
  ];

  const emit = (evt: LiveEvent) => eventListeners.forEach((cb) => cb(evt));
  const setStatus = (status: ConnectionStatus, error?: string) =>
    statusListeners.forEach((cb) => cb({ status, error }));

  const startDemoStream = () => {
    if (timer) return;
    setStatus('connected');
    emit({ type: 'roomInfo', ts: Date.now(), info: DEMO_ROOM });
    emit({ type: 'roomUser', ts: Date.now(), viewerCount });
    // Seed a few events immediately so the UI is populated for screenshots.
    for (let i = 0; i < 8; i++) tick(true);
    timer = setInterval(() => tick(false), 1800);
  };

  let n = 0;
  const tick = (seed: boolean) => {
    n++;
    const ts = Date.now() - (seed ? Math.floor(Math.random() * 60000) : 0);
    const user = pick(DEMO_USERS);
    const roll = Math.random();
    if (roll < 0.45) {
      emit({ type: 'chat', ts, user, comment: pick(DEMO_COMMENTS) });
    } else if (roll < 0.62) {
      const g = pick(DEMO_GIFTS);
      emit({ type: 'gift', ts, user, ...g, repeatCount: Math.ceil(Math.random() * 3) });
    } else if (roll < 0.82) {
      const likeCount = Math.ceil(Math.random() * 15);
      totalLikes += likeCount;
      emit({ type: 'like', ts, user, likeCount, totalLikeCount: totalLikes });
    } else if (roll < 0.9) {
      emit({ type: 'follow', ts, user });
    } else if (roll < 0.96) {
      emit({ type: 'questionNew', ts, user, question: 'What time are you live tomorrow?' });
    } else {
      emit({ type: 'member', ts, user });
    }
    if (n % 4 === 0) {
      viewerCount = Math.max(900, viewerCount + Math.round((Math.random() - 0.45) * 40));
      emit({ type: 'roomUser', ts, viewerCount });
    }
  };

  // Demo sessions so the Dashboard renders populated for dev/screenshots.
  // Stay empty with ?demo=off (honest fresh-install state).
  const demoOn = new URLSearchParams(window.location.search).get('demo') !== 'off';
  const day = 86400000;
  const mkSession = (offsetDays: number, durMin: number, diamonds: number, follows: number, peak: number, title: string): SessionRecord => ({
    id: `demo-${offsetDays}`,
    hostUniqueId: 'rella.live',
    hostNickname: 'Rella',
    roomTitle: title,
    startedAt: Date.now() - offsetDays * day,
    endedAt: Date.now() - offsetDays * day + durMin * 60000,
    totals: { likes: 20000 + diamonds, diamonds, comments: 800, follows, shares: 40, subs: 3, gifts: Math.round(diamonds / 90), questions: 12, peakViewers: peak },
    events: DEMO_USERS.slice(0, 5).map((u, i) => ({
      ts: Date.now() - offsetDays * day + i * 60000,
      type: 'gift',
      user: { uniqueId: u.uniqueId, nickname: u.nickname },
      giftName: DEMO_GIFTS[i % DEMO_GIFTS.length].giftName,
      diamondCount: DEMO_GIFTS[i % DEMO_GIFTS.length].diamondCount,
      repeatCount: 1,
    })),
  });
  const sessions: SessionRecord[] = demoOn
    ? [
        mkSession(0, 96, 8420, 38, 1322, 'Friday night hangout 💖 come chat!'),
        mkSession(2, 74, 5210, 21, 980, 'Cozy chat + Q&A'),
        mkSession(4, 120, 9930, 44, 1561, 'Late night gaming 🎮'),
        mkSession(7, 55, 2140, 12, 640, 'Morning coffee stream ☕'),
        mkSession(9, 88, 4480, 18, 870, 'Sunday wind-down'),
      ]
    : [];

  const bridge: TikTokBridge = {
    connect: async () => {
      setStatus('connecting');
      setTimeout(startDemoStream, 500);
      return ok;
    },
    disconnect: async () => {
      if (timer) { clearInterval(timer); timer = null; }
      setStatus('disconnected');
      return ok;
    },
    getSettings: async () => ({
      lastUsername: 'rella.live',
      signApiKey: '',
      anthropicApiKey: '',
      autoConnect: false,
      chatLogEnabled: false,
      webhooks: { discordUrl: '', slackUrl: '', customUrl: '', events: { gifts: true, follows: true, keywords: false, milestones: true } } as WebhookConfig,
      watchlist: [],
    }),
    setSignApiKey: async () => ok,
    setAnthropicKey: async () => ok,
    setAutoConnect: async () => ok,
    setChatLog: async () => ok,
    setWebhooks: async () => ok,
    setWatchlist: async () => ok,
    chatLogDir: async () => '~/Library/Application Support/LikeTapperMac/chatlogs',
    backupExport: async () => ({ ok: false }),
    backupImport: async () => ({ ok: false, error: 'Not available in browser mode' }),
    summarizeSession: async () => ({ ok: false, error: 'Not available in browser mode' }),
    openProfile: async () => ok,
    openProfileInternal: async () => ok,
    notesGet: async (uniqueId) => notes[uniqueId] ?? null,
    notesAll: async () => notes,
    notesSet: async ({ uniqueId, nickname, notes: text }) => {
      const note: UserNote = { uniqueId, nickname, notes: text, updatedAt: Date.now() };
      notes[uniqueId] = note;
      return note;
    },
    notesDelete: async (uniqueId) => { delete notes[uniqueId]; return ok; },
    sessionsList: async () => sessions.map((s): SessionSummary => ({ ...s, eventCount: s.events.length })),
    sessionsGet: async (id) => sessions.find((s) => s.id === id) ?? null,
    sessionsDelete: async () => ok,
    sessionsSearch: async () => [],
    sessionsExport: async () => ({ ok: false, error: 'Not available in browser mode' }),
    sessionsLeaderboard: async () =>
      DEMO_USERS.slice(0, 5).map((u, i) => ({
        uniqueId: u.uniqueId,
        nickname: u.nickname,
        likes: 12000 - i * 1800,
        diamonds: 8200 - i * 1500,
        comments: 420 - i * 60,
        gifts: 96 - i * 14,
        sessionsAppeared: 14 - i * 2,
      })),
    sessionsUserTallies: async (uniqueId) => ({
      uniqueId,
      nickname: DEMO_USERS.find((u) => u.uniqueId === uniqueId)?.nickname ?? uniqueId,
      likes: 4200, diamonds: 1300, comments: 180, gifts: 22, sessionsAppeared: 6,
    }),
    overlayUrl: async () => 'http://127.0.0.1:4823/overlay',
    openLiveInternal: async () => ok,
    multiConnect: async () => ok,
    multiDisconnect: async () => ok,
    multiDisconnectAll: async () => ok,
    onMultiStatus: () => () => {},
    onMultiEvent: () => () => {},
    onStatus: (cb) => {
      statusListeners.add(cb);
      return () => statusListeners.delete(cb);
    },
    onEvent: (cb) => {
      eventListeners.add(cb);
      return () => eventListeners.delete(cb);
    },
    watchlistPoke: async () => ok,
    onWatchlistLive: () => () => {},
    trackedList: async () => tracked,
    trackedAdd: async ({ uniqueId, nickname }) => {
      if (tracked.some((t) => t.uniqueId === uniqueId)) return { ok: true, alreadyTracked: true };
      tracked = [...tracked, { uniqueId, nickname, addedAt: Date.now() }];
      return ok;
    },
    trackedRemove: async (uniqueId) => {
      tracked = tracked.filter((t) => t.uniqueId !== uniqueId);
      return ok;
    },
    trackedIsTracked: async (uniqueId) => tracked.some((t) => t.uniqueId === uniqueId),
    likerOpen: async () => ({ ok: false, error: 'Not available in browser mode' }),
    likerClose: async () => ok,
    likerStart: async () => ok,
    likerStop: async () => ok,
    likerSetMode: async () => ok,
    likerSetInterval: async () => ok,
    likerStats: async () => null,
    likerIsOpen: async () => false,
    likerShow: async () => ok,
    likerHide: async () => ok,
    highlightsAvailable: async () => false,
    highlightsCapture: async () => ({ ok: false, error: 'Not available in browser mode' }),
    highlightsList: async () => [],
    highlightsReveal: async () => ok,
    highlightsDir: async () => '~/Movies/LikeTapper Highlights',
  };

  window.tiktok = bridge;

  // Auto-connect shortly after boot so dev/browser sessions show live data.
  // Pass ?demo=off to stay on the disconnected hero screen.
  const params = new URLSearchParams(window.location.search);
  if (params.get('demo') !== 'off') {
    setTimeout(() => bridge.connect('rella.live'), 600);
  }
}
