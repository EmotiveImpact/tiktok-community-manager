import { useStore } from '../state/store';
import { useTracked } from '../state/tracked';

export function EmptyState({ onOpenHistory, onOpenTracked }: { onOpenHistory: () => void; onOpenTracked: () => void }) {
  const status = useStore((s) => s.status);
  const errorMessage = useStore((s) => s.errorMessage);
  const trackedCount = useTracked((s) => s.list.length);

  if (status === 'connected') return null;

  const isError = status === 'error';
  const isConnecting = status === 'connecting' || status === 'reconnecting';

  return (
    <div className="flex h-full items-center justify-center overflow-y-auto p-8">
      <div className="max-w-md text-center">
        {isConnecting ? (
          <>
            <img src="./assets/png/icon_heart_3d.png" alt="" className="mx-auto mb-4 h-16 w-16 animate-pulse object-contain" draggable={false} />
            <h3 className="mb-1 text-base font-bold text-zinc-100">Connecting…</h3>
            <p className="text-sm text-zinc-500">Reaching TikTok’s Webcast servers.</p>
          </>
        ) : isError ? (
          <>
            <img src="./assets/png/icon_thank_you_envelope_3d.png" alt="" className="mx-auto mb-4 h-16 w-16 object-contain opacity-90" draggable={false} />
            <h3 className="mb-1 text-base font-bold text-zinc-100">Couldn’t connect</h3>
            <p className="text-sm text-zinc-500">{errorMessage ?? 'Try again, or check the username.'}</p>
            <p className="mt-2 text-[11px] text-zinc-600">
              Most failures are: user isn’t live right now, missing sign API key, or rate-limited handshake.
            </p>
          </>
        ) : (
          <>
            <img
              src="./assets/png/hero_gift_checklist_3d.png"
              alt=""
              className="mx-auto mb-5 h-40 w-40 object-contain drop-shadow-[0_12px_32px_rgba(238,29,82,0.25)]"
              draggable={false}
            />
            <h3 className="mb-1 text-xl font-extrabold text-zinc-100">
              Connect to tonight’s <span className="brand-gradient-text">LIVE</span>
            </h3>
            <p className="mb-6 text-sm text-zinc-500">
              Type a TikTok @username at the top and hit <span className="font-semibold text-like-400">Connect</span> — comments, gifts and likes
              flow in here in real time.
            </p>

            <div className="grid grid-cols-2 gap-2.5 text-left">
              <button
                onClick={onOpenTracked}
                className="glass !rounded-card p-3.5 text-left transition hover:border-like-500/40"
              >
                <div className="mb-1 flex items-center gap-2">
                  <img src="./assets/png/icon_star_award_3d.png" alt="" className="h-6 w-6 object-contain" draggable={false} />
                  <span className="text-sm font-bold text-zinc-100">Tracked Users</span>
                </div>
                <p className="text-[11px] text-zinc-500">{trackedCount} {trackedCount === 1 ? 'person' : 'people'} on your list</p>
              </button>

              <button
                onClick={onOpenHistory}
                className="glass !rounded-card p-3.5 text-left transition hover:border-like-500/40"
              >
                <div className="mb-1 flex items-center gap-2">
                  <img src="./assets/png/icon_clock_3d.png" alt="" className="h-6 w-6 object-contain" draggable={false} />
                  <span className="text-sm font-bold text-zinc-100">Past Sessions</span>
                </div>
                <p className="text-[11px] text-zinc-500">Browse, search, summarize</p>
              </button>
            </div>

            <p className="mt-6 text-[11px] text-zinc-600">
              Tip: <kbd className="rounded bg-zinc-800 px-1.5 py-0.5 font-mono text-[10px] text-zinc-400">⌘K</kbd> opens the command palette.
            </p>
          </>
        )}
      </div>
    </div>
  );
}
