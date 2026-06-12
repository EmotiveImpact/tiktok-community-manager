import type { UserBrief } from '../types';

/* Pastel tier chips — green / cyan / gold / purple (brand badge scheme) */
export function UserBadges({ user }: { user: UserBrief }) {
  const badges: { label: string; cls: string }[] = [];
  if (user.isModerator) badges.push({ label: 'MOD', cls: 'tier-new' });
  if (user.isSubscriber) badges.push({ label: 'SUB', cls: 'tier-whale' });
  if (user.isFollower) badges.push({ label: 'FOLLOW', cls: 'tier-regular' });
  if (typeof user.topGifterRank === 'number' && user.topGifterRank > 0)
    badges.push({ label: `TOP #${user.topGifterRank}`, cls: 'tier-vip' });

  if (badges.length === 0) return null;
  return (
    <span className="inline-flex flex-wrap gap-1">
      {badges.map((b) => (
        <span key={b.label} className={`tier-chip ${b.cls}`}>
          {b.label}
        </span>
      ))}
    </span>
  );
}
