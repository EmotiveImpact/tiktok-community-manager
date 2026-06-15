/// <reference types="vite/client" />
/** Followers — the fan CRM table. Search, segment tabs, tag/tier filters, bulk tag, add fan. Row → 360 profile page. */
import { useCallback, useEffect, useMemo, useState } from 'react';
import type { Fan, ListFansResult, Temperature, Tier } from '../types';
import { formatNumber, daysAgoLabel } from '../lib/format';
import { TIERS } from '../lib/tier';
import { useAlerts } from '../state/alerts';
import { FanAvatar, TierChip, TagChip, Pager, PageShell, FieldLabel, inputCls, fanName, birthdayValid, StrengthBar, TemperatureDot } from '../components/crm';
import { useUI } from '../state/ui';
import { Tabs, TabList, Tab, Select } from '../components/ui';

type Segment = 'all' | 'whales' | 'cold' | 'new' | 'birthdays';
const SEGMENTS: { id: Segment; label: string }[] = [
  { id: 'all', label: 'All' },
  { id: 'whales', label: 'Whales' },
  { id: 'cold', label: 'Going cold' },
  { id: 'new', label: 'New this week' },
  { id: 'birthdays', label: 'Birthdays soon' },
];
const DAY = 86400000;
/** Sentinel for the "all" option — Radix Select forbids an empty-string item value. */
const ALL = '__all__';
const COLD_TEMPS: Temperature[] = ['cooling', 'cold'];

/** Days until a fan's next MM-DD birthday, or null. */
function daysUntilBirthday(mmdd?: string, now = new Date()): number | null {
  if (!mmdd) return null;
  const m = mmdd.match(/^(\d{2})-(\d{2})$/);
  if (!m) return null;
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  let next = new Date(now.getFullYear(), Number(m[1]) - 1, Number(m[2]));
  if (next < today) next = new Date(now.getFullYear() + 1, Number(m[1]) - 1, Number(m[2]));
  return Math.round((next.getTime() - today.getTime()) / DAY);
}

/** A VIP/Whale that's cooling or cold — gets a subtle highlighted row. */
function isGoingColdVip(f: Fan): boolean {
  return (f.tier === 'VIP' || f.tier === 'Whale') && !!f.temperature && COLD_TEMPS.includes(f.temperature);
}

function matchesSegment(f: Fan, seg: Segment, now = Date.now()): boolean {
  switch (seg) {
    case 'whales': return f.tier === 'Whale';
    case 'cold': return isGoingColdVip(f);
    case 'new': return now - f.firstSeenAt <= 7 * DAY;
    case 'birthdays': { const d = daysUntilBirthday(f.birthday); return d !== null && d <= 30; }
    default: return true;
  }
}

type Props = { onGoImport: () => void; onGoLive: () => void };

