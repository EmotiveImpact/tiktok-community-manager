import { app, BrowserWindow, ipcMain, shell, Notification } from 'electron';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { TikTokSession, type ConnectionStatus, type ConnectionDetail, type NormalizedEvent } from './tiktok';
import { log, logsDir, revealLogs } from './logger';
import { settings, notesStore, customFieldsStore, setMyAccount, normalizeUsername, DEFAULT_COMMUNITY, DEFAULT_EARNINGS, DEFAULT_THANK_TEMPLATE, DEFAULT_MODERATION, DEFAULT_MY_ACCOUNT, type CommunitySettings, type EarningsSettings, type ModerationSettings, type WatchEntry, type MyAccount, type CustomFieldType } from './store';
import * as sessions from './sessions';
import * as crm from './crm';
import { addInteraction } from './interactions';
import { summarize, type SummaryInput } from './summarize';
import { exportSession, type ExportType } from './export';
import { startOverlayServer, pushEvent as pushOverlayEvent, resetStats as resetOverlayStats, getOverlayPort } from './overlay';
import { dispatchWebhook } from './webhooks';
import { startLog, appendLog, stopLog, getLogDir } from './chatlog';
import { WatchlistPoller } from './watchlist-poller';
import { startRollingBuffer, stopRollingBuffer, captureClip, isFfmpegAvailable, getClipsDir, listClips } from './highlights';
import { setupLikerIpc, closeLikerWindow } from './liker';
import { checkForUpdatesOnStartup, checkForUpdatesManual } from './updater';
import * as fans from './fans';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Tier/quiet/birthday thresholds come from the settings store (Settings → Community rules).
fans.setRulesGetter(() => settings.get('community', DEFAULT_COMMUNITY));

// ONE definition of "cold": reminders defer to the strength engine (same source
// the Followers "Going cold" segment, dashboard watchlist + profile header use).
// Fail-safe: any error → null, and fans.ts falls back to its legacy heuristic.
fans.setColdResolver((uniqueId) => {
  try {
    return crm.strengthForFan(uniqueId).result.temperature === 'cold';
  } catch {
    return null;
  }
});

// BATCHED cold resolver: compute "is cold" for all VIP/Whale fans in ONE strength
// pass (same engine, same result) so listReminders doesn't re-read the ledger +
// re-scan sessions per fan. Fail-safe — falls back to the per-fan resolver above.
fans.setColdResolverBatch((ids) => {
  const map = new Map<string, boolean>();
  try {
    const tierOf = (uid: string) => fans.getFan(uid)?.tier ?? 'New';
    const bundles = crm.strengthForAll(ids.map((uniqueId) => ({ uniqueId, tier: tierOf(uniqueId) })));
    for (const [uid, b] of bundles) map.set(uid, b.result.temperature === 'cold');
  } catch {
    /* empty map → listReminders falls back to the per-fan resolver */
  }
  return map;
});

const VITE_DEV_SERVER_URL = process.env.VITE_DEV_SERVER_URL;

let mainWindow: BrowserWindow | null = null;
let session: TikTokSession | null = null;
let currentSessionId: string | null = null;
const multiSessions = new Map<string, TikTokSession>();
const watchlistPoller = new WatchlistPoller({
  onLiveDetected: (evt) => {
    // Keep the in-app panel/toast wiring exactly as before.
    broadcast('watchlist:live', evt);
    // …and additionally fire a NATIVE OS notification so the creator is alerted
    // even when the app is backgrounded. Fully fail-safe: any error here must
    // never break the poller or the live pipeline.
    try {
      maybeNotifyGoLive(evt.username);
    } catch (err) {
      log.warn('[main] go-live notification failed:', (err as any)?.message ?? err);
    }
  },
});

/**
 * Fire a native go-live notification for a watched creator, gated by:
 *  - the global `notifyOnGoLive` setting (default true)
 *  - the per-entry `notify` flag (already enforced by the poller before this
 *    callback runs — it only calls onLiveDetected when entry.notify !== false)
 *  - skip the creator's OWN account (no point pinging yourself going live)
 *  - Notification.isSupported() (older/headless platforms)
 * Clicking the notification raises the window and navigates the renderer to the
 * live page, pre-filled with this username.
 */
function maybeNotifyGoLive(username: string) {
  if (!settings.get('notifyOnGoLive', true)) return;
  const myAccount = settings.get('myAccount', DEFAULT_MY_ACCOUNT) as MyAccount;
  if (myAccount.username && normalizeUsername(username) === myAccount.username) return;
  if (!Notification.isSupported()) return;
  const notif = new Notification({
    title: `🔴 @${username} is live`,
    body: 'Tap to watch / track their gifts',
    silent: false,
  });
  notif.on('click', () => {
    try {
      if (mainWindow && !mainWindow.isDestroyed()) {
        if (mainWindow.isMinimized()) mainWindow.restore();
        mainWindow.show();
        mainWindow.focus();
      }
      broadcast('navigate:connect', { username });
    } catch (err) {
      log.warn('[main] go-live notification click handler failed:', (err as any)?.message ?? err);
    }
  });
  notif.show();
}

