import { useState } from 'react';
import { useAlerts, type AlertRule, type AlertToast } from '../state/alerts';
import { PanelHeader, PanelShell } from './PanelHeader';
import { timeAgo } from '../lib/format';

const ruleTypes: { value: AlertRule['type']; label: string; placeholder: string; pillClass: string; pillLabel: string; description: string; accent: string }[] = [
  { value: 'keyword', label: 'Keyword Match', placeholder: 'Enter keyword...', pillClass: 'bg-like-500/15 text-like-400', pillLabel: 'Keyword', description: 'Triggers on keyword match in chat', accent: 'border-l-like-500' },
  { value: 'gift_diamonds', label: 'Gift Threshold', placeholder: 'minimum diamonds (e.g. 100)', pillClass: 'bg-amber-500/15 text-amber-300', pillLabel: 'Gift', description: 'Alerts on gifts above threshold', accent: 'border-l-amber-400' },
  { value: 'gift_name', label: 'Gift Name', placeholder: 'gift name', pillClass: 'bg-amber-500/15 text-amber-300', pillLabel: 'Gift', description: 'Alerts when specific gift is sent', accent: 'border-l-amber-400' },
  { value: 'follower', label: 'New Follower', placeholder: '(no value needed)', pillClass: 'bg-cyan-500/15 text-cyan-400', pillLabel: 'Follow', description: 'Triggers on every new follower', accent: 'border-l-cyan-400' },
  { value: 'viewer_threshold', label: 'Viewer Threshold', placeholder: 'viewer count (e.g. 1000)', pillClass: 'bg-emerald-500/15 text-emerald-300', pillLabel: 'Viewers', description: 'Alerts when viewer count exceeds limit', accent: 'border-l-emerald-400' },
];

function Toggle({ active, onClick }: { active: boolean; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      style={{ width: 36, height: 20, padding: 0, flex: 'none' }}
      className={`relative inline-block rounded-full transition ${active ? 'bg-like-500' : 'bg-zinc-700'}`}
    >
      <span
        style={{
          position: 'absolute',
          top: 2,
          left: active ? 18 : 2,
          width: 16,
          height: 16,
          borderRadius: 9999,
          background: 'white',
          transition: 'left 150ms',
        }}
      />
    </button>
  );
}

