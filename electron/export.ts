import { dialog, BrowserWindow } from 'electron';
import fs from 'node:fs';
import type { SessionRecord } from './sessions';

function escapeCsv(val: string): string {
  if (val.includes(',') || val.includes('"') || val.includes('\n')) {
    return `"${val.replace(/"/g, '""')}"`;
  }
  return val;
}

function formatTs(ts: number): string {
  return new Date(ts).toISOString();
}

export function sessionToCsvComments(rec: SessionRecord): string {
  const rows = [['Timestamp', 'User', 'Handle', 'Comment'].join(',')];
  for (const e of rec.events) {
    if (e.type !== 'chat' || !e.comment) continue;
    rows.push(
      [
        formatTs(e.ts),
        escapeCsv(e.user?.nickname ?? ''),
        escapeCsv(e.user?.uniqueId ?? ''),
        escapeCsv(e.comment),
      ].join(','),
    );
  }
  return rows.join('\n');
}

export function sessionToCsvGifts(rec: SessionRecord): string {
  const rows = [['Timestamp', 'User', 'Handle', 'Gift', 'Count', 'Diamonds'].join(',')];
  for (const e of rec.events) {
    if (e.type !== 'gift') continue;
    rows.push(
      [
        formatTs(e.ts),
        escapeCsv(e.user?.nickname ?? ''),
        escapeCsv(e.user?.uniqueId ?? ''),
        escapeCsv(e.giftName ?? ''),
        String(e.repeatCount ?? 1),
        String((e.diamondCount ?? 0) * (e.repeatCount ?? 1)),
      ].join(','),
    );
  }
  return rows.join('\n');
}

export function sessionToCsvAll(rec: SessionRecord): string {
  const rows = [['Timestamp', 'Type', 'User', 'Handle', 'Detail'].join(',')];
  for (const e of rec.events) {
    let detail = '';
    if (e.type === 'chat') detail = e.comment ?? '';
    else if (e.type === 'gift')
      detail = `${e.giftName ?? ''}${e.repeatCount && e.repeatCount > 1 ? ` x${e.repeatCount}` : ''} (${(e.diamondCount ?? 0) * (e.repeatCount ?? 1)} diamonds)`;
    else if (e.type === 'questionNew') detail = e.question ?? '';
    rows.push(
      [
        formatTs(e.ts),
        e.type,
        escapeCsv(e.user?.nickname ?? ''),
        escapeCsv(e.user?.uniqueId ?? ''),
        escapeCsv(detail),
      ].join(','),
    );
  }
  return rows.join('\n');
}

export function sessionToSummaryText(rec: SessionRecord): string {
  const dur = rec.endedAt
    ? Math.round((rec.endedAt - rec.startedAt) / 60000)
    : Math.round((Date.now() - rec.startedAt) / 60000);
  const lines = [
    `Session: ${rec.hostNickname} (@${rec.hostUniqueId})`,
    `Room: ${rec.roomTitle || '(no title)'}`,
    `Started: ${new Date(rec.startedAt).toLocaleString()}`,
    `Duration: ${dur} min`,
    '',
    'Totals:',
    `  Comments: ${rec.totals.comments}`,
    `  Likes: ${rec.totals.likes}`,
    `  Diamonds: ${rec.totals.diamonds}`,
    `  Gifts: ${rec.totals.gifts}`,
    `  Follows: ${rec.totals.follows}`,
    `  Subs: ${rec.totals.subs}`,
    `  Peak Viewers: ${rec.totals.peakViewers}`,
    `  Q&A: ${rec.totals.questions}`,
  ];
  return lines.join('\n');
}

export type ExportType = 'comments' | 'gifts' | 'all' | 'summary';

export async function exportSession(
  rec: SessionRecord,
  type: ExportType,
  parentWindow?: BrowserWindow | null,
): Promise<{ ok: boolean; path?: string }> {
  const ext = type === 'summary' ? 'txt' : 'csv';
  const defaultName = `${rec.hostUniqueId}_${new Date(rec.startedAt).toISOString().slice(0, 10)}_${type}.${ext}`;

  const result = await dialog.showSaveDialog(parentWindow ?? BrowserWindow.getFocusedWindow()!, {
    defaultPath: defaultName,
    filters: [
      ext === 'csv'
        ? { name: 'CSV Files', extensions: ['csv'] }
        : { name: 'Text Files', extensions: ['txt'] },
    ],
  });

  if (result.canceled || !result.filePath) return { ok: false };

  let content: string;
  switch (type) {
    case 'comments':
      content = sessionToCsvComments(rec);
      break;
    case 'gifts':
      content = sessionToCsvGifts(rec);
      break;
    case 'all':
      content = sessionToCsvAll(rec);
      break;
    case 'summary':
      content = sessionToSummaryText(rec);
      break;
  }

  fs.writeFileSync(result.filePath, content, 'utf8');
  return { ok: true, path: result.filePath };
}