// Single-instance lock: two app instances would race on the shared
// fans/*.json + sessions/*.json ledgers (the audit reproduced a tmp+rename
// race that corrupts fans.json). Acquire the lock; if another instance already
// holds it, quit immediately and let the running instance focus its window.
const gotSingleInstanceLock = app.requestSingleInstanceLock();
if (!gotSingleInstanceLock) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.show();
      mainWindow.focus();
    }
  });
}

function createWindow() {
  const isMac = process.platform === 'darwin';

  // macOS-only chrome: hiddenInset titlebar + native vibrancy. These options are
  // a no-op-to-broken combination on Windows/Linux:
  //   - titleBarStyle:'hiddenInset' hides the OS title bar but leaves a dead,
  //     undraggable inset where the traffic-light buttons would be (Win/Linux
  //     have no such buttons), so the user is left with an empty unusable strip.
  //   - vibrancy/visualEffectState are macOS-only (ignored elsewhere) and require
  //     a transparent backgroundColor ('#00000000'); on Windows that transparent
  //     backing makes the window render with no opaque surface during load.
  // So on macOS we keep the exact same look as before; on Windows/Linux we use a
  // standard framed window with a solid dark background that matches the app's
  // dark theme (the renderer's `-webkit-app-region: drag` titlebar strip still
  // works as a drag handle on the standard frame).
  const platformWindowOptions: Electron.BrowserWindowConstructorOptions = isMac
    ? {
        titleBarStyle: 'hiddenInset',
        // Native macOS vibrancy — translucent app surfaces show desktop blur through.
        vibrancy: 'under-window',
        visualEffectState: 'active',
        backgroundColor: '#00000000',
        transparent: false,
      }
    : {
        // Standard opaque window on Windows/Linux. Solid dark hex so there is no
        // flash-of-transparent and no dead inset region.
        backgroundColor: '#0b0f1e',
        transparent: false,
      };

  mainWindow = new BrowserWindow({
    width: 1240,
    height: 820,
    minWidth: 900,
    minHeight: 600,
    ...platformWindowOptions,
    webPreferences: {
      preload: path.join(__dirname, 'preload.mjs'),
      contextIsolation: true,
      nodeIntegration: false,
      webviewTag: true,
      // sandbox is intentionally LEFT OFF (defaults to false here): vite-plugin-
      // electron emits the preload as an ES module (preload.mjs), and Electron's
      // sandbox only supports CommonJS preloads — a sandboxed renderer cannot
      // load an .mjs preload, which would null out window.tiktok (contextBridge)
      // and break the entire app. Security is still maintained via
      // contextIsolation + nodeIntegration:false + the webview nav allowlist +
      // openExternal restriction + the CSP meta in index.html. Enabling sandbox
      // would require converting the preload bundle to CJS first.
    },
  });

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: 'deny' };
  });

  if (VITE_DEV_SERVER_URL) {
    mainWindow.loadURL(VITE_DEV_SERVER_URL);
  } else {
    mainWindow.loadFile(path.join(__dirname, '..', 'dist', 'index.html'));
  }
}

/**
 * Navigation allowlist for embedded <webview> panes (Messages page TikTok
 * session + StreamPlayer's mobile view). The webviews are plain user-driven
 * browsers — we never inject scripts or read their content — but we do keep
 * them fenced to TikTok (+ the login/captcha hosts TikTok web redirects to).
 * Anything else opens in the system browser instead.
 */
const WEBVIEW_ALLOWED_SUFFIXES = [
  'tiktok.com', 'tiktokv.com', 'tiktokcdn.com', 'tiktokw.us',
  'byteoversea.com', 'bytedance.com', // TikTok captcha / infra hosts
];
const WEBVIEW_ALLOWED_EXACT = [
  // OAuth login hosts offered on tiktok.com/login
  'accounts.google.com', 'appleid.apple.com',
  'www.facebook.com', 'm.facebook.com', 'web.facebook.com',
];
function webviewNavAllowed(rawUrl: string): boolean {
  try {
    const u = new URL(rawUrl);
    if (u.protocol === 'about:') return true;
    if (u.protocol !== 'https:') return false;
    const host = u.hostname.toLowerCase();
    if (WEBVIEW_ALLOWED_EXACT.includes(host)) return true;
    return WEBVIEW_ALLOWED_SUFFIXES.some((d) => host === d || host.endsWith(`.${d}`));
  } catch {
    return false;
  }
}

app.on('web-contents-created', (_event, contents) => {
  if (contents.getType() !== 'webview') return;
  contents.on('will-navigate', (event, url) => {
    if (!webviewNavAllowed(url)) {
      event.preventDefault();
      if (/^https?:/i.test(url)) shell.openExternal(url);
    }
  });
  contents.setWindowOpenHandler(({ url }) => {
    if (webviewNavAllowed(url)) return { action: 'allow' };
    if (/^https?:/i.test(url)) shell.openExternal(url);
    return { action: 'deny' };
  });
});

function broadcast(channel: string, payload: unknown) {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send(channel, payload);
  }
}

/**
 * Single source of truth for the primary live-session pipeline.
 *
 * The connector emits events from inside its own EventEmitter; if any handler
 * throws, the exception escapes into the emitter and can tear down the
 * connection (or the process). Every step here is therefore wrapped in one
 * try/catch so no single failure (a bad session write, webhook, overlay push,
 * etc.) can break the stream. Both the IPC connect handler and the auto-connect
 * path use this factory — it also removes the previous copy/paste duplication.
 */
