import type { UserBrief } from '../types';
import { useStore } from '../state/store';

const USERNAME_COLORS = [
  'text-like-400',
  'text-blue-300',
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

export function Username({
  user,
  className = '',
  colored = true,
}: {
  user: UserBrief;
  className?: string;
  colored?: boolean;
}) {
  const selectUser = useStore((s) => s.selectUser);
  const colorClass = colored ? colorFor(user.uniqueId) : '';
  return (
    <button
      onClick={(e) => {
        e.stopPropagation();
        selectUser(user.uniqueId);
      }}
      className={`truncate text-left hover:underline focus:outline-none ${colorClass} ${className}`}
      title={`Details for @${user.uniqueId}`}
    >
      {user.nickname}
    </button>
  );
}
