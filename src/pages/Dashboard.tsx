/// <reference types="vite/client" />
/**
 * Dashboard — the creator command center (B+C hybrid).
 *
 * Combines two complementary surfaces:
 *  1. At-a-glance: 4 prominent StatCards (3D icons + trends), an "After tonight's
 *     LIVE" hero, Recent sessions, and a Top-supporter spotlight right rail.
 *  2. The daily driver: 4 ranked PEOPLE-QUEUES (Reach out today / Going cold /
 *     Reminders due / Notable gifters this week) — short scannable lists where a
 *     row-body click opens the global PEEK drawer (glance without leaving).
 *
 * Every fan click opens the peek via openFanPeek(uniqueId), except the spotlight's
 * "Open full" which escalates to the 360 profile. All data is derived from real
 * IPC with honest, fail-safe empty states; reads are shared between stats + queues
 * wherever possible to avoid redundant fetches.
 */
import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { Calendar, Clock, Heart, Radio, Star, Users } from 'lucide-react';
import type { Fan, GiftRecord, Reminder, SessionRecord, SessionSummary, Temperature } from '../types';
import { estimateMoney, formatDiamonds, formatNumber } from '../lib/format';
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

function hour12(h: number): string {
  const hh = ((h % 24) + 24) % 24;
  const base = hh % 12 === 0 ? 12 : hh % 12;
  return `${base}${hh < 12 ? 'AM' : 'PM'}`;
}

/** Consecutive distinct days (ending at the most recent gift day) with gift activity. */
function streakDays(records: GiftRecord[]): number {
  if (records.length === 0) return 0;
  const days = new Set(records.map((g) => Math.floor(g.at / DAY)));
  const sorted = [...days].sort((a, b) => b - a);
  let streak = 1;
  for (let i = 1; i < sorted.length; i++) {
    if (sorted[i] === sorted[i - 1] - 1) streak++;
    else break;
  }
  return streak;
}

// ---------------------------------------------------------------------------
// Presentational primitives

function IconChip({ bg, color, children, size = 44 }: { bg: string; color?: string; children: ReactNode; size?: number }) {
  return (
    <span
      className="flex flex-none items-center justify-center rounded-full"
      style={{ width: size, height: size, background: bg, color }}
    >
      {children}
    </span>
  );
}

/** A prominent stat card: 3D PNG icon + value (+optional money sub) + trend line. */
function StatCard({ label, value, sub, trend, trendColor, icon, tint, onOpen }: {
  label: string;
  value: string;
  sub?: string | null;
  trend?: string;
  trendColor?: string;
  icon: string;
  tint: string;
  onOpen?: () => void;
}) {
  const Tag = onOpen ? 'button' : 'div';
  return (
    <Tag
      onClick={onOpen}
      className={`glass brand-top-border relative p-4 text-left ${onOpen ? 'no-drag hover-lift cursor-pointer' : ''}`}
      style={{ borderRadius: 18 }}
      {...(onOpen ? { title: `Open ${label.toLowerCase()}` } : {})}
    >
      <IconChip bg={tint}>
        <img src={icon} alt="" className="h-7 w-7 object-contain" draggable={false} />
      </IconChip>
      <div className="mt-2.5 text-xs font-medium" style={{ color: 'var(--secondary-label)' }}>{label}</div>
      <div className="mt-0.5 truncate text-[26px] font-extrabold leading-tight tracking-tight">
        {value}
        {sub && <span className="ml-1.5 text-[13px] font-semibold" style={{ color: 'var(--secondary-label)' }}>{sub}</span>}
      </div>
      <div className="mt-1 h-4 text-[11px] font-semibold" style={{ color: trendColor ?? 'var(--secondary-label)' }}>
        {trend ?? ''}
      </div>
    </Tag>
  );
}

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

