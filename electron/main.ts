import { app, BrowserWindow, ipcMain, shell } from 'electron';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { TikTokSession } from './tiktok';
import { settings, notesStore, DEFAULT_COMMUNITY, DEFAULT_EARNINGS, DEFAULT_THANK_TEMPLATE, DEFAULT_MODERATION, type CommunitySettings, type EarningsSettings, type ModerationSettings } from './store';
import * as sessions from './sessions';
import { summarize, type SummaryInput } from './summarize';
import { exportSession, type ExportType } from './export';
import { startOverlayServer, pushEvent as pushOverlayEvent, resetStats as resetOverlayStats, getOverlayPort } from './overlay';
import { dispatchWebhook } from './webhooks';
import { startLog, appendLog, stopLog, getLogDir } from './chatlog';
import { WatchlistPoller } from './watchlist-poller';
import { startRollingBuffer, stopRollingBuffer, captureClip, isFfmpegAvailable, getClipsDir, listClips } from './highlights';
import { setupLikerIpc, closeLikerWindow } from './liker';
import * as fans from './fans';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Tier/quiet/birthday thresholds come from the settings store (Settings → Community rules).
fans.setRulesGetter(() => settings.get('community', DEFAULT_COMMUNITY));

const VITE_DEV_SERVER_URL = process.env.VITE_DEV_SERVER_URL;

let mainWindow: BrowserWindow | null = null;
let session: TikTokSession | null = null;
let currentSessionId: string | null = null;
const multiSessions = new Map<string, TikTokSession>();
const watchlistPoller = new WatchlistPoller({
  onLiveDetected: (evt) => broadcast('watchlist:live', evt),
});

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1240,
    height: 820,
    minWidth: 900,
    minHeight: 600,
    titleBarStyle: 'hiddenInset',
    // Native macOS vibrancy — translucent app surfaces will show desktop blur through
    vibrancy: 'under-window',
    visualEffectState: 'active',
    backgroundColor: '#00000000',
    transparent: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.mjs'),
      contextIsolation: true,
      nodeIntegration: false,
      webviewTag: true,
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

