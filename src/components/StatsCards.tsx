import { useStore } from '../state/store';
import { formatNumber } from '../lib/format';

export function StatsCards() {
  const viewerCount = useStore((s) => s.viewerCount);
  const totalDiamonds = useStore((s) => s.totalDiamonds);
  const giftCount = useStore((s) => s.giftCount);
  const followCount = useStore((s) => s.followCount);
  const shareCount = useStore((s) => s.shareCount);
  const subscribeCount = useStore((s) => s.subscribeCount);
  const commentCount = useStore((s) => s.commentCount);

  const stats: { label: string; value: string; accent: string }[] = [
    { label: 'Viewers', value: formatNumber(viewerCount), accent: 'text-zinc-100' },
    { label: 'Comments', value: formatNumber(commentCount), accent: 'text-zinc-100' },
    { label: 'Diamonds', value: formatNumber(totalDiamonds), accent: 'text-amber-300' },
    { label: 'Gifts', value: formatNumber(giftCount), accent: 'text-purple-400' },
    { label: 'Followers', value: formatNumber(followCount), accent: 'text-cyan-400' },
    { label: 'Shares', value: formatNumber(shareCount), accent: 'text-emerald-300' },
    { label: 'Subs', value: formatNumber(subscribeCount), accent: 'text-fuchsia-300' },
  ];

  return (
    <div className="glass flex-1 overflow-y-auto rounded-xl p-3">
      <div className="flex flex-col gap-2">
        {stats.map((s) => (
          <div key={s.label} className="flex items-center justify-between">
            <span className="text-xs text-zinc-500">{s.label}</span>
            <span className={`text-sm font-bold tabular-nums ${s.accent}`}>{s.value}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
