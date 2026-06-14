/// <reference types="vite/client" />
/** Dashboard — community at a glance: stats, follow-ups, top gifters, birthdays, VIP watchlist, top supporter. */
import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { Calendar, Clock, Gift, Heart, Radio, Star, Users } from 'lucide-react';
import type { Fan, GiftRecord, Reminder, SessionRecord, SessionSummary, UserNote } from '../types';
import { estimateMoney, formatDiamonds, formatNumber } from '../lib/format';
import { useSettingsLoad } from '../state/settings';
import { ThankComposer } from '../components/ThankComposer';
import { FanAvatar, TierChip, fanName } from '../components/crm';

// ---------------------------------------------------------------------------
// Optional ui store (created by a parallel agent). Loaded defensively via glob
// so the build never breaks if the module is absent.
const uiModules = import.meta.glob('../state/ui.ts', { eager: true }) as Record<string, unknown>;
const uiMod = Object.values(uiModules)[0] as
  | { useUi?: { getState?: () => Record<string, unknown> }; useUiStore?: { getState?: () => Record<string, unknown> } }
  | undefined;

function navTo(page: string, fan?: string): boolean {
  try {
    const store = (uiMod?.useUi ?? uiMod?.useUiStore) as { getState?: () => Record<string, unknown> } | undefined;
    const st = store?.getState?.();
    if (st) {
      if (fan && typeof st.setFanFocus === 'function') (st.setFanFocus as (f: string) => void)(fan);
      if (typeof st.setPage === 'function') {
        (st.setPage as (p: string) => void)(page);
        return true;
      }
    }
  } catch {
    /* fall through */
  }
  if (window.location.protocol.startsWith('http')) {
    const q = new URLSearchParams(window.location.search);
    q.set('page', page);
    if (fan) q.set('fan', fan);
    else q.delete('fan');
    window.location.search = q.toString();
    return true;
  }
  return false;
}

// ---------------------------------------------------------------------------

const DAY = 86400000;
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

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