function makeSessionCallbacks(username: string): {
  onStatus: (status: ConnectionStatus, error?: string) => void;
  onEvent: (evt: NormalizedEvent) => void;
  onHealth: (detail: ConnectionDetail) => void;
} {
  return {
    onStatus: (status, error) => broadcast('tt:status', { status, error }),
    // Rich connection-health detail → drives the ConnectionHealth pill. Kept on
    // a separate channel so the legacy tt:status path is untouched.
    onHealth: (detail) => broadcast('tt:health', detail),
    onEvent: (evt) => {
      try {
        if (evt.type === 'roomInfo') {
          currentSessionId = sessions.start(evt.info.hostUniqueId, evt.info.hostNickname, evt.info.title);
          startLog(evt.info.hostUniqueId);
          if (evt.info.hlsUrl) startRollingBuffer(evt.info.hlsUrl);
          // If the connected host IS the creator's own account, capture their
          // real nickname + avatar so the dashboard identity stays accurate even
          // when offline. Fail-safe — wrapped in the outer try/catch already.
          try {
            const my = settings.get('myAccount', DEFAULT_MY_ACCOUNT) as MyAccount;
            const hostHandle = normalizeUsername(evt.info.hostUniqueId);
            if (my.username && hostHandle === my.username) {
              setMyAccount({
                nickname: evt.info.hostNickname || my.nickname,
                avatarUrl: evt.info.hostAvatar || my.avatarUrl,
              });
            }
          } catch (e) {
            log.warn('[main] myAccount identity capture failed:', (e as any)?.message ?? e);
          }
        } else if (evt.type === 'streamMeta') {
          // Enriched live-session metadata (EulerStream/connector). This is NOT
          // a persisted live event — it carries short-lived signed pull URLs and
          // session header data for the renderer only. Don't write it to the
          // session ledger / chat log / fan CRM. If it yielded a fresh HLS URL,
          // (re)start the rolling clip buffer off it so highlight capture works
          // even when the connector lacked a stream_url.
          if (evt.meta.hlsUrl) startRollingBuffer(evt.meta.hlsUrl);
        } else {
          sessions.append(evt);
          appendLog(evt);
          fans.ingestLiveEvent(evt, currentSessionId);
        }
        broadcast('tt:event', evt);
        if (evt.type !== 'streamMeta') pushOverlayEvent(evt);
        dispatchWebhook(evt, username);
      } catch (err) {
        // Never let a handler error escape into the connector's emitter.
        // TODO: Sentry.captureException(err)
        log.error('[main] session event pipeline failed:', err);
      }
    },
  };
}

ipcMain.handle('tt:connect', async (_e, username: string) => {
  if (session) {
    await session.disconnect();
    session = null;
    sessions.end();
  }
  settings.set('lastUsername', username);
  watchlistPoller.notifyConnected(username);
  session = new TikTokSession(username, makeSessionCallbacks(username));
  try {
    await session.connect();
    return { ok: true };
  } catch (err: any) {
    return { ok: false, error: err?.message ?? String(err) };
  }
});

// Manual refresh of the EulerStream stream metadata (e.g. when the short-lived
// signed HLS URL has expired and the player needs a fresh one). Fail-safe.
ipcMain.handle('tt:refreshStreamMeta', async () => {
  if (!session) return { ok: false, error: 'Not connected' };
  try {
    await session.refreshStreamMeta();
    return { ok: true };
  } catch (err: any) {
    return { ok: false, error: err?.message ?? String(err) };
  }
});

ipcMain.handle('tt:disconnect', async () => {
  if (session) {
    await session.disconnect();
    session = null;
  }
  sessions.end();
  resetOverlayStats();
  stopLog();
  stopRollingBuffer();
  return { ok: true };
});

ipcMain.handle('highlights:available', () => isFfmpegAvailable());
ipcMain.handle('highlights:capture', async (_e, reason: string) => {
  const host = session ? settings.get('lastUsername', 'unknown') : 'unknown';
  return captureClip(reason || 'manual', host);
});
ipcMain.handle('highlights:list', () => listClips());
ipcMain.handle('highlights:reveal', (_e, p: string) => {
  shell.showItemInFolder(p);
  return { ok: true };
});
ipcMain.handle('highlights:dir', () => getClipsDir());

ipcMain.handle('multi:connect', async (_e, username: string) => {
  const handle = username.replace(/^@/, '').trim();
  if (!handle) return { ok: false, error: 'Empty username' };
  if (multiSessions.has(handle)) return { ok: true };
  const ms = new TikTokSession(handle, {
    onStatus: (status, error) => broadcast('multi:status', { username: handle, status, error }),
    onEvent: (evt) => {
      // Multi-room events also feed the fan ledger (tagged with the room handle).
      // ingestLiveEvent is internally fail-safe + write-batched, but stay defensive
      // so the multi-room pipeline can never break.
      try {
        // roomInfo + streamMeta are metadata, not ledger-worthy live events.
        if (evt.type !== 'roomInfo' && evt.type !== 'streamMeta') {
          fans.ingestLiveEvent(evt, `multi:${handle}`);
        }
      } catch (err) {
        // TODO: Sentry.captureException(err)
        log.error('[multi] fan ingest failed:', err);
      }
      broadcast('multi:event', { username: handle, evt });
    },
  });
  multiSessions.set(handle, ms);
  try {
    await ms.connect();
    return { ok: true };
  } catch (err: any) {
    multiSessions.delete(handle);
    return { ok: false, error: err?.message ?? String(err) };
  }
});

