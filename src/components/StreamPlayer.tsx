import { useEffect, useRef, useState } from 'react';
import Hls from 'hls.js';
import { useStore } from '../state/store';
import { useUI } from '../state/ui';
import { formatNumber } from '../lib/format';
import { avatarGradient } from '../lib/avatars';

type ViewMode = 'hls' | 'mobile' | 'locked';

export function StreamPlayer({ onClose }: { onClose: () => void }) {
  const room = useStore((s) => s.roomInfo);
  const streamMeta = useStore((s) => s.streamMeta);
  const viewerCount = useStore((s) => s.viewerCount);
  const totalLikes = useStore((s) => s.totalLikes);
  const setPage = useUI((s) => s.setPage);
  // room_info needs a paid plan, and the connector also gave us no HLS URL.
  const needsPaidPlan = !!streamMeta?.unauthorized && !room?.hlsUrl;
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const hlsRef = useRef<Hls | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [muted, setMuted] = useState(true);
  const [paused, setPaused] = useState(false);
  const [reloadKey, setReloadKey] = useState(0);
  const hasHls = !!room?.hlsUrl;
  const [mode, setMode] = useState<ViewMode>(
    hasHls ? 'hls' : needsPaidPlan ? 'locked' : 'mobile',
  );
  // The 'unauthorized' streamMeta usually arrives a beat after mount. When it
  // does (and no HLS turned up), surface the honest locked state — unless the
  // user has already chosen the Mobile view.
  useEffect(() => {
    if (needsPaidPlan && mode !== 'mobile' && mode !== 'locked') setMode('locked');
    // If an HLS URL arrives later, prefer the real player over the locked state.
    if (hasHls && mode === 'locked') setMode('hls');
  }, [needsPaidPlan, hasHls, mode]);
  // Real quality control, driven by the HLS manifest. `levels` lists the
  // selectable renditions (height in px); `currentLevel` is -1 for Auto.
  const [levels, setLevels] = useState<{ index: number; height: number }[]>([]);
  const [currentLevel, setCurrentLevel] = useState(-1);

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
    setLevels([]);
    setCurrentLevel(-1);

    if (Hls.isSupported()) {
      const hls = new Hls({ lowLatencyMode: true });
      hlsRef.current = hls;
      hls.loadSource(url);
      hls.attachMedia(video);
      hls.on(Hls.Events.MANIFEST_PARSED, (_e, data) => {
        // De-dup by height, descending (720p, 480p, …) for a tidy menu.
        const seen = new Set<number>();
        const ls = data.levels
          .map((lvl, index) => ({ index, height: lvl.height || 0 }))
          .filter((l) => l.height > 0 && !seen.has(l.height) && seen.add(l.height))
          .sort((a, b) => b.height - a.height);
        setLevels(ls);
        setCurrentLevel(hls.currentLevel);
      });
      hls.on(Hls.Events.LEVEL_SWITCHED, (_e, data) => {
        setCurrentLevel(hls.autoLevelEnabled ? -1 : data.level);
      });
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

  const selectLevel = (index: number) => {
    const hls = hlsRef.current;
    if (!hls) return;
    // -1 restores ABR auto selection; any other index pins that rendition.
    hls.currentLevel = index;
    setCurrentLevel(index);
  };

  const currentLevelLabel =
    currentLevel === -1
      ? 'Auto'
      : `${levels.find((l) => l.index === currentLevel)?.height ?? ''}p`;

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
          <span className="ml-auto inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-bold text-white" style={{ background: 'var(--brand-pink)' }}>
            <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-white" />
            LIVE
          </span>
          <button
            onClick={onClose}
            className="rounded-md px-2 py-0.5 text-xs text-zinc-400 hover:bg-zinc-800"
            title="Close player"
            aria-label="Close player"
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
          {mode === 'locked' ? (
            <div className="flex h-full flex-col items-center justify-center gap-3 p-5 text-center">
              <div className="text-3xl">🔒</div>
              <div className="text-[13px] font-semibold text-zinc-200">
                Live video needs an EulerStream Business plan
              </div>
              <p className="text-[11px] leading-relaxed text-zinc-500">
                Your EulerStream key signs the connection (free tier), but the in-app video player
                pulls the live stream URL from EulerStream's <span className="text-zinc-400">room_info</span> endpoint,
                which requires a paid plan. Add a Business/Premium key in Settings, or use the
                Mobile view below.
              </p>
              <div className="flex gap-2">
                <button
                  onClick={() => setPage('settings')}
                  className="rounded-lg bg-gradient-to-r from-like-500 to-like-600 px-3 py-1.5 text-[11px] font-semibold text-white"
                >
                  Open Settings
                </button>
                <button
                  onClick={() => setMode('mobile')}
                  className="rounded-lg border border-zinc-700 px-3 py-1.5 text-[11px] font-semibold text-zinc-300 hover:bg-zinc-800"
                >
                  📱 Mobile view
                </button>
              </div>
            </div>
          ) : mode === 'hls' && hasHls ? (
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
              {levels.length >= 2 ? (
                <select
                  value={currentLevel}
                  onChange={(e) => selectLevel(Number(e.target.value))}
                  title="Stream quality"
                  className="cursor-pointer rounded-md border border-zinc-700 bg-zinc-900 px-1.5 py-0.5 text-[10px] font-semibold text-zinc-300 outline-none transition hover:border-zinc-600"
                >
                  <option value={-1}>Auto</option>
                  {levels.map((l) => (
                    <option key={l.index} value={l.index}>{l.height}p</option>
                  ))}
                </select>
              ) : (
                <span
                  title="Live stream quality is set by the broadcaster"
                  className="rounded-md border border-zinc-700 px-1.5 py-0.5 text-[10px] font-semibold text-zinc-400"
                >
                  {currentLevelLabel === 'Auto' ? 'LIVE' : currentLevelLabel}
                </span>
              )}
              <span className="ml-auto" />
              <Ctrl title="Picture in picture" onClick={togglePip}>⧉</Ctrl>
              <Ctrl title={muted ? 'Unmute' : 'Mute'} onClick={toggleMute}>{muted ? '🔇' : '🔊'}</Ctrl>
            </>
          ) : mode === 'locked' ? (
            <>
              <span className="text-[10px] text-zinc-600">EulerStream room_info — Business plan required</span>
              <span className="ml-auto" />
              <button
                onClick={() => setPage('settings')}
                className="rounded-md border border-zinc-700 px-1.5 py-0.5 text-[10px] font-semibold text-zinc-300 hover:bg-zinc-800"
              >
                Settings
              </button>
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
      aria-label={title}
      className="flex h-7 w-7 items-center justify-center rounded-md text-sm text-zinc-300 transition hover:bg-zinc-800"
    >
      {children}
    </button>
  );
}
