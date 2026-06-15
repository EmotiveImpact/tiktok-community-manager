import { useEffect, useState } from 'react';
import type { UserHistoricalTally } from '../types';
import { formatNumber } from '../lib/format';
import { avatarGradient } from '../lib/avatars';
import { useUI } from '../state/ui';
import { PanelHeader, PanelShell } from './PanelHeader';

type SortKey = 'diamonds' | 'comments' | 'gifts' | 'sessionsAppeared';

const RANK_STYLES = [
  'bg-gradient-to-br from-yellow-300 to-amber-500 text-amber-900',
  'bg-gradient-to-br from-zinc-200 to-zinc-400 text-zinc-700',
  'bg-gradient-to-br from-orange-400 to-orange-600 text-orange-900',
];

export function AllTimeLeaderboard({ onClose }: { onClose: () => void }) {
  const [data, setData] = useState<UserHistoricalTally[]>([]);
  const [sortBy, setSortBy] = useState<SortKey>('diamonds');
  const openFanPeek = useUI((s) => s.openFanPeek);

  useEffect(() => {
    window.tiktok.sessionsLeaderboard(100).then(setData);
  }, []);

  const sorted = [...data].sort((a, b) => b[sortBy] - a[sortBy]);

  return (
    <PanelShell>
      <PanelHeader
        title="All-Time Leaderboard"
        badge={data.length}
        onClose={onClose}
      >
        <div className="flex h-7 items-center gap-0.5 rounded-md border border-zinc-700 bg-zinc-900 p-0.5">
          {([
            ['diamonds', 'Diamonds'],
            ['comments', 'Comments'],
            ['gifts', 'Gifts'],
            ['sessionsAppeared', 'Sessions'],
          ] as const).map(([key, label]) => (
            <button
              key={key}
              onClick={() => setSortBy(key)}
              className={`rounded-sm px-2.5 py-0.5 text-[11px] font-medium transition ${
                sortBy === key
                  ? 'bg-zinc-800 text-zinc-100'
                  : 'text-zinc-500 hover:text-zinc-300'
              }`}
            >
              {label}
            </button>
          ))}
        </div>
      </PanelHeader>

      <div className="flex-1 overflow-y-auto p-4">
        {sorted.length === 0 ? (
          <div className="flex h-full items-center justify-center text-sm text-zinc-600">
            No session data yet. Connect to a live and the leaderboard will populate from saved sessions.
          </div>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-zinc-800 text-left text-[11px] uppercase tracking-wider text-zinc-500">
                <th className="px-3 py-2 w-10">#</th>
                <th className="px-3 py-2">User</th>
                <th className="px-3 py-2 text-right">Diamonds</th>
                <th className="px-3 py-2 text-right">Comments</th>
                <th className="px-3 py-2 text-right">Gifts</th>
                <th className="px-3 py-2 text-right">Sessions</th>
              </tr>
            </thead>
            <tbody>
              {sorted.map((t, i) => (
                <tr
                  key={t.uniqueId}
                  onClick={() => openFanPeek(t.uniqueId)}
                  className="cursor-pointer border-b border-zinc-900 transition hover:bg-zinc-900/60"
                >
                  <td className="px-3 py-2.5">
                    <div
                      className={`flex h-7 w-7 items-center justify-center rounded-full text-xs font-bold ${
                        i < 3 ? RANK_STYLES[i] : 'bg-zinc-800 text-zinc-400'
                      }`}
                    >
                      {i + 1}
                    </div>
                  </td>
                  <td className="px-3 py-2.5">
                    <div className="flex items-center gap-2.5">
                      <div className={`flex h-7 w-7 flex-none items-center justify-center rounded-full text-[11px] font-bold text-white ${avatarGradient(t.nickname)}`}>
                        {t.nickname.charAt(0).toUpperCase()}
                      </div>
                      <div>
                        <div className="font-semibold text-zinc-100">{t.nickname}</div>
                        <div className="text-[10px] text-zinc-500">@{t.uniqueId}</div>
                      </div>
                    </div>
                  </td>
                  <td className="px-3 py-2.5 text-right font-semibold tabular-nums text-[var(--amber)]">
                    {formatNumber(t.diamonds)}
                  </td>
                  <td className="px-3 py-2.5 text-right tabular-nums text-zinc-300">
                    {formatNumber(t.comments)}
                  </td>
                  <td className="px-3 py-2.5 text-right tabular-nums text-[var(--green)]">
                    {formatNumber(t.gifts)}
                  </td>
                  <td className="px-3 py-2.5 text-right tabular-nums text-[var(--cyan)]">
                    {t.sessionsAppeared}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </PanelShell>
  );
}