export function Followers({ onGoImport, onGoLive }: Props) {
  const pushToast = useAlerts((s) => s.pushToast);
  const openFanProfile = useUI((s) => s.openFanProfile);
  const [q, setQ] = useState('');
  const [tag, setTag] = useState('');
  const [tier, setTier] = useState<Tier | ''>('');
  const [segment, setSegment] = useState<Segment>('all');
  const [page, setPage] = useState(1);
  const [resp, setResp] = useState<ListFansResult>({ data: [], total: 0, page: 1, pageSize: 25, allTags: [] });
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [showAdd, setShowAdd] = useState(false);
  const [bulkTag, setBulkTag] = useState('');
  const [loaded, setLoaded] = useState(false);

  const refresh = useCallback(() => {
    window.tiktok
      .fansList({ search: q, tag: tag || undefined, tier: (tier || undefined) as Tier | undefined, page, pageSize: 25 })
      .then((r) => {
        setResp(r);
        setLoaded(true);
      })
      .catch(() => setLoaded(true));
  }, [q, tag, tier, page]);

  useEffect(() => { refresh(); }, [refresh]);
  useEffect(() => { setPage(1); }, [q, tag, tier]);

  // Segment is a client-side filter over the loaded page (strength/temperature/
  // birthday/firstSeen already ride along on each row).
  const rows = useMemo(() => resp.data.filter((f) => matchesSegment(f, segment)), [resp.data, segment]);

  const openProfile = (uid: string) => openFanProfile(uid);

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
      title="Fans"
      subtitle="A real CRM workspace for creator relationships, not a follower dump."
      actions={
        <>
          <button onClick={onGoImport} className="panel-btn no-drag">Import CSV</button>
          <button onClick={() => setShowAdd(true)} className="panel-btn panel-btn-primary no-drag">+ Add fan</button>
        </>
      }
    >
      {!isEmpty && (
        <Tabs value={segment} onValueChange={(v) => setSegment(v as Segment)} variant="segment">
          <TabList ariaLabel="Fan segments" className="flex-wrap">
            {SEGMENTS.map((s) => (
              <Tab key={s.id} value={s.id} label={s.label} />
            ))}
          </TabList>
        </Tabs>
      )}
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
        <div className="glass grid min-h-0 min-w-0 flex-1 grid-rows-[66px_44px_minmax(0,1fr)_52px]" style={{ borderRadius: 20 }}>
          {/* Filters — 66px bar */}
          <div className="flex flex-wrap items-center gap-2 border-b px-4" style={{ borderColor: 'var(--panel-border)' }}>
            <input
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Search name, @username or notes…"
              className={`${inputCls} !w-64`}
            />
            <Select
              value={tier || ALL}
              onValueChange={(v) => setTier((v === ALL ? '' : v) as Tier | '')}
              ariaLabel="Filter by tier"
              className="!w-32"
              options={[{ value: ALL, label: 'All tiers' }, ...TIERS.map((t) => ({ value: t, label: t }))]}
            />
            <Select
              value={tag || ALL}
              onValueChange={(v) => setTag(v === ALL ? '' : v)}
              ariaLabel="Filter by tag"
              className="!w-36"
              options={[{ value: ALL, label: 'All tags' }, ...resp.allTags.map((t) => ({ value: t, label: t }))]}
            />
            <span className="ml-auto text-[12px]" style={{ color: 'var(--secondary-label)' }}>
              {segment === 'all' ? `${resp.total} fan${resp.total === 1 ? '' : 's'}` : `${rows.length} of ${resp.data.length} shown`}
            </span>
          </div>

          {/* Bulk bar — 44px working mode (spec item 11) */}
          {selected.size > 0 ? (
            <div
              className="flex flex-wrap items-center gap-2 border-b bg-gradient-to-r from-[#EE1D52]/10 to-[#69C9D0]/[0.055] px-4"
              style={{ borderColor: 'var(--panel-border)' }}
            >
              <span className="text-[12px] font-bold">{selected.size} selected</span>
              <input value={bulkTag} onChange={(e) => setBulkTag(e.target.value)} placeholder="tag name" className={`${inputCls} !h-7 !w-40 !py-0`} />
              <button onClick={() => applyBulkTag('add')} disabled={!bulkTag.trim()} className="panel-btn panel-btn-primary no-drag">Add tag</button>
              <button onClick={() => applyBulkTag('remove')} disabled={!bulkTag.trim()} className="panel-btn no-drag">Remove tag</button>
              <button onClick={() => setSelected(new Set())} className="panel-btn no-drag ml-auto">Clear</button>
            </div>
          ) : (
            <div className="flex items-center border-b px-4 text-[11px]" style={{ borderColor: 'var(--panel-border)', color: 'var(--tertiary-label)' }}>
              Click any row to open the 360 profile · select fans to tag them in bulk.
            </div>
          )}

          {/* Table — 34px header, 64px rows */}
          <div className="min-h-0 overflow-y-auto">
          {rows.length === 0 ? (
            <div className="py-10 text-center text-[13px]" style={{ color: 'var(--secondary-label)' }}>
              {segment === 'all' ? 'No fans match these filters.' : `No fans in "${SEGMENTS.find((s) => s.id === segment)?.label}" on this page.`}
            </div>
          ) : (
            <table className="w-full text-left text-[13px]">
              <thead className="sticky top-0 z-10" style={{ background: 'var(--panel-bg-strong)' }}>
                <tr className="h-[34px] text-[11px] uppercase tracking-wider" style={{ color: 'var(--secondary-label)' }}>
                  <th className="w-8 pl-3.5">
                    <input
                      type="checkbox"
                      checked={rows.length > 0 && rows.every((f) => selected.has(f.uniqueId))}
                      onChange={(e) =>
                        setSelected(e.target.checked
                          ? new Set([...selected, ...rows.map((f) => f.uniqueId)])
                          : new Set([...selected].filter((id) => !rows.some((f) => f.uniqueId === id))))
                      }
                      className="accent-pink-600"
                    />
                  </th>
                  <th className="px-3.5 font-bold">Fan</th>
                  <th className="px-3.5 font-bold">Tier</th>
                  <th className="px-3.5 font-bold">Strength</th>
                  <th className="px-3.5 text-right font-bold">Lifetime 💎</th>
                  <th className="px-3.5 font-bold">Last seen</th>
                  <th className="px-3.5 font-bold">Tags</th>
                  <th className="px-3.5 font-bold">Temp</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((f: Fan) => {
                  const cold = isGoingColdVip(f);
                  return (
                  <tr
                    key={f.uniqueId}
                    onClick={() => openProfile(f.uniqueId)}
                    className="h-[64px] cursor-pointer border-t transition hover:bg-[var(--fill-quaternary)]"
                    style={cold
                      ? { borderColor: 'var(--separator)', background: 'linear-gradient(90deg, rgba(255,159,10,.09), transparent 40%)' }
                      : { borderColor: 'var(--separator)' }}
                  >
                    <td className="pl-3.5" onClick={(e) => e.stopPropagation()}>
                      <input type="checkbox" checked={selected.has(f.uniqueId)} onChange={() => toggle(f.uniqueId)} className="accent-pink-600" />
                    </td>
                    <td className="px-3.5">
                      <span className="flex items-center gap-2.5">
                        <FanAvatar name={fanName(f)} url={f.avatarUrl} size={38} />
                        <span className="min-w-0 leading-tight">
                          <span className="block truncate text-[13px]" style={{ fontWeight: 750 }}>{fanName(f)}</span>
                          <span className="block text-[11px]" style={{ color: 'var(--secondary-label)' }}>@{f.uniqueId}</span>
                        </span>
                      </span>
                    </td>
                    <td className="px-3.5"><TierChip tier={f.tier} /></td>
                    <td className="px-3.5">
                      {typeof f.strength === 'number'
                        ? <StrengthBar score={f.strength} barWidth={120} label height={8} />
                        : <span className="text-[12px]" style={{ color: 'var(--tertiary-label)' }}>—</span>}
                    </td>
                    <td className="px-3.5 text-right text-[13px] tabular-nums" style={{ fontWeight: 900 }}>{formatNumber(f.totalDiamonds)}</td>
                    <td className="px-3.5 text-[12px]" style={{ color: 'var(--secondary-label)' }}>{daysAgoLabel(f.lastSeenAt)}</td>
                    <td className="max-w-[170px] px-3.5">
                      <span className="flex flex-wrap gap-1">
                        {f.tags.slice(0, 2).map((t) => <TagChip key={t} tag={t} />)}
                        {f.tags.length > 2 && <span className="text-[11px]" style={{ color: 'var(--secondary-label)' }}>+{f.tags.length - 2}</span>}
                      </span>
                    </td>
                    <td className="px-3.5">
                      {f.temperature ? <TemperatureDot temperature={f.temperature} label /> : <span style={{ color: 'var(--tertiary-label)' }}>—</span>}
                    </td>
                  </tr>
                  );
                })}
              </tbody>
            </table>
          )}
          </div>

          {/* Footer — 52px */}
          <div className="flex items-center border-t px-4" style={{ borderColor: 'var(--panel-border)' }}>
            <div className="w-full">
              <Pager page={resp.page} pageSize={resp.pageSize} total={resp.total} onPage={setPage} />
            </div>
          </div>
        </div>
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
