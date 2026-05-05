import { useEffect, useRef, useState } from 'react';
import Hls from 'hls.js';
import { useStore } from '../state/store';
import { formatNumber } from '../lib/format';

type ViewMode = 'hls' | 'mobile';

export function StreamPlayer({ onClose }: { onClose: () => void }) {
  const room = useStore((s) => s.roomInfo);
  const viewerCount = useStore((s) => s.viewerCount);
  const totalLikes = useStore((s) => s.totalLikes);
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const hlsRef = useRef<Hls | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [muted, setMuted] = useState(true);
  const hasHls = !!room?.hlsUrl;
  const [mode, setMode] = useState<ViewMode>(hasHls ? 'hls' : 'mobile');

  useEffect(() => {
    if (mode !== 'hls') return;
    const url = room?.hlsUrl;
    setError(null);
    if (!url) return;

    const video = videoRef.current;
    if (!video) return;

    const cleanup = () => {
      if (hlsRef.current) {
        hlsRef.current.destroy();
        hlsRef.current = null;
      }
    };
    cleanup();

    if (Hls.isSupported()) {
      const hls = new Hls({ lowLatencyMode: true });
      hlsRef.current = hls;
      hls.loadSource(url);
      hls.attachMedia(video);
      hls.on(Hls.Events.ERROR, (_e, data) => {
        if (data.fatal) {
          setError(
            `Playback error: ${data.type} / ${data.details}. TikTok stream URLs are sometimes referer-locked.`,
          );
        }
      });
      video.play().catch(() => {});
    } else if (video.canPlayType('application/vnd.apple.mpegurl')) {
      video.src = url;
      video.play().catch(() => {});
    } else {
      setError('HLS playback not supported in this Electron build.');
    }

    return cleanup;
  }, [room?.hlsUrl, mode]);

  if (!room) return null;

  const liveUrl = `https://www.tiktok.com/@${encodeURIComponent(room.hostUniqueId)}/live`;

  return (
    <aside className="glass flex h-full w-[390px] flex-none flex-col border-l border-zinc-800/50">
      <header className="flex items-center gap-2 border-b border-zinc-800/50 px-3 py-2">
        <div className="flex rounded-lg border border-zinc-800 bg-zinc-900 p-0.5">
          {hasHls && (
            <button
              onClick={() => setMode('hls')}
              className={`rounded-md px-2.5 py-1 text-[11px] font-medium transition ${mode === 'hls' ? 'bg-zinc-700 text-zinc-100' : 'text-zinc-500 hover:text-zinc-300'}`}
            >
              HLS
            </button>
          )}
          <button
            onClick={() => setMode('mobile')}
            className={`rounded-md px-2.5 py-1 text-[11px] font-medium transition ${mode === 'mobile' ? 'bg-zinc-700 text-zinc-100' : 'text-zinc-500 hover:text-zinc-300'}`}
          >
            Mobile
          </button>
        </div>
        <span className="ml-auto inline-flex items-center gap-1 rounded-full bg-like-500/15 px-2 py-0.5 text-[10px] font-semibold text-like-400">
          <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-like-500" />
          LIVE
        </span>
        {mode === 'hls' && hasHls && (
          <button
            onClick={() => {
              const v = videoRef.current;
              if (v) {
                v.muted = !v.muted;
                setMuted(v.muted);
              }
            }}
            className="rounded-md px-2 py-0.5 text-xs text-zinc-400 hover:bg-zinc-800"
          >
            {muted ? 'Unmute' : 'Mute'}
          </button>
        )}
        <button
          onClick={onClose}
          className="rounded-md px-2 py-0.5 text-xs text-zinc-400 hover:bg-zinc-800"
        >
          ✕
        </button>
      </header>

      <div className="relative flex-1 overflow-hidden bg-black">
        {mode === 'hls' && hasHls ? (
          error ? (
            <div className="flex h-full items-center justify-center p-4 text-center text-xs text-zinc-500">
              {error}
            </div>
          ) : (
            <video
              ref={videoRef}
              className="h-full w-full object-contain"
              autoPlay
              muted={muted}
              playsInline
              controls
            />
          )
        ) : (
          <webview
            src={liveUrl}
            className="h-full w-full"
            partition="persist:tiktok"
            useragent="Mozilla/5.0 (iPhone; CPU iPhone OS 17_4 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Mobile/15E148 Safari/604.1"
            // @ts-expect-error allowpopups is a valid webview attribute
            allowpopups="true"
          />
        )}

        {mode === 'hls' && (
          <div className="absolute bottom-3 left-3 right-3 flex gap-2">
            <div className="flex-1 rounded-lg bg-black/60 px-2 py-1.5 text-center backdrop-blur-sm">
              <div className="text-sm font-bold tabular-nums text-white">{formatNumber(viewerCount)}</div>
              <div className="text-[9px] uppercase text-white/50">Viewers</div>
            </div>
            <div className="flex-1 rounded-lg bg-black/60 px-2 py-1.5 text-center backdrop-blur-sm">
              <div className="text-sm font-bold tabular-nums text-like-400">{formatNumber(totalLikes)}</div>
              <div className="text-[9px] uppercase text-white/50">Likes</div>
            </div>
          </div>
        )}
      </div>
    </aside>
  );
}
