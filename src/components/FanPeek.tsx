/**
 * 👁️ Fan PEEK — the universal, GLOBAL fan preview drawer.
 *
 * A right-side slide-over (≈520px) that lets you glance at ANY fan from ANY
 * page without navigating away. It's the lightweight sibling of the full 360
 * FanProfile page: same data + same look, but as a global overlay.
 *
 * Open it from anywhere with `useUI().openFanPeek(uniqueId)` (e.g. the ⌘K
 * command palette, a feed username, a CRM row). It reads `peekFanId` from the
 * UI store and renders nothing when that's null. Escalate to the full record
 * with the "Open full profile →" button (calls `openFanProfile`, which also
 * closes the peek).
 *
 * Mounted ONCE at the App root so it overlays every page. Built on the shared
 * `ui/Dialog` `variant="drawer"` (Radix focus-trap / scroll-lock / Esc /
 * backdrop dismissal) — closing any of those ways calls `closeFanPeek`.
 *
 * Data (all window.tiktok.*, all fail-safe — a CRM read must never throw here):
 *   - fansProfile(peekFanId)          → header, strength/temperature, stats,
 *                                        breakdown, reminders, the fan record
 *   - fansTimeline(peekFanId,{limit}) → recent notes & activity (notes weighted)
 *   - fansUpdate(id,{notes})          → pinned About autosave (debounced)
 *   - fansUpdate(id,{tags})           → add / remove tags
 *   - fansAddNote(id, body)           → quick-add dated note (optimistic prepend)
 *
 * Performance: profile + timeline are fetched ONCE on open (keyed by fan id),
 * never per keystroke; the About autosave is debounced (600ms).
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { useUI } from '../state/ui';
import { useSettingsLoad } from '../state/settings';
import { formatNumber, relativeTime, formatDate } from '../lib/format';
import { estimateMoney } from '../lib/format';
import {
  FanAvatar, TierChip, StrengthBar, TemperatureDot, fanName,
} from './crm';
import { ThankComposer } from './ThankComposer';
import { LogGiftModal } from './LogGiftModal';
import { Dialog, DialogClose } from './ui/Dialog';
import { Tooltip } from './ui';
import type { Fan, FanProfile, TimelineEvent } from '../types';

const DAY = 86400000;

/** Compact icon per timeline event type — mirrors the 360 profile feed. */
const TIMELINE_ICON: Record<TimelineEvent['type'], string> = {
  gift: '🎁',
  note: '✍️',
  thank_you: '💌',
  dm: '✉️',
  shoutout: '⭐',
  tier_up: '👑',
  reminder_done: '✅',
  manual_gift_log: '🎁',
  session_attend: '📺',
  first_seen: '👋',
  comment_rollup: '💬',
};

/** Notes/manual touches read heavier than auto chatter when we trim to ~5. */
const NOTE_TYPES = new Set<TimelineEvent['type']>(['note', 'thank_you', 'dm', 'shoutout', 'manual_gift_log']);

/** The one-line status under the name: temperature · gave Nd ago · last thanked. */
function composeStatus(p: FanProfile): string {
  const parts: string[] = [];
  parts.push(p.temperature);
  const d = p.daysSinceContact;
  parts.push(d <= 0 ? 'gave today' : `gave ${d} day${d === 1 ? '' : 's'} ago`);
  if (p.fan.lastThankedAt) {
    const td = Math.max(0, Math.floor((Date.now() - p.fan.lastThankedAt) / DAY));
    parts.push(td <= 0 ? 'thanked today' : `thanked ${td}d ago`);
  } else {
    parts.push('never thanked');
  }
  return parts.join(' · ');
}

/**
 * Pick the ~5 most relevant recent events: keep chronological order but bias
 * toward your own touches (notes/thanks) over auto chatter (comment rollups).
 */
function pickRecent(events: TimelineEvent[], n = 5): TimelineEvent[] {
  if (events.length <= n) return events;
  const notes = events.filter((e) => NOTE_TYPES.has(e.type));
  const rest = events.filter((e) => !NOTE_TYPES.has(e.type));
  const merged = [...notes, ...rest.slice(0, Math.max(0, n - notes.length))];
  // Re-sort newest-first so the visual order stays a timeline.
  return merged.sort((a, b) => b.occurredAt - a.occurredAt).slice(0, n);
}

