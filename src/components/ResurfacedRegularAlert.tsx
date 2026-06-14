/**
 * ⚡ Resurfaced Regular — the differentiator.
 *
 * TikTok deletes a creator's gifter history after ~60 days, so whales who
 * return after a break are invisible. This panel watches the live room for
 * JOINS (member / follow / chat / gift events all "touch" roomMembers) and,
 * when a *saved* high-value fan re-enters, pops a glanceable slide-in card so
 * the creator can greet them BY NAME with real context ("Whale · 12.4K 💎 ·
 * last gift Rose ×99 · 🎂 in 3 days") before the moment passes.
 *
 * Design constraints (anti-spam, this is on-screen during a live show):
 *  - Only fires for fans already in the ledger above a meaningful bar
 *    (VIP/Whale, or Regular+ with at least one logged gift). Unknown/brand-new
 *    viewers and the host never trigger it.
 *  - De-dupes per session (a fan alerts at most once per app session).
 *  - Throttled + queued so a flood of joins can't spam; at most VISIBLE_CAP
 *    cards on screen, each auto-dismissing after VISIBLE_MS.
 *  - Reads ONLY real ledger data via the existing window.tiktok.fansGet IPC —
 *    no new main-process code, no new IPC. Detection runs in the renderer.
 *  - Respects prefers-reduced-motion (no slide).
 */
import { useEffect, useRef, useState } from 'react';
import { useStore } from '../state/store';
import { useUI } from '../state/ui';
import { tierClass } from '../lib/tier';
import { avatarGradient } from '../lib/avatars';
import { formatNumber } from '../lib/format';
import { ThankComposer } from './ThankComposer';
import type { Fan } from '../types';

/** How many cards can be on screen at once. */
const VISIBLE_CAP = 3;
/** Auto-dismiss after this long (ms). */
const VISIBLE_MS = 8000;
/** Don't process joins faster than this — drains the queue one at a time. */
const DRAIN_MS = 1200;
/** A Regular fan needs at least this many logged gifts to be "meaningful". */
const MIN_GIFTS_FOR_REGULAR = 1;

type AlertCard = {
  /** unique key for this card instance */
  key: string;
  fan: Fan;
  shownAt: number;
};

/** Is this saved fan worth interrupting the creator for? */
function isMeaningful(fan: Fan): boolean {
  if (fan.tier === 'VIP' || fan.tier === 'Whale') return true;
  if (fan.tier === 'Regular' && fan.giftCount >= MIN_GIFTS_FOR_REGULAR) return true;
  return false;
}

function prefersReducedMotion(): boolean {
  try {
    return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  } catch {
    return false;
  }
}

/** Birthday days-away (mirrors FanMemoryPanel) — for the "🎂 in N days" hint. */
function birthdayDaysAway(mmdd?: string): number | null {
  if (!mmdd) return null;
  const m = mmdd.match(/^(\d{2})-(\d{2})$/);
  if (!m) return null;
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  let next = new Date(now.getFullYear(), Number(m[1]) - 1, Number(m[2]));
  if (next < today) next = new Date(now.getFullYear() + 1, Number(m[1]) - 1, Number(m[2]));
  return Math.round((next.getTime() - today.getTime()) / 86400000);
}

/** Compose the one-line memory string from real fan fields. */
function memoryLine(fan: Fan): string {
  const parts: string[] = [`${formatNumber(fan.totalDiamonds)} 💎`];
  if (fan.tags?.length) parts.push(`#${fan.tags[0]}`);
  const bday = birthdayDaysAway(fan.birthday);
  if (bday !== null && bday <= 30) {
    parts.push(bday === 0 ? '🎂 today!' : `🎂 in ${bday}d`);
  }
  return parts.join(' · ');
}

