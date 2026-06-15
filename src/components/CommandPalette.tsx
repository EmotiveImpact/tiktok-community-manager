/**
 * ⌘K Command Palette — the global "jump to anyone / anywhere" surface.
 *
 * Open-state is lifted to the UI store (`commandOpen` / `setCommandOpen`) so the
 * global ⌘K handler and any surface can toggle it. App renders it whenever
 * `commandOpen` is true.
 *
 * Two result modes share one roving-keyboard list:
 *   1. FAN LEDGER SEARCH (primary) — as you type, we debounce-query the CRM
 *      `fansList({ search, pageSize: 8 })` and show fan rows (avatar, name,
 *      @handle, tier, strength). This is the global "glance at any fan" entry:
 *        · Enter            → openFanPeek(uniqueId)   (the lightweight drawer)
 *        · ⌘/Ctrl + Enter   → openFanProfile(uniqueId)(escalate to the full 360)
 *   2. COMMANDS — page navigation (Dashboard/Followers/Gifts/…) plus, when live,
 *      the live-tool/tab commands. Passed in by App via the `commands` prop and
 *      filtered by the same query.
 *
 * Fan rows rank first (you're usually looking for a person); commands follow.
 * The fan query is debounced (~150ms) and never refetched per render.
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import { useUI } from '../state/ui';
import { Dialog } from './ui/Dialog';
import { FanAvatar, TierChip, StrengthBar } from './crm';
import type { Fan } from '../types';

export type Command = {
  id: string;
  label: string;
  hint?: string;
  group: string;
  icon?: string;
  run: () => void;
};

/** A unified row in the roving list: either a fan or a command. */
type Row =
  | { kind: 'fan'; id: string; fan: Fan }
  | { kind: 'command'; id: string; cmd: Command };

