import { useEffect, useMemo, useState } from 'react';
import type { SessionRecord, SessionSummary, UserNote } from '../types';
import { formatNumber, formatUptime } from '../lib/format';
import { avatarGradient } from '../lib/avatars';

type Leader = {
  uniqueId: string;
  nickname: string;
  likes: number;
  diamonds: number;
  comments: number;
  gifts: number;
  sessionsAppeared: number;
};

function greeting(): string {
  const h = new Date().getHours();
  if (h < 5) return 'Good night';
  if (h < 12) return 'Good morning';
  if (h < 18) return 'Good afternoon';
  return 'Good evening';
}

function tierForDiamonds(d: number): { label: string; cls: string } {
  if (d >= 10000) return { label: 'Whale', cls: 'tier-chip tier-whale' };
  if (d >= 1000) return { label: 'VIP', cls: 'tier-chip tier-vip' };
  if (d >= 100) return { label: 'Regular', cls: 'tier-chip tier-regular' };
  return { label: 'New', cls: 'tier-chip tier-new' };
}

function Avatar({ name, size = 32 }: { name: string; size?: number }) {
  return (
    <span
      className={`flex flex-none items-center justify-center rounded-full font-bold text-white ${avatarGradient(name)}`}
      style={{ width: size, height: size, fontSize: size * 0.4 }}
    >
      {(name.replace(/^@/, '')[0] || '?').toUpperCase()}
    </span>
  );
}

function StatCard({ label, value, sub, icon }: { label: string; value: string; sub?: string; icon: string }) {
  return (
    <div className="glass brand-top-border relative p-4" style={{ borderRadius: 18 }}>
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="text-xs font-medium" style={{ color: 'var(--secondary-label)' }}>{label}</div>
          <div className="mt-1 truncate text-[24px] font-extrabold leading-tight tracking-tight">{value}</div>
          {sub && <div className="mt-1 text-xs" style={{ color: 'var(--secondary-label)' }}>{sub}</div>}
        </div>
        <img src={icon} alt="" className="h-10 w-10 flex-none object-contain" draggable={false} />
      </div>
    </div>
  );
}

function dateLabel(ts: number): string {
  return new Date(ts).toLocaleDateString(undefined, { day: 'numeric', month: 'short' });
}

