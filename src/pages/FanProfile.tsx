/// <reference types="vite/client" />
/**
 * The 360° Fan Profile — the centerpiece of the fan CRM.
 *
 * One page, one fan: sticky identity header (strength + status + actions),
 * a stat strip, then a 3-column body — About/Notes/Custom-fields/Tags on the
 * left, the dominant activity TIMELINE in the centre, and Tasks/Why-strength/
 * Related on the right.
 *
 * Data sources (all window.tiktok.*):
 *   - fansProfile(uid)  → header, stats, strength breakdown, reminders, custom fields
 *   - fansTimeline(uid, {filter}) → the centre activity feed
 *   - fansAddNote / fansSetField / fieldsAddDef / fansUpdate → inline edits
 *   - reminderAction / fansMarkThanked → right-rail task actions
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type {
  CustomFieldDef, Fan, FanProfile as FanProfileData, Reminder, TimelineEvent, TimelineFilter,
} from '../types';
import { formatNumber, relativeTime } from '../lib/format';
import { useUI } from '../state/ui';
import { useAlerts } from '../state/alerts';
import {
  FanAvatar, TierChip, TagsEditor, StrengthBar, TemperatureDot, strengthColor, fanName,
} from '../components/crm';
import { ThankComposer } from '../components/ThankComposer';
import { LogGiftModal } from '../components/LogGiftModal';
import { Tabs, TabList, Tab, Tooltip } from '../components/ui';

const DAY = 86400000;

// ── timeline event presentation ───────────────────────────────────────────
type EventStyle = { icon: string; tone: 'manual' | 'thank' | 'quiet' };
const EVENT_STYLE: Record<TimelineEvent['type'], EventStyle> = {
  gift: { icon: '🎁', tone: 'quiet' },
  note: { icon: '✍️', tone: 'manual' },
  thank_you: { icon: '💌', tone: 'thank' },
  dm: { icon: '✉️', tone: 'manual' },
  shoutout: { icon: '⭐', tone: 'manual' },
  tier_up: { icon: '👑', tone: 'quiet' },
  reminder_done: { icon: '✅', tone: 'quiet' },
  manual_gift_log: { icon: '🎁', tone: 'manual' },
  session_attend: { icon: '📺', tone: 'quiet' },
  first_seen: { icon: '👋', tone: 'quiet' },
  comment_rollup: { icon: '💬', tone: 'quiet' },
};

const FILTERS: { id: TimelineFilter; label: string }[] = [
  { id: 'all', label: 'All' },
  { id: 'gift', label: 'Gifts' },
  { id: 'comment', label: 'Comments' },
  { id: 'note', label: 'Notes' },
  { id: 'session', label: 'Sessions' },
];

function dayKey(ts: number): string {
  const d = new Date(ts);
  return `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
}
function dayLabel(ts: number, now = Date.now()): string {
  const today = new Date(now); today.setHours(0, 0, 0, 0);
  const d = new Date(ts); d.setHours(0, 0, 0, 0);
  const diff = Math.round((today.getTime() - d.getTime()) / DAY);
  if (diff === 0) return 'Today';
  if (diff === 1) return 'Yesterday';
  return new Date(ts).toLocaleDateString(undefined, { day: 'numeric', month: 'short' });
}

/** Compose the one-line status under the name from the profile bundle. */
function composeStatus(p: FanProfileData): string {
  const parts: string[] = [];
  if (p.fan.tier === 'VIP' || p.fan.tier === 'Whale') parts.push(p.fan.tier);
  const d = p.daysSinceContact;
  parts.push(d <= 0 ? 'gave today' : `gave ${d} day${d === 1 ? '' : 's'} ago`);
  if (p.fan.lastThankedAt) {
    const td = Math.max(0, Math.floor((Date.now() - p.fan.lastThankedAt) / DAY));
    parts.push(td <= 0 ? 'thanked today' : `last thanked ${td} day${td === 1 ? '' : 's'} ago`);
  } else {
    parts.push('never thanked');
  }
  parts.push(p.temperature);
  return parts.join(' · ');
}

// ── card shell ─────────────────────────────────────────────────────────────
function Card({ title, children, className = '', bodyClass = '' }: { title?: string; children: React.ReactNode; className?: string; bodyClass?: string }) {
  return (
    <article className={`glass ${className}`} style={{ borderRadius: 18 }}>
      {title && <h2 className="px-4 pb-3 pt-4 text-[14px] font-extrabold tracking-tight">{title}</h2>}
      <div className={`px-4 pb-4 ${title ? '' : 'pt-4'} ${bodyClass}`}>{children}</div>
    </article>
  );
}

