/// <reference types="vite/client" />
/**
 * Dashboard — the "who needs me today" people-queue HUB (B+C hybrid).
 *
 * Instead of KPI tiles, the home is a responsive grid of ranked PEOPLE QUEUES —
 * each a short, scannable list of fans (avatar + name/@handle + tier + a one-line
 * REASON + a one-click action). Clicking a fan's row body opens the global PEEK
 * drawer (glance without leaving). A compact greeting header + theme toggle stay
 * on top; one secondary stat row sits below the queues.
 *
 * All data is derived from real IPC (reminders / fans / gifts / sessions) with
 * honest empty states. Every read is fail-safe.
 */
import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { Calendar, Radio } from 'lucide-react';
import type { Fan, GiftRecord, Reminder, SessionSummary, Temperature } from '../types';
import { estimateMoney, formatDiamonds, formatNumber, relativeTime } from '../lib/format';
import { useSettingsLoad } from '../state/settings';
import { useUI } from '../state/ui';
import { useAlerts } from '../state/alerts';
import { ThankComposer } from '../components/ThankComposer';
import { ThemeToggle } from '../components/ThemeToggle';
import { FanAvatar, TierChip, TemperatureDot, fanName } from '../components/crm';
import { Tooltip } from '../components/ui';

const DAY = 86400000;
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const QUEUE_CAP = 6;

function greeting(): string {
  const h = new Date().getHours();
  if (h < 5) return 'Good night';
  if (h < 12) return 'Good morning';
  if (h < 18) return 'Good afternoon';
  return 'Good evening';
}

function weekRangeLabel(): string {
  const now = new Date();
  const day = (now.getDay() + 6) % 7; // Monday = 0
  const start = new Date(now.getTime() - day * DAY);
  const end = new Date(start.getTime() + 6 * DAY);
  const fmt = (d: Date) => `${MONTHS[d.getMonth()]} ${d.getDate()}`;
  return `${fmt(start)} – ${fmt(end)}`;
}

function birthdayWhen(r: Reminder): string {
  return r.days === 0 ? 'today' : r.days === 1 ? 'tomorrow' : `in ${r.days} days`;
}

function daysLabel(days: number): string {
  return days === 1 ? '1 day' : `${days} days`;
}

// ---------------------------------------------------------------------------
// Presentational primitives

/** A queue card shell: title + count badge + scrollable short list + footer link. */
function QueueCard({
  title,
  emoji,
  accent,
  count,
  viewAllLabel,
  onViewAll,
  empty,
  children,
}: {
  title: string;
  emoji: string;
  accent: string;
  count: number;
  viewAllLabel: string;
  onViewAll: () => void;
  empty: ReactNode;
  children: ReactNode;
}) {
  return (
    <section className="glass flex min-h-[220px] flex-col p-4" style={{ borderRadius: 18 }}>
      <header className="mb-2 flex items-center gap-2">
        <span
          className="flex h-7 w-7 flex-none items-center justify-center rounded-full text-[13px]"
          style={{ background: accent }}
          aria-hidden
        >
          {emoji}
        </span>
        <h3 className="text-sm font-bold">{title}</h3>
        {count > 0 && (
          <span
            className="flex h-5 min-w-[20px] items-center justify-center rounded-full px-1.5 text-[11px] font-bold tabular-nums"
            style={{ background: 'var(--fill-thin)', color: 'var(--secondary-label)' }}
          >
            {count}
          </span>
        )}
        {count > QUEUE_CAP && (
          <button
            onClick={onViewAll}
            className="no-drag ml-auto text-[12px] font-semibold hover:underline"
            style={{ color: 'var(--brand-pink)' }}
          >
            view all →
          </button>
        )}
      </header>
      {count === 0 ? (
        <div className="flex flex-1 items-center justify-center px-2 py-6 text-center text-[12px]" style={{ color: 'var(--secondary-label)' }}>
          {empty}
        </div>
      ) : (
        <>
          <ul className="-mx-1 flex-1 space-y-0.5 overflow-y-auto pr-0.5" style={{ maxHeight: 340 }}>
            {children}
          </ul>
          <footer className="mt-2 pt-1">
            <button
              onClick={onViewAll}
              className="no-drag text-[12px] font-semibold hover:underline"
              style={{ color: 'var(--brand-pink)' }}
            >
              {viewAllLabel} →
            </button>
          </footer>
        </>
      )}
    </section>
  );
}

