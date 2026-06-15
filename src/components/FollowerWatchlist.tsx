import { useEffect, useRef, useState } from 'react';
import { avatarGradient } from '../lib/avatars';
import { relativeTime } from '../lib/format';
import type { WatchEntry } from '../types';
import { PanelHeader, PanelShell } from './PanelHeader';
import { Switch, Tooltip } from './ui';

export function FollowerWatchlist({ onClose }: { onClose: () => void }) {
  const [watchlist, setWatchlist] = useState<WatchEntry[]>([]);
  const [input, setInput] = useState('');
  // Mirror the latest list in a ref so the live-event listener can patch it
  // without re-subscribing on every render.
  const listRef = useRef<WatchEntry[]>([]);
  listRef.current = watchlist;

  useEffect(() => {
    window.tiktok.getSettings().then((s) => {
      setWatchlist(s.watchlist ?? []);
    });
  }, []);

  // When the poller detects a watched user live, stamp lastSeen so the panel
  // shows a real "Last seen" time. The store has already persisted it main-side.
  useEffect(() => {
    const off = window.tiktok.onWatchlistLive(({ username, detectedAt }) => {
      const next = listRef.current.map((w) =>
        w.username === username ? { ...w, lastSeen: detectedAt } : w,
      );
      setWatchlist(next);
    });
    return off;
  }, []);

  const save = (list: WatchEntry[]) => {
    setWatchlist(list);
    window.tiktok.setWatchlist(list);
  };

  const addUser = () => {
    const handle = input.trim().replace(/^@/, '');
    if (!handle || watchlist.some((w) => w.username === handle)) return;
    save([...watchlist, { username: handle, notify: true, lastSeen: null }]);
    setInput('');
  };

  const removeUser = (username: string) => {
    save(watchlist.filter((w) => w.username !== username));
  };

  const toggleNotify = (username: string) => {
    save(watchlist.map((w) => w.username === username ? { ...w, notify: !w.notify } : w));
  };

  return (
    <PanelShell>
      <PanelHeader title="Go-Live Watchlist" badge={watchlist.length} onClose={onClose} />

      <div className="p-4 border-b border-zinc-800">
        <div className="flex gap-2">
          <span className="flex items-center text-xs text-zinc-500">@</span>
          <input
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') addUser(); }}
            placeholder="Add username to watch…"
            className="flex-1 rounded-lg border border-zinc-800 bg-zinc-900 px-3 py-1.5 text-sm outline-none transition focus:border-like-500/60"
          />
          <button
            onClick={addUser}
            disabled={!input.trim()}
            className="rounded-lg bg-gradient-to-r from-like-500 to-like-600 px-4 py-1.5 text-sm font-medium text-white shadow-lg shadow-like-500/20 disabled:opacity-40"
          >
            Add
          </button>
        </div>
        <p className="mt-2 text-xs text-zinc-600">
          Add usernames you want to track. When they appear in any chat you're connected to, you'll be notified via alerts.
        </p>
      </div>

      <div className="flex-1 overflow-y-auto p-4">
        {watchlist.length === 0 ? (
          <div className="flex h-full items-center justify-center text-sm text-zinc-600">
            No users on your watchlist yet.
          </div>
        ) : (
          <ul className="flex flex-col gap-2">
            {watchlist.map((w) => (
              <li key={w.username} className="glass flex items-center gap-3 rounded-xl px-4 py-3">
                <div className={`flex h-9 w-9 flex-none items-center justify-center rounded-full text-sm font-bold text-white ${avatarGradient(w.username)}`}>
                  {w.username.charAt(0).toUpperCase()}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="text-sm font-semibold text-zinc-200">@{w.username}</div>
                  <Tooltip content={w.lastSeen ? new Date(w.lastSeen).toLocaleString() : undefined}>
                    <div className="text-[10px] text-zinc-600">
                      {w.lastSeen ? `Last seen live ${relativeTime(w.lastSeen)}` : 'Not seen live yet'}
                    </div>
                  </Tooltip>
                </div>
                <Tooltip content={w.notify ? 'Alerts on — you\'ll be notified when this user goes live' : 'Alerts off — no go-live notification for this user'}>
                  <span className="inline-flex">
                    <Switch
                      checked={w.notify}
                      onCheckedChange={() => toggleNotify(w.username)}
                      label={w.notify ? 'Notify ON' : 'Notify OFF'}
                    />
                  </span>
                </Tooltip>
                <button
                  onClick={() => window.tiktok.openProfileInternal(w.username)}
                  className="rounded-lg border border-zinc-800 px-2.5 py-1 text-xs text-zinc-400 hover:bg-zinc-800"
                >
                  Profile
                </button>
                <button
                  onClick={() => removeUser(w.username)}
                  className="text-xs text-zinc-500 hover:text-rose-400"
                >
                  Remove
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </PanelShell>
  );
}