ipcMain.handle('multi:disconnect', async (_e, username: string) => {
  const handle = username.replace(/^@/, '').trim();
  const ms = multiSessions.get(handle);
  if (ms) {
    await ms.disconnect();
    multiSessions.delete(handle);
  }
  return { ok: true };
});

ipcMain.handle('multi:disconnectAll', async () => {
  for (const [k, ms] of multiSessions) {
    await ms.disconnect().catch(() => {});
    multiSessions.delete(k);
  }
  return { ok: true };
});

ipcMain.handle('sessions:list', () => sessions.list());
ipcMain.handle('sessions:get', (_e, id: string) => sessions.get(id));
ipcMain.handle('sessions:delete', (_e, id: string) => {
  sessions.remove(id);
  return { ok: true };
});
ipcMain.handle('sessions:search', (_e, q: string) => sessions.search(q));
ipcMain.handle('sessions:userTallies', (_e, uniqueId: string) => sessions.userTallies(uniqueId));
ipcMain.handle('sessions:leaderboard', (_e, limit?: number) => sessions.allTimeLeaderboard(limit));

ipcMain.handle('sessions:export', async (_e, sessionId: string, type: string) => {
  const rec = sessions.get(sessionId);
  if (!rec) return { ok: false, error: 'Session not found' };
  return exportSession(rec, type as ExportType, mainWindow);
});

ipcMain.handle('overlay:url', () => {
  const port = getOverlayPort();
  return port ? `http://127.0.0.1:${port}` : null;
});

ipcMain.handle('settings:get', () => {
  return {
    lastUsername: settings.get('lastUsername', ''),
    signApiKey: settings.get('signApiKey', ''),
    anthropicApiKey: settings.get('anthropicApiKey', ''),
    autoConnect: settings.get('autoConnect', false),
    chatLogEnabled: settings.get('chatLogEnabled', false),
    aiSummaryConsented: settings.get('aiSummaryConsented', false),
    likerRiskAck: settings.get('likerRiskAck', false),
    webhooks: settings.get('webhooks', { discordUrl: '', slackUrl: '', customUrl: '', events: { gifts: true, follows: true, keywords: false, milestones: true } }),
    watchlist: settings.get('watchlist', []),
    thankTemplate: settings.get('thankTemplate', DEFAULT_THANK_TEMPLATE),
    earnings: settings.get('earnings', DEFAULT_EARNINGS),
    community: settings.get('community', DEFAULT_COMMUNITY),
    moderation: settings.get('moderation', DEFAULT_MODERATION),
    myAccount: settings.get('myAccount', DEFAULT_MY_ACCOUNT),
    notifyOnGoLive: settings.get('notifyOnGoLive', true),
    customFieldDefs: customFieldsStore.list(),
  };
});

ipcMain.handle('settings:setMyAccount', (_e, account: Partial<MyAccount>) => {
  // Persist via the store helper, which normalizes the username and only
  // overwrites optional fields when supplied.
  const next = setMyAccount({
    username: account?.username ?? '',
    nickname: account?.nickname,
    avatarUrl: account?.avatarUrl,
  });
  return { ok: true, myAccount: next };
});

ipcMain.handle('settings:setNotifyOnGoLive', (_e, val: boolean) => {
  settings.set('notifyOnGoLive', !!val);
  return { ok: true };
});

ipcMain.handle('settings:setModeration', (_e, cfg: ModerationSettings) => {
  const validTags: ReadonlySet<string> = new Set(['vip', 'regular', 'troll', 'blocked']);
  const userTags: ModerationSettings['userTags'] = {};
  for (const [uid, tag] of Object.entries(cfg?.userTags ?? {})) {
    if (typeof uid === 'string' && uid && validTags.has(tag as string)) {
      userTags[uid] = tag as ModerationSettings['userTags'][string];
    }
  }
  const threshold = Math.floor(Number(cfg?.spamThreshold));
  settings.set('moderation', {
    blockedUsers: Array.isArray(cfg?.blockedUsers) ? cfg.blockedUsers.filter((u) => typeof u === 'string') : [],
    blockedKeywords: Array.isArray(cfg?.blockedKeywords) ? cfg.blockedKeywords.filter((k) => typeof k === 'string') : [],
    userTags,
    spamFilterEnabled: !!cfg?.spamFilterEnabled,
    spamThreshold: Number.isFinite(threshold) && threshold > 0 ? threshold : DEFAULT_MODERATION.spamThreshold,
  });
  return { ok: true };
});

ipcMain.handle('settings:setThankTemplate', (_e, tpl: string) => {
  settings.set('thankTemplate', String(tpl ?? '').slice(0, 2000) || DEFAULT_THANK_TEMPLATE);
  return { ok: true };
});

ipcMain.handle('settings:setEarnings', (_e, cfg: EarningsSettings) => {
  const cur = cfg?.currency;
  settings.set('earnings', {
    enabled: !!cfg?.enabled,
    ratePer1000: Math.max(0, Number(cfg?.ratePer1000) || 0),
    currency: cur === '$' || cur === '€' ? cur : '£',
  });
  return { ok: true };
});

