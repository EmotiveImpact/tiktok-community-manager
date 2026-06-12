import type { ReactNode } from 'react';

export function PanelHeader({
  title,
  subtitle,
  badge,
  onClose,
  children,
  actions,
}: {
  title: string;
  subtitle?: string;
  badge?: string | number;
  onClose: () => void;
  children?: ReactNode;
  actions?: ReactNode;
}) {
  return (
    <header className="no-drag flex h-11 flex-none items-center gap-2 overflow-hidden border-b border-zinc-800/50 pl-3 pr-3">
      <div className="flex flex-none items-center gap-2">
        <h2 className="whitespace-nowrap text-sm font-bold text-zinc-100">{title}</h2>
        {badge !== undefined && (
          <span className="flex-none rounded-md bg-zinc-800 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-zinc-400">
            {badge}
          </span>
        )}
      </div>
      {subtitle && <span className="min-w-0 truncate text-xs text-zinc-500">{subtitle}</span>}
      {children && <div className="flex flex-none items-center gap-2">{children}</div>}
      <div className="ml-auto flex flex-none items-center gap-1.5">
        {actions}
        <button
          onClick={onClose}
          className="panel-btn panel-btn-secondary"
        >
          Close
        </button>
      </div>
    </header>
  );
}

/**
 * Tool panel surface. Previously a fixed full-screen overlay; now an in-content
 * card that fills the live page's content slot, so the sidebar and the
 * StreamPlayer / Fan Memory columns stay visible around it.
 */
export function PanelShell({ children }: { children: ReactNode }) {
  return (
    <section className="glass no-drag flex min-w-0 flex-1 flex-col overflow-hidden rounded-xl">
      {children}
    </section>
  );
}
