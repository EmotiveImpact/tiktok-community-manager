/**
 * Switch — a wrapper around Radix Switch styled as a pink (brand) toggle for
 * Settings (notifyOnGoLive, earnings enabled, AI consent, etc.). Replaces bare
 * `<input type="checkbox">` with a proper `role="switch"` control that is
 * keyboard-operable (Space/Enter) and announces checked state.
 *
 * API:
 *   <Switch checked={notify} onCheckedChange={setNotify} label="Notify on go-live" />
 *   <Switch checked={enabled} onCheckedChange={setEnabled} ariaLabel="Earnings tracking" />
 *
 *   - `checked` + `onCheckedChange` — controlled (onCheckedChange gives a boolean).
 *   - `label` — optional visible text rendered after the track; clicking it
 *     toggles (wrapped in a <label>). When you render your own label elsewhere,
 *     omit `label` and pass `ariaLabel` instead so the control is still named.
 *   - `disabled` — dims + blocks interaction.
 *
 * Visuals: 36×20 track, `--separator`/`--fill` when off, `--gradient-pink` (brand)
 * when on; 16px white thumb that slides. Works in light + dark via tokens.
 */
import * as RadixSwitch from '@radix-ui/react-switch';
import type { ReactNode } from 'react';

export function Switch({
  checked,
  onCheckedChange,
  label,
  ariaLabel,
  disabled,
  className,
}: {
  checked: boolean;
  onCheckedChange: (checked: boolean) => void;
  /** Optional visible label rendered after the track (also acts as click target). */
  label?: ReactNode;
  /** Accessible name when no visible `label` is rendered. */
  ariaLabel?: string;
  disabled?: boolean;
  className?: string;
}) {
  const control = (
    <RadixSwitch.Root
      checked={checked}
      onCheckedChange={onCheckedChange}
      disabled={disabled}
      aria-label={label == null ? ariaLabel : undefined}
      className="brand-switch"
    >
      <RadixSwitch.Thumb className="brand-switch-thumb" />
    </RadixSwitch.Root>
  );

  if (label == null) {
    return <span className={className}>{control}</span>;
  }

  return (
    <label className={`inline-flex cursor-pointer select-none items-center gap-2 ${disabled ? 'opacity-50' : ''} ${className ?? ''}`}>
      {control}
      <span className="text-[13px]">{label}</span>
    </label>
  );
}