export function FanPeek() {
  const peekFanId = useUI((s) => s.peekFanId);
  const closeFanPeek = useUI((s) => s.closeFanPeek);
  const openFanProfile = useUI((s) => s.openFanProfile);

  return (
    <Dialog
      open={peekFanId != null}
      onOpenChange={(o) => { if (!o) closeFanPeek(); }}
      ariaLabel="Fan peek"
      variant="drawer"
      // The drawer base class is a fixed 420px; widen to ~520px via inline
      // style (wins over the Tailwind class) for the richer peek layout.
      contentStyle={{ width: 520, maxWidth: '94vw' }}
    >
      {peekFanId ? (
        <PeekBody
          key={peekFanId}
          uniqueId={peekFanId}
          onClose={closeFanPeek}
          onEscalate={() => openFanProfile(peekFanId)}
        />
      ) : (
        // Radix requires a child even while closed; keep it empty.
        <span className="sr-only" />
      )}
    </Dialog>
  );
}

function PeekBody({ uniqueId, onClose, onEscalate }: {
  uniqueId: string;
  onClose: () => void;
  onEscalate: () => void;
}) {
  const { earnings } = useSettingsLoad();
  const [profile, setProfile] = useState<FanProfile | null>(null);
  const [events, setEvents] = useState<TimelineEvent[]>([]);
  const [loading, setLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);
  const [showThank, setShowThank] = useState(false);
  const [showLogGift, setShowLogGift] = useState(false);
  const aliveFor = useRef(uniqueId);

  // Fetch profile + timeline ONCE on open (keyed by the fan id via the outer
  // `key`, so this mounts fresh per fan). Fail-safe: never throw into the shell.
  const load = useCallback(async () => {
    setLoading(true);
    setNotFound(false);
    const [p, rows] = await Promise.all([
      window.tiktok.fansProfile(uniqueId).catch(() => null),
      window.tiktok.fansTimeline(uniqueId, { limit: 12 }).catch(() => [] as TimelineEvent[]),
    ]);
    if (aliveFor.current !== uniqueId) return;
    setProfile(p);
    setNotFound(!p);
    setEvents(pickRecent(rows ?? []));
    setLoading(false);
  }, [uniqueId]);

  useEffect(() => {
    aliveFor.current = uniqueId;
    load();
    return () => { aliveFor.current = ''; };
  }, [uniqueId, load]);

  const onFanPatched = (fan?: Fan) => {
    if (fan) setProfile((p) => (p ? { ...p, fan } : p));
  };

  // Quick-add dated note → optimistic prepend, then reconcile against the store.
  const addNote = async (body: string) => {
    const text = body.trim();
    if (!text) return;
    const optimistic: TimelineEvent = {
      id: `tmp-${Date.now()}`, type: 'note', source: 'manual',
      occurredAt: Date.now(), summary: 'Note added', body: text,
    };
    setEvents((e) => pickRecent([optimistic, ...e]));
    const res = await window.tiktok.fansAddNote(uniqueId, text).catch(() => null);
    if (res?.ok && res.event) {
      setEvents((e) => e.map((ev) => (ev.id === optimistic.id ? res.event! : ev)));
    } else if (!res?.ok) {
      setEvents((e) => e.filter((ev) => ev.id !== optimistic.id));
    }
  };

  const setTags = async (tags: string[]) => {
    const res = await window.tiktok.fansUpdate(uniqueId, { tags }).catch(() => null);
    if (res?.ok && res.fan) onFanPatched(res.fan);
  };

  // ── HEADER (shared chrome: close button always present) ──────────────────
  const header = (
    <div className="flex flex-none items-center justify-between border-b px-5 py-3" style={{ borderColor: 'var(--panel-border)' }}>
      <div className="flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-wider" style={{ color: 'var(--secondary-label)' }}>
        <span aria-hidden>👁️</span> Peek <span className="font-semibold normal-case tracking-normal" style={{ color: 'var(--tertiary-label)' }}>· @{uniqueId}</span>
      </div>
      <DialogClose asChild>
        <button className="rounded-md px-2 py-1 text-sm leading-none transition hover:bg-[var(--fill-quaternary)]" style={{ color: 'var(--secondary-label)' }} aria-label="Close peek">✕</button>
      </DialogClose>
    </div>
  );

  if (loading) {
    return (
      <div className="flex h-full flex-col">
        {header}
        <div className="flex flex-1 items-center justify-center">
          <div className="flex flex-col items-center gap-3">
            <div className="h-9 w-9 animate-spin rounded-full border-2 border-zinc-700 border-t-pink-500" />
            <div className="text-[13px]" style={{ color: 'var(--secondary-label)' }}>Loading fan…</div>
          </div>
        </div>
      </div>
    );
  }

  if (notFound || !profile) {
    return (
      <div className="flex h-full flex-col">
        {header}
        <div className="flex flex-1 flex-col items-center justify-center gap-3 px-8 text-center">
          <img src="./assets/png/icon_group_3d.png" alt="" className="h-14 w-14 object-contain opacity-80" draggable={false} />
          <h2 className="text-[15px] font-extrabold">Not in your ledger yet</h2>
          <p className="text-[13px]" style={{ color: 'var(--secondary-label)' }}>
            @{uniqueId} hasn't been added to your fan ledger.
          </p>
          <button onClick={onClose} className="panel-btn no-drag">Close</button>
        </div>
      </div>
    );
  }

  const { fan } = profile;
  const name = fanName(fan);

  return (
    <div className="flex h-full flex-col">
      {header}

      <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto px-5 py-4">
        {/* ── IDENTITY HEADER ──────────────────────────────────────────── */}
        <section className="flex items-start gap-3.5">
          <span className="flex-none rounded-full p-[2px]" style={{ boxShadow: '0 0 0 4px var(--fill-quaternary)' }}>
            <FanAvatar name={name} url={fan.avatarUrl} size={56} />
          </span>
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2">
              <h1 className="truncate text-[20px] font-extrabold leading-tight tracking-tight">{name}</h1>
              <TierChip tier={fan.tier} />
            </div>
            <div className="text-[12px] font-semibold" style={{ color: 'var(--secondary-label)' }}>@{fan.uniqueId}</div>
            <div className="mt-1.5 flex items-center gap-1.5 text-[12px] font-bold" style={{ color: 'var(--label)' }}>
              <TemperatureDot temperature={profile.temperature} size={8} />
              <span className="truncate">{composeStatus(profile)}</span>
            </div>
            <div className="mt-2 flex items-center gap-2.5">
              <StrengthBar score={profile.strength} barWidth={210} height={8} />
              <span className="flex-none text-[14px] tabular-nums" style={{ fontWeight: 950 }}>
                {profile.strength}<span style={{ color: 'var(--secondary-label)' }}>/100</span>
              </span>
            </div>
          </div>
        </section>

        <button
          onClick={onEscalate}
          className="flex w-full items-center justify-center gap-1.5 rounded-full border px-3 py-2.5 text-[13px] font-bold transition"
          style={{ borderColor: 'var(--brand-pink)', background: 'var(--gradient-pink)', color: '#fff' }}
        >
          Open full profile <span aria-hidden>→</span>
        </button>

        {/* ── PINNED ABOUT ─────────────────────────────────────────────── */}
        <PeekAbout uniqueId={fan.uniqueId} name={name} initial={fan.notes} onPatched={onFanPatched} />

        {/* ── QUICK-ADD NOTE ───────────────────────────────────────────── */}
        <QuickNote name={name} onSubmit={addNote} />

        {/* ── RECENT NOTES & ACTIVITY ──────────────────────────────────── */}
        <section>
          <div className="mb-2 text-[11px] font-bold uppercase tracking-wider" style={{ color: 'var(--secondary-label)' }}>🕒 Recent notes & activity</div>
          {events.length === 0 ? (
            <div className="rounded-2xl border border-dashed px-4 py-6 text-center text-[12px]" style={{ borderColor: 'var(--panel-border)', color: 'var(--tertiary-label)' }}>
              No activity yet — your notes, gifts and sessions for {name.split(' ')[0]} will show up here.
            </div>
          ) : (
            <ul className="flex flex-col gap-1.5">
              {events.map((ev) => {
                const isNote = NOTE_TYPES.has(ev.type);
                return (
                  <li
                    key={ev.id}
                    className="grid grid-cols-[28px_1fr_auto] items-start gap-2.5 rounded-xl px-2.5 py-2"
                    style={isNote
                      ? { background: 'color-mix(in srgb, var(--brand-pink) 8%, var(--fill-quaternary))', border: '1px solid color-mix(in srgb, var(--brand-pink) 22%, transparent)' }
                      : { border: '1px solid transparent' }}
                  >
                    <span className="flex h-7 w-7 items-center justify-center rounded-lg text-[13px]" style={{ background: isNote ? 'color-mix(in srgb, var(--brand-pink) 16%, transparent)' : 'var(--fill-thin)' }} aria-hidden>
                      {TIMELINE_ICON[ev.type] ?? '•'}
                    </span>
                    <div className="min-w-0">
                      <div className={`text-[13px] leading-snug ${isNote ? 'font-bold' : 'font-semibold'}`} style={!isNote ? { color: 'var(--label)' } : undefined}>{ev.summary}</div>
                      {ev.body && <p className="mt-0.5 text-[12px] leading-snug" style={{ color: 'var(--secondary-label)' }}>{ev.body}</p>}
                    </div>
                    <span className="whitespace-nowrap text-[11px] font-semibold" style={{ color: 'var(--tertiary-label)' }}>{relativeTime(ev.occurredAt)}</span>
                  </li>
                );
              })}
            </ul>
          )}
        </section>

        {/* ── KEY STATS ────────────────────────────────────────────────── */}
        <section className="grid grid-cols-2 gap-2">
          <Stat label="Lifetime 💎" value={`${formatNumber(fan.totalDiamonds)}`} sub={estimateMoney(fan.totalDiamonds, earnings) ?? undefined} />
          <Stat label="Gifts" value={formatNumber(fan.giftCount)} />
          <Stat label="Sessions" value={String(profile.sessionsAttended)} />
          <Stat label="Last seen" value={fan.lastSeenAt ? formatDate(fan.lastSeenAt) : '—'} />
        </section>

        {/* ── TAGS ─────────────────────────────────────────────────────── */}
        <TagRow tags={fan.tags} onChange={setTags} />

        {/* ── ACTIONS ──────────────────────────────────────────────────── */}
        <section className="flex flex-none items-stretch gap-2 pb-1">
          <button
            onClick={() => setShowThank(true)}
            className="flex-1 rounded-full px-3 py-2.5 text-[13px] font-bold text-white transition"
            style={{ background: 'var(--gradient-pink)' }}
          >
            💌 Send thank-you
          </button>
          <Tooltip content="Log a gift to this fan's ledger">
            <button
              onClick={() => setShowLogGift(true)}
              className="flex-none rounded-full border px-4 text-[13px] font-semibold transition hover:bg-[var(--fill-quaternary)]"
              style={{ borderColor: 'var(--panel-border)', color: 'var(--label)' }}
            >
              🎁 Log gift
            </button>
          </Tooltip>
        </section>
      </div>

      {showThank && (
        <ThankComposer
          uniqueId={fan.uniqueId}
          nickname={name}
          onClose={() => setShowThank(false)}
          onThanked={() => load()}
        />
      )}
      {showLogGift && (
        <LogGiftModal
          fixedFan={{ uniqueId: fan.uniqueId, nickname: fan.nickname }}
          onClose={() => setShowLogGift(false)}
          onLogged={() => { setShowLogGift(false); load(); }}
        />
      )}
    </div>
  );
}

