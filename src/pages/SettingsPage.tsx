/** Settings — full-page home for the options that previously lived only in the top-bar gear popover,
 *  plus CRM data management. The gear popover keeps working; this is the expanded view. */
import { useEffect, useState } from 'react';
import type { WebhookConfig } from '../types';
import { useAlerts } from '../state/alerts';
import { useSettings, useSettingsLoad, DEFAULT_THANK_TEMPLATE } from '../state/settings';
import { PageShell, FieldLabel, inputCls } from '../components/crm';
import { Switch, Select } from '../components/ui';

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
  const [aiConsent, setAiConsent] = useState(false);
  const [checkingUpdate, setCheckingUpdate] = useState(false);
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
      setAiConsent(s.aiSummaryConsented ?? false);
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
      <div className="grid grid-cols-1 items-start gap-4 lg:grid-cols-2">
        <div className="space-y-4">
          <MyAccountCard />

          <Card title="Connection">
            <FieldLabel>EulerStream API key (optional)</FieldLabel>
            <div className="flex gap-2">
              <input value={signKey} onChange={(e) => setSignKey(e.target.value)} placeholder="Paste your EulerStream key" className={inputCls} />
              <button onClick={() => save(() => window.tiktok.setSignApiKey(signKey), 'EulerStream API key')} className="panel-btn panel-btn-primary no-drag">Save</button>
            </div>
            <p className="mt-1.5 text-[12px]" style={{ color: 'var(--secondary-label)' }}>
              TikTok's signing service rate-limits anonymous connections. A free key at eulerstream.com gives
              1,000 requests/day and steadier connections — fewer mid-stream drops.
            </p>
            <a
              href="https://www.eulerstream.com"
              target="_blank"
              rel="noreferrer"
              className="panel-btn no-drag mt-2 inline-flex"
            >
              Get a free key at eulerstream.com ↗
            </a>
            <div className="mt-3 rounded-lg p-3" style={{ background: 'var(--fill-quaternary)', border: '1px solid var(--card-border)' }}>
              <p className="text-[12px]" style={{ color: 'var(--secondary-label)' }}>
                <span className="font-semibold" style={{ color: 'var(--label)' }}>In-app live video + viewer stats</span> use
                EulerStream's <span style={{ color: 'var(--label)' }}>room_info</span> endpoint, which needs a paid
                Business/Premium plan. The free key above still signs your connection — comments, gifts, likes and the
                fan ledger all work without it. Without a paid key the player falls back to the Mobile (TikTok web) view.
              </p>
              <a
                href="https://www.eulerstream.com/pricing"
                target="_blank"
                rel="noreferrer"
                className="panel-btn no-drag mt-2 inline-flex"
              >
                See EulerStream pricing ↗
              </a>
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
              <div className="mt-2 rounded-lg p-3" style={{ background: 'var(--fill-quaternary)', border: '1px solid var(--card-border)' }}>
                <p className="text-[12px]" style={{ color: 'var(--secondary-label)' }}>
                  Session summaries send up to ~600 lines of chat text plus gifter usernames and
                  audience questions to Anthropic's API to generate the summary. Your key, your data —
                  it leaves your device only for this, and only when you run a summary.
                </p>
                <div className="mt-2 flex items-start gap-2 text-[13px]">
                  <Switch
                    checked={aiConsent}
                    onCheckedChange={(val) => {
                      setAiConsent(val);
                      save(() => window.tiktok.setAiSummaryConsent(val), 'AI summary consent');
                    }}
                    className="mt-0.5"
                    ariaLabel="Allow AI session summaries to send chat text and usernames to Anthropic"
                  />
                  <span>I understand and allow AI session summaries to send chat text + usernames to Anthropic.</span>
                </div>
              </div>
            </div>
            <div className="mt-4 flex flex-col gap-2 text-[13px]">
              <Switch
                checked={autoConnect}
                onCheckedChange={(val) => { setAutoConnect(val); save(() => window.tiktok.setAutoConnect(val), 'Auto-connect'); }}
                label="Auto-connect to last user on launch"
              />
              <Switch
                checked={chatLog}
                onCheckedChange={(val) => { setChatLog(val); save(() => window.tiktok.setChatLog(val), 'Chat log'); }}
                label="Save chat log to disk"
              />
            </div>
            <div className="mt-4">
              <FieldLabel>Diagnostics</FieldLabel>
              <p className="mb-2 text-[12px]" style={{ color: 'var(--secondary-label)' }}>
                Hit a crash or a connection that broke for no clear reason? Open the logs folder and attach
                <code> main.log</code> to a support ticket.
              </p>
              <div className="flex flex-wrap gap-2">
                <button
                  onClick={async () => {
                    const r = await window.tiktok.revealLogs();
                    if (r.ok) pushToast({ title: 'Logs folder opened', body: r.path });
                    else pushToast({ title: 'Could not open logs', body: r.error ?? r.path });
                  }}
                  className="panel-btn no-drag"
                >
                  Reveal logs
                </button>
                <button
                  onClick={async () => {
                    setCheckingUpdate(true);
                    try {
                      const r = await window.tiktok.checkForUpdates();
                      pushToast({ title: r.ok ? 'Update check' : 'Updates unavailable', body: r.message });
                    } catch {
                      pushToast({ title: 'Updates unavailable', body: 'Could not check for updates.' });
                    } finally {
                      setCheckingUpdate(false);
                    }
                  }}
                  disabled={checkingUpdate}
                  className="panel-btn no-drag"
                >
                  {checkingUpdate ? 'Checking…' : 'Check for updates'}
                </button>
              </div>
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

          <GoLiveAlertsCard />
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
// My TikTok account

