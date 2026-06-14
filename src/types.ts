export type UserBrief = {
  uniqueId: string;
  nickname: string;
  profilePictureUrl: string | null;
  isModerator?: boolean;
  isSubscriber?: boolean;
  isFollower?: boolean;
  topGifterRank?: number | null;
  verified?: boolean;
};

export type UserNote = {
  uniqueId: string;
  nickname: string;
  notes: string;
  updatedAt: number;
};

export type SessionTotals = {
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
  totals: SessionTotals;
  events: StoredEvent[];
};

export type SessionSummary = Omit<SessionRecord, 'events'> & { eventCount: number };

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

export type UserHistoricalTally = {
  uniqueId: string;
  nickname: string;
  likes: number;
  diamonds: number;
  comments: number;
  gifts: number;
  sessionsAppeared: number;
};

export type SearchHit = {
  sessionId: string;
  hostNickname: string;
  startedAt: number;
  ts: number;
  user: string;
  comment: string;
};

export type LiveEvent =
  | { type: 'like'; ts: number; user: UserBrief; likeCount: number; totalLikeCount: number }
  | { type: 'chat'; ts: number; user: UserBrief; comment: string }
  | { type: 'gift'; ts: number; user: UserBrief; giftId: number; giftName: string; diamondCount: number; repeatCount: number }
  | { type: 'member'; ts: number; user: UserBrief }
  | { type: 'follow'; ts: number; user: UserBrief }
  | { type: 'share'; ts: number; user: UserBrief }
  | { type: 'subscribe'; ts: number; user: UserBrief }
  | { type: 'roomUser'; ts: number; viewerCount: number }
  | { type: 'roomInfo'; ts: number; info: RoomInfo }
  | { type: 'questionNew'; ts: number; user: UserBrief; question: string }
  | { type: 'envelope'; ts: number; user: UserBrief; coins: number; canOpen: number }
  | { type: 'linkMicBattle'; ts: number; armies: { hostUserId: string; points: number }[] }
  | { type: 'emote'; ts: number; user: UserBrief; emoteId: string; emoteUrl: string | null }
  | { type: 'caption'; ts: number; text: string; lang: string; sentenceId: string; definite: boolean; durationMs: number }
  | { type: 'streamMeta'; ts: number; meta: StreamMeta }
  | { type: 'streamEnd'; ts: number };

/**
 * Enriched live-session metadata — mirrors electron/tiktok.ts StreamMeta.
 * Sourced from the connector or, as a fallback, EulerStream's room_info REST
 * endpoint. HLS/FLV URLs are short-lived + signed; never persist them.
 */
export type StreamMeta = {
  source: 'connector' | 'eulerstream';
  hlsUrl?: string | null;
  flvUrl?: string | null;
  title?: string;
  currentViewers?: number;
  totalViewers?: number;
  startTime?: number | null;
  /** True when EulerStream room_info needs a paid (Business/Premium) plan. */
  unauthorized?: boolean;
};

export type RoomInfo = {
  title: string;
  hostNickname: string;
  hostUniqueId: string;
  hostAvatar: string | null;
  followerCount: number;
  totalUserCount: number;
  likeCount: number;
  hlsUrl: string | null;
  flvUrl: string | null;
  startedAt: number | null;
};

// --- Settings --------------------------------------------------------------

export type WatchEntry = {
  username: string;
  notify: boolean;
  /** epoch ms of the last time this user was detected live, or null if never */
  lastSeen: number | null;
};

export type EarningsSettings = {
  enabled: boolean;
  ratePer1000: number;
  currency: '£' | '$' | '€';
};

export type CommunitySettings = {
  quietDays: number;
  birthdayWindowDays: number;
  tiers: { regular: number; vip: number; whale: number };
};

export type MyAccount = {
  username: string;
  nickname?: string;
  avatarUrl?: string;
};

export type ModerationUserTag = 'vip' | 'regular' | 'troll' | 'blocked';

export type ModerationSettings = {
  blockedUsers: string[];
  blockedKeywords: string[];
  userTags: Record<string, ModerationUserTag>;
  spamFilterEnabled: boolean;
  spamThreshold: number;
};

// --- Fan CRM ---------------------------------------------------------------

export type Tier = 'New' | 'Regular' | 'VIP' | 'Whale';

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
  birthday?: string; // 'MM-DD'
  createdManually?: boolean;
  lastThankedAt?: number;
  tier: Tier;
};

export type GiftRecord = {
  id: string;
  fanUniqueId: string;
  fanNickname: string;
  giftName: string;
  diamonds: number;
  repeatCount: number;
  sessionId?: string;
  manual?: boolean;
  at: number;
};

export type ListFansQuery = {
  search?: string;
  tag?: string;
  tier?: Tier;
  page?: number;
  pageSize?: number;
  sort?: 'diamonds' | 'lastSeen' | 'name';
};

export type ListFansResult = {
  data: Fan[];
  total: number;
  page: number;
  pageSize: number;
  allTags: string[];
};

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

