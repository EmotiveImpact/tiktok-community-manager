import { useEffect, useMemo, useState } from 'react';
import type { SessionSummary } from '../types';
import { formatNumber } from '../lib/format';
import { PanelHeader, PanelShell } from './PanelHeader';
import { Select, Tooltip } from './ui';

const ALL_HOSTS = '__all__';

export function CreatorAnalytics({ onClose }: { onClose: () => void }) {
  const [sessions, setSessions] = useState<SessionSummary[]>([]);
  const [host, setHost] = useState('');

  useEffect(() => {
    window.tiktok.sessionsList().then(setSessions);
  }, []);

  const hosts = useMemo(() => {
    const map = new Map<string, { nickname: string; count: number }>();
    for (const s of sessions) {
      const e = map.get(s.hostUniqueId) ?? { nickname: s.hostNickname, count: 0 };
      e.count++;
      map.set(s.hostUniqueId, e);
    }
    return [...map.entries()].sort((a, b) => b[1].count - a[1].count);
  }, [sessions]);

  const filtered = useMemo(() => {
    if (!host) return sessions;
    return sessions.filter((s) => s.hostUniqueId === host).sort((a, b) => a.startedAt - b.startedAt);
  }, [sessions, host]);

  const totals = useMemo(() => {
    return filtered.reduce(
      (acc, s) => ({
        comments: acc.comments + s.totals.comments,
        likes: acc.likes + s.totals.likes,
        diamonds: acc.diamonds + s.totals.diamonds,
        gifts: acc.gifts + s.totals.gifts,
        follows: acc.follows + s.totals.follows,
        peakViewers: Math.max(acc.peakViewers, s.totals.peakViewers),
        sessions: acc.sessions + 1,
        totalMinutes: acc.totalMinutes + Math.round(((s.endedAt ?? Date.now()) - s.startedAt) / 60000),
      }),
      { comments: 0, likes: 0, diamonds: 0, gifts: 0, follows: 0, peakViewers: 0, sessions: 0, totalMinutes: 0 },
    );
  }, [filtered]);

  const maxComments = Math.max(...filtered.map((s) => s.totals.comments), 1);
  const maxDiamonds = Math.max(...filtered.map((s) => s.totals.diamonds), 1);
  const maxViewers = Math.max(...filtered.map((s) => s.totals.peakViewers), 1);

  return (
    <PanelShell>
      <PanelHeader title="Creator Analytics" onClose={onClose}>
        <Select
          value={host === '' ? ALL_HOSTS : host}
          onValueChange={(v) => setHost(v === ALL_HOSTS ? '' : v)}
          ariaLabel="Filter by creator"
          options={[
            { value: ALL_HOSTS, label: 'All creators' },
            ...hosts.map(([uid, { nickname, count }]) => ({ value: uid, label: `${nickname} (${count} sessions)` })),
          ]}
        />
      </PanelHeader>

      <div className="grid grid-cols-4 gap-3 border-b border-zinc-800 p-4">
        <StatCard label="Total Sessions" value={String(totals.sessions)} />
        <StatCard label="Total Time" value={`${Math.floor(totals.totalMinutes / 60)}h ${totals.totalMinutes % 60}m`} />
        <StatCard label="Total Diamonds" value={formatNumber(totals.diamonds)} accent="text-amber-300" />
        <StatCard label="Peak Viewers" value={formatNumber(totals.peakViewers)} accent="text-cyan-400" />
        <StatCard label="Total Comments" value={formatNumber(totals.comments)} />
        <StatCard label="Total Likes" value={formatNumber(totals.likes)} accent="text-like-400" />
        <StatCard label="Total Gifts" value={formatNumber(totals.gifts)} accent="text-emerald-300" />
        <StatCard label="Total Follows" value={formatNumber(totals.follows)} />
      </div>

      <div className="flex-1 overflow-y-auto p-4">
        {filtered.length === 0 ? (
          <div className="flex h-full items-center justify-center text-sm text-zinc-600">
            No sessions recorded yet.
          </div>
        ) : (
          <div className="flex flex-col gap-6">
            <ChartSection label="Comments per session" data={filtered} getValue={(s) => s.totals.comments} max={maxComments} color="bg-like-500" />
            <ChartSection label="Diamonds per session" data={filtered} getValue={(s) => s.totals.diamonds} max={maxDiamonds} color="bg-amber-400" />
            <ChartSection label="Peak viewers per session" data={filtered} getValue={(s) => s.totals.peakViewers} max={maxViewers} color="bg-cyan-400" />
          </div>
        )}
      </div>
    </PanelShell>
  );
}

function StatCard({ label, value, accent }: { label: string; value: string; accent?: string }) {
  return (
    <div className="glass rounded-lg px-3 py-2.5 text-center">
      <div className={`text-lg font-bold tabular-nums ${accent ?? 'text-zinc-200'}`}>{value}</div>
      <div className="text-[10px] uppercase tracking-wider text-zinc-500">{label}</div>
    </div>
  );
}

function ChartSection({ label, data, getValue, max, color }: {
  label: string;
  data: SessionSummary[];
  getValue: (s: SessionSummary) => number;
  max: number;
  color: string;
}) {
  return (
    <div>
      <div className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-zinc-500">{label}</div>
      <div className="flex items-end gap-1" style={{ height: 120 }}>
        {data.map((s) => {
          const val = getValue(s);
          const pct = Math.max((val / max) * 100, 2);
          return (
            <Tooltip key={s.id} content={`${s.hostNickname} — ${new Date(s.startedAt).toLocaleDateString()}: ${formatNumber(val)}`}>
              <div className="flex-1 flex flex-col items-center gap-1 min-w-0">
              <div className={`w-full rounded-t ${color} transition-all`} style={{ height: `${pct}%` }} />
              <span className="text-[8px] text-zinc-600 truncate w-full text-center">
                {new Date(s.startedAt).toLocaleDateString([], { month: 'short', day: 'numeric' })}
              </span>
              </div>
            </Tooltip>
          );
        })}
      </div>
    </div>
  );
}