export function FanProfile() {
  const uniqueId = useUI((s) => s.fanFocus);
  const closeFanProfile = useUI((s) => s.closeFanProfile);
  const fanReturnTo = useUI((s) => s.fanReturnTo);
  const pushToast = useAlerts((s) => s.pushToast);

  const [profile, setProfile] = useState<FanProfileData | null>(null);
  const [loading, setLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);

  // timeline state
  const [filter, setFilter] = useState<TimelineFilter>('all');
  const [events, setEvents] = useState<TimelineEvent[]>([]);
  const [timelineLoading, setTimelineLoading] = useState(true);

  // composer / modals
  const [showThank, setShowThank] = useState(false);
  const [showLogGift, setShowLogGift] = useState(false);
  const composerRef = useRef<HTMLTextAreaElement | null>(null);

  const backLabel = fanReturnTo === 'dashboard' ? '← Dashboard' : fanReturnTo === 'gifts' ? '← Gifts' : '← Fans';

  const loadProfile = useCallback(async (uid: string) => {
    const p = await window.tiktok.fansProfile(uid).catch(() => null);
    setProfile(p);
    setNotFound(!p);
    setLoading(false);
  }, []);

  useEffect(() => {
    if (!uniqueId) { setLoading(false); setNotFound(true); return; }
    setLoading(true); setNotFound(false); setProfile(null);
    loadProfile(uniqueId);
  }, [uniqueId, loadProfile]);

  // timeline — refetch only when the fan or filter changes (not per keystroke).
  useEffect(() => {
    if (!uniqueId) return;
    let alive = true;
    setTimelineLoading(true);
    window.tiktok.fansTimeline(uniqueId, { filter }).then((rows) => {
      if (alive) { setEvents(rows); setTimelineLoading(false); }
    }).catch(() => { if (alive) setTimelineLoading(false); });
    return () => { alive = false; };
  }, [uniqueId, filter]);

  // ── inline edit handlers ──────────────────────────────────────────────
  const onFanPatched = (fan?: Fan) => {
    if (fan) setProfile((p) => (p ? { ...p, fan } : p));
  };

  const addNote = async (body: string) => {
    if (!uniqueId || !body.trim()) return;
    // optimistic prepend
    const optimistic: TimelineEvent = {
      id: `tmp-${Date.now()}`, type: 'note', source: 'manual',
      occurredAt: Date.now(), summary: 'Note added', body: body.trim(),
    };
    setEvents((e) => [optimistic, ...e]);
    const res = await window.tiktok.fansAddNote(uniqueId, body.trim());
    if (res.ok && res.event) {
      setEvents((e) => e.map((ev) => (ev.id === optimistic.id ? res.event! : ev)));
    } else if (!res.ok) {
      setEvents((e) => e.filter((ev) => ev.id !== optimistic.id));
      pushToast({ title: 'Could not add note', body: res.error ?? 'Unknown error' });
    }
  };

  if (loading) {
    return (
      <div className="flex min-h-0 flex-1 items-center justify-center p-8">
        <div className="flex flex-col items-center gap-3 text-center">
          <div className="h-10 w-10 animate-spin rounded-full border-2 border-zinc-700 border-t-pink-500" />
          <div className="text-[13px]" style={{ color: 'var(--secondary-label)' }}>Loading fan profile…</div>
        </div>
      </div>
    );
  }

  if (notFound || !profile) {
    return (
      <div className="flex min-h-0 flex-1 flex-col items-center justify-center gap-3 p-10 text-center">
        <img src="./assets/png/icon_group_3d.png" alt="" className="h-16 w-16 object-contain" draggable={false} />
        <h2 className="text-base font-extrabold">Fan not found</h2>
        <p className="max-w-sm text-[13px]" style={{ color: 'var(--secondary-label)' }}>
          {uniqueId ? `@${uniqueId} isn't in your ledger yet.` : 'No fan selected.'}
        </p>
        <button onClick={closeFanProfile} className="panel-btn panel-btn-primary no-drag">{backLabel}</button>
      </div>
    );
  }

  const { fan } = profile;
  const name = fanName(fan);

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-y-auto p-5">
      {/* breadcrumb / back */}
      <div className="mb-2 flex items-center gap-2 text-[13px]" style={{ color: 'var(--secondary-label)' }}>
        <button onClick={closeFanProfile} className="panel-btn no-drag !h-7 !px-3">{backLabel}</button>
        <span aria-hidden>›</span>
        <span style={{ color: 'var(--label)', fontWeight: 700 }}>{name}</span>
      </div>

      {/* ── STICKY HEADER ─────────────────────────────────────────────── */}
      <section
        className="glass sticky top-0 z-20 grid grid-cols-[1fr_auto] gap-4 p-5"
        style={{ borderRadius: 18 }}
      >
        <div className="flex items-center gap-4">
          <span className="flex-none rounded-full p-[3px]" style={{ boxShadow: '0 0 0 5px var(--fill-quaternary)' }}>
            <FanAvatar name={name} url={fan.avatarUrl} size={84} />
          </span>
          <div className="min-w-0">
            <div className="flex items-center gap-2.5">
              <h1 className="truncate text-[30px] font-extrabold leading-none tracking-tight">{name}</h1>
              <TierChip tier={fan.tier} />
            </div>
            <div className="mt-1.5 text-[13px] font-semibold" style={{ color: 'var(--secondary-label)' }}>@{fan.uniqueId}</div>
            <div className="mt-2 flex items-center gap-2 text-[13px] font-bold" style={{ color: 'var(--label)' }}>
              <TemperatureDot temperature={profile.temperature} size={8} />
              <span className="truncate">{composeStatus(profile)}</span>
            </div>
            <div className="mt-3 flex items-center gap-3">
              <StrengthBar score={profile.strength} barWidth={300} height={9} />
              <span className="text-[15px] tabular-nums" style={{ fontWeight: 950 }}>{profile.strength}<span style={{ color: 'var(--secondary-label)' }}>/100</span></span>
            </div>
          </div>
        </div>

        <div className="flex flex-none items-start gap-2">
          <button onClick={() => setShowThank(true)} className="panel-btn panel-btn-primary no-drag">Send thank-you</button>
          <button onClick={() => setShowLogGift(true)} className="panel-btn no-drag">Log gift</button>
          <button
            onClick={() => { composerRef.current?.focus(); composerRef.current?.scrollIntoView({ block: 'center', behavior: 'smooth' }); }}
            className="panel-btn no-drag"
          >
            Add note
          </button>
        </div>
      </section>

      {/* ── STAT STRIP ────────────────────────────────────────────────── */}
      <section className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
        <StatTile label="Lifetime diamonds" value={`${fan.totalDiamonds.toLocaleString()} 💎`} icon="./assets/png/icon_diamond_3d.png" tint="rgba(105,201,208,0.16)" />
        <StatTile label="Gifts" value={formatNumber(fan.giftCount)} icon="./assets/png/icon_gift_box_3d.png" tint="rgba(238,29,82,0.14)" />
        <StatTile label="Sessions attended" value={String(profile.sessionsAttended)} icon="./assets/png/icon_group_3d.png" tint="rgba(197,155,255,0.16)" />
        <StatTile label="Current streak" value={profile.currentStreak > 0 ? `${profile.currentStreak} wk${profile.currentStreak === 1 ? '' : 's'}` : '—'} icon="./assets/png/icon_star_award_3d.png" tint="rgba(255,209,102,0.16)" />
        <StatTile label="Days since contact" value={String(profile.daysSinceContact)} icon="./assets/png/icon_clock_3d.png" tint="rgba(255,179,92,0.16)" />
      </section>

      {/* ── PINNED "ABOUT" — prominent, full-width, large readable text ── */}
      <AboutCard uniqueId={fan.uniqueId} name={name} initial={fan.notes} onPatched={onFanPatched} />

      {/* ── 3-COLUMN BODY ─────────────────────────────────────────────── */}
      <section className="mt-4 grid grid-cols-1 items-start gap-4 lg:grid-cols-[288px_minmax(0,1fr)_300px]">
        {/* LEFT */}
        <div className="flex flex-col gap-4">
          <CustomFieldsCard
            uniqueId={fan.uniqueId}
            defs={profile.customFieldDefs}
            values={profile.customFields}
            onChange={(values, defs) => setProfile((p) => (p ? { ...p, customFields: values, customFieldDefs: defs ?? p.customFieldDefs } : p))}
          />
          <Card title="Tags">
            <TagsEditor
              tags={fan.tags}
              onChange={async (tags) => {
                const res = await window.tiktok.fansUpdate(fan.uniqueId, { tags });
                if (res.ok && res.fan) onFanPatched(res.fan);
              }}
            />
          </Card>
        </div>

        {/* CENTER — timeline */}
        <Card className="overflow-hidden" bodyClass="!px-0 !pb-0 !pt-0">
          <div className="sticky top-0 z-10 border-b px-4 pb-3.5 pt-4 backdrop-blur" style={{ borderColor: 'var(--panel-border)', background: 'color-mix(in srgb, var(--panel-bg-strong) 82%, transparent)' }}>
            <h2 className="mb-3 text-[14px] font-extrabold tracking-tight">Activity timeline</h2>
            <Tabs value={filter} onValueChange={(v) => setFilter(v as TimelineFilter)} variant="segment" className="mb-3">
              <TabList ariaLabel="Timeline filter" className="flex-wrap">
                {FILTERS.map((f) => (
                  <Tab key={f.id} value={f.id} label={f.label} />
                ))}
              </TabList>
            </Tabs>
            <NoteComposerInline name={name} composerRef={composerRef} onSubmit={addNote} />
          </div>

          <TimelineBody events={events} loading={timelineLoading} name={name} />
        </Card>

        {/* RIGHT */}
        <div className="flex flex-col gap-4">
          <TasksCard
            reminders={profile.reminders}
            uniqueId={fan.uniqueId}
            onThank={() => setShowThank(true)}
            onChanged={() => loadProfile(fan.uniqueId)}
          />
          <Card title={`Why ${profile.strength} Strength`}>
            <div className="flex flex-col gap-3">
              <MiniBar label="Recency" value={profile.breakdown.recency} />
              <MiniBar label="Generosity" value={profile.breakdown.generosity} />
              <MiniBar label="Frequency" value={profile.breakdown.frequency} />
              <MiniBar label="Loyalty" value={profile.breakdown.loyalty} />
            </div>
          </Card>
          <RelatedCard profile={profile} events={events} />
        </div>
      </section>

      {showThank && (
        <ThankComposer
          uniqueId={fan.uniqueId}
          nickname={name}
          onClose={() => setShowThank(false)}
          onThanked={() => loadProfile(fan.uniqueId)}
        />
      )}
      {showLogGift && (
        <LogGiftModal
          fixedFan={{ uniqueId: fan.uniqueId, nickname: fan.nickname }}
          onClose={() => setShowLogGift(false)}
          onLogged={() => {
            setShowLogGift(false);
            pushToast({ title: 'Gift logged', body: `Added to @${fan.uniqueId}'s ledger` });
            loadProfile(fan.uniqueId);
            // refresh timeline too
            window.tiktok.fansTimeline(fan.uniqueId, { filter }).then(setEvents).catch(() => {});
          }}
        />
      )}
    </div>
  );
}

