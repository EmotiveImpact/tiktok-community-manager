import { WebcastPushConnection } from 'tiktok-live-connector';
import { settings, recordWatchlistSeen, type WatchEntry } from './store';

export type LiveDetectedEvent = {
  username: string;
  detectedAt: number;
};

type Callbacks = {
  onLiveDetected: (evt: LiveDetectedEvent) => void;
};

const POLL_INTERVAL_MS = 5 * 60 * 1000;
const PER_USER_DELAY_MS = 2000;

export class WatchlistPoller {
  private timer: NodeJS.Timeout | null = null;
  private lastSeenLive = new Map<string, number>();
  private cbs: Callbacks;
  private isRunning = false;

  constructor(cbs: Callbacks) {
    this.cbs = cbs;
  }

  start() {
    if (this.timer) return;
    this.tick().catch(() => {});
    this.timer = setInterval(() => {
      this.tick().catch(() => {});
    }, POLL_INTERVAL_MS);
  }

  stop() {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
    this.lastSeenLive.clear();
  }

  private async tick() {
    if (this.isRunning) return;
    this.isRunning = true;
    try {
      const watchlist = (settings.get('watchlist', []) as WatchEntry[]) ?? [];
      if (watchlist.length === 0) return;
      const signApiKey = (settings.get('signApiKey', '') as string).trim() || null;

      for (const entry of watchlist) {
        const username = entry.username;
        const isLive = await this.checkLive(username, signApiKey);
        const now = Date.now();
        const wasLive = this.lastSeenLive.has(username);
        if (isLive && !wasLive) {
          this.lastSeenLive.set(username, now);
          // Persist lastSeen for every tracked user so the panel can show it,
          // but only raise a notification when notify is on for this entry.
          recordWatchlistSeen(username, now);
          if (entry.notify !== false) {
            this.cbs.onLiveDetected({ username, detectedAt: now });
          }
        } else if (!isLive && wasLive) {
          this.lastSeenLive.delete(username);
        } else if (isLive) {
          this.lastSeenLive.set(username, now);
        }
        await new Promise((r) => setTimeout(r, PER_USER_DELAY_MS));
      }
    } finally {
      this.isRunning = false;
    }
  }

  private async checkLive(username: string, signApiKey: string | null): Promise<boolean> {
    // v2: use the dedicated fetchIsLive() probe instead of opening a full
    // websocket connection. In v1 the poller called connect() and inspected
    // `state.roomInfo`, but v2 returns `roomInfo: null` from connect() unless
    // `fetchRoomInfoOnConnect` is set — so the old truthiness check would never
    // detect a live user. fetchIsLive() hits room-info (HTML → API → Euler
    // fallbacks) and is far lighter (no WS upgrade / no event subscription).
    try {
      const conn = new WebcastPushConnection(username, {
        processInitialData: false,
        enableExtendedGiftInfo: false,
        signApiKey,
      });
      return await conn.fetchIsLive();
    } catch {
      return false;
    }
  }

  notifyConnected(username: string) {
    this.lastSeenLive.set(username, Date.now());
  }

  pokeNow() {
    this.tick().catch(() => {});
  }
}