export type Reminder = {
  id: string;
  kind: 'birthday' | 'quiet' | 'thank';
  fan: Fan;
  days: number;
  date?: string;
};

export type UpsertFanPayload = {
  uniqueId: string;
  nickname?: string;
  displayName?: string;
  tags?: string[];
  notes?: string;
  birthday?: string | null;
  totalDiamonds?: number;
};

export type FanPatch = {
  tags?: string[];
  notes?: string;
  birthday?: string | null;
  displayName?: string;
};

export type ImportResult = {
  ok: boolean;
  created: number;
  updated: number;
  skipped: number;
  errors: string[];
  canceled?: boolean;
};

export type ConnectionStatus =
  | 'idle'
  | 'connecting'
  | 'connected'
  | 'reconnecting'
  | 'disconnected'
  | 'error';

/** Rich connection phase — mirrors electron/tiktok.ts ConnectionPhase. */
export type ConnectionPhase =
  | 'idle'
  | 'connecting'
  | 'connected'
  | 'live-ended'
  | 'stalled'
  | 'rate-limited'
  | 'signing-failed'
  | 'network-error'
  | 'offline'
  | 'reconnecting'
  | 'disconnected';

/** Full health snapshot pushed from main → renderer on every status change. */
export type ConnectionDetail = {
  phase: ConnectionPhase;
  status: ConnectionStatus;
  reason: string;
  suggestion?: string;
  reconnectAttempt: number;
  nextRetryInMs: number | null;
  lastEventAt: number | null;
};

