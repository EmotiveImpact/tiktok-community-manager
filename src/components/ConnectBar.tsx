import { useEffect, useRef, useState, type ReactNode } from 'react';
import { useStore } from '../state/store';
import { StatusPill } from './StatusPill';
import { getTheme, setTheme, type Theme } from '../lib/theme';
import type { WebhookConfig } from '../types';

function ThemeToggle() {
  const [theme, set] = useState<Theme>(() => getTheme());
  const toggle = () => {
    const next = theme === 'dark' ? 'light' : 'dark';
    set(next);
    setTheme(next);
  };
  return (
    <button
      onClick={toggle}
      className="no-drag panel-btn panel-btn-icon"
      title={theme === 'dark' ? 'Switch to light theme' : 'Switch to dark theme'}
    >
      {theme === 'dark' ? (
        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <circle cx="12" cy="12" r="4" />
          <path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M4.93 19.07l1.41-1.41M17.66 6.34l1.41-1.41" />
        </svg>
      ) : (
        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z" />
        </svg>
      )}
    </button>
  );
}

function ToolbarBtn({ active, onClick, children, title }: { active?: boolean; onClick: () => void; children: ReactNode; title?: string }) {
  return (
    <button
      onClick={onClick}
      title={title}
      className={`no-drag flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-xs font-medium transition ${
        active
          ? 'bg-like-500/10 text-like-400'
          : 'text-zinc-400 hover:bg-zinc-800 hover:text-zinc-100'
      }`}
    >
      {children}
    </button>
  );
}

function Divider() {
  return <div className="h-6 w-px flex-shrink-0 bg-zinc-800" />;
}

/** Session uptime timer shown next to the LIVE pill. */
function SessionTimer() {
  const connectedAt = useStore((s) => s.connectedAt);
  const [, force] = useState(0);
  useEffect(() => {
    if (!connectedAt) return;
    const t = setInterval(() => force((n) => n + 1), 1000);
    return () => clearInterval(t);
  }, [connectedAt]);
  if (!connectedAt) return null;
  const s = Math.floor((Date.now() - connectedAt) / 1000);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  const label = h ? `${h}:${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')}` : `${m}:${String(sec).padStart(2, '0')}`;
  return <span className="no-drag text-[11px] font-semibold tabular-nums text-zinc-400">{label}</span>;
}