export function AlertsPanel({ onClose }: { onClose: () => void }) {
  const rules = useAlerts((s) => s.rules);
  const history = useAlerts((s) => s.history);
  const addRule = useAlerts((s) => s.addRule);
  const removeRule = useAlerts((s) => s.removeRule);
  const toggleRule = useAlerts((s) => s.toggleRule);
  const clearHistory = useAlerts((s) => s.clearHistory);
  const soundEnabled = useAlerts((s) => s.soundEnabled);
  const toggleSound = useAlerts((s) => s.toggleSound);
  const autoClip = useAlerts((s) => s.autoClip);
  const toggleAutoClip = useAlerts((s) => s.toggleAutoClip);

  const [newType, setNewType] = useState<AlertRule['type']>('keyword');
  const [newValue, setNewValue] = useState('');

  const meta = ruleTypes.find((r) => r.value === newType)!;

  const handleAdd = () => {
    const val = newValue.trim();
    if (newType !== 'follower' && !val) return;
    addRule({
      type: newType,
      value: val,
      label: `${meta.label}${val ? `: "${val}"` : ''}`,
      enabled: true,
    });
    setNewValue('');
  };

  return (
    <PanelShell>
      <PanelHeader
        title="Real-Time Alerts"
        badge={`${rules.filter((r) => r.enabled).length} active`}
        onClose={onClose}
      />

      {/* Settings strip */}
      <div className="flex items-center gap-5 border-b border-zinc-800/60 bg-zinc-900/30 px-6 py-2.5">
        <label className="flex cursor-pointer items-center gap-2">
          <Toggle active={soundEnabled} onClick={toggleSound} />
          <span className="text-xs text-zinc-300">Sound</span>
        </label>
        <label className="flex cursor-pointer items-center gap-2" title="Auto-save 60s clip when alert fires (needs FFmpeg)">
          <Toggle active={autoClip} onClick={toggleAutoClip} />
          <span className="text-xs text-zinc-300">Auto-clip</span>
        </label>
      </div>

      <div className="flex-1 overflow-hidden p-6">
        <div className="grid h-full gap-6 md:grid-cols-2">
          {/* Left: Alert Rules */}
          <div className="flex min-h-0 flex-col">
            <div className="mb-3 text-sm font-semibold text-zinc-100">Alert Rules</div>

            {/* Add Rule */}
            <div className="mb-5 rounded-xl border border-dashed border-zinc-700 bg-zinc-900/60 p-4">
              <div className="mb-3 text-[11px] font-semibold uppercase tracking-wider text-zinc-500">Add New Rule</div>
              <div className="mb-3 flex gap-2">
                <select
                  value={newType}
                  onChange={(e) => setNewType(e.target.value as AlertRule['type'])}
                  className="flex-1 rounded-lg border border-zinc-800 bg-zinc-900 px-3 py-1.5 text-sm text-zinc-200 outline-none"
                >
                  {ruleTypes.map((rt) => (
                    <option key={rt.value} value={rt.value}>
                      {rt.label}
                    </option>
                  ))}
                </select>
                {newType !== 'follower' && (
                  <input
                    value={newValue}
                    onChange={(e) => setNewValue(e.target.value)}
                    onKeyDown={(e) => { if (e.key === 'Enter') handleAdd(); }}
                    placeholder={meta.placeholder}
                    className="flex-[2] rounded-lg border border-zinc-800 bg-zinc-900 px-3 py-1.5 text-sm outline-none transition focus:border-like-500/60"
                  />
                )}
              </div>
              <button
                onClick={handleAdd}
                disabled={newType !== 'follower' && !newValue.trim()}
                className="rounded-lg bg-gradient-to-r from-like-500 to-like-600 px-4 py-1.5 text-sm font-medium text-white shadow-lg shadow-like-500/20 disabled:opacity-40"
              >
                Add Rule
              </button>
            </div>

            {/* Active Rules */}
            <div className="flex-1 overflow-y-auto">
              {rules.length === 0 ? (
                <div className="py-12 text-center text-sm text-zinc-600">
                  No alert rules yet.
                </div>
              ) : (
                <ul className="flex flex-col gap-2.5">
                  {rules.map((rule) => {
                    const m = ruleTypes.find((r) => r.value === rule.type)!;
                    return (
                      <li
                        key={rule.id}
                        className="group flex items-center gap-3 rounded-lg bg-zinc-900 px-4 py-3"
                      >
                        <Toggle active={rule.enabled} onClick={() => toggleRule(rule.id)} />
                        <div className="flex-1 min-w-0">
                          <div className={`text-sm font-medium ${rule.enabled ? 'text-zinc-100' : 'text-zinc-400'}`}>{rule.label}</div>
                          <div className="text-[11px] text-zinc-500">{m.description}</div>
                        </div>
                        <span className={`rounded-full px-3 py-0.5 text-[11px] font-semibold ${m.pillClass}`}>{m.pillLabel}</span>
                        <button
                          onClick={() => removeRule(rule.id)}
                          className="text-xs text-zinc-500 opacity-0 transition hover:text-rose-400 group-hover:opacity-100"
                        >
                          ✕
                        </button>
                      </li>
                    );
                  })}
                </ul>
              )}
            </div>
          </div>

          {/* Right: Toast Notifications history */}
          <div className="flex min-h-0 flex-col">
            <div className="mb-3 flex items-center justify-between">
              <span className="text-sm font-semibold text-zinc-100">Recent Notifications</span>
              {history.length > 0 && (
                <button
                  onClick={clearHistory}
                  className="text-[11px] text-zinc-500 hover:text-rose-400"
                >
                  Clear
                </button>
              )}
            </div>

            <div className="flex-1 overflow-y-auto">
              {history.length === 0 ? (
                <div className="flex h-48 flex-col items-center justify-center text-center">
                  <div className="mb-2 text-3xl opacity-30">🔔</div>
                  <p className="text-sm text-zinc-500">No alerts fired yet</p>
                  <p className="mt-1 max-w-xs text-[11px] text-zinc-600">
                    Notifications will appear here when your rules trigger during a live session.
                  </p>
                </div>
              ) : (
                <ul className="flex flex-col gap-2">
                  {history.map((t) => (
                    <ToastItem key={t.id} toast={t} rules={rules} />
                  ))}
                </ul>
              )}
            </div>
          </div>
        </div>
      </div>
    </PanelShell>
  );
}

function ToastItem({ toast, rules }: { toast: AlertToast; rules: AlertRule[] }) {
  const rule = rules.find((r) => r.id === toast.ruleId);
  const m = rule ? ruleTypes.find((r) => r.value === rule.type) : null;
  const accent = m?.accent ?? 'border-l-zinc-700';
  return (
    <li className={`flex items-start gap-3 rounded-lg border-l-2 bg-zinc-900 px-4 py-3 ${accent}`}>
      <div className="min-w-0 flex-1">
        <div className="flex items-baseline justify-between gap-2">
          <span className="text-sm font-semibold text-zinc-100">{toast.title}</span>
          <span className="flex-none text-[10px] text-zinc-600">{timeAgo(toast.ts)}</span>
        </div>
        <div className="mt-0.5 truncate text-xs text-zinc-400">{toast.body}</div>
      </div>
    </li>
  );
}
