import { memo, useMemo } from 'react';
import { useStore } from '../state/store';
import { useModeration } from '../state/moderation';
import { useTracked } from '../state/tracked';
import { useUI, type FeedFilter, type StreamNote } from '../state/ui';
import { timeAgo } from '../lib/format';
import { avatarGradient } from '../lib/avatars';
import { Username } from './Username';
import { UserBadges } from './UserBadges';
import type { LiveEvent, UserBrief } from '../types';

type FeedItem = LiveEvent & { id: string };

const GIFT_EMOJI: Record<string, string> = {
  Rose: '🌹', 'Finger Heart': '🫰', GG: '🎮', Galaxy: '🌌', Lion: '🦁', Doughnut: '🍩',
};

function matchesFilter(u: UserBrief, f: FeedFilter): boolean {
  switch (f) {
    case 'followers': return !!u.isFollower;
    case 'subs': return !!u.isSubscriber;
    case 'mods': return !!u.isModerator;
    case 'gifters': return typeof u.topGifterRank === 'number' && u.topGifterRank > 0;
    default: return true;
  }
}

export function CommentFeed() {
  const all = useStore((s) => s.all);
  const pinnedMessages = useStore((s) => s.pinnedMessages);
  const unpinMessage = useStore((s) => s.unpinMessage);
  const isFiltered = useModeration((s) => s.isFiltered);
  const userTags = useModeration((s) => s.userTags);
  const isTracked = useTracked((s) => s.isTracked);
  const feedFilter = useUI((s) => s.feedFilter);
  const streamNotes = useUI((s) => s.streamNotes);

  const rows = useMemo(() => {
    const items: (FeedItem | StreamNote)[] = [];
    for (const e of all) {
      if (items.length >= 200) break;
      if (e.type === 'chat') {
        if (isFiltered(e.user.uniqueId, e.comment)) continue;
        if (!matchesFilter(e.user, feedFilter)) continue;
        items.push(e);
      } else if ((e.type === 'member' || e.type === 'gift' || e.type === 'follow') && feedFilter === 'all') {
        items.push(e);
      }
    }
    if (streamNotes.length === 0) return items;
    // merge personal notes into the timeline by timestamp (both lists newest-first)
    const merged: (FeedItem | StreamNote)[] = [];
    let i = 0, j = 0;
    while (i < items.length || j < streamNotes.length) {
      if (j >= streamNotes.length || (i < items.length && items[i].ts >= streamNotes[j].ts)) merged.push(items[i++]);
      else merged.push(streamNotes[j++]);
    }
    return merged;
  }, [all, isFiltered, feedFilter, streamNotes]);

  if (rows.length === 0 && pinnedMessages.length === 0) {
    return (
      <div className="flex h-full items-center justify-center text-sm text-zinc-600">
        No comments yet
      </div>
    );
  }

  const pinnedIds = new Set(pinnedMessages.map((p) => p.id));

  return (
    <div className="flex h-full flex-col">
      {pinnedMessages.length > 0 && (
        <div className="border-b border-like-500/20 bg-like-500/5 px-3 py-2">
          <div className="mb-1 text-[10px] font-semibold uppercase tracking-wider text-like-400">Pinned</div>
          {pinnedMessages.map((p) => (
            <div key={p.id} className="flex items-baseline gap-2 py-0.5 text-sm">
              <span className="font-medium text-zinc-300">{(p as any).user?.nickname}</span>
              <span className="flex-1 truncate text-zinc-400">{(p as any).comment}</span>
              <button onClick={() => unpinMessage(p.id)} className="text-[10px] text-zinc-500 hover:text-rose-400">unpin</button>
            </div>
          ))}
        </div>
      )}

      <ul className="flex-1 space-y-0.5 overflow-y-auto p-3">
        {rows.map((r) =>
          'text' in r ? (
            <NoteRow key={r.id} note={r} />
          ) : r.type === 'chat' ? (
            <ChatRow key={r.id} item={r} tag={userTags.get(r.user.uniqueId)} tracked={isTracked(r.user.uniqueId)} pinned={pinnedIds.has(r.id)} />
          ) : (
            <EventRow key={r.id} item={r} />
          ),
        )}
      </ul>
    </div>
  );
}