export function ConnectBar({ rightExtras }: { rightExtras?: ReactNode } = {}) {
  const { status, username, setUsername, errorMessage, reset } = useStore();
  const [input, setInput] = useState(username);
  const [signKey, setSignKey] = useState('');
  const [aiKey, setAiKey] = useState('');
  const [showSettings, setShowSettings] = useState(false);
  const settingsRef = useRef<HTMLDivElement | null>(null);
  const [savedFlash, setSavedFlash] = useState<'sign' | 'ai' | null>(null);
  const [overlayUrl, setOverlayUrl] = useState<string | null>(null);
  const [autoConnect, setAutoConnect] = useState(false);
  const [chatLog, setChatLog] = useState(false);
  const [webhooks, setWebhooks] = useState<WebhookConfig>({ discordUrl: '', slackUrl: '', customUrl: '', events: { gifts: true, follows: true, keywords: false, milestones: true } });
  const [backupMsg, setBackupMsg] = useState<string | null>(null);

  const saveSignKey = async () => {
    await window.tiktok.setSignApiKey(signKey);
    setSavedFlash('sign');
    setTimeout(() => setSavedFlash(null), 1400);
  };

  const saveAiKey = async () => {
    await window.tiktok.setAnthropicKey(aiKey);
    setSavedFlash('ai');
    setTimeout(() => setSavedFlash(null), 1400);
  };

  useEffect(() => {
    window.tiktok.getSettings().then((s) => {
      if (s.lastUsername && !input) setInput(s.lastUsername);
      setSignKey(s.signApiKey ?? '');
      setAiKey(s.anthropicApiKey ?? '');
      setAutoConnect(s.autoConnect ?? false);
      setChatLog(s.chatLogEnabled ?? false);
      if (s.webhooks) setWebhooks(s.webhooks);
    });
    window.tiktok.overlayUrl().then(setOverlayUrl);
  }, []);

  useEffect(() => {
    if (!showSettings) return;
    const handler = (e: MouseEvent) => {
      if (settingsRef.current && !settingsRef.current.contains(e.target as Node)) {
        setShowSettings(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [showSettings]);

  const isLive = status === 'connected' || status === 'reconnecting';

  const handleConnect = async () => {
    const u = input.trim().replace(/^@/, '');
    if (!u) return;
    reset();
    setUsername(u);
    const res = await window.tiktok.connect(u);
    if (!res.ok) {
      useStore.getState().setStatus('error', res.error);
    }
  };

  const handleDisconnect = async () => {
    await window.tiktok.disconnect();
  };

  return (
    <div className="titlebar-drag relative z-30 flex h-11 flex-none items-center gap-2 border-b border-zinc-800 bg-zinc-950/85 pl-[78px] pr-3 backdrop-blur">
      {!isLive ? (
        <div className="no-drag flex items-center gap-1.5">
          <div className="relative flex items-center">
            <span className="pointer-events-none absolute left-2.5 text-xs text-zinc-500">@</span>
            <input
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') handleConnect(); }}
              placeholder="username"
              className="h-7 w-44 rounded-md border border-zinc-700 bg-zinc-900 pl-6 pr-2.5 text-xs text-zinc-100 outline-none transition focus:border-like-500/60"
            />
          </div>
          <button
            onClick={handleConnect}
            disabled={!input.trim() || status === 'connecting'}
            className="panel-btn panel-btn-primary"
          >
            {status === 'connecting' ? 'Connecting…' : 'Connect'}
          </button>
        </div>
      ) : (
        <div className="no-drag flex items-center gap-1.5">
          <button onClick={handleDisconnect} className="panel-btn panel-btn-secondary">
            Disconnect
          </button>
        </div>
      )}

      <div className="no-drag">
        <StatusPill status={status} />
      </div>
      {isLive && <SessionTimer />}

      {errorMessage && (
        <div className="no-drag truncate text-xs text-rose-400" title={errorMessage}>
          {errorMessage}
        </div>
      )}

      <div ref={settingsRef} className="ml-auto flex items-center gap-1.5">
        {rightExtras}
        <div className="panel-divider" />
        <ThemeToggle />
        <button
          onClick={() => setShowSettings((v) => !v)}
          className="no-drag panel-btn panel-btn-icon"
          title="Settings"
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <circle cx="12" cy="12" r="3" />
            <path d="M19.4 15a1.65 1.65 0 00.33 1.82l.06.06a2 2 0 010 2.83 2 2 0 01-2.83 0l-.06-.06a1.65 1.65 0 00-1.82-.33 1.65 1.65 0 00-1 1.51V21a2 2 0 01-4 0v-.09A1.65 1.65 0 009 19.4a1.65 1.65 0 00-1.82.33l-.06.06a2 2 0 01-2.83-2.83l.06-.06A1.65 1.65 0 004.68 15a1.65 1.65 0 00-1.51-1H3a2 2 0 010-4h.09A1.65 1.65 0 004.6 9a1.65 1.65 0 00-.33-1.82l-.06-.06a2 2 0 012.83-2.83l.06.06A1.65 1.65 0 009 4.68a1.65 1.65 0 001-1.51V3a2 2 0 014 0v.09a1.65 1.65 0 001 1.51 1.65 1.65 0 001.82-.33l.06-.06a2 2 0 012.83 2.83l-.06.06A1.65 1.65 0 0019.4 9a1.65 1.65 0 001.51 1H21a2 2 0 010 4h-.09a1.65 1.65 0 00-1.51 1z" />
          </svg>
        </button>
      {showSettings && (
        <div className="no-drag absolute right-4 top-14 z-50 w-80 max-h-[80vh] overflow-y-auto rounded-xl border border-zinc-800/60 bg-zinc-950/95 p-4 shadow-2xl backdrop-blur">
          <div className="mb-2 text-xs font-semibold uppercase tracking-wider text-zinc-500">
            Sign API key
          </div>
          <div className="flex gap-2">
            <input
              value={signKey}
              onChange={(e) => setSignKey(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') saveSignKey(); }}
              placeholder="EulerStream key (optional)"
              className="flex-1 rounded-lg border border-zinc-800 bg-zinc-900 px-3 py-1.5 text-sm outline-none transition focus:border-like-500/60"
            />
            <button
              onClick={saveSignKey}
              className="rounded-lg bg-gradient-to-r from-like-500 to-like-600 px-3 py-1.5 text-sm font-medium text-white"
            >
              {savedFlash === 'sign' ? 'Saved ✓' : 'Save'}
            </button>
          </div>
          <p className="mt-2 text-xs text-zinc-500">
            tiktok-live-connector needs a signing endpoint. Free tier works for casual use; paste a
            key here if you hit rate limits. See{' '}
            <a href="https://www.eulerstream.com/" target="_blank" rel="noreferrer" className="text-like-400 hover:underline">
              eulerstream.com
            </a>.
          </p>

          <div className="my-4 h-px bg-zinc-800" />

          <div className="mb-2 text-xs font-semibold uppercase tracking-wider text-zinc-500">
            Anthropic API key
          </div>
          <div className="flex gap-2">
            <input
              value={aiKey}
              onChange={(e) => setAiKey(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') saveAiKey(); }}
              placeholder="sk-ant-…"
              type="password"
              className="flex-1 rounded-lg border border-zinc-800 bg-zinc-900 px-3 py-1.5 text-sm outline-none transition focus:border-like-500/60"
            />
            <button
              onClick={saveAiKey}
              className="rounded-lg bg-gradient-to-r from-like-500 to-like-600 px-3 py-1.5 text-sm font-medium text-white"
            >
              {savedFlash === 'ai' ? 'Saved ✓' : 'Save'}
            </button>
          </div>
          <p className="mt-2 text-xs text-zinc-500">
            Used for AI session summaries. Your key stays on this device and is sent only to api.anthropic.com.
          </p>

          <div className="my-4 h-px bg-zinc-800" />

          <div className="mb-2 text-xs font-semibold uppercase tracking-wider text-zinc-500">
            General
          </div>
          <div className="flex flex-col gap-2">
            <label className="flex items-center gap-2 text-xs text-zinc-300">
              <input type="checkbox" checked={autoConnect} onChange={(e) => { setAutoConnect(e.target.checked); window.tiktok.setAutoConnect(e.target.checked); }} className="accent-like-500" />
              Auto-connect to last user on launch
            </label>
            <label className="flex items-center gap-2 text-xs text-zinc-300">
              <input type="checkbox" checked={chatLog} onChange={(e) => { setChatLog(e.target.checked); window.tiktok.setChatLog(e.target.checked); }} className="accent-like-500" />
              Save chat log to disk
            </label>
          </div>

          <div className="my-4 h-px bg-zinc-800" />

          <div className="mb-2 text-xs font-semibold uppercase tracking-wider text-zinc-500">
            Webhooks
          </div>
          <input value={webhooks.discordUrl} onChange={(e) => setWebhooks({ ...webhooks, discordUrl: e.target.value })} onBlur={() => window.tiktok.setWebhooks(webhooks)} placeholder="Discord webhook URL" className="w-full mb-1 rounded-lg border border-zinc-800 bg-zinc-900 px-3 py-1.5 text-xs outline-none transition focus:border-like-500/60" />
          <input value={webhooks.slackUrl} onChange={(e) => setWebhooks({ ...webhooks, slackUrl: e.target.value })} onBlur={() => window.tiktok.setWebhooks(webhooks)} placeholder="Slack webhook URL" className="w-full mb-1 rounded-lg border border-zinc-800 bg-zinc-900 px-3 py-1.5 text-xs outline-none transition focus:border-like-500/60" />
          <input value={webhooks.customUrl} onChange={(e) => setWebhooks({ ...webhooks, customUrl: e.target.value })} onBlur={() => window.tiktok.setWebhooks(webhooks)} placeholder="Custom HTTP endpoint" className="w-full mb-1 rounded-lg border border-zinc-800 bg-zinc-900 px-3 py-1.5 text-xs outline-none transition focus:border-like-500/60" />

          {overlayUrl && (
            <>
              <div className="my-4 h-px bg-zinc-800" />
              <div className="mb-2 text-xs font-semibold uppercase tracking-wider text-zinc-500">
                OBS Overlays
              </div>
              <div className="rounded-lg border border-zinc-800 bg-zinc-900 px-3 py-2 text-xs text-zinc-300 font-mono select-all">
                {overlayUrl}
              </div>
            </>
          )}

          <div className="my-4 h-px bg-zinc-800" />

          <div className="mb-2 text-xs font-semibold uppercase tracking-wider text-zinc-500">
            Data
          </div>
          <div className="flex gap-2">
            <button onClick={async () => { const r = await window.tiktok.backupExport(); setBackupMsg(r.ok ? 'Backup saved' : 'Cancelled'); setTimeout(() => setBackupMsg(null), 2000); }} className="flex-1 rounded-lg border border-zinc-800 bg-zinc-900 px-3 py-1.5 text-xs text-zinc-300 hover:bg-zinc-800">Export backup</button>
            <button onClick={async () => { const r = await window.tiktok.backupImport(); setBackupMsg(r.ok ? 'Restored!' : r.error ?? 'Cancelled'); setTimeout(() => setBackupMsg(null), 2000); }} className="flex-1 rounded-lg border border-zinc-800 bg-zinc-900 px-3 py-1.5 text-xs text-zinc-300 hover:bg-zinc-800">Import backup</button>
          </div>
          {backupMsg && <div className="mt-1 text-xs text-emerald-400">{backupMsg}</div>}
        </div>
      )}
      </div>
    </div>
  );
}
