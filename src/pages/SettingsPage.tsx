/** Settings — full-page home for the options that previously lived only in the top-bar gear popover,
 *  plus CRM data management. The gear popover keeps working; this is the expanded view. */
import { useEffect, useState } from 'react';
import type { WebhookConfig } from '../types';
import { useAlerts } from '../state/alerts';
import { useSettings, useSettingsLoad, DEFAULT_THANK_TEMPLATE } from '../state/settings';
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

          <EarningsCard />
          <CommunityRulesCard />

          <Card title="Webhooks">
            <div className="space-y-2">
              <input value={webhooks.discordUrl} onChange={(e) => setWebhooks({ ...webhooks, discordUrl: e.target.value })} onBlur={() => save(() => window.tiktok.setWebhooks(webhooks), 'Webhooks')} placeholder="Discord webhook URL" className={inputCls} />
              <input value={webhooks.slackUrl} onChange={(e) => setWebhooks({ ...webhooks, slackUrl: e.target.value })} onBlur={() => save(() => window.tiktok.setWebhooks(webhooks), 'Webhooks')} placeholder="Slack webhook URL" className={inputCls} />
              <input value={webhooks.customUrl} onChange={(e) => setWebhooks({ ...webhooks, customUrl: e.target.value })} onBlur={() => save(() => window.tiktok.setWebhooks(webhooks), 'Webhooks')} placeholder="Custom HTTP endpoint" className={inputCls} />
            </div>
          </Card>
        </div>

        <div className="space-y-4">
          <ThankTemplateCard />

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

// ---------------------------------------------------------------------------
// Earnings estimate

function EarningsCard() {
  const pushToast = useAlerts((s) => s.pushToast);
  const { earnings, loaded } = useSettingsLoad();
  const [rate, setRate] = useState('');
  useEffect(() => { if (loaded) setRate(String(earnings.ratePer1000)); }, [loaded]); // eslint-disable-line react-hooks/exhaustive-deps

  const apply = (patch: Partial<typeof earnings>, rateStr = rate) => {
    const next = {
      ...earnings,
      ...patch,
      ratePer1000: Math.max(0, Number(rateStr) || 0),
    };
    useSettings.getState().setEarnings(next).then(() => pushToast({ title: 'Saved', body: 'Earnings estimate' }));
  };

  return (
    <Card title="Earnings estimate">
      <label className="flex items-center gap-2 text-[13px]">
        <input
          type="checkbox"
          checked={earnings.enabled}
          onChange={(e) => apply({ enabled: e.target.checked })}
          className="accent-pink-600"
        />
        Show an approximate money value next to diamond counts
      </label>
      <div className="mt-3 grid grid-cols-2 gap-3">
        <div>
          <FieldLabel>Per 1,000 diamonds</FieldLabel>
          <input
            value={rate}
            onChange={(e) => setRate(e.target.value.replace(/[^\d.]/g, ''))}
            onBlur={() => apply({})}
            inputMode="decimal"
            placeholder="10"
            className={inputCls}
          />
        </div>
        <div>
          <FieldLabel>Currency</FieldLabel>
          <select value={earnings.currency} onChange={(e) => apply({ currency: e.target.value as '£' | '$' | '€' })} className={inputCls}>
            <option value="£">£ GBP</option>
            <option value="$">$ USD</option>
            <option value="€">€ EUR</option>
          </select>
        </div>
      </div>
      <p className="mt-1.5 text-[12px]" style={{ color: 'var(--secondary-label)' }}>
        Estimates only — TikTok payout rates vary. Diamonds stay the primary unit everywhere.
      </p>
    </Card>
  );
}

// ---------------------------------------------------------------------------
// Community rules

