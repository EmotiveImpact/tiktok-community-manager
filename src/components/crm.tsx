/** Shared building blocks for the CRM pages (Followers / Gifts / Reminders / Import / Settings). */
import { useState, type ReactNode } from 'react';
import { avatarGradient } from '../lib/avatars';
import { tierClass } from '../lib/tier';
import type { Fan, Temperature } from '../types';

export function FanAvatar({ name, url, size = 32 }: { name: string; url?: string | null; size?: number }) {
  if (url) {
    return <img src={url} alt="" className="flex-none rounded-full object-cover" style={{ width: size, height: size }} />;
  }
  return (
    <span
      className={`flex flex-none items-center justify-center rounded-full font-bold text-white ${avatarGradient(name)}`}
      style={{ width: size, height: size, fontSize: size * 0.4 }}
    >
      {(name.replace(/^@/, '')[0] || '?').toUpperCase()}
    </span>
  );
}

export function TierChip({ tier }: { tier: string }) {
  return <span className={tierClass(tier)}>{tier}</span>;
}

export function TagChip({ tag, onRemove }: { tag: string; onRemove?: () => void }) {
  return (
    <span
      className="inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-semibold"
      style={{ background: 'var(--fill-thin)', color: 'var(--secondary-label)', border: '1px solid var(--card-border)' }}
    >
      {tag}
      {onRemove && (
        <button onClick={onRemove} className="leading-none hover:opacity-70" aria-label={`Remove tag ${tag}`}>×</button>
      )}
    </span>
  );
}

export function fanName(f: Fan): string {
  return f.displayName || f.nickname || f.uniqueId;
}

/** Solid color for a strength score: green ≥75 / light-green 50-74 / orange 25-49 / red <25. */
export function strengthColor(score: number): string {
  if (score >= 75) return 'var(--green)';
  if (score >= 50) return '#79f2a8';
  if (score >= 25) return 'var(--orange)';
  return 'var(--red)';
}

/**
 * Thin rounded relationship-strength bar (0–100). Fill is the brand
 * green→orange→red gradient clipped to the score (matches the CRM mockups),
 * with an optional numeric label on the right.
 */
export function StrengthBar({
  score,
  width,
  label = false,
  barWidth,
  height = 8,
}: {
  score: number;
  /** total width of the bar+label group (CSS length); defaults to fluid */
  width?: number | string;
  /** show the numeric "NN" score after the bar */
  label?: boolean;
  /** fixed track width (CSS length); when unset the track flexes to fill */
  barWidth?: number | string;
  height?: number;
}) {
  const pct = Math.max(0, Math.min(100, Math.round(score)));
  return (
    <span
      className="inline-flex items-center gap-2.5"
      style={{ width }}
      role="meter"
      aria-valuenow={pct}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-label={`Relationship strength ${pct} of 100`}
    >
      <span
        className="overflow-hidden rounded-full"
        style={{
          flex: barWidth ? '0 0 auto' : '1 1 auto',
          width: barWidth,
          height,
          background: 'var(--fill-thin)',
          boxShadow: 'inset 0 0 0 1px rgba(255,255,255,.07)',
        }}
      >
        <span
          className="block h-full rounded-full"
          style={{
            width: `${pct}%`,
            background: 'linear-gradient(90deg, var(--green), var(--orange), var(--red))',
          }}
        />
      </span>
      {label && (
        <span className="flex-none text-[13px] tabular-nums" style={{ fontWeight: 900 }}>{pct}</span>
      )}
    </span>
  );
}

const TEMP_META: Record<Temperature, { color: string; glow: string; label: string }> = {
  hot: { color: 'var(--green)', glow: 'rgba(121,242,168,.55)', label: 'hot' },
  warm: { color: 'var(--cyan)', glow: 'rgba(105,201,208,.5)', label: 'warm' },
  cooling: { color: 'var(--orange)', glow: 'rgba(255,179,92,.55)', label: 'cooling' },
  cold: { color: 'var(--red)', glow: 'rgba(255,101,120,.55)', label: 'cold' },
};

