import { useEffect, useMemo, useRef, useState } from 'react';
import { useStore } from '../state/store';
import { PanelHeader, PanelShell } from './PanelHeader';

export function TranscriptPanel({ onClose }: { onClose: () => void }) {
  const captions = useStore((s) => s.captions);
  const room = useStore((s) => s.roomInfo);
  const status = useStore((s) => s.status);
  const [filter, setFilter] = useState('');
  const [autoScroll, setAutoScroll] = useState(true);
  const scrollRef = useRef<HTMLDivElement | null>(null);

  const filtered = useMemo(() => {
    const q = filter.trim().toLowerCase();
    const ordered = [...captions].reverse();
    if (!q) return ordered;
    return ordered.filter((c) => c.type === 'caption' && c.text.toLowerCase().includes(q));
  }, [captions, filter]);

  useEffect(() => {
    if (!autoScroll || !scrollRef.current) return;
    scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
  }, [filtered, autoScroll]);

  const copyAll = async () => {
    const text = filtered
      .filter((c) => c.type === 'caption')
      .map((c) => {
        const t = new Date(c.ts).toLocaleTimeString();
        return `[${t}] ${(c as any).text}`;
      })
      .join('\n');
    await navigator.clipboard.writeText(text);
  };

  return (
    <PanelShell>
      <PanelHeader
        title="Live Transcript"
        badge={captions.length}
        onClose={onClose}
        actions={
          <button
            onClick={copyAll}
            disabled={filtered.length === 0}
            className="panel-btn panel-btn-secondary"
          >
            Copy all
          </button>
        }
      >
        <input
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          placeholder="Search transcript…"
          className="h-7 w-56 rounded-md border border-zinc-700 bg-zinc-900 px-2.5 text-xs text-zinc-100 outline-none focus:border-like-500/60"
        />
        <label className="flex cursor-pointer items-center gap-1.5 text-xs text-zinc-400">
          <input
            type="checkbox"
            checked={autoScroll}
            onChange={(e) => setAutoScroll(e.target.checked)}
            className="accent-like-500"
          />
          Auto-scroll
        </label>
      </PanelHeader>

      <div ref={scrollRef} className="flex-1 overflow-y-auto p-6">
        {captions.length === 0 ? (
          <EmptyState status={status} hostNickname={room?.hostNickname} />
        ) : filtered.length === 0 ? (
          <div className="flex h-full items-center justify-center text-sm text-zinc-600">
            No captions match "{filter}"
          </div>
        ) : (
          <div className="mx-auto max-w-3xl">
            <ul className="flex flex-col gap-3 text-[15px] leading-relaxed">
              {filtered.map((c) => {
                if (c.type !== 'caption') return null;
                const time = new Date(c.ts).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
                const text = highlightMatch(c.text, filter);
                return (
                  <li key={c.id} className="flex items-baseline gap-3">
                    <span className="w-20 flex-none font-mono text-[11px] text-zinc-600">{time}</span>
                    <span className="flex-1 text-zinc-200">{text}</span>
                    {c.lang && c.lang !== 'en' && c.lang !== 'unknown' && (
                      <span className="flex-none rounded-full bg-zinc-900 px-2 py-0.5 text-[10px] font-semibold uppercase text-zinc-500">
                        {c.lang}
                      </span>
                    )}
                  </li>
                );
              })}
            </ul>
          </div>
        )}
      </div>
    </PanelShell>
  );
}

function EmptyState({ status, hostNickname }: { status: string; hostNickname?: string }) {
  return (
    <div className="mx-auto flex max-w-md flex-col items-center justify-center gap-3 py-24 text-center">
      <div className="text-4xl">🎙️</div>
      <div className="text-sm font-semibold text-zinc-200">No captions yet</div>
      <div className="text-xs leading-relaxed text-zinc-500">
        {status === 'connected'
          ? `${hostNickname ?? 'The creator'} hasn't enabled live captions, or hasn't spoken yet. TikTok pushes captions only when the host turns on the in-app caption feature.`
          : 'Connect to a TikTok Live room. If the host has captions enabled, their spoken words will appear here in real time.'}
      </div>
    </div>
  );
}

function highlightMatch(text: string, query: string) {
  const q = query.trim();
  if (!q) return text;
  const lower = text.toLowerCase();
  const ql = q.toLowerCase();
  const idx = lower.indexOf(ql);
  if (idx === -1) return text;
  return (
    <>
      {text.slice(0, idx)}
      <mark className="bg-like-500/30 text-like-300">{text.slice(idx, idx + q.length)}</mark>
      {text.slice(idx + q.length)}
    </>
  );
}
