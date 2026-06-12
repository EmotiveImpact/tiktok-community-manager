/** Followers — the fan CRM table. Search, tag/tier filters, bulk tag, add fan, detail drawer. */
import { useCallback, useEffect, useState } from 'react';
import type { Fan, ListFansResult, Tier } from '../types';
import { formatNumber, daysAgoLabel } from '../lib/format';
import { TIERS } from '../lib/tier';
import { useAlerts } from '../state/alerts';
import { FanAvatar, TierChip, TagChip, Pager, PageShell, FieldLabel, inputCls, fanName, birthdayValid } from '../components/crm';
import { FanDrawer } from '../components/FanDrawer';

type Props = { onGoImport: () => void; onGoLive: () => void };

export function Followers({ onGoImport, onGoLive }: Props) {
  const pushToast = useAlerts((s) => s.pushToast);
  const [q, setQ] = useState('');
  const [tag, setTag] = useState('');
  const [tier, setTier] = useState<Tier | ''>('');
  const [page, setPage] = useState(1);
  const [resp, setResp] = useState<ListFansResult>({ data: [], total: 0, page: 1, pageSize: 25, allTags: [] });
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [openFan, setOpenFan] = useState<string | null>(null);
  const [showAdd, setShowAdd] = useState(false);
  const [bulkTag, setBulkTag] = useState('');
  const [loaded, setLoaded] = useState(false);

  const refresh = useCallback(() => {
    window.tiktok
      .fansList({ search: q, tag: tag || undefined, tier: (tier || undefined) as Tier | undefined, page, pageSize: 25 })
      .then((r) => { setResp(r); setLoaded(true); })
      .catch(() => setLoaded(true));
  }, [q, tag, tier, page]);

  useEffect(() => { refresh(); }, [refresh]);
  useEffect(() => { setPage(1); }, [q, tag, tier]);

  const toggle = (uid: string) =>
    setSelected((s) => {
      const n = new Set(s);
      if (n.has(uid)) n.delete(uid); else n.add(uid);
      return n;
    });

  const applyBulkTag = async (mode: 'add' | 'remove') => {
    const t = bulkTag.trim();
    if (!t || selected.size === 0) return;
    const res = await window.tiktok.fansBulkTag({
      ids: [...selected],
      add: mode === 'add' ? [t] : [],
      remove: mode === 'remove' ? [t] : [],
    });
    pushToast({ title: 'Tags updated', body: `${mode === 'add' ? 'Added' : 'Removed'} "${t}" on ${res.updated} fan${res.updated === 1 ? '' : 's'}` });
    setBulkTag('');
    setSelected(new Set());
    refresh();
  };

  const isEmpty = loaded && resp.total === 0 && !q && !tag && !tier;

  return (
    <PageShell
      title="Followers"
      subtitle="Every fan the ledger has ever seen — gifts build this list automatically."
      actions={
        <>
          <button onClick={onGoImport} className="panel-btn no-drag">Import CSV</button>
          <button onClick={() => setShowAdd(true)} className="panel-btn panel-btn-primary no-drag">+ Add fan</button>
        </>
      }
    >
      {isEmpty ? (
        <div className="glass flex flex-1 flex-col items-center justify-center gap-3 p-10 text-center" style={{ borderRadius: 22 }}>
          <img src="./assets/png/icon_group_3d.png" alt="" className="h-20 w-20 object-contain" draggable={false} />
          <h2 className="text-base font-extrabold">No fans in your ledger yet</h2>
          <p className="max-w-sm text-[13px]" style={{ color: 'var(--secondary-label)' }}>
            Connect to a LIVE and every gifter, commenter and follower is remembered here automatically — or bring an existing list in via CSV.
          </p>
          <div className="flex gap-2">
            <button onClick={onGoLive} className="panel-btn panel-btn-primary no-drag">Connect to a LIVE</button>
            <button onClick={onGoImport} className="panel-btn no-drag">Import CSV</button>
          </div>
        </div>
      ) : (
        <div className="glass flex min-h-0 flex-col p-4" style={{ borderRadius: 18 }}>
          {/* Filters */}
          <div className="flex flex-wrap items-center gap-2 pb-3">
            <input
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Search name, @username or notes…"
              className={`${inputCls} !w-64`}
            />
            <select value={tier} onChange={(e) => setTier(e.target.value as Tier | '')} className={`${inputCls} !w-32`}>
              <option value="">All tiers</option>
              {TIERS.map((t) => <option key={t} value={t}>{t}</option>)}
            </select>
            <select value={tag} onChange={(e) => setTag(e.target.value)} className={`${inputCls} !w-36`}>
              <option value="">All tags</option>
              {resp.allTags.map((t) => <option key={t} value={t}>{t}</option>)}
            </select>
            <span className="ml-auto text-[12px]" style={{ color: 'var(--secondary-label)' }}>
              {resp.total} fan{resp.total === 1 ? '' : 's'}
            </span>
          </div>

          {/* Bulk bar */}
          {selected.size > 0 && (
            <div className="mb-3 flex flex-wrap items-center gap-2 rounded-xl px-3 py-2" style={{ background: 'var(--fill-quaternary)', border: '1px solid var(--card-border)' }}>
              <span className="text-[12px] font-semibold">{selected.size} selected</span>
              <input value={bulkTag} onChange={(e) => setBulkTag(e.target.value)} placeholder="tag name" className={`${inputCls} !w-40`} />
              <button onClick={() => applyBulkTag('add')} disabled={!bulkTag.trim()} className="panel-btn panel-btn-primary no-drag">Add tag</button>
              <button onClick={() => applyBulkTag('remove')} disabled={!bulkTag.trim()} className="panel-btn no-drag">Remove tag</button>
              <button onClick={() => setSelected(new Set())} className="panel-btn no-drag ml-auto">Clear</button>
            </div>
          )}

          {/* Table */}
          {resp.data.length === 0 ? (
            <div className="py-10 text-center text-[13px]" style={{ color: 'var(--secondary-label)' }}>
              No fans match these filters.
            </div>
          ) : (
            <table className="w-full text-left text-[13px]">
              <thead>
                <tr className="text-[11px] uppercase tracking-wider" style={{ color: 'var(--secondary-label)' }}>
                  <th className="w-8 pb-2">
                    <input
                      type="checkbox"
                      checked={resp.data.length > 0 && resp.data.every((f) => selected.has(f.uniqueId))}
                      onChange={(e) =>
                        setSelected(e.target.checked
                          ? new Set([...selected, ...resp.data.map((f) => f.uniqueId)])
                          : new Set([...selected].filter((id) => !resp.data.some((f) => f.uniqueId === id))))
                      }
                      className="accent-pink-600"
                    />
                  </th>
                  <th className="pb-2">Fan</th>
                  <th className="pb-2">Tier</th>
                  <th className="pb-2 text-right">Diamonds</th>
                  <th className="pb-2 pl-4">Tags</th>
                  <th className="pb-2">Last seen</th>
                  <th className="pb-2">Birthday</th>
                </tr>
              </thead>
              <tbody>
                {resp.data.map((f: Fan) => (
                  <tr
                    key={f.uniqueId}
                    onClick={() => setOpenFan(f.uniqueId)}
                    className="cursor-pointer border-t transition hover:bg-white/[0.03]"
                    style={{ borderColor: 'var(--separator)' }}
                  >
                    <td className="py-2" onClick={(e) => e.stopPropagation()}>
                      <input type="checkbox" checked={selected.has(f.uniqueId)} onChange={() => toggle(f.uniqueId)} className="accent-pink-600" />
                    </td>
                    <td className="py-2">
                      <span className="flex items-center gap-2.5">
                        <FanAvatar name={fanName(f)} url={f.avatarUrl} />
                        <span className="min-w-0 leading-tight">
                          <span className="block truncate font-semibold">{fanName(f)}</span>
                          <span className="block text-[11px]" style={{ color: 'var(--secondary-label)' }}>@{f.uniqueId}</span>
                        </span>
                      </span>
                    </td>
                    <td className="py-2"><TierChip tier={f.tier} /></td>
                    <td className="py-2 text-right font-bold tabular-nums">{formatNumber(f.totalDiamonds)} 💎</td>
                    <td className="max-w-[180px] py-2 pl-4">
                      <span className="flex flex-wrap gap-1">
                        {f.tags.slice(0, 3).map((t) => <TagChip key={t} tag={t} />)}
                        {f.tags.length > 3 && <span className="text-[11px]" style={{ color: 'var(--secondary-label)' }}>+{f.tags.length - 3}</span>}
                      </span>
                    </td>
                    <td className="py-2 text-[12px]" style={{ color: 'var(--secondary-label)' }}>{daysAgoLabel(f.lastSeenAt)}</td>
                    <td className="py-2 text-[12px]" style={{ color: 'var(--secondary-label)' }}>{f.birthday ?? '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}

          <Pager page={resp.page} pageSize={resp.pageSize} total={resp.total} onPage={setPage} />
        </div>
      )}

      {openFan && (
        <FanDrawer uniqueId={openFan} tagSuggestions={resp.allTags} onClose={() => setOpenFan(null)} onChanged={refresh} />
      )}
      {showAdd && (
        <AddFanModal
          onClose={() => setShowAdd(false)}
          onAdded={(name) => {
            setShowAdd(false);
            pushToast({ title: 'Fan added', body: `@${name} is now in your ledger` });
            refresh();
          }}
        />
      )}
    </PageShell>
  );
}

function AddFanModal({ onClose, onAdded }: { onClose: () => void; onAdded: (username: string) => void }) {
  const pushToast = useAlerts((s) => s.pushToast);
  const [username, setUsername] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [birthday, setBirthday] = useState('');
  const [notes, setNotes] = useState('');
  const bdayBad = !birthdayValid(birthday);

  const submit = async () => {
    const u = username.replace(/^@/, '').trim();
    if (!u || bdayBad) return;
    const res = await window.tiktok.fansAdd({ uniqueId: u, displayName: displayName || undefined, birthday: birthday || undefined, notes: notes || undefined });
    if (res.ok) onAdded(u);
    else pushToast({ title: 'Could not add fan', body: res.error ?? 'Unknown error' });
  };

  return (
    <>
      <div className="fixed inset-0 z-[60] bg-black/50 backdrop-blur-sm" onClick={onClose} />
      <div className="glass fixed left-1/2 top-1/2 z-[70] w-[380px] -translate-x-1/2 -translate-y-1/2 p-5 shadow-2xl" style={{ borderRadius: 18 }}>
        <h2 className="mb-3 text-base font-extrabold">Add fan</h2>
        <div className="space-y-3">
          <div>
            <FieldLabel>TikTok username *</FieldLabel>
            <div className="relative">
              <span className="pointer-events-none absolute left-3 top-1.5 text-[13px]" style={{ color: 'var(--secondary-label)' }}>@</span>
              <input value={username} onChange={(e) => setUsername(e.target.value)} autoFocus className={`${inputCls} !pl-7`} onKeyDown={(e) => { if (e.key === 'Enter') submit(); }} />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <FieldLabel>Display name</FieldLabel>
              <input value={displayName} onChange={(e) => setDisplayName(e.target.value)} className={inputCls} />
            </div>
            <div>
              <FieldLabel>Birthday (MM-DD)</FieldLabel>
              <input value={birthday} onChange={(e) => setBirthday(e.target.value)} placeholder="07-24" className={`${inputCls} ${bdayBad ? '!border-rose-500/70' : ''}`} />
            </div>
          </div>
          <div>
            <FieldLabel>Notes</FieldLabel>
            <textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={2} className={`${inputCls} resize-y`} />
          </div>
        </div>
        <div className="mt-4 flex justify-end gap-2">
          <button onClick={onClose} className="panel-btn no-drag">Cancel</button>
          <button onClick={submit} disabled={!username.replace(/^@/, '').trim() || bdayBad} className="panel-btn panel-btn-primary no-drag">Add fan</button>
        </div>
      </div>
    </>
  );
}
