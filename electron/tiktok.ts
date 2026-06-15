import {
  WebcastPushConnection,
  SignatureRateLimitError,
  SignAPIError,
  PremiumFeatureError,
} from 'tiktok-live-connector';
import { settings } from './store';
import { log } from './logger';
import { getRoomInfo } from './eulerstream';

export type ConnectionStatus =
  | 'idle'
  | 'connecting'
  | 'connected'
  | 'reconnecting'
  | 'disconnected'
  | 'error';

/**
 * Rich, human-legible classification of *why* the connection is in its current
 * state. The coarse `ConnectionStatus` above still drives the legacy StatusPill
 * and multi-room dots unchanged; this `ConnectionPhase` is the new layer the
 * ConnectionHealth pill reads so a creator can see — and act on — the reason a
 * stream broke.
 */
export type ConnectionPhase =
  | 'idle'
  | 'connecting'
  | 'connected'
  | 'live-ended'       // the streamer's LIVE genuinely ended (streamEnd)
  | 'stalled'          // connected but no events for a while during a live stream
  | 'rate-limited'     // EulerStream sign service returned HTTP 429
  | 'signing-failed'   // sign service errored (non-429) — bad/missing key, premium feature
  | 'network-error'    // transport/connect failure
  | 'offline'          // the streamer isn't live right now
  | 'reconnecting'     // backing off + retrying
  | 'disconnected';    // user-initiated leave

/**
 * The full health snapshot pushed to the renderer on every status change. The
 * existing `{ status, error }` IPC shape is preserved (the renderer's store
 * still reads `status`), with `detail` carrying the rich classification.
 */
export type ConnectionDetail = {
  phase: ConnectionPhase;
  /** Coarse enum kept in lock-step so legacy consumers stay correct. */
  status: ConnectionStatus;
  /** One-line human-readable reason (shown in the pill tooltip). */
  reason: string;
  /** Optional suggested action the creator can take. */
  suggestion?: string;
  /** Current reconnect attempt count (0 when not reconnecting). */
  reconnectAttempt: number;
  /** ms until the next reconnect fires, when reconnecting; else null. */
  nextRetryInMs: number | null;
  /** epoch ms of the last received live event (staleness signal); null if none. */
  lastEventAt: number | null;
};

/** How long (ms) without any event before a live connection is "stalled". */
const STALL_THRESHOLD_MS = 45_000;
/** How often the watchdog checks for staleness. */
const STALL_CHECK_INTERVAL_MS = 5_000;

export type NormalizedEvent =
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
 * Enriched live-session metadata. Sourced either from the connector's own
 * roomInfo ('connector') or — as a fallback when the connector lacks a usable
 * stream_url — from EulerStream's room_info REST endpoint ('eulerstream').
 *
 * The HLS/FLV pull URLs (when present) are SHORT-LIVED + signed; the renderer
 * loads them into the player on arrival and must not persist them.
 */
