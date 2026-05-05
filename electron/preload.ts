import { contextBridge, ipcRenderer } from 'electron';

const api = {
  connect: (username: string) =>
    ipcRenderer.invoke('tt:connect', username) as Promise<{ ok: boolean; error?: string }>,
  disconnect: () => ipcRenderer.invoke('tt:disconnect') as Promise<{ ok: boolean }>,
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
  setWebhooks: (cfg: any) =>
    ipcRenderer.invoke('settings:setWebhooks', cfg) as Promise<{ ok: boolean }>,
  setWatchlist: (list: string[]) =>
    ipcRenderer.invoke('settings:setWatchlist', list) as Promise<{ ok: boolean }>,
  chatLogDir: () => ipcRenderer.invoke('chatlog:dir') as Promise<string>,
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

  watchlistPoke: () => ipcRenderer.invoke('watchlist:poke') as Promise<{ ok: boolean }>,
  onWatchlistLive: (cb: (d: { username: string; detectedAt: number }) => void) => {
    const handler = (_e: unknown, d: any) => cb(d);
    ipcRenderer.on('watchlist:live', handler);
    return () => ipcRenderer.removeListener('watchlist:live', handler);
  },
};

contextBridge.exposeInMainWorld('tiktok', api);

export type TikTokAPI = typeof api;
