/** Reminders — upcoming birthdays + quiet VIPs, with snooze/done persisted. */
import { useCallback, useEffect, useState } from 'react';
import type { Reminder } from '../types';
import { formatNumber } from '../lib/format';
import { useAlerts } from '../state/alerts';
import { FanAvatar, TierChip, PageShell, fanName } from '../components/crm';

export function Reminders() {
  const pushToast = useAlerts((s) => s.pushToast);
  const [reminders, setReminders] = useState<Reminder[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [snoozeFor, setSnoozeFor] = useState<string | null>(null);

  const refresh = useCallback(() => {
    window.tiktok.remindersList(30).then((r) => { setReminders(r ?? []); setLoaded(true); }).catch(() => setLoaded(true));
  }, []);
  useEffect(() => { refresh(); }, [refresh]);

  const act = async (id: string, action: 'done' | 'snooze', days?: number) => {
    const res = await window.tiktok.reminderAction({ id, action, days });
    if (res.ok) {
      pushToast({ title: action === 'done' ? 'Marked done' : `Snoozed ${days} day${days === 1 ? '' : 's'}`, body: 'Reminder updated' });
      setSnoozeFor(null);
      refresh();
    } else {
      pushToast({ title: 'Action failed', body: res.error ?? 'Unknown error' });
    }
  };

  const birthdays = reminders.filter((r) => r.kind === 'birthday');
  const quiet = reminders.filter((r) => r.kind === 'quiet');

  const Row = ({ r }: { r: Reminder }) => (
    <li className="flex items-center gap-3 border-t py-2.5 first:border-t-0" style={{ borderColor: 'var(--separator)' }}>
      <FanAvatar name={fanName(r.fan)} url={r.fan.avatarUrl} />
      <span className="min-w-0 flex-1 leading-tight">
        <span className="flex items-center gap-1.5">
          <span className="truncate font-semibold">{fanName(r.fan)}</span>
          <TierChip tier={r.fan.tier} />
        </span>
        <span className="block text-[11px]" style={{ color: 'var(--secondary-label)' }}>
          {r.kind === 'birthday'
            ? r.days === 0 ? '🎂 Birthday today!' : `🎂 Birthday in ${r.days} day${r.days === 1 ? '' : 's'} (${r.date})`
            : `Hasn't been seen in ${r.days} days · ${formatNumber(r.fan.totalDiamonds)} 💎 all-time`}
        </span>
      </span>
      <div className="relative flex flex-none items-center gap-1.5">
        {snoozeFor === r.id ? (
          <>
            {[1, 3, 7, 14, 30].map((d) => (
              <button key={d} onClick={() => act(r.id, 'snooze', d)} className="panel-btn no-drag">{d}d</button>
            ))}
            <button onClick={() => setSnoozeFor(null)} className="panel-btn panel-btn-icon no-drag" aria-label="Cancel snooze">✕</button>
          </>
        ) : (
          <>
            <button onClick={() => setSnoozeFor(r.id)} className="panel-btn no-drag">Snooze</button>
            <button onClick={() => act(r.id, 'done')} className="panel-btn panel-btn-primary no-drag">Done</button>
          </>
        )}
      </div>
    </li>
  );

  return (
    <PageShell title="Reminders" subtitle="Who to reach out to — birthdays coming up and big supporters going quiet.">
      {loaded && reminders.length === 0 ? (
        <div className="glass flex flex-1 flex-col items-center justify-center gap-3 p-10 text-center" style={{ borderRadius: 22 }}>
          <img src="./assets/png/icon_thank_you_envelope_3d.png" alt="" className="h-20 w-20 object-contain" draggable={false} />
          <h2 className="text-base font-extrabold">All caught up</h2>
          <p className="max-w-sm text-[13px]" style={{ color: 'var(--secondary-label)' }}>
            No birthdays in the next 30 days and no VIPs going quiet. Add birthdays to fans on the Followers page to get nudges here.
          </p>
        </div>
      ) : (
        <div className="grid grid-cols-1 items-start gap-3 lg:grid-cols-2">
          <div className="glass p-4" style={{ borderRadius: 18 }}>
            <h3 className="mb-1 flex items-center gap-2 text-sm font-bold">
              <span className="flex h-8 w-8 flex-none items-center justify-center rounded-full" style={{ background: 'rgba(238, 29, 82, 0.14)' }}>
                <img src="./assets/png/icon_heart_3d.png" alt="" className="h-5 w-5" draggable={false} />
              </span>
              Upcoming birthdays
            </h3>
            {birthdays.length === 0 ? (
              <p className="py-4 text-[12px]" style={{ color: 'var(--secondary-label)' }}>
                No birthdays in the next 30 days. Add them from each fan&apos;s detail panel.
              </p>
            ) : (
              <ul className="text-[13px]">{birthdays.map((r) => <Row key={r.id} r={r} />)}</ul>
            )}
          </div>
          <div className="glass p-4" style={{ borderRadius: 18 }}>
            <h3 className="mb-1 flex items-center gap-2 text-sm font-bold">
              <span className="flex h-8 w-8 flex-none items-center justify-center rounded-full" style={{ background: 'rgba(168, 85, 247, 0.16)' }}>
                <img src="./assets/png/icon_crown_3d.png" alt="" className="h-5 w-5" draggable={false} />
              </span>
              Quiet VIPs
            </h3>
            {quiet.length === 0 ? (
              <p className="py-4 text-[12px]" style={{ color: 'var(--secondary-label)' }}>
                All your VIPs and Whales have been around in the last 14 days. 🎉
              </p>
            ) : (
              <ul className="text-[13px]">{quiet.map((r) => <Row key={r.id} r={r} />)}</ul>
            )}
          </div>
        </div>
      )}
    </PageShell>
  );
}