export type StreamMeta = {
  source: 'connector' | 'eulerstream';
  hlsUrl?: string | null;
  flvUrl?: string | null;
  title?: string;
  currentViewers?: number;
  totalViewers?: number;
  startTime?: number | null;
  /** True when room_info needs a paid (Business/Premium) EulerStream plan. */
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

type Callbacks = {
  onStatus: (status: ConnectionStatus, error?: string) => void;
  onEvent: (evt: NormalizedEvent) => void;
  /**
   * Rich health update. Optional so existing call sites that only wire
   * `onStatus` keep compiling; the primary live pipeline wires both.
   */
  onHealth?: (detail: ConnectionDetail) => void;
};

function brief(d: any): UserBrief {
  return {
    uniqueId: d?.uniqueId ?? d?.user?.uniqueId ?? 'unknown',
    nickname: d?.nickname ?? d?.user?.nickname ?? d?.uniqueId ?? 'unknown',
    profilePictureUrl:
      d?.profilePictureUrl ?? d?.userDetails?.profilePictureUrls?.[0] ?? null,
    isModerator: !!d?.isModerator,
    isSubscriber: !!d?.isSubscriber,
    isFollower: d?.followRole >= 1 || !!d?.isFollower,
    topGifterRank:
      typeof d?.topGifterRank === 'number'
        ? d.topGifterRank
        : typeof d?.gifterLevel === 'number'
          ? d.gifterLevel
          : null,
    verified: !!(
      d?.userDetails?.verified ??
      d?.isVerified ??
      d?.user?.verified ??
      (Array.isArray(d?.userBadges) &&
        d.userBadges.some((b: any) => b?.type === 'verify' || b?.name === 'verified'))
    ),
  };
}

export class TikTokSession {
  private conn: WebcastPushConnection;
  private cbs: Callbacks;
  private username: string;
  private reconnectAttempt = 0;
  private reconnectTimer: NodeJS.Timeout | null = null;
  private destroyed = false;

  // --- Health tracking -------------------------------------------------------
  /** epoch ms of the last received live event; null until the first event. */
  private lastEventAt: number | null = null;
  /** Current rich phase, so the watchdog/transitions can reason about it. */
  private phase: ConnectionPhase = 'idle';
  /** Staleness watchdog interval handle. */
  private stallTimer: NodeJS.Timeout | null = null;
  /** Whether we've already emitted a 'stalled' phase (avoid spamming). */
  private stalledNotified = false;
  /** epoch ms the next scheduled reconnect will fire (for the renderer). */
  private nextRetryAt: number | null = null;
  /** Phase of the most recent connect() failure — drives smarter backoff. */
  private lastErrorPhase: ConnectionPhase | null = null;

  constructor(username: string, cbs: Callbacks) {
    this.username = username.replace(/^@/, '').trim();
    this.cbs = cbs;
    // v2 signing: the constructor accepts `signApiKey` (Euler / eulerstream API
    // key) directly on the options object — it is forwarded to the bundled
    // EulerSigner. v1 also accepted this key but the *default* (no-key) path
    // still works because Euler offers a free anonymous tier. Pass `null` (not
    // an empty string) when unset so the lib uses its default signer.
    const signApiKey = (settings.get('signApiKey', '') as string).trim() || null;
    this.conn = new WebcastPushConnection(this.username, {
      // Replays the last ~minute of events on connect.
      processInitialData: true,
      // v2: room info (host, viewers, stream URLs, title, start time) is NOT
      // fetched on connect unless this is enabled — connect()'s returned state
      // has `roomInfo: null` without it. Required for fix #1.
      fetchRoomInfoOnConnect: true,
      // v2: populates `availableGifts` so the legacy converter can attach
      // `extendedGiftInfo` (which carries the gift name + diamond_count) to each
      // gift event. Without this, streamed gifts that lack inline giftDetails
      // surface as `gift_<id>`. Required for fix #2.
      enableExtendedGiftInfo: true,
      signApiKey,
    });
    this.wireEvents();
  }

  // --- Health classification + emission --------------------------------------

  /** Map a rich phase onto the coarse legacy `ConnectionStatus` enum. */
  private static coarse(phase: ConnectionPhase): ConnectionStatus {
    switch (phase) {
      case 'idle':
        return 'idle';
      case 'connecting':
        return 'connecting';
      case 'connected':
      case 'stalled': // still connected; the pill colour carries the nuance
        return 'connected';
      case 'reconnecting':
        return 'reconnecting';
      case 'live-ended':
      case 'offline':
      case 'disconnected':
        return 'disconnected';
      case 'rate-limited':
      case 'signing-failed':
      case 'network-error':
        return 'error';
    }
  }

  /** Human-readable reason + suggested action for each phase. */
  private static describe(
    phase: ConnectionPhase,
    username: string,
    rawError?: string,
  ): { reason: string; suggestion?: string } {
    switch (phase) {
      case 'idle':
        return { reason: 'Not connected.' };
      case 'connecting':
        return { reason: `Connecting to @${username}…` };
      case 'connected':
        return { reason: `Live in @${username}'s room.` };
      case 'stalled':
        return {
          reason: 'Connected, but no events have arrived in a while.',
          suggestion:
            'The stream may be paused, very quiet, or the connection is degraded. Disconnect and reconnect if it stays silent.',
        };
      case 'rate-limited':
        return {
          reason: "TikTok's signing service is rate-limiting this connection (HTTP 429).",
          suggestion:
            'Add a free EulerStream API key in Settings → Connection (1,000 requests/day) for steadier connections, or wait a few minutes and retry.',
        };
      case 'signing-failed':
        return {
          reason: rawError
            ? `Signing service error: ${rawError}`
            : 'The connection-signing service rejected this request.',
          suggestion:
            'Check your EulerStream API key in Settings → Connection. The free anonymous tier can be unreliable under load.',
        };
      case 'network-error':
        return {
          reason: rawError ? `Network error: ${rawError}` : 'A network error interrupted the connection.',
          suggestion: 'Check your internet connection. The app will keep retrying automatically.',
        };
      case 'offline':
        return {
          reason: `@${username} doesn't appear to be live right now.`,
          suggestion: 'Connect again once they start their LIVE.',
        };
      case 'reconnecting':
        return {
          reason: 'Connection dropped — retrying with backoff.',
          suggestion: 'This is usually transient. The app reconnects automatically.',
        };
      case 'live-ended':
        return { reason: 'The streamer ended their LIVE.' };
      case 'disconnected':
        return { reason: 'Disconnected.' };
    }
  }

  /**
   * Set the current phase and broadcast BOTH the legacy `onStatus` (coarse
   * enum + error string) and the rich `onHealth` detail. Single choke point so
   * the two can never drift.
   */
  private setPhase(phase: ConnectionPhase, rawError?: string) {
    this.phase = phase;
    const status = TikTokSession.coarse(phase);
    const { reason, suggestion } = TikTokSession.describe(phase, this.username, rawError);
    const nextRetryInMs =
      phase === 'reconnecting' && this.nextRetryAt ? Math.max(0, this.nextRetryAt - Date.now()) : null;
    const detail: ConnectionDetail = {
      phase,
      status,
      reason,
      suggestion,
      reconnectAttempt: phase === 'reconnecting' ? this.reconnectAttempt : 0,
      nextRetryInMs,
      lastEventAt: this.lastEventAt,
    };
    // Legacy enum path (StatusPill / multi-room dots) — pass the human reason as
    // the error string for error-class phases so existing UI still surfaces it.
    const legacyError = status === 'error' ? reason : rawError;
    this.cbs.onStatus(status, legacyError);
    this.cbs.onHealth?.(detail);
  }

  /**
   * Classify a thrown connect() error into a rich phase. Distinguishes
   * EulerStream 429 rate-limits, other sign failures, "user offline", and
   * generic network errors.
   */
  private classifyError(err: any): { phase: ConnectionPhase; message: string } {
    const message = err?.message ?? String(err);
    if (err instanceof SignatureRateLimitError) {
      return { phase: 'rate-limited', message };
    }
    if (err instanceof PremiumFeatureError || err instanceof SignAPIError) {
      return { phase: 'signing-failed', message };
    }
    // Some builds surface a 429 without the typed class — sniff the message.
    if (/\b429\b|rate.?limit|too many/i.test(message)) {
      return { phase: 'rate-limited', message };
    }
    if (/offline|not.?live|isn'?t live|user.?offline|LIVE has ended|no longer/i.test(message)) {
      return { phase: 'offline', message };
    }
    if (/sign|euler/i.test(message)) {
      return { phase: 'signing-failed', message };
    }
    return { phase: 'network-error', message };
  }

  // --- Staleness watchdog ----------------------------------------------------

  private startStallWatchdog() {
    this.stopStallWatchdog();
    this.stalledNotified = false;
    this.stallTimer = setInterval(() => {
      if (this.destroyed) return;
      // Only meaningful while we believe we're connected.
      if (this.phase !== 'connected' && this.phase !== 'stalled') return;
      const last = this.lastEventAt;
      if (last == null) return; // no baseline yet
      const idle = Date.now() - last;
      if (idle >= STALL_THRESHOLD_MS && !this.stalledNotified) {
        this.stalledNotified = true;
        log.warn(`[tiktok] connection stalled — no events for ${Math.round(idle / 1000)}s @${this.username}`);
        this.setPhase('stalled');
      } else if (idle < STALL_THRESHOLD_MS && this.stalledNotified) {
        // Events resumed — recover to healthy.
        this.stalledNotified = false;
        log.info(`[tiktok] connection recovered from stall @${this.username}`);
        this.setPhase('connected');
      }
    }, STALL_CHECK_INTERVAL_MS);
  }

  private stopStallWatchdog() {
    if (this.stallTimer) {
      clearInterval(this.stallTimer);
      this.stallTimer = null;
    }
  }

  private wireEvents() {
    const c = this.conn;

    c.on('like', (d: any) => {
      this.emitEvent({
        type: 'like',
        ts: Date.now(),
        user: brief(d),
        likeCount: d?.likeCount ?? 1,
        totalLikeCount: d?.totalLikeCount ?? 0,
      });
    });

    c.on('chat', (d: any) => {
      this.emitEvent({
        type: 'chat',
        ts: Date.now(),
        user: brief(d),
        comment: d?.comment ?? '',
      });
    });

    c.on('gift', (d: any) => {
      // v2 gift shape: the legacy data-converter flattens `giftDetails` (type
      // `Gift`) onto the top-level object, so `d.giftName` / `d.diamondCount` /
      // `d.giftType` come from there. For streamed repeat gifts that arrive
      // without inline giftDetails, `enableExtendedGiftInfo` attaches the raw
      // gift-list entry as `d.extendedGiftInfo` (snake_case: `name`,
      // `diamond_count`). Read both so a name is always resolved.
      const isStreakable = d?.giftType === 1 || d?.gift?.gift_type === 1;
      const repeatEnded = d?.repeatEnd === true || d?.repeatEnd === 1 || d?.gift?.repeat_end === 1;
      if (isStreakable && !repeatEnded) return;
      const giftId = d?.giftId ?? d?.id ?? d?.gift?.gift_id ?? 0;
      this.emitEvent({
        type: 'gift',
        ts: Date.now(),
        user: brief(d),
        giftId,
        giftName:
          d?.giftName ?? d?.extendedGiftInfo?.name ?? d?.describe ?? `gift_${giftId}`,
        diamondCount:
          d?.diamondCount ?? d?.extendedGiftInfo?.diamond_count ?? 0,
        repeatCount: d?.repeatCount ?? d?.gift?.repeat_count ?? 1,
      });
    });

    c.on('member', (d: any) => {
      this.emitEvent({ type: 'member', ts: Date.now(), user: brief(d) });
    });
    c.on('follow', (d: any) => {
      this.emitEvent({ type: 'follow', ts: Date.now(), user: brief(d) });
    });
    c.on('share', (d: any) => {
      this.emitEvent({ type: 'share', ts: Date.now(), user: brief(d) });
    });
    // NOTE: tiktok-live-connector v2 has NO 'subscribe' event. The v1 'subscribe'
    // listener here never fired (the WebcastEvent enum has no SUBSCRIBE member —
    // the closest is SUPER_FAN='superFan', a distinct concept). Listening for it
    // was dead code, so it is removed. The renderer's subscribe counters degrade
    // to 0 honestly on real connections (the browser demo still synthesises
    // subscribe events via bridge-mock). If TikTok subscription events are ever
    // needed, they would have to be derived from member badges, not a top-level
    // event. The 'subscribe' NormalizedEvent type is retained so the mock and any
    // historical session records remain valid.

    c.on('roomUser', (d: any) => {
      this.emitEvent({
        type: 'roomUser',
        ts: Date.now(),
        viewerCount: d?.viewerCount ?? 0,
      });
    });

    c.on('questionNew', (d: any) => {
      this.emitEvent({
        type: 'questionNew',
        ts: Date.now(),
        user: brief(d?.questionDetails?.user ?? d?.user ?? d),
        question: d?.questionText ?? d?.questionDetails?.questionText ?? '',
      });
    });

    c.on('envelope', (d: any) => {
      this.emitEvent({
        type: 'envelope',
        ts: Date.now(),
        user: brief(d?.user ?? d),
        coins: d?.coins ?? 0,
        canOpen: d?.canOpen ?? 0,
      });
    });

    c.on('linkMicBattle', (d: any) => {
      const armies = (d?.battleUsers ?? []).map((u: any) => ({
        hostUserId: String(u?.userId ?? u?.battleGroup?.user?.userId ?? ''),
        points: 0,
      }));
      this.emitEvent({ type: 'linkMicBattle', ts: Date.now(), armies });
    });

    c.on('emote', (d: any) => {
      this.emitEvent({
        type: 'emote',
        ts: Date.now(),
        user: brief(d?.user ?? d),
        emoteId: String(d?.emoteId ?? d?.emoteDetails?.emoteId ?? ''),
        emoteUrl: d?.emoteImageUrl ?? d?.emoteDetails?.image?.imageUrl ?? null,
      });
    });

    // v2: 'captionMessage' is a real event (WebcastEvent.CAPTION_MESSAGE).
    // WebcastCaptionMessage shape: { content: {lang, content}[], sentenceId,
    // sequenceId, definite, timestampMs, durationMs } — durationMs/timestampMs
    // are protobuf strings, hence the Number() coercion below.
    c.on('captionMessage', (d: any) => {
      const contents = (d?.content ?? []) as Array<{ lang?: string; content?: string }>;
      if (contents.length === 0) return;
      const pick = contents.find((x) => (x.lang ?? '').startsWith('en')) ?? contents[0];
      const text = pick?.content ?? '';
      if (!text.trim()) return;
      this.emitEvent({
        type: 'caption',
        ts: Date.now(),
        text,
        lang: pick?.lang ?? 'unknown',
        sentenceId: String(d?.sentenceId ?? ''),
        definite: d?.definite !== false,
        durationMs: Number(d?.durationMs ?? 0),
      });
    });

    c.on('streamEnd', () => {
      // The streamer genuinely ended their LIVE — this is NOT an error and must
      // not trigger a reconnect storm. Mark destroyed so the 'disconnected'
      // handler below treats it as terminal.
      this.destroyed = true;
      this.stopStallWatchdog();
      log.info(`[tiktok] LIVE ended by streamer @${this.username}`);
      this.emitEvent({ type: 'streamEnd', ts: Date.now() });
      this.setPhase('live-ended');
    });

    c.on('disconnected', () => {
      if (this.destroyed) return;
      log.warn(`[tiktok] transport disconnected @${this.username} — scheduling reconnect`);
      this.stopStallWatchdog();
      this.scheduleReconnect();
    });
  }

  /** Bump the staleness clock and forward the event to the pipeline. */
  private emitEvent(evt: NormalizedEvent) {
    this.lastEventAt = Date.now();
    this.cbs.onEvent(evt);
  }

  /**
   * Emit a streamMeta event WITHOUT bumping the staleness clock. Important:
   * EulerStream metadata arriving asynchronously isn't a live "event", so it
   * must not reset the stall watchdog (otherwise a silent stream would look
   * healthy purely because a fallback fetch resolved).
   */
  private emitStreamMeta(meta: StreamMeta) {
    this.cbs.onEvent({ type: 'streamMeta', ts: Date.now(), meta });
  }

  /**
   * Fetch the EulerStream room_info as a fallback for the live video URL +
   * session metadata. Never throws — getRoomInfo returns a typed result. On an
   * insufficient (free) tier it emits a streamMeta carrying `unauthorized:true`
   * so the renderer can show an honest "needs a paid plan" message instead of a
   * dead player.
   */
  private async fetchEulerStreamMeta(): Promise<void> {
    if (this.destroyed) return;
    const apiKey = (settings.get('signApiKey', '') as string).trim();
    try {
      const r = await getRoomInfo(this.username, apiKey);
      if (this.destroyed) return;
      if (r.ok && r.isLive) {
        this.emitStreamMeta({
          source: 'eulerstream',
          hlsUrl: r.hlsUrl ?? null,
          flvUrl: r.flvUrl ?? null,
          title: r.title,
          currentViewers: r.currentViewers,
          totalViewers: r.totalViewers,
          startTime: r.startTime ?? null,
        });
      } else if (r.reason === 'unauthorized') {
        // Paid-tier gate: tell the UI honestly so it can point at Settings.
        this.emitStreamMeta({ source: 'eulerstream', unauthorized: true });
      }
      // 'no-key' / 'not-live' / 'network' / 'error' → stay silent; the player
      // keeps its existing mobile-webview fallback. Logged inside getRoomInfo.
    } catch (err) {
      // Defensive: getRoomInfo shouldn't throw, but never let this escape.
      log.warn('[tiktok] eulerstream room_info fallback failed:', err);
    }
  }

  /** Manual refresh of the EulerStream stream meta (re-fetch on URL expiry). */
  async refreshStreamMeta(): Promise<void> {
    await this.fetchEulerStreamMeta();
  }

  async connect() {
    this.setPhase('connecting');
    try {
      const state: any = await this.conn.connect();
      this.reconnectAttempt = 0;
      this.nextRetryAt = null;
      this.lastEventAt = Date.now(); // baseline so the watchdog has a reference
      this.setPhase('connected');
      this.startStallWatchdog();
      log.info(`[tiktok] connected @${this.username}`);
      // v2 room info nesting (fix #1):
      //   connect() returns TikTokLiveConnectionState whose `roomInfo` is the
      //   raw `room/info/` API response: { data: {...}, extra, status_code }.
      //   In v1 the same fields (owner, stream_url, title, create_time,
      //   like_count, user_count) were read off `roomInfo` directly — one level
      //   too high in v2, which is why host/viewers/HLS all came back empty.
      //   The field names *inside* `.data` are unchanged from v1 (snake_case
      //   owner.display_id, stream_url.hls_pull_url_map, owner.follow_info.
      //   follower_count, owner.avatar_thumb.url_list, etc.). We fall back to the
      //   top level so a future shape that flattens again still works.
      const ri = state?.roomInfo?.data ?? state?.roomInfo ?? {};
      const owner = ri?.owner ?? {};

      // UNREADABLE-ROOM GUARD. TikTok returns a placeholder room (only a
      // `prompts` field — no owner/title/user_count) when the room can't be
      // read: the user is OFFLINE, or the LIVE is PRIVATE / subscriber-only
      // (which an unauthenticated reader simply can't access). The transport
      // then drops a beat later. Without this guard the 'disconnected' handler
      // schedules a reconnect and the app loops forever ("stuck connecting").
      // Detect it, surface an honest message, and tear down so we DON'T loop.
      const hasRealRoom = !!(
        owner?.display_id || owner?.unique_id || owner?.nickname ||
        ri?.title || ri?.user_count || ri?.create_time
      );
      if (!hasRealRoom) {
        this.destroyed = true; // makes the imminent 'disconnected' terminal
        this.stopStallWatchdog();
        if (this.reconnectTimer) { clearTimeout(this.reconnectTimer); this.reconnectTimer = null; }
        this.nextRetryAt = null;
        try { this.conn.disconnect(); } catch { /* ignore */ }
        log.info(`[tiktok] @${this.username} room unreadable (prompt only) — offline or private/sub-only LIVE`);
        this.setPhase('offline', `Can't open @${this.username}'s LIVE — they're either offline or running a private/subscriber-only LIVE, which can only be read for public streams.`);
        return;
      }
      const su = ri?.stream_url ?? ri?.streamUrl ?? {};
      const hasConnectorStreamUrl = !!su && Object.keys(su).length > 0;
      if (!hasConnectorStreamUrl) {
        log.info('[tiktok] No stream_url in roomInfo.data. Keys:', Object.keys(ri).join(', '));
      }
      const flvCandidates = su?.flv_pull_url ?? {};
      const hlsCandidates = su?.hls_pull_url_map ?? {};
      const pickFirst = (obj: any) => {
        if (!obj) return null;
        const keys = ['FULL_HD1', 'HD1', 'SD1', 'SD2', 'LD1', 'AUTO'];
        for (const k of keys) if (obj[k]) return obj[k];
        const vals = Object.values(obj).filter(Boolean) as string[];
        return vals[0] ?? null;
      };
      const createTime = ri?.create_time ?? ri?.createTime ?? null;
      const startedAt = createTime ? createTime * 1000 : null;
      log.debug('[tiktok] roomInfo.data keys:', Object.keys(ri).join(', '));
      log.debug('[tiktok] create_time:', createTime, 'like_count:', ri?.like_count, 'user_count:', ri?.user_count);
      const connectorHls = pickFirst(hlsCandidates) ?? su?.hls_pull_url ?? null;
      const connectorFlv = pickFirst(flvCandidates) ?? su?.rtmp_pull_url ?? null;
      this.emitEvent({
        type: 'roomInfo',
        ts: Date.now(),
        info: {
          title: ri?.title ?? '',
          hostNickname: owner?.nickname ?? this.username,
          hostUniqueId: owner?.display_id ?? owner?.unique_id ?? this.username,
          hostAvatar: owner?.avatar_thumb?.url_list?.[0] ?? null,
          followerCount: owner?.follow_info?.follower_count ?? 0,
          totalUserCount: ri?.user_count ?? 0,
          likeCount: ri?.like_count ?? 0,
          hlsUrl: connectorHls,
          flvUrl: connectorFlv,
          startedAt,
        },
      });

      // EulerStream room_info FALLBACK (fix #1 — reliable live video URL).
      // When the connector's own roomInfo lacks a usable stream_url, ask the
      // EulerStream REST API for the short-lived signed HLS pull URL + richer
      // session metadata. Fire-and-forget + fully fail-safe so it can never
      // block or break the live event pipeline. When the connector DID give us
      // a working HLS URL we keep it (don't override) and skip the REST call.
      if (hasConnectorStreamUrl && connectorHls) {
        // Surface the connector's own metadata as streamMeta too, so the UI has
        // a single source for live video + session header regardless of origin.
        this.emitStreamMeta({
          source: 'connector',
          hlsUrl: connectorHls,
          flvUrl: connectorFlv,
          title: ri?.title ?? undefined,
          totalViewers: ri?.user_count ?? undefined,
          startTime: startedAt,
        });
      } else {
        void this.fetchEulerStreamMeta();
      }
    } catch (err: any) {
      const { phase, message } = this.classifyError(err);
      // Remember the classified phase so the reconnect backoff can react to a
      // 429 (back off MORE) vs a transient network blip.
      this.lastErrorPhase = phase;
      if (phase === 'rate-limited') {
        log.error(`[tiktok] sign service rate-limited (429) @${this.username}: ${message}`);
      } else if (phase === 'signing-failed') {
        log.error(`[tiktok] signing failed @${this.username}: ${message}`);
      } else if (phase === 'offline') {
        log.info(`[tiktok] @${this.username} is offline: ${message}`);
      } else {
        log.error(`[tiktok] connect failed @${this.username}: ${message}`);
      }
      this.setPhase(phase, message);
      throw err;
    }
  }

  private scheduleReconnect() {
    if (this.destroyed) return;
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    // Base exponential backoff capped at 30s. On a 429 rate-limit, back off
    // MORE aggressively (longer floor + cap) so we don't keep hammering the
    // sign service and dig the rate-limit hole deeper.
    const rateLimited = this.lastErrorPhase === 'rate-limited';
    const base = rateLimited ? 15_000 : 1000;
    const cap = rateLimited ? 120_000 : 30_000;
    const delay = Math.min(cap, base * 2 ** this.reconnectAttempt);
    this.reconnectAttempt++;
    this.nextRetryAt = Date.now() + delay;
    log.info(
      `[tiktok] reconnect attempt ${this.reconnectAttempt} in ${Math.round(delay / 1000)}s @${this.username}` +
        (rateLimited ? ' (extended backoff — rate-limited)' : ''),
    );
    // Surface the backoff state to the renderer so it isn't hidden.
    this.setPhase('reconnecting');
    this.reconnectTimer = setTimeout(async () => {
      if (this.destroyed) return;
      try {
        await this.connect();
      } catch {
        this.scheduleReconnect();
      }
    }, delay);
  }

  async disconnect() {
    this.destroyed = true;
    this.stopStallWatchdog();
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    this.nextRetryAt = null;
    try {
      this.conn.disconnect();
    } catch {
      /* ignore */
    }
    log.info(`[tiktok] disconnected (user) @${this.username}`);
    this.setPhase('disconnected');
  }
}
