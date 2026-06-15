/**
 * Reach out — the unified follow-up workspace.
 *
 * ONE filterable list of every reach-out item from `remindersList()`
 * (thank-after-LIVE · birthdays · going-cold VIPs), each row with the SAME
 * consistent action set: 💌 Thank · 💬 Open chat · 💤 Snooze · ✓ Done.
 *
 * The row presentation + reason line + action handlers live here and are
 * re-exported (ReachOutRow, reachOutReason, useReachOut) so the Messages page's
 * follow-up rail renders the EXACT SAME items, reasons and actions — one source
 * of truth, no divergence.
 */
import { useCallback, useEffect, useState } from 'react';
import type { Reminder } from '../types';
import { formatNumber } from '../lib/format';
import { useAlerts } from '../state/alerts';
import { useSettingsLoad } from '../state/settings';
import { ThankComposer } from '../components/ThankComposer';
import { FanAvatar, TierChip, PageShell, fanName } from '../components/crm';
import { Tooltip } from '../components/ui';
import { useUI } from '../state/ui';

const profileUrl = (uniqueId: string) => `https://www.tiktok.com/@${encodeURIComponent(uniqueId)}`;

/** Kind ordering for a stable "most urgent first" sort. */
const KIND_ORDER: Record<Reminder['kind'], number> = { thank: 0, birthday: 1, quiet: 2 };

export type ReachOutFilter = 'all' | 'thank' | 'birthday' | 'quiet';

export const REACH_OUT_TABS: { id: ReachOutFilter; label: string }[] = [
  { id: 'all', label: 'All' },
  { id: 'thank', label: 'Thank-yous' },
  { id: 'birthday', label: 'Birthdays' },
  { id: 'quiet', label: 'Going cold' },
];

/** Canonical reason line for a reach-out item — shared by Reminders + Messages. */
export function reachOutReason(r: Reminder): string {
  if (r.kind === 'thank') {
    return r.days === 0
      ? 'Gave gifts in your last LIVE — say thanks'
      : `Gifted ${r.days} day${r.days === 1 ? '' : 's'} ago — say thanks`;
  }
  if (r.kind === 'birthday') {
    return r.days === 0
      ? '🎂 Birthday today!'
      : `🎂 Birthday in ${r.days} day${r.days === 1 ? '' : 's'}${r.date ? ` (${r.date})` : ''}`;
  }
  // 'quiet' — a VIP/Whale going cold.
  return `${r.fan.tier} · not seen ${r.days} day${r.days === 1 ? '' : 's'} · ${formatNumber(r.fan.totalDiamonds)} 💎 all-time`;
}

/**
 * Shared reach-out data + actions hook. Both the Reach-out workspace and the
 * Messages follow-up rail use this so a Done/Snooze on one reflects on the
 * other after refresh.
 */
export function useReachOut() {
  const pushToast = useAlerts((s) => s.pushToast);
  const [reminders, setReminders] = useState<Reminder[]>([]);
  const [loaded, setLoaded] = useState(false);

  const refresh = useCallback(() => {
    window.tiktok.remindersList()
      .then((r) => {
        const sorted = [...(r ?? [])].sort((a, b) =>
          KIND_ORDER[a.kind] !== KIND_ORDER[b.kind] ? KIND_ORDER[a.kind] - KIND_ORDER[b.kind] : a.days - b.days);
        setReminders(sorted);
        setLoaded(true);
      })
      .catch(() => setLoaded(true));
  }, []);
  useEffect(() => { refresh(); }, [refresh]);

  const snooze = useCallback(async (r: Reminder, days: number) => {
    const res = await window.tiktok.reminderAction({ id: r.id, action: 'snooze', days }).catch(() => ({ ok: false, error: 'Failed' }));
    if (res.ok) {
      pushToast({ title: `Snoozed ${days} day${days === 1 ? '' : 's'}`, body: `@${r.fan.uniqueId}` });
      refresh();
    } else {
      pushToast({ title: 'Action failed', body: res.error ?? 'Unknown error' });
    }
  }, [pushToast, refresh]);

  const markDone = useCallback(async (r: Reminder) => {
    // 'thank' items resolve via the ledger stamp; everything else dismisses the reminder.
    const res = r.kind === 'thank'
      ? await window.tiktok.fansMarkThanked(r.fan.uniqueId).catch(() => ({ ok: false, error: 'Failed' }))
      : await window.tiktok.reminderAction({ id: r.id, action: 'done' }).catch(() => ({ ok: false, error: 'Failed' }));
    if (res.ok) {
      pushToast({ title: r.kind === 'thank' ? 'Marked thanked 💌' : 'Marked done', body: `@${r.fan.uniqueId}` });
      refresh();
    } else {
      pushToast({ title: 'Action failed', body: res.error ?? 'Unknown error' });
    }
  }, [pushToast, refresh]);

  return { reminders, loaded, refresh, snooze, markDone };
}

