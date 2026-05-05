import fs from 'node:fs';
import path from 'node:path';
import { settings } from './store';
import { chatlogsDir } from './paths';
import type { NormalizedEvent } from './tiktok';

let stream: fs.WriteStream | null = null;
let currentHost: string | null = null;

function logDir(): string {
  return chatlogsDir();
}

export function startLog(hostUsername: string) {
  if (!settings.get('chatLogEnabled', false)) return;
  stopLog();
  currentHost = hostUsername;
  const ts = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
  const file = path.join(logDir(), `${hostUsername}_${ts}.txt`);
  stream = fs.createWriteStream(file, { flags: 'a' });
  stream.write(`=== Chat log for @${hostUsername} — ${new Date().toLocaleString()} ===\n\n`);
}

export function appendLog(evt: NormalizedEvent) {
  if (!stream) return;
  const ts = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
  switch (evt.type) {
    case 'chat':
      stream.write(`[${ts}] ${evt.user.nickname}: ${evt.comment}\n`);
      break;
    case 'gift':
      stream.write(`[${ts}] 🎁 ${evt.user.nickname} sent ${evt.giftName}${evt.repeatCount > 1 ? ` x${evt.repeatCount}` : ''}\n`);
      break;
    case 'follow':
      stream.write(`[${ts}] ➕ ${evt.user.nickname} followed\n`);
      break;
    case 'subscribe':
      stream.write(`[${ts}] ⭐ ${evt.user.nickname} subscribed\n`);
      break;
    case 'questionNew':
      stream.write(`[${ts}] ❓ ${evt.user.nickname}: ${evt.question}\n`);
      break;
  }
}

export function stopLog() {
  if (stream) {
    stream.write(`\n=== Log ended ${new Date().toLocaleString()} ===\n`);
    stream.end();
    stream = null;
  }
  currentHost = null;
}

export function getLogDir(): string {
  return logDir();
}
