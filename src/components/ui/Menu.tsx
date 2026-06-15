/**
 * Menu — a thin wrapper around Radix DropdownMenu, styled with the app's
 * existing CSS-var token system so it looks identical to the previous
 * hand-rolled dropdowns while gaining real a11y for free:
 *   role=menu / role=menuitem, arrow-key navigation, type-ahead, focus
 *   return to the trigger, Escape-to-close and outside-click dismissal.
 *
 * Visuals match the old menus: a `var(--panel-bg-strong)` surface with a
 * `var(--panel-border)` hairline, `--radius-card` corners and a soft shadow;
 * items hover to `var(--fill)` (the token equivalent of the old
 * `hover:bg-zinc-800/80` rows). Content is portaled to document.body — since
 * `data-theme` lives on <html> and the tokens are declared on :root, the
 * portaled surface inherits the active theme automatically (verified light +
 * dark). A wrapping `.radix-portal` class is added defensively as a theming
 * anchor.
 */
import * as DropdownMenu from '@radix-ui/react-dropdown-menu';
import type { ReactNode } from 'react';

export function Menu({
  trigger,
  children,
  align = 'end',
  sideOffset = 6,
  contentClassName,
  contentStyle,
}: {
  /** The trigger element. Caller styles it (e.g. with `.panel-btn` / ToolbarBtn). */
  trigger: ReactNode;
  children: ReactNode;
  align?: 'start' | 'center' | 'end';
  sideOffset?: number;
  /** Extra classes for the content surface (e.g. width). */
  contentClassName?: string;
  contentStyle?: React.CSSProperties;
}) {
  return (
    <DropdownMenu.Root>
      <DropdownMenu.Trigger asChild>{trigger}</DropdownMenu.Trigger>
      <DropdownMenu.Portal>
        <DropdownMenu.Content
          align={align}
          sideOffset={sideOffset}
          className={`radix-portal z-[80] min-w-[10rem] overflow-hidden py-1.5 shadow-2xl backdrop-blur ${contentClassName ?? ''}`}
          style={{
            background: 'var(--panel-bg-strong)',
            border: '1px solid var(--panel-border)',
            borderRadius: 'var(--radius-card)',
            color: 'var(--label)',
            ...contentStyle,
          }}
        >
          {children}
        </DropdownMenu.Content>
      </DropdownMenu.Portal>
    </DropdownMenu.Root>
  );
}

export function MenuItem({
  onSelect,
  icon,
  label,
  active,
  className,
}: {
  onSelect: () => void;
  icon?: ReactNode;
  /** Item content. Can be a string or rich nodes. */
  label: ReactNode;
  /** Renders the "selected" state (bold accent + trailing check). */
  active?: boolean;
  className?: string;
}) {
  return (
    <DropdownMenu.Item
      onSelect={(e) => {
        // Keep the menu's own close behavior; just run the action.
        e.preventDefault?.();
        onSelect();
      }}
      className={`menu-item flex w-full cursor-pointer select-none items-center gap-2 px-3 py-1.5 text-left text-xs outline-none data-[highlighted]:bg-[var(--fill)] ${
        active ? 'font-bold' : ''
      } ${className ?? ''}`}
      style={{ color: active ? 'var(--accent, var(--brand-pink))' : 'var(--label)' }}
    >
      {icon != null && <span className="text-sm">{icon}</span>}
      <span className="flex-1 truncate">{label}</span>
      {active && <span aria-hidden>✓</span>}
    </DropdownMenu.Item>
  );
}

export function MenuGroup({ label, children, first }: { label?: string; children: ReactNode; first?: boolean }) {
  return (
    <DropdownMenu.Group className={first ? '' : 'mt-1.5 pt-1.5'} style={first ? undefined : { borderTop: '1px solid var(--panel-border)' }}>
      {label && (
        <DropdownMenu.Label className="px-3 py-1 text-[10px] font-semibold uppercase tracking-wider" style={{ color: 'var(--secondary-label)' }}>
          {label}
        </DropdownMenu.Label>
      )}
      {children}
    </DropdownMenu.Group>
  );
}

export function MenuSeparator() {
  return <DropdownMenu.Separator className="my-1" style={{ height: 1, background: 'var(--panel-border)' }} />;
}
