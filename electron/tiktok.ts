import { WebcastPushConnection } from 'tiktok-live-connector';
import { settings } from './store';

export type ConnectionStatus =
  | 'idle'
  | 'connecting'
  | 'connected'
  | 'reconnecting'
  | 'disconnected'
  | 'error';

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
  | { type: 'streamEnd'; ts: number };

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

  private wireEvents() {
    const c = this.conn;

    c.on('like', (d: any) => {
      this.cbs.onEvent({
        type: 'like',
        ts: Date.now(),
        user: brief(d),
        likeCount: d?.likeCount ?? 1,
        totalLikeCount: d?.totalLikeCount ?? 0,
      });
    });

    c.on('chat', (d: any) => {
      this.cbs.onEvent({
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
      this.cbs.onEvent({
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
      this.cbs.onEvent({ type: 'member', ts: Date.now(), user: brief(d) });
    });
    c.on('follow', (d: any) => {
      this.cbs.onEvent({ type: 'follow', ts: Date.now(), user: brief(d) });
    });
    c.on('share', (d: any) => {
      this.cbs.onEvent({ type: 'share', ts: Date.now(), user: brief(d) });
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
      this.cbs.onEvent({
        type: 'roomUser',
        ts: Date.now(),
        viewerCount: d?.viewerCount ?? 0,
      });
    });

    c.on('questionNew', (d: any) => {
      this.cbs.onEvent({
        type: 'questionNew',
        ts: Date.now(),
        user: brief(d?.questionDetails?.user ?? d?.user ?? d),
        question: d?.questionText ?? d?.questionDetails?.questionText ?? '',
      });
    });

    c.on('envelope', (d: any) => {
      this.cbs.onEvent({
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
      this.cbs.onEvent({ type: 'linkMicBattle', ts: Date.now(), armies });
    });

    c.on('emote', (d: any) => {
      this.cbs.onEvent({
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
      this.cbs.onEvent({
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
      this.cbs.onEvent({ type: 'streamEnd', ts: Date.now() });
      this.cbs.onStatus('disconnected', 'Stream ended');
    });

    c.on('disconnected', () => {
      if (this.destroyed) return;
      this.cbs.onStatus('reconnecting');
      this.scheduleReconnect();
    });
  }

  async connect() {
    this.cbs.onStatus('connecting');
    try {
      const state: any = await this.conn.connect();
      this.reconnectAttempt = 0;
      this.cbs.onStatus('connected');
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
      const su = ri?.stream_url ?? ri?.streamUrl ?? {};
      if (!su || Object.keys(su).length === 0) {
        console.log('[tiktok] No stream_url in roomInfo.data. Keys:', Object.keys(ri).join(', '));
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
      console.log('[tiktok] roomInfo.data keys:', Object.keys(ri).join(', '));
      console.log('[tiktok] create_time:', createTime, 'like_count:', ri?.like_count, 'user_count:', ri?.user_count);
      this.cbs.onEvent({
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
          hlsUrl: pickFirst(hlsCandidates) ?? su?.hls_pull_url ?? null,
          flvUrl: pickFirst(flvCandidates) ?? su?.rtmp_pull_url ?? null,
          startedAt,
        },
      });
    } catch (err: any) {
      this.cbs.onStatus('error', err?.message ?? String(err));
      throw err;
    }
  }

  private scheduleReconnect() {
    if (this.destroyed) return;
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    const delay = Math.min(30_000, 1000 * 2 ** this.reconnectAttempt);
    this.reconnectAttempt++;
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
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    try {
      this.conn.disconnect();
    } catch {
      /* ignore */
    }
    this.cbs.onStatus('disconnected');
  }
}