ipcMain.handle('tt:connect', async (_e, username: string) => {
  if (session) {
    await session.disconnect();
    session = null;
    sessions.end();
  }
  settings.set('lastUsername', username);
  watchlistPoller.notifyConnected(username);
  session = new TikTokSession(username, {
    onStatus: (status, error) => broadcast('tt:status', { status, error }),
    onEvent: (evt) => {
      if (evt.type === 'roomInfo') {
        currentSessionId = sessions.start(evt.info.hostUniqueId, evt.info.hostNickname, evt.info.title);
        startLog(evt.info.hostUniqueId);
        if (evt.info.hlsUrl) startRollingBuffer(evt.info.hlsUrl);
      } else {
        sessions.append(evt);
        appendLog(evt);
        fans.ingestLiveEvent(evt, currentSessionId);
      }
      broadcast('tt:event', evt);
      pushOverlayEvent(evt);
      dispatchWebhook(evt, username);
    },
  });
  try {
    await session.connect();
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
        if (evt.type !== 'roomInfo') fans.ingestLiveEvent(evt, `multi:${handle}`);
      } catch (err) {
        console.error('[multi] fan ingest failed:', err);
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
    webhooks: settings.get('webhooks', { discordUrl: '', slackUrl: '', customUrl: '', events: { gifts: true, follows: true, keywords: false, milestones: true } }),
    watchlist: settings.get('watchlist', []),
    thankTemplate: settings.get('thankTemplate', DEFAULT_THANK_TEMPLATE),
    earnings: settings.get('earnings', DEFAULT_EARNINGS),
    community: settings.get('community', DEFAULT_COMMUNITY),
    moderation: settings.get('moderation', DEFAULT_MODERATION),
  };
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

ipcMain.handle('settings:setWebhooks', (_e, cfg: any) => {
  settings.set('webhooks', cfg);
  return { ok: true };
});

ipcMain.handle('settings:setWatchlist', (_e, list: string[]) => {
  settings.set('watchlist', list);
  watchlistPoller.pokeNow();
  return { ok: true };
});

ipcMain.handle('watchlist:poke', () => {
  watchlistPoller.pokeNow();
  return { ok: true };
});

ipcMain.handle('chatlog:dir', () => getLogDir());

ipcMain.handle('backup:export', async () => {
  const { dialog } = await import('electron');
  const result = await dialog.showSaveDialog(mainWindow!, {
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
  const { dialog } = await import('electron');
  const result = await dialog.showOpenDialog(mainWindow!, {
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

ipcMain.handle('fans:list', (_e, q: fans.ListFansQuery) => fans.listFans(q ?? {}));
ipcMain.handle('fans:get', (_e, uniqueId: string) => fans.getFan(uniqueId));
ipcMain.handle('fans:add', (_e, payload: fans.UpsertFanPayload) => fans.upsertFan(payload));
ipcMain.handle('fans:update', (_e, uniqueId: string, patch: any) => fans.updateFan(uniqueId, patch ?? {}));
ipcMain.handle('fans:bulkTag', (_e, payload: { ids: string[]; add: string[]; remove: string[] }) =>
  fans.bulkTag(payload?.ids ?? [], payload?.add ?? [], payload?.remove ?? []),
);
ipcMain.handle('fans:logGift', (_e, payload: { uniqueId: string; nickname?: string; giftName: string; diamonds: number; at?: number }) =>
  fans.logGift(payload),
);
ipcMain.handle('gifts:list', (_e, q: fans.ListGiftsQuery) => fans.listGifts(q ?? {}));
ipcMain.handle('reminders:list', (_e, withinDays?: number) => fans.listReminders(withinDays));
ipcMain.handle('reminders:action', (_e, payload: { id: string; action: 'done' | 'snooze'; days?: number }) =>
  fans.reminderAction(payload?.id, payload?.action, payload?.days),
);
ipcMain.handle('reminders:addThank', (_e, uniqueId: string) => fans.addThankReminder(String(uniqueId ?? '')));
ipcMain.handle('fans:markThanked', (_e, uniqueId: string) => fans.markThanked(String(uniqueId ?? '')));
ipcMain.handle('fans:importCsv', (_e, csvText: string) => fans.importCsv(String(csvText ?? '')));
ipcMain.handle('fans:importCsvFile', async () => {
  const { dialog } = await import('electron');
  const result = await dialog.showOpenDialog(mainWindow!, {
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
  const { dialog } = await import('electron');
  const result = await dialog.showSaveDialog(mainWindow!, {
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
ipcMain.handle('fans:clear', () => fans.clearAll());
ipcMain.handle('fans:dataDir', () => fans.fansDir());

app.whenReady().then(async () => {
  createWindow();
  await startOverlayServer();
  setupLikerIpc(broadcast);
  watchlistPoller.start();
  if (settings.get('autoConnect', false)) {
    const lastUser = settings.get('lastUsername', '');
    if (lastUser) {
      setTimeout(() => {
        broadcast('tt:status', { status: 'connecting' });
        session = new TikTokSession(lastUser, {
          onStatus: (status, error) => broadcast('tt:status', { status, error }),
          onEvent: (evt) => {
            if (evt.type === 'roomInfo') {
              currentSessionId = sessions.start(evt.info.hostUniqueId, evt.info.hostNickname, evt.info.title);
              startLog(evt.info.hostUniqueId);
              if (evt.info.hlsUrl) startRollingBuffer(evt.info.hlsUrl);
            } else {
              sessions.append(evt);
              appendLog(evt);
              fans.ingestLiveEvent(evt, currentSessionId);
            }
            broadcast('tt:event', evt);
            pushOverlayEvent(evt);
            dispatchWebhook(evt, lastUser);
          },
        });
        session.connect().catch((err) => {
          broadcast('tt:status', { status: 'error', error: err?.message });
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