export function CommandPalette({ commands, onClose }: { commands: Command[]; onClose: () => void }) {
  const [query, setQuery] = useState('');
  const [activeIdx, setActiveIdx] = useState(0);
  const [fans, setFans] = useState<Fan[]>([]);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const listRef = useRef<HTMLDivElement | null>(null);

  const openFanPeek = useUI((s) => s.openFanPeek);
  const openFanProfile = useUI((s) => s.openFanProfile);

  useEffect(() => { inputRef.current?.focus(); }, []);

  // ── Debounced fan-ledger search (~150ms). Fetches on query change only, never
  //    per keystroke render; fail-safe so a CRM read can't break the palette. ──
  useEffect(() => {
    const q = query.trim();
    if (!q) { setFans([]); return; }
    let alive = true;
    const t = setTimeout(() => {
      window.tiktok.fansList({ search: q, pageSize: 8 })
        .then((r) => { if (alive) setFans(r.data); })
        .catch(() => { if (alive) setFans([]); });
    }, 150);
    return () => { alive = false; clearTimeout(t); };
  }, [query]);

  // Commands matching the query (or all when empty).
  const matchedCommands = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return commands;
    return commands.filter((c) => c.label.toLowerCase().includes(q) || c.hint?.toLowerCase().includes(q));
  }, [commands, query]);

  // Flat roving list: fans first, then commands.
  const rows = useMemo<Row[]>(() => [
    ...fans.map((f): Row => ({ kind: 'fan', id: `fan:${f.uniqueId}`, fan: f })),
    ...matchedCommands.map((c): Row => ({ kind: 'command', id: c.id, cmd: c })),
  ], [fans, matchedCommands]);

  useEffect(() => { setActiveIdx(0); }, [query]);
  useEffect(() => {
    const item = listRef.current?.querySelector<HTMLElement>(`[data-row="${activeIdx}"]`);
    if (item) item.scrollIntoView({ block: 'nearest' });
  }, [activeIdx]);

  const runRow = (row: Row | undefined, mod: boolean) => {
    if (!row) return;
    if (row.kind === 'fan') {
      // Enter → peek (glance); ⌘/Ctrl+Enter → escalate straight to the 360.
      if (mod) openFanProfile(row.fan.uniqueId);
      else openFanPeek(row.fan.uniqueId);
      onClose();
    } else {
      row.cmd.run();
      onClose();
    }
  };

  const handleKey = (e: React.KeyboardEvent) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setActiveIdx((i) => Math.min(i + 1, rows.length - 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setActiveIdx((i) => Math.max(i - 1, 0));
    } else if (e.key === 'Enter') {
      e.preventDefault();
      runRow(rows[activeIdx], e.metaKey || e.ctrlKey);
    } else if (e.key === 'Escape') {
      e.preventDefault();
      onClose();
    }
  };

  // Group commands (fans render as their own section above commands).
  const commandGroups = useMemo(() => {
    const map = new Map<string, { row: Row; idx: number }[]>();
    rows.forEach((row, idx) => {
      if (row.kind !== 'command') return;
      const arr = map.get(row.cmd.group) ?? [];
      arr.push({ row, idx });
      map.set(row.cmd.group, arr);
    });
    return map;
  }, [rows]);

  const fanRows = rows
    .map((row, idx) => ({ row, idx }))
    .filter((x): x is { row: Extract<Row, { kind: 'fan' }>; idx: number } => x.row.kind === 'fan');

  return (
    <Dialog
      open
      onOpenChange={(o) => { if (!o) onClose(); }}
      ariaLabel="Command palette"
      bare
      className="left-1/2 top-[14vh] w-[640px] max-w-[92vw] -translate-x-1/2 overflow-hidden rounded-xl border shadow-2xl"
      contentStyle={{ borderColor: 'var(--panel-border)', background: 'var(--panel-bg-strong)' }}
    >
      <div className="flex items-center gap-2 border-b px-4 py-3" style={{ borderColor: 'var(--panel-border)' }}>
        <span style={{ color: 'var(--tertiary-label)' }}>⌘K</span>
        <input
          ref={inputRef}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={handleKey}
          placeholder="Search fans, jump to a page…"
          className="flex-1 bg-transparent text-sm outline-none placeholder:text-[color:var(--tertiary-label)]"
          style={{ color: 'var(--label)' }}
        />
        {query && (
          <button onClick={() => setQuery('')} className="text-xs transition hover:opacity-70" style={{ color: 'var(--secondary-label)' }}>Clear</button>
        )}
      </div>

      <div ref={listRef} className="max-h-[60vh] overflow-y-auto p-1">
        {rows.length === 0 ? (
          <div className="py-12 text-center text-sm" style={{ color: 'var(--tertiary-label)' }}>
            {query.trim() ? 'No fans or commands match' : 'Type a name to find any fan'}
          </div>
        ) : (
          <>
            {fanRows.length > 0 && (
              <div>
                <div className="px-3 pb-1 pt-3 text-[10px] font-semibold uppercase tracking-wider" style={{ color: 'var(--tertiary-label)' }}>Fans</div>
                {fanRows.map(({ row, idx }) => {
                  const f = row.fan;
                  const active = idx === activeIdx;
                  const name = f.displayName || f.nickname || f.uniqueId;
                  return (
                    <button
                      key={row.id}
                      data-row={idx}
                      onMouseEnter={() => setActiveIdx(idx)}
                      onClick={(e) => runRow(row, e.metaKey || e.ctrlKey)}
                      className="flex w-full items-center gap-3 rounded-lg px-3 py-2 text-left"
                      style={active ? { background: 'color-mix(in srgb, var(--brand-pink) 12%, transparent)' } : undefined}
                    >
                      <FanAvatar name={name} url={f.avatarUrl} size={30} />
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-1.5">
                          <span className="truncate text-sm font-semibold" style={{ color: 'var(--label)' }}>{name}</span>
                          <TierChip tier={f.tier} />
                        </div>
                        <div className="truncate text-[11px]" style={{ color: 'var(--tertiary-label)' }}>@{f.uniqueId}</div>
                      </div>
                      <span className="flex-none">
                        <StrengthBar score={f.strength ?? 0} barWidth={56} height={6} label />
                      </span>
                    </button>
                  );
                })}
              </div>
            )}

            {Array.from(commandGroups.entries()).map(([group, items]) => (
              <div key={group}>
                <div className="px-3 pb-1 pt-3 text-[10px] font-semibold uppercase tracking-wider" style={{ color: 'var(--tertiary-label)' }}>{group}</div>
                {items.map(({ row, idx }) => {
                  if (row.kind !== 'command') return null;
                  const c = row.cmd;
                  const active = idx === activeIdx;
                  return (
                    <button
                      key={c.id}
                      data-row={idx}
                      onMouseEnter={() => setActiveIdx(idx)}
                      onClick={() => runRow(row, false)}
                      className="flex w-full items-center gap-3 rounded-lg px-3 py-2 text-left text-sm"
                      style={active ? { background: 'color-mix(in srgb, var(--brand-pink) 12%, transparent)', color: 'var(--label)' } : { color: 'var(--secondary-label)' }}
                    >
                      {c.icon && <span className="text-base">{c.icon}</span>}
                      <span className="flex-1 truncate">{c.label}</span>
                      {c.hint && <span className="text-[11px]" style={{ color: 'var(--tertiary-label)' }}>{c.hint}</span>}
                    </button>
                  );
                })}
              </div>
            ))}
          </>
        )}
      </div>

      <div className="flex items-center justify-between border-t px-4 py-2 text-[11px]" style={{ borderColor: 'var(--panel-border)', color: 'var(--tertiary-label)' }}>
        <span>↑↓ navigate · ↵ peek · ⌘↵ open profile · esc close</span>
        <span>{rows.length} result{rows.length === 1 ? '' : 's'}</span>
      </div>
    </Dialog>
  );
}
