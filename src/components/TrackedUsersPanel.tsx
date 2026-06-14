import { useState } from 'react';
import { useTracked } from '../state/tracked';
import { useStore } from '../state/store';
import { useUI } from '../state/ui';
import { avatarGradient } from '../lib/avatars';
import { timeAgo } from '../lib/format';
import { PanelHeader, PanelShell } from './PanelHeader';

export function TrackedUsersPanel({ onClose }: { onClose: () => void }) {
  const list = useTracked((s) => s.list);
  const remove = useTracked((s) => s.remove);
  const add = useTracked((s) => s.add);
  const roomMembers = useStore((s) => s.roomMembers);
  const tallies = useStore((s) => s.tallies);
  const focusFanMemory = useUI((s) => s.focusFanMemory);
  const [search, setSearch] = useState('');
  const [addOpen, setAddOpen] = useState(false);
  const [newId, setNewId] = useState('');
  const [newNick, setNewNick] = useState('');

  const filtered = search.trim()
    ? list.filter((u) => u.nickname.toLowerCase().includes(search.toLowerCase()) || u.uniqueId.toLowerCase().includes(search.toLowerCase()))
    : list;

  const sorted = [...filtered].sort((a, b) => b.addedAt - a.addedAt);

  const handleAdd = async () => {
    if (!newId.trim()) return;
    await add(newId.trim(), newNick.trim() || newId.trim());
    setNewId('');
    setNewNick('');
    setAddOpen(false);
  };

  return (
    <PanelShell>
      <PanelHeader
        title="Tracked Users"
        badge={list.length}
        onClose={onClose}
        actions={
          <button
            onClick={() => setAddOpen(!addOpen)}
            className="panel-btn panel-btn-primary"
          >
            + Track User
          </button>
        }
      />

      <div className="border-b border-zinc-800/50 px-4 py-2">
        <input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search tracked users..."
          className="w-full rounded-lg border border-zinc-800 bg-zinc-900 px-3 py-2 text-sm outline-none focus:border-like-500/60"
        />
      </div>

      {addOpen && (
        <div className="border-b border-zinc-800 bg-zinc-900/50 px-4 py-3">
          <div className="flex gap-2 mb-2">
            <input
              value={newId}
              onChange={(e) => setNewId(e.target.value)}
              placeholder="@username"
              autoFocus
              className="w-44 rounded-lg border border-zinc-800 bg-zinc-900 px-3 py-1.5 text-sm outline-none focus:border-like-500/60"
            />
            <input
              value={newNick}
              onChange={(e) => setNewNick(e.target.value)}
              placeholder="Display name (optional)"
              className="flex-1 rounded-lg border border-zinc-800 bg-zinc-900 px-3 py-1.5 text-sm outline-none focus:border-like-500/60"
            />
            <button
              onClick={handleAdd}
              disabled={!newId.trim()}
              className="rounded-lg bg-gradient-to-r from-like-500 to-like-600 px-3 py-1.5 text-sm font-medium text-white disabled:opacity-40"
            >
              Add
            </button>
            <button onClick={() => setAddOpen(false)} className="text-xs text-zinc-400 hover:text-zinc-200">
              Cancel
            </button>
          </div>
        </div>
      )}

      <div className="flex-1 overflow-y-auto">
        {sorted.length === 0 ? (
          <div className="flex h-64 flex-col items-center justify-center text-sm text-zinc-600">
            <p className="mb-1">{list.length === 0 ? 'No tracked users yet' : `No matches for "${search}"`}</p>
            {list.length === 0 && (
              <p className="max-w-sm text-center text-xs">
                Click any user in chat or Room Members and hit "Track" to add them here.
                Tracked users get highlighted in the comment feed.
              </p>
            )}
          </div>
        ) : (
          <ul className="divide-y divide-zinc-800/40">
            {sorted.map((u) => {
              const member = roomMembers.get(u.uniqueId);
              const tally = tallies.get(u.uniqueId);
              const fiveMinAgo = Date.now() - 5 * 60 * 1000;
              const inRoom = member && member.lastSeenAt > fiveMinAgo;

              return (
                <li key={u.uniqueId} className="group flex items-center gap-3 px-4 py-2.5 hover:bg-zinc-900/40">
                  <span className="text-amber-400">★</span>
                  <div className={`flex h-9 w-9 flex-none items-center justify-center rounded-full text-sm font-bold text-white ${avatarGradient(u.nickname)}`}>
                    {u.nickname.charAt(0).toUpperCase()}
                  </div>
                  <div className="min-w-0 flex-1 cursor-pointer" onClick={() => focusFanMemory(u.uniqueId)}>
                    <div className="flex items-baseline gap-2">
                      <span className="text-sm font-semibold text-zinc-100">{u.nickname}</span>
                      <span className="text-[11px] text-zinc-500">@{u.uniqueId}</span>
                      {inRoom && <span className="text-[10px] text-emerald-400">● In room</span>}
                    </div>
                    <div className="flex items-center gap-2 text-[10px] text-zinc-600">
                      <span>Tracked {timeAgo(u.addedAt)} ago</span>
                      {tally && tally.comments > 0 && <span>· {tally.comments} comments this session</span>}
                      {tally && tally.diamonds > 0 && <span className="text-amber-400">· {tally.diamonds} diamonds</span>}
                    </div>
                  </div>
                  <button
                    onClick={() => window.tiktok.openProfile(u.uniqueId)}
                    className="rounded-lg px-2.5 py-1 text-[11px] text-zinc-500 hover:text-zinc-200 opacity-0 group-hover:opacity-100"
                  >
                    Profile
                  </button>
                  <button
                    onClick={() => remove(u.uniqueId)}
                    className="rounded-lg px-2.5 py-1 text-[11px] text-zinc-500 hover:text-rose-400 opacity-0 group-hover:opacity-100"
                  >
                    Untrack
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </div>

      <footer className="border-t border-zinc-800/50 px-4 py-2">
        <p className="text-[11px] text-zinc-600">
          Tracked users persist locally across sessions. Tracking does NOT follow them on TikTok — it just keeps them on your radar inside this app.
        </p>
      </footer>
    </PanelShell>
  );
}
