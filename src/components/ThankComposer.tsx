/**
 * 💌 Thank-you composer — the flagship follow-up interaction.
 *
 * TikTok has no DM API, so the honest route is: compose → copy to clipboard →
 * open the fan's profile → paste it yourself. "Mark thanked" stamps the ledger
 * (Fan.lastThankedAt) and closes any open thank/birthday reminders.
 */
import { useEffect, useState } from 'react';
import type { Fan, GiftRecord } from '../types';
import { useAlerts } from '../state/alerts';
import { useSettings } from '../state/settings';
import { useUI } from '../state/ui';
import { FieldLabel } from './crm';
import { useDialog } from './useDialog';

/** Clipboard write with execCommand fallback (browser demo / older webviews). */
export async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    try {
      const ta = document.createElement('textarea');
      ta.value = text;
      ta.style.position = 'fixed';
      ta.style.opacity = '0';
      document.body.appendChild(ta);
      ta.select();
      const ok = document.execCommand('copy');
      ta.remove();
      return ok;
    } catch {
      return false;
    }
  }
}

export function renderThankTemplate(tpl: string, nickname: string, giftName: string | null): string {
  return tpl
    .replaceAll('{nickname}', nickname)
    .replaceAll('{giftName}', giftName ?? 'love and support');
}

/**
 * Build the ready-to-paste thank-you message for a fan: settings template +
 * ledger name + their latest gift. Shared by ThankComposer and the Messages
 * page's follow-up list so the wording always matches.
 */
export async function buildThankMessage(
  uniqueId: string,
  fallbackName?: string,
): Promise<{ fan: Fan | null; message: string }> {
  const [f, gifts] = await Promise.all([
    window.tiktok.fansGet(uniqueId).catch(() => null),
    window.tiktok.giftsList({ fan: uniqueId, range: 'all', pageSize: 1 }).catch(() => null),
    useSettings.getState().load(),
  ]);
  const name = f?.displayName || f?.nickname || fallbackName || uniqueId;
  const lastGift: GiftRecord | undefined = gifts?.data?.[0];
  return {
    fan: f ?? null,
    message: renderThankTemplate(useSettings.getState().thankTemplate, name, lastGift?.giftName ?? null),
  };
}

export function ThankComposer({
  uniqueId,
  nickname,
  onClose,
  onThanked,
}: {
  uniqueId: string;
  /** fallback display name when the fan isn't in the ledger yet */
  nickname?: string;
  onClose: () => void;
  /** called after "Mark thanked" succeeds (refresh lists, etc.) */
  onThanked?: (fan?: Fan) => void;
}) {
  const pushToast = useAlerts((s) => s.pushToast);
  const { ref: dialogRef, dialogProps } = useDialog<HTMLDivElement>(onClose);
  const [message, setMessage] = useState('');
  const [fan, setFan] = useState<Fan | null>(null);
  const [ready, setReady] = useState(false);
  const [marking, setMarking] = useState(false);

  useEffect(() => {
    let alive = true;
    buildThankMessage(uniqueId, nickname).then(({ fan: f, message: msg }) => {
      if (!alive) return;
      setFan(f);
      setMessage(msg);
      setReady(true);
    });
    return () => { alive = false; };
  }, [uniqueId, nickname]);

  const copy = async (): Promise<boolean> => {
    const ok = await copyText(message);
    pushToast(ok
      ? { title: 'Copied — paste it in TikTok', body: `Thank-you message for @${uniqueId}` }
      : { title: 'Copy failed', body: 'Select the text and copy it manually' });
    return ok;
  };

  const copyAndOpen = async () => {
    await copy();
    const res = await window.tiktok.openExternal(`https://www.tiktok.com/@${encodeURIComponent(uniqueId)}`);
    if (!res.ok) pushToast({ title: 'Could not open profile', body: res.error ?? 'Unknown error' });
  };

  /** Copy + jump to the in-app Messages tab with this fan selected (webview opens their profile). */
  const copyAndOpenInMessages = async () => {
    await copy();
    useUI.getState().openMessagesFor(uniqueId);
    onClose();
  };

  const markThanked = async () => {
    setMarking(true);
    const res = await window.tiktok.fansMarkThanked(uniqueId);
    setMarking(false);
    if (res.ok) {
      pushToast({ title: 'Marked thanked 💌', body: `@${uniqueId} — reminders cleared` });
      onThanked?.(res.fan);
      onClose();
    } else {
      pushToast({ title: 'Could not mark thanked', body: res.error ?? 'Unknown error' });
    }
  };

  const displayName = fan?.displayName || fan?.nickname || nickname || uniqueId;

  return (
    <>
      <div className="fixed inset-0 z-[80] bg-black/50 backdrop-blur-sm" onClick={onClose} />
      <div ref={dialogRef} {...dialogProps} className="glass fixed left-1/2 top-1/2 z-[90] w-[420px] -translate-x-1/2 -translate-y-1/2 p-5 shadow-2xl" style={{ borderRadius: 18 }} role="dialog" aria-modal="true" aria-label={`Thank ${displayName}`}>
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-base font-extrabold">Thank {displayName} 💌</h2>
          <button onClick={onClose} className="panel-btn panel-btn-icon no-drag" aria-label="Close">✕</button>
        </div>
        <p className="mb-3 text-[12px]" style={{ color: 'var(--secondary-label)' }}>
          TikTok doesn&apos;t allow apps to send DMs — copy the message, open their profile and paste it yourself.
        </p>
        <FieldLabel>Message</FieldLabel>
        <textarea
          value={ready ? message : 'Loading…'}
          onChange={(e) => setMessage(e.target.value)}
          rows={4}
          disabled={!ready}
          className="w-full resize-y rounded-lg border border-zinc-700/60 bg-transparent px-3 py-2 text-[13px] leading-relaxed outline-none focus:border-pink-500/60"
        />
        {fan?.lastThankedAt ? (
          <div className="mt-1 text-[11px]" style={{ color: 'var(--secondary-label)' }}>
            Last thanked {new Date(fan.lastThankedAt).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' })}
          </div>
        ) : null}
        <div className="mt-4 flex flex-wrap items-center justify-end gap-2">
          <button onClick={copy} disabled={!ready} className="panel-btn no-drag">Copy message</button>
          <button onClick={copyAndOpen} disabled={!ready} className="panel-btn no-drag">Copy &amp; open profile ↗</button>
          <button onClick={copyAndOpenInMessages} disabled={!ready} className="panel-btn no-drag" title="Copy and open their profile in the in-app Messages tab">
            Open in Messages tab
          </button>
          <button onClick={markThanked} disabled={!ready || marking || !fan} className="panel-btn panel-btn-primary no-drag" title={fan ? undefined : 'Not in your ledger yet'}>
            Mark thanked ✓
          </button>
        </div>
      </div>
    </>
  );
}
