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
    <header className="no-drag flex h-11 flex-none items-center gap-2 overflow-hidden border-b border-zinc-800 bg-zinc-950/85 pl-[78px] pr-3 backdrop-blur">
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

export function PanelShell({ children }: { children: ReactNode }) {
  return <div className="no-drag fixed inset-0 z-40 flex flex-col bg-zinc-950">{children}</div>;
}
