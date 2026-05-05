import { settings, type WebhookConfig } from './store';
import type { NormalizedEvent } from './tiktok';

function getConfig(): WebhookConfig {
  return settings.get('webhooks', {
    discordUrl: '',
    slackUrl: '',
    customUrl: '',
    events: { gifts: true, follows: true, keywords: false, milestones: true },
  });
}

async function postDiscord(url: string, content: string) {
  if (!url) return;
  try {
    await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ content }),
    });
  } catch (err) {
    console.error('[webhook] Discord error:', err);
  }
}

async function postSlack(url: string, text: string) {
  if (!url) return;
  try {
    await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text }),
    });
  } catch (err) {
    console.error('[webhook] Slack error:', err);
  }
}

async function postCustom(url: string, payload: object) {
  if (!url) return;
  try {
    await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
  } catch (err) {
    console.error('[webhook] Custom error:', err);
  }
}

export function dispatchWebhook(evt: NormalizedEvent, hostUsername: string) {
  const cfg = getConfig();
  const hasAnyUrl = cfg.discordUrl || cfg.slackUrl || cfg.customUrl;
  if (!hasAnyUrl) return;

  let message: string | null = null;
  let category: keyof WebhookConfig['events'] | null = null;

  switch (evt.type) {
    case 'gift': {
      const total = (evt.diamondCount || 0) * (evt.repeatCount || 1);
      message = `🎁 @${evt.user.nickname} sent ${evt.giftName}${evt.repeatCount > 1 ? ` x${evt.repeatCount}` : ''} (${total} diamonds) in @${hostUsername}`;
      category = 'gifts';
      break;
    }
    case 'follow':
      message = `➕ @${evt.user.nickname} followed in @${hostUsername}`;
      category = 'follows';
      break;
    default:
      return;
  }

  if (!category || !cfg.events[category]) return;
  if (!message) return;

  if (cfg.discordUrl) postDiscord(cfg.discordUrl, message);
  if (cfg.slackUrl) postSlack(cfg.slackUrl, message);
  if (cfg.customUrl) postCustom(cfg.customUrl, { type: evt.type, message, event: evt, host: hostUsername, ts: Date.now() });
}