export function ResurfacedRegularAlert() {
  const focusFanMemory = useUI((s) => s.focusFanMemory);
  // Subscribe only to the membership map — re-renders when a viewer is touched
  // (member/join/chat/gift/like/follow all flow through touchMember in store.ts).
  const roomMembers = useStore((s) => s.roomMembers);
  const status = useStore((s) => s.status);
  const hostUniqueId = useStore((s) => s.roomInfo?.hostUniqueId ?? null);
  const selfUsername = useStore((s) => s.username);

  const [cards, setCards] = useState<AlertCard[]>([]);
  const [thankFor, setThankFor] = useState<Fan | null>(null);

  // Fans we've already alerted (or are mid-lookup for) this session — never re-alert.
  const seen = useRef<Set<string>>(new Set());
  // Joins waiting to be looked up, FIFO, drained on a throttle.
  const queue = useRef<string[]>([]);
  const draining = useRef(false);
  const keyCounter = useRef(0);

  // Reset the de-dupe set whenever a NEW connection starts so reconnecting to a
  // different room re-arms the alerts (but stays stable within one session).
  const connectedAt = useStore((s) => s.connectedAt);
  useEffect(() => {
    seen.current = new Set();
    queue.current = [];
    setCards([]);
  }, [connectedAt]);

  // Enqueue any newly-touched members that we haven't seen this session. We only
  // look at the most-recently-touched tail of the Map (insertion order tracks
  // recency in store.ts), so this stays O(small) even with thousands of members.
  useEffect(() => {
    if (status !== 'connected') return;
    const host = hostUniqueId?.toLowerCase();
    const self = selfUsername?.toLowerCase();
    const ids = Array.from(roomMembers.keys());
    // Scan from the most recent end; stop early once we hit already-seen ids.
    for (let i = ids.length - 1; i >= 0 && i >= ids.length - 40; i--) {
      const id = ids[i];
      if (!id || seen.current.has(id)) continue;
      const lower = id.toLowerCase();
      if (lower === host || lower === self) {
        seen.current.add(id); // never alert for the host / yourself
        continue;
      }
      // Mark as seen immediately so a join-flood can't enqueue the same id twice.
      seen.current.add(id);
      queue.current.push(id);
    }
    drain();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [roomMembers, status, hostUniqueId, selfUsername]);

  // Drain the queue one lookup at a time on a throttle, so a burst of joins
  // can't fire a burst of IPC calls or a burst of cards.
  const drain = () => {
    if (draining.current) return;
    const next = queue.current.shift();
    if (!next) return;
    draining.current = true;
    window.tiktok
      .fansGet(next)
      .then((fan) => {
        if (fan && isMeaningful(fan)) {
          setCards((prev) => {
            if (prev.some((c) => c.fan.uniqueId === fan.uniqueId)) return prev;
            const card: AlertCard = { key: `rr-${keyCounter.current++}`, fan, shownAt: Date.now() };
            // Newest on top; cap the stack (drop the oldest beyond the cap).
            return [card, ...prev].slice(0, VISIBLE_CAP);
          });
        }
      })
      .catch(() => {
        /* never throw from detection */
      })
      .finally(() => {
        setTimeout(() => {
          draining.current = false;
          drain();
        }, DRAIN_MS);
      });
  };

  // Auto-dismiss the oldest card once it ages out.
  useEffect(() => {
    if (cards.length === 0) return;
    const oldest = cards[cards.length - 1];
    const age = Date.now() - oldest.shownAt;
    const t = setTimeout(() => {
      setCards((prev) => prev.filter((c) => c.key !== oldest.key));
    }, Math.max(250, VISIBLE_MS - age));
    return () => clearTimeout(t);
  }, [cards]);

  const dismiss = (key: string) => setCards((prev) => prev.filter((c) => c.key !== key));

  const view = (fan: Fan) => {
    focusFanMemory(fan.uniqueId); // pins the fan in the Fan Memory panel
    dismissFan(fan.uniqueId);
  };

  const dismissFan = (uid: string) =>
    setCards((prev) => prev.filter((c) => c.fan.uniqueId !== uid));

  if (status !== 'connected' || cards.length === 0) {
    return thankFor ? (
      <ThankComposer
        uniqueId={thankFor.uniqueId}
        nickname={thankFor.displayName || thankFor.nickname}
        onClose={() => setThankFor(null)}
      />
    ) : null;
  }

  const slide = prefersReducedMotion() ? '' : 'resurfaced-slide-in';

  return (
    <>
      <div
        className="pointer-events-none fixed right-4 top-20 z-[60] flex w-[320px] flex-col gap-2"
        aria-live="polite"
        aria-label="Returning regular alerts"
      >
        {cards.map((card) => {
          const fan = card.fan;
          const name = fan.displayName || fan.nickname || fan.uniqueId;
          const avatarUrl = fan.avatarUrl || null;
          return (
            <div
              key={card.key}
              className={`pointer-events-auto glass brand-top-border overflow-hidden rounded-[var(--radius-card)] p-3 shadow-2xl ${slide}`}
              role="alert"
            >
              <div className="flex items-start gap-2.5">
                {avatarUrl ? (
                  <img src={avatarUrl} alt="" className="h-10 w-10 flex-none rounded-full object-cover ring-2 ring-like-500/50" />
                ) : (
                  <div className={`flex h-10 w-10 flex-none items-center justify-center rounded-full text-sm font-bold text-white ring-2 ring-like-500/50 ${avatarGradient(name)}`}>
                    {name.charAt(0).toUpperCase()}
                  </div>
                )}
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-1.5">
                    <span className="text-[10px] font-bold uppercase tracking-wider text-[var(--amber)]">⚡ Back in the room</span>
                  </div>
                  <div className="mt-0.5 flex items-center gap-1.5">
                    <span className="max-w-[150px] truncate text-sm font-bold text-zinc-100">{name}</span>
                    <span className={tierClass(fan.tier)}>{fan.tier.toUpperCase()}</span>
                  </div>
                  <div className="truncate text-[11px] text-zinc-400">{memoryLine(fan)}</div>
                </div>
                <button
                  onClick={() => dismiss(card.key)}
                  className="flex-none rounded-md px-1 text-xs text-zinc-600 hover:bg-zinc-800 hover:text-zinc-300"
                  title="Dismiss"
                  aria-label="Dismiss alert"
                >
                  ✕
                </button>
              </div>
              <div className="mt-2.5 flex items-stretch gap-1.5">
                <button
                  onClick={() => view(fan)}
                  className="flex-1 rounded-full px-3 py-1.5 text-xs font-bold text-white transition"
                  style={{ background: 'var(--gradient-pink)' }}
                >
                  👤 View
                </button>
                <button
                  onClick={() => { setThankFor(fan); dismissFan(fan.uniqueId); }}
                  className="flex-none rounded-full border border-zinc-800 px-3 text-xs font-semibold text-zinc-300 transition hover:bg-zinc-800/60 hover:text-zinc-100"
                  title="Send a thank-you"
                >
                  💌 Thank
                </button>
              </div>
            </div>
          );
        })}
      </div>
      {thankFor && (
        <ThankComposer
          uniqueId={thankFor.uniqueId}
          nickname={thankFor.displayName || thankFor.nickname}
          onClose={() => setThankFor(null)}
        />
      )}
    </>
  );
}