ipcMain.handle('settings:setCommunity', (_e, cfg: CommunitySettings) => {
  const num = (v: unknown, fb: number, min = 1) => {
    const n = Math.floor(Number(v));
    return Number.isFinite(n) && n >= min ? n : fb;
  };
  const regular = num(cfg?.tiers?.regular, DEFAULT_COMMUNITY.tiers.regular);
  const vip = num(cfg?.tiers?.vip, DEFAULT_COMMUNITY.tiers.vip);
  const whale = num(cfg?.tiers?.whale, DEFAULT_COMMUNITY.tiers.whale);
  if (!(regular < vip && vip < whale)) return { ok: false, error: 'Tier thresholds must be ascending (Regular < VIP < Whale)' };
  settings.set('community', {
    quietDays: Math.min(365, num(cfg?.quietDays, DEFAULT_COMMUNITY.quietDays)),
    birthdayWindowDays: Math.min(365, num(cfg?.birthdayWindowDays, DEFAULT_COMMUNITY.birthdayWindowDays)),
    tiers: { regular, vip, whale },
  });
  return { ok: true };
});

ipcMain.handle('shell:openExternal', (_e, url: string) => {
  try {
    const u = new URL(String(url));
    const host = u.hostname.toLowerCase();
    const allowed = u.protocol === 'https:' && (host === 'tiktok.com' || host.endsWith('.tiktok.com'));
    if (!allowed) return { ok: false, error: 'Only tiktok.com links can be opened' };
    shell.openExternal(u.toString());
    return { ok: true };
  } catch {
    return { ok: false, error: 'Invalid URL' };
  }
});

ipcMain.handle('settings:setSignApiKey', (_e, key: string) => {
  settings.set('signApiKey', key);
  return { ok: true };
});

ipcMain.handle('settings:setAnthropicKey', (_e, key: string) => {
  settings.set('anthropicApiKey', key);
  return { ok: true };
});

ipcMain.handle('settings:setAutoConnect', (_e, val: boolean) => {
  settings.set('autoConnect', val);
  return { ok: true };
});

ipcMain.handle('settings:setChatLog', (_e, val: boolean) => {
  settings.set('chatLogEnabled', val);
  return { ok: true };
});

ipcMain.handle('settings:setAiSummaryConsent', (_e, val: boolean) => {
  settings.set('aiSummaryConsented', !!val);
  return { ok: true };
});

ipcMain.handle('settings:setLikerRiskAck', (_e, val: boolean) => {
  settings.set('likerRiskAck', !!val);
  return { ok: true };
});

ipcMain.handle('settings:setWebhooks', (_e, cfg: any) => {
  settings.set('webhooks', cfg);
  return { ok: true };
});

ipcMain.handle('settings:setWatchlist', (_e, list: WatchEntry[]) => {
  // Normalize defensively: accept legacy string[] from older renderers too.
  const normalized: WatchEntry[] = (Array.isArray(list) ? list : [])
    .map((item: any) =>
      typeof item === 'string'
        ? { username: item.trim(), notify: true, lastSeen: null }
        : {
            username: String(item?.username ?? '').trim(),
            notify: item?.notify !== false,
            lastSeen: typeof item?.lastSeen === 'number' ? item.lastSeen : null,
          },
    )
    .filter((e: WatchEntry) => e.username);
  settings.set('watchlist', normalized);
  watchlistPoller.pokeNow();
  return { ok: true };
});

ipcMain.handle('watchlist:poke', () => {
  watchlistPoller.pokeNow();
  return { ok: true };
});

ipcMain.handle('chatlog:dir', () => getLogDir());

// Manual "Check for updates" from Settings → Diagnostics. Safe + inert until a
// real GitHub feed is configured (see electron/updater.ts).
ipcMain.handle('updates:check', () => checkForUpdatesManual());

// Structured-logging access: lets a creator open the logs folder to attach
// files to a support ticket when a stream broke.
ipcMain.handle('logs:reveal', () => revealLogs());
ipcMain.handle('logs:path', () => logsDir());

ipcMain.handle('backup:export', async () => {
  if (!mainWindow || mainWindow.isDestroyed()) return { ok: false };
  const { dialog } = await import('electron');
  const result = await dialog.showSaveDialog(mainWindow, {
    defaultPath: `liketapper-backup-${new Date().toISOString().slice(0, 10)}.json`,
    filters: [{ name: 'JSON', extensions: ['json'] }],
  });
  if (result.canceled || !result.filePath) return { ok: false };
  const fs = await import('node:fs');
  const data = {
    settings: {
      lastUsername: settings.get('lastUsername', ''),
      signApiKey: settings.get('signApiKey', ''),
      anthropicApiKey: settings.get('anthropicApiKey', ''),
      autoConnect: settings.get('autoConnect', false),
      chatLogEnabled: settings.get('chatLogEnabled', false),
      webhooks: settings.get('webhooks', {} as any),
      watchlist: settings.get('watchlist', []),
    },
    notes: notesStore.all(),
    sessions: sessions.list(),
  };
  fs.writeFileSync(result.filePath, JSON.stringify(data, null, 2));
  return { ok: true, path: result.filePath };
});

