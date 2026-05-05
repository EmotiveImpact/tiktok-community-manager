import { useEffect, useState } from 'react';
import { useStore } from '../state/store';
import { formatNumber, formatUptime } from '../lib/format';

export function HostBanner() {
  const room = useStore((s) => s.roomInfo);
  const connectedAt = useStore((s) => s.connectedAt);
  const followerCount = room?.followerCount ?? 0;
  const [, force] = useState(0);

  useEffect(() => {
    if (!connectedAt) return;
    const t = setInterval(() => force((n) => n + 1), 1000);
    return () => clearInterval(t);
  }, [connectedAt]);

  if (!room) return null;
  const uptime = connectedAt ? formatUptime(Date.now() - connectedAt) : null;

  return (
    <div className="glass relative flex flex-none items-center gap-3 overflow-hidden rounded-xl p-3">
      <div className="pointer-events-none absolute inset-0 bg-gradient-to-br from-like-500/10 to-transparent" />
      <div className="relative flex flex-1 items-center gap-3 min-w-0">
        {room.hostAvatar ? (
          <img
            src={room.hostAvatar}
            alt=""
            className="h-11 w-11 flex-none rounded-full bg-zinc-800 object-cover ring-2 ring-like-500/30"
          />
        ) : (
          <div className="avatar-gradient-pink flex h-11 w-11 flex-none items-center justify-center rounded-full text-base font-bold text-white ring-2 ring-like-500/30">
            {room.hostNickname.charAt(0).toUpperCase()}
          </div>
        )}
        <div className="min-w-0 flex-1">
          <button
            onClick={() => window.tiktok.openProfile(room.hostUniqueId)}
            className="block max-w-full truncate text-sm font-bold text-zinc-100 hover:text-like-400"
            title={`Open @${room.hostUniqueId} on TikTok`}
          >
            {room.hostNickname}
          </button>
          <div className="truncate text-[11px] text-zinc-500">@{room.hostUniqueId}</div>
          {uptime && (
            <div className="mt-1 inline-flex items-center gap-1 rounded-full bg-like-500/15 px-1.5 py-0.5 text-[10px] font-semibold text-like-400">
              <span className="h-1 w-1 animate-pulse rounded-full bg-like-500" />
              LIVE {uptime}
            </div>
          )}
        </div>
        {followerCount > 0 && (
          <div className="flex-none text-right">
            <div className="text-sm font-bold tabular-nums text-zinc-100">{formatNumber(followerCount)}</div>
            <div className="text-[9px] uppercase tracking-wider text-zinc-500">Followers</div>
          </div>
        )}
      </div>
    </div>
  );
}
