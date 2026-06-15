/**
 * 💬 Messages — embedded TikTok web (your own session) + follow-up list.
 *
 * LEFT: a plain user-driven <webview> on https://www.tiktok.com/messages.
 * The user logs in inside it once; the session lives in its own persistent
 * partition ("persist:tiktok-web") so the login survives app restarts.
 *
 * HONESTY RAILS: we never inject scripts, never read the page, never click or
 * type on the user's behalf. The webview is just a browser pane. Navigation is
 * allowlisted to tiktok.com (+ login hosts) in electron/main.ts.
 *
 * RIGHT: "Follow-up list" — our OWN ledger's reminders (thank-after-LIVE,
 * birthdays, quiet VIPs). Copy the message, open their profile in the webview,
 * and send it yourself.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import {
  ArrowLeft, ArrowRight, RotateCw, Lock, MessageSquare, UserRound,
  Heart, Cake, Clock, Copy, ExternalLink, Check, Settings as SettingsIcon,
} from 'lucide-react';
import type { Reminder } from '../types';
import { useUI } from '../state/ui';
import { useAlerts } from '../state/alerts';
import { copyText, buildThankMessage } from '../components/ThankComposer';
import { FanAvatar, TierChip, fanName } from '../components/crm';
import { Tooltip } from '../components/ui';

const TIKTOK_MESSAGES_URL = 'https://www.tiktok.com/messages';
/** Realistic Chrome UA — TikTok web blocks/limits the default Electron UA. */
const CHROME_UA =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';

const profileUrl = (uniqueId: string) => `https://www.tiktok.com/@${encodeURIComponent(uniqueId)}`;

/** Minimal surface of Electron's <webview> element we use (no executeJavaScript — by design). */
interface WebviewEl extends HTMLElement {
  src: string;
  canGoBack(): boolean;
  canGoForward(): boolean;
  goBack(): void;
  goForward(): void;
  reload(): void;
  loadURL(url: string): Promise<void>;
  getURL(): string;
}

/** The <webview> tag only exists inside Electron — browser demo gets a placeholder. */
const IS_ELECTRON = typeof navigator !== 'undefined' && navigator.userAgent.includes('Electron');

const KIND_ORDER: Record<Reminder['kind'], number> = { thank: 0, birthday: 1, quiet: 2 };

function reasonFor(r: Reminder): string {
  if (r.kind === 'thank') {
    return r.days === 0 ? 'Sent gifts in your last LIVE — say thanks' : `Gifted ${r.days} day${r.days === 1 ? '' : 's'} ago — say thanks`;
  }
  if (r.kind === 'birthday') {
    return r.days === 0 ? 'Birthday today! 🎂' : `Birthday in ${r.days} day${r.days === 1 ? '' : 's'}`;
  }
  return `Quiet for ${r.days} days`;
}

function KindIcon({ kind }: { kind: Reminder['kind'] }) {
  if (kind === 'thank') return <Heart size={13} className="flex-none" style={{ color: '#ff5b85' }} fill="#ff5b85" />;
  if (kind === 'birthday') return <Cake size={13} className="flex-none" style={{ color: '#f59e0b' }} />;
  return <Clock size={13} className="flex-none" style={{ color: '#a78bfa' }} />;
}