/** One fan row: body click → peek; trailing actions are one click each. */
function FanRow({
  fan,
  reason,
  reasonIcon,
  onPeek,
  actions,
}: {
  fan: Fan;
  reason: string;
  reasonIcon?: string;
  onPeek: () => void;
  actions?: ReactNode;
}) {
  return (
    <li className="group flex items-center gap-2.5 rounded-xl px-1.5 py-1.5 transition-colors hover:bg-[var(--fill-quaternary)]">
      <button
        onClick={onPeek}
        className="no-drag flex min-w-0 flex-1 items-center gap-2.5 text-left"
        title={`Peek at ${fanName(fan)}`}
      >
        <FanAvatar name={fanName(fan)} url={fan.avatarUrl} size={34} />
        <span className="min-w-0 flex-1 leading-tight">
          <span className="flex items-center gap-1.5">
            <span className="truncate text-[13px] font-semibold">{fanName(fan)}</span>
            <TierChip tier={fan.tier} />
          </span>
          <span className="block truncate text-[11px]" style={{ color: 'var(--secondary-label)' }}>
            {reasonIcon && <span aria-hidden>{reasonIcon} </span>}
            {reason}
          </span>
        </span>
      </button>
      {actions && <span className="flex flex-none items-center gap-1">{actions}</span>}
    </li>
  );
}

/** Small pill-style action button used in queue rows. */
function RowAction({
  label,
  emoji,
  onClick,
  primary,
}: {
  label: string;
  emoji: string;
  onClick: () => void;
  primary?: boolean;
}) {
  return (
    <Tooltip content={label}>
      <button
        onClick={onClick}
        aria-label={label}
        className={`no-drag flex h-7 w-7 items-center justify-center rounded-full text-[13px] transition ${
          primary ? '' : 'hover:bg-[var(--fill-thin)]'
        }`}
        style={
          primary
            ? { background: 'var(--brand-pink)', color: '#fff' }
            : { background: 'var(--fill-quaternary)', border: '1px solid var(--card-border)' }
        }
      >
        <span aria-hidden>{emoji}</span>
      </button>
    </Tooltip>
  );
}

/** Compact secondary stat (sits below the queues — not the hero). */
function MiniStat({ label, value, onOpen }: { label: string; value: string; onOpen: () => void }) {
  return (
    <button
      onClick={onOpen}
      className="glass no-drag hover-lift flex items-center gap-3 px-4 py-3 text-left"
      style={{ borderRadius: 14 }}
      title={`Open ${label.toLowerCase()}`}
    >
      <span className="text-[20px] font-extrabold leading-none tabular-nums">{value}</span>
      <span className="text-[12px] leading-tight" style={{ color: 'var(--secondary-label)' }}>{label}</span>
    </button>
  );
}

// ---------------------------------------------------------------------------

type GifterRow = { fan: Fan; diamonds: number };