ipcMain.handle('backup:import', async () => {
  if (!mainWindow || mainWindow.isDestroyed()) return { ok: false };
  const { dialog } = await import('electron');
  const result = await dialog.showOpenDialog(mainWindow, {
    filters: [{ name: 'JSON', extensions: ['json'] }],
    properties: ['openFile'],
  });
  if (result.canceled || !result.filePaths[0]) return { ok: false };
  try {
    const fs = await import('node:fs');
    const raw = fs.readFileSync(result.filePaths[0], 'utf8');
    const data = JSON.parse(raw);
    if (data.settings) {
      for (const [k, v] of Object.entries(data.settings)) {
        settings.set(k as any, v as any);
      }
    }
    if (data.notes) {
      for (const [uid, note] of Object.entries(data.notes)) {
        const n = note as any;
        notesStore.set(uid, n.nickname ?? uid, n.notes ?? '');
      }
    }
    return { ok: true };
  } catch (err: any) {
    return { ok: false, error: err?.message ?? String(err) };
  }
});

ipcMain.handle('summarize:session', async (_e, sessionId: string) => {
  // Compliance gate: AI summaries POST chat text + gifter usernames + questions
  // to Anthropic's API. Require a one-time, in-product consent before the first
  // summary ever runs. The user grants it in Settings (near the Anthropic key).
  if (!settings.get('aiSummaryConsented', false)) {
    return {
      ok: false,
      needsConsent: true,
      error: 'Enable AI summaries in Settings first. Generating a summary sends this session\'s chat text and usernames to Anthropic\'s API.',
    };
  }
  const rec = sessions.get(sessionId);
  if (!rec) return { ok: false, error: 'Session not found' };
  const durationMs = (rec.endedAt ?? Date.now()) - rec.startedAt;
  const input: SummaryInput = {
    hostNickname: rec.hostNickname,
    hostUniqueId: rec.hostUniqueId,
    roomTitle: rec.roomTitle,
    durationMin: Math.max(1, Math.round(durationMs / 60000)),
    totals: rec.totals,
    comments: rec.events
      .filter((e) => e.type === 'chat' && e.comment)
      .slice(0, 600)
      .map((e) => ({ user: e.user?.nickname ?? '', text: e.comment! })),
    gifts: rec.events
      .filter((e) => e.type === 'gift')
      .slice(0, 100)
      .map((e) => ({
        user: e.user?.nickname ?? '',
        gift: e.giftName ?? '',
        count: e.repeatCount ?? 1,
        diamonds: (e.diamondCount ?? 0) * (e.repeatCount ?? 1),
      })),
    questions: rec.events
      .filter((e) => e.type === 'questionNew' && e.question)
      .map((e) => ({ user: e.user?.nickname ?? '', text: e.question! })),
  };
  try {
    const summary = await summarize(input);
    return { ok: true, summary };
  } catch (err: any) {
    return { ok: false, error: err?.message ?? String(err) };
  }
});

ipcMain.handle('shell:openProfile', (_e, uniqueId: string) => {
  const handle = String(uniqueId).replace(/^@/, '').trim();
  if (!handle) return { ok: false };
  shell.openExternal(`https://www.tiktok.com/@${encodeURIComponent(handle)}`);
  return { ok: true };
});

const profileWindows = new Map<string, BrowserWindow>();

ipcMain.handle('profile:openInternal', (_e, uniqueId: string) => {
  const handle = String(uniqueId).replace(/^@/, '').trim();
  if (!handle) return { ok: false };
  const existing = profileWindows.get(handle);
  if (existing && !existing.isDestroyed()) {
    existing.focus();
    return { ok: true };
  }
  const win = new BrowserWindow({
    width: 390,
    height: 844,
    title: `@${handle}`,
    backgroundColor: '#000000',
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      partition: 'persist:tiktok',
    },
  });
  win.webContents.setUserAgent(MOBILE_UA);
  win.loadURL(`https://www.tiktok.com/@${encodeURIComponent(handle)}`);
  profileWindows.set(handle, win);
  win.on('closed', () => {
    profileWindows.delete(handle);
  });
  return { ok: true };
});

const liveWindows = new Map<string, BrowserWindow>();

const MOBILE_UA = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_4 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Mobile/15E148 Safari/604.1';

ipcMain.handle('live:openInternal', (_e, uniqueId: string) => {
  const handle = String(uniqueId).replace(/^@/, '').trim();
  if (!handle) return { ok: false };
  const existing = liveWindows.get(handle);
  if (existing && !existing.isDestroyed()) {
    existing.focus();
    return { ok: true };
  }
  const win = new BrowserWindow({
    width: 390,
    height: 844,
    title: `Live: @${handle}`,
    backgroundColor: '#000000',
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      partition: 'persist:tiktok',
    },
  });
  win.webContents.setUserAgent(MOBILE_UA);
  win.loadURL(`https://www.tiktok.com/@${encodeURIComponent(handle)}/live`);
  liveWindows.set(handle, win);
  win.on('closed', () => {
    liveWindows.delete(handle);
  });
  return { ok: true };
});

ipcMain.handle('tracked:list', () => {
  return settings.get('trackedUsers', []) as Array<{ uniqueId: string; nickname: string; addedAt: number }>;
});