function SectionLink({ onClick, children }: { onClick: () => void; children: ReactNode }) {
  return (
    <button onClick={onClick} className="no-drag text-[12px] font-semibold hover:underline" style={{ color: 'var(--brand-pink)' }}>
      {children}
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
  const openFanProfile = useUI((s) => s.openFanProfile);
  const setCommandOpen = useUI((s) => s.setCommandOpen);
  const pushToast = useAlerts((s) => s.pushToast);
  const { earnings, myAccount } = useSettingsLoad();

  // --- Queue + shared state --------------------------------------------------
  const [reminders, setReminders] = useState<Reminder[]>([]);
  const [coldFans, setColdFans] = useState<Fan[]>([]); // VIP/Whale cooling/cold (from diamonds list)
  const [weekGifters, setWeekGifters] = useState<GifterRow[]>([]);
  const [fansTotal, setFansTotal] = useState(0);
  const [sessions, setSessions] = useState<SessionSummary[]>([]);
  const [thankFor, setThankFor] = useState<{ uniqueId: string; nickname: string } | null>(null);

  // --- Stats / hero / supporter state ---------------------------------------
  const [latest, setLatest] = useState<SessionRecord | null>(null);
  const [recentFans, setRecentFans] = useState<Fan[]>([]); // sort:lastSeen — hero + new-this-week metrics
  const [topFans, setTopFans] = useState<Fan[]>([]); // sort:diamonds>0 — supporter spotlight
  const [gifts90, setGifts90] = useState<{ data: GiftRecord[]; total: number; diamondsMonth: number } | null>(null);
  const [supporterGifts, setSupporterGifts] = useState<GiftRecord[] | null>(null);

  const reloadReminders = () =>
    window.tiktok.remindersList().then((r) => setReminders(r ?? [])).catch(() => {});

  useEffect(() => {
    reloadReminders();
    // "Going cold" queue + supporters-remembered total (top fans by lifetime value).
    window.tiktok.fansList({ sort: 'diamonds', pageSize: 120 }).then((r) => {
      const data = r.data ?? [];
      const cold = data.filter(
        (f) => (f.tier === 'VIP' || f.tier === 'Whale') &&
          (f.temperature === 'cooling' || f.temperature === 'cold'),
      );
      setColdFans(cold);
      setFansTotal(r.total ?? 0);
      // Reuse this list for the top-supporter spotlight (highest lifetime diamonds).
      setTopFans(data.filter((f) => f.totalDiamonds > 0));
    }).catch(() => {});
    // Recent fans (last-seen order) power the hero metrics + new-this-week trend.
    window.tiktok.fansList({ sort: 'lastSeen', pageSize: 200 }).then((r) => {
      setRecentFans(r.data ?? []);
    }).catch(() => {});
    // "Notable gifters this week" — aggregate the 7-day gift window per fan.
    window.tiktok.giftsList({ range: '7d', pageSize: 500 }).then((r) => {
      const agg = new Map<string, { name: string; nickname: string; diamonds: number }>();
      for (const g of r.data ?? []) {
        const row = agg.get(g.fanUniqueId) ?? { name: g.fanUniqueId, nickname: g.fanNickname, diamonds: 0 };
        row.diamonds += g.diamonds;
        agg.set(g.fanUniqueId, row);
      }
      const top = [...agg.entries()].sort((a, b) => b[1].diamonds - a[1].diamonds).slice(0, 12);
      Promise.all(
        top.map(async ([uid, info]) => {
          const fan = await window.tiktok.fansGet(uid).catch(() => null);
          const safe: Fan = fan ?? stubFan(uid, info.nickname);
          return { fan: safe, diamonds: info.diamonds };
        }),
      ).then(setWeekGifters).catch(() => {});
    }).catch(() => {});
    // 90-day gift window: month total + money estimate + month-over-month trend.
    window.tiktok.giftsList({ range: '90d', pageSize: 500 }).then((r) =>
      setGifts90({ data: r.data, total: r.total, diamondsMonth: r.diamondsMonth }),
    ).catch(() => {});
    // Sessions: recent-sessions card + "last stream" stat. Hydrate the latest for hero.
    window.tiktok.sessionsList().then((list) => {
      setSessions(list ?? []);
      if (list?.[0]) window.tiktok.sessionsGet(list[0].id).then(setLatest).catch(() => {});
    }).catch(() => {});
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const creatorName = myAccount.nickname || myAccount.username || sessions[0]?.hostNickname || 'Creator';
  const myUsername = myAccount.username;
  const now = Date.now();

  // --- Top supporter (highest lifetime value) -------------------------------
  const supporter = useMemo(
    () => [...topFans].sort((a, b) => b.totalDiamonds - a.totalDiamonds)[0] ?? null,
    [topFans],
  );
  useEffect(() => {
    if (!supporter) { setSupporterGifts(null); return; }
    window.tiktok.giftsList({ fan: supporter.uniqueId, range: 'all', pageSize: 200 })
      .then((r) => setSupporterGifts(r.data))
      .catch(() => setSupporterGifts([]));
  }, [supporter?.uniqueId]); // eslint-disable-line react-hooks/exhaustive-deps

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

  // --- Stat-card computations ------------------------------------------------
  const newThisWeek = useMemo(() => recentFans.filter((f) => f.firstSeenAt >= now - 7 * DAY).length, [recentFans, now]);
  const quiet = useMemo(() => reminders.filter((r) => r.kind === 'quiet'), [reminders]);
  const birthdays = useMemo(() => reminders.filter((r) => r.kind === 'birthday'), [reminders]);
  const dueToday = birthdays.filter((r) => r.days === 0).length + quiet.length;
  const dueWeek = birthdays.filter((r) => r.days <= 7).length + quiet.length;
  const quietWhales = useMemo(() => quiet.filter((r) => r.fan.tier === 'Whale'), [quiet]);
  const quietWhales7 = quietWhales.filter((r) => r.days >= 7).length;

  const monthTrend = useMemo(() => {
    if (!gifts90 || gifts90.total > gifts90.data.length) return null; // incomplete window — stay honest
    const start = new Date(); start.setDate(1); start.setHours(0, 0, 0, 0);
    const prevStart = new Date(start); prevStart.setMonth(prevStart.getMonth() - 1);
    let prev = 0;
    for (const g of gifts90.data) if (g.at >= prevStart.getTime() && g.at < start.getTime()) prev += g.diamonds;
    if (prev === 0) return null;
    const cur = gifts90.diamondsMonth;
    const pct = Math.round(((cur - prev) / prev) * 100);
    return { pct, up: pct >= 0 };
  }, [gifts90]);

  // --- Hero metrics ("After tonight's LIVE") --------------------------------
  const giftersToThank = useMemo(() => {
    if (!latest) return null;
    const s = new Set<string>();
    for (const e of latest.events) if (e.type === 'gift' && e.user?.uniqueId) s.add(e.user.uniqueId);
    return s.size;
  }, [latest]);
  const newVipsWeek = useMemo(
    () => recentFans.filter((f) => (f.tier === 'VIP' || f.tier === 'Whale') && f.firstSeenAt >= now - 7 * DAY).length,
    [recentFans, now],
  );
  const regularsReturned = useMemo(
    () => recentFans.filter((f) => f.tier === 'Regular' && f.lastSeenAt >= now - 7 * DAY && f.firstSeenAt < now - 7 * DAY).length,
    [recentFans, now],
  );
  const whaleQuietDays = quietWhales.length > 0 ? Math.max(...quietWhales.map((r) => r.days)) : null;

  // --- Top-supporter spotlight stats ----------------------------------------
  const supporterStats = useMemo(() => {
    if (!supporter || supporterGifts === null) return null;
    const records = [...supporterGifts].sort((a, b) => b.at - a.at);
    const counts = new Map<string, number>();
    for (const g of records) counts.set(g.giftName, (counts.get(g.giftName) ?? 0) + 1);
    const fave = [...counts.entries()].sort((a, b) => b[1] - a[1]);
    let watchWindow: string | null = null;
    if (records.length >= 3) {
      const hours = new Map<number, number>();
      for (const g of records) {
        const h = new Date(g.at).getHours();
        hours.set(h, (hours.get(h) ?? 0) + 1);
      }
      const mode = [...hours.entries()].sort((a, b) => b[1] - a[1])[0][0];
      watchWindow = `${hour12(mode)}–${hour12(mode + 3)}`;
    }
    return {
      streak: streakDays(records),
      faveGifts: fave.slice(0, 3).map(([name]) => name),
      faveMore: Math.max(0, fave.length - 3),
      watchWindow,
      recent: records.slice(0, 3),
    };
  }, [supporter, supporterGifts]);

  const supporterNote = supporter?.notes || '';

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

  const hasData =
    reminders.length > 0 || coldFans.length > 0 || notableGifters.length > 0 ||
    fansTotal > 0 || sessions.length > 0 || (gifts90?.diamondsMonth ?? 0) > 0;

  // ---------------------------------------------------------------------------
  return (
    <div className="flex min-h-0 flex-1 items-start gap-4 overflow-y-auto p-5">
      <div className="min-w-0 flex-1 space-y-4">
        {/* HEADER — greeting + ⌘K hint + theme + Go LIVE */}
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
              {myUsername ? <>@{myUsername} · </> : null}here&apos;s your community at a glance
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
        {!hasData && (
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
                Your stats, follow-ups and people-queues all fill in automatically once gifts start flowing.
              </p>
            </div>
            <button onClick={onGoLive} className="panel-btn panel-btn-primary no-drag whitespace-nowrap !h-8 !px-4">Connect →</button>
          </div>
        )}

        {/* ROW 1 — prominent stat cards (3D icons + trends). */}
        <div className={`grid grid-cols-2 gap-3 lg:grid-cols-4 ${!hasData ? 'opacity-60' : ''}`}>
          <StatCard
            label="Supporters remembered"
            value={formatNumber(fansTotal)}
            trend={newThisWeek > 0 ? `↑ ${newThisWeek} this week` : undefined}
            trendColor="#34c77b"
            icon="./assets/png/icon_heart_3d.png"
            tint="rgba(238, 29, 82, 0.14)"
            onOpen={() => setPage('followers')}
          />
          <StatCard
            label="Thank-yous due"
            value={String(reminders.length)}
            trend={reminders.length > 0 ? `${dueToday} today · ${dueWeek} this week` : undefined}
            trendColor="var(--brand-pink)"
            icon="./assets/png/icon_thank_you_envelope_3d.png"
            tint="rgba(255, 94, 126, 0.14)"
            onOpen={onGoReminders}
          />
          <StatCard
            label="Gifts this month"
            value={gifts90 ? formatDiamonds(gifts90.diamondsMonth) : '—'}
            sub={gifts90 ? estimateMoney(gifts90.diamondsMonth, earnings) : null}
            trend={monthTrend ? `${monthTrend.up ? '↑' : '↓'} ${Math.abs(monthTrend.pct)}% vs last month` : undefined}
            trendColor={monthTrend?.up ? '#34c77b' : '#e0245e'}
            icon="./assets/png/icon_diamond_3d.png"
            tint="rgba(105, 201, 208, 0.18)"
            onOpen={() => setPage('gifts')}
          />
          <StatCard
            label="Whales to follow up"
            value={String(quietWhales.length)}
            trend={quietWhales7 > 0 ? `${quietWhales7} not seen 7+ days` : undefined}
            trendColor="#a855f7"
            icon="./assets/png/icon_crown_3d.png"
            tint="rgba(168, 85, 247, 0.16)"
            onOpen={onGoReminders}
          />
        </div>

        {/* ROW 2 — "After tonight's LIVE" hero. */}
        <div className="glass flex flex-wrap items-center gap-4 p-5" style={{ borderRadius: 22 }}>
          <img src="./assets/png/hero_gift_checklist_3d.png" alt="" className="w-[110px] flex-none object-contain" draggable={false} />
          <div className="min-w-[220px] flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <h2 className="text-base font-extrabold">After tonight&apos;s LIVE</h2>
              <span className="rounded-full px-2 py-0.5 text-[10px] font-bold text-white" style={{ background: '#EE1D52' }}>LIVE</span>
            </div>
            <p className="mt-0.5 text-[12px]" style={{ color: 'var(--secondary-label)' }}>
              {hasData ? <>Here&apos;s what we suggest focusing on <span aria-hidden>👇</span></> : 'Connect to your first LIVE and follow-ups will appear here.'}
            </p>
            <dl className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-4">
              {[
                { label: 'Gifters to thank', value: giftersToThank ? String(giftersToThank) : '—', icon: <Heart size={13} />, bg: 'rgba(238,29,82,0.14)', color: '#EE1D52' },
                { label: 'New VIPs (7d)', value: newVipsWeek > 0 ? String(newVipsWeek) : '—', icon: <Star size={13} />, bg: 'rgba(255,184,0,0.18)', color: '#d99a00' },
                { label: 'Regulars returned', value: regularsReturned > 0 ? String(regularsReturned) : '—', icon: <Users size={13} />, bg: 'rgba(105,201,208,0.2)', color: '#3fb4bd' },
                { label: 'Whale not seen', value: whaleQuietDays !== null ? `${whaleQuietDays}d` : '—', icon: <Clock size={13} />, bg: 'rgba(168,85,247,0.16)', color: '#a855f7' },
              ].map((m) => (
                <div key={m.label} className="flex items-center gap-2.5 rounded-xl px-3 py-2" style={{ background: 'var(--fill-quaternary)', border: '1px solid var(--card-border)' }}>
                  <IconChip bg={m.bg} color={m.color} size={26}>{m.icon}</IconChip>
                  <div className="min-w-0 leading-tight">
                    <dd className="text-base font-extrabold leading-tight">{m.value}</dd>
                    <dt className="truncate text-[11px]" style={{ color: 'var(--secondary-label)' }}>{m.label}</dt>
                  </div>
                </div>
              ))}
            </dl>
          </div>
          {hasData ? (
            <button onClick={onGoReminders} className="panel-btn panel-btn-primary no-drag whitespace-nowrap !h-8 !px-4">View follow-up list →</button>
          ) : (
            <button onClick={onGoLive} className="panel-btn panel-btn-primary no-drag whitespace-nowrap !h-8 !px-4">Connect to your first LIVE →</button>
          )}
        </div>

        {/* ROW 3 — the daily-driver PEOPLE-QUEUES (2×2 on wide). */}
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
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

        {/* ROW 4 — Recent sessions. */}
        <div className="glass flex flex-col p-4" style={{ borderRadius: 18 }}>
          <h3 className="mb-2 text-sm font-bold">Recent sessions</h3>
          {sessions.length === 0 ? (
            <div className="py-6 text-center text-[12px]" style={{ color: 'var(--secondary-label)' }}>
              <img src="./assets/png/icon_clock_3d.png" alt="" className="mx-auto mb-2 h-12 w-12" draggable={false} />
              No sessions yet — connect to a LIVE to start recording.
            </div>
          ) : (
            <ul className="text-[13px]">
              {sessions.slice(0, 4).map((s, i) => {
                const isMine = !!myUsername && (s.hostUniqueId || '').trim().toLowerCase() === myUsername;
                return (
                  <li key={s.id} className={`flex items-center gap-3 py-2 ${i > 0 ? 'border-t' : ''}`} style={{ borderColor: 'var(--separator)' }}>
                    <FanAvatar name={s.hostNickname || s.hostUniqueId} />
                    <span className="min-w-0 flex-1 leading-tight">
                      <span className="flex items-center gap-1.5">
                        <span className="truncate font-semibold">{s.roomTitle || `@${s.hostUniqueId}`}</span>
                        {isMine && (
                          <Tooltip content="This was your own stream">
                            <span
                              className="flex-none rounded-full px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wide text-white"
                              style={{ background: 'var(--brand-pink, #EE1D52)' }}
                            >
                              You
                            </span>
                          </Tooltip>
                        )}
                      </span>
                      <span className="block text-[11px]" style={{ color: 'var(--secondary-label)' }}>
                        {new Date(s.startedAt).toLocaleDateString(undefined, { day: 'numeric', month: 'short' })}
                        {s.endedAt === null
                          ? ' · live'
                          : s.endedAt
                            ? ` · ${Math.max(1, Math.round((s.endedAt - s.startedAt) / 60000))} min`
                            : ''}
                      </span>
                    </span>
                    <span className="text-[12px] font-bold tabular-nums">{formatDiamonds(s.totals?.diamonds ?? 0)}</span>
                  </li>
                );
              })}
            </ul>
          )}
          {sessions.length > 0 && (
            <div className="mt-auto pt-2">
              <SectionLink onClick={onOpenHistory}>View all sessions →</SectionLink>
            </div>
          )}
        </div>
      </div>

      {/* RIGHT RAIL (xl+) — Top-supporter spotlight. */}
      <aside aria-label="Top supporter" className="block w-[260px] flex-none">
        {!supporter ? (
          <div className="glass p-6 text-center" style={{ borderRadius: 20 }}>
            <img src="./assets/png/icon_heart_3d.png" alt="" className="mx-auto mb-3 h-14 w-14" draggable={false} />
            <div className="text-sm font-bold">Your top supporter will appear here</div>
            <p className="mt-1 text-[12px]" style={{ color: 'var(--secondary-label)' }}>
              Connect to a LIVE to see who&apos;s championing your streams.
            </p>
          </div>
        ) : (
          <div className="glass overflow-hidden" style={{ borderRadius: 20 }}>
            <div className="h-16" style={{ background: 'linear-gradient(120deg, #EE1D52, #ff5e7e 45%, #69C9D0)' }} />
            <div className="-mt-7 px-4 pb-4">
              <button
                onClick={() => openFanPeek(supporter.uniqueId)}
                className="no-drag inline-block rounded-full p-[3px]"
                style={{ background: 'var(--gradient-pink, linear-gradient(120deg,#EE1D52,#69C9D0))' }}
                title={`Peek at ${fanName(supporter)}`}
              >
                <FanAvatar name={fanName(supporter)} url={supporter.avatarUrl} size={54} />
              </button>
              <div className="mt-1.5 flex flex-wrap items-center gap-2">
                <h3 className="text-base font-extrabold leading-tight">{fanName(supporter)}</h3>
                <span className="rounded-full px-2 py-0.5 text-[10px] font-bold text-white" style={{ background: 'var(--brand-pink, #EE1D52)' }}>Top supporter</span>
              </div>
              <div className="text-[12px]" style={{ color: 'var(--secondary-label)' }}>@{supporter.uniqueId}</div>

              {supporterNote && (
                <div className="relative mt-3 rounded-2xl rounded-tl-sm px-3 py-2 text-[12px] leading-snug" style={{ background: 'var(--fill-quaternary)', border: '1px solid var(--card-border)' }}>
                  “{supporterNote.length > 110 ? `${supporterNote.slice(0, 110)}…` : supporterNote}”
                </div>
              )}

              <div className="mt-3 space-y-1 text-[12px]" style={{ color: 'var(--secondary-label)' }}>
                {(supporter.tier === 'VIP' || supporter.tier === 'Whale') && (
                  <div>👑 VIP since {new Date(supporter.firstSeenAt).toLocaleDateString(undefined, { month: 'short', year: 'numeric' })}</div>
                )}
                <div>📅 Joined {new Date(supporter.firstSeenAt).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' })}</div>
              </div>

              <div className="mt-3 grid grid-cols-3 gap-2">
                <div className="rounded-xl p-2 text-center" style={{ background: 'var(--fill-quaternary)', border: '1px solid var(--card-border)' }}>
                  <div className="text-[15px] font-extrabold">{formatNumber(supporter.giftCount)}</div>
                  <div className="text-[10px]" style={{ color: 'var(--secondary-label)' }}>Total gifts</div>
                </div>
                <div className="rounded-xl p-2 text-center" style={{ background: 'var(--fill-quaternary)', border: '1px solid var(--card-border)' }}>
                  <div className="text-[15px] font-extrabold">{formatNumber(supporter.totalDiamonds)}</div>
                  <div className="text-[10px]" style={{ color: 'var(--secondary-label)' }}>
                    Total value 💎{estimateMoney(supporter.totalDiamonds, earnings) ? ` ${estimateMoney(supporter.totalDiamonds, earnings)}` : ''}
                  </div>
                </div>
                <div className="rounded-xl p-2 text-center" style={{ background: 'var(--fill-quaternary)', border: '1px solid var(--card-border)' }}>
                  <div className="text-[15px] font-extrabold">
                    {supporterStats && supporterStats.streak > 1 ? `${supporterStats.streak}d` : `${Math.max(0, Math.floor((now - supporter.lastSeenAt) / DAY))}d`}
                  </div>
                  <div className="text-[10px]" style={{ color: 'var(--secondary-label)' }}>
                    {supporterStats && supporterStats.streak > 1 ? 'Streak 🔥' : 'Last seen'}
                  </div>
                </div>
              </div>

              {(supporterStats && (supporterStats.faveGifts.length > 0 || supporterStats.watchWindow)) && (
                <>
                  <div className="mt-3 text-[10px] font-semibold uppercase tracking-wide" style={{ color: 'var(--secondary-label)' }}>
                    About {fanName(supporter)}
                  </div>
                  {supporterStats.faveGifts.length > 0 && (
                    <div className="mt-1.5 flex flex-wrap items-center gap-1">
                      <span className="text-[11px]" style={{ color: 'var(--secondary-label)' }}>Fave gifts:</span>
                      {supporterStats.faveGifts.map((g) => (
                        <span key={g} className="rounded-full px-2 py-0.5 text-[10px] font-semibold" style={{ background: 'var(--fill-thin)', border: '1px solid var(--card-border)' }}>{g}</span>
                      ))}
                      {supporterStats.faveMore > 0 && <span className="text-[10px]" style={{ color: 'var(--secondary-label)' }}>+{supporterStats.faveMore}</span>}
                    </div>
                  )}
                  {supporterStats.watchWindow && (
                    <div className="mt-1.5 text-[11px]" style={{ color: 'var(--secondary-label)' }}>
                      ⏰ Usually watches: {supporterStats.watchWindow}
                    </div>
                  )}
                </>
              )}

              {supporterStats && supporterStats.recent.length > 0 && (
                <>
                  <div className="mt-3 text-[10px] font-semibold uppercase tracking-wide" style={{ color: 'var(--secondary-label)' }}>Last interactions</div>
                  <ul className="mt-1 space-y-1 text-[11px]" style={{ color: 'var(--secondary-label)' }}>
                    {supporterStats.recent.map((g) => (
                      <li key={g.id} className="truncate">
                        🎁 Gifted {g.giftName}{g.repeatCount > 1 ? ` ×${g.repeatCount}` : ''} · {new Date(g.at).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}
                      </li>
                    ))}
                  </ul>
                </>
              )}

              <button
                onClick={() => openThank(supporter.uniqueId, fanName(supporter))}
                className="panel-btn panel-btn-primary no-drag mt-4 !h-9 w-full justify-center"
              >
                Send a thank-you message 💌
              </button>
              <button
                onClick={() => openFanProfile(supporter.uniqueId)}
                className="panel-btn no-drag mt-2 !h-8 w-full justify-center"
              >
                Open full profile →
              </button>
            </div>
          </div>
        )}
      </aside>

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