declare global {
  interface Window {
    tiktok: {
      connect: (username: string) => Promise<{ ok: boolean; error?: string }>;
      disconnect: () => Promise<{ ok: boolean }>;
      /** Manually re-fetch EulerStream stream meta (e.g. on HLS URL expiry). */
      refreshStreamMeta: () => Promise<{ ok: boolean; error?: string }>;
      getSettings: () => Promise<{
        lastUsername: string;
        signApiKey: string;
        anthropicApiKey: string;
        autoConnect: boolean;
        chatLogEnabled: boolean;
        aiSummaryConsented: boolean;
        likerRiskAck: boolean;
        webhooks: WebhookConfig;
        watchlist: WatchEntry[];
        thankTemplate: string;
        earnings: EarningsSettings;
        community: CommunitySettings;
        moderation: ModerationSettings;
        myAccount: MyAccount;
        notifyOnGoLive: boolean;
      }>;
      setSignApiKey: (key: string) => Promise<{ ok: boolean }>;
      setAnthropicKey: (key: string) => Promise<{ ok: boolean }>;
      setAutoConnect: (val: boolean) => Promise<{ ok: boolean }>;
      setChatLog: (val: boolean) => Promise<{ ok: boolean }>;
      setAiSummaryConsent: (val: boolean) => Promise<{ ok: boolean }>;
      setLikerRiskAck: (val: boolean) => Promise<{ ok: boolean }>;
      setWebhooks: (cfg: WebhookConfig) => Promise<{ ok: boolean }>;
      setWatchlist: (list: WatchEntry[]) => Promise<{ ok: boolean }>;
      setThankTemplate: (tpl: string) => Promise<{ ok: boolean }>;
      setEarnings: (cfg: EarningsSettings) => Promise<{ ok: boolean }>;
      setCommunity: (cfg: CommunitySettings) => Promise<{ ok: boolean; error?: string }>;
      setModeration: (cfg: ModerationSettings) => Promise<{ ok: boolean }>;
      setMyAccount: (account: MyAccount) => Promise<{ ok: boolean; myAccount: MyAccount }>;
      setNotifyOnGoLive: (val: boolean) => Promise<{ ok: boolean }>;
      openExternal: (url: string) => Promise<{ ok: boolean; error?: string }>;
      chatLogDir: () => Promise<string>;
      revealLogs: () => Promise<{ ok: boolean; path: string; error?: string }>;
      logsPath: () => Promise<string>;
      checkForUpdates: () => Promise<{
        ok: boolean;
        status: 'checking' | 'available' | 'not-available' | 'downloading' | 'skipped' | 'error';
        message: string;
        version?: string;
      }>;
      backupExport: () => Promise<{ ok: boolean; path?: string }>;
      backupImport: () => Promise<{ ok: boolean; error?: string }>;
      summarizeSession: (id: string) => Promise<{
        ok: boolean;
        summary?: string;
        error?: string;
        needsConsent?: boolean;
      }>;
      openProfile: (uniqueId: string) => Promise<{ ok: boolean }>;
      openProfileInternal: (uniqueId: string) => Promise<{ ok: boolean }>;
      notesGet: (uniqueId: string) => Promise<UserNote | null>;
      notesAll: () => Promise<Record<string, UserNote>>;
      notesSet: (payload: { uniqueId: string; nickname: string; notes: string }) => Promise<UserNote>;
      notesDelete: (uniqueId: string) => Promise<{ ok: boolean }>;
      sessionsList: () => Promise<SessionSummary[]>;
      sessionsGet: (id: string) => Promise<SessionRecord | null>;
      sessionsDelete: (id: string) => Promise<{ ok: boolean }>;
      sessionsSearch: (q: string) => Promise<SearchHit[]>;
      sessionsExport: (id: string, type: 'comments' | 'gifts' | 'all' | 'summary') => Promise<{ ok: boolean; path?: string; error?: string }>;
      sessionsLeaderboard: (limit?: number) => Promise<UserHistoricalTally[]>;
      sessionsUserTallies: (uniqueId: string) => Promise<UserHistoricalTally>;
      overlayUrl: () => Promise<string | null>;
      openLiveInternal: (uniqueId: string) => Promise<{ ok: boolean }>;
      multiConnect: (username: string) => Promise<{ ok: boolean; error?: string }>;
      multiDisconnect: (username: string) => Promise<{ ok: boolean }>;
      multiDisconnectAll: () => Promise<{ ok: boolean }>;
      onMultiStatus: (cb: (d: { username: string; status: ConnectionStatus; error?: string }) => void) => () => void;
      onMultiEvent: (cb: (d: { username: string; evt: LiveEvent }) => void) => () => void;
      onStatus: (cb: (s: { status: ConnectionStatus; error?: string }) => void) => () => void;
      onHealth: (cb: (d: ConnectionDetail) => void) => () => void;
      onEvent: (cb: (evt: LiveEvent) => void) => () => void;
      fansList: (q?: ListFansQuery) => Promise<ListFansResult>;
      fansGet: (uniqueId: string) => Promise<Fan | null>;
      fansAdd: (payload: UpsertFanPayload) => Promise<{ ok: boolean; fan?: Fan; created?: boolean; error?: string }>;
      fansUpdate: (uniqueId: string, patch: FanPatch) => Promise<{ ok: boolean; fan?: Fan; error?: string }>;
      fansBulkTag: (payload: { ids: string[]; add: string[]; remove: string[] }) => Promise<{ ok: boolean; updated: number }>;
      fansLogGift: (payload: { uniqueId: string; nickname?: string; giftName: string; diamonds: number; at?: number }) => Promise<{ ok: boolean; error?: string }>;
      giftsList: (q?: ListGiftsQuery) => Promise<ListGiftsResult>;
      remindersList: (withinDays?: number) => Promise<Reminder[]>;
      reminderAction: (payload: { id: string; action: 'done' | 'snooze'; days?: number }) => Promise<{ ok: boolean; error?: string }>;
      reminderAddThank: (uniqueId: string) => Promise<{ ok: boolean; deduped?: boolean; error?: string }>;
      fansMarkThanked: (uniqueId: string) => Promise<{ ok: boolean; fan?: Fan; error?: string }>;
      fansImportCsv: (csvText: string) => Promise<ImportResult>;
      fansImportCsvFile: () => Promise<ImportResult>;
      fansExportCsv: () => Promise<{ ok: boolean; path?: string; error?: string }>;
      giftsExportCsv: (q?: ListGiftsQuery) => Promise<{ ok: boolean; path?: string; error?: string; canceled?: boolean }>;
      fansClear: () => Promise<{ ok: boolean }>;
      fansDataDir: () => Promise<string>;
      watchlistPoke: () => Promise<{ ok: boolean }>;
      onWatchlistLive: (cb: (d: { username: string; detectedAt: number }) => void) => () => void;
      onNavigateConnect: (cb: (d: { username: string }) => void) => () => void;
      trackedList: () => Promise<Array<{ uniqueId: string; nickname: string; addedAt: number }>>;
      trackedAdd: (payload: { uniqueId: string; nickname: string }) => Promise<{ ok: boolean; alreadyTracked?: boolean }>;
      trackedRemove: (uniqueId: string) => Promise<{ ok: boolean }>;
      trackedIsTracked: (uniqueId: string) => Promise<boolean>;

      likerOpen: (username: string) => Promise<{ ok: boolean; error?: string }>;
      likerClose: () => Promise<{ ok: boolean }>;
      likerStart: (mode: string, interval: number) => Promise<{ ok: boolean }>;
      likerStop: () => Promise<{ ok: boolean }>;
      likerSetMode: (mode: string) => Promise<{ ok: boolean }>;
      likerSetInterval: (interval: number) => Promise<{ ok: boolean }>;
      likerStats: () => Promise<{
        isActive: boolean; mode: string; interval: number;
        likesCount: number; keypressCount: number; sessionStartTime: number;
        state: string; isLivePage: boolean;
      } | null>;
      likerIsOpen: () => Promise<boolean>;
      likerShow: () => Promise<{ ok: boolean }>;
      likerHide: () => Promise<{ ok: boolean }>;

      highlightsAvailable: () => Promise<boolean>;
      highlightsCapture: (reason: string) => Promise<{ ok: boolean; path?: string; error?: string }>;
      highlightsList: () => Promise<{ name: string; path: string; size: number; mtime: number }[]>;
      highlightsReveal: (p: string) => Promise<{ ok: boolean }>;
      highlightsDir: () => Promise<string>;
    };
  }
}
