import { useEffect, useMemo, useState } from 'react';
import type { SessionRecord, SessionSummary, SearchHit } from '../types';
import { formatNumber, timeAgo } from '../lib/format';
import { PanelHeader, PanelShell } from './PanelHeader';

function dateLabel(ts: number): string {
  const d = new Date(ts);
  return d.toLocaleString();
}

function durationLabel(rec: { startedAt: number; endedAt: number | null }): string {
  const end = rec.endedAt ?? Date.now();
  const ms = end - rec.startedAt;
  const m = Math.floor(ms / 60000);
  if (m < 60) return `${m}m`;
  return `${Math.floor(m / 60)}h ${m % 60}m`;
}

export function HistoryView({ onClose }: { onClose: () => void }) {
  const [sessions, setSessions] = useState<SessionSummary[]>([]);
  const [selected, setSelected] = useState<SessionRecord | null>(null);
  const [search, setSearch] = useState('');
  const [hits, setHits] = useState<SearchHit[]>([]);
  const [hostFilter, setHostFilter] = useState('');

  const refresh = async () => {
    setSessions(await window.tiktok.sessionsList());
  };

  useEffect(() => {
    refresh();
  }, []);

  useEffect(() => {
    const t = setTimeout(async () => {
      if (search.trim().length < 2) {
        setHits([]);
        return;
      }
      setHits(await window.tiktok.sessionsSearch(search));
    }, 300);
    return () => clearTimeout(t);
  }, [search]);

  const filteredSessions = useMemo(() => {
    if (!hostFilter.trim()) return sessions;
    const q = hostFilter.toLowerCase();
    return sessions.filter(
      (s) =>
        s.hostNickname.toLowerCase().includes(q) ||
        s.hostUniqueId.toLowerCase().includes(q),
    );
  }, [sessions, hostFilter]);

  return (
    <PanelShell>
      <PanelHeader title="Session History" badge={sessions.length} onClose={onClose}>
        <input
          value={hostFilter}
          onChange={(e) => setHostFilter(e.target.value)}
          placeholder="Filter by host…"
          className="h-7 w-40 rounded-md border border-zinc-700 bg-zinc-900 px-2.5 text-xs text-zinc-100 outline-none focus:border-like-500/60"
        />
        <input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search comments across all sessions…"
          className="h-7 w-72 rounded-md border border-zinc-700 bg-zinc-900 px-2.5 text-xs text-zinc-100 outline-none focus:border-like-500/60"
        />
      </PanelHeader>

      <div className="grid flex-1 grid-cols-[320px_1fr] overflow-hidden">
        <aside className="overflow-y-auto border-r border-zinc-800">
          {hits.length > 0 && (
            <div className="border-b border-zinc-800/80 bg-like-500/5 p-2">
              <div className="mb-1 text-[10px] font-semibold uppercase tracking-wider text-like-400">
                Search results ({hits.length})
              </div>
              <ul className="flex flex-col gap-1">
                {hits.slice(0, 50).map((h, i) => (
                  <li
                    key={i}
                    className="cursor-pointer rounded-lg px-2 py-1.5 text-xs transition hover:bg-zinc-800/60"
                    onClick={async () => {
                      const rec = await window.tiktok.sessionsGet(h.sessionId);
                      if (rec) setSelected(rec);
                    }}
                  >
                    <div className="flex items-baseline justify-between">
                      <span className="truncate font-semibold text-zinc-200">{h.user}</span>
                      <span className="text-[10px] text-zinc-500">{timeAgo(h.ts)}</span>
                    </div>
                    <div className="truncate text-zinc-400">{h.comment}</div>
                    <div className="text-[10px] text-zinc-600">in @{h.hostNickname}</div>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {filteredSessions.length === 0 ? (
            <div className="flex h-full items-center justify-center p-6 text-center text-sm text-zinc-600">
              No sessions yet. Connect to a Live to start recording.
            </div>
          ) : (
            <ul>
              {filteredSessions.map((s) => (
                <li
                  key={s.id}
                  onClick={async () => {
                    const rec = await window.tiktok.sessionsGet(s.id);
                    if (rec) setSelected(rec);
                  }}
                  className={`cursor-pointer border-b border-zinc-900 px-3 py-2.5 transition hover:bg-zinc-900/60 ${
                    selected?.id === s.id ? 'border-l-2 border-l-like-500 bg-like-500/5' : 'border-l-2 border-l-transparent'
                  }`}
                >
                  <div className="flex items-baseline justify-between gap-2">
                    <span className="truncate text-sm font-semibold text-zinc-100">
                      @{s.hostUniqueId}
                    </span>
                    <span className="flex-none text-[11px] text-zinc-500">
                      {durationLabel(s)}
                    </span>
                  </div>
                  <div className="text-[11px] text-zinc-500">{dateLabel(s.startedAt)}</div>
                  {s.roomTitle && (
                    <div className="truncate text-[11px] text-zinc-400">{s.roomTitle}</div>
                  )}
                  <div className="mt-1 flex flex-wrap gap-3 text-[11px] tabular-nums">
                    <span className="text-like-400">{formatNumber(s.totals.likes)} likes</span>
                    <span className="text-amber-300">{formatNumber(s.totals.diamonds)} 💎</span>
                    <span className="text-zinc-500">{formatNumber(s.totals.comments)} msgs</span>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </aside>

        <main className="overflow-y-auto">
          {!selected ? (
            <div className="flex h-full items-center justify-center text-sm text-zinc-600">
              Select a session to view comments
            </div>
          ) : (
            <SessionDetail
              record={selected}
              onDelete={async () => {
                if (!confirm('Delete this session?')) return;
                await window.tiktok.sessionsDelete(selected.id);
                setSelected(null);
                refresh();
              }}
            />
          )}
        </main>
      </div>
    </PanelShell>
  );
}

function SessionDetail({ record, onDelete }: { record: SessionRecord; onDelete: () => void }) {
  const comments = record.events.filter((e) => e.type === 'chat');
  const gifts = record.events.filter((e) => e.type === 'gift');
  const questions = record.events.filter((e) => e.type === 'questionNew');
  const [summary, setSummary] = useState<string | null>(null);
  const [summaryLoading, setSummaryLoading] = useState(false);
  const [summaryError, setSummaryError] = useState<string | null>(null);
  const [showExport, setShowExport] = useState(false);
  const [exportMsg, setExportMsg] = useState<string | null>(null);

  useEffect(() => {
    setSummary(null);
    setSummaryError(null);
  }, [record.id]);

  const runSummary = async () => {
    setSummaryLoading(true);
    setSummaryError(null);
    setSummary(null);
    const res = await window.tiktok.summarizeSession(record.id);
    setSummaryLoading(false);
    if (res.ok && res.summary) setSummary(res.summary);
    else setSummaryError(res.error ?? 'Unknown error');
  };

  return (
    <div className="flex h-full flex-col">
      <header className="flex items-baseline gap-3 border-b border-zinc-800 py-4 pl-[82px] pr-5">
        <div className="flex-1">
          <div className="text-lg font-bold text-zinc-100">{record.hostNickname}</div>
          <div className="text-xs text-zinc-500">
            @{record.hostUniqueId} · {dateLabel(record.startedAt)} · {durationLabel(record)}
          </div>
          {record.roomTitle && (
            <div className="mt-1 text-sm text-zinc-300">{record.roomTitle}</div>
          )}
        </div>
        <button
          onClick={runSummary}
          disabled={summaryLoading}
          className="rounded-lg bg-gradient-to-r from-like-500 to-like-600 px-3 py-1.5 text-xs font-medium text-white shadow-lg shadow-like-500/20 disabled:opacity-50"
        >
          {summaryLoading ? 'Summarising…' : 'AI Summary'}
        </button>
        <div className="relative">
          <button
            onClick={() => setShowExport((v) => !v)}
            className="rounded-lg border border-zinc-800 bg-zinc-900 px-3 py-1.5 text-xs text-zinc-300 hover:bg-zinc-800"
          >
            Export
          </button>
          {showExport && (
            <div className="absolute right-0 top-8 z-10 w-44 rounded-xl border border-zinc-800/60 bg-zinc-950/95 py-1.5 shadow-2xl backdrop-blur">
              {(['comments', 'gifts', 'all', 'summary'] as const).map((type) => (
                <button
                  key={type}
                  onClick={async () => {
                    setShowExport(false);
                    const res = await window.tiktok.sessionsExport(record.id, type);
                    if (res.ok) {
                      setExportMsg(`Exported ${type}`);
                    } else {
                      setExportMsg(res.error ?? 'Export cancelled');
                    }
                    setTimeout(() => setExportMsg(null), 2000);
                  }}
                  className="block w-full px-3 py-2 text-left text-xs text-zinc-300 transition hover:bg-zinc-800/80"
                >
                  {type === 'comments' ? 'Comments (CSV)' : type === 'gifts' ? 'Gifts (CSV)' : type === 'all' ? 'All events (CSV)' : 'Summary (TXT)'}
                </button>
              ))}
            </div>
          )}
        </div>
        <button
          onClick={() => window.tiktok.openProfileInternal(record.hostUniqueId)}
          className="rounded-lg border border-zinc-800 bg-zinc-900 px-3 py-1.5 text-xs text-zinc-300 hover:bg-zinc-800"
        >
          Open profile
        </button>
        <button
          onClick={onDelete}
          className="rounded-lg border border-zinc-800 bg-zinc-900 px-3 py-1.5 text-xs text-rose-300 hover:bg-zinc-800"
        >
          Delete
        </button>
      </header>

      {exportMsg && (
        <div className="border-b border-zinc-800 bg-emerald-900/20 px-5 py-2 text-xs text-emerald-300">
          {exportMsg}
        </div>
      )}

      {(summary || summaryError) && (
        <div className="border-b border-zinc-800 px-5 py-3">
          {summaryError && (
            <div className="text-xs text-rose-300">Summary failed: {summaryError}</div>
          )}
          {summary && (
            <div className="rounded-lg border border-like-500/15 bg-gradient-to-br from-like-500/5 to-purple-500/3 p-4">
              <div className="mb-1.5 text-[11px] font-semibold uppercase tracking-wider text-like-400">AI Summary</div>
              <div className="whitespace-pre-wrap text-sm leading-relaxed text-zinc-300">
                {summary}
              </div>
            </div>
          )}
        </div>
      )}

      <div className="grid grid-cols-4 gap-2 border-b border-zinc-800 px-5 py-3">
        <Tile label="Comments" value={record.totals.comments} accent="text-zinc-200" />
        <Tile label="Likes" value={record.totals.likes} accent="text-like-400" />
        <Tile label="Diamonds" value={record.totals.diamonds} accent="text-amber-300" />
        <Tile label="Peak viewers" value={record.totals.peakViewers} accent="text-blue-300" />
        <Tile label="Gifts" value={record.totals.gifts} accent="text-emerald-300" />
        <Tile label="Follows" value={record.totals.follows} accent="text-sky-300" />
        <Tile label="Subs" value={record.totals.subs} accent="text-purple-300" />
        <Tile label="Q&amp;A" value={record.totals.questions} accent="text-violet-300" />
      </div>

      <div className="grid flex-1 grid-cols-[2fr_1fr] gap-3 overflow-hidden p-3">
        <div className="glass flex flex-col overflow-hidden rounded-lg">
          <div className="border-b border-zinc-800/50 px-3 py-1.5 text-[11px] font-semibold uppercase tracking-wider text-zinc-500">
            Comments ({comments.length})
          </div>
          <ul className="flex-1 overflow-y-auto p-2">
            {comments.map((c, i) => (
              <li key={i} className="flex items-baseline gap-2 rounded px-1.5 py-1 text-sm hover:bg-zinc-800/40">
                <span className="w-16 flex-none text-[10px] text-zinc-600">
                  {new Date(c.ts).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                </span>
                <span className="w-32 flex-none truncate text-zinc-400">{c.user?.nickname}</span>
                <span className="min-w-0 flex-1 break-words text-zinc-200">{c.comment}</span>
              </li>
            ))}
            {comments.length === 0 && (
              <li className="p-4 text-center text-xs text-zinc-600">No comments captured</li>
            )}
          </ul>
        </div>

        <div className="flex flex-col gap-3 overflow-hidden">
          <div className="glass flex flex-1 flex-col overflow-hidden rounded-lg">
            <div className="border-b border-zinc-800/50 px-3 py-1.5 text-[11px] font-semibold uppercase tracking-wider text-zinc-500">
              Gifts ({gifts.length})
            </div>
            <ul className="flex-1 overflow-y-auto p-2 text-xs">
              {gifts.map((g, i) => (
                <li key={i} className="flex items-baseline gap-2 rounded px-1 py-0.5 hover:bg-zinc-800/40">
                  <span className="w-16 flex-none text-[10px] text-zinc-600">
                    {new Date(g.ts).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                  </span>
                  <span className="truncate text-zinc-300">
                    {g.user?.nickname} · {g.giftName}
                    {g.repeatCount && g.repeatCount > 1 ? ` ×${g.repeatCount}` : ''}
                  </span>
                </li>
              ))}
              {gifts.length === 0 && (
                <li className="p-3 text-center text-zinc-600">None</li>
              )}
            </ul>
          </div>
          <div className="glass flex flex-1 flex-col overflow-hidden rounded-lg">
            <div className="border-b border-zinc-800/50 px-3 py-1.5 text-[11px] font-semibold uppercase tracking-wider text-zinc-500">
              Q&amp;A ({questions.length})
            </div>
            <ul className="flex-1 overflow-y-auto p-2 text-xs">
              {questions.map((q, i) => (
                <li key={i} className="rounded px-1 py-0.5 hover:bg-zinc-800/40">
                  <div className="text-zinc-400">{q.user?.nickname}</div>
                  <div className="text-zinc-200">{q.question}</div>
                </li>
              ))}
              {questions.length === 0 && (
                <li className="p-3 text-center text-zinc-600">None</li>
              )}
            </ul>
          </div>
        </div>
      </div>
    </div>
  );
}

function Tile({ label, value, accent }: { label: string; value: number; accent?: string }) {
  return (
    <div className="rounded-lg border border-zinc-800/60 bg-zinc-900/40 px-3 py-2 text-center">
      <div className={`text-base font-bold tabular-nums ${accent ?? 'text-zinc-200'}`}>
        {formatNumber(value)}
      </div>
      <div className="text-[10px] uppercase tracking-wider text-zinc-500">{label}</div>
    </div>
  );
}
