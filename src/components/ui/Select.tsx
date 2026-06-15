/**
 * Select — a wrapper around Radix Select styled to match the app's native
 * selects (range 7d/30d/90d/All, tier filter, currency, etc.). Gives full
 * listbox a11y + keyboard (type-ahead, arrow keys, Home/End, Escape) that a
 * styled `<div>` menu can't, while looking like the app's `.native-input`.
 *
 * Two ways to supply options — use whichever is cleaner at the call site:
 *
 *   1) Children — explicit items (lets you add icons / custom labels):
 *        <Select value={range} onValueChange={setRange} ariaLabel="Time range">
 *          <SelectItem value="7d" label="7 days" />
 *          <SelectItem value="30d" label="30 days" />
 *          <SelectItem value="all" label="All time" />
 *        </Select>
 *
 *   2) options array — convenience for plain value/label lists:
 *        <Select
 *          value={currency}
 *          onValueChange={setCurrency}
 *          ariaLabel="Currency"
 *          options={[{ value: '£', label: '£ GBP' }, { value: '$', label: '$ USD' }]}
 *        />
 *
 * API: <Select value onValueChange ariaLabel placeholder? disabled? className?
 *              triggerStyle? options? children? />
 *   - `ariaLabel` is required for accessibility (the trigger has no visible
 *     <label> in most call sites).
 *   - `className` is applied to the trigger; defaults to `.native-input`-like
 *     sizing. Use it to widen, e.g. `className="!w-32"`.
 *
 * Visuals: trigger mirrors `.native-input` (height 24, `--fill-thin`,
 * `--separator` border, focus ring) with a chevron. The dropdown is a portaled
 * `var(--panel-bg-strong)` surface (like Menu) with a leading check on the
 * selected row. Portaled to body; tokens cascade via `<html data-theme>`
 * (verified light + dark). `.radix-portal` anchors theming.
 */
import * as RadixSelect from '@radix-ui/react-select';
import type { ReactNode } from 'react';

export type SelectOption = { value: string; label: ReactNode };

export function Select({
  value,
  onValueChange,
  ariaLabel,
  placeholder,
  options,
  children,
  disabled,
  className,
  triggerStyle,
}: {
  value: string;
  onValueChange: (value: string) => void;
  /** Required for a11y — names the control for screen readers. */
  ariaLabel: string;
  placeholder?: string;
  /** Convenience: render items from a value/label array. */
  options?: SelectOption[];
  /** Or supply <SelectItem> children directly (takes precedence if both given). */
  children?: ReactNode;
  disabled?: boolean;
  className?: string;
  triggerStyle?: React.CSSProperties;
}) {
  return (
    <RadixSelect.Root value={value} onValueChange={onValueChange} disabled={disabled}>
      <RadixSelect.Trigger
        aria-label={ariaLabel}
        className={`select-trigger inline-flex h-6 items-center justify-between gap-1.5 ${className ?? ''}`}
        style={triggerStyle}
      >
        <RadixSelect.Value placeholder={placeholder} />
        <RadixSelect.Icon aria-hidden style={{ color: 'var(--tertiary-label)' }}>▾</RadixSelect.Icon>
      </RadixSelect.Trigger>
      <RadixSelect.Portal>
        <RadixSelect.Content
          position="popper"
          sideOffset={6}
          className="radix-portal z-[85] overflow-hidden py-1.5 shadow-2xl backdrop-blur"
          style={{
            background: 'var(--panel-bg-strong)',
            border: '1px solid var(--panel-border)',
            borderRadius: 'var(--radius-card)',
            color: 'var(--label)',
            minWidth: 'var(--radix-select-trigger-width)',
          }}
        >
          <RadixSelect.Viewport className="max-h-[18rem]">
            {children ?? options?.map((o) => <SelectItem key={o.value} value={o.value} label={o.label} />)}
          </RadixSelect.Viewport>
        </RadixSelect.Content>
      </RadixSelect.Portal>
    </RadixSelect.Root>
  );
}

export function SelectItem({ value, label, disabled }: { value: string; label: ReactNode; disabled?: boolean }) {
  return (
    <RadixSelect.Item
      value={value}
      disabled={disabled}
      className="select-item flex cursor-pointer select-none items-center gap-2 px-3 py-1.5 pr-7 text-xs outline-none data-[highlighted]:bg-[var(--fill)] data-[disabled]:opacity-40"
    >
      <RadixSelect.ItemIndicator className="absolute right-2.5 inline-flex" style={{ color: 'var(--accent, var(--brand-pink))' }}>
        ✓
      </RadixSelect.ItemIndicator>
      <RadixSelect.ItemText>{label}</RadixSelect.ItemText>
    </RadixSelect.Item>
  );
}
