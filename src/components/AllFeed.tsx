import { useStore } from '../state/store';
import { timeAgo } from '../lib/format';

export function AllFeed() {
  const all = useStore((s) => s.all);

  if (all.length === 0) {
    return (
      <div className="flex h-full items-center justify-center text-sm text-zinc-600">
        Waiting for events…
      </div>
    );
  }

  return (
    <ul className="flex flex-col gap-0.5 p-3 text-sm">
      {all.map((e) => (
        <li key={e.id} className="flex items-baseline gap-2 rounded-lg px-2 py-1 transition hover:bg-zinc-900/60">
          <span className="w-12 flex-none text-[10px] tabular-nums text-zinc-600">
            {timeAgo(e.ts)}
          </span>
          <span className="w-16 flex-none text-xs">
            <Badge type={e.type} />
          </span>
          <span className="min-w-0 flex-1 truncate text-zinc-300">{describe(e)}</span>
        </li>
      ))}
    </ul>
  );
}

function describe(e: ReturnType<typeof useStore.getState>['all'][number]): string {
  switch (e.type) {
    case 'like':
      return `${e.user.nickname} sent ${e.likeCount} like${e.likeCount > 1 ? 's' : ''}`;
    case 'chat':
      return `${e.user.nickname}: ${e.comment}`;
    case 'gift':
      return `${e.user.nickname} sent ${e.giftName}${e.repeatCount > 1 ? ` ×${e.repeatCount}` : ''}`;
    case 'follow':
      return `${e.user.nickname} followed`;
    case 'share':
      return `${e.user.nickname} shared`;
    case 'subscribe':
      return `${e.user.nickname} subscribed`;
    case 'member':
      return `${e.user.nickname} joined`;
    case 'roomUser':
      return `viewers: ${e.viewerCount}`;
    case 'streamEnd':
      return `stream ended`;
    case 'roomInfo':
      return `room: ${e.info.title || e.info.hostNickname}`;
    case 'questionNew':
      return `${e.user.nickname} asked: ${e.question}`;
    case 'envelope':
      return `${e.user.nickname} sent an envelope (${e.coins} coins)`;
    case 'emote':
      return `${e.user.nickname} sent an emote`;
    case 'linkMicBattle':
      return `link-mic battle started (${e.armies.length} streamers)`;
    case 'caption':
      return `🎙️ ${e.text}`;
  }
}

const tones: Record<string, string> = {
  like: 'bg-like-500/15 text-like-400',
  chat: 'bg-zinc-700/40 text-zinc-300',
  gift: 'bg-amber-500/15 text-amber-300',
  follow: 'bg-blue-500/15 text-blue-300',
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
