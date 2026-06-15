import { useState } from 'react';
import { useModeration, type UserTag } from '../state/moderation';
import { PanelHeader, PanelShell } from './PanelHeader';
import { Select, Switch } from './ui';

const TAG_COLORS: Record<UserTag, string> = {
  vip: 'bg-amber-500/15 text-amber-300 border-amber-500/20',
  regular: 'bg-zinc-700/30 text-zinc-300 border-zinc-600/20',
  troll: 'bg-rose-500/15 text-rose-300 border-rose-500/20',
  blocked: 'bg-red-500/15 text-red-300 border-red-500/20',
};

export function ModerationPanel({ onClose }: { onClose: () => void }) {
  const {
    blockedUsers, blockedKeywords, userTags, spamFilterEnabled, spamThreshold,
    blockUser, unblockUser, addKeyword, removeKeyword, setUserTag,
    toggleSpamFilter, setSpamThreshold,
  } = useModeration();

  const [newUser, setNewUser] = useState('');
  const [newKeyword, setNewKeyword] = useState('');
  const [newTagUser, setNewTagUser] = useState('');
  const [newTag, setNewTag] = useState<UserTag>('vip');

  return (
    <PanelShell>
      <PanelHeader title="Moderation" onClose={onClose} />

      <div className="flex-1 overflow-y-auto p-4">
        <div className="grid gap-6 md:grid-cols-2">
          <section className="glass rounded-xl p-4">
            <h3 className="mb-3 text-[11px] font-semibold uppercase tracking-wider text-zinc-500">Blocked Users</h3>
            <div className="flex gap-2 mb-3">
              <input
                value={newUser}
                onChange={(e) => setNewUser(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && newUser.trim()) {
                    blockUser(newUser.trim().replace(/^@/, ''));
                    setNewUser('');
                  }
                }}
                placeholder="@username"
                className="flex-1 rounded-lg border border-zinc-800 bg-zinc-900 px-3 py-1.5 text-sm outline-none transition focus:border-like-500/60"
              />
              <button
                onClick={() => {
                  if (newUser.trim()) {
                    blockUser(newUser.trim().replace(/^@/, ''));
                    setNewUser('');
                  }
                }}
                className="rounded-lg bg-rose-500 px-3 py-1.5 text-xs font-medium text-white hover:bg-rose-600"
              >
                Block
              </button>
            </div>
            <ul className="flex flex-col gap-1 max-h-40 overflow-y-auto">
              {[...blockedUsers].map((u) => (
                <li key={u} className="flex items-center justify-between rounded-lg bg-zinc-900/50 px-3 py-1.5 text-sm">
                  <span className="text-zinc-300">@{u}</span>
                  <button onClick={() => unblockUser(u)} className="text-xs text-zinc-500 hover:text-zinc-200">Unblock</button>
                </li>
              ))}
              {blockedUsers.size === 0 && <li className="text-xs text-zinc-600 py-2">No blocked users</li>}
            </ul>
          </section>

          <section className="glass rounded-xl p-4">
            <h3 className="mb-3 text-[11px] font-semibold uppercase tracking-wider text-zinc-500">Blocked Keywords</h3>
            <div className="flex gap-2 mb-3">
              <input
                value={newKeyword}
                onChange={(e) => setNewKeyword(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && newKeyword.trim()) {
                    addKeyword(newKeyword);
                    setNewKeyword('');
                  }
                }}
                placeholder="word or phrase"
                className="flex-1 rounded-lg border border-zinc-800 bg-zinc-900 px-3 py-1.5 text-sm outline-none transition focus:border-like-500/60"
              />
              <button
                onClick={() => {
                  if (newKeyword.trim()) {
                    addKeyword(newKeyword);
                    setNewKeyword('');
                  }
                }}
                className="rounded-lg bg-rose-500 px-3 py-1.5 text-xs font-medium text-white hover:bg-rose-600"
              >
                Add
              </button>
            </div>
            <div className="flex flex-wrap gap-1.5">
              {blockedKeywords.map((kw) => (
                <span key={kw} className="flex items-center gap-1.5 rounded-full border border-zinc-700/50 bg-zinc-900 px-3 py-1 text-xs text-zinc-300">
                  {kw}
                  <button onClick={() => removeKeyword(kw)} className="text-zinc-500 hover:text-rose-400">×</button>
                </span>
              ))}
              {blockedKeywords.length === 0 && <span className="text-xs text-zinc-600">No blocked keywords</span>}
            </div>
          </section>

          <section className="glass rounded-xl p-4">
            <h3 className="mb-3 text-[11px] font-semibold uppercase tracking-wider text-zinc-500">User Tags</h3>
            <div className="flex gap-2 mb-3">
              <input
                value={newTagUser}
                onChange={(e) => setNewTagUser(e.target.value)}
                placeholder="@username"
                className="flex-1 rounded-lg border border-zinc-800 bg-zinc-900 px-3 py-1.5 text-sm outline-none transition focus:border-like-500/60"
              />
              <Select
                value={newTag}
                onValueChange={(v) => setNewTag(v as UserTag)}
                ariaLabel="User tag"
                options={[
                  { value: 'vip', label: 'VIP' },
                  { value: 'regular', label: 'Regular' },
                  { value: 'troll', label: 'Troll' },
                  { value: 'blocked', label: 'Blocked' },
                ]}
              />
              <button
                onClick={() => {
                  if (newTagUser.trim()) {
                    setUserTag(newTagUser.trim().replace(/^@/, ''), newTag);
                    setNewTagUser('');
                  }
                }}
                className="rounded-lg bg-gradient-to-r from-like-500 to-like-600 px-3 py-1.5 text-xs font-medium text-white"
              >
                Tag
              </button>
            </div>
            <ul className="flex flex-col gap-1 max-h-40 overflow-y-auto">
              {[...userTags.entries()].map(([uid, tag]) => (
                <li key={uid} className="flex items-center gap-2 rounded-lg bg-zinc-900/50 px-3 py-1.5 text-sm">
                  <span className="text-zinc-300">@{uid}</span>
                  <span className={`rounded-full border px-2.5 py-0.5 text-[10px] font-semibold ${TAG_COLORS[tag]}`}>{tag.toUpperCase()}</span>
                  <button onClick={() => setUserTag(uid, null)} className="ml-auto text-xs text-zinc-500 hover:text-zinc-200">Remove</button>
                </li>
              ))}
              {userTags.size === 0 && <li className="text-xs text-zinc-600 py-2">No tagged users</li>}
            </ul>
          </section>

          <section className="glass rounded-xl p-4">
            <h3 className="mb-3 text-[11px] font-semibold uppercase tracking-wider text-zinc-500">Spam Filter</h3>
            <div className="flex items-center gap-3 mb-3">
              <Switch
                checked={spamFilterEnabled}
                onCheckedChange={toggleSpamFilter}
                label={spamFilterEnabled ? 'Enabled' : 'Disabled'}
              />
              <span className="text-xs text-zinc-500">
                Hide users who send more than
              </span>
              <input
                type="number"
                value={spamThreshold}
                onChange={(e) => setSpamThreshold(parseInt(e.target.value) || 5)}
                className="w-16 rounded-lg border border-zinc-800 bg-zinc-900 px-2 py-1 text-sm text-center outline-none"
              />
              <span className="text-xs text-zinc-500">msgs in 10s</span>
            </div>
            <p className="text-xs text-zinc-600">
              Automatically hides messages from users who spam above the threshold.
            </p>
          </section>
        </div>
      </div>
    </PanelShell>
  );
}
