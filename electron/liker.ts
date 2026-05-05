import { BrowserWindow, ipcMain } from 'electron';

export type LikerMode = 'normal' | 'human' | 'extreme';

export type LikerStats = {
  isActive: boolean;
  mode: LikerMode;
  interval: number;
  likesCount: number;
  keypressCount: number;
  sessionStartTime: number;
  state: string;
  isLivePage: boolean;
};

let likerWin: BrowserWindow | null = null;
let statsCallback: ((stats: LikerStats) => void) | null = null;

const DESKTOP_UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Safari/605.1.15';

const CONTENT_SCRIPT = `
(function() {
  if (window.__WTL_LOADED__) return;
  window.__WTL_LOADED__ = true;

  class TikTokAutoLiker {
    constructor() {
      this.isActive = false;
      this.interval = 1000;
      this.intervalId = null;
      this.isLivePage = false;
      this.lastKeyPress = 0;
      this.minInterval = 500;
      this.behaviorMode = 'normal';
      this.humanState = 'ready';
      this.sessionStartTime = 0;
      this.sessionDuration = 0;
      this.breakStartTime = 0;
      this.breakDuration = 0;
      this.likesCount = 0;
      this.keypressCount = 0;
      this.isKeyHeld = false;
      this.extremeCounterInterval = null;
      this.humanModeTimeoutId = null;
      this._timers = new Set();
      this.progressCheckInterval = null;
      this.stateLabel = 'Idle';
      this.init();
    }

    init() {
      this.checkIfLivePage();
      this.observePageChanges();
      this.setupIpcBridge();
      console.log('[WTL] Auto Liker loaded in Electron');
    }

    checkIfLivePage() {
      const url = window.location.href;
      const urlMatch = /tiktok\\.com\\/.*\\/live/i.test(url) || /tiktok\\.com\\/live/i.test(url);
      const hasVideo = document.querySelectorAll('video').length > 0;
      const hasLiveText = (document.body.textContent || '').includes('LIVE');
      this.isLivePage = urlMatch || (hasVideo && hasLiveText);
      return this.isLivePage;
    }

    observePageChanges() {
      let lastUrl = location.href;
      const check = () => { this.checkIfLivePage(); };
      const origPush = history.pushState;
      const origReplace = history.replaceState;
      history.pushState = (...args) => { const r = origPush.apply(history, args); check(); return r; };
      history.replaceState = (...args) => { const r = origReplace.apply(history, args); check(); return r; };
      window.addEventListener('popstate', check);
      setInterval(check, 8000);
    }

    setupIpcBridge() {
      window.addEventListener('message', (e) => {
        if (!e.data || !e.data.__WTL_CMD__) return;
        const { cmd, payload } = e.data;
        switch (cmd) {
          case 'start':
            if (payload.mode) this.behaviorMode = payload.mode;
            if (payload.interval) this.interval = Math.max(payload.interval, this.minInterval);
            this.startLiking();
            break;
          case 'stop':
            this.stopLiking();
            break;
          case 'updateInterval':
            this.interval = Math.max(payload.interval, this.minInterval);
            if (this.isActive && this.behaviorMode === 'normal') {
              this.stopAutoLiking();
              this.startNormalMode();
            }
            break;
          case 'updateMode':
            this.behaviorMode = payload.mode;
            if (this.isActive) {
              this.stopAutoLiking();
              this.startSelectedMode();
            }
            break;
          case 'getStats':
            this.pushStats();
            break;
        }
      });
      setInterval(() => { if (this.isActive) this.pushStats(); }, 1000);
    }

    pushStats() {
      window.postMessage({
        __WTL_STATS__: true,
        stats: {
          isActive: this.isActive,
          mode: this.behaviorMode,
          interval: this.interval,
          likesCount: this.likesCount,
          keypressCount: this.keypressCount,
          sessionStartTime: this.sessionStartTime,
          state: this.stateLabel,
          isLivePage: this.isLivePage,
        }
      }, '*');
    }

    focusPrimaryTarget() {
      const selectors = [
        '[data-e2e="live-player"]',
        '[data-e2e="live-video"]',
        '.live-player',
        'video',
        'body'
      ];
      for (const sel of selectors) {
        const el = document.querySelector(sel);
        if (el) {
          try { el.focus(); } catch(_) {}
          return el;
        }
      }
      return document.body;
    }

    findLikeButton() {
      // Try multiple selectors TikTok uses for the like button
      const selectors = [
        '[data-e2e="like-icon"]',
        '[data-e2e="browse-like-icon"]',
        '[data-e2e="live-room-like"]',
        '[aria-label*="ike" i]',
        'button[class*="ike"]',
        'div[class*="LikeButton" i]',
        'div[class*="like-button" i]',
      ];
      for (const sel of selectors) {
        const el = document.querySelector(sel);
        if (el) return el;
      }
      return null;
    }

    sendLikeKeyPress() {
      const now = Date.now();
      const effectiveMin = this.behaviorMode === 'extreme' ? 40 : this.minInterval;
      if (now - this.lastKeyPress < effectiveMin) return;

      try {
        this.focusPrimaryTarget();

        // Strategy 1: Send "L" key event (works on TikTok desktop web)
        const opts = {
          key: 'l', code: 'KeyL', keyCode: 76, which: 76,
          bubbles: true, cancelable: true, composed: true
        };

        const targets = [
          document.querySelector('[data-e2e="live-player"]'),
          document.querySelector('video'),
          document.activeElement,
          document.body,
          window
        ].filter(Boolean);

        const down = new KeyboardEvent('keydown', opts);
        const press = new KeyboardEvent('keypress', opts);
        const up = new KeyboardEvent('keyup', opts);

        for (const t of targets) {
          try { t.dispatchEvent(down); } catch(_) {}
          try { t.dispatchEvent(press); } catch(_) {}
        }
        setTimeout(() => {
          for (const t of targets) {
            try { t.dispatchEvent(up); } catch(_) {}
          }
        }, 10);

        // Strategy 2 (fallback): click the like button directly if we can find it
        const likeBtn = this.findLikeButton();
        if (likeBtn) {
          try {
            const rect = likeBtn.getBoundingClientRect();
            const x = rect.left + rect.width / 2;
            const y = rect.top + rect.height / 2;
            const evtOpts = { bubbles: true, cancelable: true, composed: true, clientX: x, clientY: y, button: 0 };
            likeBtn.dispatchEvent(new PointerEvent('pointerdown', evtOpts));
            likeBtn.dispatchEvent(new MouseEvent('mousedown', evtOpts));
            likeBtn.dispatchEvent(new PointerEvent('pointerup', evtOpts));
            likeBtn.dispatchEvent(new MouseEvent('mouseup', evtOpts));
            likeBtn.dispatchEvent(new MouseEvent('click', evtOpts));
          } catch(_) {}
        }

        this.lastKeyPress = now;
        this.keypressCount++;
        this.likesCount++;
      } catch (e) {
        console.error('[WTL] Key press error:', e);
      }
    }

    startLiking() {
      this.stopAutoLiking();
      this.isActive = true;
      this.likesCount = 0;
      this.keypressCount = 0;
      this.sessionStartTime = Date.now();
      this.focusPrimaryTarget();
      this.startSelectedMode();
      this.progressCheckInterval = setInterval(() => {
        this.focusPrimaryTarget();
      }, 3000);
      this.pushStats();
    }

    stopLiking() {
      this.isActive = false;
      this.humanState = 'ready';
      this.isKeyHeld = false;
      this.stopAutoLiking();
      if (this.progressCheckInterval) {
        clearInterval(this.progressCheckInterval);
        this.progressCheckInterval = null;
      }
      this.stateLabel = 'Stopped';
      this.pushStats();
    }

    startSelectedMode() {
      switch (this.behaviorMode) {
        case 'human': this.startHumanLikeMode(); break;
        case 'extreme': this.startExtremeMode(); break;
        default: this.startNormalMode(); break;
      }
    }

    startNormalMode() {
      this.stateLabel = 'Normal — Active';
      this.intervalId = setInterval(() => this.sendLikeKeyPress(), this.interval);
    }

    startExtremeMode() {
      this.stateLabel = 'EXTREME — Rapid Fire';
      this.intervalId = setInterval(() => {
        if (!this.isActive) { clearInterval(this.intervalId); this.intervalId = null; return; }
        this.sendLikeKeyPress();
      }, 50);
    }

    startHumanLikeMode() {
      this.humanState = 'tapping';
      this.sessionStartTime = Date.now();
      this.sessionDuration = this.randomBetween(20000, 40000);
      this.stateLabel = 'Human — Tapping';
      this.scheduleNextHumanAction();
    }

    scheduleNextHumanAction() {
      if (!this.isActive) return;
      const now = Date.now();
      switch (this.humanState) {
        case 'tapping':
          if (now - this.sessionStartTime >= this.sessionDuration) {
            if (Math.random() < 0.25) this.startLongBreak();
            else this.startShortBreak();
          } else {
            const randomInterval = this.interval + this.randomBetween(-200, 200);
            const safeInterval = Math.max(randomInterval, this.minInterval);
            this.humanModeTimeoutId = setTimeout(() => {
              if (!this.isActive) return;
              this.sendLikeKeyPress();
              this.scheduleNextHumanAction();
            }, safeInterval);
          }
          break;
        case 'short_break':
          if (now - this.breakStartTime >= this.breakDuration) {
            this.startTappingSession();
          } else {
            this.humanModeTimeoutId = setTimeout(() => {
              if (!this.isActive) return;
              this.scheduleNextHumanAction();
            }, 1000);
          }
          break;
        case 'long_break':
          if (now - this.breakStartTime >= this.breakDuration) {
            this.startTappingSession();
          } else {
            this.humanModeTimeoutId = setTimeout(() => {
              if (!this.isActive) return;
              this.scheduleNextHumanAction();
            }, 5000);
          }
          break;
      }
    }

    startTappingSession() {
      this.humanState = 'tapping';
      this.sessionStartTime = Date.now();
      this.sessionDuration = this.randomBetween(20000, 40000);
      this.stateLabel = 'Human — Tapping';
      this.pushStats();
      this.scheduleNextHumanAction();
    }

    startShortBreak() {
      this.humanState = 'short_break';
      this.breakStartTime = Date.now();
      this.breakDuration = this.randomBetween(2000, 8000);
      this.stateLabel = 'Human — Short Break';
      this.pushStats();
      this.scheduleNextHumanAction();
    }

    startLongBreak() {
      this.humanState = 'long_break';
      this.breakStartTime = Date.now();
      this.breakDuration = this.randomBetween(30000, 120000);
      this.stateLabel = 'Human — Long Break';
      this.pushStats();
      this.scheduleNextHumanAction();
    }

    randomBetween(min, max) {
      return Math.floor(Math.random() * (max - min + 1)) + min;
    }

    stopAutoLiking() {
      if (this.intervalId) {
        clearInterval(this.intervalId);
        clearTimeout(this.intervalId);
        this.intervalId = null;
      }
      if (this.humanModeTimeoutId) {
        clearTimeout(this.humanModeTimeoutId);
        this.humanModeTimeoutId = null;
      }
      if (this.extremeCounterInterval) {
        clearInterval(this.extremeCounterInterval);
        this.extremeCounterInterval = null;
      }
      if (this._timers.size) {
        this._timers.forEach(id => { try { clearTimeout(id); clearInterval(id); } catch(_) {} });
        this._timers.clear();
      }
      this.isKeyHeld = false;
      this.humanState = 'ready';
    }
  }

  window.__wtlLiker = new TikTokAutoLiker();
})();
`;