function CommunityRulesCard() {
  const pushToast = useAlerts((s) => s.pushToast);
  const { community, loaded } = useSettingsLoad();
  const [draft, setDraft] = useState({ quiet: '14', bday: '30', regular: '100', vip: '1000', whale: '10000' });
  useEffect(() => {
    if (loaded) setDraft({
      quiet: String(community.quietDays),
      bday: String(community.birthdayWindowDays),
      regular: String(community.tiers.regular),
      vip: String(community.tiers.vip),
      whale: String(community.tiers.whale),
    });
  }, [loaded]); // eslint-disable-line react-hooks/exhaustive-deps

  const n = (s: string) => Math.floor(Number(s));
  const regular = n(draft.regular), vip = n(draft.vip), whale = n(draft.whale);
  const quiet = n(draft.quiet), bday = n(draft.bday);
  const tiersBad = !(regular > 0 && regular < vip && vip < whale);
  const daysBad = !(quiet >= 1 && quiet <= 365) || !(bday >= 1 && bday <= 365);

  const save = async () => {
    if (tiersBad || daysBad) return;
    const res = await useSettings.getState().setCommunity({
      quietDays: quiet,
      birthdayWindowDays: bday,
      tiers: { regular, vip, whale },
    });
    pushToast(res.ok
      ? { title: 'Saved', body: 'Community rules' }
      : { title: 'Not saved', body: res.error ?? 'Invalid values' });
  };

  const numInput = (key: keyof typeof draft, bad: boolean) => (
    <input
      value={draft[key]}
      onChange={(e) => setDraft({ ...draft, [key]: e.target.value.replace(/[^\d]/g, '') })}
      onBlur={save}
      inputMode="numeric"
      className={`${inputCls} ${bad ? '!border-rose-500/70' : ''}`}
    />
  );

  return (
    <Card title="Community rules">
      <div className="grid grid-cols-2 gap-3">
        <div>
          <FieldLabel>Quiet VIP after (days)</FieldLabel>
          {numInput('quiet', !(quiet >= 1 && quiet <= 365))}
        </div>
        <div>
          <FieldLabel>Birthday reminder window (days)</FieldLabel>
          {numInput('bday', !(bday >= 1 && bday <= 365))}
        </div>
      </div>
      <div className="mt-3">
        <FieldLabel>Tier thresholds (diamonds, ascending)</FieldLabel>
        <div className="grid grid-cols-3 gap-3">
          {([['regular', 'Regular ≥'], ['vip', 'VIP ≥'], ['whale', 'Whale ≥']] as const).map(([key, label]) => (
            <div key={key}>
              <div className="mb-1 text-[11px]" style={{ color: 'var(--secondary-label)' }}>{label}</div>
              {numInput(key, tiersBad)}
            </div>
          ))}
        </div>
        <p className="mt-1.5 text-[12px]" style={{ color: tiersBad ? '#fb7185' : 'var(--secondary-label)' }}>
          {tiersBad
            ? 'Thresholds must be ascending: Regular < VIP < Whale (and above 0).'
            : `New < ${regular.toLocaleString()} 💎 · Regular ≥ ${regular.toLocaleString()} · VIP ≥ ${vip.toLocaleString()} · Whale ≥ ${whale.toLocaleString()}`}
        </p>
      </div>
    </Card>
  );
}

// ---------------------------------------------------------------------------
// Thank-you template

function ThankTemplateCard() {
  const pushToast = useAlerts((s) => s.pushToast);
  const { thankTemplate, loaded } = useSettingsLoad();
  const [tpl, setTpl] = useState('');
  useEffect(() => { if (loaded) setTpl(thankTemplate); }, [loaded]); // eslint-disable-line react-hooks/exhaustive-deps

  const save = (value: string) => {
    useSettings.getState().setThankTemplate(value || DEFAULT_THANK_TEMPLATE).then(() =>
      pushToast({ title: 'Saved', body: 'Thank-you template' }),
    );
  };

  return (
    <Card title="Thank-you message template">
      <textarea
        value={tpl}
        onChange={(e) => setTpl(e.target.value)}
        onBlur={() => save(tpl.trim())}
        rows={3}
        className={`${inputCls} resize-y leading-relaxed`}
      />
      <p className="mt-1.5 text-[12px]" style={{ color: 'var(--secondary-label)' }}>
        Used to prefill the thank-you composer. Placeholders: <code>{'{nickname}'}</code> and <code>{'{giftName}'}</code> (their latest gift).
      </p>
      <button
        onClick={() => { setTpl(DEFAULT_THANK_TEMPLATE); save(DEFAULT_THANK_TEMPLATE); }}
        className="panel-btn no-drag mt-2"
      >
        Reset to default
      </button>
    </Card>
  );
}
