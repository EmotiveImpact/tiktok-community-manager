import type { UserBrief } from '../types';

export function UserBadges({ user }: { user: UserBrief }) {
  const badges: { label: string; cls: string }[] = [];
  if (user.isModerator) badges.push({ label: 'MOD', cls: 'bg-emerald-500/15 text-emerald-300' });
  if (user.isSubscriber) badges.push({ label: 'SUB', cls: 'bg-fuchsia-500/15 text-fuchsia-300' });
  if (user.isFollower) badges.push({ label: 'FOLLOW', cls: 'bg-sky-500/15 text-sky-300' });
  if (typeof user.topGifterRank === 'number' && user.topGifterRank > 0)
    badges.push({ label: `TOP #${user.topGifterRank}`, cls: 'bg-amber-500/15 text-amber-300' });

  if (badges.length === 0) return null;
  return (
    <span className="inline-flex flex-wrap gap-1">
      {badges.map((b) => (
        <span
          key={b.label}
          className={`rounded px-1.5 py-0.5 text-[9px] font-semibold tracking-wide ${b.cls}`}
        >
          {b.label}
        </span>
      ))}
    </span>
  );
}
