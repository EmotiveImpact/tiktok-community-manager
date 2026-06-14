/**
 * Bottom composer of the live feed. The connector is READ-ONLY (we cannot
 * post to TikTok chat) — this is a STREAM NOTES box: sending appends a
 * timestamped personal note into the feed. When the note mentions
 * @username and that fan exists in the ledger, the note is also appended
 * to their fan notes.
 */
import { useEffect, useRef, useState } from 'react';
import { useUI } from '../state/ui';

const EMOJIS = ['💖', '🔥', '😂', '🎉', '🙏', '⭐', '💎', '🎁'];

export function NoteComposer() {
  const addStreamNote = useUI((s) => s.addStreamNote);
  const setTab = useUI((s) => s.setTab);
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
    setText('');
    // Sync to fan notes when an @mention matches a ledger fan.
    let syncedTo: string | undefined;
    const mention = t.match(/@([\w.]+)/);
    if (mention) {
      try {
        const fan = await window.tiktok.fansGet(mention[1]);
        if (fan) {
          const stamp = new Date().toLocaleString(undefined, { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
          const appended = `${fan.notes ? fan.notes + '\n' : ''}[LIVE ${stamp}] ${t}`;
          await window.tiktok.fansUpdate(fan.uniqueId, { notes: appended });
          syncedTo = fan.uniqueId;
        }
      } catch { /* note still kept locally */ }
    }
    addStreamNote(t, syncedTo);
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
        placeholder="Add a note for this stream…"
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
      <button
        title="View gifts feed (this opens the gifts tab — it does not send a gift)"
        onClick={() => setTab('gifts')}
        className="flex h-8 flex-none items-center gap-1 rounded-full px-2.5 text-[11px] font-medium text-zinc-400 transition hover:bg-zinc-800 hover:text-zinc-200"
      >
        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <rect x="3" y="8" width="18" height="13" rx="1" />
          <path d="M3 12h18M12 8v13M12 8a3 3 0 1 0-3-3 3 3 0 0 0 3 3zM12 8a3 3 0 1 1 3-3 3 3 0 0 1-3 3z" />
        </svg>
        Gifts
      </button>
      <button
        onClick={send}
        disabled={!text.trim()}
        title="Save note (notes are private — the connector can't post to TikTok)"
        aria-label="Save stream note"
        className="flex h-8 w-8 flex-none items-center justify-center rounded-full text-white shadow-[0_2px_8px_rgba(238,29,82,0.35)] transition disabled:opacity-40"
        style={{ background: 'var(--gradient-pink)' }}
      >
        <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><path d="M2.01 21L23 12 2.01 3 2 10l15 2-15 2z" /></svg>
      </button>
      {flash && <span className="text-[10px] text-emerald-400">{flash}</span>}
    </div>
  );
}

function IconBtn({ title, onClick, children }: { title: string; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      onClick={onClick}
      title={title}
      aria-label={title}
      className="flex h-8 w-8 flex-none items-center justify-center rounded-full text-sm text-zinc-400 transition hover:bg-zinc-800 hover:text-zinc-200"
    >
      {children}
    </button>
  );
}