/**
 * Consistent reach-out row used on BOTH the Reach-out workspace and the Messages
 * follow-up rail. Body click → peek (or a caller-supplied handler); every action
 * button stops propagation so it never double-triggers the peek.
 *
 * `onOpenChat` lets the Messages page navigate its embedded webview instead of
 * opening an external browser, while keeping the action label identical.
 */
export function ReachOutRow({
  r,
  onThank,
  onSnooze,
  onDone,
  onOpenChat,
  onBody,
  selected = false,
  compact = false,
}: {
  r: Reminder;
  onThank: (r: Reminder) => void;
  onSnooze: (r: Reminder, days: number) => void;
  onDone: (r: Reminder) => void;
  onOpenChat: (r: Reminder) => void;
  onBody: (r: Reminder) => void;
  selected?: boolean;
  /** denser layout for the narrow Messages rail */
  compact?: boolean;
}) {
  const [snoozing, setSnoozing] = useState(false);

  const stop = (fn: () => void) => (e: React.MouseEvent) => { e.stopPropagation(); fn(); };

  return (
    <li
      onClick={() => onBody(r)}
      role="button"
      tabIndex={0}
      onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onBody(r); } }}
      className={compact
        ? 'mb-1.5 cursor-pointer rounded-xl p-2.5 transition'
        : 'flex cursor-pointer items-center gap-3 border-t py-2.5 transition first:border-t-0 hover:bg-[var(--fill-quaternary)]'}
      style={compact
        ? {
            background: selected ? 'rgba(238,29,82,0.10)' : 'var(--fill-thin)',
            border: `1px solid ${selected ? 'rgba(238,29,82,0.35)' : 'var(--card-border)'}`,
          }
        : { borderColor: 'var(--separator)' }}
    >
      {compact ? (
        <>
          <div className="flex items-center gap-2.5">
            <FanAvatar name={fanName(r.fan)} url={r.fan.avatarUrl} size={30} />
            <span className="min-w-0 flex-1 leading-tight">
              <span className="flex items-center gap-1.5">
                <span className="truncate text-[12px] font-bold">{fanName(r.fan)}</span>
                <TierChip tier={r.fan.tier} />
              </span>
              <span className="block truncate text-[11px]" style={{ color: 'var(--secondary-label)' }}>@{r.fan.uniqueId}</span>
            </span>
          </div>
          <div className="mt-1.5 truncate text-[11px]" style={{ color: 'var(--secondary-label)' }}>{reachOutReason(r)}</div>
        </>
      ) : (
        <>
          <FanAvatar name={fanName(r.fan)} url={r.fan.avatarUrl} />
          <span className="min-w-0 flex-1 leading-tight">
            <span className="flex items-center gap-1.5">
              <span className="truncate font-semibold">{fanName(r.fan)}</span>
              <span className="truncate text-[11px]" style={{ color: 'var(--secondary-label)' }}>@{r.fan.uniqueId}</span>
              <TierChip tier={r.fan.tier} />
            </span>
            <span className="block text-[11px]" style={{ color: 'var(--secondary-label)' }}>
              {reachOutReason(r)}
              {r.fan.lastThankedAt ? ` · Last thanked ${new Date(r.fan.lastThankedAt).toLocaleDateString(undefined, { day: 'numeric', month: 'short' })}` : ''}
            </span>
          </span>
        </>
      )}

      {/* Action cluster — every button stops propagation so it never opens the peek. */}
      <div className={compact ? 'mt-2 flex items-center gap-1.5' : 'relative flex flex-none items-center gap-1.5'}>
        {snoozing ? (
          <>
            {[1, 3, 7].map((d) => (
              <button key={d} onClick={stop(() => { onSnooze(r, d); setSnoozing(false); })} className="panel-btn no-drag">{d}d</button>
            ))}
            <button onClick={stop(() => setSnoozing(false))} className="panel-btn panel-btn-icon no-drag" aria-label="Cancel snooze">✕</button>
          </>
        ) : (
          <>
            <Tooltip content="Compose a thank-you (copy + paste it yourself)">
              <button onClick={stop(() => onThank(r))} className={`panel-btn panel-btn-primary no-drag${compact ? ' flex-1' : ''}`}>💌 Thank</button>
            </Tooltip>
            <Tooltip content="Open their TikTok to message them">
              <button onClick={stop(() => onOpenChat(r))} className={`panel-btn no-drag${compact ? ' flex-1' : ''}`}>💬 {compact ? 'Chat' : 'Open chat'}</button>
            </Tooltip>
            <Tooltip content="Snooze 1 / 3 / 7 days">
              <button onClick={stop(() => setSnoozing(true))} className="panel-btn no-drag" aria-label="Snooze">💤{compact ? '' : ' Snooze'}</button>
            </Tooltip>
            <Tooltip content={r.kind === 'thank' ? 'Mark thanked — clears this' : 'Done — clears this'}>
              <button onClick={stop(() => onDone(r))} className="panel-btn no-drag" aria-label="Done"
                style={compact ? undefined : { background: 'transparent', borderColor: 'transparent', color: 'var(--secondary-label)' }}>
                ✓{compact ? '' : ' Done'}
              </button>
            </Tooltip>
          </>
        )}
      </div>
    </li>
  );
}

