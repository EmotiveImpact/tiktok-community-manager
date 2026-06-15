/**
 * Tooltip — a wrapper around Radix Tooltip, styled as a small dark popover with
 * the app's tokens. Replaces bare `title=""` attributes with a focus- and
 * keyboard-accessible tooltip (shows on hover AND keyboard focus, dismisses on
 * Escape / blur).
 *
 * Requires a `TooltipProvider` somewhere above in the tree. We mount one global
 * provider at the app root (src/main.tsx) with delayDuration=300, so individual
 * tooltips need no provider of their own. `TooltipProvider` is re-exported here
 * for completeness / local overrides.
 *
 * API:
 *   <Tooltip content="Copy username">
 *     <button className="panel-btn panel-btn-icon">⧉</button>
 *   </Tooltip>
 *
 *   - The single child is the trigger (rendered `asChild`, so it must be a
 *     single element that forwards ref + props — a DOM element or a
 *     forwardRef component).
 *   - `content` is the tooltip text/nodes. If `content` is null/undefined the
 *     child is returned bare (no tooltip), so it's safe to pass a maybe-empty
 *     label.
 *   - `side` / `align` / `delayDuration` are optional overrides.
 *
 * Visuals: `var(--panel-bg-strong)` surface, `var(--panel-border)` hairline,
 * `--radius-pill`-ish small radius, 11px text, matching arrow. Content is
 * portaled to document.body; tokens cascade from :root through the active
 * `<html data-theme>`, so it themes correctly in light + dark (verified).
 * `.radix-portal` is added as a defensive theming anchor.
 */
import * as RadixTooltip from '@radix-ui/react-tooltip';
import type { ReactElement, ReactNode } from 'react';

export const TooltipProvider = RadixTooltip.Provider;

export function Tooltip({
  content,
  children,
  side = 'top',
  align = 'center',
  sideOffset = 6,
  delayDuration,
}: {
  /** Tooltip body. When null/undefined, no tooltip is attached. */
  content?: ReactNode;
  /** Single trigger element (rendered asChild). */
  children: ReactElement;
  side?: 'top' | 'right' | 'bottom' | 'left';
  align?: 'start' | 'center' | 'end';
  sideOffset?: number;
  /** Override the provider's delay for this tooltip. */
  delayDuration?: number;
}) {
  if (content == null || content === '') return children;

  return (
    <RadixTooltip.Root delayDuration={delayDuration}>
      <RadixTooltip.Trigger asChild>{children}</RadixTooltip.Trigger>
      <RadixTooltip.Portal>
        <RadixTooltip.Content
          side={side}
          align={align}
          sideOffset={sideOffset}
          className="radix-portal z-[95] max-w-[16rem] px-2 py-1 text-[11px] font-medium leading-snug shadow-xl backdrop-blur"
          style={{
            background: 'var(--panel-bg-strong)',
            border: '1px solid var(--panel-border)',
            borderRadius: 8,
            color: 'var(--label)',
          }}
        >
          {content}
          <RadixTooltip.Arrow style={{ fill: 'var(--panel-bg-strong)' }} width={10} height={5} />
        </RadixTooltip.Content>
      </RadixTooltip.Portal>
    </RadixTooltip.Root>
  );
}