// ── stat tile ────────────────────────────────────────────────────────────
function StatTile({ label, value, icon, tint, sub }: { label: string; value: string; icon: string; tint: string; sub?: string }) {
  return (
    <div className="glass brand-top-border relative p-4" style={{ borderRadius: 16 }}>
      <span className="flex h-9 w-9 items-center justify-center rounded-full" style={{ background: tint }}>
        <img src={icon} alt="" className="h-6 w-6 object-contain" draggable={false} />
      </span>
      <div className="mt-2 text-[12px] font-semibold" style={{ color: 'var(--secondary-label)' }}>{label}</div>
      <div className="mt-0.5 truncate text-[24px] font-extrabold leading-tight tracking-tight">
        {value}{sub && <span className="ml-1 text-[12px] font-semibold" style={{ color: 'var(--secondary-label)' }}>{sub}</span>}
      </div>
    </div>
  );
}

// ── strength mini-bar ──────────────────────────────────────────────────────
function MiniBar({ label, value }: { label: string; value: number }) {
  return (
    <div className="grid grid-cols-[86px_1fr_30px] items-center gap-2.5 text-[12px]">
      <span style={{ color: 'var(--secondary-label)', fontWeight: 700 }}>{label}</span>
      <span className="overflow-hidden rounded-full" style={{ height: 7, background: 'var(--fill-thin)', boxShadow: 'inset 0 0 0 1px rgba(255,255,255,.07)' }}>
        <span className="block h-full rounded-full" style={{ width: `${Math.max(0, Math.min(100, value))}%`, background: strengthColor(value) }} />
      </span>
      <span className="text-right tabular-nums" style={{ fontWeight: 900 }}>{Math.round(value)}</span>
    </div>
  );
}

