/**
 * Live stat block — sits in the LIVE right rail (above Fan Memory).
 * Host identity (avatar w/ pink ring, name, title line) + a compact 2x2 grid
 * of session counters. Only renders while connected to a room.
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
    <section className="glass brand-top-border flex w-full flex-none flex-col rounded-[18px] p-4">
      {/* Host identity */}
      <div className="flex items-center gap-2.5">
        {room.hostAvatar ? (
          <img src={room.hostAvatar} alt="" className="h-10 w-10 flex-none rounded-full bg-zinc-800 object-cover ring-2 ring-like-500" />
        ) : (
          <div className="avatar-gradient-pink flex h-10 w-10 flex-none items-center justify-center rounded-full text-sm font-bold text-white ring-2 ring-like-500">
            {room.hostNickname.charAt(0).toUpperCase()}
          </div>
        )}
        <div className="min-w-0 flex-1 leading-tight">
          <button
            onClick={() => window.tiktok.openProfile(room.hostUniqueId)}
            className="flex w-full items-center gap-1 truncate text-[13px] font-bold text-zinc-100 hover:text-like-400"
          >
            <span className="truncate">{room.hostNickname}</span>
            <VerifiedBadge />
          </button>
          <div className="truncate text-[11px] text-zinc-500">
            {room.title || `@${room.hostUniqueId}`}
          </div>
        </div>
      </div>

      {room.followerCount > 0 && (
        <div className="mt-2 flex items-baseline gap-1 text-[10px] text-zinc-500">
          <span className="text-sm font-bold tabular-nums text-zinc-300">{formatNumber(room.followerCount)}</span>
          total followers
        </div>
      )}

      {/* Counters — 2-column grid so it reads well in a narrow rail. */}
      <div className="mt-3 grid grid-cols-2 gap-2">
        <Stat iconRef={heartRef} icon="❤️" tone="text-like-400" value={formatNumber(totalLikes)} label={tps > 0 ? `Likes · +${tps.toFixed(1)}/s` : 'Likes'} />
        <Stat icon="👁" tone="text-cyan-400" value={formatNumber(viewerCount)} label="Viewers" />
        <Stat icon="💬" tone="text-zinc-300" value={formatNumber(commentCount)} label="Comments" />
        <Stat icon="🎁" tone="text-amber-300" value={formatNumber(giftCount)} label="Gifts" />
        <Stat icon="💎" tone="text-purple-400" value={formatNumber(totalDiamonds)} label="Diamonds" />
        {followCount > 0 && <Stat icon="⭐" tone="text-emerald-400" value={formatNumber(followCount)} label="Follows" />}
      </div>
    </section>
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
    <div className="flex items-center gap-2 rounded-xl border border-zinc-800/50 bg-zinc-900/40 px-2.5 py-2">
      <span ref={iconRef as React.RefObject<HTMLSpanElement>} className={`text-base leading-none ${tone}`}>{icon}</span>
      <span className="min-w-0 leading-tight">
        <span className="block truncate text-sm font-bold tabular-nums text-zinc-100">{value}</span>
        <span className="block truncate text-[10px] text-zinc-500">{label}</span>
      </span>
    </div>
  );
}
