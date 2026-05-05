import { useEffect, useState, useRef } from 'react';
import { avatarGradient } from '../lib/avatars';
import { timeAgo } from '../lib/format';
import { PanelHeader, PanelShell } from './PanelHeader';
import type { UserNote } from '../types';

type SortBy = 'recent' | 'name';

export function FanNotesPanel({ onClose }: { onClose: () => void }) {
  const [notes, setNotes] = useState<UserNote[]>([]);
  const [search, setSearch] = useState('');
  const [sortBy, setSortBy] = useState<SortBy>('recent');
  const [editing, setEditing] = useState<string | null>(null);
  const [editText, setEditText] = useState('');
  const [addMode, setAddMode] = useState(false);
  const [newUniqueId, setNewUniqueId] = useState('');
  const [newNickname, setNewNickname] = useState('');
  const [newNote, setNewNote] = useState('');
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);

  const loadNotes = async () => {
    const all = await window.tiktok.notesAll();
    setNotes(Object.values(all));
  };

  useEffect(() => { loadNotes(); }, []);

  const sorted = [...notes].sort((a, b) =>
    sortBy === 'name'
      ? a.nickname.localeCompare(b.nickname)
      : b.updatedAt - a.updatedAt
  );

  const filtered = search.trim()
    ? sorted.filter((n) => {
        const q = search.toLowerCase();
        return n.nickname.toLowerCase().includes(q) || n.uniqueId.toLowerCase().includes(q) || n.notes.toLowerCase().includes(q);
      })
    : sorted;

  const handleSave = async (uniqueId: string, nickname: string, text: string) => {
    if (!text.trim()) {
      await window.tiktok.notesDelete(uniqueId);
    } else {
      await window.tiktok.notesSet({ uniqueId, nickname, notes: text });
    }
    setEditing(null);
    loadNotes();
  };

  const handleDelete = async (uniqueId: string) => {
    if (!confirm(`Delete notes for @${uniqueId}?`)) return;
    await window.tiktok.notesDelete(uniqueId);
    loadNotes();
  };

  const handleAdd = async () => {
    const id = newUniqueId.replace(/^@/, '').trim();
    const nick = newNickname.trim() || id;
    const text = newNote.trim();
    if (!id || !text) return;
    await window.tiktok.notesSet({ uniqueId: id, nickname: nick, notes: text });
    setNewUniqueId('');
    setNewNickname('');
    setNewNote('');
    setAddMode(false);
    loadNotes();
  };

  return (
    <PanelShell>
      <PanelHeader
        title="Fan Notes"
        badge={notes.length}
        onClose={onClose}
        actions={
          <>
            <select
              value={sortBy}
              onChange={(e) => setSortBy(e.target.value as SortBy)}
              className="h-7 rounded-md border border-zinc-700 bg-zinc-900 px-2 text-xs text-zinc-200 outline-none"
            >
              <option value="recent">Most recent</option>
              <option value="name">Name A-Z</option>
            </select>
            <button
              onClick={() => setAddMode(!addMode)}
              className="panel-btn panel-btn-primary"
            >
              + Add
            </button>
          </>
        }
      />

      {/* Search */}
      <div className="border-b border-zinc-800/50 px-4 py-2">
        <input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search names or notes..."
          className="w-full rounded-lg border border-zinc-800 bg-zinc-900 px-3 py-2 text-sm outline-none transition focus:border-like-500/60"
        />
      </div>

      {/* Add form */}
      {addMode && (
        <div className="border-b border-zinc-800 bg-zinc-900/50 px-4 py-3">
          <div className="flex gap-2 mb-2">
            <input
              value={newUniqueId}
              onChange={(e) => setNewUniqueId(e.target.value)}
              placeholder="@username"
              className="w-40 rounded-lg border border-zinc-800 bg-zinc-900 px-3 py-1.5 text-sm outline-none focus:border-like-500/60"
              autoFocus
            />
            <input
              value={newNickname}
              onChange={(e) => setNewNickname(e.target.value)}
              placeholder="Name (optional)"
              className="w-40 rounded-lg border border-zinc-800 bg-zinc-900 px-3 py-1.5 text-sm outline-none focus:border-like-500/60"
            />
          </div>
          <textarea
            value={newNote}
            onChange={(e) => setNewNote(e.target.value)}
            placeholder="What do you want to remember about this person?"
            rows={2}
            className="mb-2 w-full rounded-lg border border-zinc-800 bg-zinc-900 p-2.5 text-sm leading-relaxed outline-none focus:border-like-500/60"
          />
          <div className="flex gap-2">
            <button
              onClick={handleAdd}
              disabled={!newUniqueId.trim() || !newNote.trim()}
              className="rounded-lg bg-gradient-to-r from-like-500 to-like-600 px-4 py-1.5 text-sm font-medium text-white disabled:opacity-40"
            >
              Save
            </button>
            <button onClick={() => setAddMode(false)} className="text-xs text-zinc-400 hover:text-zinc-200">
              Cancel
            </button>
          </div>
        </div>
      )}

      {/* List */}
      <div className="flex-1 overflow-y-auto">
        {filtered.length === 0 ? (
          <div className="flex h-64 items-center justify-center text-sm text-zinc-600">
            {notes.length === 0
              ? 'No notes yet — click a user in chat or hit "+ Add" above.'
              : `No results for "${search}"`}
          </div>
        ) : (
          <ul className="divide-y divide-zinc-800/50">
            {filtered.map((entry) => (
              <li key={entry.uniqueId} className="px-4 py-3 hover:bg-zinc-900/40">
                <div className="flex items-start gap-3">
                  <div className={`flex h-9 w-9 flex-none items-center justify-center rounded-full text-xs font-bold text-white ${avatarGradient(entry.nickname)}`}>
                    {entry.nickname.charAt(0).toUpperCase()}
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-baseline gap-2">
                      <span className="text-sm font-semibold text-zinc-100">{entry.nickname}</span>
                      <span className="text-[11px] text-zinc-500">@{entry.uniqueId}</span>
                      <span className="ml-auto flex-none text-[10px] text-zinc-600">{timeAgo(entry.updatedAt)}</span>
                    </div>

                    {editing === entry.uniqueId ? (
                      <div className="mt-2">
                        <textarea
                          ref={textareaRef}
                          value={editText}
                          onChange={(e) => setEditText(e.target.value)}
                          rows={3}
                          className="w-full rounded-lg border border-zinc-700 bg-zinc-800 p-2 text-sm leading-relaxed outline-none focus:border-like-500/60"
                        />
                        <div className="mt-1.5 flex gap-2">
                          <button
                            onClick={() => handleSave(entry.uniqueId, entry.nickname, editText)}
                            className="rounded px-3 py-1 text-xs font-medium text-like-300 hover:bg-like-500/10"
                          >
                            Save
                          </button>
                          <button
                            onClick={() => setEditing(null)}
                            className="rounded px-3 py-1 text-xs text-zinc-400 hover:text-zinc-200"
                          >
                            Cancel
                          </button>
                        </div>
                      </div>
                    ) : (
                      <p className="mt-1 whitespace-pre-wrap text-[13px] leading-relaxed text-zinc-400">
                        {highlightSearch(entry.notes, search)}
                      </p>
                    )}

                    {editing !== entry.uniqueId && (
                      <div className="mt-1.5 flex gap-3">
                        <button
                          onClick={() => { setEditing(entry.uniqueId); setEditText(entry.notes); setTimeout(() => textareaRef.current?.focus(), 50); }}
                          className="text-[11px] text-zinc-500 hover:text-zinc-200"
                        >
                          Edit
                        </button>
                        <button
                          onClick={() => window.tiktok.openProfile(entry.uniqueId)}
                          className="text-[11px] text-zinc-500 hover:text-zinc-200"
                        >
                          Profile
                        </button>
                        <button
                          onClick={() => handleDelete(entry.uniqueId)}
                          className="text-[11px] text-zinc-500 hover:text-rose-400"
                        >
                          Delete
                        </button>
                      </div>
                    )}
                  </div>
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>
    </PanelShell>
  );
}

function highlightSearch(text: string, query: string): React.ReactNode {
  if (!query.trim()) return text;
  const q = query.trim();
  const regex = new RegExp(`(${q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')})`, 'gi');
  const parts = text.split(regex);
  return parts.map((part, i) =>
    regex.test(part) ? (
      <mark key={i} className="rounded bg-like-500/20 px-0.5 text-like-200">{part}</mark>
    ) : (
      part
    )
  );
}