export function Reminders() {
  const openFanPeek = useUI((s) => s.openFanPeek);
  const openMessagesFor = useUI((s) => s.openMessagesFor);
  const pushToast = useAlerts((s) => s.pushToast);
  const { community } = useSettingsLoad();
  const { reminders, loaded, refresh, snooze, markDone } = useReachOut();
  const [filter, setFilter] = useState<ReachOutFilter>('all');
  const [thankFan, setThankFan] = useState<{ uniqueId: string; nickname?: string } | null>(null);

  const counts: Record<ReachOutFilter, number> = {
    all: reminders.length,
    thank: reminders.filter((r) => r.kind === 'thank').length,
    birthday: reminders.filter((r) => r.kind === 'birthday').length,
    quiet: reminders.filter((r) => r.kind === 'quiet').length,
  };
  const visible = filter === 'all' ? reminders : reminders.filter((r) => r.kind === filter);

  const onThank = (r: Reminder) => setThankFan({ uniqueId: r.fan.uniqueId, nickname: fanName(r.fan) });
  // Open chat IN-APP: jump to the Messages page (embedded TikTok webview) with
  // this fan loaded — consistent with the rest of the app, not the system browser.
  const onOpenChat = (r: Reminder) => openMessagesFor(r.fan.uniqueId);

  const EMPTY: Record<ReachOutFilter, string> = {
    all: `No thank-yous, no birthdays in the next ${community.birthdayWindowDays} days, and no VIPs going quiet.`,
    thank: 'No thank-yous queued — gifts from your LIVEs will show up here.',
    birthday: `No birthdays in the next ${community.birthdayWindowDays} days. Add birthdays from a fan's detail panel.`,
    quiet: `All your VIPs and Whales have been around in the last ${community.quietDays} days. 🎉`,
  };

  return (
    <PageShell title="Reach out" subtitle="Everyone worth a message right now — thank-yous, birthdays and big supporters going quiet.">
      {/* Filter tabs */}
      <div className="flex flex-wrap items-center gap-1.5">
        {REACH_OUT_TABS.map((t) => {
          const active = filter === t.id;
          return (
            <button
              key={t.id}
              onClick={() => setFilter(t.id)}
              className="panel-btn no-drag"
              style={active
                ? { background: 'rgba(238,29,82,0.14)', borderColor: 'rgba(238,29,82,0.35)', color: 'var(--label)', fontWeight: 700 }
                : undefined}
            >
              {t.label}
              <span className="ml-1.5 tabular-nums" style={{ color: 'var(--secondary-label)' }}>{counts[t.id]}</span>
            </button>
          );
        })}
      </div>

      {loaded && visible.length === 0 ? (
        <div className="glass flex flex-1 flex-col items-center justify-center gap-3 p-10 text-center" style={{ borderRadius: 22 }}>
          <img src="./assets/png/icon_thank_you_envelope_3d.png" alt="" className="h-20 w-20 object-contain" draggable={false} />
          <h2 className="text-base font-extrabold">All caught up 💕</h2>
          <p className="max-w-sm text-[13px]" style={{ color: 'var(--secondary-label)' }}>{EMPTY[filter]}</p>
        </div>
      ) : (
        <div className="mx-auto w-full max-w-3xl">
          <div className="glass p-4" style={{ borderRadius: 18 }}>
            <ul className="text-[13px]">
              {visible.map((r) => (
                <ReachOutRow
                  key={r.id}
                  r={r}
                  onThank={onThank}
                  onSnooze={snooze}
                  onDone={markDone}
                  onOpenChat={onOpenChat}
                  onBody={(rr) => openFanPeek(rr.fan.uniqueId)}
                />
              ))}
            </ul>
          </div>
        </div>
      )}

      {thankFan && (
        <ThankComposer
          uniqueId={thankFan.uniqueId}
          nickname={thankFan.nickname}
          onClose={() => setThankFan(null)}
          onThanked={refresh}
        />
      )}
    </PageShell>
  );
}
