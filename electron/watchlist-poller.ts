import { WebcastPushConnection } from 'tiktok-live-connector';
import { settings } from './store';

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
      const watchlist = (settings.get('watchlist', []) as string[]) ?? [];
      if (watchlist.length === 0) return;
      const signApiKey = (settings.get('signApiKey', '') as string) || undefined;

      for (const username of watchlist) {
        const isLive = await this.checkLive(username, signApiKey);
        const now = Date.now();
        const wasLive = this.lastSeenLive.has(username);
        if (isLive && !wasLive) {
          this.lastSeenLive.set(username, now);
          this.cbs.onLiveDetected({ username, detectedAt: now });
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

  private async checkLive(username: string, signApiKey: string | undefined): Promise<boolean> {
    let conn: WebcastPushConnection | null = null;
    try {
      conn = new WebcastPushConnection(username, {
        processInitialData: false,
        enableExtendedGiftInfo: false,
        signApiKey,
      });
      const state: any = await conn.connect();
      const live = state?.isConnected === true && state?.roomInfo;
      conn.disconnect();
      return !!live;
    } catch {
      try { conn?.disconnect(); } catch { /* ignore */ }
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
