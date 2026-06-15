/**
 * Bottom composer of the live feed. The connector is READ-ONLY (we cannot
 * post to TikTok chat) — this is a NOTES box.
 *
 * Every note is PERSISTED to the canonical fan notes model (a dated timeline
 * note via fansAddNote) — nothing is dropped silently. Target resolution, in
 * order:
 *   1. the fan currently pinned in the Fan Memory panel, else
 *   2. an @mention that matches a ledger fan, else
 *   3. the current LIVE session's host (roomInfo.hostUniqueId).
 * If we truly have no fan target (no host, no pin, no mention) the note is kept
 * in the box and the user is told to pick a fan — we never quietly lose it.
 */
import { useEffect, useRef, useState } from 'react';
import { useUI } from '../state/ui';
import { useStore } from '../state/store';
import { Tooltip } from './ui';

const EMOJIS = ['💖', '🔥', '😂', '🎉', '🙏', '⭐', '💎', '🎁'];

export function NoteComposer() {
  const setTab = useUI((s) => s.setTab);
  const fanMemoryId = useUI((s) => s.fanMemoryId);
  const fanMemoryPinned = useUI((s) => s.fanMemoryPinned);
  const focusFanMemory = useUI((s) => s.focusFanMemory);
  const hostUniqueId = useStore((s) => s.roomInfo?.hostUniqueId ?? null);
  const [text, setText] = useState('');
  const [showEmoji, setShowEmoji] = useState(false);
  const [highlightsOk, setHighlightsOk] = useState(false);
  const [flash, setFlash] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const emojiRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    window.tiktok.highlightsAvailable().then(setHighlightsOk).catch(() => {});
  }, []);

  useEffect(() => {
    if (!showEmoji) return;
    const handler = (e: MouseEvent) => {
      if (emojiRef.current && !emojiRef.current.contains(e.target as Node)) setShowEmoji(false);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [showEmoji]);

  const send = async () => {
    const t = text.trim();
    if (!t) return;

    // Resolve a fan target so the note is NEVER lost.
    // 1) the pinned Fan Memory selection.
    let targetId: string | null = fanMemoryPinned && fanMemoryId ? fanMemoryId : null;
    let targetLabel = '';

    // 2) an @mention that matches a ledger fan.
    if (!targetId) {
      const mention = t.match(/@([\w.]+)/);
      if (mention) {
        try {
          const fan = await window.tiktok.fansGet(mention[1]);
          if (fan) { targetId = fan.uniqueId; targetLabel = fan.displayName || fan.nickname || `@${fan.uniqueId}`; }
        } catch { /* fall through */ }
      }
    }

    // 3) the current LIVE session's host.
    if (!targetId && hostUniqueId) {
      targetId = hostUniqueId.replace(/^@/, '').trim() || null;
      if (targetId) targetLabel = `@${targetId} (host)`;
    }

    if (!targetId) {
      // No host, no pin, no mention — keep the note and tell the user, rather
      // than dropping it silently (the old streamNotes bug).
      setFlash('Pick a fan (click a name) or @mention to save this note');
      setTimeout(() => setFlash(null), 2600);
      return;
    }

    setText('');
    const res = await window.tiktok.fansAddNote(targetId, t).catch(() => null);
    if (res?.ok) {
      // Surface the saved fan in the memory panel so it's visible immediately.
      focusFanMemory(targetId);
      setFlash(`Saved to ${targetLabel || `@${targetId}`} ✓`);
      setTimeout(() => setFlash(null), 2000);
    } else {
      setText(t); // restore on failure — still no silent loss
      setFlash('Could not save note — try again');
      setTimeout(() => setFlash(null), 2400);
    }
  };

  const capture = async () => {
    const res = await window.tiktok.highlightsCapture('manual');
    setFlash(res.ok ? 'Clip saved ✓' : res.error ?? 'Capture failed');
    setTimeout(() => setFlash(null), 1800);
  };

  return (
    <div className="flex flex-none items-center gap-1.5 border-t border-zinc-800/50 px-2.5 py-2">
      <input
        ref={inputRef}
        value={text}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => { if (e.key === 'Enter') send(); }}
        placeholder={
          fanMemoryPinned && fanMemoryId
            ? `Add a note about @${fanMemoryId}…`
            : hostUniqueId
              ? 'Add a note (saved to host — or pin a fan / @mention)…'
              : 'Add a note — pin a fan or @mention to save…'
        }
        className="h-8 min-w-0 flex-1 rounded-full border border-zinc-800 bg-zinc-900/70 px-3.5 text-xs text-zinc-100 outline-none transition placeholder:text-zinc-600 focus:border-like-500/50"
      />
      <div ref={emojiRef} className="relative">
        <IconBtn title="Emoji" onClick={() => setShowEmoji((v) => !v)}>😊</IconBtn>
        {showEmoji && (
          <div className="absolute bottom-10 right-0 z-40 flex gap-1 rounded-xl border border-zinc-800 bg-zinc-950/95 p-1.5 shadow-2xl backdrop-blur">
            {EMOJIS.map((e) => (
              <button
                key={e}
                onClick={() => { setText((t) => t + e); setShowEmoji(false); inputRef.current?.focus(); }}
                className="rounded-md px-1 text-base hover:bg-zinc-800"
              >
                {e}
              </button>
            ))}
          </div>
        )}
      </div>
      {highlightsOk && (
        <IconBtn title="Capture last 60s as highlight clip" onClick={capture}>⭐</IconBtn>
      )}
      <Tooltip content="View gifts feed (this opens the gifts tab — it does not send a gift)">
      <button
        onClick={() => setTab('gifts')}
        className="flex h-8 flex-none items-center gap-1 rounded-full px-2.5 text-[11px] font-medium text-zinc-400 transition hover:bg-zinc-800 hover:text-zinc-200"
      >
        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <rect x="3" y="8" width="18" height="13" rx="1" />
          <path d="M3 12h18M12 8v13M12 8a3 3 0 1 0-3-3 3 3 0 0 0 3 3zM12 8a3 3 0 1 1 3-3 3 3 0 0 1-3 3z" />
        </svg>
        Gifts
      </button>
      </Tooltip>
      <Tooltip content="Save note to the fan's timeline (private — the connector can't post to TikTok)">
      <button
        onClick={send}
        disabled={!text.trim()}
        aria-label="Save note to fan timeline"
        className="flex h-8 w-8 flex-none items-center justify-center rounded-full text-white transition disabled:opacity-40"
        style={{ background: 'var(--gradient-pink)' }}
      >
        <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><path d="M2.01 21L23 12 2.01 3 2 10l15 2-15 2z" /></svg>
      </button>
      </Tooltip>
      {flash && <span className="text-[10px] text-emerald-400">{flash}</span>}
    </div>
  );
}

function IconBtn({ title, onClick, children }: { title: string; onClick: () => void; children: React.ReactNode }) {
  return (
    <Tooltip content={title}>
      <button
        onClick={onClick}
        aria-label={title}
        className="flex h-8 w-8 flex-none items-center justify-center rounded-full text-sm text-zinc-400 transition hover:bg-zinc-800 hover:text-zinc-200"
      >
        {children}
      </button>
    </Tooltip>
  );
}
