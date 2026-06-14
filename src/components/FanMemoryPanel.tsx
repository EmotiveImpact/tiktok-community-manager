/**
 * ⭐ Fan Memory — right-hand panel on the LIVE view.
 *
 * Shows the CRM ledger card for the selected fan. Selection sources:
 *  - clicking any username in the feeds (pins the fan)
 *  - gift events auto-select the most recent gifter when nothing is pinned
 *    (the "magic moment": someone gifts → their memory card pops up)
 */
import { memo, useCallback, useEffect, useRef, useState } from 'react';
import { useStore } from '../state/store';
import { useUI } from '../state/ui';
import { formatNumber, formatDate, estimateMoney } from '../lib/format';
import { tierClass } from '../lib/tier';
import { avatarGradient } from '../lib/avatars';
import { useSettingsLoad } from '../state/settings';
import { ThankComposer } from './ThankComposer';
import type { Fan, GiftRecord } from '../types';

function birthdayInfo(mmdd?: string): { label: string; days: number } | null {
  if (!mmdd) return null;
  const m = mmdd.match(/^(\d{2})-(\d{2})$/);
  if (!m) return null;
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  let next = new Date(now.getFullYear(), Number(m[1]) - 1, Number(m[2]));
  if (next < today) next = new Date(now.getFullYear() + 1, Number(m[1]) - 1, Number(m[2]));
  const days = Math.round((next.getTime() - today.getTime()) / 86400000);
  const label = next.toLocaleDateString(undefined, { day: 'numeric', month: 'short' });
  return { label, days };
}

