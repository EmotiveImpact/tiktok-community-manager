/**
 * Tabs — a thin wrapper around Radix Tabs styled with the app's token system,
 * giving real a11y for free: role=tablist / role=tab, roving arrow-key nav,
 * aria-selected, Home/End, and focus management — without changing the look.
 *
 * Two visual variants are supported, matching the two tab looks across the app:
 *
 *   variant="pill"  — the live-feed tab bar (Comments / Gifts / Q&A / Top / All).
 *                     Active tab is a pink-gradient pill (white text); inactive
 *                     tabs are muted text that brightens on hover. Pill height 30px.
 *
 *   variant="segment" — the CRM segment chips (All / Whales / Going cold). Active
 *                     chip is a translucent pink→cyan gradient with a pink hairline
 *                     border (white text); inactive chips are a `--fill-thin`
 *                     surface with a `--separator` border and `--secondary-label`
 *                     text. Chip height 32px.
 *
 * API:
 *   <Tabs value={tab} onValueChange={setTab} variant="pill">
 *     <TabList>
 *       <Tab value="comments" label="Comments" />
 *       <Tab value="gifts" icon={<GiftIcon/>} label="Gifts" badge={3} />
 *       …
 *     </TabList>
 *   </Tabs>
 *
 * Notes for follow-up agents:
 *   - `Tabs` is CONTROLLED: pass `value` + `onValueChange`. Keep your existing
 *     state/shortcut wiring (e.g. keyboard ⌘1-4 still call your `setTab`); the
 *     bar simply reflects `value`.
 *   - This renders ONLY the tab bar (the triggers). The panels stay rendered by
 *     the caller (the app conditionally renders feeds by `value`), so we do NOT
 *     use Radix `<Tabs.Content>` — that keeps existing panel logic untouched.
 *   - `<TabList>` lays out triggers in a flex row with a small gap; wrap it in
 *     your own bar container for borders/padding.
 *   - `icon` renders before the label; `badge` renders a small count pill after.
 */
import * as RadixTabs from '@radix-ui/react-tabs';
import type { ReactNode } from 'react';
import { createContext, useContext } from 'react';

export type TabsVariant = 'pill' | 'segment';

const VariantCtx = createContext<TabsVariant>('pill');

export function Tabs({
  value,
  onValueChange,
  variant = 'pill',
  children,
  className,
}: {
  value: string;
  onValueChange: (value: string) => void;
  variant?: TabsVariant;
  children: ReactNode;
  className?: string;
}) {
  return (
    <VariantCtx.Provider value={variant}>
      <RadixTabs.Root
        value={value}
        onValueChange={onValueChange}
        // The bar is purely the trigger row; panels are rendered by the caller.
        activationMode="automatic"
        className={className}
      >
        {children}
      </RadixTabs.Root>
    </VariantCtx.Provider>
  );
}

export function TabList({ children, className, ariaLabel }: { children: ReactNode; className?: string; ariaLabel?: string }) {
  return (
    <RadixTabs.List aria-label={ariaLabel} className={`flex items-center gap-2 ${className ?? ''}`}>
      {children}
    </RadixTabs.List>
  );
}

export function Tab({
  value,
  label,
  icon,
  badge,
  className,
}: {
  value: string;
  label: ReactNode;
  icon?: ReactNode;
  /** Optional trailing count pill. */
  badge?: ReactNode;
  className?: string;
}) {
  const variant = useContext(VariantCtx);

  if (variant === 'segment') {
    return (
      <RadixTabs.Trigger
        value={value}
        className={`tab-segment group flex h-8 select-none items-center gap-1.5 rounded-full px-3 text-[12px] font-extrabold outline-none transition focus-visible:ring-2 focus-visible:ring-[var(--focus-ring)] ${className ?? ''}`}
      >
        {icon != null && <span className="text-sm">{icon}</span>}
        <span>{label}</span>
        {badge != null && <span className="tab-segment-badge">{badge}</span>}
      </RadixTabs.Trigger>
    );
  }

  // variant === 'pill'
  return (
    <RadixTabs.Trigger
      value={value}
      className={`tab-pill group flex h-[30px] select-none items-center gap-1.5 rounded-full px-3.5 text-xs font-bold outline-none transition focus-visible:ring-2 focus-visible:ring-[var(--focus-ring)] ${className ?? ''}`}
    >
      {icon != null && <span className="text-sm">{icon}</span>}
      <span>{label}</span>
      {badge != null && <span className="tab-pill-badge">{badge}</span>}
    </RadixTabs.Trigger>
  );
}
