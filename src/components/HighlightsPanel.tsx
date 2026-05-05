import { useEffect, useState } from 'react';
import { useStore } from '../state/store';
import { PanelHeader, PanelShell } from './PanelHeader';

type Clip = { name: string; path: string; size: number; mtime: number };

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

export function HighlightsPanel({ onClose }: { onClose: () => void }) {
  const [clips, setClips] = useState<Clip[]>([]);
  const [available, setAvailable] = useState<boolean | null>(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const status = useStore((s) => s.status);
  const room = useStore((s) => s.roomInfo);

  const refresh = async () => {
    setClips(await window.tiktok.highlightsList());
  };

  useEffect(() => {
    window.tiktok.highlightsAvailable().then(setAvailable);
    refresh();
  }, []);

  const captureNow = async () => {
    setBusy(true);
    setMsg(null);
    const res = await window.tiktok.highlightsCapture('manual');
    setBusy(false);
    if (res.ok) {
      setMsg('Clip saved');
      refresh();
    } else {
      setMsg(res.error ?? 'Capture failed');
    }
    setTimeout(() => setMsg(null), 3000);
  };

  const canCapture = status === 'connected' && !!room?.hlsUrl && available === true;

  return (
    <PanelShell>
      <PanelHeader
        title="Highlight Clips"
        badge={clips.length}
        onClose={onClose}
        actions={
          <button
            onClick={captureNow}
            disabled={!canCapture || busy}
            className="panel-btn panel-btn-primary"
          >
            {busy ? 'Capturing…' : 'Capture last 60s'}
          </button>
        }
      >
        {available === false && (
          <span className="rounded-full bg-rose-500/15 px-2.5 py-0.5 text-[11px] font-semibold text-rose-300">
            FFmpeg not installed
          </span>
        )}
        {available === true && status === 'connected' && !room?.hlsUrl && (
          <span className="rounded-full bg-amber-500/15 px-2.5 py-0.5 text-[11px] font-semibold text-amber-300">
            No HLS URL — can't clip
          </span>
        )}
      </PanelHeader>

      {msg && (
        <div className="border-b border-zinc-800 bg-emerald-900/15 px-5 py-2 text-xs text-emerald-300">{msg}</div>
      )}

      <div className="flex-1 overflow-y-auto p-6">
        {available === false && (
          <div className="glass mb-4 rounded-xl p-5">
            <div className="mb-2 text-sm font-semibold text-zinc-100">Install FFmpeg to enable clips</div>
            <p className="text-xs leading-relaxed text-zinc-400">
              Highlight clips capture the last 60 seconds of the live stream as an MP4 file. This uses FFmpeg to record the HLS feed.
              Install with <code className="rounded bg-zinc-800 px-1.5 py-0.5 text-[11px] text-zinc-200">brew install ffmpeg</code> then restart the app.
            </p>
          </div>
        )}

        {clips.length === 0 ? (
          <div className="flex h-64 items-center justify-center text-sm text-zinc-600">
            No clips yet. Connect to a stream with HLS, then click "Capture last 60s" or enable Auto-clip in Alerts.
          </div>
        ) : (
          <ul className="flex flex-col gap-2">
            {clips.map((c) => (
              <li key={c.path} className="glass flex items-center gap-3 rounded-xl px-4 py-3">
                <div className="flex h-10 w-10 flex-none items-center justify-center rounded-lg bg-like-500/15 text-xl">🎬</div>
                <div className="flex-1 min-w-0">
                  <div className="truncate text-sm font-medium text-zinc-100">{c.name}</div>
                  <div className="text-[11px] text-zinc-500">
                    {new Date(c.mtime).toLocaleString()} · {formatSize(c.size)}
                  </div>
                </div>
                <button
                  onClick={() => window.tiktok.highlightsReveal(c.path)}
                  className="rounded-lg border border-zinc-800 bg-zinc-900 px-3 py-1.5 text-xs text-zinc-300 hover:bg-zinc-800"
                >
                  Reveal
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </PanelShell>
  );
}
