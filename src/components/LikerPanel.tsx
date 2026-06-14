import { useEffect, useState, useRef, useCallback } from 'react';
import { useStore } from '../state/store';
import { PanelHeader, PanelShell } from './PanelHeader';

type LikerMode = 'normal' | 'human';

type LikerStats = {
  isActive: boolean;
  mode: string;
  interval: number;
  likesCount: number;
  keypressCount: number;
  sessionStartTime: number;
  state: string;
  isLivePage: boolean;
};

// The legacy "extreme" 50ms rapid-fire preset was removed: it is the most
// obvious automation signature and the biggest account-action risk. Only the
// two human-paced modes remain. (Human-like is the recommended default.)
const MODE_INFO: Record<LikerMode, { label: string; desc: string; color: string }> = {
  human: { label: 'Human-like', desc: 'Natural patterns with breaks (recommended)', color: 'text-emerald-400' },
  normal: { label: 'Normal', desc: 'Consistent interval tapping', color: 'text-cyan-400' },
};

function formatDuration(ms: number): string {
  const s = Math.floor(ms / 1000);
  const m = Math.floor(s / 60);
  const h = Math.floor(m / 60);
  if (h > 0) return `${h}h ${m % 60}m ${s % 60}s`;
  if (m > 0) return `${m}m ${s % 60}s`;
  return `${s}s`;
}

