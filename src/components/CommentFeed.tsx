import { useMemo } from 'react';
import { useStore } from '../state/store';
import { useModeration } from '../state/moderation';
import { useTracked } from '../state/tracked';
import { timeAgo } from '../lib/format';
import { avatarGradient } from '../lib/avatars';
import { Username } from './Username';
import { UserBadges } from './UserBadges';

export function CommentFeed() {
  const comments = useStore((s) => s.comments);
  const pinnedMessages = useStore((s) => s.pinnedMessages);
  const pinMessage = useStore((s) => s.pinMessage);
  const unpinMessage = useStore((s) => s.unpinMessage);
  const isFiltered = useModeration((s) => s.isFiltered);
  const userTags = useModeration((s) => s.userTags);
  const isTracked = useTracked((s) => s.isTracked);

  const filtered = useMemo(
    () => comments.filter((c) => {
      if (c.type !== 'chat') return false;
      return !isFiltered(c.user.uniqueId, c.comment);
    }),
    [comments, isFiltered],
  );

  if (filtered.length === 0) {
    return (
      <div className="flex h-full items-center justify-center text-sm text-zinc-600">
        No comments yet
      </div>
    );
  }

  const TAG_BORDER: Record<string, string> = {
    vip: 'border-l-2 border-l-amber-400',
    troll: 'border-l-2 border-l-rose-400',
  };

  const pinnedIds = new Set(pinnedMessages.map((p) => p.id));

  return (
    <div className="flex h-full flex-col">
      {pinnedMessages.length > 0 && (
        <div className="border-b border-like-500/20 bg-like-500/5 px-3 py-2">
          <div className="mb-1 text-[10px] font-semibold uppercase tracking-wider text-like-400">Pinned</div>
          {pinnedMessages.map((p) => (
            <div key={p.id} className="flex items-baseline gap-2 text-sm py-0.5">
              <span className="font-medium text-zinc-300">{(p as any).user?.nickname}</span>
              <span className="text-zinc-400 flex-1 truncate">{(p as any).comment}</span>
              <button onClick={() => unpinMessage(p.id)} className="text-[10px] text-zinc-500 hover:text-rose-400">unpin</button>
            </div>
          ))}
        </div>
      )}

      <ul className="flex-1 overflow-y-auto p-3">
        {filtered.map((c) => {
          if (c.type !== 'chat') return null;
          const tag = userTags.get(c.user.uniqueId);
          const isPinned = pinnedIds.has(c.id);
          const tracked = isTracked(c.user.uniqueId);
          return (
            <li key={c.id} className={`group flex items-start gap-2.5 rounded-lg px-2 py-1.5 hover:bg-zinc-900/60 ${tag ? TAG_BORDER[tag] ?? '' : ''} ${tracked ? 'border-l-2 border-l-amber-400 bg-amber-500/[0.03]' : ''}`}>
              <Avatar src={c.user.profilePictureUrl} name={c.user.nickname} />
              <div className="min-w-0 flex-1">
                <div className="flex items-baseline gap-1.5">
                  <Username user={c.user} className="text-xs font-semibold" />
                  <UserBadges user={c.user} />
                  {tracked && <span className="text-[10px] text-amber-400" title="Tracked">★</span>}
                  <span className="text-[10px] text-zinc-600">{timeAgo(c.ts)}</span>
                  <button
                    onClick={() => isPinned ? unpinMessage(c.id) : pinMessage(c)}
                    className="ml-auto hidden text-[10px] text-zinc-600 hover:text-like-400 group-hover:inline"
                  >
                    {isPinned ? 'unpin' : 'pin'}
                  </button>
                </div>
                <div className="break-words text-[13px] text-zinc-300">{c.comment}</div>
              </div>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

function Avatar({ src, name }: { src: string | null; name: string }) {
  if (src) {
    return <img src={src} alt="" className="h-6 w-6 flex-none rounded-full bg-zinc-800 object-cover" />;
  }
  return (
    <div className={`flex h-6 w-6 flex-none items-center justify-center rounded-full text-[10px] font-bold text-white ${avatarGradient(name)}`}>
      {name.charAt(0).toUpperCase()}
    </div>
  );
}
