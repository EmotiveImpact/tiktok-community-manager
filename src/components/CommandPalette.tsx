import { useEffect, useMemo, useRef, useState } from 'react';
import { useStore } from '../state/store';
import { Dialog } from './ui/Dialog';

export type Command = {
  id: string;
  label: string;
  hint?: string;
  group: string;
  icon?: string;
  run: () => void;
};

export function CommandPalette({ commands, onClose }: { commands: Command[]; onClose: () => void }) {
  const [query, setQuery] = useState('');
  const [activeIdx, setActiveIdx] = useState(0);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const listRef = useRef<HTMLDivElement | null>(null);
  const tallies = useStore((s) => s.tallies);
  const selectUser = useStore((s) => s.selectUser);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  const userResults = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return [] as Command[];
    return Array.from(tallies.values())
      .filter((t) =>
        t.user.nickname.toLowerCase().includes(q) || t.user.uniqueId.toLowerCase().includes(q),
      )
      .slice(0, 6)
      .map((t): Command => ({
        id: `user:${t.user.uniqueId}`,
        label: t.user.nickname,
        hint: `@${t.user.uniqueId}`,
        group: 'Users in this session',
        icon: '👤',
        run: () => {
          selectUser(t.user.uniqueId);
          onClose();
        },
      }));
  }, [query, tallies, selectUser, onClose]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    const base = !q
      ? commands
      : commands.filter(
          (c) => c.label.toLowerCase().includes(q) || c.hint?.toLowerCase().includes(q),
        );
    return [...base, ...userResults];
  }, [commands, query, userResults]);

  useEffect(() => {
    setActiveIdx(0);
  }, [query]);

  useEffect(() => {
    const item = listRef.current?.children[activeIdx] as HTMLElement | undefined;
    if (item) item.scrollIntoView({ block: 'nearest' });
  }, [activeIdx]);

  const handleKey = (e: React.KeyboardEvent) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setActiveIdx((i) => Math.min(i + 1, filtered.length - 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setActiveIdx((i) => Math.max(i - 1, 0));
    } else if (e.key === 'Enter') {
      e.preventDefault();
      const cmd = filtered[activeIdx];
      if (cmd) {
        cmd.run();
        onClose();
      }
    } else if (e.key === 'Escape') {
      e.preventDefault();
      onClose();
    }
  };

  const grouped = useMemo(() => {
    const map = new Map<string, Command[]>();
    for (const c of filtered) {
      const arr = map.get(c.group) ?? [];
      arr.push(c);
      map.set(c.group, arr);
    }
    return map;
  }, [filtered]);

  let runningIdx = 0;

  return (
    <Dialog
      open
      onOpenChange={(o) => { if (!o) onClose(); }}
      ariaLabel="Command palette"
      bare
      className="left-1/2 top-[15vh] w-[600px] max-w-[90vw] -translate-x-1/2 overflow-hidden rounded-xl border border-zinc-800/60 bg-zinc-950/95 shadow-2xl"
    >
        <div className="flex items-center gap-2 border-b border-zinc-800/60 px-4 py-3">
          <span className="text-zinc-500">⌘K</span>
          <input
            ref={inputRef}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={handleKey}
            placeholder="Search commands, users, panels…"
            className="flex-1 bg-transparent text-sm text-zinc-100 outline-none placeholder:text-zinc-600"
          />
          {query && (
            <button onClick={() => setQuery('')} className="text-xs text-zinc-500 hover:text-zinc-300">Clear</button>
          )}
        </div>
        <div ref={listRef} className="max-h-[60vh] overflow-y-auto p-1">
          {filtered.length === 0 ? (
            <div className="py-12 text-center text-sm text-zinc-600">No matches</div>
          ) : (
            Array.from(grouped.entries()).map(([group, items]) => (
              <div key={group}>
                <div className="px-3 pb-1 pt-3 text-[10px] font-semibold uppercase tracking-wider text-zinc-600">{group}</div>
                {items.map((c) => {
                  const idx = runningIdx++;
                  const active = idx === activeIdx;
                  return (
                    <button
                      key={c.id}
                      onMouseEnter={() => setActiveIdx(idx)}
                      onClick={() => { c.run(); onClose(); }}
                      className={`flex w-full items-center gap-3 rounded-lg px-3 py-2 text-left text-sm ${
                        active ? 'bg-like-500/10 text-zinc-100' : 'text-zinc-300 hover:bg-zinc-900'
                      }`}
                    >
                      {c.icon && <span className="text-base">{c.icon}</span>}
                      <span className="flex-1 truncate">{c.label}</span>
                      {c.hint && <span className="text-[11px] text-zinc-500">{c.hint}</span>}
                    </button>
                  );
                })}
              </div>
            ))
          )}
        </div>
        <div className="flex items-center justify-between border-t border-zinc-800/60 px-4 py-2 text-[11px] text-zinc-600">
          <span>↑↓ navigate · ↵ select · esc close</span>
          <span>{filtered.length} results</span>
        </div>
    </Dialog>
  );
}
