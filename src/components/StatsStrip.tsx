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
  const heartRef = useRef<HTMLImageElement | null>(null);

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
    <div className="flex items-stretch gap-2 overflow-x-auto border-b border-zinc-800/60 bg-zinc-950/60 px-3 py-2">
      {/* Host capsule */}
      <div className="glass brand-top-border flex min-w-0 flex-none items-center gap-2.5 !rounded-xl px-3 py-1.5">
        {room.hostAvatar ? (
          <img src={room.hostAvatar} alt="" className="h-8 w-8 flex-none rounded-full bg-zinc-800 object-cover ring-2 ring-like-500/40" />
        ) : (
          <div className="avatar-gradient-pink flex h-8 w-8 flex-none items-center justify-center rounded-full text-xs font-bold text-white ring-2 ring-like-500/40">
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
              <span className="rounded-full bg-like-500 px-1.5 py-px text-[8px] font-extrabold tracking-widest text-white">LIVE</span>
              {uptime}
            </div>
          )}
        </div>
      </div>

      <StatCard icon="icon_heart_3d" value={formatNumber(totalLikes)} label={tps > 0 ? `+${tps.toFixed(1)}/s likes` : 'likes'} iconRef={heartRef} />
      <StatCard icon="icon_group_3d" value={formatNumber(viewerCount)} label="viewers" />
      <StatCard icon="icon_thank_you_envelope_3d" value={formatNumber(commentCount)} label="comments" />
      <StatCard icon="icon_diamond_3d" value={formatNumber(totalDiamonds)} label="diamonds" />
      <StatCard icon="icon_gift_box_3d" value={formatNumber(giftCount)} label="gifts" />
      {followCount > 0 && <StatCard icon="icon_star_award_3d" value={formatNumber(followCount)} label="follows" />}
      {subscribeCount > 0 && <StatCard icon="icon_crown_3d" value={formatNumber(subscribeCount)} label="subs" />}
      {shareCount > 0 && <StatCard icon="icon_clock_3d" value={formatNumber(shareCount)} label="shares" />}

      {room.followerCount > 0 && (
        <div className="ml-auto flex flex-none items-center self-center pl-1 text-[10px] text-zinc-500">
          <span className="mr-1 text-sm font-bold text-zinc-300 tabular-nums">{formatNumber(room.followerCount)}</span> total followers
        </div>
      )}
    </div>
  );
}

function StatCard({
  icon,
  value,
  label,
  iconRef,
}: {
  icon: string;
  value: string;
  label: string;
  iconRef?: React.RefObject<HTMLImageElement | null>;
}) {
  return (
    <div className="glass brand-top-border flex flex-none items-center gap-2 !rounded-xl px-3 py-1.5">
      <img
        ref={iconRef as React.RefObject<HTMLImageElement>}
        src={`./assets/png/${icon}.png`}
        alt=""
        className="h-7 w-7 flex-none object-contain"
        draggable={false}
      />
      <div className="leading-tight">
        <div className="text-sm font-extrabold tabular-nums text-zinc-100">{value}</div>
        <div className="text-[10px] font-medium text-zinc-500">{label}</div>
      </div>
    </div>
  );
}