export function createLikerWindow(): BrowserWindow {
  if (likerWin && !likerWin.isDestroyed()) {
    likerWin.focus();
    return likerWin;
  }

  likerWin = new BrowserWindow({
    width: 1100,
    height: 800,
    title: 'TikTok Live Liker',
    backgroundColor: '#000000',
    webPreferences: {
      contextIsolation: false,
      nodeIntegration: false,
      partition: 'persist:tiktok',
      webSecurity: true,
    },
  });

  likerWin.webContents.setUserAgent(DESKTOP_UA);

  likerWin.webContents.on('did-finish-load', () => {
    injectScript();
  });

  likerWin.webContents.on('did-navigate-in-page', () => {
    setTimeout(injectScript, 1000);
  });

  likerWin.on('closed', () => {
    likerWin = null;
  });

  return likerWin;
}

function injectScript() {
  if (!likerWin || likerWin.isDestroyed()) return;
  likerWin.webContents.executeJavaScript(CONTENT_SCRIPT).catch(() => {});

  likerWin.webContents.executeJavaScript(`
    window.addEventListener('message', (e) => {
      if (e.data && e.data.__WTL_STATS__) {
        require('electron').ipcRenderer;
      }
    });
  `).catch(() => {});
}

function sendCmd(cmd: string, payload: Record<string, unknown> = {}) {
  if (!likerWin || likerWin.isDestroyed()) return;
  likerWin.webContents.executeJavaScript(
    `window.postMessage({ __WTL_CMD__: true, cmd: ${JSON.stringify(cmd)}, payload: ${JSON.stringify(payload)} }, '*');`
  ).catch(() => {});
}