// ── Pinned About — prominent, readable, debounced autosave ───────────────────
function PeekAbout({ uniqueId, name, initial, onPatched }: {
  uniqueId: string; name: string; initial: string; onPatched: (fan?: Fan) => void;
}) {
  const [notes, setNotes] = useState(initial);
  const [saved, setSaved] = useState<'idle' | 'saving' | 'saved'>('idle');
  const debounce = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => { setNotes(initial); }, [uniqueId]); // eslint-disable-line react-hooks/exhaustive-deps

  const onChange = (text: string) => {
    setNotes(text);
    setSaved('saving');
    if (debounce.current) clearTimeout(debounce.current);
    debounce.current = setTimeout(async () => {
      const res = await window.tiktok.fansUpdate(uniqueId, { notes: text }).catch(() => null);
      if (res?.ok) { onPatched(res.fan); setSaved('saved'); setTimeout(() => setSaved('idle'), 1500); }
      else setSaved('idle');
    }, 600);
  };

  return (
    <section
      className="rounded-2xl p-3.5"
      style={{ borderLeft: '3px solid var(--cyan)', background: 'color-mix(in srgb, var(--cyan) 6%, var(--fill-quaternary))', border: '1px solid color-mix(in srgb, var(--cyan) 22%, transparent)' }}
    >
      <div className="mb-1.5 flex items-center gap-2">
        <span className="text-[12px] font-bold uppercase tracking-wider" style={{ color: 'var(--cyan)' }}>📌 About — pinned</span>
        <span className="ml-auto text-[11px]" style={{ color: 'var(--tertiary-label)' }}>
          {saved === 'saving' ? 'Saving…' : saved === 'saved' ? 'Saved ✓' : ''}
        </span>
      </div>
      <textarea
        value={notes}
        onChange={(e) => onChange(e.target.value)}
        rows={3}
        placeholder={`The one thing to always remember about ${name.split(' ')[0]} — how you met, what they love, how they like to be thanked…`}
        className="w-full resize-y rounded-lg border border-transparent bg-transparent px-1 py-0.5 text-[15px] leading-relaxed outline-none transition placeholder:text-[color:var(--tertiary-label)] focus:border-cyan-500/30"
        style={{ minHeight: 64, color: 'var(--label)' }}
      />
    </section>
  );
}