export const FanMemoryPanel = memo(function FanMemoryPanel() {
  const fanMemoryId = useUI((s) => s.fanMemoryId);
  const focusFanMemory = useUI((s) => s.focusFanMemory);
  const openFanProfile = useUI((s) => s.openFanProfile);
  const setPage = useUI((s) => s.setPage);

  // Auto-select the latest gifter (cheap: only the latest gift id is selected on).
  const latestGift = useStore((s) => s.gifts[0]);
  useEffect(() => {
    if (latestGift && latestGift.type === 'gift') {
      focusFanMemory(latestGift.user.uniqueId, { auto: true });
    }
  }, [latestGift, focusFanMemory]);

  // "Online now" — re-renders only when the boolean flips.
  const online = useStore((s) => (fanMemoryId ? s.roomMembers.get(fanMemoryId)?.inRoom === true : false));
  const sessionUser = useStore((s) => (fanMemoryId ? s.tallies.get(fanMemoryId)?.user ?? null : null));

  const [fan, setFan] = useState<Fan | null>(null);
  const [lastGift, setLastGift] = useState<GiftRecord | null>(null);
  const [notes, setNotes] = useState('');
  const [tagDraft, setTagDraft] = useState('');
  const [addingTag, setAddingTag] = useState(false);
  const [thanked, setThanked] = useState(false);
  const [showThank, setShowThank] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const { earnings } = useSettingsLoad();
  const loadedFor = useRef<string | null>(null);
  const notesDebounce = useRef<ReturnType<typeof setTimeout> | null>(null);

  const refresh = useCallback(async (uid: string) => {
    const [f, gifts] = await Promise.all([
      window.tiktok.fansGet(uid),
      window.tiktok.giftsList({ fan: uid, range: 'all', pageSize: 1 }),
    ]);
    if (loadedFor.current !== uid) return;
    setFan(f);
    setLastGift(gifts.data[0] ?? null);
    setLoaded(true);
  }, []);

  useEffect(() => {
    if (!fanMemoryId) { setFan(null); setLastGift(null); return; }
    loadedFor.current = fanMemoryId;
    setLoaded(false);
    setThanked(false);
    setShowThank(false);
    setAddingTag(false);
    refresh(fanMemoryId).then(() => {
      // sync notes textarea after fan loads
    });
  }, [fanMemoryId, refresh]);

  // Keep gift stats fresh when the focused fan sends another gift.
  useEffect(() => {
    if (fanMemoryId && latestGift?.type === 'gift' && latestGift.user.uniqueId === fanMemoryId) {
      refresh(fanMemoryId);
    }
  }, [latestGift, fanMemoryId, refresh]);

  useEffect(() => {
    setNotes(fan?.notes ?? '');
  }, [fan?.uniqueId]); // eslint-disable-line react-hooks/exhaustive-deps

  const saveNotes = (text: string) => {
    setNotes(text);
    if (!fanMemoryId) return;
    if (notesDebounce.current) clearTimeout(notesDebounce.current);
    notesDebounce.current = setTimeout(() => {
      window.tiktok.fansUpdate(fanMemoryId, { notes: text });
    }, 600);
  };

  const addTag = async () => {
    const t = tagDraft.trim();
    if (!t || !fan || !fanMemoryId) return;
    const res = await window.tiktok.fansUpdate(fanMemoryId, { tags: [...fan.tags, t] });
    if (res.ok && res.fan) setFan(res.fan);
    setTagDraft('');
    setAddingTag(false);
  };

  const removeTag = async (t: string) => {
    if (!fan || !fanMemoryId) return;
    const res = await window.tiktok.fansUpdate(fanMemoryId, { tags: fan.tags.filter((x) => x !== t) });
    if (res.ok && res.fan) setFan(res.fan);
  };

  const thank = async () => {
    if (!fanMemoryId) return;
    const res = await window.tiktok.reminderAddThank(fanMemoryId);
    if (res.ok) setThanked(true);
  };

  const addToLedger = async () => {
    if (!fanMemoryId) return;
    const res = await window.tiktok.fansAdd({ uniqueId: fanMemoryId, nickname: sessionUser?.nickname });
    if (res.ok && res.fan) setFan(res.fan);
  };

  const name = fan?.displayName || fan?.nickname || sessionUser?.nickname || fanMemoryId || '';
  const avatarUrl = fan?.avatarUrl || sessionUser?.profilePictureUrl || null;
  const bday = birthdayInfo(fan?.birthday);

  return (
    <aside className="flex w-full flex-none flex-col gap-3">
      <section className="glass brand-top-border flex flex-col rounded-[18px] p-4">
        <div className="mb-3 flex items-center justify-between">
          <div className="flex items-center gap-1.5 text-xs font-bold uppercase tracking-wider text-zinc-400">
            <span className="text-amber-400">⭐</span> Fan Memory
          </div>
          {fanMemoryId && (
            <button
              onClick={() => focusFanMemory(null)}
              className="rounded-md px-1.5 text-xs text-zinc-600 hover:bg-zinc-800 hover:text-zinc-300"
              title="Clear selection"
            >
              ✕
            </button>
          )}
        </div>

        {!fanMemoryId ? (
          <div className="flex flex-col items-center gap-2 py-8 text-center">
            <img src="./assets/png/icon_heart_3d.png" alt="" className="h-12 w-12 opacity-80" draggable={false} />
            <div className="text-sm font-semibold text-zinc-300">No fan selected</div>
            <div className="px-2 text-xs leading-relaxed text-zinc-500">
              Click any username in the feed — or wait for the next gift — and their memory card appears here.
            </div>
          </div>
        ) : (
          <>
            {/* Identity */}
            <div className="flex flex-col items-center text-center">
              <div className="relative">
                {avatarUrl ? (
                  <img src={avatarUrl} alt="" className="h-16 w-16 rounded-full object-cover ring-2 ring-like-500/50" />
                ) : (
                  <div className={`flex h-16 w-16 items-center justify-center rounded-full text-xl font-bold text-white ring-2 ring-like-500/50 ${avatarGradient(name)}`}>
                    {name.charAt(0).toUpperCase()}
                  </div>
                )}
                {online && (
                  <span className="absolute bottom-0.5 right-0.5 block h-3.5 w-3.5 rounded-full border-2 border-[var(--card)] bg-emerald-400" title="In the room now" />
                )}
              </div>
              <div className="mt-2 flex items-center gap-1.5">
                <span className="max-w-[180px] truncate text-sm font-bold text-zinc-100">{name}</span>
                {fan && <span className={tierClass(fan.tier)}>{fan.tier.toUpperCase()}</span>}
              </div>
              <div className="text-[11px] text-zinc-500">@{fanMemoryId}</div>
              {online && (
                <div className="mt-1 inline-flex items-center gap-1 text-[10px] font-semibold text-emerald-400">
                  <span className="h-1.5 w-1.5 rounded-full bg-emerald-400" /> Online now
                </div>
              )}
            </div>

            {!fan && loaded ? (
              <div className="mt-4 rounded-lg border border-zinc-800 bg-zinc-900/50 p-3 text-center">
                <div className="text-xs text-zinc-400">Not in your fan ledger yet.</div>
                <button onClick={addToLedger} className="mt-2 rounded-full bg-pink-gradient px-3 py-1 text-xs font-semibold text-white" style={{ background: 'var(--gradient-pink)' }}>
                  Add to ledger
                </button>
              </div>
            ) : fan ? (
              <>
                {/* Stat tiles */}
                <div className="mt-3 grid grid-cols-2 gap-2">
                  <div className="rounded-xl border border-zinc-800/60 bg-zinc-900/40 p-2.5 text-center">
                    <div className="text-base font-extrabold tabular-nums text-zinc-100">{formatNumber(fan.giftCount)}</div>
                    <div className="text-[10px] text-zinc-500">🎁 Total gifts</div>
                  </div>
                  <div className="rounded-xl border border-zinc-800/60 bg-zinc-900/40 p-2.5 text-center">
                    <div className="text-base font-extrabold tabular-nums text-like-400">{formatNumber(fan.totalDiamonds)}</div>
                    <div className="text-[10px] text-zinc-500">
                      💎 Total value{' '}
                      {estimateMoney(fan.totalDiamonds, earnings) && (
                        <span className="text-zinc-600">{estimateMoney(fan.totalDiamonds, earnings)}</span>
                      )}
                    </div>
                  </div>
                </div>

                {/* Last gift + birthday */}
                <div className="mt-2 space-y-1 text-[11px] text-zinc-400">
                  {lastGift && (
                    <div>
                      Last gifted: <span className="font-semibold text-amber-300">{lastGift.giftName}{lastGift.repeatCount > 1 ? ` ×${lastGift.repeatCount}` : ''}</span>
                      <span className="text-zinc-600"> · {formatDate(lastGift.at)}</span>
                    </div>
                  )}
                  {bday && (
                    <div>
                      Birthday: <span className="font-semibold text-zinc-200">{bday.label}</span>
                      <span className="text-zinc-600"> ({bday.days === 0 ? 'today' : `in ${bday.days} day${bday.days === 1 ? '' : 's'}`})</span> 🎂
                    </div>
                  )}
                  {fan.lastThankedAt && (
                    <div>
                      Last thanked: <span className="font-semibold text-emerald-400">{formatDate(fan.lastThankedAt)}</span> 💌
                    </div>
                  )}
                </div>

                {/* Notes */}
                <textarea
                  value={notes}
                  onChange={(e) => saveNotes(e.target.value)}
                  placeholder="What do you want to remember about them?"
                  rows={3}
                  className="mt-3 w-full resize-none rounded-lg border border-zinc-800 bg-zinc-900/60 px-2.5 py-2 text-xs leading-relaxed text-zinc-200 outline-none transition placeholder:text-zinc-600 focus:border-like-500/50"
                />

                {/* Tags */}
                <div className="mt-2 flex flex-wrap items-center gap-1.5">
                  {fan.tags.map((t) => (
                    <button
                      key={t}
                      onClick={() => removeTag(t)}
                      title="Remove tag"
                      className="group inline-flex items-center gap-1 rounded-full bg-cyan-500/10 px-2 py-0.5 text-[10px] font-semibold text-cyan-400 hover:bg-rose-500/15 hover:text-rose-400"
                    >
                      {t}
                      <span className="hidden group-hover:inline">✕</span>
                    </button>
                  ))}
                  {addingTag ? (
                    <input
                      autoFocus
                      value={tagDraft}
                      onChange={(e) => setTagDraft(e.target.value)}
                      onKeyDown={(e) => { if (e.key === 'Enter') addTag(); if (e.key === 'Escape') { setAddingTag(false); setTagDraft(''); } }}
                      onBlur={addTag}
                      placeholder="tag"
                      className="h-5 w-20 rounded-full border border-zinc-700 bg-zinc-900 px-2 text-[10px] text-zinc-200 outline-none focus:border-like-500/60"
                    />
                  ) : (
                    <button
                      onClick={() => setAddingTag(true)}
                      className="inline-flex h-5 w-5 items-center justify-center rounded-full border border-dashed border-zinc-700 text-[11px] text-zinc-500 hover:border-like-500/60 hover:text-like-400"
                      title="Add tag"
                    >
                      +
                    </button>
                  )}
                </div>

                {/* Actions */}
                <button
                  onClick={() => setShowThank(true)}
                  className="mt-3 w-full rounded-full px-3 py-2 text-xs font-bold text-white shadow-[0_2px_10px_rgba(238,29,82,0.35)] transition"
                  style={{ background: 'var(--gradient-pink)' }}
                >
                  💌 Send a thank-you
                </button>
                <button
                  onClick={thank}
                  disabled={thanked}
                  className="mt-1.5 w-full rounded-full border border-zinc-800 px-3 py-1.5 text-xs font-semibold text-zinc-300 transition hover:bg-zinc-800/60 disabled:opacity-70"
                >
                  {thanked ? 'Reminder set ✓' : 'Remind me after LIVE'}
                </button>
                <button
                  onClick={() => openFanProfile(fan.uniqueId)}
                  className="mt-1.5 w-full rounded-full border border-zinc-800 px-3 py-1.5 text-xs font-semibold text-zinc-300 transition hover:bg-zinc-800/60"
                >
                  Open full profile →
                </button>
              </>
            ) : (
              <div className="py-6 text-center text-xs text-zinc-600">Loading…</div>
            )}
          </>
        )}
      </section>

      {/* After-LIVE follow-up mini card */}
      <section className="glass flex flex-none items-start gap-3 rounded-[18px] p-3.5">
        <img src="./assets/png/hero_gift_checklist_3d.png" alt="" className="h-12 w-12 flex-none object-contain" draggable={false} />
        <div className="min-w-0">
          <div className="text-xs font-bold text-zinc-100">After LIVE follow-up</div>
          <p className="mt-0.5 text-[11px] leading-snug text-zinc-500">
            Keep the momentum going — send a thank-you and set reminders to build stronger connections.
          </p>
          <button
            onClick={() => setPage('reminders')}
            className="mt-1.5 text-[11px] font-semibold text-like-400 hover:underline"
          >
            View follow-up list →
          </button>
        </div>
      </section>

      {showThank && fanMemoryId && (
        <ThankComposer
          uniqueId={fanMemoryId}
          nickname={fan?.displayName || fan?.nickname || sessionUser?.nickname}
          onClose={() => setShowThank(false)}
          onThanked={() => refresh(fanMemoryId)}
        />
      )}
    </aside>
  );
});
