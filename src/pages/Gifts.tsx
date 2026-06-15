/** Gifts — permanent gift ledger across all LIVEs + manual logging. */
import { useCallback, useEffect, useState } from 'react';
import type { ListGiftsResult } from '../types';
import { estimateMoney, formatNumber } from '../lib/format';
import { useAlerts } from '../state/alerts';
import { useSettingsLoad } from '../state/settings';
import { FanAvatar, Pager, PageShell, inputCls } from '../components/crm';
import { LogGiftModal } from '../components/LogGiftModal';

const RANGES = [
  { id: '7d', label: '7 days' },
  { id: '30d', label: '30 days' },
  { id: '90d', label: '90 days' },
  { id: 'all', label: 'All time' },
] as const;

type Range = (typeof RANGES)[number]['id'];

export function Gifts({ onGoLive }: { onGoLive: () => void }) {
  const pushToast = useAlerts((s) => s.pushToast);
  const [range, setRange] = useState<Range>('30d');
  const [fan, setFan] = useState('');
  const [page, setPage] = useState(1);
  const [resp, setResp] = useState<ListGiftsResult>({ data: [], total: 0, page: 1, pageSize: 25, diamondsWeek: 0, diamondsMonth: 0, diamondsAll: 0 });
  const [showLog, setShowLog] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const { earnings } = useSettingsLoad();

  const refresh = useCallback(() => {
    window.tiktok.giftsList({ range, fan: fan || undefined, page, pageSize: 25 })
      .then((r) => { setResp(r); setLoaded(true); })
      .catch(() => setLoaded(true));
  }, [range, fan, page]);

  useEffect(() => { refresh(); }, [refresh]);
  useEffect(() => { setPage(1); }, [range, fan]);

  const exportCsv = async () => {
    const r = await window.tiktok.giftsExportCsv({ range, fan: fan || undefined });
    if (r.ok) pushToast({ title: 'Gifts exported', body: r.path ? `Saved to ${r.path}` : 'CSV downloaded' });
    else if (r.canceled) return; // user closed the save dialog — not an error
    else if (r.error) pushToast({ title: 'Export failed', body: r.error });
  };

  const isEmpty = loaded && resp.diamondsAll === 0 && resp.total === 0 && !fan;

  // The summary cards above show fixed periods (week/month/all-time). The range
  // tabs below filter the table. Surface the total for the *selected* range so
  // the headline and the filter agree. 90d has no precomputed total, so we sum
  // the (full, un-paginated) page only when it fits — otherwise stay honest.
  const rangeLabel = RANGES.find((r) => r.id === range)?.label ?? '';
  const rangeTotal =
    range === '7d' ? resp.diamondsWeek
    : range === '30d' ? resp.diamondsMonth
    : range === 'all' ? resp.diamondsAll
    : null; // 90d: no precomputed total available

  return (
    <PageShell
      title="Gifts"
      subtitle="Every gift across your LIVEs — automatic from the stream, plus anything you log by hand."
      actions={
        <>
          <button onClick={exportCsv} className="panel-btn no-drag">Export CSV</button>
          <button onClick={() => setShowLog(true)} className="panel-btn panel-btn-primary no-drag">+ Log gift</button>
        </>
      }
    >
      {/* Totals header */}
      <div className="grid grid-cols-3 gap-3">
        {[
          { label: 'Diamonds this week', value: resp.diamondsWeek, tint: 'rgba(238, 29, 82, 0.14)' },
          { label: 'Diamonds this month', value: resp.diamondsMonth, tint: 'rgba(105, 201, 208, 0.18)' },
          { label: 'Diamonds all-time', value: resp.diamondsAll, tint: 'rgba(168, 85, 247, 0.16)' },
        ].map((s) => (
          <div key={s.label} className="glass brand-top-border flex items-center gap-3 p-4" style={{ borderRadius: 18 }}>
            <span className="flex h-11 w-11 flex-none items-center justify-center rounded-full" style={{ background: s.tint }}>
              <img src="./assets/png/icon_diamond_3d.png" alt="" className="h-7 w-7 object-contain" draggable={false} />
            </span>
            <div className="min-w-0">
              <div className="text-xs font-medium" style={{ color: 'var(--secondary-label)' }}>{s.label}</div>
              <div className="mt-0.5 truncate text-[22px] font-extrabold leading-tight tracking-tight">
                {formatNumber(s.value)} 💎
                {estimateMoney(s.value, earnings) && (
                  <span className="ml-1.5 text-[13px] font-semibold" style={{ color: 'var(--secondary-label)' }}>{estimateMoney(s.value, earnings)}</span>
                )}
              </div>
            </div>
          </div>
        ))}
      </div>

      {isEmpty ? (
        <div className="glass flex flex-1 flex-col items-center justify-center gap-3 p-10 text-center" style={{ borderRadius: 22 }}>
          <img src="./assets/png/icon_gift_box_3d.png" alt="" className="h-20 w-20 object-contain" draggable={false} />
          <h2 className="text-base font-extrabold">No gifts in the ledger yet</h2>
          <p className="max-w-sm text-[13px]" style={{ color: 'var(--secondary-label)' }}>
            Gifts are captured automatically while you&apos;re connected to a LIVE. You can also log off-stream gifts by hand.
          </p>
          <div className="flex gap-2">
            <button onClick={onGoLive} className="panel-btn panel-btn-primary no-drag">Connect to a LIVE</button>
            <button onClick={() => setShowLog(true)} className="panel-btn no-drag">Log a gift</button>
          </div>
        </div>
      ) : (
        <div className="glass flex min-h-0 flex-col p-4" style={{ borderRadius: 18 }}>
          <div className="flex flex-wrap items-center gap-2 pb-3">
            <div className="flex items-center gap-1">
              {RANGES.map((r) => (
                <button
                  key={r.id}
                  onClick={() => setRange(r.id)}
                  className={`panel-btn no-drag ${range === r.id ? 'panel-btn-active' : ''}`}
                >
                  {r.label}
                </button>
              ))}
            </div>
            <span
              className="flex h-7 items-center gap-1.5 rounded-full px-3 text-[12px] font-semibold"
              style={{ background: 'var(--fill-thin)', border: '1px solid var(--card-border)', color: 'var(--secondary-label)' }}
              title={`Total diamonds in the ${rangeLabel.toLowerCase()} view`}
            >
              {rangeLabel}:&nbsp;
              {rangeTotal !== null ? (
                <strong style={{ color: 'var(--label, inherit)' }}>{formatNumber(rangeTotal)} 💎</strong>
              ) : (
                <strong style={{ color: 'var(--label, inherit)' }}>{formatNumber(resp.total)} gifts</strong>
              )}
            </span>
            <input value={fan} onChange={(e) => setFan(e.target.value)} placeholder="Filter by fan…" className={`${inputCls} !w-52 ml-auto`} />
          </div>

          {resp.data.length === 0 ? (
            <div className="py-10 text-center text-[13px]" style={{ color: 'var(--secondary-label)' }}>
              No gifts match these filters.
            </div>
          ) : (
            <table className="w-full text-left text-[13px]">
              <thead>
                <tr className="text-[11px] uppercase tracking-wider" style={{ color: 'var(--secondary-label)' }}>
                  <th className="pb-2">Date</th>
                  <th className="pb-2">Fan</th>
                  <th className="pb-2">Gift</th>
                  <th className="pb-2 text-right">Diamonds</th>
                  <th className="pb-2 pl-4">Source</th>
                </tr>
              </thead>
              <tbody>
                {resp.data.map((g) => (
                  <tr key={g.id} className="border-t" style={{ borderColor: 'var(--separator)' }}>
                    <td className="py-2 text-[12px]" style={{ color: 'var(--secondary-label)' }}>
                      {new Date(g.at).toLocaleString(undefined, { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}
                    </td>
                    <td className="py-2">
                      <span className="flex items-center gap-2">
                        <FanAvatar name={g.fanNickname || g.fanUniqueId} size={26} />
                        <span className="min-w-0 leading-tight">
                          <span className="block truncate font-semibold">{g.fanNickname}</span>
                          <span className="block text-[11px]" style={{ color: 'var(--secondary-label)' }}>@{g.fanUniqueId}</span>
                        </span>
                      </span>
                    </td>
                    <td className="py-2">{g.giftName}{g.repeatCount > 1 ? ` ×${g.repeatCount}` : ''}</td>
                    <td className="py-2 text-right font-bold tabular-nums">{formatNumber(g.diamonds)} 💎</td>
                    <td className="py-2 pl-4 text-[12px]" style={{ color: 'var(--secondary-label)' }}>
                      {(() => {
                        if (g.manual) return 'Manual';
                        if (g.sessionId?.startsWith('multi:')) return `Multi-room · @${g.sessionId.slice(6)}`;
                        const host = g.sessionId?.split('-').slice(1).join('-');
                        return host && /[a-z]/i.test(host) ? `LIVE · @${host}` : 'LIVE';
                      })()}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
          <Pager page={resp.page} pageSize={resp.pageSize} total={resp.total} onPage={setPage} />
        </div>
      )}

      {showLog && (
        <LogGiftModal
          onClose={() => setShowLog(false)}
          onLogged={() => {
            setShowLog(false);
            pushToast({ title: 'Gift logged', body: 'Added to the ledger' });
            refresh();
          }}
        />
      )}
    </PageShell>
  );
}