// ── Quick-add dated note ─────────────────────────────────────────────────────
function QuickNote({ name, onSubmit }: { name: string; onSubmit: (body: string) => void | Promise<void> }) {
  const [draft, setDraft] = useState('');
  const [added, setAdded] = useState(false);
  const submit = () => {
    const v = draft.trim();
    if (!v) return;
    onSubmit(v);
    setDraft('');
    setAdded(true);
    setTimeout(() => setAdded(false), 1500);
  };
  return (
    <section>
      <div className="mb-1.5 flex items-center justify-between">
        <span className="text-[11px] font-bold uppercase tracking-wider" style={{ color: 'var(--secondary-label)' }}>✍️ Add a note</span>
        {added && <span className="text-[11px] font-semibold" style={{ color: 'var(--green)' }}>added ✓</span>}
      </div>
      <div className="flex items-end gap-2">
        <textarea
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) { e.preventDefault(); submit(); } }}
          rows={2}
          placeholder={`Jot something about ${name.split(' ')[0]} — lands on their timeline`}
          className="min-w-0 flex-1 resize-none rounded-xl border px-3 py-2 text-[14px] leading-relaxed outline-none transition placeholder:text-[color:var(--tertiary-label)] focus:border-pink-500/50"
          style={{ borderColor: 'var(--panel-border)', background: 'var(--fill-quaternary)', color: 'var(--label)' }}
        />
        <Tooltip content="Add to timeline (⌘/Ctrl+Enter)">
          <button
            onClick={submit}
            disabled={!draft.trim()}
            className="flex-none rounded-xl px-3.5 py-2 text-[13px] font-bold text-white transition disabled:opacity-40"
            style={{ background: 'var(--gradient-pink)' }}
          >
            Add
          </button>
        </Tooltip>
      </div>
    </section>
  );
}