// ── inline note composer (pinned top of timeline) ───────────────────────────
function NoteComposerInline({ name, composerRef, onSubmit }: {
  name: string;
  composerRef: React.MutableRefObject<HTMLTextAreaElement | null>;
  onSubmit: (body: string) => void | Promise<void>;
}) {
  const [draft, setDraft] = useState('');
  const submit = () => {
    const v = draft.trim();
    if (!v) return;
    onSubmit(v);
    setDraft('');
  };
  return (
    <div
      className="flex items-center gap-2.5 rounded-2xl border px-3.5 py-2.5"
      style={{ borderColor: 'rgba(238,29,82,.28)', background: 'rgba(238,29,82,.06)' }}
    >
      <span className="flex h-7 w-7 flex-none items-center justify-center rounded-lg text-[14px]" style={{ background: 'rgba(238,29,82,.18)' }} aria-hidden>✍️</span>
      <textarea
        ref={composerRef}
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onKeyDown={(e) => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) { e.preventDefault(); submit(); } }}
        rows={1}
        placeholder={`Add a note about ${name}…`}
        className="min-h-[24px] flex-1 resize-none bg-transparent text-[14px] outline-none placeholder:text-[color:var(--tertiary-label)]"
      />
      <button onClick={submit} disabled={!draft.trim()} className="panel-btn panel-btn-primary no-drag !h-8 flex-none">Add note</button>
    </div>
  );
}

