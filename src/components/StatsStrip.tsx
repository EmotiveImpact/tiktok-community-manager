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
  const subscribeCount = useStore((s) => s.subscribeCount);
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
    <section className="glass brand-top-border flex w-full flex-none flex-col rounded-[var(--radius-card)] p-4">
      {/* Host identity */}
      <div className="flex items-center gap-3">
        {room.hostAvatar ? (
          <img src={room.hostAvatar} alt="" className="h-11 w-11 flex-none rounded-full bg-zinc-800 object-cover ring-2 ring-like-500 ring-offset-2 ring-offset-[var(--card)]" />
        ) : (
          <div className="avatar-gradient-pink flex h-11 w-11 flex-none items-center justify-center rounded-full text-base font-bold text-white ring-2 ring-like-500 ring-offset-2 ring-offset-[var(--card)]">
            {room.hostNickname.charAt(0).toUpperCase()}
          </div>
        )}
        <div className="min-w-0 flex-1 leading-tight">
          <button
            onClick={() => window.tiktok.openProfile(room.hostUniqueId)}
            className="flex w-full items-center gap-1 text-[14px] font-bold text-zinc-100 hover:text-like-400"
          >
            <span className="truncate">{room.hostNickname}</span>
            <VerifiedBadge />
          </button>
          <div className="truncate text-[11px] text-zinc-500">
            @{room.hostUniqueId}
          </div>
        </div>
      </div>

      {room.followerCount > 0 && (
        <div className="mt-3 flex items-baseline gap-1.5 border-t border-[var(--separator)] pt-2.5 text-[10px] uppercase tracking-wide text-zinc-500">
          <span className="text-[15px] font-extrabold normal-case tracking-normal tabular-nums text-zinc-200">{formatNumber(room.followerCount)}</span>
          <span className="translate-y-px">followers</span>
        </div>
      )}

      {/* Counters — 2-column grid so it reads well in a narrow rail. */}
      <div className="mt-3 grid grid-cols-2 gap-2">
        <Stat iconRef={heartRef} icon="❤️" tint="tint-like" value={formatNumber(totalLikes)} label={tps > 0 ? `Likes · +${tps.toFixed(1)}/s` : 'Likes'} />
        <Stat icon="👁" tint="tint-cyan" value={formatNumber(viewerCount)} label="Viewers" />
        <Stat icon="💬" tint="tint-comment" value={formatNumber(commentCount)} label="Comments" />
        <Stat icon="🎁" tint="tint-amber" value={formatNumber(giftCount)} label="Gifts" />
        <Stat icon="💎" tint="tint-cyan" value={formatNumber(totalDiamonds)} label="Diamonds" />
        {followCount > 0 && <Stat icon="⭐" tint="tint-emerald" value={formatNumber(followCount)} label="Follows" />}
        {subscribeCount > 0 && <Stat icon="👑" tint="tint-amber" value={formatNumber(subscribeCount)} label="Subs" />}
      </div>
    </section>
  );
}

function Stat({
  icon,
  tint,
  value,
  label,
  iconRef,
}: {
  icon: string;
  tint: string;
  value: string;
  label: string;
  iconRef?: React.RefObject<HTMLSpanElement | null>;
}) {
  return (
    <div className="stat-cell">
      <span
        ref={iconRef as React.RefObject<HTMLSpanElement>}
        className={`stat-cell__icon ${tint}`}
      >
        {icon}
      </span>
      <span className="min-w-0 flex-1">
        <span className="stat-cell__value">{value}</span>
        <span className="stat-cell__label">{label}</span>
      </span>
    </div>
  );
}