function MyAccountCard() {
  const pushToast = useAlerts((s) => s.pushToast);
  const { myAccount, loaded } = useSettingsLoad();
  const [handle, setHandle] = useState('');
  useEffect(() => { if (loaded) setHandle(myAccount.username); }, [loaded]); // eslint-disable-line react-hooks/exhaustive-deps

  const saveHandle = async () => {
    const next = await useSettings.getState().setMyAccount({
      username: handle,
      nickname: myAccount.nickname,
      avatarUrl: myAccount.avatarUrl,
    });
    setHandle(next.username);
    pushToast({ title: 'Saved', body: next.username ? `Your account: @${next.username}` : 'Cleared your account' });
  };

  return (
    <Card title="My TikTok account">
      <FieldLabel>Your @username</FieldLabel>
      <div className="flex gap-2">
        <div className="relative flex flex-1 items-center">
          <span className="pointer-events-none absolute left-3 text-[13px] font-semibold" style={{ color: 'var(--secondary-label)' }}>@</span>
          <input
            value={handle}
            onChange={(e) => setHandle(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') saveHandle(); }}
            placeholder="yourusername"
            className={`${inputCls} !pl-7`}
          />
        </div>
        <button onClick={saveHandle} className="panel-btn panel-btn-primary no-drag">Save</button>
      </div>
      <p className="mt-1.5 text-[12px]" style={{ color: 'var(--secondary-label)' }}>
        Set your own TikTok handle so the app knows which streams are yours — powers your dashboard identity
        and a one-tap Connect to your LIVE.
      </p>
      {myAccount.username && (
        <div className="mt-3 flex items-center gap-3 rounded-lg p-3" style={{ background: 'var(--fill-quaternary)', border: '1px solid var(--card-border)' }}>
          {myAccount.avatarUrl ? (
            <img src={myAccount.avatarUrl} alt="" className="h-9 w-9 flex-none rounded-full object-cover" draggable={false} />
          ) : (
            <span className="flex h-9 w-9 flex-none items-center justify-center rounded-full text-sm font-bold text-white" style={{ background: 'var(--brand-pink, #EE1D52)' }}>
              {myAccount.username.charAt(0).toUpperCase()}
            </span>
          )}
          <div className="min-w-0 leading-tight">
            <div className="truncate text-[13px] font-semibold">{myAccount.nickname || `@${myAccount.username}`}</div>
            <div className="truncate text-[12px]" style={{ color: 'var(--secondary-label)' }}>@{myAccount.username}</div>
          </div>
        </div>
      )}
    </Card>
  );
}

// ---------------------------------------------------------------------------
// Go-live desktop alerts

function GoLiveAlertsCard() {
  const pushToast = useAlerts((s) => s.pushToast);
  const [notify, setNotify] = useState(true);
  const [loaded, setLoaded] = useState(false);
  useEffect(() => {
    window.tiktok.getSettings().then((s) => {
      setNotify(s.notifyOnGoLive ?? true);
      setLoaded(true);
    }).catch(() => setLoaded(true));
  }, []);

  const toggle = async (val: boolean) => {
    setNotify(val);
    try {
      await window.tiktok.setNotifyOnGoLive(val);
      pushToast({ title: 'Saved', body: 'Go-live alerts' });
    } catch {
      pushToast({ title: 'Save failed', body: 'Go-live alerts' });
    }
  };

  return (
    <Card title="Go-live alerts">
      <div className="flex items-start gap-2 text-[13px]">
        <Switch
          checked={notify}
          disabled={!loaded}
          onCheckedChange={toggle}
          className="mt-0.5"
          ariaLabel="Desktop notification when a watched creator goes live"
        />
        <span>Desktop notification when a watched creator goes live.</span>
      </div>
      <p className="mt-1.5 text-[12px]" style={{ color: 'var(--secondary-label)' }}>
        Fires a native OS notification — even when the app is in the background — for creators on your
        Go-Live Watchlist that have alerts switched on. Click the notification to jump straight to their LIVE.
      </p>
    </Card>
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
      <Switch
        checked={earnings.enabled}
        onCheckedChange={(val) => apply({ enabled: val })}
        label="Show an approximate money value next to diamond counts"
      />
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
          <Select
            value={earnings.currency}
            onValueChange={(val) => apply({ currency: val as '£' | '$' | '€' })}
            ariaLabel="Currency"
            className={`${inputCls} !w-full`}
            options={[
              { value: '£', label: '£ GBP' },
              { value: '$', label: '$ USD' },
              { value: '€', label: '€ EUR' },
            ]}
          />
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