// ── timeline body (grouped by day) ──────────────────────────────────────────
function TimelineBody({ events, loading, name }: { events: TimelineEvent[]; loading: boolean; name: string }) {
  const groups = useMemo(() => {
    const out: { key: string; label: string; rows: TimelineEvent[] }[] = [];
    for (const ev of events) {
      const k = dayKey(ev.occurredAt);
      let g = out[out.length - 1];
      if (!g || g.key !== k) { g = { key: k, label: dayLabel(ev.occurredAt), rows: [] }; out.push(g); }
      g.rows.push(ev);
    }
    return out;
  }, [events]);

  if (loading) {
    return <div className="px-4 py-16 text-center text-[13px]" style={{ color: 'var(--secondary-label)' }}>Loading activity…</div>;
  }
  if (events.length === 0) {
    return (
      <div className="flex flex-col items-center gap-2 px-4 py-16 text-center">
        <img src="./assets/png/icon_clock_3d.png" alt="" className="h-12 w-12 object-contain opacity-80" draggable={false} />
        <div className="text-[13px] font-semibold">No activity here yet</div>
        <div className="max-w-xs text-[12px]" style={{ color: 'var(--secondary-label)' }}>
          Gifts, comments, sessions and your notes about {name} will show up here.
        </div>
      </div>
    );
  }
  return (
    <div className="px-4 pb-4">
      {groups.map((g) => (
        <div key={g.key} className="pt-3">
          <div className="mb-2 flex items-center gap-2.5 text-[11px] font-extrabold uppercase tracking-wider" style={{ color: 'var(--label)' }}>
            {g.label}
            <span className="h-px flex-1" style={{ background: 'var(--separator)' }} />
          </div>
          {g.rows.map((ev) => <EventRow key={ev.id} ev={ev} />)}
        </div>
      ))}
    </div>
  );
}

function EventRow({ ev }: { ev: TimelineEvent }) {
  const style = EVENT_STYLE[ev.type] ?? { icon: '•', tone: 'quiet' as const };
  const diamonds = typeof ev.payload?.diamonds === 'number' ? ev.payload.diamonds as number : null;
  const kind = typeof ev.payload?.kind === 'string' ? ev.payload.kind as string : null;

  const toneStyle =
    style.tone === 'manual'
      ? { background: 'linear-gradient(90deg, rgba(238,29,82,.12), var(--fill-quaternary))', border: '1px solid rgba(238,29,82,.22)' }
      : style.tone === 'thank'
        ? { background: 'linear-gradient(90deg, rgba(105,201,208,.12), var(--fill-quaternary))', border: '1px solid rgba(105,201,208,.2)' }
        : { border: '1px solid transparent' };
  const iconBg = style.tone === 'manual' ? 'rgba(238,29,82,.18)' : style.tone === 'thank' ? 'rgba(105,201,208,.16)' : 'var(--fill-thin)';
  const muted = ev.type === 'comment_rollup';

  return (
    <div className="grid grid-cols-[34px_1fr_auto] items-start gap-3 rounded-2xl p-3" style={toneStyle}>
      <span className="flex h-[34px] w-[34px] items-center justify-center rounded-xl text-[15px]" style={{ background: iconBg }}>{style.icon}</span>
      <div className="min-w-0">
        <div className={`text-[14px] ${muted ? 'font-medium' : 'font-bold'}`} style={muted ? { color: 'var(--secondary-label)' } : undefined}>{ev.summary}</div>
        {ev.body && <p className="mt-1 text-[12px] leading-snug" style={{ color: 'var(--secondary-label)' }}>{ev.body}</p>}
        {(diamonds !== null || kind) && (
          <span className="mt-1.5 inline-flex items-center rounded-full px-2 py-1 text-[11px] font-extrabold"
            style={diamonds !== null
              ? { background: 'rgba(105,201,208,.12)', color: 'var(--cyan)' }
              : { background: 'var(--fill-thin)', color: 'var(--secondary-label)' }}>
            {diamonds !== null ? `${formatNumber(diamonds)} 💎` : kind}
          </span>
        )}
      </div>
      <span className="whitespace-nowrap text-[12px] font-semibold" style={{ color: 'var(--tertiary-label)' }}>{relativeTime(ev.occurredAt)}</span>
    </div>
  );
}

