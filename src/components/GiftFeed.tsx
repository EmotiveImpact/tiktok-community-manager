import { memo, useMemo } from 'react';
import { useStore } from '../state/store';
import { useModeration } from '../state/moderation';
import { timeAgo, formatNumber } from '../lib/format';
import { avatarGradient } from '../lib/avatars';
import { Username } from './Username';

type GiftEvent = ReturnType<typeof useStore.getState>['gifts'][number];

/** Cap rendered gift rows — store keeps up to FEED_MAX but the DOM only needs a
 *  screenful of scrollback. Avatars make uncapped rendering especially costly. */
const RENDER_MAX = 200;

export function GiftFeed() {
  const gifts = useStore((s) => s.gifts);
  const isFiltered = useModeration((s) => s.isFiltered);

  // Filter blocked gifters + cap once, instead of running isFiltered per row on
  // every event. Mirrors CommentFeed's capped, memoized slice.
  const rows = useMemo(() => {
    const items: Extract<GiftEvent, { type: 'gift' }>[] = [];
    for (const g of gifts) {
      if (items.length >= RENDER_MAX) break;
      if (g.type !== 'gift') continue;
      if (isFiltered(g.user.uniqueId)) continue;
      items.push(g);
    }
    return items;
  }, [gifts, isFiltered]);

  if (gifts.length === 0) {
    return (
      <div className="flex h-full items-center justify-center text-sm text-zinc-600">
        No gifts yet
      </div>
    );
  }

  return (
    <ul
      className="flex flex-col gap-1.5 p-3"
      role="log"
      aria-live="polite"
      aria-relevant="additions"
      aria-label="Gift feed"
    >
      {rows.map((g) => (
        <GiftRow key={g.id} gift={g} />
      ))}
    </ul>
  );
}

const GiftRow = memo(function GiftRow({ gift: g }: { gift: Extract<GiftEvent, { type: 'gift' }> }) {
  const total = g.diamondCount * g.repeatCount;
  return (
    <li className="flex items-center gap-3 rounded-lg border border-amber-500/10 bg-amber-500/5 px-3 py-2">
      {g.user.profilePictureUrl ? (
        <img src={g.user.profilePictureUrl} alt="" className="h-7 w-7 flex-none rounded-full bg-zinc-800 object-cover" />
      ) : (
        <div className={`flex h-7 w-7 flex-none items-center justify-center rounded-full text-[11px] font-bold text-white ${avatarGradient(g.user.nickname)}`}>
          {g.user.nickname.charAt(0).toUpperCase()}
        </div>
      )}
      <div className="min-w-0 flex-1">
        <div className="flex items-baseline gap-2">
          <Username user={g.user} className="text-xs font-semibold" />
          <span className="text-[10px] text-zinc-500">{timeAgo(g.ts)}</span>
        </div>
        <div className="text-xs text-zinc-400">
          sent <span className="font-semibold text-amber-300">{g.giftName}</span>
          {g.repeatCount > 1 && <span className="text-amber-300"> ×{g.repeatCount}</span>}
        </div>
      </div>
      <div className="text-right">
        <div className="text-sm font-bold tabular-nums text-amber-300">
          {formatNumber(total)}
        </div>
        <div className="text-[10px] text-zinc-500">💎</div>
      </div>
    </li>
  );
});
