import { useMemo, useState } from 'react';
import { useStore } from '../state/store';
import { useModeration } from '../state/moderation';
import { useUI } from '../state/ui';
import { formatNumber } from '../lib/format';
import { avatarGradient } from '../lib/avatars';

type Mode = 'likes' | 'diamonds' | 'comments';

const labels: Record<Mode, string> = {
  likes: 'Likes',
  diamonds: 'Diamonds',
  comments: 'Comments',
};

const RANK_STYLES = [
  'bg-gradient-to-br from-yellow-300 to-amber-500 text-amber-900',
  'bg-gradient-to-br from-zinc-200 to-zinc-400 text-zinc-700',
  'bg-gradient-to-br from-orange-400 to-orange-600 text-orange-900',
];

export function TopContributors() {
  const tallies = useStore((s) => s.tallies);
  const isFiltered = useModeration((s) => s.isFiltered);
  const focusFanMemory = useUI((s) => s.focusFanMemory);
  const [mode, setMode] = useState<Mode>('likes');

  const top = useMemo(() => {
    const arr = Array.from(tallies.values());
    arr.sort((a, b) => b[mode] - a[mode]);
    return arr.filter((t) => t[mode] > 0 && !isFiltered(t.user.uniqueId)).slice(0, 8);
  }, [tallies, mode, isFiltered]);

  return (
    <div className="glass flex h-full flex-col rounded-xl">
      <div className="flex items-center gap-1 border-b border-zinc-800/50 p-2">
        <span className="mr-1 text-xs font-semibold text-zinc-100">Top Contributors</span>
        <div className="ml-auto flex gap-0.5 rounded-lg bg-zinc-900 p-0.5">
          {(['likes', 'diamonds', 'comments'] as Mode[]).map((m) => (
            <button
              key={m}
              onClick={() => setMode(m)}
              className={`rounded-md px-2.5 py-1 text-[11px] font-medium transition ${
                mode === m
                  ? 'bg-zinc-800 text-zinc-100'
                  : 'text-zinc-500 hover:text-zinc-300'
              }`}
            >
              {labels[m]}
            </button>
          ))}
        </div>
      </div>

      <div className="flex-1 overflow-y-auto">
        {top.length === 0 ? (
          <div className="flex h-full items-center justify-center text-xs text-zinc-600">
            No data yet
          </div>
        ) : (
          <ol className="flex flex-col gap-1 p-2">
            {top.map((t, i) => (
              <li
                key={t.user.uniqueId}
                className="flex items-center gap-2.5 rounded-lg px-2 py-2 transition hover:bg-zinc-900/60"
              >
                <div
                  className={`flex h-7 w-7 flex-none items-center justify-center rounded-full text-xs font-bold ${
                    i < 3 ? RANK_STYLES[i] : 'bg-zinc-800 text-zinc-400'
                  }`}
                >
                  {i + 1}
                </div>
                {t.user.profilePictureUrl ? (
                  <img
                    src={t.user.profilePictureUrl}
                    alt=""
                    className="h-7 w-7 flex-none rounded-full bg-zinc-800 object-cover"
                  />
                ) : (
                  <div className={`flex h-7 w-7 flex-none items-center justify-center rounded-full text-[11px] font-bold text-white ${avatarGradient(t.user.nickname)}`}>
                    {t.user.nickname.charAt(0).toUpperCase()}
                  </div>
                )}
                <button
                  onClick={() => focusFanMemory(t.user.uniqueId)}
                  className="min-w-0 flex-1 truncate text-left text-[13px] font-semibold text-zinc-100 hover:text-like-400"
                  title={`Fan memory for @${t.user.uniqueId}`}
                >
                  {t.user.nickname}
                </button>
                <span className={`flex-none text-[12px] font-semibold tabular-nums ${
                  mode === 'diamonds' ? 'text-amber-300' : mode === 'likes' ? 'text-like-400' : 'text-zinc-300'
                }`}>
                  {formatNumber(t[mode])}
                </span>
              </li>
            ))}
          </ol>
        )}
      </div>
    </div>
  );
}
