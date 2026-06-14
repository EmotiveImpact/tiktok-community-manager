import { memo, useMemo } from 'react';
import { useStore } from '../state/store';
import { useModeration } from '../state/moderation';
import { timeAgo } from '../lib/format';
import { Username } from './Username';

type AllEvent = ReturnType<typeof useStore.getState>['all'][number];

/** Cap how many rows we ever render — the store keeps up to FEED_MAX (5000) but
 *  the DOM never needs more than a screenful of scrollback to stay smooth. */
const RENDER_MAX = 200;

export function AllFeed() {
  const all = useStore((s) => s.all);
  const isFiltered = useModeration((s) => s.isFiltered);

  // Filter + cap once per relevant change instead of re-running isFiltered per
  // row on every single event. Mirrors CommentFeed's capped, memoized slice.
  const rows = useMemo(() => {
    const items: AllEvent[] = [];
    for (const e of all) {
      if (items.length >= RENDER_MAX) break;
      if ('user' in e && isFiltered(e.user.uniqueId, e.type === 'chat' ? e.comment : undefined)) {
        continue;
      }
      items.push(e);
    }
    return items;
  }, [all, isFiltered]);

  if (all.length === 0) {
    return (
      <div className="flex h-full items-center justify-center text-sm text-zinc-600">
        Waiting for events…
      </div>
    );
  }

  return (
    <ul
      className="flex flex-col gap-0.5 p-3 text-sm"
      role="log"
      aria-live="polite"
      aria-relevant="additions"
      aria-label="Live event feed"
    >
      {rows.map((e) => (
        <AllRow key={e.id} event={e} />
      ))}
    </ul>
  );
}

const AllRow = memo(function AllRow({ event }: { event: AllEvent }) {
  return (
    <li className="flex items-baseline gap-2 rounded-lg px-2 py-1 transition hover:bg-zinc-900/60">
      <span className="w-12 flex-none text-[10px] tabular-nums text-zinc-600">
        {timeAgo(event.ts)}
      </span>
      <span className="w-16 flex-none text-xs">
        <Badge type={event.type} />
      </span>
      <span className="flex min-w-0 flex-1 items-baseline gap-1 truncate text-zinc-300">
        {'user' in event && <Username user={event.user} className="text-[13px] font-semibold" />}
        <span className="min-w-0 truncate">{describe(event)}</span>
      </span>
    </li>
  );
});

/** Event description, *excluding* the username (rendered separately as a clickable <Username>). */
function describe(e: AllEvent): string {
  switch (e.type) {
    case 'like':
      return `sent ${e.likeCount} like${e.likeCount > 1 ? 's' : ''}`;
    case 'chat':
      return `: ${e.comment}`;
    case 'gift':
      return `sent ${e.giftName}${e.repeatCount > 1 ? ` ×${e.repeatCount}` : ''}`;
    case 'follow':
      return `followed`;
    case 'share':
      return `shared`;
    case 'subscribe':
      return `subscribed`;
    case 'member':
      return `joined`;
    case 'roomUser':
      return `viewers: ${e.viewerCount}`;
    case 'streamEnd':
      return `stream ended`;
    case 'roomInfo':
      return `room: ${e.info.title || e.info.hostNickname}`;
    case 'questionNew':
      return `asked: ${e.question}`;
    case 'envelope':
      return `sent an envelope (${e.coins} coins)`;
    case 'emote':
      return `sent an emote`;
    case 'linkMicBattle':
      return `link-mic battle started (${e.armies.length} streamers)`;
    case 'caption':
      return `🎙️ ${e.text}`;
    case 'streamMeta':
      // streamMeta is session metadata, not a feed row — never rendered here,
      // but the case keeps the switch exhaustive over the LiveEvent union.
      return `stream metadata updated`;
  }
}

const tones: Record<string, string> = {
  like: 'bg-like-500/15 text-like-400',
  chat: 'bg-zinc-700/40 text-zinc-300',
  gift: 'bg-amber-500/15 text-amber-300',
  follow: 'bg-cyan-500/15 text-cyan-400',
  share: 'bg-violet-500/15 text-violet-300',
  subscribe: 'bg-purple-500/15 text-purple-300',
  member: 'bg-emerald-500/10 text-emerald-300',
  roomUser: 'bg-zinc-800/60 text-zinc-400',
  streamEnd: 'bg-rose-500/15 text-rose-300',
};

function Badge({ type }: { type: string }) {
  return (
    <span className={`rounded-md px-1.5 py-0.5 text-[10px] font-semibold uppercase ${tones[type] ?? ''}`}>
      {type}
    </span>
  );
}
