import type { UserBrief } from '../types';
import { useUI } from '../state/ui';

const USERNAME_COLORS = [
  'text-like-400',
  'text-cyan-400',
  'text-purple-400',
  'text-emerald-300',
  'text-amber-300',
  'text-orange-400',
  'text-cyan-300',
  'text-rose-400',
];

function colorFor(uniqueId: string): string {
  let hash = 0;
  for (let i = 0; i < uniqueId.length; i++) {
    hash = ((hash << 5) - hash + uniqueId.charCodeAt(i)) | 0;
  }
  return USERNAME_COLORS[Math.abs(hash) % USERNAME_COLORS.length];
}

/** Cyan verified check (TikTok style). */
export function VerifiedBadge() {
  return (
    <svg width="11" height="11" viewBox="0 0 24 24" className="inline-block flex-none align-middle" aria-label="Verified">
      <circle cx="12" cy="12" r="11" fill="#69C9D0" />
      <path d="M7 12.5l3.2 3.2L17 9" stroke="white" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" fill="none" />
    </svg>
  );
}

/**
 * Clickable username. Clicking focuses the Fan Memory panel (pinned) —
 * the magic interaction of the live view.
 */
export function Username({
  user,
  className = '',
  colored = true,
}: {
  user: UserBrief;
  className?: string;
  colored?: boolean;
}) {
  const focusFanMemory = useUI((s) => s.focusFanMemory);
  const colorClass = colored ? colorFor(user.uniqueId) : '';
  return (
    <button
      onClick={(e) => {
        e.stopPropagation();
        focusFanMemory(user.uniqueId);
      }}
      className={`inline-flex max-w-full items-center gap-1 truncate text-left hover:underline focus:outline-none ${colorClass} ${className}`}
      title={`Fan memory for @${user.uniqueId}`}
    >
      <span className="truncate">{user.nickname}</span>
      {user.verified && <VerifiedBadge />}
    </button>
  );
}