ipcMain.handle('tracked:add', (_e, payload: { uniqueId: string; nickname: string }) => {
  const list = settings.get('trackedUsers', []) as Array<{ uniqueId: string; nickname: string; addedAt: number }>;
  const handle = payload.uniqueId.replace(/^@/, '').trim();
  if (!handle) return { ok: false };
  if (list.some((u) => u.uniqueId === handle)) return { ok: true, alreadyTracked: true };
  const next = [...list, { uniqueId: handle, nickname: payload.nickname || handle, addedAt: Date.now() }];
  settings.set('trackedUsers', next);
  return { ok: true };
});

ipcMain.handle('tracked:remove', (_e, uniqueId: string) => {
  const list = settings.get('trackedUsers', []) as Array<{ uniqueId: string; nickname: string; addedAt: number }>;
  const next = list.filter((u) => u.uniqueId !== uniqueId);
  settings.set('trackedUsers', next);
  return { ok: true };
});

ipcMain.handle('tracked:isTracked', (_e, uniqueId: string) => {
  const list = settings.get('trackedUsers', []) as Array<{ uniqueId: string; nickname: string; addedAt: number }>;
  return list.some((u) => u.uniqueId === uniqueId);
});

ipcMain.handle('notes:get', (_e, uniqueId: string) => {
  return notesStore.get(uniqueId);
});

ipcMain.handle('notes:all', () => {
  return notesStore.all();
});

ipcMain.handle('notes:set', (_e, payload: { uniqueId: string; nickname: string; notes: string }) => {
  return notesStore.set(payload.uniqueId, payload.nickname, payload.notes);
});

ipcMain.handle('notes:delete', (_e, uniqueId: string) => {
  notesStore.delete(uniqueId);
  return { ok: true };
});

// ---------------------------------------------------------------------------
// Fan CRM IPC

