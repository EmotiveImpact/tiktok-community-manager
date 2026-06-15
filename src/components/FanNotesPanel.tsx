/**
 * Fan Notes — a notes BROWSER over the canonical fan model.
 *
 * There is no separate notes island anymore. This panel reads/writes the same
 * two surfaces every other screen uses:
 *   A) pinned "About"  = fan.notes            (edited via fansUpdate)
 *   B) dated notes log = timeline type:'note' (fansAddNote + fansTimeline)
 *
 * Pick/search a fan on the left; on the right, see + edit their About and add /
 * read their dated notes. "Open full profile" jumps to the 360.
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import { avatarGradient } from '../lib/avatars';
import { timeAgo } from '../lib/format';
import { useUI } from '../state/ui';
import { PanelHeader, PanelShell } from './PanelHeader';
import { Select } from './ui';
import type { Fan, TimelineEvent } from '../types';

type SortBy = 'recent' | 'name';

export function FanNotesPanel({ onClose }: { onClose: () => void }) {
  const openFanProfile = useUI((s) => s.openFanProfile);
  const [fans, setFans] = useState<Fan[]>([]);
  const [search, setSearch] = useState('');
  const [sortBy, setSortBy] = useState<SortBy>('recent');
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const loadFans = async () => {
    const res = await window.tiktok
      .fansList({ sort: sortBy === 'name' ? 'name' : 'lastSeen', pageSize: 500 })
      .catch(() => ({ data: [] as Fan[] } as any));
    setFans(res.data ?? []);
  };

  useEffect(() => { loadFans(); }, [sortBy]); // eslint-disable-line react-hooks/exhaustive-deps

  // Only fans that actually have a note (About) surface by default — this is a
  // notes browser. Searching widens it to any matching fan so you can start one.
  const q = search.trim().toLowerCase();
  const withNotes = useMemo(() => fans.filter((f) => (f.notes ?? '').trim().length > 0), [fans]);
  const list = useMemo(() => {
    const base = q
      ? fans.filter((f) =>
          (f.displayName ?? '').toLowerCase().includes(q) ||
          f.nickname.toLowerCase().includes(q) ||
          f.uniqueId.toLowerCase().includes(q) ||
          (f.notes ?? '').toLowerCase().includes(q),
        )
      : withNotes;
    return base;
  }, [fans, withNotes, q]);

  const selected = useMemo(() => fans.find((f) => f.uniqueId === selectedId) ?? null, [fans, selectedId]);

  // Keep a sensible selection.
  useEffect(() => {
    if (selectedId && list.some((f) => f.uniqueId === selectedId)) return;
    setSelectedId(list[0]?.uniqueId ?? null);
  }, [list, selectedId]);

  const onFanChanged = (fan: Fan) => {
    setFans((prev) => prev.map((f) => (f.uniqueId === fan.uniqueId ? { ...f, ...fan } : f)));
  };

  return (
    <PanelShell>
      <PanelHeader
        title="Fan Notes"
        badge={withNotes.length}
        onClose={onClose}
        actions={
          <Select
            value={sortBy}
            onValueChange={(v) => setSortBy(v as SortBy)}
            ariaLabel="Sort notes"
            options={[
              { value: 'recent', label: 'Most recent' },
              { value: 'name', label: 'Name A-Z' },
            ]}
          />
        }
      />

      <div className="border-b border-zinc-800/50 px-4 py-2">
        <input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search fans or notes…"
          className="w-full rounded-lg border border-zinc-800 bg-zinc-900 px-3 py-2 text-sm outline-none transition focus:border-like-500/60"
        />
      </div>

      <div className="flex min-h-0 flex-1">
        {/* LEFT — fan list */}
        <div className="w-[44%] min-w-[220px] flex-none overflow-y-auto border-r border-zinc-800/50">
          {list.length === 0 ? (
            <div className="flex h-48 items-center justify-center px-4 text-center text-sm text-zinc-600">
              {q ? `No fans match "${search}"` : 'No fan notes yet — search a fan to start one.'}
            </div>
          ) : (
            <ul className="divide-y divide-zinc-800/50">
              {list.map((f) => {
                const name = f.displayName || f.nickname || f.uniqueId;
                const active = f.uniqueId === selectedId;
                return (
                  <li key={f.uniqueId}>
                    <button
                      onClick={() => setSelectedId(f.uniqueId)}
                      className={`flex w-full items-start gap-2.5 px-3 py-2.5 text-left transition ${active ? 'bg-like-500/10' : 'hover:bg-zinc-900/40'}`}
                    >
                      <div className={`flex h-8 w-8 flex-none items-center justify-center rounded-full text-xs font-bold text-white ${avatarGradient(name)}`}>
                        {name.charAt(0).toUpperCase()}
                      </div>
                      <div className="min-w-0 flex-1">
                        <div className="truncate text-sm font-semibold text-zinc-100">{name}</div>
                        <div className="truncate text-[12px] text-zinc-500">
                          {(f.notes ?? '').trim() || <span className="italic text-zinc-600">No About yet</span>}
                        </div>
                      </div>
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </div>

        {/* RIGHT — selected fan's notes */}
        <div className="min-w-0 flex-1 overflow-y-auto">
          {selected ? (
            <FanNotesDetail
              key={selected.uniqueId}
              fan={selected}
              onChanged={onFanChanged}
              onOpenProfile={() => openFanProfile(selected.uniqueId)}
            />
          ) : (
            <div className="flex h-full items-center justify-center p-6 text-center text-sm text-zinc-600">
              Pick a fan on the left to see their notes.
            </div>
          )}
        </div>
      </div>
    </PanelShell>
  );
}

function FanNotesDetail({ fan, onChanged, onOpenProfile }: {
  fan: Fan;
  onChanged: (fan: Fan) => void;
  onOpenProfile: () => void;
}) {
  const name = fan.displayName || fan.nickname || fan.uniqueId;
  const [about, setAbout] = useState(fan.notes ?? '');
  const [saved, setSaved] = useState<'idle' | 'saving' | 'saved'>('idle');
  const [draft, setDraft] = useState('');
  const [notes, setNotes] = useState<TimelineEvent[]>([]);
  const [loadingNotes, setLoadingNotes] = useState(true);
  const debounce = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => { setAbout(fan.notes ?? ''); }, [fan.uniqueId]); // eslint-disable-line react-hooks/exhaustive-deps

  const loadNotes = () => {
    setLoadingNotes(true);
    window.tiktok.fansTimeline(fan.uniqueId, { filter: 'note', limit: 100 })
      .then((rows) => { setNotes(rows ?? []); setLoadingNotes(false); })
      .catch(() => setLoadingNotes(false));
  };
  useEffect(() => { loadNotes(); }, [fan.uniqueId]); // eslint-disable-line react-hooks/exhaustive-deps

  const onAboutChange = (text: string) => {
    setAbout(text);
    setSaved('saving');
    if (debounce.current) clearTimeout(debounce.current);
    debounce.current = setTimeout(async () => {
      const res = await window.tiktok.fansUpdate(fan.uniqueId, { notes: text }).catch(() => null);
      if (res?.ok && res.fan) { onChanged(res.fan); setSaved('saved'); setTimeout(() => setSaved('idle'), 1500); }
      else setSaved('idle');
    }, 600);
  };

  const addNote = async () => {
    const text = draft.trim();
    if (!text) return;
    setDraft('');
    const optimistic: TimelineEvent = {
      id: `tmp-${Date.now()}`, type: 'note', source: 'manual', occurredAt: Date.now(), summary: 'Note added', body: text,
    };
    setNotes((n) => [optimistic, ...n]);
    const res = await window.tiktok.fansAddNote(fan.uniqueId, text).catch(() => null);
    if (res?.ok && res.event) setNotes((n) => n.map((ev) => (ev.id === optimistic.id ? res.event! : ev)));
    else if (!res?.ok) { setNotes((n) => n.filter((ev) => ev.id !== optimistic.id)); setDraft(text); }
  };

  return (
    <div className="flex flex-col gap-4 p-4">
      <div className="flex items-center gap-3">
        <div className={`flex h-10 w-10 flex-none items-center justify-center rounded-full text-sm font-bold text-white ${avatarGradient(name)}`}>
          {name.charAt(0).toUpperCase()}
        </div>
        <div className="min-w-0 flex-1">
          <div className="truncate text-base font-bold text-zinc-100">{name}</div>
          <div className="truncate text-xs text-zinc-500">@{fan.uniqueId}</div>
        </div>
        <button
          onClick={onOpenProfile}
          className="flex-none rounded-lg border border-like-500/60 bg-like-500/10 px-3 py-1.5 text-xs font-bold text-like-300 hover:bg-like-500/20"
        >
          Open full profile →
        </button>
      </div>

      {/* Pinned About */}
      <div>
        <div className="mb-1 flex items-baseline justify-between">
          <label className="text-[10px] font-semibold uppercase tracking-wider text-zinc-500">📌 About — pinned</label>
          <span className="text-[10px] text-zinc-600">
            {saved === 'saving' ? 'Saving…' : saved === 'saved' ? 'Saved ✓' : ''}
          </span>
        </div>
        <textarea
          value={about}
          onChange={(e) => onAboutChange(e.target.value)}
          placeholder="One stable summary about this fan…"
          rows={4}
          className="w-full resize-y rounded-lg border border-zinc-800 bg-zinc-900 p-3 text-sm leading-relaxed outline-none transition focus:border-like-500/60"
        />
      </div>

      {/* Add a dated note */}
      <div>
        <label className="mb-1 block text-[10px] font-semibold uppercase tracking-wider text-zinc-500">✍️ Add a dated note</label>
        <div className="flex items-end gap-2">
          <textarea
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) { e.preventDefault(); addNote(); } }}
            placeholder="Something that happened — lands on their timeline"
            rows={2}
            className="min-w-0 flex-1 resize-none rounded-lg border border-zinc-800 bg-zinc-900 p-2.5 text-sm leading-relaxed outline-none transition focus:border-like-500/60"
          />
          <button
            onClick={addNote}
            disabled={!draft.trim()}
            className="flex-none rounded-lg bg-gradient-to-r from-like-500 to-like-600 px-4 py-2 text-sm font-medium text-white disabled:opacity-40"
          >
            Add
          </button>
        </div>
      </div>

      {/* Dated notes log */}
      <div>
        <label className="mb-1.5 block text-[10px] font-semibold uppercase tracking-wider text-zinc-500">🕒 Dated notes</label>
        {loadingNotes ? (
          <div className="py-6 text-center text-xs text-zinc-600">Loading…</div>
        ) : notes.length === 0 ? (
          <div className="rounded-lg border border-dashed border-zinc-800 px-3 py-4 text-center text-xs text-zinc-600">
            No dated notes yet. Add one above.
          </div>
        ) : (
          <ul className="space-y-2">
            {notes.map((ev) => (
              <li key={ev.id} className="rounded-lg border border-zinc-800/70 bg-zinc-900/40 px-3 py-2">
                <p className="whitespace-pre-wrap text-[13px] leading-relaxed text-zinc-200">{ev.body || ev.summary}</p>
                <div className="mt-1 text-[10px] text-zinc-600">{timeAgo(ev.occurredAt)} ago</div>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