export function LikerPanel({ onClose }: { onClose: () => void }) {
  const [isOpen, setIsOpen] = useState(false);
  const [stats, setStats] = useState<LikerStats | null>(null);
  const [mode, setMode] = useState<LikerMode>('human');
  // Safest default pacing: 1500ms (slower than the old 1000ms default).
  const [interval, setInterval_] = useState(1500);
  const [username, setUsername] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // One-time risk acknowledgement, persisted in the settings store. Until the
  // user accepts, the auto-liker cannot be started.
  const [riskAck, setRiskAck] = useState(false);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const connectedUser = useStore((s) => s.roomInfo?.hostUniqueId ?? '');

  useEffect(() => {
    if (connectedUser) setUsername(connectedUser);
  }, [connectedUser]);

  useEffect(() => {
    window.tiktok.getSettings().then((s) => setRiskAck(s.likerRiskAck ?? false)).catch(() => {});
  }, []);

  const pollStats = useCallback(async () => {
    const open = await window.tiktok.likerIsOpen();
    setIsOpen(open);
    if (open) {
      const s = await window.tiktok.likerStats();
      if (s) setStats(s);
    } else {
      setStats(null);
    }
  }, []);

  useEffect(() => {
    pollStats();
    pollRef.current = setInterval(pollStats, 1000);
    return () => { if (pollRef.current) clearInterval(pollRef.current); };
  }, [pollStats]);

  const handleOpen = async () => {
    const handle = username.replace(/^@/, '').trim();
    if (!handle) return;
    setLoading(true);
    setError(null);
    const res = await window.tiktok.likerOpen(handle);
    setLoading(false);
    if (!res.ok) setError(res.error ?? 'Failed to open');
  };

  const handleClose = async () => {
    await window.tiktok.likerClose();
    setIsOpen(false);
    setStats(null);
  };

  const handleStart = async () => {
    if (!riskAck) return;
    await window.tiktok.likerStart(mode, interval);
  };

  const handleStop = async () => {
    await window.tiktok.likerStop();
  };

  const handleModeChange = async (m: LikerMode) => {
    setMode(m);
    if (isOpen) await window.tiktok.likerSetMode(m);
  };

  const handleIntervalChange = async (val: number) => {
    setInterval_(val);
    if (isOpen) await window.tiktok.likerSetInterval(val);
  };

  const elapsed = stats?.isActive && stats.sessionStartTime
    ? Date.now() - stats.sessionStartTime
    : 0;
  const likesPerMin = elapsed > 5000 && stats
    ? Math.round((stats.likesCount / (elapsed / 60000)))
    : 0;

  return (
    <PanelShell>
      <PanelHeader
        title="Live Liker"
        onClose={onClose}
        actions={isOpen ? (
          <button
            onClick={() => window.tiktok.likerShow()}
            className="panel-btn panel-btn-secondary"
          >
            Show Window
          </button>
        ) : null}
      >
        {stats?.isActive && (
          <span className="flex items-center gap-1.5 rounded-full bg-like-500/15 px-2.5 py-0.5 text-[11px] font-semibold text-like-400">
            <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-like-400" />
            Active
          </span>
        )}
      </PanelHeader>

      <div className="flex-1 overflow-y-auto p-6">
        {/* Connection */}
        <div className="glass mb-6 rounded-xl p-5">
          <div className="mb-3 text-[11px] font-semibold uppercase tracking-wider text-zinc-500">
            TikTok Live Page
          </div>
          {!isOpen ? (
            <div className="flex gap-2">
              <div className="relative flex-1">
                <span className="absolute left-3 top-1/2 -translate-y-1/2 text-sm text-zinc-500">@</span>
                <input
                  value={username}
                  onChange={(e) => setUsername(e.target.value)}
                  onKeyDown={(e) => { if (e.key === 'Enter') handleOpen(); }}
                  placeholder="username"
                  className="w-full rounded-lg border border-zinc-800 bg-zinc-900 py-2 pl-8 pr-3 text-sm outline-none transition focus:border-like-500/60"
                />
              </div>
              <button
                onClick={handleOpen}
                disabled={loading || !username.trim()}
                className="rounded-lg bg-gradient-to-r from-like-500 to-like-600 px-5 py-2 text-sm font-medium text-white shadow-lg shadow-like-500/20 disabled:opacity-40"
              >
                {loading ? 'Opening...' : 'Open Live'}
              </button>
            </div>
          ) : (
            <div className="flex items-center gap-3">
              <span className="flex items-center gap-1.5 text-sm text-zinc-200">
                <span className="h-2 w-2 rounded-full bg-emerald-400" />
                Browser window open
              </span>
              <span className="text-xs text-zinc-500">
                {stats?.isLivePage ? 'On live page' : 'Navigating...'}
              </span>
              <button
                onClick={handleClose}
                className="ml-auto rounded-lg border border-zinc-800 bg-zinc-900 px-3 py-1.5 text-xs text-zinc-300 hover:bg-zinc-800"
              >
                Close Browser
              </button>
            </div>
          )}
          {error && <div className="mt-2 text-xs text-rose-400">{error}</div>}
        </div>

        {/* Mode Selection */}
        <div className="glass mb-6 rounded-xl p-5">
          <div className="mb-3 text-[11px] font-semibold uppercase tracking-wider text-zinc-500">
            Behavior Mode
          </div>
          <div className="flex flex-col gap-2">
            {(Object.keys(MODE_INFO) as LikerMode[]).map((m) => {
              const info = MODE_INFO[m];
              const selected = mode === m;
              return (
                <button
                  key={m}
                  onClick={() => handleModeChange(m)}
                  className={`flex items-center gap-3 rounded-lg border px-4 py-3 text-left transition ${
                    selected
                      ? 'border-like-500/40 bg-like-500/10'
                      : 'border-zinc-800 bg-zinc-900 hover:bg-zinc-800'
                  }`}
                >
                  <div className={`h-3 w-3 rounded-full border-2 ${selected ? 'border-like-400 bg-like-400' : 'border-zinc-600'}`} />
                  <div>
                    <div className={`text-sm font-medium ${info.color}`}>{info.label}</div>
                    <div className="text-[11px] text-zinc-500">{info.desc}</div>
                  </div>
                </button>
              );
            })}
          </div>
        </div>

        {/* Interval (Normal mode only) */}
        {mode === 'normal' && (
          <div className="glass mb-6 rounded-xl p-5">
            <div className="mb-3 flex items-center justify-between">
              <span className="text-[11px] font-semibold uppercase tracking-wider text-zinc-500">
                Interval
              </span>
              <span className="text-sm font-medium text-zinc-200">{interval}ms</span>
            </div>
            <input
              type="range"
              min={500}
              max={3000}
              step={100}
              value={interval}
              onChange={(e) => handleIntervalChange(Number(e.target.value))}
              className="w-full accent-like-500"
            />
            <div className="mt-1 flex justify-between text-[10px] text-zinc-600">
              <span>Fast (500ms)</span>
              <span>Slow (3000ms)</span>
            </div>
          </div>
        )}

        {/* Risk acknowledgement — required before the liker can start */}
        {!stats?.isActive && (
          <div className="glass mb-6 rounded-xl border border-amber-500/30 bg-amber-500/5 p-5">
            <div className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-amber-400">
              Before you start
            </div>
            <p className="text-[12px] leading-relaxed text-amber-200/90">
              Automating likes may violate TikTok's Terms of Service and can get
              <span className="font-semibold"> your account warned, restricted, or banned</span>. There is no
              way to make this fully safe — use it sparingly, at your own risk.
            </p>
            <label className="mt-3 flex items-start gap-2 text-[13px] text-zinc-200">
              <input
                type="checkbox"
                checked={riskAck}
                onChange={(e) => {
                  setRiskAck(e.target.checked);
                  window.tiktok.setLikerRiskAck(e.target.checked).catch(() => {});
                }}
                className="mt-0.5 accent-amber-500"
              />
              <span>I understand the risk to my account and accept it.</span>
            </label>
          </div>
        )}

        {/* Controls */}
        <div className="mb-6 flex gap-3">
          {stats?.isActive ? (
            <button
              onClick={handleStop}
              className="flex-1 rounded-xl border border-rose-500/30 bg-rose-500/10 py-3 text-sm font-semibold text-rose-400 transition hover:bg-rose-500/20"
            >
              Stop Liking
            </button>
          ) : (
            <button
              onClick={handleStart}
              disabled={!isOpen || !riskAck}
              title={!riskAck ? 'Acknowledge the risk above to enable' : undefined}
              className="flex-1 rounded-xl bg-gradient-to-r from-like-500 to-like-600 py-3 text-sm font-semibold text-white shadow-lg shadow-like-500/20 transition hover:shadow-like-500/40 disabled:opacity-40"
            >
              Start Auto-Liking
            </button>
          )}
        </div>

        {/* Stats */}
        {stats && (
          <div className="glass rounded-xl p-5">
            <div className="mb-3 text-[11px] font-semibold uppercase tracking-wider text-zinc-500">
              Session Stats
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <div className="text-2xl font-bold text-like-400">{stats.likesCount.toLocaleString()}</div>
                <div className="text-[11px] text-zinc-500">Likes Sent</div>
              </div>
              <div>
                <div className="text-2xl font-bold text-zinc-100">{likesPerMin.toLocaleString()}</div>
                <div className="text-[11px] text-zinc-500">Likes/min</div>
              </div>
              <div>
                <div className="text-2xl font-bold text-zinc-100">{stats.keypressCount.toLocaleString()}</div>
                <div className="text-[11px] text-zinc-500">Keypresses</div>
              </div>
              <div>
                <div className="text-2xl font-bold text-zinc-100">{elapsed > 0 ? formatDuration(elapsed) : '—'}</div>
                <div className="text-[11px] text-zinc-500">Session Time</div>
              </div>
            </div>
            {stats.state && (
              <div className="mt-4 rounded-lg bg-zinc-900 px-3 py-2 text-xs text-zinc-400">
                State: <span className="text-zinc-200">{stats.state}</span>
              </div>
            )}
          </div>
        )}

        {/* Info */}
        <div className="mt-6 rounded-xl border border-zinc-800/50 bg-zinc-900/50 p-4">
          <div className="mb-2 text-xs font-semibold text-zinc-300">How it works</div>
          <p className="text-[11px] leading-relaxed text-zinc-500">
            Opens the desktop TikTok Live page in a browser window and simulates pressing the "L" key
            (TikTok's like shortcut, desktop only) plus a fallback click on the like button.
            You must be logged into TikTok and inside the live room for likes to register.
            Human-like mode adds natural breaks and timing variation.
          </p>
          <div className="mt-3 rounded-lg bg-amber-500/10 px-3 py-2 text-[11px] text-amber-300">
            Automated liking may violate TikTok's Terms of Service. Use at your own risk.
          </div>
        </div>
      </div>
    </PanelShell>
  );
}