async function getStats(): Promise<LikerStats | null> {
  if (!likerWin || likerWin.isDestroyed()) return null;
  try {
    const result = await likerWin.webContents.executeJavaScript(`
      (function() {
        const l = window.__wtlLiker;
        if (!l) return null;
        return {
          isActive: l.isActive,
          mode: l.behaviorMode,
          interval: l.interval,
          likesCount: l.likesCount,
          keypressCount: l.keypressCount,
          sessionStartTime: l.sessionStartTime,
          state: l.stateLabel,
          isLivePage: l.isLivePage,
        };
      })()
    `);
    return result;
  } catch {
    return null;
  }
}

export function setupLikerIpc(broadcast: (channel: string, payload: unknown) => void) {
  ipcMain.handle('liker:open', async (_e, username: string) => {
    const handle = username.replace(/^@/, '').trim();
    if (!handle) return { ok: false, error: 'Empty username' };
    const win = createLikerWindow();
    win.loadURL(`https://www.tiktok.com/@${encodeURIComponent(handle)}/live`);
    return { ok: true };
  });

  ipcMain.handle('liker:close', () => {
    if (likerWin && !likerWin.isDestroyed()) {
      sendCmd('stop');
      likerWin.close();
    }
    return { ok: true };
  });

  ipcMain.handle('liker:start', (_e, mode: LikerMode, interval: number) => {
    sendCmd('start', { mode, interval });
    return { ok: true };
  });

  ipcMain.handle('liker:stop', () => {
    sendCmd('stop');
    return { ok: true };
  });

  ipcMain.handle('liker:setMode', (_e, mode: LikerMode) => {
    sendCmd('updateMode', { mode });
    return { ok: true };
  });

  ipcMain.handle('liker:setInterval', (_e, interval: number) => {
    sendCmd('updateInterval', { interval });
    return { ok: true };
  });

  ipcMain.handle('liker:stats', async () => {
    return await getStats();
  });

  ipcMain.handle('liker:isOpen', () => {
    return !!(likerWin && !likerWin.isDestroyed());
  });

  ipcMain.handle('liker:show', () => {
    if (likerWin && !likerWin.isDestroyed()) {
      likerWin.show();
      likerWin.focus();
    }
    return { ok: true };
  });

  ipcMain.handle('liker:hide', () => {
    if (likerWin && !likerWin.isDestroyed()) {
      likerWin.hide();
    }
    return { ok: true };
  });
}

export function closeLikerWindow() {
  if (likerWin && !likerWin.isDestroyed()) {
    sendCmd('stop');
    likerWin.close();
    likerWin = null;
  }
}