// ── Compact stat tile ────────────────────────────────────────────────────────
function Stat({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="rounded-xl border px-3 py-2.5" style={{ borderColor: 'var(--panel-border)', background: 'var(--fill-quaternary)' }}>
      <div className="text-[11px] font-semibold" style={{ color: 'var(--secondary-label)' }}>{label}</div>
      <div className="mt-0.5 truncate text-[17px] font-extrabold tabular-nums leading-tight">
        {value}{sub && <span className="ml-1 text-[11px] font-semibold" style={{ color: 'var(--tertiary-label)' }}>{sub}</span>}
      </div>
    </div>
  );
}

// ── Tag editor (chips + inline add) ──────────────────────────────────────────
function TagRow({ tags, onChange }: { tags: string[]; onChange: (tags: string[]) => void }) {
  const [adding, setAdding] = useState(false);
  const [draft, setDraft] = useState('');
  const add = () => {
    const t = draft.trim();
    if (t && !tags.some((x) => x.toLowerCase() === t.toLowerCase())) onChange([...tags, t]);
    setDraft(''); setAdding(false);
  };
  return (
    <section className="flex flex-wrap items-center gap-1.5">
      {tags.map((t) => (
        <Tooltip key={t} content="Remove tag">
          <button
            onClick={() => onChange(tags.filter((x) => x !== t))}
            className="group inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-semibold transition"
            style={{ background: 'color-mix(in srgb, var(--cyan) 12%, transparent)', color: 'var(--cyan)' }}
          >
            {t}<span className="hidden group-hover:inline">✕</span>
          </button>
        </Tooltip>
      ))}
      {adding ? (
        <input
          autoFocus
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') add(); if (e.key === 'Escape') { setAdding(false); setDraft(''); } }}
          onBlur={add}
          placeholder="tag"
          className="h-6 w-24 rounded-full border bg-transparent px-2.5 text-[11px] outline-none focus:border-pink-500/60"
          style={{ borderColor: 'var(--panel-border)', color: 'var(--label)' }}
        />
      ) : (
        <Tooltip content="Add tag">
          <button
            onClick={() => setAdding(true)}
            className="inline-flex h-6 items-center gap-1 rounded-full border border-dashed px-2.5 text-[11px] font-semibold transition hover:border-pink-500/60"
            style={{ borderColor: 'var(--panel-border)', color: 'var(--secondary-label)' }}
          >
            + Tag
          </button>
        </Tooltip>
      )}
    </section>
  );
}
