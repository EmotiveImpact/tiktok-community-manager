/**
 * EulerStream REST client (room_info).
 *
 * The app already signs its tiktok-live-connector WebSocket connection through
 * EulerStream's *signing* endpoint (the free tier). Separately, EulerStream
 * exposes a REST API at https://tiktok.eulerstream.com authenticated with the
 * SAME key via an `x-api-key` header. We use one endpoint here:
 *
 *   GET /webcast/room_info?uniqueId={creator}
 *
 * which returns the LIVE room's title, viewer counts, start time, and — most
 * importantly — the short-lived signed HLS/FLV pull URLs for the actual video.
 * The connector's own connect() response usually LACKS a usable stream_url, so
 * this is our reliable fallback for the in-app player.
 *
 * IMPORTANT — tier gating: room_info is a PAID feature (Business / Premium
 * Routes). A working *signing* key does NOT imply room_info access. On an
 * insufficient tier EulerStream returns 401/402/403; we map that to
 * `reason: 'unauthorized'` so the UI can show an honest "needs a paid plan"
 * message rather than pretending a player exists.
 *
 * Contract: this module NEVER throws to callers. Every path resolves a typed
 * `RoomInfoResult`. Pull URLs are short-lived + signed — callers must NOT
 * persist them; refetch on expiry.
 */
import { log } from './logger';

const BASE = 'https://tiktok.eulerstream.com';
/** Hard ceiling on the room_info request so a hung fetch can't wedge the pipeline. */
const TIMEOUT_MS = 8_000;

export type RoomInfoReason =
  | 'no-key' // no EulerStream key configured
  | 'unauthorized' // 401/402/403 — room_info needs a paid (Business/Premium) plan
  | 'not-live' // creator isn't currently live (is_live=false)
  | 'network' // transport/timeout/abort
  | 'error'; // anything else (non-OK HTTP, bad JSON, etc.)

export type RoomInfoResult = {
  ok: boolean;
  /** Why the call did not yield a usable live result (absent when ok && isLive). */
  reason?: RoomInfoReason;
  /** Human-readable diagnostic, surfaced in logs and (for 'unauthorized') the UI. */
  message?: string;
  isLive?: boolean;
  roomId?: string;
  title?: string;
  coverUrl?: string;
  /** epoch ms (room_info exposes start_time in seconds; we normalise to ms). */
  startTime?: number;
  currentViewers?: number;
  totalViewers?: number;
  /** Short-lived signed HLS pull URL — preferred for the hls.js player. */
  hlsUrl?: string;
  /** Short-lived signed FLV pull URL — fallback transport. */
  flvUrl?: string;
};

/** Coerce protobuf-string / number-ish values to a finite number, else undefined. */
function num(v: unknown): number | undefined {
  if (v == null) return undefined;
  const n = typeof v === 'number' ? v : Number(v);
  return Number.isFinite(n) ? n : undefined;
}

function str(v: unknown): string | undefined {
  return typeof v === 'string' && v.trim() ? v : undefined;
}

/**
 * Fetch the EulerStream room_info for a creator.
 *
 * @param uniqueId TikTok @username (with or without a leading '@').
 * @param apiKey   The EulerStream API key (same value used for signing).
 */
export async function getRoomInfo(uniqueId: string, apiKey: string): Promise<RoomInfoResult> {
  const handle = String(uniqueId ?? '').replace(/^@/, '').trim();
  const key = String(apiKey ?? '').trim();

  if (!key) {
    return { ok: false, reason: 'no-key', message: 'No EulerStream API key configured.' };
  }
  if (!handle) {
    return { ok: false, reason: 'error', message: 'Missing uniqueId.' };
  }

  const url = `${BASE}/webcast/room_info?uniqueId=${encodeURIComponent(handle)}`;
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);

  try {
    const res = await fetch(url, {
      method: 'GET',
      headers: { 'x-api-key': key, accept: 'application/json' },
      signal: ctrl.signal,
    });

    // Tier gating: a valid *signing* key may still lack room_info access.
    if (res.status === 401 || res.status === 402 || res.status === 403) {
      const message =
        'EulerStream room_info needs a Business/Premium plan — your current key is not authorized for it.';
      log.warn(`[eulerstream] room_info unauthorized (HTTP ${res.status}) @${handle}`);
      return { ok: false, reason: 'unauthorized', message };
    }

    if (!res.ok) {
      const message = `room_info returned HTTP ${res.status}.`;
      log.warn(`[eulerstream] ${message} @${handle}`);
      return { ok: false, reason: 'error', message };
    }

    let body: any;
    try {
      body = await res.json();
    } catch (err: any) {
      log.warn(`[eulerstream] room_info bad JSON @${handle}: ${err?.message ?? err}`);
      return { ok: false, reason: 'error', message: 'room_info returned malformed JSON.' };
    }

    // Some gateways wrap the payload as { data: {...} }; accept either shape.
    const d = body?.data ?? body ?? {};

    const isLive = d?.is_live === true || d?.isLive === true;
    if (!isLive) {
      log.info(`[eulerstream] room_info: @${handle} is not live`);
      return { ok: true, isLive: false, reason: 'not-live', message: `@${handle} is not live.` };
    }

    const startSec = num(d?.start_time ?? d?.startTime);
    const result: RoomInfoResult = {
      ok: true,
      isLive: true,
      roomId: str(d?.id ?? d?.room_id ?? d?.roomId),
      title: str(d?.title),
      coverUrl: str(d?.cover_url ?? d?.coverUrl),
      startTime: startSec != null ? startSec * 1000 : undefined,
      currentViewers: num(d?.current_viewers ?? d?.currentViewers),
      totalViewers: num(d?.total_viewers ?? d?.totalViewers),
      // Prefer the full-quality HLS; fall back to the LD variant. Same for FLV.
      hlsUrl: str(d?.hls_pull_url ?? d?.hlsPullUrl ?? d?.hls_pull_url_ld),
      flvUrl: str(d?.flv_pull_url ?? d?.flvPullUrl ?? d?.flv_pull_url_ld),
    };
    log.info(
      `[eulerstream] room_info OK @${handle} live=${result.isLive} hls=${result.hlsUrl ? 'yes' : 'no'} viewers=${result.currentViewers ?? '?'}`,
    );
    return result;
  } catch (err: any) {
    const aborted = err?.name === 'AbortError';
    const message = aborted
      ? `room_info timed out after ${TIMEOUT_MS}ms.`
      : `room_info network error: ${err?.message ?? String(err)}`;
    log.warn(`[eulerstream] ${message} @${handle}`);
    return { ok: false, reason: 'network', message };
  } finally {
    clearTimeout(timer);
  }
}
