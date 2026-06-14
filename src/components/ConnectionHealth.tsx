/**
 * ConnectionHealth — the persistent live-connection health pill.
 *
 * The #1 creator complaint about competing tools is mid-stream breakage with no
 * indication of WHY. This pill makes the connection legible:
 *   - green   → connected (healthy)
 *   - amber   → reconnecting (with attempt count) / stalled (no events)
 *   - red     → failed with a reason (rate-limited, signing-failed, network)
 *   - grey    → offline / disconnected / idle
 *
 * Hover (or click, for keyboard/touch) reveals the human-readable reason and a
 * suggested action. The component also owns the `tt:health` IPC subscription and
 * mirrors the latest detail into the zustand store, so it is fully self-contained
 * and can be dropped into the live host bar without touching the global wiring.
 */
import { useEffect, useRef, useState } from 'react';
import { useStore } from '../state/store';
import type { ConnectionDetail, ConnectionPhase } from '../types';

type Tone = 'green' | 'amber' | 'red' | 'grey';

const TONE_FOR_PHASE: Record<ConnectionPhase, Tone> = {
  idle: 'grey',
  connecting: 'amber',
  connected: 'green',
  'live-ended': 'grey',
  stalled: 'amber',
  'rate-limited': 'red',
  'signing-failed': 'red',
  'network-error': 'red',
  offline: 'grey',
  reconnecting: 'amber',
  disconnected: 'grey',
};

const TONE_COLOR: Record<Tone, string> = {
  green: 'var(--green)',
  amber: 'var(--amber)',
  red: 'var(--red)',
  grey: 'var(--secondary-label)',
};

function labelFor(d: ConnectionDetail): string {
  switch (d.phase) {
    case 'idle':
      return 'Not connected';
    case 'connecting':
      return 'Connecting';
    case 'connected':
      return 'Connected';
    case 'live-ended':
      return 'LIVE ended';
    case 'stalled':
      return 'Stalled';
    case 'rate-limited':
      return 'Rate-limited';
    case 'signing-failed':
      return 'Signing failed';
    case 'network-error':
      return 'Network error';
    case 'offline':
      return 'Offline';
    case 'reconnecting':
      return d.reconnectAttempt > 0 ? `Reconnecting · try ${d.reconnectAttempt}` : 'Reconnecting';
    case 'disconnected':
      return 'Disconnected';
  }
}

/**
 * Subscribes to the main-process health channel and keeps the store in sync.
 * Mounted once near the app root; the visible pill is `<ConnectionHealthPill />`.
 */
export function useConnectionHealthBridge() {
  const setHealth = useStore((s) => s.setHealth);
  useEffect(() => {
    if (!window.tiktok?.onHealth) return;
    const off = window.tiktok.onHealth((d) => setHealth(d));
    return off;
  }, [setHealth]);
}

export function ConnectionHealthPill() {
  // Own the subscription here too, so the pill works even if the bridge hook
  // isn't separately mounted (idempotent — both just call setHealth).
  useConnectionHealthBridge();

  const health = useStore((s) => s.health);
  const status = useStore((s) => s.status);
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement | null>(null);

  // Live countdown to the next reconnect, when applicable.
  const [, force] = useState(0);
  useEffect(() => {
    if (health?.phase !== 'reconnecting' || health.nextRetryInMs == null) return;
    const t = setInterval(() => force((n) => n + 1), 1000);
    return () => clearInterval(t);
  }, [health?.phase, health?.nextRetryInMs]);

  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [open]);

  // Fall back to a synthesized detail from the coarse status until the first
  // rich push arrives, so the pill never renders empty.
  const detail: ConnectionDetail =
    health ?? {
      phase:
        status === 'connected' ? 'connected'
        : status === 'connecting' ? 'connecting'
        : status === 'reconnecting' ? 'reconnecting'
        : status === 'error' ? 'network-error'
        : status === 'disconnected' ? 'disconnected'
        : 'idle',
      status,
      reason: '',
      reconnectAttempt: 0,
      nextRetryInMs: null,
      lastEventAt: null,
    };

  const tone = TONE_FOR_PHASE[detail.phase];
  const color = TONE_COLOR[tone];

  const retrySecs =
    detail.phase === 'reconnecting' && detail.nextRetryInMs != null
      ? Math.max(0, Math.ceil(detail.nextRetryInMs / 1000))
      : null;

  return (
    <div ref={ref} className="no-drag relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        onMouseEnter={() => setOpen(true)}
        title={detail.reason || labelFor(detail)}
        aria-label={`Connection health: ${labelFor(detail)}. ${detail.reason}`}
        aria-haspopup="dialog"
        aria-expanded={open}
        className="flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[11px] font-semibold transition"
        style={{
          color,
          background: 'var(--fill-quaternary)',
          border: `1px solid ${color}55`,
        }}
      >
        <span
          aria-hidden
          style={{
            width: 7,
            height: 7,
            borderRadius: '50%',
            background: color,
            flexShrink: 0,
          }}
        />
        {labelFor(detail)}
      </button>

      {open && (detail.reason || detail.suggestion) && (
        <div
          role="dialog"
          className="absolute left-0 top-8 z-50 w-72 rounded-xl p-3 text-[12px] shadow-2xl"
          style={{
            background: 'var(--bg-elevated, rgba(20,22,32,0.97))',
            border: '1px solid var(--card-border)',
            backdropFilter: 'blur(12px)',
          }}
        >
          <div className="mb-1 flex items-center gap-1.5 font-semibold" style={{ color }}>
            <span
              aria-hidden
              style={{ width: 8, height: 8, borderRadius: '50%', background: color, flexShrink: 0 }}
            />
            {labelFor(detail)}
          </div>
          {detail.reason && (
            <p style={{ color: 'var(--label, #e6eaf3)' }} className="leading-snug">
              {detail.reason}
            </p>
          )}
          {retrySecs != null && (
            <p className="mt-1" style={{ color: 'var(--secondary-label)' }}>
              Next retry in {retrySecs}s.
            </p>
          )}
          {detail.suggestion && (
            <p className="mt-2 leading-snug" style={{ color: 'var(--secondary-label)' }}>
              {detail.suggestion}
            </p>
          )}
        </div>
      )}
    </div>
  );
}
