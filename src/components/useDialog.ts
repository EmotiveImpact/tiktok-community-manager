import { useEffect, useRef } from 'react';

const FOCUSABLE =
  'a[href], button:not([disabled]), textarea:not([disabled]), input:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])';

function focusableWithin(root: HTMLElement): HTMLElement[] {
  return Array.from(root.querySelectorAll<HTMLElement>(FOCUSABLE)).filter(
    (el) => el.offsetParent !== null || el === document.activeElement,
  );
}

/**
 * Accessible-dialog plumbing shared by the app's modals/drawers.
 *
 * - Focuses the first focusable control on open.
 * - Restores focus to whatever was focused before open, on unmount.
 * - Keeps Tab / Shift+Tab cycling inside the dialog (focus trap).
 * - Closes on Escape.
 *
 * Spread `dialogProps` onto the dialog container and attach `ref` to it.
 * Pair with `role="dialog" aria-modal="true"` and an aria-label/labelledby.
 *
 * `active` lets always-mounted dialogs (drawers that render null when closed)
 * arm the trap only while open; per-open-mounted modals can leave it default.
 */
export function useDialog<T extends HTMLElement = HTMLDivElement>(
  onClose: () => void,
  active = true,
) {
  const ref = useRef<T | null>(null);
  // Capture the onClose without re-running the trap effect when it changes.
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  useEffect(() => {
    if (!active) return;
    const node = ref.current;
    const previouslyFocused = document.activeElement as HTMLElement | null;

    // Focus the first control (fall back to the dialog itself).
    const first = node ? focusableWithin(node)[0] : null;
    if (first) first.focus();
    else node?.focus();

    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        onCloseRef.current();
        return;
      }
      if (e.key !== 'Tab' || !node) return;
      const items = focusableWithin(node);
      if (items.length === 0) {
        e.preventDefault();
        node.focus();
        return;
      }
      const firstEl = items[0];
      const lastEl = items[items.length - 1];
      const active = document.activeElement;
      if (e.shiftKey) {
        if (active === firstEl || !node.contains(active)) {
          e.preventDefault();
          lastEl.focus();
        }
      } else if (active === lastEl || !node.contains(active)) {
        e.preventDefault();
        firstEl.focus();
      }
    };

    document.addEventListener('keydown', onKeyDown, true);
    return () => {
      document.removeEventListener('keydown', onKeyDown, true);
      // Restore focus to the element that opened the dialog.
      previouslyFocused?.focus?.();
    };
  }, [active]);

  return { ref, dialogProps: { tabIndex: -1 as const } };
}