ipcMain.handle('fans:list', (_e, q: fans.ListFansQuery) => {
  const res = fans.listFans(q ?? {});
  // ADDITIVE enrichment: attach strength + temperature to each row so the list
  // can render strength bars + temperature dots. Existing callers that ignore
  // these fields are unaffected. Fail-safe per-row — a bad signal never drops a
  // fan from the list.
  try {
    // BATCHED: one gift/session/interaction pass for the whole page instead of a
    // full ledger re-read + session re-scan PER ROW (the old O(N×ledger) blowup).
    const bundles = crm.strengthForAll(res.data.map((f) => ({ uniqueId: f.uniqueId, tier: f.tier })));
    res.data = res.data.map((f) => {
      const b = bundles.get(f.uniqueId);
      return b ? { ...f, strength: b.result.strength, temperature: b.result.temperature } : f;
    });
  } catch (err) {
    log.warn('[main] fans:list strength enrichment failed:', (err as any)?.message ?? err);
  }
  return res;
});
ipcMain.handle('fans:get', (_e, uniqueId: string) => fans.getFan(uniqueId));
ipcMain.handle('fans:profile', (_e, uniqueId: string) => crm.fanProfile(String(uniqueId ?? '')));
ipcMain.handle('fans:timeline', (_e, uniqueId: string, opts?: { filter?: crm.TimelineFilter; limit?: number }) =>
  crm.fanTimeline(String(uniqueId ?? ''), opts ?? {}),
);
ipcMain.handle('fans:addNote', (_e, uniqueId: string, body: string) => {
  const uid = String(uniqueId ?? '').replace(/^@/, '').trim();
  return addInteraction({ fanId: uid, type: 'note', body: String(body ?? ''), summary: 'Note added' });
});
ipcMain.handle('fans:setField', (_e, uniqueId: string, key: string, value: unknown) =>
  fans.setFanField(String(uniqueId ?? ''), String(key ?? ''), value),
);
ipcMain.handle('fields:listDefs', () => customFieldsStore.list());
ipcMain.handle('fields:addDef', (_e, input: { label: string; type: CustomFieldType; key?: string; options?: string[] }) =>
  customFieldsStore.add(input ?? ({} as any)),
);
ipcMain.handle('fields:removeDef', (_e, id: string) => customFieldsStore.remove(String(id ?? '')));
ipcMain.handle('fans:add', (_e, payload: fans.UpsertFanPayload) => fans.upsertFan(payload));
ipcMain.handle('fans:update', (_e, uniqueId: string, patch: any) => fans.updateFan(uniqueId, patch ?? {}));
ipcMain.handle('fans:bulkTag', (_e, payload: { ids: string[]; add: string[]; remove: string[] }) =>
  fans.bulkTag(payload?.ids ?? [], payload?.add ?? [], payload?.remove ?? []),
);
ipcMain.handle('fans:logGift', (_e, payload: { uniqueId: string; nickname?: string; giftName: string; diamonds: number; at?: number }) => {
  const res = fans.logGift(payload);
  // Mirror a manual_gift_log milestone into the interaction timeline so the 360
  // profile shows a human "logged X" row. Fail-safe — never block the gift.
  if (res.ok) {
    try {
      addInteraction({
        fanId: String(payload?.uniqueId ?? '').replace(/^@/, '').trim(),
        type: 'manual_gift_log',
        summary: `Logged ${payload.giftName} (${Math.floor(payload.diamonds)} 💎)`,
        occurredAt: payload.at,
        payload: { diamonds: Math.floor(payload.diamonds), giftName: payload.giftName },
      });
    } catch (err) { log.warn('[main] manual_gift_log interaction failed:', (err as any)?.message ?? err); }
  }
  return res;
});
ipcMain.handle('gifts:list', (_e, q: fans.ListGiftsQuery) => fans.listGifts(q ?? {}));
ipcMain.handle('reminders:list', (_e, withinDays?: number) => fans.listReminders(withinDays));
ipcMain.handle('reminders:action', (_e, payload: { id: string; action: 'done' | 'snooze'; days?: number }) =>
  fans.reminderAction(payload?.id, payload?.action, payload?.days),
);
ipcMain.handle('reminders:addThank', (_e, uniqueId: string) => fans.addThankReminder(String(uniqueId ?? '')));
ipcMain.handle('fans:markThanked', (_e, uniqueId: string) => {
  const res = fans.markThanked(String(uniqueId ?? ''));
  if (res.ok) {
    try {
      addInteraction({
        fanId: String(uniqueId ?? '').replace(/^@/, '').trim(),
        type: 'thank_you',
        summary: 'Thank-you sent',
      });
    } catch (err) { log.warn('[main] thank_you interaction failed:', (err as any)?.message ?? err); }
  }
  return res;
});
ipcMain.handle('fans:importCsv', (_e, csvText: string) => fans.importCsv(String(csvText ?? '')));
ipcMain.handle('fans:importCsvFile', async () => {
  if (!mainWindow || mainWindow.isDestroyed()) return { ok: false, created: 0, updated: 0, skipped: 0, errors: [], canceled: true };
  const { dialog } = await import('electron');
  const result = await dialog.showOpenDialog(mainWindow, {
    filters: [{ name: 'CSV Files', extensions: ['csv', 'txt'] }],
    properties: ['openFile'],
  });
  if (result.canceled || !result.filePaths[0]) return { ok: false, created: 0, updated: 0, skipped: 0, errors: [], canceled: true };
  try {
    const fsNode = await import('node:fs');
    const text = fsNode.readFileSync(result.filePaths[0], 'utf8');
    return fans.importCsv(text);
  } catch (err: any) {
    return { ok: false, created: 0, updated: 0, skipped: 0, errors: [err?.message ?? String(err)] };
  }
});
ipcMain.handle('fans:exportCsv', async () => {
  if (!mainWindow || mainWindow.isDestroyed()) return { ok: false };
  const { dialog } = await import('electron');
  const result = await dialog.showSaveDialog(mainWindow, {
    defaultPath: `fans-${new Date().toISOString().slice(0, 10)}.csv`,
    filters: [{ name: 'CSV Files', extensions: ['csv'] }],
  });
  if (result.canceled || !result.filePath) return { ok: false };
  try {
    const fsNode = await import('node:fs');
    fsNode.writeFileSync(result.filePath, fans.exportCsvText(), 'utf8');
    return { ok: true, path: result.filePath };
  } catch (err: any) {
    return { ok: false, error: err?.message ?? String(err) };
  }
});
ipcMain.handle('gifts:exportCsv', async (_e, q: fans.ListGiftsQuery) => {
  if (!mainWindow || mainWindow.isDestroyed()) return { ok: false };
  const { dialog } = await import('electron');
  const result = await dialog.showSaveDialog(mainWindow, {
    defaultPath: `gifts-${new Date().toISOString().slice(0, 10)}.csv`,
    filters: [{ name: 'CSV Files', extensions: ['csv'] }],
  });
  if (result.canceled || !result.filePath) return { ok: false, canceled: true };
  try {
    const fsNode = await import('node:fs');
    fsNode.writeFileSync(result.filePath, fans.exportGiftsCsvText(q ?? {}), 'utf8');
    return { ok: true, path: result.filePath };
  } catch (err: any) {
    return { ok: false, error: err?.message ?? String(err) };
  }
});
ipcMain.handle('fans:clear', () => fans.clearAll());
ipcMain.handle('fans:dataDir', () => fans.fansDir());

app.whenReady().then(async () => {
  createWindow();
  await startOverlayServer();
  setupLikerIpc(broadcast);
  watchlistPoller.start();
  // Background auto-update check (production builds only; fails safe — see
  // electron/updater.ts). Fire-and-forget so it never blocks startup.
  void checkForUpdatesOnStartup();
  if (settings.get('autoConnect', false)) {
    const lastUser = settings.get('lastUsername', '');
    if (lastUser) {
      setTimeout(() => {
        log.info(`[main] auto-connecting to last user @${lastUser}`);
        // connect() emits its own connecting/connected/error phases via the
        // session callbacks (onStatus + onHealth), so no manual broadcast here.
        session = new TikTokSession(lastUser, makeSessionCallbacks(lastUser));
        session.connect().catch((err) => {
          log.warn('[main] auto-connect failed:', err?.message ?? err);
        });
      }, 1500);
    }
  }
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) createWindow();
});

app.on('before-quit', async () => {
  watchlistPoller.stop();
  stopRollingBuffer();
  closeLikerWindow();
  if (session) {
    await session.disconnect().catch(() => {});
    session = null;
  }
  for (const [, ms] of multiSessions) {
    await ms.disconnect().catch(() => {});
  }
  multiSessions.clear();
  sessions.end();
  fans.flush();
});
