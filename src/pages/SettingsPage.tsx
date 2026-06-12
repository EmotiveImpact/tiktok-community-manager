/** Settings — full-page home for the options that previously lived only in the top-bar gear popover,
 *  plus CRM data management. The gear popover keeps working; this is the expanded view. */
import { useEffect, useState } from 'react';
import type { WebhookConfig } from '../types';
import { useAlerts } from '../state/alerts';
import { PageShell, FieldLabel, inputCls } from '../components/crm';

function Card({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="glass p-4" style={{ borderRadius: 18 }}>
      <h3 className="mb-3 text-sm font-bold">{title}</h3>
      {children}
    </section>
  );
}

export function SettingsPage() {
  const pushToast = useAlerts((s) => s.pushToast);
  const [signKey, setSignKey] = useState('');
  const [aiKey, setAiKey] = useState('');
  const [autoConnect, setAutoConnect] = useState(false);
  const [chatLog, setChatLog] = useState(false);
  const [webhooks, setWebhooks] = useState<WebhookConfig>({ discordUrl: '', slackUrl: '', customUrl: '', events: { gifts: true, follows: true, keywords: false, milestones: true } });
  const [dataDir, setDataDir] = useState('');
  const [fanCount, setFanCount] = useState<number | null>(null);
  const [confirmClear, setConfirmClear] = useState(false);

  useEffect(() => {
    window.tiktok.getSettings().then((s) => {
      setSignKey(s.signApiKey ?? '');
      setAiKey(s.anthropicApiKey ?? '');
      setAutoConnect(s.autoConnect ?? false);
      setChatLog(s.chatLogEnabled ?? false);
      if (s.webhooks) setWebhooks(s.webhooks);
    }).catch(() => {});
    window.tiktok.fansDataDir().then(setDataDir).catch(() => {});
    window.tiktok.fansList({ pageSize: 1 }).then((r) => setFanCount(r.total)).catch(() => {});
  }, []);

  useEffect(() => {
    if (!confirmClear) return;
    const t = setTimeout(() => setConfirmClear(false), 4000);
    return () => clearTimeout(t);
  }, [confirmClear]);

  const save = async (fn: () => Promise<unknown>, what: string) => {
    try {
      await fn();
      pushToast({ title: 'Saved', body: what });
    } catch {
      pushToast({ title: 'Save failed', body: what });
    }
  };

  return (
    <PageShell title="Settings" subtitle="Connection, integrations and your fan-ledger data.">
      <div className="grid grid-cols-1 items-start gap-4 xl:grid-cols-2">
        <div className="space-y-4">
          <Card title="Connection">
            <FieldLabel>Sign API key (EulerStream)</FieldLabel>
            <div className="flex gap-2">
              <input value={signKey} onChange={(e) => setSignKey(e.target.value)} placeholder="Optional — paste if you hit rate limits" className={inputCls} />
              <button onClick={() => save(() => window.tiktok.setSignApiKey(signKey), 'Sign API key')} className="panel-btn panel-btn-primary no-drag">Save</button>
            </div>
            <div className="mt-4">
              <FieldLabel>Anthropic API key (AI summaries)</FieldLabel>
              <div className="flex gap-2">
                <input value={aiKey} onChange={(e) => setAiKey(e.target.value)} type="password" placeholder="sk-ant-…" className={inputCls} />
                <button onClick={() => save(() => window.tiktok.setAnthropicKey(aiKey), 'Anthropic key')} className="panel-btn panel-btn-primary no-drag">Save</button>
              </div>
              <p className="mt-1.5 text-[12px]" style={{ color: 'var(--secondary-label)' }}>
                Your key stays on this device and is sent only to api.anthropic.com.
              </p>
            </div>
            <div className="mt-4 flex flex-col gap-2 text-[13px]">
              <label className="flex items-center gap-2">
                <input type="checkbox" checked={autoConnect} onChange={(e) => { setAutoConnect(e.target.checked); save(() => window.tiktok.setAutoConnect(e.target.checked), 'Auto-connect'); }} className="accent-pink-600" />
                Auto-connect to last user on launch
              </label>
              <label className="flex items-center gap-2">
                <input type="checkbox" checked={chatLog} onChange={(e) => { setChatLog(e.target.checked); save(() => window.tiktok.setChatLog(e.target.checked), 'Chat log'); }} className="accent-pink-600" />
                Save chat log to disk
              </label>
            </div>
          </Card>

          <Card title="Webhooks">
            <div className="space-y-2">
              <input value={webhooks.discordUrl} onChange={(e) => setWebhooks({ ...webhooks, discordUrl: e.target.value })} onBlur={() => save(() => window.tiktok.setWebhooks(webhooks), 'Webhooks')} placeholder="Discord webhook URL" className={inputCls} />
              <input value={webhooks.slackUrl} onChange={(e) => setWebhooks({ ...webhooks, slackUrl: e.target.value })} onBlur={() => save(() => window.tiktok.setWebhooks(webhooks), 'Webhooks')} placeholder="Slack webhook URL" className={inputCls} />
              <input value={webhooks.customUrl} onChange={(e) => setWebhooks({ ...webhooks, customUrl: e.target.value })} onBlur={() => save(() => window.tiktok.setWebhooks(webhooks), 'Webhooks')} placeholder="Custom HTTP endpoint" className={inputCls} />
            </div>
          </Card>
        </div>

        <div className="space-y-4">
          <Card title="Fan ledger data">
            <FieldLabel>Data folder</FieldLabel>
            <div className="select-all rounded-lg px-3 py-2 font-mono text-[12px]" style={{ background: 'var(--fill-quaternary)', border: '1px solid var(--card-border)' }}>
              {dataDir || '—'}
            </div>
            <p className="mt-1.5 text-[12px]" style={{ color: 'var(--secondary-label)' }}>
              {fanCount === null ? '' : `${fanCount} fan${fanCount === 1 ? '' : 's'} in the ledger. `}
              Fans live in fans.json; every gift is appended to gifts.jsonl.
            </p>
            <div className="mt-3 flex flex-wrap gap-2">
              <button
                onClick={async () => {
                  const r = await window.tiktok.fansExportCsv();
                  if (r.ok) pushToast({ title: 'Exported', body: `Saved to ${r.path}` });
                  else if (r.error) pushToast({ title: 'Export failed', body: r.error });
                }}
                className="panel-btn no-drag"
              >
                Export all fans (CSV)
              </button>
              <button
                onClick={async () => {
                  const r = await window.tiktok.backupExport();
                  pushToast({ title: r.ok ? 'Backup saved' : 'Backup cancelled', body: r.path ?? '' });
                }}
                className="panel-btn no-drag"
              >
                Export app backup (JSON)
              </button>
              <button
                onClick={async () => {
                  const r = await window.tiktok.backupImport();
                  pushToast({ title: r.ok ? 'Backup restored' : 'Import cancelled', body: r.error ?? '' });
                }}
                className="panel-btn no-drag"
              >
                Import backup
              </button>
            </div>
          </Card>

          <Card title="Danger zone">
            <p className="mb-3 text-[12px]" style={{ color: 'var(--secondary-label)' }}>
              Permanently deletes all fans, the gift ledger and reminder history. Sessions and settings are kept.
            </p>
            <button
              onClick={async () => {
                if (!confirmClear) { setConfirmClear(true); return; }
                setConfirmClear(false);
                await window.tiktok.fansClear();
                setFanCount(0);
                pushToast({ title: 'Fan ledger cleared', body: 'All fans and gift records were deleted' });
              }}
              className="panel-btn no-drag !border-rose-500/50 !text-rose-400 hover:!bg-rose-500/10"
              style={{ border: '1px solid' }}
            >
              {confirmClear ? 'Click again to permanently delete' : 'Clear fan ledger…'}
            </button>
          </Card>
        </div>
      </div>
    </PageShell>
  );
}
