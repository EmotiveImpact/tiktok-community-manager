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
    <div className="flex h-full items-center justify-center p-8">
      <div className="max-w-md text-center">
        <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-2xl bg-gradient-to-br from-like-500/20 to-purple-500/10">
          <svg className="h-8 w-8 text-like-400" fill="currentColor" viewBox="0 0 24 24">
            <path d="M12 21.35l-1.45-1.32C5.4 15.36 2 12.28 2 8.5 2 5.42 4.42 3 7.5 3c1.74 0 3.41.81 4.5 2.09C13.09 3.81 14.76 3 16.5 3 19.58 3 22 5.42 22 8.5c0 3.78-3.4 6.86-8.55 11.54L12 21.35z" />
          </svg>
        </div>

        {isConnecting ? (
          <>
            <h3 className="mb-1 text-base font-bold text-zinc-100">Connecting…</h3>
            <p className="text-sm text-zinc-500">Reaching TikTok’s Webcast servers.</p>
          </>
        ) : isError ? (
          <>
            <h3 className="mb-1 text-base font-bold text-zinc-100">Couldn’t connect</h3>
            <p className="text-sm text-zinc-500">{errorMessage ?? 'Try again, or check the username.'}</p>
            <p className="mt-2 text-[11px] text-zinc-600">
              Most failures are: user isn’t live right now, missing sign API key, or rate-limited handshake.
            </p>
          </>
        ) : (
          <>
            <h3 className="mb-1 text-base font-bold text-zinc-100">Ready to go</h3>
            <p className="mb-6 text-sm text-zinc-500">
              Type a TikTok @username at the top and hit <span className="text-zinc-300">Connect</span> to start watching their live stream in real time.
            </p>

            <div className="grid grid-cols-2 gap-2 text-left">
              <button
                onClick={onOpenTracked}
                className="rounded-xl border border-zinc-800/60 bg-zinc-900/40 p-3 transition hover:border-like-500/30 hover:bg-zinc-900"
              >
                <div className="mb-1 flex items-center gap-2">
                  <span className="text-amber-400">★</span>
                  <span className="text-sm font-semibold text-zinc-200">Tracked Users</span>
                </div>
                <p className="text-[11px] text-zinc-500">{trackedCount} {trackedCount === 1 ? 'person' : 'people'} on your list</p>
              </button>

              <button
                onClick={onOpenHistory}
                className="rounded-xl border border-zinc-800/60 bg-zinc-900/40 p-3 transition hover:border-like-500/30 hover:bg-zinc-900"
              >
                <div className="mb-1 flex items-center gap-2">
                  <svg className="h-3.5 w-3.5 text-zinc-400" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
                    <circle cx="12" cy="12" r="10" /><polyline points="12 6 12 12 16 14" />
                  </svg>
                  <span className="text-sm font-semibold text-zinc-200">Past Sessions</span>
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
