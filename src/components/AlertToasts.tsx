import { useAlerts } from '../state/alerts';

export function AlertToasts() {
  const toasts = useAlerts((s) => s.toasts);
  const rules = useAlerts((s) => s.rules);
  const dismiss = useAlerts((s) => s.dismissToast);

  if (toasts.length === 0) return null;

  const ACCENT: Record<string, string> = {
    keyword: 'border-l-like-500',
    gift_diamonds: 'border-l-amber-400',
    gift_name: 'border-l-amber-400',
    follower: 'border-l-cyan-400',
    viewer_threshold: 'border-l-emerald-400',
  };

  return (
    <div className="fixed bottom-4 left-4 z-40 flex flex-col gap-2 w-80">
      {toasts.slice(0, 5).map((t) => {
        const rule = rules.find((r) => r.id === t.ruleId);
        const accent = ACCENT[rule?.type ?? ''] ?? 'border-l-like-500';
        return (
        <div
          key={t.id}
          className={`animate-toast-in rounded-lg border-l-[3px] ${accent} px-4 py-3 shadow-lg backdrop-blur`}
          style={{ background: 'rgba(9,9,11,0.95)' }}
        >
          <div className="flex items-start justify-between gap-2">
            <div className="min-w-0 flex-1">
              <div className="text-[11px] font-semibold text-like-400">{t.title}</div>
              <div className="mt-0.5 truncate text-sm text-zinc-200">{t.body}</div>
            </div>
            <button
              onClick={() => dismiss(t.id)}
              className="flex-none text-xs text-zinc-500 hover:text-zinc-300"
            >
              ✕
            </button>
          </div>
        </div>
        );
      })}
    </div>
  );
}