/** A glowing temperature dot (hot/warm/cooling/cold) with an optional label. */
export function TemperatureDot({ temperature, label = false, size = 10 }: { temperature: Temperature; label?: boolean; size?: number }) {
  const m = TEMP_META[temperature] ?? TEMP_META.cold;
  return (
    <span className="inline-flex items-center gap-2 text-[12px]" style={{ fontWeight: 800 }} title={m.label}>
      <span
        className="flex-none rounded-full"
        style={{ width: size, height: size, background: m.color, boxShadow: `0 0 14px ${m.glow}` }}
      />
      {label && <span style={{ color: 'var(--label)' }}>{m.label}</span>}
    </span>
  );
}

export function Pager({ page, pageSize, total, onPage }: { page: number; pageSize: number; total: number; onPage: (p: number) => void }) {
  const pages = Math.max(1, Math.ceil(total / pageSize));
  if (pages <= 1) return null;
  return (
    <div className="flex items-center justify-between pt-3 text-[12px]" style={{ color: 'var(--secondary-label)' }}>
      <span>
        {(page - 1) * pageSize + 1}–{Math.min(page * pageSize, total)} of {total}
      </span>
      <span className="flex items-center gap-1.5">
        <button disabled={page <= 1} onClick={() => onPage(page - 1)} className="panel-btn no-drag">← Prev</button>
        <span className="px-1 font-semibold">{page} / {pages}</span>
        <button disabled={page >= pages} onClick={() => onPage(page + 1)} className="panel-btn no-drag">Next →</button>
      </span>
    </div>
  );
}

export function PageShell({ title, subtitle, actions, children }: { title: string; subtitle?: string; actions?: ReactNode; children: ReactNode }) {
  return (
    <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto p-5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-xl font-extrabold tracking-tight">{title}</h1>
          {subtitle && <p className="text-[13px]" style={{ color: 'var(--secondary-label)' }}>{subtitle}</p>}
        </div>
        {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
      </div>
      {children}
    </div>
  );
}

export function FieldLabel({ children }: { children: ReactNode }) {
  return <label className="mb-1 block text-[11px] font-semibold uppercase tracking-wider" style={{ color: 'var(--secondary-label)' }}>{children}</label>;
}

export const inputCls =
  'w-full rounded-lg border border-zinc-700/60 bg-transparent px-3 py-1.5 text-[13px] outline-none transition focus:border-pink-500/60';

/** Tags editor: chips + free text entry (Enter or comma to add). */
export function TagsEditor({ tags, onChange, suggestions = [] }: { tags: string[]; onChange: (tags: string[]) => void; suggestions?: string[] }) {
  const [draft, setDraft] = useState('');
  const add = (raw: string) => {
    const t = raw.trim().replace(/,+$/, '');
    if (!t) return;
    if (!tags.some((x) => x.toLowerCase() === t.toLowerCase())) onChange([...tags, t]);
    setDraft('');
  };
  return (
    <div>
      <div className="flex flex-wrap items-center gap-1.5">
        {tags.map((t) => (
          <TagChip key={t} tag={t} onRemove={() => onChange(tags.filter((x) => x !== t))} />
        ))}
        <input
          value={draft}
          onChange={(e) => {
            if (e.target.value.endsWith(',')) add(e.target.value);
            else setDraft(e.target.value);
          }}
          onKeyDown={(e) => {
            if (e.key === 'Enter') { e.preventDefault(); add(draft); }
            if (e.key === 'Backspace' && !draft && tags.length) onChange(tags.slice(0, -1));
          }}
          placeholder={tags.length ? 'Add tag…' : 'Add tags (Enter to add)…'}
          className="min-w-[110px] flex-1 rounded-lg border border-transparent bg-transparent px-1 py-0.5 text-[12px] outline-none focus:border-zinc-700/60"
          list="crm-tag-suggestions"
        />
      </div>
      {suggestions.length > 0 && (
        <datalist id="crm-tag-suggestions">
          {suggestions.map((s) => <option key={s} value={s} />)}
        </datalist>
      )}
    </div>
  );
}

/** Birthday MM-DD input with light validation feedback. */
export function birthdayValid(v: string): boolean {
  if (!v) return true;
  const m = v.match(/^(\d{2})-(\d{2})$/);
  if (!m) return false;
  const month = Number(m[1]), d = Number(m[2]);
  return month >= 1 && month <= 12 && d >= 1 && d <= 31;
}
