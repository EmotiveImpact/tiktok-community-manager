/**
 * Host strip — appears under the top bar on the LIVE view.
 * Host identity (avatar w/ pink ring, name, bio line) + inline session stats.
 */
import { useEffect, useRef, useState } from 'react';
import { useStore } from '../state/store';
import { formatNumber } from '../lib/format';
import { VerifiedBadge } from './Username';

export function StatsStrip() {
  const room = useStore((s) => s.roomInfo);
  const totalLikes = useStore((s) => s.totalLikes);
  const totalDiamonds = useStore((s) => s.totalDiamonds);
  const viewerCount = useStore((s) => s.viewerCount);
  const giftCount = useStore((s) => s.giftCount);
  const followCount = useStore((s) => s.followCount);
  const commentCount = useStore((s) => s.commentCount);
  const tpsFn = useStore((s) => s.tps);
  const [tps, setTps] = useState(0);
  const lastLikes = useRef(totalLikes);
  const heartRef = useRef<HTMLSpanElement | null>(null);

  useEffect(() => {
    const t = setInterval(() => setTps(tpsFn()), 1000);
    return () => clearInterval(t);
  }, [tpsFn]);

  useEffect(() => {
    if (totalLikes !== lastLikes.current && heartRef.current) {
      heartRef.current.classList.remove('pop');
      void heartRef.current.offsetWidth;
      heartRef.current.classList.add('pop');
      lastLikes.current = totalLikes;
    }
  }, [totalLikes]);

  if (!room) return null;

  return (
    <div className="flex flex-none items-center gap-3 overflow-x-auto border-b border-zinc-800/60 bg-zinc-950/60 px-4 py-2">
      {/* Host identity */}
      {room.hostAvatar ? (
        <img src={room.hostAvatar} alt="" className="h-9 w-9 flex-none rounded-full bg-zinc-800 object-cover ring-2 ring-like-500" />
      ) : (
        <div className="avatar-gradient-pink flex h-9 w-9 flex-none items-center justify-center rounded-full text-sm font-bold text-white ring-2 ring-like-500">
          {room.hostNickname.charAt(0).toUpperCase()}
        </div>
      )}
      <div className="min-w-0 flex-none leading-tight">
        <button
          onClick={() => window.tiktok.openProfile(room.hostUniqueId)}
          className="flex max-w-[220px] items-center gap-1 truncate text-[13px] font-bold text-zinc-100 hover:text-like-400"
        >
          <span className="truncate">{room.hostNickname}</span>
          <VerifiedBadge />
        </button>
        <div className="max-w-[260px] truncate text-[11px] text-zinc-500">
          {room.title || `@${room.hostUniqueId}`}
        </div>
      </div>

      <div className="mx-1 h-6 w-px flex-none bg-zinc-800" />

      {/* Inline stats */}
      <div className="flex flex-none items-center gap-4 text-xs">
        <Stat iconRef={heartRef} icon="❤️" tone="text-like-400" value={formatNumber(totalLikes)} label={tps > 0 ? `Likes · +${tps.toFixed(1)}/s` : 'Likes'} />
        <Stat icon="👁" tone="text-cyan-400" value={formatNumber(viewerCount)} label="Viewers" />
        <Stat icon="💬" tone="text-zinc-300" value={formatNumber(commentCount)} label="Comments" />
        <Stat icon="💎" tone="text-purple-400" value={formatNumber(totalDiamonds)} label="Diamonds" />
        <Stat icon="🎁" tone="text-amber-300" value={formatNumber(giftCount)} label="Gifts" />
        {followCount > 0 && <Stat icon="⭐" tone="text-emerald-400" value={formatNumber(followCount)} label="Follows" />}
      </div>

      {room.followerCount > 0 && (
        <div className="ml-auto flex flex-none items-center pl-2 text-[10px] text-zinc-500">
          <span className="mr-1 text-sm font-bold tabular-nums text-zinc-300">{formatNumber(room.followerCount)}</span> total followers
        </div>
      )}
    </div>
  );
}

function Stat({
  icon,
  tone,
  value,
  label,
  iconRef,
}: {
  icon: string;
  tone: string;
  value: string;
  label: string;
  iconRef?: React.RefObject<HTMLSpanElement | null>;
}) {
  return (
    <span className="inline-flex items-center gap-1.5 whitespace-nowrap">
      <span ref={iconRef as React.RefObject<HTMLSpanElement>} className={`text-sm ${tone}`}>{icon}</span>
      <span className="font-bold tabular-nums text-zinc-100">{value}</span>
      <span className="text-zinc-500">{label}</span>
    </span>
  );
}