export function Dashboard({ onOpenHistory, onGoLive, onGoReminders }: {
  onOpenHistory: () => void;
  onGoLive: () => void;
  onGoReminders: () => void;
}) {
  const setPage = useUI((s) => s.setPage);
  const openFanPeek = useUI((s) => s.openFanPeek);
  const setCommandOpen = useUI((s) => s.setCommandOpen);
  const pushToast = useAlerts((s) => s.pushToast);
  const { earnings, myAccount } = useSettingsLoad();

  const [reminders, setReminders] = useState<Reminder[]>([]);
  const [coldFans, setColdFans] = useState<Fan[]>([]);
  const [weekGifters, setWeekGifters] = useState<GifterRow[]>([]);
  const [fansTotal, setFansTotal] = useState(0);
  const [diamondsMonth, setDiamondsMonth] = useState<number | null>(null);
  const [sessions, setSessions] = useState<SessionSummary[]>([]);
  const [thankFor, setThankFor] = useState<{ uniqueId: string; nickname: string } | null>(null);

  const reloadReminders = () =>
    window.tiktok.remindersList().then((r) => setReminders(r ?? [])).catch(() => {});

  useEffect(() => {
    reloadReminders();
    // "Going cold" — VIP/Whale fans whose relationship has cooled. We pull the
    // top fans by lifetime diamonds and filter to cooling/cold temperature.
    window.tiktok.fansList({ sort: 'diamonds', pageSize: 120 }).then((r) => {
      const cold = (r.data ?? []).filter(
        (f) => (f.tier === 'VIP' || f.tier === 'Whale') &&
          (f.temperature === 'cooling' || f.temperature === 'cold'),
      );
      setColdFans(cold);
      setFansTotal(r.total ?? 0);
    }).catch(() => {});
    // "Notable gifters this week" — aggregate the 7-day gift window per fan.
    window.tiktok.giftsList({ range: '7d', pageSize: 500 }).then((r) => {
      const agg = new Map<string, { name: string; nickname: string; diamonds: number }>();
      for (const g of r.data ?? []) {
        const row = agg.get(g.fanUniqueId) ?? { name: g.fanUniqueId, nickname: g.fanNickname, diamonds: 0 };
        row.diamonds += g.diamonds;
        agg.set(g.fanUniqueId, row);
      }
      // Resolve to real Fan records so we get tier/avatar; fall back to a stub.
      const top = [...agg.entries()].sort((a, b) => b[1].diamonds - a[1].diamonds).slice(0, 12);
      Promise.all(
        top.map(async ([uid, info]) => {
          const fan = await window.tiktok.fansGet(uid).catch(() => null);
          const safe: Fan = fan ?? stubFan(uid, info.nickname);
          return { fan: safe, diamonds: info.diamonds };
        }),
      ).then(setWeekGifters).catch(() => {});
    }).catch(() => {});
    window.tiktok.giftsList({ range: '30d', pageSize: 1 }).then((r) => setDiamondsMonth(r.diamondsMonth)).catch(() => {});
    window.tiktok.sessionsList().then(setSessions).catch(() => {});
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const creatorName = myAccount.nickname || myAccount.username || sessions[0]?.hostNickname || 'Creator';
  const myUsername = myAccount.username;

  // --- Queue derivations -----------------------------------------------------
  // 1) Reach out today: thank-after-LIVE reminders + birthdays due today/soon (≤2d).
  const reachOut = useMemo(() => {
    const thanks = reminders.filter((r) => r.kind === 'thank');
    const bdaysNow = reminders.filter((r) => r.kind === 'birthday' && r.days <= 2);
    return [...thanks, ...bdaysNow].sort((a, b) => a.days - b.days);
  }, [reminders]);

  // 2) Going cold: VIP/Whale cooling/cold fans (sorted by lifetime value).
  const goingCold = useMemo(
    () => [...coldFans].sort((a, b) => b.totalDiamonds - a.totalDiamonds),
    [coldFans],
  );

  // 3) Reminders due: upcoming birthdays (all), soonest first.
  const birthdaysDue = useMemo(
    () => reminders.filter((r) => r.kind === 'birthday').sort((a, b) => a.days - b.days),
    [reminders],
  );

  // 4) Notable gifters this week (already aggregated/sorted in load).
  const notableGifters = useMemo(() => weekGifters.filter((g) => g.diamonds > 0), [weekGifters]);

  // --- Secondary stats -------------------------------------------------------
  const whaleCount = useMemo(() => goingCold.filter((f) => f.tier === 'Whale').length, [goingCold]);

  // --- Actions ---------------------------------------------------------------
  const markReminderDone = async (r: Reminder) => {
    try {
      await window.tiktok.reminderAction({ id: r.id, action: 'done' });
      setReminders((prev) => prev.filter((x) => x.id !== r.id));
      pushToast({ title: 'Done ✓', body: `Cleared "${fanName(r.fan)}" from your list.` });
    } catch {
      pushToast({ title: 'Could not update', body: 'That reminder could not be cleared.' });
    }
  };

  const snoozeReminder = async (r: Reminder, days = 1) => {
    try {
      await window.tiktok.reminderAction({ id: r.id, action: 'snooze', days });
      setReminders((prev) => prev.filter((x) => x.id !== r.id));
      pushToast({ title: 'Snoozed', body: `${fanName(r.fan)} — back in ${daysLabel(days)}.` });
    } catch {
      pushToast({ title: 'Could not snooze', body: 'Please try again.' });
    }
  };

  const openThank = (uniqueId: string, nickname: string) => setThankFor({ uniqueId, nickname });

  const hasAnything = reminders.length > 0 || coldFans.length > 0 || notableGifters.length > 0 || fansTotal > 0 || sessions.length > 0;

  // ---------------------------------------------------------------------------
  return (
    <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto p-5">
      {/* Greeting header */}
      <div className="flex flex-wrap items-center gap-3">
        {myAccount.avatarUrl && (
          <img
            src={myAccount.avatarUrl}
            alt=""
            className="h-10 w-10 flex-none rounded-full object-cover"
            style={{ border: '2px solid var(--brand-pink, #EE1D52)' }}
            draggable={false}
          />
        )}
        <div className="min-w-0 flex-1">
          <h1 className="truncate text-xl font-extrabold tracking-tight">
            {greeting()}, {creatorName} <span aria-hidden>👋</span>
          </h1>
          <p className="text-[13px]" style={{ color: 'var(--secondary-label)' }}>
            {myUsername ? <>@{myUsername} · </> : null}here&apos;s who needs you today
          </p>
        </div>
        <Tooltip content="Current week">
          <span
            className="hidden h-8 flex-none items-center gap-1.5 rounded-full px-3 text-[12px] font-semibold sm:flex"
            style={{ background: 'var(--fill-thin)', border: '1px solid var(--card-border)', color: 'var(--secondary-label)' }}
          >
            <Calendar size={13} /> {weekRangeLabel()}
          </span>
        </Tooltip>
        <button
          onClick={() => setCommandOpen(true)}
          className="no-drag hidden h-8 items-center gap-1.5 rounded-full px-3 text-[12px] font-medium md:flex"
          style={{ background: 'var(--fill-thin)', border: '1px solid var(--card-border)', color: 'var(--secondary-label)' }}
          title="Jump to anyone"
        >
          <kbd className="rounded px-1 text-[11px] font-bold" style={{ background: 'var(--fill-quaternary)' }}>⌘K</kbd>
          to jump to anyone
        </button>
        <ThemeToggle />
        <button onClick={onGoLive} className="panel-btn panel-btn-primary no-drag !h-8 !px-4 whitespace-nowrap">
          <Radio size={13} className="mr-1.5" /> Go LIVE
        </button>
      </div>

      {/* First-run nudge when nothing is connected yet. */}
      {!hasAnything && (
        <div
          className="flex flex-wrap items-center gap-3 rounded-2xl px-4 py-3"
          style={{ background: 'var(--accent-tint, rgba(238,29,82,0.10))', border: '1px solid var(--card-border)' }}
        >
          <span className="flex h-9 w-9 flex-none items-center justify-center rounded-full text-white" style={{ background: 'var(--brand-pink, #EE1D52)' }}>
            <Radio size={16} />
          </span>
          <div className="min-w-0 flex-1">
            <div className="text-[13px] font-bold leading-tight">Connect to your first LIVE</div>
            <p className="text-[12px]" style={{ color: 'var(--secondary-label)' }}>
              Your people-queues fill in automatically once gifts and follow-ups start flowing.
            </p>
          </div>
          <button onClick={onGoLive} className="panel-btn panel-btn-primary no-drag whitespace-nowrap !h-8 !px-4">Connect →</button>
        </div>
      )}

      {/* The hero: ranked people queues (2×2 on wide). */}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2 2xl:grid-cols-4">
        {/* QUEUE 1 — Reach out today */}
        <QueueCard
          title="Reach out today"
          emoji="💌"
          accent="rgba(238,29,82,0.16)"
          count={reachOut.length}
          viewAllLabel="View all follow-ups"
          onViewAll={onGoReminders}
          empty={<>All caught up 💕<br />No thank-yous or birthdays due right now.</>}
        >
          {reachOut.slice(0, QUEUE_CAP).map((r) => (
            <FanRow
              key={r.id}
              fan={r.fan}
              reasonIcon={r.kind === 'birthday' ? '🎂' : '🎁'}
              reason={r.kind === 'birthday' ? `Birthday ${birthdayWhen(r)}` : 'Thank after your last stream'}
              onPeek={() => openFanPeek(r.fan.uniqueId)}
              actions={
                <>
                  <RowAction label="Thank" emoji="💌" primary onClick={() => openThank(r.fan.uniqueId, fanName(r.fan))} />
                  <RowAction label="Mark done" emoji="✓" onClick={() => markReminderDone(r)} />
                </>
              }
            />
          ))}
        </QueueCard>

        {/* QUEUE 2 — Going cold */}
        <QueueCard
          title="Going cold"
          emoji="🧊"
          accent="rgba(105,201,208,0.20)"
          count={goingCold.length}
          viewAllLabel="View all fans"
          onViewAll={() => setPage('followers')}
          empty={<>Nobody&apos;s slipping away 🎉<br />Your VIPs and Whales are all warm.</>}
        >
          {goingCold.slice(0, QUEUE_CAP).map((f) => {
            const days = Math.max(0, Math.floor((Date.now() - f.lastSeenAt) / DAY));
            return (
              <FanRow
                key={f.uniqueId}
                fan={f}
                reason={`${f.tier} · not seen ${daysLabel(days)}`}
                onPeek={() => openFanPeek(f.uniqueId)}
                actions={
                  <>
                    <span className="mr-0.5"><TemperatureDot temperature={(f.temperature ?? 'cold') as Temperature} /></span>
                    <RowAction label="Nudge" emoji="👋" onClick={() => openFanPeek(f.uniqueId)} />
                  </>
                }
              />
            );
          })}
        </QueueCard>

        {/* QUEUE 3 — Reminders due (upcoming birthdays) */}
        <QueueCard
          title="Reminders due"
          emoji="🎂"
          accent="rgba(255,184,0,0.20)"
          count={birthdaysDue.length}
          viewAllLabel="View all reminders"
          onViewAll={onGoReminders}
          empty={<>No birthdays coming up 🎈<br />Add them from each fan&apos;s profile.</>}
        >
          {birthdaysDue.slice(0, QUEUE_CAP).map((r) => (
            <FanRow
              key={r.id}
              fan={r.fan}
              reasonIcon="🎂"
              reason={`Birthday ${birthdayWhen(r)}`}
              onPeek={() => openFanPeek(r.fan.uniqueId)}
              actions={
                <>
                  <RowAction label="Thank" emoji="💌" primary onClick={() => openThank(r.fan.uniqueId, fanName(r.fan))} />
                  <RowAction label="Snooze 1 day" emoji="💤" onClick={() => snoozeReminder(r, 1)} />
                  <RowAction label="Mark done" emoji="✓" onClick={() => markReminderDone(r)} />
                </>
              }
            />
          ))}
        </QueueCard>

        {/* QUEUE 4 — Notable gifters this week */}
        <QueueCard
          title="Notable gifters this week"
          emoji="💎"
          accent="rgba(168,85,247,0.16)"
          count={notableGifters.length}
          viewAllLabel="View leaderboard"
          onViewAll={() => setPage('gifts')}
          empty={<>No gifts this week yet 💝<br />Top supporters appear here after your next LIVE.</>}
        >
          {notableGifters.slice(0, QUEUE_CAP).map((g) => {
            const money = estimateMoney(g.diamonds, earnings);
            return (
              <FanRow
                key={g.fan.uniqueId}
                fan={g.fan}
                reasonIcon="💎"
                reason={`${formatDiamonds(g.diamonds)} this week${money ? ` · ${money}` : ''}`}
                onPeek={() => openFanPeek(g.fan.uniqueId)}
                actions={<RowAction label="Thank" emoji="💌" primary onClick={() => openThank(g.fan.uniqueId, fanName(g.fan))} />}
              />
            );
          })}
        </QueueCard>
      </div>

      {/* Secondary stat row (below the queues — not the focus). */}
      <div className="flex flex-wrap gap-3">
        <MiniStat label="Supporters remembered" value={formatNumber(fansTotal)} onOpen={() => setPage('followers')} />
        <MiniStat label="Gifts this month 💎" value={diamondsMonth != null ? formatDiamonds(diamondsMonth) : '—'} onOpen={() => setPage('gifts')} />
        <MiniStat label="Whales going cold" value={String(whaleCount)} onOpen={onGoReminders} />
        {sessions.length > 0 && (
          <MiniStat
            label={`Last stream ${relativeTime(sessions[0].startedAt)}`}
            value={formatDiamonds(sessions[0].totals?.diamonds ?? 0)}
            onOpen={onOpenHistory}
          />
        )}
      </div>

      {thankFor && (
        <ThankComposer
          uniqueId={thankFor.uniqueId}
          nickname={thankFor.nickname}
          onClose={() => setThankFor(null)}
          onThanked={() => { setThankFor(null); reloadReminders(); }}
        />
      )}
    </div>
  );
}

/** Minimal Fan stub for a gifter not yet in the ledger (keeps rows fail-safe). */
function stubFan(uniqueId: string, nickname: string): Fan {
  const now = Date.now();
  return {
    uniqueId,
    nickname: nickname || uniqueId,
    avatarUrl: null,
    firstSeenAt: now,
    lastSeenAt: now,
    totalDiamonds: 0,
    giftCount: 0,
    tags: [],
    notes: '',
    tier: 'New',
  };
}