export function MessagesPage() {
  const pushToast = useAlerts((s) => s.pushToast);
  const setPage = useUI((s) => s.setPage);
  const messagesFanFocus = useUI((s) => s.messagesFanFocus);
  const setMessagesFanFocus = useUI((s) => s.setMessagesFanFocus);

  const webviewRef = useRef<WebviewEl | null>(null);
  const [navState, setNavState] = useState({ canBack: false, canForward: false, host: 'www.tiktok.com' });
  /** Focus values we've already navigated for (or that came from local row clicks). */
  const consumedFocus = useRef<string | null>(null);

  const [reminders, setReminders] = useState<Reminder[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [leaving, setLeaving] = useState<Set<string>>(new Set());

  const refresh = useCallback(() => {
    window.tiktok.remindersList()
      .then((r) => {
        const sorted = [...(r ?? [])].sort((a, b) =>
          KIND_ORDER[a.kind] !== KIND_ORDER[b.kind] ? KIND_ORDER[a.kind] - KIND_ORDER[b.kind] : a.days - b.days);
        setReminders(sorted);
        setLoaded(true);
      })
      .catch(() => setLoaded(true));
  }, []);
  useEffect(() => { refresh(); }, [refresh]);

  // Webview navigation chrome (read-only: we only listen to navigation events).
  const attachWebview = useCallback((el: WebviewEl | null) => {
    webviewRef.current = el;
    if (!el) return;
    const update = () => {
      try {
        const url = el.getURL();
        setNavState({ canBack: el.canGoBack(), canForward: el.canGoForward(), host: url ? new URL(url).hostname : '…' });
      } catch { /* not ready yet */ }
    };
    el.addEventListener('did-navigate', update);
    el.addEventListener('did-navigate-in-page', update);
    el.addEventListener('dom-ready', update);
  }, []);

  const navigateTo = useCallback((url: string) => {
    const wv = webviewRef.current;
    if (!wv) return;
    wv.loadURL(url).catch(() => { wv.src = url; });
  }, []);

  // Arriving via "Open in Messages tab" (ThankComposer): navigate to that fan's profile once.
  useEffect(() => {
    if (!messagesFanFocus || consumedFocus.current === messagesFanFocus) return;
    consumedFocus.current = messagesFanFocus;
    if (IS_ELECTRON) {
      // Webview may not be mounted yet on first render — retry shortly.
      const t = setTimeout(() => navigateTo(profileUrl(messagesFanFocus)), 300);
      return () => clearTimeout(t);
    }
  }, [messagesFanFocus, navigateTo]);

  const selectRow = (uniqueId: string) => {
    consumedFocus.current = uniqueId; // local selection — don't auto-navigate
    setMessagesFanFocus(uniqueId);
  };

  const copyFor = async (r: Reminder) => {
    const { message } = await buildThankMessage(r.fan.uniqueId, fanName(r.fan));
    const ok = await copyText(message);
    pushToast(ok
      ? { title: 'Copied — paste it in TikTok', body: `Message for @${r.fan.uniqueId}` }
      : { title: 'Copy failed', body: 'Open the composer and copy manually' });
  };

  const openChat = (r: Reminder) => {
    selectRow(r.fan.uniqueId);
    if (IS_ELECTRON) {
      navigateTo(profileUrl(r.fan.uniqueId));
    } else {
      window.tiktok.openExternal(profileUrl(r.fan.uniqueId)).catch(() => {});
    }
  };

  const markDone = async (r: Reminder) => {
    setLeaving((s) => new Set(s).add(r.id));
    // Let the row animate out before it disappears from the list.
    await new Promise((res) => setTimeout(res, 260));
    const res = r.kind === 'thank'
      ? await window.tiktok.fansMarkThanked(r.fan.uniqueId)
      : await window.tiktok.reminderAction({ id: r.id, action: 'done' });
    if (res.ok) {
      pushToast({ title: r.kind === 'thank' ? 'Marked thanked 💌' : 'Marked done', body: `@${r.fan.uniqueId}` });
    } else {
      pushToast({ title: 'Action failed', body: res.error ?? 'Unknown error' });
    }
    setLeaving((s) => { const n = new Set(s); n.delete(r.id); return n; });
    refresh();
  };

  const selected = messagesFanFocus;

  return (
    <div className="flex min-h-0 flex-1 gap-3 overflow-hidden p-3">
      {/* LEFT/CENTER — TikTok web */}
      <section className="glass flex min-w-0 flex-1 flex-col overflow-hidden" style={{ borderRadius: 18 }}>
        {/* Browser chrome */}
        <div className="flex flex-none items-center gap-1.5 border-b px-2.5 py-1.5" style={{ borderColor: 'var(--separator)' }}>
          <Tooltip content="Back">
            <button onClick={() => webviewRef.current?.goBack()} disabled={!navState.canBack} className="panel-btn panel-btn-icon no-drag" aria-label="Back">
              <ArrowLeft size={14} />
            </button>
          </Tooltip>
          <Tooltip content="Forward">
            <button onClick={() => webviewRef.current?.goForward()} disabled={!navState.canForward} className="panel-btn panel-btn-icon no-drag" aria-label="Forward">
              <ArrowRight size={14} />
            </button>
          </Tooltip>
          <Tooltip content="Reload">
            <button onClick={() => webviewRef.current?.reload()} className="panel-btn panel-btn-icon no-drag" aria-label="Reload">
              <RotateCw size={13} />
            </button>
          </Tooltip>
          <Tooltip content="Your own TikTok session — nothing is automated">
            <span
              className="ml-1 inline-flex min-w-0 items-center gap-1.5 truncate rounded-full px-2.5 py-1 text-[11px] font-medium"
              style={{ background: 'var(--fill-thin)', border: '1px solid var(--card-border)', color: 'var(--secondary-label)' }}
            >
              <Lock size={11} className="flex-none" style={{ color: '#22c55e' }} />
              <span className="truncate">{navState.host}</span>
            </span>
          </Tooltip>
          <span className="ml-auto flex flex-none items-center gap-1.5">
            <Tooltip content="Go to your TikTok inbox">
              <button onClick={() => navigateTo(TIKTOK_MESSAGES_URL)} className="panel-btn no-drag">
                <MessageSquare size={12} /> Messages
              </button>
            </Tooltip>
            <Tooltip content={selected ? `Open @${selected}'s profile` : 'Select a fan in the follow-up list first'}>
              <button
                onClick={() => selected && navigateTo(profileUrl(selected))}
                disabled={!selected}
                className="panel-btn no-drag"
              >
                <UserRound size={12} /> {selected ? `@${selected}` : 'Profile of selected fan'}
              </button>
            </Tooltip>
          </span>
        </div>

        {/* The webview itself (Electron) or an honest placeholder (browser demo). */}
        <div className="relative min-h-0 flex-1 overflow-hidden bg-black/20">
          {IS_ELECTRON ? (
            <webview
              ref={attachWebview as React.Ref<HTMLWebViewElement>}
              src={TIKTOK_MESSAGES_URL}
              className="h-full w-full"
              partition="persist:tiktok-web"
              useragent={CHROME_UA}
              // @ts-expect-error allowpopups is a valid webview attribute (login popups)
              allowpopups="true"
            />
          ) : (
            <div className="flex h-full flex-col items-center justify-center gap-3 p-10 text-center">
              <MessageSquare size={40} style={{ color: 'var(--secondary-label)' }} />
              <h2 className="text-base font-extrabold">TikTok web embeds inside the desktop app</h2>
              <p className="max-w-sm text-[13px]" style={{ color: 'var(--secondary-label)' }}>
                In the desktop app this pane is tiktok.com/messages with your own login —
                you read and send every message yourself. The follow-up list on the right works everywhere.
              </p>
            </div>
          )}
        </div>
      </section>

      {/* RIGHT — Follow-up list (our ledger only) */}
      <aside className="glass flex w-[300px] flex-none flex-col overflow-hidden" style={{ borderRadius: 18 }}>
        <header className="flex flex-none items-center gap-2 border-b px-3.5 py-3" style={{ borderColor: 'var(--separator)' }}>
          <span className="min-w-0 flex-1 leading-tight">
            <span className="block text-[13px] font-extrabold">Follow-up list</span>
            <span className="block text-[11px]" style={{ color: 'var(--secondary-label)' }}>
              {reminders.length === 0 ? 'Nobody waiting' : `${reminders.length} ${reminders.length === 1 ? 'person' : 'people'} to reach out to`}
            </span>
          </span>
          <Tooltip content="Edit message templates in Settings">
            <button onClick={() => setPage('settings')} className="panel-btn panel-btn-icon no-drag" aria-label="Templates">
              <SettingsIcon size={14} />
            </button>
          </Tooltip>
        </header>

        <div className="min-h-0 flex-1 overflow-y-auto px-2 py-1.5">
          {loaded && reminders.length === 0 ? (
            <div className="flex h-full flex-col items-center justify-center gap-3 p-6 text-center">
              <img src="./assets/png/icon_heart_3d.png" alt="" className="h-16 w-16 object-contain" draggable={false} />
              <div className="text-sm font-extrabold">All caught up 💕</div>
              <p className="text-[12px]" style={{ color: 'var(--secondary-label)' }}>
                No thank-yous, birthdays or quiet VIPs right now.
              </p>
            </div>
          ) : (
            <ul>
              {reminders.map((r) => {
                const isLeaving = leaving.has(r.id);
                const isSelected = selected === r.fan.uniqueId;
                return (
                  <li
                    key={r.id}
                    onClick={() => selectRow(r.fan.uniqueId)}
                    className="mb-1.5 cursor-pointer rounded-xl p-2.5 transition-all duration-300"
                    style={{
                      background: isSelected ? 'rgba(238,29,82,0.10)' : 'var(--fill-thin)',
                      border: `1px solid ${isSelected ? 'rgba(238,29,82,0.35)' : 'var(--card-border)'}`,
                      opacity: isLeaving ? 0 : 1,
                      transform: isLeaving ? 'translateX(24px)' : 'none',
                    }}
                  >
                    <div className="flex items-center gap-2.5">
                      <FanAvatar name={fanName(r.fan)} url={r.fan.avatarUrl} size={30} />
                      <span className="min-w-0 flex-1 leading-tight">
                        <span className="flex items-center gap-1.5">
                          <span className="truncate text-[12px] font-bold">{fanName(r.fan)}</span>
                          <TierChip tier={r.fan.tier} />
                        </span>
                        <span className="block truncate text-[11px]" style={{ color: 'var(--secondary-label)' }}>@{r.fan.uniqueId}</span>
                      </span>
                    </div>
                    <div className="mt-1.5 flex items-center gap-1.5 text-[11px]" style={{ color: 'var(--secondary-label)' }}>
                      <KindIcon kind={r.kind} />
                      <span className="truncate">{reasonFor(r)}</span>
                    </div>
                    <div className="mt-2 flex items-center gap-1.5">
                      <Tooltip content="Copy thank-you message (from your template)">
                        <button onClick={(e) => { e.stopPropagation(); copyFor(r); }} className="panel-btn no-drag flex-1">
                          <Copy size={11} /> Copy
                        </button>
                      </Tooltip>
                      <Tooltip content="Open their profile in the TikTok pane — tap Message there">
                        <button onClick={(e) => { e.stopPropagation(); openChat(r); }} className="panel-btn no-drag flex-1">
                          <ExternalLink size={11} /> Open chat
                        </button>
                      </Tooltip>
                      <Tooltip content="Done — clears this reminder">
                        <button onClick={(e) => { e.stopPropagation(); markDone(r); }} className="panel-btn panel-btn-primary panel-btn-icon no-drag" aria-label="Done">
                          <Check size={13} />
                        </button>
                      </Tooltip>
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      </aside>
    </div>
  );
}