// ── Pinned "About" — the prominent, at-a-glance card at the top of the record.
// Large readable text (reads like prose when not editing), click to edit inline,
// debounced autosave. This is the canonical fan.notes summary.
function AboutCard({ uniqueId, name, initial, onPatched }: {
  uniqueId: string; name: string; initial: string; onPatched: (fan?: Fan) => void;
}) {
  const [notes, setNotes] = useState(initial);
  const [editing, setEditing] = useState(false);
  const [saved, setSaved] = useState<'idle' | 'saving' | 'saved'>('idle');
  const debounce = useRef<ReturnType<typeof setTimeout> | null>(null);
  const taRef = useRef<HTMLTextAreaElement | null>(null);
  useEffect(() => { setNotes(initial); }, [uniqueId]); // eslint-disable-line react-hooks/exhaustive-deps

  const onChange = (text: string) => {
    setNotes(text);
    setSaved('saving');
    if (debounce.current) clearTimeout(debounce.current);
    debounce.current = setTimeout(async () => {
      const res = await window.tiktok.fansUpdate(uniqueId, { notes: text });
      if (res.ok) { onPatched(res.fan); setSaved('saved'); setTimeout(() => setSaved('idle'), 1500); }
      else setSaved('idle');
    }, 600);
  };

  const startEdit = () => { setEditing(true); setTimeout(() => taRef.current?.focus(), 30); };
  const hasText = notes.trim().length > 0;

  return (
    <section className="glass mt-4 p-5" style={{ borderRadius: 18 }}>
      <div className="mb-3 flex items-center gap-2">
        <span className="text-[15px]" aria-hidden>📌</span>
        <h2 className="text-[13px] font-extrabold uppercase tracking-wider" style={{ color: 'var(--secondary-label)' }}>
          About {name.split(' ')[0]} — pinned
        </h2>
        <span className="ml-auto text-[11px]" style={{ color: 'var(--tertiary-label)' }}>
          {saved === 'saving' ? 'Saving…' : saved === 'saved' ? 'Saved ✓' : ''}
        </span>
        {!editing && (
          <button onClick={startEdit} className="panel-btn no-drag !h-7 !px-3">{hasText ? '✏️ Edit' : '+ Add'}</button>
        )}
      </div>

      {editing ? (
        <textarea
          ref={taRef}
          value={notes}
          onChange={(e) => onChange(e.target.value)}
          onBlur={() => setEditing(false)}
          rows={4}
          placeholder="The one stable summary: how you met, what they love, how they like to be thanked, anything to never forget…"
          className="w-full resize-y rounded-2xl border px-4 py-3.5 text-[16px] leading-relaxed outline-none transition placeholder:text-[color:var(--tertiary-label)] focus:border-pink-500/60"
          style={{ minHeight: 120, borderColor: 'var(--panel-border)', background: 'var(--fill-quaternary)' }}
        />
      ) : hasText ? (
        <button
          onClick={startEdit}
          className="block w-full rounded-2xl border px-5 py-4 text-left transition hover:border-pink-500/40"
          style={{ borderColor: 'var(--panel-border)', borderLeft: '3px solid var(--cyan)', background: 'color-mix(in srgb, var(--cyan) 5%, var(--fill-quaternary))' }}
        >
          <p className="whitespace-pre-wrap text-[17px] font-medium leading-relaxed" style={{ color: 'var(--label)' }}>{notes}</p>
        </button>
      ) : (
        <button
          onClick={startEdit}
          className="block w-full rounded-2xl border border-dashed px-5 py-6 text-left text-[14px] transition hover:border-pink-500/40"
          style={{ borderColor: 'var(--panel-border)', color: 'var(--tertiary-label)' }}
        >
          Add a pinned summary about {name.split(' ')[0]} — the first thing you want to see every time.
        </button>
      )}
    </section>
  );
}

