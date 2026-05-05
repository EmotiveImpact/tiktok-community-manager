import { useEffect, useRef, useState } from 'react';
import { useStore } from '../state/store';
import { formatNumber, formatUptime } from '../lib/format';

export function StatsStrip() {
  const room = useStore((s) => s.roomInfo);
  const connectedAt = useStore((s) => s.connectedAt);
  const totalLikes = useStore((s) => s.totalLikes);
  const totalDiamonds = useStore((s) => s.totalDiamonds);
  const viewerCount = useStore((s) => s.viewerCount);
  const giftCount = useStore((s) => s.giftCount);
  const followCount = useStore((s) => s.followCount);
  const shareCount = useStore((s) => s.shareCount);
  const subscribeCount = useStore((s) => s.subscribeCount);
  const commentCount = useStore((s) => s.commentCount);
  const tpsFn = useStore((s) => s.tps);
  const [tps, setTps] = useState(0);
  const [, force] = useState(0);
  const lastLikes = useRef(totalLikes);
  const heartRef = useRef<HTMLSpanElement | null>(null);

  useEffect(() => {
    const t = setInterval(() => {
      setTps(tpsFn());
      force((n) => n + 1);
    }, 500);
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
  const uptime = connectedAt ? formatUptime(Date.now() - connectedAt) : null;

  return (
    <div className="flex items-center gap-4 border-b border-zinc-800/60 bg-zinc-950/60 px-4 py-2">
      {/* Host capsule */}
      <div className="flex items-center gap-2 min-w-0">
        {room.hostAvatar ? (
          <img src={room.hostAvatar} alt="" className="h-7 w-7 flex-none rounded-full bg-zinc-800 object-cover ring-1 ring-like-500/30" />
        ) : (
          <div className="avatar-gradient-pink flex h-7 w-7 flex-none items-center justify-center rounded-full text-xs font-bold text-white ring-1 ring-like-500/30">
            {room.hostNickname.charAt(0).toUpperCase()}
          </div>
        )}
        <div className="min-w-0">
          <button
            onClick={() => window.tiktok.openProfile(room.hostUniqueId)}
            className="block truncate text-xs font-bold text-zinc-100 hover:text-like-400"
          >
            {room.hostNickname}
          </button>
          {uptime && (
            <div className="flex items-center gap-1 text-[10px] text-zinc-500 tabular-nums">
              <span className="h-1 w-1 animate-pulse rounded-full bg-like-500" />
              {uptime}
            </div>
          )}
        </div>
      </div>

      <div className="h-6 w-px bg-zinc-800" />

      {/* Live stats */}
      <Stat icon="♥" value={formatNumber(totalLikes)} sub={tps > 0 ? `+${tps.toFixed(1)}/s` : null} accent="text-like-400" iconRef={heartRef} />
      <Stat icon="👁" value={formatNumber(viewerCount)} sub="viewers" accent="text-zinc-100" />
      <Stat icon="💬" value={formatNumber(commentCount)} sub="comments" accent="text-zinc-100" />
      <Stat icon="💎" value={formatNumber(totalDiamonds)} sub={`${giftCount} gifts`} accent="text-amber-300" />
      {followCount > 0 && <Stat icon="+" value={formatNumber(followCount)} sub="follows" accent="text-blue-300" />}
      {subscribeCount > 0 && <Stat icon="★" value={formatNumber(subscribeCount)} sub="subs" accent="text-fuchsia-300" />}
      {shareCount > 0 && <Stat icon="↗" value={formatNumber(shareCount)} sub="shares" accent="text-emerald-300" />}

      {room.followerCount > 0 && (
        <>
          <div className="h-6 w-px bg-zinc-800" />
          <div className="text-[10px] text-zinc-500">
            <span className="text-sm font-bold text-zinc-300 tabular-nums">{formatNumber(room.followerCount)}</span> total followers
          </div>
        </>
      )}
    </div>
  );
}

function Stat({
  icon,
  value,
  sub,
  accent,
  iconRef,
}: {
  icon: string;
  value: string;
  sub?: string | null;
  accent: string;
  iconRef?: React.RefObject<HTMLSpanElement | null>;
}) {
  return (
    <div className="flex items-baseline gap-1.5">
      <span ref={iconRef as React.RefObject<HTMLSpanElement>} className={`text-sm ${accent}`}>{icon}</span>
      <span className={`text-sm font-bold tabular-nums ${accent}`}>{value}</span>
      {sub && <span className="text-[10px] text-zinc-500">{sub}</span>}
    </div>
  );
}