function birthdayLabel(r: Reminder): string {
  let dateText = '';
  if (r.date) {
    const m = /^(\d{2})-(\d{2})$/.exec(r.date);
    if (m) dateText = `${MONTHS[Number(m[1]) - 1]} ${Number(m[2])}`;
    else dateText = r.date;
  }
  const rel = r.days === 0 ? 'today' : r.days === 1 ? 'in 1 day' : `in ${r.days} days`;
  return dateText ? `${dateText} (${rel})` : `Birthday ${rel}`;
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
// Small presentational pieces

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

function StatCard({ label, value, sub, trend, trendColor, icon, tint, onOpen }: {
  label: string;
  value: string;
  /** secondary text rendered next to the value (e.g. money estimate) */
  sub?: string | null;
  trend?: string;
  trendColor?: string;
  icon: string;
  tint: string;
  /** when set, the whole card becomes a shortcut to the relevant page */
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

const RANK_STYLE: Record<number, { bg: string; color: string }> = {
  0: { bg: 'linear-gradient(135deg, #f7c948, #d99a00)', color: '#fff' },
  1: { bg: 'linear-gradient(135deg, #cdd5df, #98a4b3)', color: '#fff' },
  2: { bg: 'linear-gradient(135deg, #d9a06b, #a9683a)', color: '#fff' },
};

export function RankBadge({ i }: { i: number }) {
  const s = RANK_STYLE[i];
  return (
    <span
      className="flex h-6 w-6 flex-none items-center justify-center rounded-full text-[11px] font-bold"
      style={s ? { background: s.bg, color: s.color } : { background: 'var(--fill-thin)', color: 'var(--secondary-label)' }}
    >
      {i + 1}
    </span>
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

type GifterRow = { uniqueId: string; name: string; gifts: number; diamonds: number; fan?: Fan };

export function Dashboard({ onOpenHistory, onGoLive, onGoReminders }: {
  onOpenHistory: () => void;
  onGoLive: () => void;
  onGoReminders: () => void;
}) {
  const [sessions, setSessions] = useState<SessionSummary[]>([]);
  const [latest, setLatest] = useState<SessionRecord | null>(null);
  const [fansTotal, setFansTotal] = useState(0);
  const [recentFans, setRecentFans] = useState<Fan[]>([]);
  const [topFans, setTopFans] = useState<Fan[]>([]);
  const [reminders, setReminders] = useState<Reminder[]>([]);
  const [gifts90, setGifts90] = useState<{ data: GiftRecord[]; total: number; diamondsMonth: number } | null>(null);
  const [notes, setNotes] = useState<Record<string, UserNote>>({});
  const [supporterGifts, setSupporterGifts] = useState<GiftRecord[] | null>(null);
  const [gifterRange, setGifterRange] = useState<'month' | 'all'>('month');
  const [showThank, setShowThank] = useState(false);
  const [coachDismissed, setCoachDismissed] = useState(() => {
    try { return localStorage.getItem('dash-coach-dismissed') === '1'; } catch { return false; }
  });
  const { earnings } = useSettingsLoad();

  useEffect(() => {
    window.tiktok.sessionsList().then((list) => {
      setSessions(list);
      if (list[0]) window.tiktok.sessionsGet(list[0].id).then(setLatest).catch(() => {});
    }).catch(() => {});
    window.tiktok.fansList({ sort: 'lastSeen', pageSize: 200 }).then((r) => {
      setFansTotal(r.total);
      setRecentFans(r.data);
    }).catch(() => {});
    window.tiktok.fansList({ sort: 'diamonds', pageSize: 50 }).then((r) => setTopFans(r.data.filter((f) => f.totalDiamonds > 0))).catch(() => {});
    window.tiktok.remindersList().then((r) => setReminders(r ?? [])).catch(() => {});
    window.tiktok.giftsList({ range: '90d', pageSize: 500 }).then((r) =>
      setGifts90({ data: r.data, total: r.total, diamondsMonth: r.diamondsMonth }),
    ).catch(() => {});
    window.tiktok.notesAll().then((n) => setNotes(n ?? {})).catch(() => {});
  }, []);

  const supporter = topFans[0] ?? null;
  useEffect(() => {
    if (!supporter) return;
    window.tiktok.giftsList({ fan: supporter.uniqueId, range: 'all', pageSize: 200 })
      .then((r) => setSupporterGifts(r.data))
      .catch(() => setSupporterGifts([]));
  }, [supporter?.uniqueId]); // eslint-disable-line react-hooks/exhaustive-deps

  const creatorName = sessions[0]?.hostNickname || 'Creator';
  const now = Date.now();

  // --- Stat card computations ----------------------------------------------
  const newThisWeek = useMemo(() => recentFans.filter((f) => f.firstSeenAt >= now - 7 * DAY).length, [recentFans, now]);
  const birthdays = useMemo(() => reminders.filter((r) => r.kind === 'birthday').sort((a, b) => a.days - b.days), [reminders]);
  const quiet = useMemo(() => reminders.filter((r) => r.kind === 'quiet'), [reminders]);
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

  // --- Hero metrics ---------------------------------------------------------
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

  // --- Top gifters ----------------------------------------------------------
  const fanByUid = useMemo(() => {
    const m = new Map<string, Fan>();
    for (const f of [...recentFans, ...topFans]) m.set(f.uniqueId, f);
    return m;
  }, [recentFans, topFans]);

  const monthGifters = useMemo<GifterRow[]>(() => {
    if (!gifts90) return [];
    const start = new Date(); start.setDate(1); start.setHours(0, 0, 0, 0);
    const agg = new Map<string, GifterRow>();
    for (const g of gifts90.data) {
      if (g.at < start.getTime()) continue;
      const row = agg.get(g.fanUniqueId) ?? { uniqueId: g.fanUniqueId, name: g.fanNickname || g.fanUniqueId, gifts: 0, diamonds: 0, fan: fanByUid.get(g.fanUniqueId) };
      row.gifts += 1;
      row.diamonds += g.diamonds;
      agg.set(g.fanUniqueId, row);
    }
    return [...agg.values()].sort((a, b) => b.diamonds - a.diamonds);
  }, [gifts90, fanByUid]);

  const allGifters = useMemo<GifterRow[]>(
    () => topFans.map((f) => ({ uniqueId: f.uniqueId, name: fanName(f), gifts: f.giftCount, diamonds: f.totalDiamonds, fan: f })),
    [topFans],
  );
  const gifters = (gifterRange === 'month' ? monthGifters : allGifters).slice(0, 5);

  // --- VIP watchlist ---------------------------------------------------------
  const watchlist = useMemo(
    () => quiet.filter((r) => r.fan.tier === 'VIP' || r.fan.tier === 'Whale').sort((a, b) => b.fan.totalDiamonds - a.fan.totalDiamonds),
    [quiet],
  );

  const nudge = async (r: Reminder) => {
    const api = window.tiktok as unknown as Record<string, unknown>;
    if (typeof api.reminderAddThank === 'function') {
      try {
        await (api.reminderAddThank as (p: { uniqueId: string }) => Promise<unknown>)({ uniqueId: r.fan.uniqueId });
        return;
      } catch { /* fall through */ }
    }
    navTo('followers', r.fan.uniqueId);
  };

  // --- Top supporter panel ----------------------------------------------------
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

  const supporterNote = supporter ? (supporter.notes || notes[supporter.uniqueId]?.notes || '') : '';
  const hasData = sessions.length > 0 || fansTotal > 0;

  // ---------------------------------------------------------------------------
  return (
    <div className="flex min-h-0 flex-1 items-start gap-4 overflow-y-auto p-5">
      <div className="min-w-0 flex-1 space-y-4">
        {/* Header */}
        <div className="flex flex-wrap items-center gap-3">
          <div className="min-w-0 flex-1">
            <h1 className="truncate text-xl font-extrabold tracking-tight">{greeting()}, {creatorName} <span aria-hidden>💋</span></h1>
            <p className="text-[13px]" style={{ color: 'var(--secondary-label)' }}>Here&apos;s your community at a glance</p>
          </div>
          <span
            className="flex h-8 flex-none items-center gap-1.5 rounded-full px-3 text-[12px] font-semibold"
            style={{ background: 'var(--fill-thin)', border: '1px solid var(--card-border)', color: 'var(--secondary-label)' }}
            title="Current week"
          >
            <Calendar size={13} /> {weekRangeLabel()}
          </span>
          <button onClick={onGoLive} className="panel-btn panel-btn-primary no-drag !h-8 !px-4 whitespace-nowrap"><Radio size={13} className="mr-1.5" /> Go LIVE</button>
          <button onClick={() => navTo('followers')} className="panel-btn no-drag !h-8 !px-4 whitespace-nowrap">Fan profile</button>
        </div>

        {/* First-run coachmark — points at step 1 when nothing's connected yet. */}
        {!hasData && !coachDismissed && (
          <div
            className="flex flex-wrap items-center gap-3 rounded-2xl px-4 py-3"
            style={{ background: 'var(--accent-tint, rgba(238,29,82,0.10))', border: '1px solid var(--card-border)' }}
          >
            <span className="flex h-9 w-9 flex-none items-center justify-center rounded-full text-white" style={{ background: 'var(--brand-pink, #EE1D52)' }}>
              <Radio size={16} />
            </span>
            <div className="min-w-0 flex-1">
              <div className="text-[13px] font-bold leading-tight">Start here: connect to your first LIVE</div>
              <p className="text-[12px]" style={{ color: 'var(--secondary-label)' }}>
                Your supporters, gifts and follow-ups all fill in automatically once you connect. The stats below are empty until then.
              </p>
            </div>
            <button onClick={onGoLive} className="panel-btn panel-btn-primary no-drag whitespace-nowrap !h-8 !px-4">Connect to your first LIVE →</button>
            <button
              onClick={() => { setCoachDismissed(true); try { localStorage.setItem('dash-coach-dismissed', '1'); } catch { /* ignore */ } }}
              className="panel-btn panel-btn-icon no-drag"
              aria-label="Dismiss hint"
              title="Dismiss"
            >
              ✕
            </button>
          </div>
        )}

        {/* Stat cards (de-emphasized until there's real data) */}
        <div className={`grid grid-cols-2 gap-3 xl:grid-cols-4 ${!hasData ? 'opacity-60' : ''}`}>
          <StatCard
            label="Supporters remembered"
            value={formatNumber(fansTotal)}
            trend={newThisWeek > 0 ? `↑ ${newThisWeek} this week` : undefined}
            trendColor="#34c77b"
            icon="./assets/png/icon_heart_3d.png"
            tint="rgba(238, 29, 82, 0.14)"
            onOpen={() => navTo('followers')}
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
            onOpen={() => navTo('gifts')}
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

        {/* Hero: after tonight's LIVE */}
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

        {/* Top gifters + Upcoming birthdays */}
        <div className="grid grid-cols-1 items-stretch gap-3 lg:grid-cols-2">
          <div className="glass flex flex-col p-4" style={{ borderRadius: 18 }}>
            <div className="mb-2 flex items-center gap-2">
              <h3 className="text-sm font-bold">Top Gifters</h3>
              <div className="flex items-center gap-1">
                <button onClick={() => setGifterRange('month')} className={`panel-btn no-drag !h-6 !px-2.5 !text-[11px] ${gifterRange === 'month' ? 'panel-btn-active' : ''}`}>This month</button>
                <button onClick={() => setGifterRange('all')} className={`panel-btn no-drag !h-6 !px-2.5 !text-[11px] ${gifterRange === 'all' ? 'panel-btn-active' : ''}`}>All time</button>
              </div>
              <span className="ml-auto"><SectionLink onClick={() => navTo('gifts')}>View all →</SectionLink></span>
            </div>
            {gifters.length === 0 ? (
              <div className="py-6 text-center text-[12px]" style={{ color: 'var(--secondary-label)' }}>
                <img src="./assets/png/icon_gift_box_3d.png" alt="" className="mx-auto mb-2 h-12 w-12" draggable={false} />
                {gifterRange === 'month' ? 'No gifts this month yet.' : 'No gifts recorded yet — your top supporters will appear after your first LIVE.'}
              </div>
            ) : (
              <ul className="text-[13px]">
                {gifters.map((g, i) => (
                  <li
                    key={g.uniqueId}
                    onClick={() => navTo('followers', g.uniqueId)}
                    title={`Open @${g.uniqueId}'s profile`}
                    className={`no-drag flex cursor-pointer items-center gap-3 rounded-lg px-1 py-2 transition-colors hover:bg-[var(--fill-quaternary)] ${i > 0 ? 'border-t' : ''}`}
                    style={{ borderColor: 'var(--separator)' }}
                  >
                    <RankBadge i={i} />
                    <FanAvatar name={g.fan ? fanName(g.fan) : g.name} url={g.fan?.avatarUrl} />
                    <span className="min-w-0 flex-1 leading-tight">
                      <span className="block truncate font-semibold">{g.fan ? fanName(g.fan) : g.name}</span>
                      <span className="block text-[11px]" style={{ color: 'var(--secondary-label)' }}>@{g.uniqueId}</span>
                    </span>
                    <span className="w-12 text-right text-[12px] tabular-nums" style={{ color: 'var(--secondary-label)' }}>{formatNumber(g.gifts)}</span>
                    <span className="text-right text-[12px] font-bold tabular-nums" style={{ minWidth: 64 }}>
                      {formatDiamonds(g.diamonds)}
                      {estimateMoney(g.diamonds, earnings) && (
                        <span className="ml-1 font-medium" style={{ color: 'var(--secondary-label)' }}>{estimateMoney(g.diamonds, earnings)}</span>
                      )}
                    </span>
                    {g.fan && <TierChip tier={g.fan.tier} />}
                  </li>
                ))}
              </ul>
            )}
            <div className="mt-auto pt-2">
              <SectionLink onClick={() => navTo('gifts')}>View full leaderboard →</SectionLink>
            </div>
          </div>

          <div className="glass flex flex-col p-4" style={{ borderRadius: 18 }}>
            <h3 className="mb-2 text-sm font-bold">Upcoming birthdays</h3>
            {birthdays.length === 0 ? (
              <div className="py-6 text-center text-[12px]" style={{ color: 'var(--secondary-label)' }}>
                <img src="./assets/png/icon_heart_3d.png" alt="" className="mx-auto mb-2 h-12 w-12" draggable={false} />
                No birthdays in the next 30 days — add them from each fan&apos;s profile.
              </div>
            ) : (
              <ul className="text-[13px]">
                {birthdays.slice(0, 5).map((r, i) => (
                  <li key={r.id} className={`flex items-center gap-3 py-2 ${i > 0 ? 'border-t' : ''}`} style={{ borderColor: 'var(--separator)' }}>
                    <FanAvatar name={fanName(r.fan)} url={r.fan.avatarUrl} />
                    <span className="min-w-0 flex-1 leading-tight">
                      <span className="flex items-center gap-1.5">
                        <span className="truncate font-semibold">{fanName(r.fan)}</span>
                        <TierChip tier={r.fan.tier} />
                      </span>
                      <span className="block text-[11px]" style={{ color: 'var(--secondary-label)' }}>🎂 {birthdayLabel(r)}</span>
                    </span>
                    <button
                      onClick={() => navTo('followers', r.fan.uniqueId)}
                      className="panel-btn panel-btn-icon no-drag"
                      aria-label={`Open ${fanName(r.fan)}'s profile`}
                      title="Open fan profile"
                    >
                      <Gift size={14} />
                    </button>
                  </li>
                ))}
              </ul>
            )}
            <div className="mt-auto pt-2">
              <SectionLink onClick={onGoReminders}>View all birthdays →</SectionLink>
            </div>
          </div>
        </div>

        {/* VIP watchlist */}
        <div className="glass p-4" style={{ borderRadius: 18 }}>
          <div className="mb-2 flex items-center justify-between">
            <h3 className="text-sm font-bold">VIP watchlist</h3>
            <SectionLink onClick={onGoReminders}>View all →</SectionLink>
          </div>
          {watchlist.length === 0 ? (
            <p className="py-3 text-[12px]" style={{ color: 'var(--secondary-label)' }}>
              All your VIPs and Whales have been around recently. 🎉
            </p>
          ) : (
            <div className="-mx-1 flex gap-3 overflow-x-auto px-1 pb-1">
              {watchlist.slice(0, 10).map((r) => (
                <div key={r.id} className="w-[170px] flex-none rounded-2xl p-3 text-center" style={{ background: 'var(--fill-quaternary)', border: '1px solid var(--card-border)' }}>
                  <div className="flex justify-center"><FanAvatar name={fanName(r.fan)} url={r.fan.avatarUrl} size={44} /></div>
                  <div className="mt-2 flex items-center justify-center gap-1.5">
                    <span className="max-w-[100px] truncate text-[13px] font-semibold">{fanName(r.fan)}</span>
                    <TierChip tier={r.fan.tier} />
                  </div>
                  <div className="mt-0.5 text-[11px]" style={{ color: 'var(--secondary-label)' }}>
                    Last seen {r.days} day{r.days === 1 ? '' : 's'} ago
                  </div>
                  <button onClick={() => nudge(r)} className="panel-btn no-drag mt-2 !h-7 w-full justify-center">Nudge</button>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Recent sessions */}
        <div className="glass flex flex-col p-4" style={{ borderRadius: 18 }}>
          <h3 className="mb-2 text-sm font-bold">Recent sessions</h3>
          {sessions.length === 0 ? (
            <div className="py-6 text-center text-[12px]" style={{ color: 'var(--secondary-label)' }}>
              <img src="./assets/png/icon_clock_3d.png" alt="" className="mx-auto mb-2 h-12 w-12" draggable={false} />
              No sessions yet — connect to a LIVE to start recording.
            </div>
          ) : (
            <ul className="text-[13px]">
              {sessions.slice(0, 4).map((s, i) => (
                <li key={s.id} className={`flex items-center gap-3 py-2 ${i > 0 ? 'border-t' : ''}`} style={{ borderColor: 'var(--separator)' }}>
                  <FanAvatar name={s.hostNickname || s.hostUniqueId} />
                  <span className="min-w-0 flex-1 leading-tight">
                    <span className="block truncate font-semibold">{s.roomTitle || `@${s.hostUniqueId}`}</span>
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
              ))}
            </ul>
          )}
          {sessions.length > 0 && (
            <div className="mt-auto pt-2">
              <SectionLink onClick={onOpenHistory}>View all sessions →</SectionLink>
            </div>
          )}
        </div>
      </div>

      {/* Top supporter panel (xl+) */}
      <aside aria-label="Top supporter" className="hidden w-[290px] flex-none xl:block">
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
              <span className="inline-block rounded-full p-[3px]" style={{ background: 'var(--gradient-pink, linear-gradient(120deg,#EE1D52,#69C9D0))' }}>
                <FanAvatar name={fanName(supporter)} url={supporter.avatarUrl} size={54} />
              </span>
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
                onClick={() => setShowThank(true)}
                className="panel-btn panel-btn-primary no-drag mt-4 !h-9 w-full justify-center"
              >
                Send a thank-you message 💌
              </button>
            </div>
          </div>
        )}
      </aside>

      {showThank && supporter && (
        <ThankComposer
          uniqueId={supporter.uniqueId}
          nickname={fanName(supporter)}
          onClose={() => setShowThank(false)}
          onThanked={() => window.tiktok.remindersList().then((r) => setReminders(r ?? [])).catch(() => {})}
        />
      )}
    </div>
  );
}
