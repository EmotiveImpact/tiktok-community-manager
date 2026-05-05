import { useMemo, useState } from 'react';
import { useStore } from '../state/store';
import { useTracked } from '../state/tracked';
import { avatarGradient } from '../lib/avatars';
import { timeAgo } from '../lib/format';
import { Username } from './Username';
import { UserBadges } from './UserBadges';
import { PanelHeader, PanelShell } from './PanelHeader';

type SortBy = 'recent' | 'name' | 'joined';
type Filter = 'all' | 'active' | 'inactive' | 'tracked';

export function RoomMembersPanel({ onClose }: { onClose: () => void }) {
  const roomMembers = useStore((s) => s.roomMembers);
  const selectUser = useStore((s) => s.selectUser);
  const tallies = useStore((s) => s.tallies);
  const trackedList = useTracked((s) => s.list);
  const isTracked = useTracked((s) => s.isTracked);
  const addTracked = useTracked((s) => s.add);
  const removeTracked = useTracked((s) => s.remove);
  const [search, setSearch] = useState('');
  const [sortBy, setSortBy] = useState<SortBy>('recent');
  const [filter, setFilter] = useState<Filter>('all');

  const members = useMemo(() => {
    let arr = Array.from(roomMembers.values());

    if (search.trim()) {
      const q = search.toLowerCase();
      arr = arr.filter(
        (m) => m.user.nickname.toLowerCase().includes(q) || m.user.uniqueId.toLowerCase().includes(q),
      );
    }

    const fiveMinAgo = Date.now() - 5 * 60 * 1000;
    if (filter === 'active') arr = arr.filter((m) => m.lastSeenAt > fiveMinAgo);
    if (filter === 'inactive') arr = arr.filter((m) => m.lastSeenAt <= fiveMinAgo);
    if (filter === 'tracked') arr = arr.filter((m) => isTracked(m.user.uniqueId));

    arr.sort((a, b) => {
      if (sortBy === 'name') return a.user.nickname.localeCompare(b.user.nickname);
      if (sortBy === 'joined') return a.joinedAt - b.joinedAt;
      return b.lastSeenAt - a.lastSeenAt;
    });

    return arr;
  }, [roomMembers, search, sortBy, filter, trackedList, isTracked]);

  const totalMembers = roomMembers.size;
  const fiveMinAgo = Date.now() - 5 * 60 * 1000;
  const activeCount = Array.from(roomMembers.values()).filter((m) => m.lastSeenAt > fiveMinAgo).length;
  const trackedInRoom = Array.from(roomMembers.values()).filter((m) => isTracked(m.user.uniqueId)).length;

  return (
    <PanelShell>
      <PanelHeader
        title="Room Members"
        badge={totalMembers}
        onClose={onClose}
      >
        <span className="text-xs text-emerald-400">● {activeCount} active</span>
        {trackedInRoom > 0 && <span className="text-xs text-amber-400">★ {trackedInRoom} tracked</span>}
      </PanelHeader>

      <div className="flex items-center gap-3 border-b border-zinc-800/50 px-4 py-2">
        <input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search members..."
          className="flex-1 rounded-lg border border-zinc-800 bg-zinc-900 px-3 py-1.5 text-sm outline-none focus:border-like-500/60"
        />
        <select
          value={filter}
          onChange={(e) => setFilter(e.target.value as Filter)}
          className="rounded-lg border border-zinc-800 bg-zinc-900 px-2 py-1.5 text-xs text-zinc-300 outline-none"
        >
          <option value="all">All ({totalMembers})</option>
          <option value="active">Active ({activeCount})</option>
          <option value="inactive">Inactive ({totalMembers - activeCount})</option>
          <option value="tracked">Tracked ({trackedInRoom})</option>
        </select>
        <select
          value={sortBy}
          onChange={(e) => setSortBy(e.target.value as SortBy)}
          className="rounded-lg border border-zinc-800 bg-zinc-900 px-2 py-1.5 text-xs text-zinc-300 outline-none"
        >
          <option value="recent">Last seen</option>
          <option value="joined">Join order</option>
          <option value="name">Name A-Z</option>
        </select>
      </div>

      <div className="flex-1 overflow-y-auto">
        {members.length === 0 ? (
          <div className="flex h-64 items-center justify-center text-sm text-zinc-600">
            {totalMembers === 0 ? 'No members detected yet — they appear as people interact.' : 'No matches'}
          </div>
        ) : (
          <ul className="divide-y divide-zinc-800/40">
            {members.map((m) => {
              const tally = tallies.get(m.user.uniqueId);
              const isActive = m.lastSeenAt > fiveMinAgo;
              const tracked = isTracked(m.user.uniqueId);

              return (
                <li key={m.user.uniqueId} className={`group flex items-center gap-3 px-4 py-2.5 hover:bg-zinc-900/40 ${tracked ? 'bg-amber-500/[0.03]' : ''}`}>
                  <div className={`h-2 w-2 flex-none rounded-full ${isActive ? 'bg-emerald-400' : 'bg-zinc-700'}`} />

                  {m.user.profilePictureUrl ? (
                    <img src={m.user.profilePictureUrl} alt="" className="h-8 w-8 flex-none rounded-full bg-zinc-800 object-cover" />
                  ) : (
                    <div className={`flex h-8 w-8 flex-none items-center justify-center rounded-full text-xs font-bold text-white ${avatarGradient(m.user.nickname)}`}>
                      {m.user.nickname.charAt(0).toUpperCase()}
                    </div>
                  )}

                  <div
                    className="min-w-0 flex-1 cursor-pointer"
                    onClick={() => selectUser(m.user.uniqueId)}
                  >
                    <div className="flex items-baseline gap-1.5">
                      <Username user={m.user} className="text-sm font-medium" />
                      <UserBadges user={m.user} />
                      {tracked && <span className="text-[10px] text-amber-400">★</span>}
                    </div>
                    <div className="flex items-center gap-2 text-[10px] text-zinc-600">
                      <span>Joined {timeAgo(m.joinedAt)} ago</span>
                      {tally && tally.comments > 0 && <span>{tally.comments} comments</span>}
                      {tally && tally.diamonds > 0 && <span className="text-amber-400">{tally.diamonds} diamonds</span>}
                    </div>
                  </div>

                  <button
                    onClick={() => tracked ? removeTracked(m.user.uniqueId) : addTracked(m.user.uniqueId, m.user.nickname)}
                    className={`rounded-lg px-2.5 py-1 text-[11px] font-medium transition ${
                      tracked
                        ? 'border border-amber-500/30 bg-amber-500/10 text-amber-300 hover:bg-amber-500/20'
                        : 'border border-zinc-800 bg-zinc-900 text-zinc-400 hover:border-amber-500/30 hover:text-amber-300 opacity-0 group-hover:opacity-100'
                    }`}
                  >
                    {tracked ? '★ Tracked' : '☆ Track'}
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </div>

      <footer className="border-t border-zinc-800/50 px-4 py-2">
        <p className="text-[11px] text-zinc-600">
          Track adds users to your local list inside this app. Tracked users get highlighted in chat and you can filter for them. This does not follow them on TikTok.
        </p>
      </footer>
    </PanelShell>
  );
}
