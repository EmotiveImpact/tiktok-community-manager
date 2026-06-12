/** CRM fan detail drawer — notes, tags, birthday, display name + gift history. */
import { useEffect, useRef, useState } from 'react';
import type { Fan, GiftRecord } from '../types';
import { formatNumber, formatDate, daysAgoLabel } from '../lib/format';
import { useAlerts } from '../state/alerts';
import { FanAvatar, TierChip, TagsEditor, FieldLabel, inputCls, birthdayValid, fanName } from './crm';

export function FanDrawer({
  uniqueId,
  tagSuggestions,
  onClose,
  onChanged,
}: {
  uniqueId: string;
  tagSuggestions: string[];
  onClose: () => void;
  onChanged: () => void;
}) {
  const pushToast = useAlerts((s) => s.pushToast);
  const [fan, setFan] = useState<Fan | null>(null);
  const [notes, setNotes] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [birthday, setBirthday] = useState('');
  const [tags, setTags] = useState<string[]>([]);
  const [gifts, setGifts] = useState<GiftRecord[]>([]);
  const [savedFlash, setSavedFlash] = useState(false);
  const loaded = useRef(false);
  const debounce = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    loaded.current = false;
    window.tiktok.fansGet(uniqueId).then((f) => {
      if (!f) return;
      setFan(f);
      setNotes(f.notes);
      setDisplayName(f.displayName ?? '');
      setBirthday(f.birthday ?? '');
      setTags(f.tags);
      // allow autosave only after initial values are in
      setTimeout(() => { loaded.current = true; }, 0);
    });
    window.tiktok.giftsList({ range: 'all', fan: uniqueId, pageSize: 30 }).then((r) => {
      setGifts(r.data.filter((g) => g.fanUniqueId === uniqueId));
    }).catch(() => {});
  }, [uniqueId]);

  // Debounced autosave on edits
  useEffect(() => {
    if (!loaded.current || !fan) return;
    if (debounce.current) clearTimeout(debounce.current);
    debounce.current = setTimeout(async () => {
      if (!birthdayValid(birthday)) return;
      const res = await window.tiktok.fansUpdate(uniqueId, {
        notes,
        tags,
        birthday: birthday || null,
        displayName,
      });
      if (res.ok) {
        setSavedFlash(true);
        setTimeout(() => setSavedFlash(false), 800);
        onChanged();
      } else {
        pushToast({ title: 'Save failed', body: res.error ?? 'Could not save fan' });
      }
    }, 500);
    return () => { if (debounce.current) clearTimeout(debounce.current); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [notes, tags, birthday, displayName]);

  if (!fan) return null;
  const bdayBad = !birthdayValid(birthday);

  return (
    <>
      <div className="fixed inset-0 z-[60] bg-black/50 backdrop-blur-sm" onClick={onClose} />
      <aside className="animate-slide-in glass fixed right-0 top-0 z-[70] flex h-screen w-[420px] flex-col overflow-y-auto !rounded-none border-l shadow-2xl" style={{ borderColor: 'var(--separator)' }}>
        <header className="border-b p-5" style={{ borderColor: 'var(--separator)' }}>
          <div className="flex items-center gap-3">
            <FanAvatar name={fanName(fan)} url={fan.avatarUrl} size={56} />
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-2">
                <span className="truncate text-base font-extrabold">{fanName(fan)}</span>
                <TierChip tier={fan.tier} />
              </div>
              <div className="truncate text-xs" style={{ color: 'var(--secondary-label)' }}>@{fan.uniqueId}</div>
            </div>
            <button onClick={onClose} className="panel-btn panel-btn-icon no-drag" aria-label="Close">✕</button>
          </div>
          <div className="mt-3 grid grid-cols-3 gap-2 text-center">
            {[
              { label: 'Diamonds', value: formatNumber(fan.totalDiamonds) },
              { label: 'Gifts', value: formatNumber(fan.giftCount) },
              { label: 'Last seen', value: daysAgoLabel(fan.lastSeenAt) },
            ].map((s) => (
              <div key={s.label} className="rounded-xl px-2 py-2" style={{ background: 'var(--fill-quaternary)', border: '1px solid var(--card-border)' }}>
                <div className="text-sm font-extrabold">{s.value}</div>
                <div className="text-[10px] uppercase tracking-wide" style={{ color: 'var(--secondary-label)' }}>{s.label}</div>
              </div>
            ))}
          </div>
        </header>

        <div className="space-y-4 p-5">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <FieldLabel>Display name</FieldLabel>
              <input value={displayName} onChange={(e) => setDisplayName(e.target.value)} placeholder={fan.nickname} className={inputCls} />
            </div>
            <div>
              <FieldLabel>Birthday (MM-DD)</FieldLabel>
              <input
                value={birthday}
                onChange={(e) => setBirthday(e.target.value)}
                placeholder="e.g. 07-24"
                className={`${inputCls} ${bdayBad ? '!border-rose-500/70' : ''}`}
              />
              {bdayBad && <div className="mt-1 text-[11px] text-rose-400">Use MM-DD, e.g. 07-24 — not saved yet.</div>}
            </div>
          </div>

          <div>
            <FieldLabel>Tags</FieldLabel>
            <div className="rounded-lg border border-zinc-700/60 px-2 py-1.5">
              <TagsEditor tags={tags} onChange={setTags} suggestions={tagSuggestions} />
            </div>
          </div>

          <div>
            <div className="flex items-baseline justify-between">
              <FieldLabel>Notes</FieldLabel>
              <span className={`text-[10px] ${savedFlash ? 'text-emerald-400' : ''}`} style={savedFlash ? undefined : { color: 'var(--secondary-label)' }}>
                {savedFlash ? 'Saved' : 'Auto-saves as you type'}
              </span>
            </div>
            <textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              rows={4}
              placeholder="Real name, interests, how you met, what to thank them for…"
              className={`${inputCls} resize-y leading-relaxed`}
            />
          </div>

          <div>
            <FieldLabel>Gift history</FieldLabel>
            {gifts.length === 0 ? (
              <div className="rounded-lg px-3 py-4 text-center text-[12px]" style={{ background: 'var(--fill-quaternary)', color: 'var(--secondary-label)' }}>
                No gifts recorded from this fan yet.
              </div>
            ) : (
              <ul className="text-[12px]">
                {gifts.map((g, i) => (
                  <li key={g.id} className={`flex items-center gap-2 py-1.5 ${i > 0 ? 'border-t' : ''}`} style={{ borderColor: 'var(--separator)' }}>
                    <span className="min-w-0 flex-1 truncate">
                      {g.giftName}{g.repeatCount > 1 ? ` ×${g.repeatCount}` : ''}{g.manual ? ' · logged manually' : ''}
                    </span>
                    <span className="font-bold tabular-nums">{formatNumber(g.diamonds)} 💎</span>
                    <span className="w-20 text-right" style={{ color: 'var(--secondary-label)' }}>{formatDate(g.at)}</span>
                  </li>
                ))}
              </ul>
            )}
          </div>

          <div className="flex items-center gap-2 border-t pt-3 text-[12px]" style={{ borderColor: 'var(--separator)', color: 'var(--secondary-label)' }}>
            <span>First seen {formatDate(fan.firstSeenAt)}</span>
            <button onClick={() => window.tiktok.openProfile(fan.uniqueId)} className="panel-btn no-drag ml-auto">Profile ↗</button>
          </div>
        </div>
      </aside>
    </>
  );
}