export function Dashboard({ onOpenHistory, onGoLive }: { onOpenHistory: () => void; onGoLive: () => void }) {
  const [sessions, setSessions] = useState<SessionSummary[]>([]);
  const [leaders, setLeaders] = useState<Leader[]>([]);
  const [notes, setNotes] = useState<Record<string, UserNote>>({});
  const [trackedCount, setTrackedCount] = useState(0);
  const [latest, setLatest] = useState<SessionRecord | null>(null);

  useEffect(() => {
    window.tiktok.sessionsList().then((list) => {
      setSessions(list);
      if (list[0]) window.tiktok.sessionsGet(list[0].id).then(setLatest);
    }).catch(() => {});
    window.tiktok.sessionsLeaderboard(8).then((l) => setLeaders(l ?? [])).catch(() => {});
    window.tiktok.notesAll().then((n) => setNotes(n ?? {})).catch(() => {});
    window.tiktok.trackedList().then((t) => setTrackedCount(t.length)).catch(() => {});
  }, []);

  const totalDiamonds = useMemo(() => sessions.reduce((a, s) => a + (s.totals?.diamonds ?? 0), 0), [sessions]);
  const top = leaders[0] ?? null;
  const topNote = top ? notes[top.uniqueId] : undefined;

  // Latest-session follow-up metrics
  const followUp = useMemo(() => {
    if (!latest) return null;
    const gifters = new Set<string>();
    for (const e of latest.events) {
      if (e.type === 'gift' && e.user?.uniqueId) gifters.add(e.user.uniqueId);
    }
    return {
      giftersToThank: gifters.size,
      newFollowers: latest.totals.follows,
      diamonds: latest.totals.diamonds,
      peakViewers: latest.totals.peakViewers,
    };
  }, [latest]);

  const hasData = sessions.length > 0;

  return (
    <div className="flex min-h-0 flex-1 items-start gap-4 overflow-y-auto p-5">
      <div className="min-w-0 flex-1 space-y-4">
        {/* Greeting */}
        <div>
          <h1 className="text-xl font-extrabold tracking-tight">{greeting()} <span aria-hidden>👋</span></h1>
          <p className="text-[13px]" style={{ color: 'var(--secondary-label)' }}>Here&apos;s your community at a glance.</p>
        </div>

        {/* Stat cards */}
        <div className="grid grid-cols-2 gap-3 xl:grid-cols-4">
          <StatCard label="Total sessions" value={hasData ? String(sessions.length) : '0'} icon="./assets/png/icon_clock_3d.png" />
          <StatCard label="Diamonds all-time" value={hasData ? formatNumber(totalDiamonds) : '0'} icon="./assets/png/icon_diamond_3d.png" />
          <StatCard label="Top gifter" value={top ? top.nickname : '—'} sub={top ? `${formatNumber(top.diamonds)} diamonds` : undefined} icon="./assets/png/icon_crown_3d.png" />
          <StatCard label="Tracked fans" value={String(trackedCount)} icon="./assets/png/icon_group_3d.png" />
        </div>

        {/* Hero: after tonight's LIVE */}
        <div
          className="glass flex flex-wrap items-center gap-4 p-5"
          style={{ borderRadius: 22 }}
        >
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
                { label: 'Gifters to thank', value: followUp && followUp.giftersToThank ? String(followUp.giftersToThank) : '—' },
                { label: 'New followers', value: followUp && followUp.newFollowers ? `+${formatNumber(followUp.newFollowers)}` : '—' },
                { label: 'Diamonds earned', value: followUp && followUp.diamonds ? formatNumber(followUp.diamonds) : '—' },
                { label: 'Peak viewers', value: followUp && followUp.peakViewers ? formatNumber(followUp.peakViewers) : '—' },
              ].map((m) => (
                <div key={m.label} className="rounded-xl px-3 py-2" style={{ background: 'var(--fill-quaternary)', border: '1px solid var(--card-border)' }}>
                  <dd className="text-base font-extrabold">{m.value}</dd>
                  <dt className="text-[11px]" style={{ color: 'var(--secondary-label)' }}>{m.label}</dt>
                </div>
              ))}
            </dl>
          </div>
          {hasData ? (
            <button onClick={onOpenHistory} className="panel-btn panel-btn-primary no-drag whitespace-nowrap !h-8 !px-4">Open last session →</button>
          ) : (
            <button onClick={onGoLive} className="panel-btn panel-btn-primary no-drag whitespace-nowrap !h-8 !px-4">Connect to your first LIVE →</button>
          )}
        </div>

        {/* Top gifters + Recent sessions */}
        <div className="grid grid-cols-1 items-stretch gap-3 lg:grid-cols-2">
          <div className="glass flex flex-col p-4" style={{ borderRadius: 18 }}>
            <h3 className="mb-2 text-sm font-bold">Top Gifters</h3>
            {leaders.length === 0 ? (
              <div className="py-6 text-center text-[12px]" style={{ color: 'var(--secondary-label)' }}>
                <img src="./assets/png/icon_gift_box_3d.png" alt="" className="mx-auto mb-2 h-12 w-12" draggable={false} />
                No gifts recorded yet — your top supporters will appear after your first LIVE.
              </div>
            ) : (
              <ul className="text-[13px]">
                {leaders.slice(0, 5).map((l, i) => {
                  const tier = tierForDiamonds(l.diamonds);
                  return (
                    <li key={l.uniqueId} className={`flex items-center gap-3 py-2 ${i > 0 ? 'border-t' : ''}`} style={{ borderColor: 'var(--separator)' }}>
                      <span
                        className="flex h-6 w-6 flex-none items-center justify-center rounded-full text-[11px] font-bold"
                        style={{ background: 'var(--fill-thin)', color: 'var(--secondary-label)' }}
                      >
                        {i + 1}
                      </span>
                      <Avatar name={l.nickname || l.uniqueId} />
                      <span className="min-w-0 flex-1 leading-tight">
                        <span className="flex items-center gap-1.5">
                          <span className="truncate font-semibold">{l.nickname}</span>
                          <span className={tier.cls}>{tier.label}</span>
                        </span>
                        <span className="block text-[11px]" style={{ color: 'var(--secondary-label)' }}>@{l.uniqueId}</span>
                      </span>
                      <span className="text-[12px] font-bold tabular-nums">{formatNumber(l.diamonds)} 💎</span>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>

          <div className="glass flex flex-col p-4" style={{ borderRadius: 18 }}>
            <h3 className="mb-2 text-sm font-bold">Recent sessions</h3>
            {sessions.length === 0 ? (
              <div className="py-6 text-center text-[12px]" style={{ color: 'var(--secondary-label)' }}>
                <img src="./assets/png/icon_clock_3d.png" alt="" className="mx-auto mb-2 h-12 w-12" draggable={false} />
                No sessions yet — connect to a LIVE to start recording.
              </div>
            ) : (
              <ul className="text-[13px]">
                {sessions.slice(0, 5).map((s, i) => {
                  const dur = (s.endedAt ?? Date.now()) - s.startedAt;
                  return (
                    <li key={s.id} className={`flex items-center gap-3 py-2 ${i > 0 ? 'border-t' : ''}`} style={{ borderColor: 'var(--separator)' }}>
                      <Avatar name={s.hostNickname || s.hostUniqueId} />
                      <span className="min-w-0 flex-1 leading-tight">
                        <span className="block truncate font-semibold">{s.roomTitle || `@${s.hostUniqueId}`}</span>
                        <span className="block text-[11px]" style={{ color: 'var(--secondary-label)' }}>
                          {dateLabel(s.startedAt)} · {formatUptime(dur)}{s.endedAt === null ? ' · live' : ''}
                        </span>
                      </span>
                      <span className="text-[12px] font-bold tabular-nums">{formatNumber(s.totals?.diamonds ?? 0)} 💎</span>
                    </li>
                  );
                })}
              </ul>
            )}
            {sessions.length > 0 && (
              <button
                onClick={onOpenHistory}
                className="no-drag mt-auto self-start pt-2 text-[12px] font-semibold hover:underline"
                style={{ color: 'var(--brand-pink)' }}
              >
                View all sessions →
              </button>
            )}
          </div>
        </div>
      </div>

      {/* Top supporter panel (xl+) */}
      <aside aria-label="Top supporter" className="hidden w-[280px] flex-none xl:block">
        {!top ? (
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
            <div className="-mt-6 px-4 pb-4">
              <Avatar name={top.nickname || top.uniqueId} size={48} />
              <div className="mt-2 flex flex-wrap items-center gap-2">
                <h3 className="text-base font-extrabold leading-tight">{top.nickname}</h3>
                <span className={tierForDiamonds(top.diamonds).cls}>{tierForDiamonds(top.diamonds).label}</span>
              </div>
              <div className="text-[12px]" style={{ color: 'var(--secondary-label)' }}>@{top.uniqueId}</div>
              <div className="mt-3 text-[10px] font-semibold uppercase tracking-wide" style={{ color: 'var(--secondary-label)' }}>Top supporter</div>
              <div className="mt-2 grid grid-cols-2 gap-2">
                <div className="rounded-xl p-2.5" style={{ background: 'var(--fill-quaternary)', border: '1px solid var(--card-border)' }}>
                  <div className="text-base font-extrabold">{formatNumber(top.diamonds)}</div>
                  <div className="text-[11px]" style={{ color: 'var(--secondary-label)' }}>Diamonds</div>
                </div>
                <div className="rounded-xl p-2.5" style={{ background: 'var(--fill-quaternary)', border: '1px solid var(--card-border)' }}>
                  <div className="text-base font-extrabold">{top.sessionsAppeared}</div>
                  <div className="text-[11px]" style={{ color: 'var(--secondary-label)' }}>Sessions</div>
                </div>
              </div>
              <div className="mt-3 text-[10px] font-semibold uppercase tracking-wide" style={{ color: 'var(--secondary-label)' }}>Fan note</div>
              <p className="mt-1 text-[12px] leading-snug" style={{ color: 'var(--secondary-label)' }}>
                {topNote?.notes || 'No notes yet — add one from the Fan Notes panel.'}
              </p>
            </div>
          </div>
        )}
      </aside>
    </div>
  );
}
