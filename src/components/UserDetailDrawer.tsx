import { useEffect, useMemo, useRef, useState } from 'react';
import { useStore } from '../state/store';
import { formatNumber, timeAgo } from '../lib/format';
import { avatarGradient } from '../lib/avatars';
import { UserBadges } from './UserBadges';
import { useTracked } from '../state/tracked';
import type { UserBrief, UserNote, LiveEvent, UserHistoricalTally } from '../types';

export function UserDetailDrawer() {
  const selectedUserId = useStore((s) => s.selectedUserId);
  const selectUser = useStore((s) => s.selectUser);
  const tallies = useStore((s) => s.tallies);
  const recentForUser = useStore((s) => s.recentForUser);

  const tally = selectedUserId ? tallies.get(selectedUserId) : null;
  const user: UserBrief | null = tally?.user ?? null;
  const isTracked = useTracked((s) => s.isTracked);
  const addTracked = useTracked((s) => s.add);
  const removeTracked = useTracked((s) => s.remove);
  const tracked = selectedUserId ? isTracked(selectedUserId) : false;

  const [note, setNote] = useState('');
  const [savedAt, setSavedAt] = useState<number | null>(null);
  const [savingFlash, setSavingFlash] = useState(false);
  const [historical, setHistorical] = useState<UserHistoricalTally | null>(null);
  const debounce = useRef<ReturnType<typeof setTimeout> | null>(null);
  const loadedFor = useRef<string | null>(null);

  useEffect(() => {
    if (!selectedUserId) return;
    loadedFor.current = selectedUserId;
    window.tiktok.notesGet(selectedUserId).then((n) => {
      if (loadedFor.current !== selectedUserId) return;
      setNote(n?.notes ?? '');
      setSavedAt(n?.updatedAt ?? null);
    });
    window.tiktok.sessionsUserTallies(selectedUserId).then((t) => {
      if (loadedFor.current !== selectedUserId) return;
      setHistorical(t);
    });
  }, [selectedUserId]);

  useEffect(() => {
    if (!selectedUserId || !user) return;
    if (loadedFor.current !== selectedUserId) return;
    if (debounce.current) clearTimeout(debounce.current);
    debounce.current = setTimeout(async () => {
      const saved = await window.tiktok.notesSet({
        uniqueId: selectedUserId,
        nickname: user.nickname,
        notes: note,
      });
      setSavedAt(saved.updatedAt);
      setSavingFlash(true);
      setTimeout(() => setSavingFlash(false), 700);
    }, 500);
    return () => {
      if (debounce.current) clearTimeout(debounce.current);
    };
  }, [note, selectedUserId, user]);

  const recent: LiveEvent[] = useMemo(
    () => (selectedUserId ? recentForUser(selectedUserId, 30) : []),
    [selectedUserId, recentForUser],
  );

  if (!selectedUserId || !user) return null;

  return (
    <>
      <div
        className="fixed inset-0 z-[60] bg-black/50 backdrop-blur-sm"
        onClick={() => selectUser(null)}
      />
      <aside className="animate-slide-in fixed right-0 top-0 z-[70] flex h-screen w-[420px] flex-col border-l border-zinc-800/60 bg-zinc-950/95 shadow-2xl backdrop-blur">
        <header className="relative overflow-hidden border-b border-zinc-800/50 p-5">
          <div className="pointer-events-none absolute inset-0 bg-gradient-to-b from-like-500/8 to-transparent" />
          <div className="relative flex items-center gap-3">
            {user.profilePictureUrl ? (
              <img
                src={user.profilePictureUrl}
                alt=""
                className="h-14 w-14 flex-none rounded-full bg-zinc-800 object-cover ring-2 ring-like-500/20"
              />
            ) : (
              <div className={`flex h-14 w-14 flex-none items-center justify-center rounded-full text-xl font-bold text-white ring-2 ring-like-500/20 ${avatarGradient(user.nickname)}`}>
                {user.nickname.charAt(0).toUpperCase()}
              </div>
            )}
            <div className="min-w-0 flex-1">
              <div className="truncate text-base font-bold text-zinc-100">{user.nickname}</div>
              <div className="truncate text-xs text-zinc-500">@{user.uniqueId}</div>
              <div className="mt-1">
                <UserBadges user={user} />
              </div>
            </div>
            <button
              onClick={() => selectUser(null)}
              className="rounded-lg p-1.5 text-zinc-500 transition hover:bg-zinc-900 hover:text-zinc-200"
              aria-label="Close"
            >
              ✕
            </button>
          </div>
        </header>

        <div className="p-4">
          <div className="mb-1.5 text-[10px] font-semibold uppercase tracking-wider text-zinc-500">This session</div>
          <div className="grid grid-cols-3 gap-2">
            <Stat label="Likes" value={formatNumber(tally?.likes ?? 0)} accent="text-like-400" />
            <Stat label="Diamonds" value={formatNumber(tally?.diamonds ?? 0)} accent="text-amber-300" />
            <Stat label="Comments" value={formatNumber(tally?.comments ?? 0)} accent="text-zinc-200" />
          </div>
          {historical && historical.sessionsAppeared > 0 && (
            <>
              <div className="mt-3 mb-1.5 text-[10px] font-semibold uppercase tracking-wider text-zinc-500">
                All time ({historical.sessionsAppeared} session{historical.sessionsAppeared > 1 ? 's' : ''})
              </div>
              <div className="grid grid-cols-4 gap-2">
                <Stat label="Diamonds" value={formatNumber(historical.diamonds)} accent="text-amber-300" />
                <Stat label="Comments" value={formatNumber(historical.comments)} accent="text-zinc-200" />
                <Stat label="Gifts" value={formatNumber(historical.gifts)} accent="text-emerald-300" />
                <Stat label="Sessions" value={String(historical.sessionsAppeared)} accent="text-cyan-400" />
              </div>
            </>
          )}
        </div>

        <section className="px-4">
          <div className="mb-1 flex items-baseline justify-between">
            <label className="text-[10px] font-semibold uppercase tracking-wider text-zinc-500">Notes</label>
            <span className={`text-[10px] ${savingFlash ? 'text-emerald-400' : 'text-zinc-600'}`}>
              {savingFlash
                ? 'Saved'
                : savedAt
                  ? `Updated ${timeAgo(savedAt)} ago`
                  : 'Auto-saves as you type'}
            </span>
          </div>
          <textarea
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder="Remember key facts: real name, interests, where they're from, how you met, VIP status..."
            rows={4}
            className="w-full resize-y rounded-lg border border-zinc-800 bg-zinc-900 p-3 text-sm leading-relaxed outline-none transition focus:border-like-500/60"
          />
        </section>

        <section className="mt-3 flex min-h-0 flex-1 flex-col px-4 pb-4">
          <div className="mb-1.5 text-[10px] font-semibold uppercase tracking-wider text-zinc-500">
            Recent activity (this session)
          </div>
          <div className="glass flex-1 overflow-y-auto rounded-lg">
            {recent.length === 0 ? (
              <div className="flex h-full items-center justify-center p-4 text-xs text-zinc-600">
                No activity from this user yet
              </div>
            ) : (
              <ul className="flex flex-col gap-0.5 p-2 text-xs">
                {recent.map((e, i) => (
                  <li key={i} className="flex items-baseline gap-2 rounded px-1.5 py-1 hover:bg-zinc-800/40">
                    <span className="w-10 flex-none text-[10px] text-zinc-600">{timeAgo(e.ts)}</span>
                    <span className="text-zinc-300">{describeRecent(e)}</span>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </section>

        <footer className="flex items-center gap-2 border-t border-zinc-800/50 p-3">
          <button
            onClick={() => {
              if (tracked) removeTracked(user.uniqueId);
              else addTracked(user.uniqueId, user.nickname);
            }}
            className={`rounded-lg px-3 py-2 text-sm font-medium transition ${
              tracked
                ? 'border border-zinc-700 bg-zinc-900 text-zinc-300 hover:bg-zinc-800'
                : 'bg-gradient-to-r from-like-500 to-like-600 text-white shadow-lg shadow-like-500/20'
            }`}
            title={tracked ? 'Tracked — click to untrack' : 'Add to tracked list to follow their activity in your app'}
          >
            {tracked ? '★ Tracked' : '☆ Track'}
          </button>
          <button
            onClick={() => window.tiktok.openProfileInternal(user.uniqueId)}
            className="rounded-lg border border-zinc-800 bg-zinc-900 px-3 py-2 text-xs text-zinc-300 hover:bg-zinc-800"
          >
            Profile
          </button>
          <button
            onClick={() => window.tiktok.openProfile(user.uniqueId)}
            className="rounded-lg border border-zinc-800 bg-zinc-900 px-3 py-2 text-xs text-zinc-300 hover:bg-zinc-800"
            title="Open in default browser"
          >
            Browser ↗
          </button>
          <button
            onClick={async () => {
              if (!confirm('Delete notes for this user?')) return;
              await window.tiktok.notesDelete(user.uniqueId);
              setNote('');
              setSavedAt(null);
            }}
            className="ml-auto rounded-lg px-2 py-2 text-xs text-zinc-500 hover:text-rose-400"
            title="Delete notes"
          >
            ✕
          </button>
        </footer>
      </aside>
    </>
  );
}

function Stat({ label, value, accent }: { label: string; value: string; accent: string }) {
  return (
    <div className="rounded-lg border border-zinc-800/60 bg-zinc-900/40 p-2 text-center">
      <div className={`text-lg font-bold tabular-nums ${accent}`}>{value}</div>
      <div className="text-[10px] uppercase tracking-wider text-zinc-500">{label}</div>
    </div>
  );
}

function describeRecent(e: LiveEvent): string {
  switch (e.type) {
    case 'like':
      return `sent ${e.likeCount} like${e.likeCount > 1 ? 's' : ''}`;
    case 'chat':
      return `"${e.comment}"`;
    case 'gift':
      return `sent ${e.giftName}${e.repeatCount > 1 ? ` ×${e.repeatCount}` : ''}`;
    case 'follow':
      return `followed`;
    case 'share':
      return `shared`;
    case 'subscribe':
      return `subscribed`;
    case 'member':
      return `joined`;
    case 'questionNew':
      return `asked: ${e.question}`;
    case 'envelope':
      return `sent envelope (${e.coins})`;
    case 'emote':
      return `sent an emote`;
    default:
      return e.type;
  }
}

function _markUsed(_: UserNote) {}
_markUsed;