const TAG_BORDER: Record<string, string> = {
  vip: 'border-l-2 border-l-amber-400',
  troll: 'border-l-2 border-l-rose-400',
};

const ChatRow = memo(function ChatRow({
  item,
  tag,
  tracked,
  pinned,
}: {
  item: Extract<FeedItem, { type: 'chat' }>;
  tag?: string;
  tracked: boolean;
  pinned: boolean;
}) {
  const pinMessage = useStore((s) => s.pinMessage);
  const unpinMessage = useStore((s) => s.unpinMessage);
  return (
    <li className={`group flex items-start gap-2.5 rounded-lg px-2 py-1.5 hover:bg-zinc-900/60 ${tag ? TAG_BORDER[tag] ?? '' : ''} ${tracked ? 'border-l-2 border-l-amber-400 bg-amber-500/[0.03]' : ''}`}>
      <Avatar src={item.user.profilePictureUrl} name={item.user.nickname} />
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-1.5">
          <Username user={item.user} className="text-xs font-semibold" />
          <UserBadges user={item.user} />
          {tracked && <span className="text-[10px] text-amber-400" title="Tracked">★</span>}
          <button
            onClick={() => (pinned ? unpinMessage(item.id) : pinMessage(item))}
            className="ml-auto hidden text-[10px] text-zinc-600 hover:text-like-400 group-hover:inline"
          >
            {pinned ? 'unpin' : 'pin'}
          </button>
          <span className="ml-auto flex-none text-[10px] tabular-nums text-zinc-600 group-hover:ml-0">{timeAgo(item.ts)}</span>
        </div>
        <div className="break-words text-[13px] text-zinc-100">{item.comment}</div>
      </div>
    </li>
  );
});

/** Full-width pink-tinted event row — joins, gifts, follows. */
const EventRow = memo(function EventRow({ item }: { item: FeedItem }) {
  const focusFanMemory = useUI((s) => s.focusFanMemory);
  if (item.type !== 'member' && item.type !== 'gift' && item.type !== 'follow') return null;
  const user = item.user;
  return (
    <li>
      <button
        onClick={() => focusFanMemory(user.uniqueId)}
        className="flex w-full items-center gap-2 rounded-lg border border-like-500/15 bg-like-500/[0.07] px-3 py-1.5 text-left transition hover:bg-like-500/[0.12]"
      >
        <span className="min-w-0 flex-1 truncate text-xs text-zinc-300">
          <span className="font-semibold text-like-400">{user.nickname}</span>
          {item.type === 'member' && ' just joined'}
          {item.type === 'follow' && ' followed the host'}
          {item.type === 'gift' && (
            <>
              {' sent '}
              <span className="font-semibold text-amber-300">
                {item.giftName} {GIFT_EMOJI[item.giftName] ?? '🎁'}{item.repeatCount > 1 ? ` x${item.repeatCount}` : ''}
              </span>
            </>
          )}
        </span>
        <span className="flex-none text-[10px] tabular-nums text-zinc-600">{timeAgo(item.ts)}</span>
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" className="flex-none text-like-400/70">
          <path d="M9 18l6-6-6-6" />
        </svg>
      </button>
    </li>
  );
});

/** Personal stream note — "Note to self" (never posted to TikTok). */
const NoteRow = memo(function NoteRow({ note }: { note: StreamNote }) {
  return (
    <li className="rounded-lg border border-dashed border-cyan-500/30 bg-cyan-500/[0.06] px-3 py-1.5">
      <div className="flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-wider text-cyan-400">
        📝 Note to self
        {note.syncedTo && <span className="normal-case tracking-normal text-cyan-500/70">· saved to @{note.syncedTo}</span>}
        <span className="ml-auto font-normal normal-case tracking-normal text-zinc-600">{timeAgo(note.ts)}</span>
      </div>
      <div className="mt-0.5 break-words text-[13px] text-zinc-200">{note.text}</div>
    </li>
  );
});

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
