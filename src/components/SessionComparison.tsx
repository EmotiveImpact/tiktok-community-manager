import { useEffect, useState } from 'react';
import type { SessionSummary } from '../types';
import { formatNumber } from '../lib/format';
import { PanelHeader, PanelShell } from './PanelHeader';

function delta(a: number, b: number): { label: string; color: string } {
  if (b === 0) return { label: '-', color: 'text-zinc-500' };
  const pct = ((a - b) / b) * 100;
  if (pct > 0) return { label: `+${pct.toFixed(0)}%`, color: 'text-emerald-400' };
  if (pct < 0) return { label: `${pct.toFixed(0)}%`, color: 'text-rose-400' };
  return { label: '0%', color: 'text-zinc-500' };
}

export function SessionComparison({ onClose }: { onClose: () => void }) {
  const [sessions, setSessions] = useState<SessionSummary[]>([]);
  const [leftId, setLeftId] = useState<string>('');
  const [rightId, setRightId] = useState<string>('');

  useEffect(() => {
    window.tiktok.sessionsList().then(setSessions);
  }, []);

  const left = sessions.find((s) => s.id === leftId);
  const right = sessions.find((s) => s.id === rightId);

  const metrics: { label: string; key: keyof SessionSummary['totals'] }[] = [
    { label: 'Comments', key: 'comments' },
    { label: 'Likes', key: 'likes' },
    { label: 'Diamonds', key: 'diamonds' },
    { label: 'Gifts', key: 'gifts' },
    { label: 'Follows', key: 'follows' },
    { label: 'Peak Viewers', key: 'peakViewers' },
    { label: 'Subs', key: 'subs' },
    { label: 'Q&A', key: 'questions' },
  ];

  return (
    <PanelShell>
      <PanelHeader title="Session Comparison" onClose={onClose} />

      <div className="flex gap-4 p-4 border-b border-zinc-800">
        <div className="flex-1">
          <label className="mb-1 block text-[10px] font-semibold uppercase tracking-wider text-zinc-500">Session A</label>
          <select value={leftId} onChange={(e) => setLeftId(e.target.value)} className="w-full rounded-lg border border-zinc-800 bg-zinc-900 px-3 py-1.5 text-sm text-zinc-200 outline-none">
            <option value="">Select session…</option>
            {sessions.map((s) => (
              <option key={s.id} value={s.id}>
                {s.hostNickname} — {new Date(s.startedAt).toLocaleDateString()}
              </option>
            ))}
          </select>
        </div>
        <div className="flex items-end pb-1.5 text-xs font-semibold text-zinc-600">vs</div>
        <div className="flex-1">
          <label className="mb-1 block text-[10px] font-semibold uppercase tracking-wider text-zinc-500">Session B</label>
          <select value={rightId} onChange={(e) => setRightId(e.target.value)} className="w-full rounded-lg border border-zinc-800 bg-zinc-900 px-3 py-1.5 text-sm text-zinc-200 outline-none">
            <option value="">Select session…</option>
            {sessions.map((s) => (
              <option key={s.id} value={s.id}>
                {s.hostNickname} — {new Date(s.startedAt).toLocaleDateString()}
              </option>
            ))}
          </select>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto p-4">
        {left && right ? (
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-zinc-800 text-[11px] uppercase tracking-wider text-zinc-500">
                <th className="px-3 py-2 text-left">Metric</th>
                <th className="px-3 py-2 text-right">{left.hostNickname}</th>
                <th className="px-3 py-2 text-center w-20">Delta</th>
                <th className="px-3 py-2 text-right">{right.hostNickname}</th>
              </tr>
            </thead>
            <tbody>
              {metrics.map(({ label, key }) => {
                const lv = left.totals[key];
                const rv = right.totals[key];
                const d = delta(lv, rv);
                return (
                  <tr key={key} className="border-b border-zinc-900 transition hover:bg-zinc-900/40">
                    <td className="px-3 py-2.5 text-zinc-400">{label}</td>
                    <td className="px-3 py-2.5 text-right font-bold tabular-nums text-zinc-200">{formatNumber(lv)}</td>
                    <td className={`px-3 py-2.5 text-center tabular-nums text-xs font-bold ${d.color}`}>{d.label}</td>
                    <td className="px-3 py-2.5 text-right font-bold tabular-nums text-zinc-200">{formatNumber(rv)}</td>
                  </tr>
                );
              })}
              <tr className="border-b border-zinc-900">
                <td className="px-3 py-2.5 text-zinc-400">Duration</td>
                <td className="px-3 py-2.5 text-right font-medium text-zinc-200">{Math.round(((left.endedAt ?? Date.now()) - left.startedAt) / 60000)}m</td>
                <td className="px-3 py-2.5" />
                <td className="px-3 py-2.5 text-right font-medium text-zinc-200">{Math.round(((right.endedAt ?? Date.now()) - right.startedAt) / 60000)}m</td>
              </tr>
            </tbody>
          </table>
        ) : (
          <div className="flex h-full items-center justify-center text-sm text-zinc-600">
            Select two sessions above to compare.
          </div>
        )}
      </div>
    </PanelShell>
  );
}
