import { contextBridge, ipcRenderer } from 'electron';

const api = {
  connect: (username: string) =>
    ipcRenderer.invoke('tt:connect', username) as Promise<{ ok: boolean; error?: string }>,
  disconnect: () => ipcRenderer.invoke('tt:disconnect') as Promise<{ ok: boolean }>,
  refreshStreamMeta: () =>
    ipcRenderer.invoke('tt:refreshStreamMeta') as Promise<{ ok: boolean; error?: string }>,
  getSettings: () =>
    ipcRenderer.invoke('settings:get') as Promise<{
      lastUsername: string;
      signApiKey: string;
      anthropicApiKey: string;
    }>,
  setSignApiKey: (key: string) =>
    ipcRenderer.invoke('settings:setSignApiKey', key) as Promise<{ ok: boolean }>,
  setAnthropicKey: (key: string) =>
    ipcRenderer.invoke('settings:setAnthropicKey', key) as Promise<{ ok: boolean }>,
  setAutoConnect: (val: boolean) =>
    ipcRenderer.invoke('settings:setAutoConnect', val) as Promise<{ ok: boolean }>,
  setChatLog: (val: boolean) =>
    ipcRenderer.invoke('settings:setChatLog', val) as Promise<{ ok: boolean }>,
  setAiSummaryConsent: (val: boolean) =>
    ipcRenderer.invoke('settings:setAiSummaryConsent', val) as Promise<{ ok: boolean }>,
  setLikerRiskAck: (val: boolean) =>
    ipcRenderer.invoke('settings:setLikerRiskAck', val) as Promise<{ ok: boolean }>,
  setWebhooks: (cfg: any) =>
    ipcRenderer.invoke('settings:setWebhooks', cfg) as Promise<{ ok: boolean }>,
  setWatchlist: (list: Array<{ username: string; notify: boolean; lastSeen: number | null }>) =>
    ipcRenderer.invoke('settings:setWatchlist', list) as Promise<{ ok: boolean }>,
  setThankTemplate: (tpl: string) =>
    ipcRenderer.invoke('settings:setThankTemplate', tpl) as Promise<{ ok: boolean }>,
  setEarnings: (cfg: any) =>
    ipcRenderer.invoke('settings:setEarnings', cfg) as Promise<{ ok: boolean }>,
  setCommunity: (cfg: any) =>
    ipcRenderer.invoke('settings:setCommunity', cfg) as Promise<{ ok: boolean; error?: string }>,
  setModeration: (cfg: any) =>
    ipcRenderer.invoke('settings:setModeration', cfg) as Promise<{ ok: boolean }>,
  setMyAccount: (account: { username: string; nickname?: string; avatarUrl?: string }) =>
    ipcRenderer.invoke('settings:setMyAccount', account) as Promise<{
      ok: boolean;
      myAccount: { username: string; nickname?: string; avatarUrl?: string };
    }>,
  setNotifyOnGoLive: (val: boolean) =>
    ipcRenderer.invoke('settings:setNotifyOnGoLive', val) as Promise<{ ok: boolean }>,
  openExternal: (url: string) =>
    ipcRenderer.invoke('shell:openExternal', url) as Promise<{ ok: boolean; error?: string }>,
  chatLogDir: () => ipcRenderer.invoke('chatlog:dir') as Promise<string>,
  revealLogs: () =>
    ipcRenderer.invoke('logs:reveal') as Promise<{ ok: boolean; path: string; error?: string }>,
  logsPath: () => ipcRenderer.invoke('logs:path') as Promise<string>,
  checkForUpdates: () =>
    ipcRenderer.invoke('updates:check') as Promise<{
      ok: boolean;
      status: 'checking' | 'available' | 'not-available' | 'downloading' | 'skipped' | 'error';
      message: string;
      version?: string;
    }>,
  backupExport: () =>
    ipcRenderer.invoke('backup:export') as Promise<{ ok: boolean; path?: string }>,
  backupImport: () =>
    ipcRenderer.invoke('backup:import') as Promise<{ ok: boolean; error?: string }>,
  summarizeSession: (id: string) =>
    ipcRenderer.invoke('summarize:session', id) as Promise<{
      ok: boolean;
      summary?: string;
      error?: string;
    }>,
  openProfile: (uniqueId: string) =>
    ipcRenderer.invoke('shell:openProfile', uniqueId) as Promise<{ ok: boolean }>,
  openProfileInternal: (uniqueId: string) =>
    ipcRenderer.invoke('profile:openInternal', uniqueId) as Promise<{ ok: boolean }>,

  notesGet: (uniqueId: string) =>
    ipcRenderer.invoke('notes:get', uniqueId) as Promise<{
      uniqueId: string;
      nickname: string;
      notes: string;
      updatedAt: number;
    } | null>,
  notesAll: () =>
    ipcRenderer.invoke('notes:all') as Promise<
      Record<string, { uniqueId: string; nickname: string; notes: string; updatedAt: number }>
    >,
  notesSet: (payload: { uniqueId: string; nickname: string; notes: string }) =>
    ipcRenderer.invoke('notes:set', payload) as Promise<{
      uniqueId: string;
      nickname: string;
      notes: string;
      updatedAt: number;
    }>,
  notesDelete: (uniqueId: string) =>
    ipcRenderer.invoke('notes:delete', uniqueId) as Promise<{ ok: boolean }>,

  sessionsList: () => ipcRenderer.invoke('sessions:list') as Promise<any[]>,
  sessionsGet: (id: string) => ipcRenderer.invoke('sessions:get', id) as Promise<any>,
  sessionsDelete: (id: string) =>
    ipcRenderer.invoke('sessions:delete', id) as Promise<{ ok: boolean }>,
  sessionsSearch: (q: string) => ipcRenderer.invoke('sessions:search', q) as Promise<any[]>,
  sessionsExport: (id: string, type: string) =>
    ipcRenderer.invoke('sessions:export', id, type) as Promise<{ ok: boolean; path?: string; error?: string }>,
  sessionsLeaderboard: (limit?: number) =>
    ipcRenderer.invoke('sessions:leaderboard', limit) as Promise<any[]>,
  sessionsUserTallies: (uniqueId: string) =>
    ipcRenderer.invoke('sessions:userTallies', uniqueId) as Promise<{
      uniqueId: string;
      nickname: string;
      likes: number;
      diamonds: number;
      comments: number;
      gifts: number;
      sessionsAppeared: number;
    }>,
  overlayUrl: () => ipcRenderer.invoke('overlay:url') as Promise<string | null>,
  openLiveInternal: (uniqueId: string) =>
    ipcRenderer.invoke('live:openInternal', uniqueId) as Promise<{ ok: boolean }>,

  multiConnect: (username: string) =>
    ipcRenderer.invoke('multi:connect', username) as Promise<{ ok: boolean; error?: string }>,
  multiDisconnect: (username: string) =>
    ipcRenderer.invoke('multi:disconnect', username) as Promise<{ ok: boolean }>,
  multiDisconnectAll: () =>
    ipcRenderer.invoke('multi:disconnectAll') as Promise<{ ok: boolean }>,
  onMultiStatus: (cb: (d: { username: string; status: string; error?: string }) => void) => {
    const handler = (_e: unknown, d: any) => cb(d);
    ipcRenderer.on('multi:status', handler);
    return () => ipcRenderer.removeListener('multi:status', handler);
  },
  onMultiEvent: (cb: (d: { username: string; evt: any }) => void) => {
    const handler = (_e: unknown, d: any) => cb(d);
    ipcRenderer.on('multi:event', handler);
    return () => ipcRenderer.removeListener('multi:event', handler);
  },

  onStatus: (cb: (s: { status: string; error?: string }) => void) => {
    const handler = (_e: unknown, s: { status: string; error?: string }) => cb(s);
    ipcRenderer.on('tt:status', handler);
    return () => ipcRenderer.removeListener('tt:status', handler);
  },
  // Rich connection-health detail (phase, reason, suggestion, reconnect state).
  onHealth: (cb: (d: any) => void) => {
    const handler = (_e: unknown, d: any) => cb(d);
    ipcRenderer.on('tt:health', handler);
    return () => ipcRenderer.removeListener('tt:health', handler);
  },
  onEvent: (cb: (evt: any) => void) => {
    const handler = (_e: unknown, evt: any) => cb(evt);
    ipcRenderer.on('tt:event', handler);
    return () => ipcRenderer.removeListener('tt:event', handler);
  },

  highlightsAvailable: () => ipcRenderer.invoke('highlights:available') as Promise<boolean>,
  highlightsCapture: (reason: string) =>
    ipcRenderer.invoke('highlights:capture', reason) as Promise<{ ok: boolean; path?: string; error?: string }>,
  highlightsList: () =>
    ipcRenderer.invoke('highlights:list') as Promise<{ name: string; path: string; size: number; mtime: number }[]>,
  highlightsReveal: (p: string) => ipcRenderer.invoke('highlights:reveal', p) as Promise<{ ok: boolean }>,
  highlightsDir: () => ipcRenderer.invoke('highlights:dir') as Promise<string>,

  trackedList: () =>
    ipcRenderer.invoke('tracked:list') as Promise<Array<{ uniqueId: string; nickname: string; addedAt: number }>>,
  trackedAdd: (payload: { uniqueId: string; nickname: string }) =>
    ipcRenderer.invoke('tracked:add', payload) as Promise<{ ok: boolean; alreadyTracked?: boolean }>,
  trackedRemove: (uniqueId: string) =>
    ipcRenderer.invoke('tracked:remove', uniqueId) as Promise<{ ok: boolean }>,
  trackedIsTracked: (uniqueId: string) =>
    ipcRenderer.invoke('tracked:isTracked', uniqueId) as Promise<boolean>,

  likerOpen: (username: string) =>
    ipcRenderer.invoke('liker:open', username) as Promise<{ ok: boolean; error?: string }>,
  likerClose: () => ipcRenderer.invoke('liker:close') as Promise<{ ok: boolean }>,
  likerStart: (mode: string, interval: number) =>
    ipcRenderer.invoke('liker:start', mode, interval) as Promise<{ ok: boolean }>,
  likerStop: () => ipcRenderer.invoke('liker:stop') as Promise<{ ok: boolean }>,
  likerSetMode: (mode: string) => ipcRenderer.invoke('liker:setMode', mode) as Promise<{ ok: boolean }>,
  likerSetInterval: (interval: number) => ipcRenderer.invoke('liker:setInterval', interval) as Promise<{ ok: boolean }>,
  likerStats: () => ipcRenderer.invoke('liker:stats') as Promise<{
    isActive: boolean; mode: string; interval: number;
    likesCount: number; keypressCount: number; sessionStartTime: number;
    state: string; isLivePage: boolean;
  } | null>,
  likerIsOpen: () => ipcRenderer.invoke('liker:isOpen') as Promise<boolean>,
  likerShow: () => ipcRenderer.invoke('liker:show') as Promise<{ ok: boolean }>,
  likerHide: () => ipcRenderer.invoke('liker:hide') as Promise<{ ok: boolean }>,

  // Fan CRM
  fansList: (q?: any) => ipcRenderer.invoke('fans:list', q) as Promise<any>,
  fansGet: (uniqueId: string) => ipcRenderer.invoke('fans:get', uniqueId) as Promise<any>,
  // 360 CRM: one call powers the whole profile (fan + strength + reminders + custom fields).
  fansProfile: (uniqueId: string) => ipcRenderer.invoke('fans:profile', uniqueId) as Promise<any>,
  fansTimeline: (uniqueId: string, opts?: { filter?: 'all' | 'gift' | 'comment' | 'note' | 'session'; limit?: number }) =>
    ipcRenderer.invoke('fans:timeline', uniqueId, opts) as Promise<any[]>,
  fansAddNote: (uniqueId: string, body: string) =>
    ipcRenderer.invoke('fans:addNote', uniqueId, body) as Promise<{ ok: boolean; event?: any; error?: string }>,
  fansSetField: (uniqueId: string, key: string, value: unknown) =>
    ipcRenderer.invoke('fans:setField', uniqueId, key, value) as Promise<{ ok: boolean; fan?: any; error?: string }>,
  fieldsListDefs: () => ipcRenderer.invoke('fields:listDefs') as Promise<any[]>,
  fieldsAddDef: (input: { label: string; type: string; key?: string; options?: string[] }) =>
    ipcRenderer.invoke('fields:addDef', input) as Promise<{ ok: boolean; def?: any; error?: string }>,
  fieldsRemoveDef: (id: string) => ipcRenderer.invoke('fields:removeDef', id) as Promise<{ ok: boolean }>,
  fansAdd: (payload: any) => ipcRenderer.invoke('fans:add', payload) as Promise<any>,
  fansUpdate: (uniqueId: string, patch: any) =>
    ipcRenderer.invoke('fans:update', uniqueId, patch) as Promise<any>,
  fansBulkTag: (payload: { ids: string[]; add: string[]; remove: string[] }) =>
    ipcRenderer.invoke('fans:bulkTag', payload) as Promise<{ ok: boolean; updated: number }>,
  fansLogGift: (payload: any) =>
    ipcRenderer.invoke('fans:logGift', payload) as Promise<{ ok: boolean; error?: string }>,
  giftsList: (q?: any) => ipcRenderer.invoke('gifts:list', q) as Promise<any>,
  remindersList: (withinDays?: number) =>
    ipcRenderer.invoke('reminders:list', withinDays) as Promise<any[]>,
  reminderAction: (payload: { id: string; action: 'done' | 'snooze'; days?: number }) =>
    ipcRenderer.invoke('reminders:action', payload) as Promise<{ ok: boolean; error?: string }>,
  reminderAddThank: (uniqueId: string) =>
    ipcRenderer.invoke('reminders:addThank', uniqueId) as Promise<{ ok: boolean; deduped?: boolean; error?: string }>,
  fansMarkThanked: (uniqueId: string) =>
    ipcRenderer.invoke('fans:markThanked', uniqueId) as Promise<{ ok: boolean; fan?: any; error?: string }>,
  fansImportCsv: (csvText: string) => ipcRenderer.invoke('fans:importCsv', csvText) as Promise<any>,
  fansImportCsvFile: () => ipcRenderer.invoke('fans:importCsvFile') as Promise<any>,
  fansExportCsv: () =>
    ipcRenderer.invoke('fans:exportCsv') as Promise<{ ok: boolean; path?: string; error?: string }>,
  giftsExportCsv: (q?: any) =>
    ipcRenderer.invoke('gifts:exportCsv', q) as Promise<{ ok: boolean; path?: string; error?: string; canceled?: boolean }>,
  fansClear: () => ipcRenderer.invoke('fans:clear') as Promise<{ ok: boolean }>,
  fansDataDir: () => ipcRenderer.invoke('fans:dataDir') as Promise<string>,

  watchlistPoke: () => ipcRenderer.invoke('watchlist:poke') as Promise<{ ok: boolean }>,
  onWatchlistLive: (cb: (d: { username: string; detectedAt: number }) => void) => {
    const handler = (_e: unknown, d: any) => cb(d);
    ipcRenderer.on('watchlist:live', handler);
    return () => ipcRenderer.removeListener('watchlist:live', handler);
  },
  // Fired when the user clicks a native go-live notification: jump to the live
  // page and connect to that creator's room.
  onNavigateConnect: (cb: (d: { username: string }) => void) => {
    const handler = (_e: unknown, d: any) => cb(d);
    ipcRenderer.on('navigate:connect', handler);
    return () => ipcRenderer.removeListener('navigate:connect', handler);
  },
};

contextBridge.exposeInMainWorld('tiktok', api);

export type TikTokAPI = typeof api;
