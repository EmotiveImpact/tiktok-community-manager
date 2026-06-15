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
  CommunitySettings,
  ConnectionDetail,
  ConnectionPhase,
  ConnectionStatus,
  CustomFieldDef,
  CustomFieldType,
  EarningsSettings,
  Fan,
  FanProfile,
  GiftRecord,
  ImportResult,
  LiveEvent,
  ModerationSettings,
  MyAccount,
  Reminder,
  RoomInfo,
  SessionRecord,
  SessionSummary,
  Temperature,
  TimelineEvent,
  TimelineFilter,
  UserBrief,
  UserNote,
  WatchEntry,
  WebhookConfig,
} from '../types';
import { tierForDiamonds } from './tier';

type TikTokBridge = Window['tiktok'];

const ok = { ok: true as const };

const DEMO_USERS: UserBrief[] = [
  { uniqueId: 'kendraaax2', nickname: 'Kendra ✨', profilePictureUrl: null, isFollower: true, topGifterRank: 1, verified: true },
  { uniqueId: 'autumnstar01', nickname: 'Autumn', profilePictureUrl: null, isSubscriber: true, isFollower: true, topGifterRank: 2, verified: true },
  { uniqueId: 'mochi.eats', nickname: 'Mochi', profilePictureUrl: null, isFollower: true, topGifterRank: 3 },
  { uniqueId: 'wandererSO', nickname: 'Wanderer', profilePictureUrl: null, isModerator: true },
  { uniqueId: 'gaminglittlelao', nickname: 'GamingLittleLao', profilePictureUrl: null, isFollower: true },
  { uniqueId: 'sarahbear', nickname: 'SarahBear 🐻', profilePictureUrl: null },
  { uniqueId: 'liamthekid', nickname: 'Liam', profilePictureUrl: null, isFollower: true },
  { uniqueId: 'pixie.dust', nickname: 'Pixie', profilePictureUrl: null, isSubscriber: true },
  // Blocked-test fixture: a noisy account you can block in the Moderation panel
  // to verify it disappears from every feed (Comments/Gifts/Q&A/All/Top).
  { uniqueId: 'spambot99', nickname: 'SpamBot99', profilePictureUrl: null },
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
  const healthListeners = new Set<(d: ConnectionDetail) => void>();
  const eventListeners = new Set<(evt: LiveEvent) => void>();
  const watchlistLiveListeners = new Set<(d: { username: string; detectedAt: number }) => void>();
  let timer: ReturnType<typeof setInterval> | null = null;
  let viewerCount = 1180;
  let totalLikes = 38420;
  const notes: Record<string, UserNote> = {};
  const demoSeed = new URLSearchParams(window.location.search).get('demo') !== 'off';
  let tracked: Array<{ uniqueId: string; nickname: string; addedAt: number }> = demoSeed
    ? [
        { uniqueId: 'kendraaax2', nickname: 'Kendra ✨', addedAt: Date.now() - 86400000 },
        { uniqueId: 'autumnstar01', nickname: 'Autumn', addedAt: Date.now() - 43200000 },
      ]
    : [];

  const emit = (evt: LiveEvent) => eventListeners.forEach((cb) => cb(evt));
  // Map the coarse demo status onto a sane default rich-health detail so the
  // ConnectionHealth pill renders meaningfully in the browser demo.
  const phaseForStatus = (status: ConnectionStatus): ConnectionPhase =>
    status === 'connected' ? 'connected'
    : status === 'connecting' ? 'connecting'
    : status === 'reconnecting' ? 'reconnecting'
    : status === 'error' ? 'network-error'
    : status === 'disconnected' ? 'disconnected'
    : 'idle';
  const reasonForPhase = (phase: ConnectionPhase): string =>
    phase === 'connected' ? "Live in @rella.live's room."
    : phase === 'connecting' ? 'Connecting to @rella.live…'
    : phase === 'reconnecting' ? 'Connection dropped — retrying with backoff.'
    : phase === 'disconnected' ? 'Disconnected.'
    : phase === 'network-error' ? 'A network error interrupted the connection.'
    : 'Not connected.';
  const setStatus = (status: ConnectionStatus, error?: string) => {
    statusListeners.forEach((cb) => cb({ status, error }));
    const phase = phaseForStatus(status);
    const detail: ConnectionDetail = {
      phase,
      status,
      reason: error ?? reasonForPhase(phase),
      reconnectAttempt: 0,
      nextRetryInMs: null,
      lastEventAt: phase === 'connected' ? Date.now() : null,
    };
    healthListeners.forEach((cb) => cb(detail));
  };

  const startDemoStream = () => {
    if (timer) return;
    setStatus('connected');
    emit({ type: 'roomInfo', ts: Date.now(), info: DEMO_ROOM });
    emit({ type: 'roomUser', ts: Date.now(), viewerCount });
    // Demo streamMeta: a populated session header (title / viewer counts /
    // uptime) but no real video — flagged `unauthorized` so the player shows the
    // honest "needs a paid EulerStream plan" state instead of a fake player.
    // This mirrors the real free-tier experience the browser demo should convey.
    emit({
      type: 'streamMeta',
      ts: Date.now(),
      meta: {
        source: 'eulerstream',
        unauthorized: true,
        title: DEMO_ROOM.title,
        currentViewers: viewerCount,
        totalViewers: 4820,
        startTime: DEMO_ROOM.startedAt,
        hlsUrl: null,
        flvUrl: null,
      },
    });
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
    } else if (roll < 0.94) {
      emit({ type: 'subscribe', ts, user });
    } else if (roll < 0.97) {
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

  // --- In-memory fan CRM (browser demo) -------------------------------------
  type RawFan = Omit<Fan, 'tier'>;
  const mmdd = (offsetDays: number) => {
    const d = new Date(Date.now() + offsetDays * day);
    return `${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  };
  const mkFan = (
    u: UserBrief, diamonds: number, gifts: number, lastSeenDaysAgo: number, tags: string[],
    notes = '', birthday?: string, displayName?: string,
  ): RawFan => ({
    uniqueId: u.uniqueId,
    nickname: u.nickname,
    displayName,
    avatarUrl: null,
    firstSeenAt: Date.now() - 90 * day,
    lastSeenAt: Date.now() - lastSeenDaysAgo * day,
    lastGiftAt: gifts > 0 ? Date.now() - lastSeenDaysAgo * day : undefined,
    totalDiamonds: diamonds,
    giftCount: gifts,
    tags,
    notes,
    birthday,
  });
  const fanMap = new Map<string, RawFan>();
  if (demoSeed) {
    const extra: UserBrief[] = Array.from({ length: 22 }, (_, i) => ({
      uniqueId: `fan_${String(i + 1).padStart(2, '0')}`,
      nickname: ['Nova', 'Jess', 'Marco', 'Tia', 'Ollie', 'Rae', 'Kit', 'Dani', 'Theo', 'Mira', 'Cass'][i % 11] + ` ${i + 1}`,
      profilePictureUrl: null,
    }));
    const seedFans: RawFan[] = [
      mkFan(DEMO_USERS[0], 118420, 342, 9, ['superfan', 'gift streak', 'cozy gamer', 'mod candidate', 'birthday soon', 'prefers DM'], 'Kendra found the stream during the midnight cozy-gaming run and became a core supporter after the charity LIVE. Loves direct, low-key shout-outs, not big hype. Mention her dog Luna if she joins late. She is trying to learn editing and asks thoughtful questions after streams.', mmdd(1), 'Kendra M.'),
      mkFan(DEMO_USERS[1], 6200, 41, 1, ['superfan'], 'Subscribed since March. Ask about her dog Biscuit.', mmdd(12)),
      mkFan(DEMO_USERS[2], 2840, 28, 17, ['foodie'], 'Runs a food account — shouted us out twice.', mmdd(45)),
      mkFan(DEMO_USERS[3], 540, 9, 2, ['mod-team'], 'Volunteer mod, UK timezone.'),
      mkFan(DEMO_USERS[4], 12100, 64, 21, ['gamer', 'superfan'], 'Big Galaxy gifter on launch nights.', mmdd(8)),
      mkFan(DEMO_USERS[5], 130, 4, 5, [], '', mmdd(2)),
      mkFan(DEMO_USERS[6], 45, 2, 9, ['new-friend']),
      mkFan(DEMO_USERS[7], 1750, 15, 3, [], 'Pixie — always brings friends to the stream.'),
      ...extra.map((u, i) => mkFan(u, Math.max(0, 900 - i * 47), Math.max(0, 12 - i), i % 20, i % 3 === 0 ? ['regular'] : [])),
    ];
    for (const f of seedFans) fanMap.set(f.uniqueId, f);
  }
  const giftLog: GiftRecord[] = [];
  if (demoSeed) {
    let gi = 0;
    for (const f of [...fanMap.values()].slice(0, 12)) {
      for (let k = 0; k < Math.min(4, f.giftCount); k++) {
        const g = DEMO_GIFTS[(gi + k) % DEMO_GIFTS.length];
        giftLog.push({
          id: `demo-gift-${gi}-${k}`,
          fanUniqueId: f.uniqueId,
          fanNickname: f.nickname,
          giftName: g.giftName,
          diamonds: g.diamondCount * (1 + (k % 3)),
          repeatCount: 1 + (k % 3),
          sessionId: `demo-${k * 2}`,
          at: Date.now() - Math.round((gi * 2.2 + k * 0.9) * day),
        });
      }
      gi++;
    }
    giftLog.sort((a, b) => b.at - a.at);
  }
  // Older gifts (40–80 days back) so "all-time" is meaningfully larger than
  // "this month" in the demo — otherwise both headline stats show the same
  // number and the showcase reads like a bug.
  if (demoSeed) {
    let oi = 0;
    for (const f of [...fanMap.values()].slice(0, 8)) {
      const g = DEMO_GIFTS[oi % DEMO_GIFTS.length];
      giftLog.push({
        id: `demo-gift-old-${oi}`,
        fanUniqueId: f.uniqueId,
        fanNickname: f.nickname,
        giftName: g.giftName,
        diamonds: g.diamondCount * (2 + (oi % 4)),
        repeatCount: 1,
        sessionId: `demo-old-${oi}`,
        at: Date.now() - Math.round((42 + oi * 4.5) * day),
      });
      oi++;
    }
    giftLog.sort((a, b) => b.at - a.at);
  }
  // Hand-tuned Kendra gift rows so her 360 timeline mirrors the design target
  // (Galaxy after the charity milestone, Rose x5 during the outfit poll, etc.).
  if (demoSeed) {
    giftLog.unshift(
      { id: 'k-g-rose5', fanUniqueId: 'kendraaax2', fanNickname: 'Kendra ✨', giftName: 'Rose', diamonds: 1200, repeatCount: 5, sessionId: 'demo-2', at: Date.now() - 1 * day - 3 * 3600000 },
      { id: 'k-g-galaxy', fanUniqueId: 'kendraaax2', fanNickname: 'Kendra ✨', giftName: 'Galaxy', diamonds: 10000, repeatCount: 1, sessionId: 'demo-4', at: Date.now() - 12 * day },
      { id: 'k-g-lion', fanUniqueId: 'kendraaax2', fanNickname: 'Kendra ✨', giftName: 'Lion', diamonds: 29999, repeatCount: 1, sessionId: 'demo-old-0', at: Date.now() - 30 * day },
      { id: 'k-g-fh', fanUniqueId: 'kendraaax2', fanNickname: 'Kendra ✨', giftName: 'Finger Heart', diamonds: 25, repeatCount: 5, sessionId: 'demo-0', at: Date.now() - 9 * day },
    );
    giftLog.sort((a, b) => b.at - a.at);
  }

  // --- CRM custom-field DEFS (global) + per-fan VALUES ----------------------
  const customFieldDefs: CustomFieldDef[] = [
    { id: 'cf_fav_gift', key: 'favorite_gift', label: 'Favorite gift', type: 'text' },
    { id: 'cf_timezone', key: 'timezone', label: 'Timezone', type: 'text' },
    { id: 'cf_language', key: 'language', label: 'Language', type: 'text' },
    { id: 'cf_how_we_met', key: 'how_we_met', label: 'How we met', type: 'text' },
  ];
  // Seed Kendra's custom-field values so the 360 profile renders fully populated.
  if (demoSeed) {
    const k = fanMap.get('kendraaax2');
    if (k) {
      k.customFields = {
        favorite_gift: 'Galaxy + Rose streaks',
        timezone: 'Pacific Time',
        language: 'English',
        how_we_met: 'Raided in from @mikaPlays',
      };
    }
  }

  // --- CRM interaction timeline (manual + milestone rows) --------------------
  type MockInteraction = TimelineEvent & { fanId: string };
  const interactions: MockInteraction[] = [];
  const HOUR = 3600000;
  if (demoSeed) {
    // A rich, multi-day manual+milestone history for @kendraaax2 (gifts/sessions
    // are merged in from the ledgers by mockTimeline below).
    const k = 'kendraaax2';
    interactions.push(
      { fanId: k, id: 'k-note-1', type: 'note', source: 'manual', occurredAt: Date.now() - 18 * 60000, summary: 'Manual note added', body: 'Kendra said birthday plans are low-key this year. Send a personal message before Friday stream.', payload: { kind: 'relationship note' } },
      { fanId: k, id: 'k-thank-1', type: 'thank_you', source: 'manual', occurredAt: Date.now() - 1 * day - 2 * HOUR, summary: 'Thank-you sent', body: "Short DM for last week's Galaxy. No reply yet." },
      { fanId: k, id: 'k-note-2', type: 'note', source: 'manual', occurredAt: Date.now() - 12 * day, summary: 'Creator note', body: 'She prefers being thanked after the hype moment, not while chat is flying.', payload: { kind: 'preference' } },
      { fanId: k, id: 'k-shout-1', type: 'shoutout', source: 'manual', occurredAt: Date.now() - 5 * day, summary: 'Shout-out given', body: 'Called out her gift streak during the charity LIVE.' },
      { fanId: k, id: 'k-dm-1', type: 'dm', source: 'manual', occurredAt: Date.now() - 20 * day, summary: 'DM sent', body: 'Checked in about her editing course.' },
    );
  }

  // Pure-ish strength engine mirror so list rows + profile agree in the browser.
  const tempForStrength = (s: number): Temperature =>
    s >= 75 ? 'hot' : s >= 50 ? 'warm' : s >= 25 ? 'cooling' : 'cold';
  const saturate = (x: number, half: number) => (x <= 0 ? 0 : x / (x + half));
  const mockStrength = (raw: RawFan): {
    strength: number; temperature: Temperature; daysSinceContact: number;
    breakdown: FanProfile['breakdown']; sessionsAttended: number; diamonds30d: number; currentStreak: number;
  } => {
    const now = Date.now();
    const last = Math.max(raw.lastSeenAt, raw.lastGiftAt ?? 0);
    const daysSince = last > 0 ? Math.max(0, Math.floor((now - last) / day)) : 9999;
    const fanGifts = giftLog.filter((g) => g.fanUniqueId === raw.uniqueId);
    const diamonds30d = fanGifts.filter((g) => g.at >= now - 30 * day).reduce((s, g) => s + g.diamonds, 0);
    const gifts30d = fanGifts.filter((g) => g.at >= now - 30 * day).length;
    const myInteractions30d = interactions.filter((i) => i.fanId === raw.uniqueId && i.occurredAt >= now - 30 * day).length;
    const interactions30d = gifts30d + myInteractions30d + (daysSince <= 7 ? 1 : 0);
    // Demo session attendance: scale with engagement so loyalty looks alive.
    const sessionsAttended = Math.min(sessions.length, Math.round(raw.giftCount / 10) + (raw.totalDiamonds > 5000 ? 3 : 0));
    const loyalty = sessions.length > 0 ? Math.min(1, sessionsAttended / sessions.length) : 0;
    const recency = last > 0 ? Math.exp(-daysSince / 14) : 0;
    const generosity = saturate(diamonds30d, 5000);
    const frequency = saturate(interactions30d, 12);
    const r100 = (x: number) => Math.max(0, Math.min(100, Math.round(x * 100)));
    let strength = r100(0.35 * recency + 0.25 * generosity + 0.25 * frequency + 0.15 * loyalty);
    const tier = tierForDiamonds(raw.totalDiamonds, mockSettings.community.tiers);
    let temperature = tempForStrength(strength);
    if ((tier === 'VIP' || tier === 'Whale') && daysSince > mockSettings.community.quietDays) temperature = 'cold';
    return {
      strength,
      temperature,
      daysSinceContact: daysSince,
      breakdown: { recency: r100(recency), generosity: r100(generosity), frequency: r100(frequency), loyalty: r100(loyalty) },
      sessionsAttended,
      diamonds30d,
      currentStreak: Math.max(0, Math.min(12, Math.round(raw.giftCount / 12))),
    };
  };

  // Force Kendra's headline numbers to match the design target (strength ~86,
  // breakdown 68/96/84/91) so the showcase profile reads exactly as designed.
  const KENDRA_OVERRIDE = {
    strength: 86,
    temperature: 'cooling' as Temperature,
    daysSinceContact: 9,
    breakdown: { recency: 68, generosity: 96, frequency: 84, loyalty: 91 },
    sessionsAttended: 47,
    diamonds30d: 24200,
    currentStreak: 8,
  };

  const mockTimeline = (uid: string, filter: TimelineFilter): TimelineEvent[] => {
    const raw = fanMap.get(uid);
    const out: TimelineEvent[] = [];
    // gifts
    for (const g of giftLog.filter((g) => g.fanUniqueId === uid)) {
      out.push({
        id: `gift-${g.id}`, type: 'gift', occurredAt: g.at, source: 'auto',
        summary: `gave ${g.giftName}${g.repeatCount > 1 ? ` ×${g.repeatCount}` : ''}`,
        payload: { diamonds: g.diamonds, repeatCount: g.repeatCount },
      });
    }
    // manual + milestone interactions
    for (const i of interactions.filter((i) => i.fanId === uid)) out.push(i);
    // synthesized session attendance (demo): a couple recent sessions
    if (raw && (raw.totalDiamonds > 1000 || raw.giftCount > 10)) {
      out.push({ id: `sess-${uid}-1`, type: 'session_attend', occurredAt: Date.now() - 2 * HOUR, source: 'auto', summary: 'Attended "Late night cozy reset"', payload: { sessionId: 'demo-0' } });
      out.push({ id: `sess-${uid}-2`, type: 'session_attend', occurredAt: Date.now() - 1 * day - 5 * HOUR, source: 'auto', summary: 'Attended "Cozy chat + Q&A"', payload: { sessionId: 'demo-2' } });
    }
    // first_seen + tier_up milestones
    if (raw) {
      out.push({ id: `firstseen-${uid}`, type: 'first_seen', occurredAt: raw.firstSeenAt, source: 'system', summary: 'First seen in your community', payload: {} });
      const tier = tierForDiamonds(raw.totalDiamonds, mockSettings.community.tiers);
      if (tier !== 'New') {
        out.push({ id: `tierup-${uid}-${tier}`, type: 'tier_up', occurredAt: raw.lastGiftAt ?? raw.lastSeenAt, source: 'system', summary: `Reached ${tier} tier`, payload: { tier } });
      }
      // comment rollup
      out.push({ id: `comments-${uid}`, type: 'comment_rollup', occurredAt: raw.lastSeenAt, source: 'auto', summary: `${Math.max(1, Math.round(raw.giftCount * 2.4)).toLocaleString()} comments across your streams`, payload: { count: Math.round(raw.giftCount * 2.4) } });
    }
    let rows = out.sort((a, b) => b.occurredAt - a.occurredAt);
    if (filter !== 'all') {
      rows = rows.filter((e) =>
        filter === 'gift' ? e.type === 'gift' || e.type === 'manual_gift_log'
        : filter === 'comment' ? e.type === 'comment_rollup'
        : filter === 'note' ? ['note', 'thank_you', 'dm', 'shoutout'].includes(e.type)
        : filter === 'session' ? e.type === 'session_attend'
        : true);
    }
    return rows.slice(0, 300);
  };

  const reminderHidden = new Set<string>();
  // Seed one thank-after-LIVE reminder so the "thank your gifters" loop is
  // visible in Reminders/Messages without having to run a LIVE first.
  const thankRequests: { uniqueId: string; date: string }[] = demoSeed
    ? [{ uniqueId: DEMO_USERS[0].uniqueId, date: new Date().toISOString().slice(0, 10) }]
    : [];

  // Persisted (localStorage) settings so the browser demo behaves like the app.
  type MockSettings = { thankTemplate: string; earnings: EarningsSettings; community: CommunitySettings; moderation: ModerationSettings; watchlist: WatchEntry[]; myAccount: MyAccount; notifyOnGoLive: boolean };
  const SETTINGS_KEY = 'mock-settings-v1';
  const defaultSettings = (): MockSettings => ({
    thankTemplate: 'Hey {nickname}! Thank you so much for the {giftName} 💕 You made my stream!',
    earnings: { enabled: false, ratePer1000: 10, currency: '£' },
    community: { quietDays: 14, birthdayWindowDays: 30, tiers: { regular: 100, vip: 1000, whale: 10000 } },
    moderation: { blockedUsers: [], blockedKeywords: [], userTags: {}, spamFilterEnabled: false, spamThreshold: 20 },
    watchlist: [],
    myAccount: { username: '' },
    notifyOnGoLive: true,
  });
  const normalizeUsername = (raw: unknown): string =>
    String(raw ?? '').trim().replace(/^@+/, '').trim().toLowerCase();
  // Mirror the desktop store migration: legacy string[] -> WatchEntry[].
  const normalizeWatchlist = (raw: unknown): WatchEntry[] => {
    if (!Array.isArray(raw)) return [];
    const out: WatchEntry[] = [];
    for (const item of raw) {
      if (typeof item === 'string') {
        const username = item.trim();
        if (username) out.push({ username, notify: true, lastSeen: null });
      } else if (item && typeof item === 'object' && typeof (item as any).username === 'string') {
        const e = item as Partial<WatchEntry>;
        const username = String(e.username).trim();
        if (username) out.push({ username, notify: e.notify !== false, lastSeen: typeof e.lastSeen === 'number' ? e.lastSeen : null });
      }
    }
    return out;
  };
  let mockSettings: MockSettings = defaultSettings();
  try {
    const raw = localStorage.getItem(SETTINGS_KEY);
    if (raw) mockSettings = { ...defaultSettings(), ...JSON.parse(raw) };
  } catch { /* fresh */ }
  mockSettings.watchlist = normalizeWatchlist(mockSettings.watchlist);
  if (!mockSettings.myAccount || typeof mockSettings.myAccount.username !== 'string') {
    mockSettings.myAccount = { username: '' };
  }
  // Seed a demo own-account so the dashboard identity + connect-to-my-LIVE
  // shortcut are visible in browser screenshots (skipped with ?demo=off).
  if (demoSeed && !mockSettings.myAccount.username) {
    mockSettings.myAccount = { username: 'rella.live', nickname: 'Rella', avatarUrl: undefined };
  }
  if (typeof mockSettings.notifyOnGoLive !== 'boolean') mockSettings.notifyOnGoLive = true;
  const saveSettings = () => {
    try { localStorage.setItem(SETTINGS_KEY, JSON.stringify(mockSettings)); } catch { /* ignore */ }
  };

  const fanWithTier = (f: RawFan): Fan => ({ ...f, tier: tierForDiamonds(f.totalDiamonds, mockSettings.community.tiers) });
  const normBday = (b?: string | null) => {
    if (!b) return undefined;
    const m = String(b).match(/^(?:\d{4}-)?(\d{1,2})-(\d{1,2})$/);
    return m ? `${m[1].padStart(2, '0')}-${m[2].padStart(2, '0')}` : undefined;
  };

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
    refreshStreamMeta: async () => {
      // Re-emit the demo streamMeta so a manual refresh visibly does something.
      emit({
        type: 'streamMeta',
        ts: Date.now(),
        meta: {
          source: 'eulerstream',
          unauthorized: true,
          title: DEMO_ROOM.title,
          currentViewers: viewerCount,
          totalViewers: 4820,
          startTime: DEMO_ROOM.startedAt,
          hlsUrl: null,
          flvUrl: null,
        },
      });
      return ok;
    },
    getSettings: async () => ({
      lastUsername: 'rella.live',
      signApiKey: '',
      anthropicApiKey: '',
      autoConnect: false,
      chatLogEnabled: false,
      aiSummaryConsented: false,
      likerRiskAck: false,
      webhooks: { discordUrl: '', slackUrl: '', customUrl: '', events: { gifts: true, follows: true, keywords: false, milestones: true } } as WebhookConfig,
      watchlist: mockSettings.watchlist,
      thankTemplate: mockSettings.thankTemplate,
      earnings: mockSettings.earnings,
      community: mockSettings.community,
      moderation: mockSettings.moderation,
      myAccount: mockSettings.myAccount,
      notifyOnGoLive: mockSettings.notifyOnGoLive,
      customFieldDefs,
    }),
    setSignApiKey: async () => ok,
    setAnthropicKey: async () => ok,
    setAutoConnect: async () => ok,
    setChatLog: async () => ok,
    setAiSummaryConsent: async () => ok,
    setLikerRiskAck: async () => ok,
    setWebhooks: async () => ok,
    setWatchlist: async (list) => {
      mockSettings.watchlist = normalizeWatchlist(list);
      saveSettings();
      return ok;
    },
    setThankTemplate: async (tpl) => {
      mockSettings.thankTemplate = tpl;
      saveSettings();
      return ok;
    },
    setEarnings: async (cfg) => {
      mockSettings.earnings = cfg;
      saveSettings();
      return ok;
    },
    setCommunity: async (cfg) => {
      const { regular, vip, whale } = cfg.tiers;
      if (!(regular > 0 && regular < vip && vip < whale)) {
        return { ok: false, error: 'Tier thresholds must be ascending (Regular < VIP < Whale)' };
      }
      mockSettings.community = cfg;
      saveSettings();
      return ok;
    },
    setModeration: async (cfg) => {
      mockSettings.moderation = cfg;
      saveSettings();
      return ok;
    },
    setMyAccount: async (account) => {
      const cur = mockSettings.myAccount;
      const next: MyAccount = {
        username: account?.username !== undefined ? normalizeUsername(account.username) : cur.username,
        nickname: account?.nickname !== undefined ? (account.nickname || undefined) : cur.nickname,
        avatarUrl: account?.avatarUrl !== undefined ? (account.avatarUrl || undefined) : cur.avatarUrl,
      };
      mockSettings.myAccount = next;
      saveSettings();
      return { ok: true, myAccount: next };
    },
    setNotifyOnGoLive: async (val) => {
      mockSettings.notifyOnGoLive = !!val;
      saveSettings();
      return ok;
    },
    openExternal: async (url) => {
      try {
        const u = new URL(url);
        if (u.protocol === 'https:' && (u.hostname === 'tiktok.com' || u.hostname.endsWith('.tiktok.com'))) {
          window.open(url, '_blank', 'noopener');
          return ok;
        }
      } catch { /* invalid */ }
      return { ok: false, error: 'Only tiktok.com links can be opened' };
    },
    chatLogDir: async () => '~/Library/Application Support/LikeTapperMac/chatlogs',
    revealLogs: async () => ({ ok: false, path: '~/Library/Logs/LikeTapperMac', error: 'Not available in browser mode' }),
    logsPath: async () => '~/Library/Logs/LikeTapperMac',
    checkForUpdates: async () => ({ ok: false, status: 'skipped' as const, message: 'Updates only run in the packaged app.' }),
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
      (demoSeed ? DEMO_USERS.slice(0, 5) : []).map((u, i) => ({
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
    onHealth: (cb) => {
      healthListeners.add(cb);
      return () => healthListeners.delete(cb);
    },
    onEvent: (cb) => {
      eventListeners.add(cb);
      return () => eventListeners.delete(cb);
    },
    fansList: async (q = {}) => {
      const search = (q.search ?? '').toLowerCase().trim();
      const allTags = new Set<string>();
      let rows = [...fanMap.values()].map(fanWithTier);
      for (const f of rows) f.tags.forEach((t) => allTags.add(t));
      if (search) rows = rows.filter((f) => `${f.uniqueId} ${f.nickname} ${f.displayName ?? ''} ${f.notes}`.toLowerCase().includes(search));
      if (q.tag) rows = rows.filter((f) => f.tags.includes(q.tag!));
      if (q.tier) rows = rows.filter((f) => f.tier === q.tier);
      const sort = q.sort ?? 'diamonds';
      rows.sort((a, b) =>
        sort === 'name' ? (a.displayName || a.nickname).localeCompare(b.displayName || b.nickname)
        : sort === 'lastSeen' ? b.lastSeenAt - a.lastSeenAt
        : b.totalDiamonds - a.totalDiamonds);
      const page = q.page ?? 1;
      const pageSize = q.pageSize ?? 25;
      // ADDITIVE: attach strength + temperature so the list shows bars + dots.
      const enriched = rows.map((f) => {
        const raw = fanMap.get(f.uniqueId);
        if (!raw) return f;
        const s = f.uniqueId === 'kendraaax2' ? KENDRA_OVERRIDE : mockStrength(raw);
        return { ...f, strength: s.strength, temperature: s.temperature };
      });
      return { data: enriched.slice((page - 1) * pageSize, page * pageSize), total: enriched.length, page, pageSize, allTags: [...allTags].sort() };
    },
    fansGet: async (uniqueId) => {
      const f = fanMap.get(uniqueId);
      return f ? fanWithTier(f) : null;
    },
    fansProfile: async (uniqueId): Promise<FanProfile | null> => {
      const uid = String(uniqueId ?? '').replace(/^@/, '').trim();
      const raw = fanMap.get(uid);
      if (!raw) return null;
      const s = uid === 'kendraaax2' ? KENDRA_OVERRIDE : mockStrength(raw);
      const open = await bridge.remindersList();
      return {
        fan: fanWithTier(raw),
        strength: s.strength,
        temperature: s.temperature,
        daysSinceContact: s.daysSinceContact,
        breakdown: s.breakdown,
        sessionsAttended: s.sessionsAttended,
        currentStreak: s.currentStreak,
        diamonds30d: s.diamonds30d,
        reminders: open.filter((r) => r.fan.uniqueId === uid),
        customFieldDefs,
        customFields: raw.customFields ?? {},
      };
    },
    fansTimeline: async (uniqueId, opts = {}) => {
      const uid = String(uniqueId ?? '').replace(/^@/, '').trim();
      return mockTimeline(uid, opts.filter ?? 'all').slice(0, opts.limit ?? 300);
    },
    fansAddNote: async (uniqueId, body) => {
      const uid = String(uniqueId ?? '').replace(/^@/, '').trim();
      if (!uid) return { ok: false, error: 'Username is required' };
      const ev: MockInteraction = {
        fanId: uid, id: `note-${Date.now()}`, type: 'note', source: 'manual',
        occurredAt: Date.now(), summary: 'Note added', body: String(body ?? ''),
      };
      interactions.unshift(ev);
      const { fanId: _fanId, ...event } = ev;
      return { ok: true, event };
    },
    fansSetField: async (uniqueId, key, value) => {
      const uid = String(uniqueId ?? '').replace(/^@/, '').trim();
      let f = fanMap.get(uid);
      if (!f) {
        f = { uniqueId: uid, nickname: uid, avatarUrl: null, firstSeenAt: Date.now(), lastSeenAt: Date.now(), totalDiamonds: 0, giftCount: 0, tags: [], notes: '' };
        fanMap.set(uid, f);
      }
      const cf = { ...(f.customFields ?? {}) };
      if (value === null || value === undefined || value === '') delete cf[String(key)];
      else cf[String(key)] = value;
      f.customFields = cf;
      return { ok: true, fan: fanWithTier(f) };
    },
    fieldsListDefs: async () => customFieldDefs,
    fieldsAddDef: async (input) => {
      const label = String(input?.label ?? '').trim();
      if (!label) return { ok: false, error: 'Label is required' };
      const key = (input?.key || label).trim().toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '') || `field_${Date.now()}`;
      if (customFieldDefs.some((d) => d.key === key)) return { ok: false, error: `A field with key "${key}" already exists` };
      const validTypes = ['text', 'longtext', 'number', 'date', 'select', 'multiselect', 'url', 'checkbox'];
      const type = (validTypes.includes(input?.type as string) ? input.type : 'text') as CustomFieldType;
      const def: CustomFieldDef = { id: `cf_${Date.now()}`, key, label: label.slice(0, 80), type, options: input?.options };
      customFieldDefs.push(def);
      return { ok: true, def };
    },
    fieldsRemoveDef: async (id) => {
      const i = customFieldDefs.findIndex((d) => d.id === id);
      if (i >= 0) customFieldDefs.splice(i, 1);
      return ok;
    },
    fansAdd: async (payload) => {
      const uid = payload.uniqueId.replace(/^@/, '').trim();
      if (!uid) return { ok: false, error: 'Username is required' };
      const created = !fanMap.has(uid);
      const existing = fanMap.get(uid) ?? {
        uniqueId: uid, nickname: payload.nickname || payload.displayName || uid,
        avatarUrl: null, firstSeenAt: Date.now(), lastSeenAt: Date.now(),
        totalDiamonds: 0, giftCount: 0, tags: [], notes: '',
      };
      if (payload.displayName !== undefined) existing.displayName = payload.displayName || undefined;
      if (payload.tags) existing.tags = payload.tags;
      if (payload.notes !== undefined) existing.notes = payload.notes;
      if (payload.birthday !== undefined) existing.birthday = normBday(payload.birthday);
      if (payload.totalDiamonds !== undefined && created) existing.totalDiamonds = payload.totalDiamonds;
      fanMap.set(uid, existing);
      return { ok: true, fan: fanWithTier(existing), created };
    },
    fansUpdate: async (uniqueId, patch) => {
      const f = fanMap.get(uniqueId);
      if (!f) return { ok: false, error: 'Fan not found' };
      if (patch.tags !== undefined) f.tags = patch.tags;
      if (patch.notes !== undefined) f.notes = patch.notes;
      if (patch.birthday !== undefined) f.birthday = normBday(patch.birthday);
      if (patch.displayName !== undefined) f.displayName = patch.displayName || undefined;
      return { ok: true, fan: fanWithTier(f) };
    },
    fansBulkTag: async ({ ids, add, remove }) => {
      let updated = 0;
      for (const id of ids) {
        const f = fanMap.get(id);
        if (!f) continue;
        f.tags = [...f.tags.filter((t) => !remove.includes(t)), ...add.filter((t) => !f.tags.includes(t))];
        updated++;
      }
      return { ok: true, updated };
    },
    fansLogGift: async ({ uniqueId, nickname, giftName, diamonds, at }) => {
      const uid = uniqueId.replace(/^@/, '').trim();
      if (!uid) return { ok: false, error: 'Fan username is required' };
      if (!giftName.trim()) return { ok: false, error: 'Gift name is required' };
      if (!(diamonds > 0)) return { ok: false, error: 'Diamonds must be a positive number' };
      let f = fanMap.get(uid);
      if (!f) {
        f = { uniqueId: uid, nickname: nickname || uid, avatarUrl: null, firstSeenAt: Date.now(), lastSeenAt: Date.now(), totalDiamonds: 0, giftCount: 0, tags: [], notes: '' };
        fanMap.set(uid, f);
      }
      f.totalDiamonds += diamonds;
      f.giftCount++;
      f.lastGiftAt = at ?? Date.now();
      giftLog.unshift({ id: `m-${Date.now()}`, fanUniqueId: uid, fanNickname: f.nickname, giftName, diamonds, repeatCount: 1, manual: true, at: at ?? Date.now() });
      return { ok: true };
    },
    giftsList: async (q = {}) => {
      const now = Date.now();
      const cutoff = q.range === '7d' ? now - 7 * day : q.range === '90d' ? now - 90 * day : q.range === 'all' ? 0 : now - 30 * day;
      const fanQ = (q.fan ?? '').toLowerCase().replace(/^@/, '').trim();
      let diamondsWeek = 0, diamondsMonth = 0, diamondsAll = 0;
      for (const g of giftLog) {
        diamondsAll += g.diamonds;
        if (g.at >= now - 7 * day) diamondsWeek += g.diamonds;
        if (g.at >= now - 30 * day) diamondsMonth += g.diamonds;
      }
      const rows = giftLog.filter((g) => g.at >= cutoff && (!fanQ || g.fanUniqueId.toLowerCase().includes(fanQ) || g.fanNickname.toLowerCase().includes(fanQ)));
      const page = q.page ?? 1;
      const pageSize = q.pageSize ?? 25;
      return { data: rows.slice((page - 1) * pageSize, page * pageSize), total: rows.length, page, pageSize, diamondsWeek, diamondsMonth, diamondsAll };
    },
    remindersList: async (withinDays) => {
      const rules = mockSettings.community;
      const window = withinDays ?? rules.birthdayWindowDays;
      const out: Reminder[] = [];
      const now = new Date();
      const year = now.getFullYear();
      for (const raw of fanMap.values()) {
        const f = fanWithTier(raw);
        if (f.birthday) {
          const m = f.birthday.match(/^(\d{2})-(\d{2})$/);
          if (m) {
            const today = new Date(year, now.getMonth(), now.getDate());
            let next = new Date(year, Number(m[1]) - 1, Number(m[2]));
            if (next < today) next = new Date(year + 1, Number(m[1]) - 1, Number(m[2]));
            const days = Math.round((next.getTime() - today.getTime()) / day);
            const id = `bday:${f.uniqueId}:${year}`;
            if (days <= window && !reminderHidden.has(id)) out.push({ id, kind: 'birthday', fan: f, days, date: f.birthday });
          }
        }
        if ((f.tier === 'VIP' || f.tier === 'Whale')) {
          const daysSince = Math.floor((Date.now() - f.lastSeenAt) / day);
          const id = `quiet:${f.uniqueId}:0`;
          if (daysSince > rules.quietDays && !reminderHidden.has(id)) out.push({ id, kind: 'quiet', fan: f, days: daysSince });
        }
      }
      for (const t of thankRequests) {
        const raw = fanMap.get(t.uniqueId);
        if (!raw) continue;
        const id = `thank:${t.uniqueId}:${t.date}`;
        if (!reminderHidden.has(id)) out.push({ id, kind: 'thank', fan: fanWithTier(raw), days: 0 });
      }
      out.sort((a, b) => (a.kind === b.kind ? a.days - b.days : a.kind === 'birthday' ? -1 : a.kind === 'thank' && b.kind === 'quiet' ? -1 : 1));
      return out;
    },
    reminderAction: async ({ id }) => {
      reminderHidden.add(id);
      return ok;
    },
    reminderAddThank: async (uniqueId) => {
      const uid = uniqueId.replace(/^@/, '').trim();
      if (!uid) return { ok: false, error: 'Username is required' };
      if (!fanMap.has(uid)) {
        fanMap.set(uid, { uniqueId: uid, nickname: uid, avatarUrl: null, firstSeenAt: Date.now(), lastSeenAt: Date.now(), totalDiamonds: 0, giftCount: 0, tags: [], notes: '' });
      }
      const date = new Date().toISOString().slice(0, 10);
      if (thankRequests.some((t) => t.uniqueId === uid && t.date === date)) return { ok: true, deduped: true };
      thankRequests.push({ uniqueId: uid, date });
      return ok;
    },
    fansMarkThanked: async (uniqueId) => {
      const uid = uniqueId.replace(/^@/, '').trim();
      const f = fanMap.get(uid);
      if (!f) return { ok: false, error: 'Fan not found' };
      f.lastThankedAt = Date.now();
      // close open thank/birthday reminders for this fan
      const open = await bridge.remindersList();
      for (const r of open) {
        if (r.fan.uniqueId === uid && (r.kind === 'thank' || r.kind === 'birthday')) reminderHidden.add(r.id);
      }
      return { ok: true, fan: fanWithTier(f) };
    },
    fansImportCsv: async (csvText) => {
      const lines = csvText.split(/\r?\n/).filter((l) => l.trim());
      const result: ImportResult = { ok: true, created: 0, updated: 0, skipped: 0, errors: [] };
      if (lines.length === 0) return { ...result, ok: false, errors: ['CSV is empty'] };
      const header = lines[0].split(',').map((h) => h.trim().toLowerCase());
      const iUser = header.indexOf('username');
      if (iUser === -1) return { ...result, ok: false, errors: ['Missing required "username" column in header row'] };
      const iDisplay = header.indexOf('displayname');
      const iBday = header.indexOf('birthday');
      const iTags = header.indexOf('tags');
      const iNotes = header.indexOf('notes');
      const iDia = header.indexOf('totaldiamonds');
      for (let r = 1; r < lines.length; r++) {
        const c = lines[r].split(','); // demo-mode parser: simple split
        const uid = (c[iUser] ?? '').replace(/^@/, '').trim();
        if (!uid) { result.skipped++; continue; }
        const created = !fanMap.has(uid);
        const res = await bridge.fansAdd({
          uniqueId: uid,
          displayName: iDisplay >= 0 ? c[iDisplay] : undefined,
          birthday: iBday >= 0 ? c[iBday] : undefined,
          tags: iTags >= 0 && c[iTags] ? c[iTags].split(/[;|]/).map((t) => t.trim()).filter(Boolean) : undefined,
          notes: iNotes >= 0 ? c[iNotes] : undefined,
          totalDiamonds: iDia >= 0 ? Number(c[iDia]) || undefined : undefined,
        });
        if (!res.ok) result.errors.push(`Row ${r + 1}: ${res.error}`);
        else if (created) result.created++;
        else result.updated++;
      }
      return result;
    },
    fansImportCsvFile: async () => ({ ok: false, created: 0, updated: 0, skipped: 0, errors: ['File picker not available in browser mode — paste CSV text instead'], canceled: false }),
    fansExportCsv: async () => ({ ok: false, error: 'Not available in browser mode' }),
    giftsExportCsv: async (q = {}) => {
      // Browser demo: produce a real CSV download of the filtered gift log so the
      // button does something useful even without Electron's native save dialog.
      const now = Date.now();
      const cutoff = q.range === '7d' ? now - 7 * day : q.range === '90d' ? now - 90 * day : q.range === 'all' ? 0 : q.range === '30d' ? now - 30 * day : 0;
      const fanQ = (q.fan ?? '').toLowerCase().replace(/^@/, '').trim();
      const rows = giftLog
        .filter((g) => g.at >= cutoff && (!fanQ || g.fanUniqueId.toLowerCase().includes(fanQ) || g.fanNickname.toLowerCase().includes(fanQ)))
        .sort((a, b) => b.at - a.at);
      if (rows.length === 0) return { ok: false, error: 'No gifts to export for this range.' };
      const esc = (v: string) => (/[",\n\r]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v);
      const lines = [['date', 'fanUsername', 'fanNickname', 'giftName', 'diamonds', 'repeatCount', 'source', 'sessionId'].join(',')];
      for (const g of rows) {
        const source = g.manual ? 'Manual' : g.sessionId?.startsWith('multi:') ? 'Multi-room' : g.sessionId ? 'LIVE' : '';
        lines.push([new Date(g.at).toISOString(), esc(g.fanUniqueId), esc(g.fanNickname), esc(g.giftName), String(g.diamonds), String(g.repeatCount), source, esc(g.sessionId ?? '')].join(','));
      }
      try {
        const blob = new Blob([lines.join('\n')], { type: 'text/csv' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `gifts-${new Date().toISOString().slice(0, 10)}.csv`;
        document.body.appendChild(a);
        a.click();
        a.remove();
        setTimeout(() => URL.revokeObjectURL(url), 1000);
        return { ok: true, path: a.download };
      } catch (err: any) {
        return { ok: false, error: err?.message ?? 'Download failed' };
      }
    },
    fansClear: async () => {
      fanMap.clear();
      giftLog.length = 0;
      return ok;
    },
    fansDataDir: async () => '~/Documents/LikeTapperMac/fans',
    watchlistPoke: async () => {
      // Browser demo: simulate detecting the first notify-enabled watchlist user
      // as "live" so the panel's lastSeen + alert wiring can be exercised.
      const target = mockSettings.watchlist.find((w) => w.notify !== false);
      if (target) {
        const detectedAt = Date.now();
        target.lastSeen = detectedAt;
        saveSettings();
        watchlistLiveListeners.forEach((cb) => cb({ username: target.username, detectedAt }));
      }
      return ok;
    },
    onWatchlistLive: (cb) => {
      watchlistLiveListeners.add(cb);
      return () => watchlistLiveListeners.delete(cb);
    },
    onNavigateConnect: () => () => {},
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
