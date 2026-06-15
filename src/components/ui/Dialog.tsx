/**
 * Dialog — a wrapper around Radix Dialog styled to match the app's existing
 * modal/drawer surfaces while replacing the weaker hand-rolled `useDialog`
 * focus-trap. Radix gives us, portaled to document.body:
 *   - a real focus trap + focus restore to the opener,
 *   - scroll-lock on the body,
 *   - background `aria-hidden`/inert,
 *   - Escape-to-close and overlay-click dismissal,
 *   - correct `role="dialog" aria-modal="true"` + labelling.
 *
 * Two variants:
 *   - "center" (default): the `.glass` surface centered, same radius/shadow as
 *     the old ThankComposer / LogGiftModal modals.
 *   - "drawer": a right-side slide-in panel for UserDetailDrawer.
 *
 * Theming: content is portaled, but tokens are declared on :root and the theme
 * lives on <html data-theme>, so `var()`s cascade into the portal automatically
 * (verified in light + dark). `.radix-portal` is added as a defensive anchor.
 *
 * For the centered variant a default header (title + close ✕) is rendered when
 * `title` is given; callers that want full control over the header (e.g. the
 * Command palette, or modals with custom header layout) can omit `title` and
 * render their own, using `<DialogClose>` for the close affordance.
 */
import * as RadixDialog from '@radix-ui/react-dialog';
import type { ReactNode } from 'react';

export const DialogClose = RadixDialog.Close;

export function Dialog({
  open,
  onOpenChange,
  title,
  ariaLabel,
  variant = 'center',
  children,
  className,
  contentStyle,
  width,
  /** Hide the default visual chrome (surface/padding) — caller renders everything. */
  bare = false,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** When set, renders a default header with this title + a close button. */
  title?: ReactNode;
  /** Accessible label when no visible title is rendered. */
  ariaLabel?: string;
  variant?: 'center' | 'drawer';
  children: ReactNode;
  className?: string;
  contentStyle?: React.CSSProperties;
  /** Surface width (e.g. 420). Ignored for drawer (fixed 420px).*/
  width?: number;
  bare?: boolean;
}) {
  const isDrawer = variant === 'drawer';

  const baseContent =
    isDrawer
      ? 'animate-slide-in fixed right-0 top-0 z-[90] flex h-screen w-[420px] flex-col shadow-2xl backdrop-blur'
      : 'fixed left-1/2 top-1/2 z-[90] -translate-x-1/2 -translate-y-1/2 shadow-2xl';

  const surfaceClass = bare ? '' : isDrawer ? '' : 'glass';

  const surfaceStyle: React.CSSProperties = bare
    ? {}
    : isDrawer
      ? {
          background: 'var(--panel-bg-strong)',
          borderLeft: '1px solid var(--panel-border)',
        }
      : { borderRadius: 'var(--radius-card)', padding: 20, width: width ?? 420, maxWidth: '90vw' };

  return (
    <RadixDialog.Root open={open} onOpenChange={onOpenChange}>
      <RadixDialog.Portal>
        <RadixDialog.Overlay className="radix-portal fixed inset-0 z-[80] bg-black/50 backdrop-blur-sm" />
        <RadixDialog.Content
          aria-label={ariaLabel}
          className={`radix-portal no-drag ${baseContent} ${surfaceClass} ${className ?? ''}`}
          style={{ ...surfaceStyle, ...contentStyle }}
          onOpenAutoFocus={(e) => {
            // For the centered modals we keep Radix's default first-focusable
            // behavior; nothing to override here. Kept as a hook for callers.
            void e;
          }}
        >
          {title != null && (
            <div className="mb-3 flex items-center justify-between">
              <RadixDialog.Title className="text-base font-extrabold">{title}</RadixDialog.Title>
              <RadixDialog.Close asChild>
                <button className="panel-btn panel-btn-icon no-drag" aria-label="Close">
                  ✕
                </button>
              </RadixDialog.Close>
            </div>
          )}
          {ariaLabel && title == null && (
            <RadixDialog.Title className="sr-only">{ariaLabel}</RadixDialog.Title>
          )}
          {children}
        </RadixDialog.Content>
      </RadixDialog.Portal>
    </RadixDialog.Root>
  );
}
