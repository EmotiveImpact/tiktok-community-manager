import { useEffect, useRef, useState } from 'react';
import Hls from 'hls.js';
import { useStore } from '../state/store';
import { formatNumber } from '../lib/format';
import { avatarGradient } from '../lib/avatars';

type ViewMode = 'hls' | 'mobile';

export function StreamPlayer({ onClose }: { onClose: () => void }) {
  const room = useStore((s) => s.roomInfo);
  const viewerCount = useStore((s) => s.viewerCount);
  const totalLikes = useStore((s) => s.totalLikes);
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const hlsRef = useRef<Hls | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [muted, setMuted] = useState(true);
  const [paused, setPaused] = useState(false);
  const [reloadKey, setReloadKey] = useState(0);
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
  }, [room?.hlsUrl, mode, reloadKey]);

  if (!room) return null;

  const liveUrl = `https://www.tiktok.com/@${encodeURIComponent(room.hostUniqueId)}/live`;

  const togglePause = () => {
    const v = videoRef.current;
    if (!v) return;
    if (v.paused) { v.play().catch(() => {}); setPaused(false); }
    else { v.pause(); setPaused(true); }
  };

  const togglePip = async () => {
    const v = videoRef.current;
    if (!v) return;
    try {
      if (document.pictureInPictureElement) await document.exitPictureInPicture();
      else await v.requestPictureInPicture();
    } catch { /* unsupported */ }
  };

  const toggleMute = () => {
    const v = videoRef.current;
    if (v) {
      v.muted = !v.muted;
      setMuted(v.muted);
    }
  };

  return (
    <aside className="flex h-full w-[390px] flex-none flex-col p-0">
      {/* Phone-frame card */}
      <div className="glass flex h-full flex-col overflow-hidden !rounded-2xl border border-zinc-800/60">
        {/* Frame header */}
        <header className="flex flex-none items-center gap-2 border-b border-zinc-800/50 px-3 py-2">
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
              📱 Mobile
            </button>
          </div>
          <span className="ml-auto inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-bold text-white shadow-[0_2px_8px_rgba(238,29,82,0.4)]" style={{ background: 'var(--brand-pink)' }}>
            <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-white" />
            LIVE
          </span>
          <button
            onClick={onClose}
            className="rounded-md px-2 py-0.5 text-xs text-zinc-400 hover:bg-zinc-800"
            title="Close player"
          >
            ✕
          </button>
        </header>

        {/* TikTok-style host header */}
        <div className="flex flex-none items-center gap-2 border-b border-zinc-800/50 bg-black/40 px-3 py-2">
          {room.hostAvatar ? (
            <img src={room.hostAvatar} alt="" className="h-7 w-7 flex-none rounded-full object-cover ring-1 ring-like-500/60" />
          ) : (
            <div className={`flex h-7 w-7 flex-none items-center justify-center rounded-full text-[11px] font-bold text-white ${avatarGradient(room.hostNickname)}`}>
              {room.hostNickname.charAt(0).toUpperCase()}
            </div>
          )}
          <div className="min-w-0 flex-1 leading-tight">
            <div className="truncate text-xs font-bold text-zinc-100">{room.hostNickname}</div>
            <div className="truncate text-[10px] text-zinc-500">@{room.hostUniqueId}</div>
          </div>
          <span className="flex-none text-[11px] tabular-nums text-zinc-400">❤ {formatNumber(totalLikes)}</span>
          <span className="flex-none text-[11px] tabular-nums text-zinc-400">👁 {formatNumber(viewerCount)}</span>
        </div>

        {/* Video area — playback logic unchanged */}
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
              />
            )
          ) : (
            <webview
              key={reloadKey}
              src={liveUrl}
              className="h-full w-full"
              partition="persist:tiktok"
              useragent="Mozilla/5.0 (iPhone; CPU iPhone OS 17_4 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Mobile/15E148 Safari/604.1"
              // @ts-expect-error allowpopups is a valid webview attribute
              allowpopups="true"
            />
          )}
        </div>

        {/* Controls bar */}
        <div className="flex flex-none items-center gap-1 border-t border-zinc-800/50 bg-zinc-950/70 px-2 py-1.5">
          {mode === 'hls' && hasHls ? (
            <>
              <Ctrl title={paused ? 'Play' : 'Pause'} onClick={togglePause}>
                {paused ? '▶' : '⏸'}
              </Ctrl>
              <Ctrl title="Reload stream" onClick={() => setReloadKey((k) => k + 1)}>⟳</Ctrl>
              <span className="rounded-md border border-zinc-700 px-1.5 py-0.5 text-[10px] font-semibold text-zinc-400">AUTO</span>
              <span className="ml-auto" />
              <Ctrl title="Picture in picture" onClick={togglePip}>⧉</Ctrl>
              <Ctrl title={muted ? 'Unmute' : 'Mute'} onClick={toggleMute}>{muted ? '🔇' : '🔊'}</Ctrl>
            </>
          ) : (
            <>
              <Ctrl title="Reload" onClick={() => setReloadKey((k) => k + 1)}>⟳</Ctrl>
              <span className="ml-auto text-[10px] text-zinc-600">tiktok.com/@{room.hostUniqueId}/live</span>
            </>
          )}
        </div>
      </div>
    </aside>
  );
}

function Ctrl({ title, onClick, children }: { title: string; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      onClick={onClick}
      title={title}
      className="flex h-7 w-7 items-center justify-center rounded-md text-sm text-zinc-300 transition hover:bg-zinc-800"
    >
      {children}
    </button>
  );
}