// ── Custom fields ────────────────────────────────────────────────────────────
function CustomFieldsCard({ uniqueId, defs, values, onChange }: {
  uniqueId: string;
  defs: CustomFieldDef[];
  values: Record<string, unknown>;
  onChange: (values: Record<string, unknown>, defs?: CustomFieldDef[]) => void;
}) {
  const pushToast = useAlerts((s) => s.pushToast);
  const [editing, setEditing] = useState<string | null>(null);
  const [draft, setDraft] = useState('');
  const [adding, setAdding] = useState(false);
  const [newLabel, setNewLabel] = useState('');

  const save = async (key: string, value: string) => {
    const res = await window.tiktok.fansSetField(uniqueId, key, value);
    if (res.ok && res.fan) onChange(res.fan.customFields ?? {});
    setEditing(null);
  };

  const addField = async () => {
    const label = newLabel.trim();
    if (!label) return;
    const res = await window.tiktok.fieldsAddDef({ label, type: 'text' });
    if (res.ok && res.def) {
      const next = await window.tiktok.fieldsListDefs();
      onChange(values, next);
    } else {
      pushToast({ title: 'Could not add field', body: res.error ?? 'Unknown error' });
    }
    setNewLabel(''); setAdding(false);
  };

  const fmt = (def: CustomFieldDef, v: unknown): string => {
    if (v === undefined || v === null || v === '') return '—';
    if (def.type === 'checkbox') return v ? 'Yes' : 'No';
    if (Array.isArray(v)) return v.join(', ');
    return String(v);
  };

  return (
    <Card title="Custom Fields">
      {defs.length === 0 ? (
        <div className="text-[12px]" style={{ color: 'var(--secondary-label)' }}>No custom fields yet.</div>
      ) : (
        defs.map((def, i) => {
          const v = values[def.key];
          const isEditing = editing === def.key;
          return (
            <div key={def.id} className="grid grid-cols-[106px_1fr] items-center gap-2.5 py-2.5 text-[13px]" style={i < defs.length - 1 ? { borderBottom: '1px solid var(--separator)' } : undefined}>
              <span className="font-semibold" style={{ color: 'var(--secondary-label)' }}>{def.label}</span>
              {isEditing ? (
                <input
                  autoFocus
                  value={draft}
                  onChange={(e) => setDraft(e.target.value)}
                  onKeyDown={(e) => { if (e.key === 'Enter') save(def.key, draft); if (e.key === 'Escape') setEditing(null); }}
                  onBlur={() => save(def.key, draft)}
                  className="w-full rounded-lg border bg-transparent px-2 py-1 text-[13px] outline-none focus:border-pink-500/60"
                  style={{ borderColor: 'var(--panel-border)' }}
                />
              ) : (
                <Tooltip content="Click to edit">
                  <button
                    onClick={() => { setEditing(def.key); setDraft(v == null ? '' : String(v)); }}
                    className="-mx-1 rounded px-1 text-left transition hover:bg-[var(--fill-quaternary)]"
                    style={v == null || v === '' ? { color: 'var(--tertiary-label)' } : undefined}
                  >
                    {fmt(def, v)}
                  </button>
                </Tooltip>
              )}
            </div>
          );
        })
      )}
      {adding ? (
        <div className="mt-3 flex items-center gap-2">
          <input
            autoFocus
            value={newLabel}
            onChange={(e) => setNewLabel(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') addField(); if (e.key === 'Escape') { setAdding(false); setNewLabel(''); } }}
            placeholder="Field name (e.g. Birthday)"
            className="flex-1 rounded-lg border bg-transparent px-2 py-1 text-[12px] outline-none focus:border-pink-500/60"
            style={{ borderColor: 'var(--panel-border)' }}
          />
          <button onClick={addField} disabled={!newLabel.trim()} className="panel-btn panel-btn-primary no-drag !h-7">Add</button>
        </div>
      ) : (
        <button onClick={() => setAdding(true)} className="mt-3 text-[12px] font-semibold" style={{ color: 'var(--brand-pink)' }}>+ Add field</button>
      )}
    </Card>
  );
}

// ── Tasks / Reminders ────────────────────────────────────────────────────────
function TasksCard({ reminders, uniqueId, onThank, onChanged }: {
  reminders: Reminder[];
  uniqueId: string;
  onThank: () => void;
  onChanged: () => void;
}) {
  const pushToast = useAlerts((s) => s.pushToast);
  const act = async (id: string, action: 'done' | 'snooze', days?: number) => {
    const res = await window.tiktok.reminderAction({ id, action, days });
    if (res.ok) onChanged();
    else pushToast({ title: 'Could not update reminder', body: res.error ?? 'Unknown error' });
  };
  const markThanked = async () => {
    const res = await window.tiktok.fansMarkThanked(uniqueId);
    if (res.ok) { pushToast({ title: 'Marked thanked 💌', body: `@${uniqueId} — reminders cleared` }); onChanged(); }
  };

  return (
    <Card title="Tasks / Reminders" bodyClass="flex flex-col gap-2.5">
      {reminders.length === 0 ? (
        <div className="flex flex-col items-start gap-2">
          <p className="text-[12px]" style={{ color: 'var(--secondary-label)' }}>No open tasks for this fan. You're all caught up.</p>
          <button onClick={onThank} className="panel-btn no-drag !h-7">Send a thank-you</button>
        </div>
      ) : (
        reminders.map((r) => {
          const label = r.kind === 'birthday' ? '🎂 Birthday coming up' : r.kind === 'thank' ? '💌 Thank them for a recent gift' : '👋 Re-engage — going quiet';
          const due = r.kind === 'birthday' ? (r.days === 0 ? 'Today' : `In ${r.days} day${r.days === 1 ? '' : 's'}`) : r.kind === 'quiet' ? `Quiet ${r.days}d` : 'Pending';
          return (
            <div key={r.id} className="rounded-2xl border p-3" style={{ borderColor: 'var(--panel-border)', background: 'var(--fill-quaternary)' }}>
              <div className="text-[13px] font-bold">{label}</div>
              <div className="mt-1 text-[11px] font-extrabold" style={{ color: 'var(--orange)' }}>{due}</div>
              <div className="mt-2 flex flex-wrap gap-1.5">
                {r.kind === 'thank' || r.kind === 'birthday' ? (
                  <button onClick={() => { onThank(); }} className="panel-btn panel-btn-primary no-drag !h-7">Thank</button>
                ) : null}
                <button onClick={() => act(r.id, 'snooze', 3)} className="panel-btn no-drag !h-7">Snooze 3d</button>
                <button onClick={() => (r.kind === 'thank' ? markThanked() : act(r.id, 'done'))} className="panel-btn no-drag !h-7">Done</button>
              </div>
            </div>
          );
        })
      )}
    </Card>
  );
}

// ── Related ──────────────────────────────────────────────────────────────────
function RelatedCard({ profile, events }: { profile: FanProfileData; events: TimelineEvent[] }) {
  const sessionNames = useMemo(() => {
    const names = events.filter((e) => e.type === 'session_attend').map((e) => e.summary.replace(/^Attended\s+/, '').replace(/^"|"$/g, ''));
    return [...new Set(names)].slice(0, 5);
  }, [events]);

  return (
    <Card title="Related" bodyClass="flex flex-col gap-2.5">
      <div className="rounded-2xl border p-3" style={{ borderColor: 'var(--panel-border)', background: 'var(--fill-quaternary)' }}>
        <div className="text-[13px] font-bold">Sessions attended</div>
        <p className="mt-1 text-[12px] leading-snug" style={{ color: 'var(--secondary-label)' }}>
          {profile.sessionsAttended > 0 ? `${profile.sessionsAttended} total` : 'None yet'}
          {sessionNames.length > 0 && <> · {sessionNames.join(', ')}</>}
        </p>
      </div>
      <div className="grid grid-cols-2 gap-2.5">
        <div className="rounded-2xl border p-3" style={{ borderColor: 'var(--panel-border)', background: 'var(--fill-quaternary)' }}>
          <div className="text-[13px] font-bold">30-day 💎</div>
          <p className="mt-1 text-[12px]" style={{ color: 'var(--secondary-label)' }}>{formatNumber(profile.diamonds30d)}</p>
        </div>
        <div className="rounded-2xl border p-3" style={{ borderColor: 'var(--panel-border)', background: 'var(--fill-quaternary)' }}>
          <div className="text-[13px] font-bold">Stage</div>
          <p className="mt-1 text-[12px]" style={{ color: 'var(--secondary-label)' }}>{profile.fan.tier === 'Whale' || profile.fan.tier === 'VIP' ? 'Core supporter' : profile.fan.tier === 'Regular' ? 'Engaged' : 'New'}</p>
        </div>
      </div>
    </Card>
  );
}
