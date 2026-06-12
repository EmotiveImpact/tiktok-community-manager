/** Shared building blocks for the CRM pages (Followers / Gifts / Reminders / Import / Settings). */
import { useState, type ReactNode } from 'react';
import { avatarGradient } from '../lib/avatars';
import { tierClass } from '../lib/tier';
import type { Fan } from '../types';

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
