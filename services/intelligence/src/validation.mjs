import { createHash } from 'node:crypto';

export class Fault extends Error {
  constructor(code, status = 400) { super(code); this.code = code; this.status = status; }
}

export function canonical(value) {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return '[' + value.map(canonical).join(',') + ']';
  return '{' + Object.keys(value).sort().map(key => JSON.stringify(key) + ':' + canonical(value[key])).join(',') + '}';
}

export const digest = value => createHash('sha256').update(typeof value === 'string' ? value : canonical(value)).digest('hex');

export function object(value, fields) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Fault('object_required');
  if (fields && Object.keys(value).some(key => !fields.includes(key))) throw new Fault('unknown_field');
  return value;
}

export function text(value, max = 512, empty = false) {
  if (typeof value !== 'string' || value.length > max || (!empty && !value.trim()) || /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(value)) {
    throw new Fault('invalid_text');
  }
  return value;
}

export function ident(value) {
  if (typeof value !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9_-]{0,95}$/.test(value)) throw new Fault('invalid_identifier');
  return value;
}

export function handle(value) {
  if (value === null || value === undefined) return null;
  const result = text(value, 100).trim().replace(/^@+/, '').toLowerCase();
  if (!/^[a-z0-9._-]{1,64}$/.test(result)) throw new Fault('invalid_account_handle');
  return result;
}

export function timestamp(value, optional = false) {
  if ((value === null || value === undefined) && optional) return null;
  if (!Number.isSafeInteger(value) || value < 0 || value > 8_640_000_000_000_000) throw new Fault('invalid_timestamp');
  return value;
}

export function pageLimit(value = 100) {
  const n = Number(value);
  if (!Number.isInteger(n) || n < 1 || n > 200) throw new Fault('invalid_limit');
  return n;
}

export function sourceUrl(value) {
  text(value, 2048);
  let url;
  try { url = new URL(value); } catch { throw new Fault('invalid_source_url'); }
  if (url.protocol !== 'https:' || url.username || url.password) throw new Fault('invalid_source_url');
  // Stored provenance only. The API never fetches this URL.
  return value;
}

export function normaliseEvent(value) {
  object(value, ['source', 'kind', 'text', 'account', 'speakerId', 'sourceTimestampMs', 'capturedAtMs', 'raw']);
  object(value.source, ['adapter', 'eventId']);
  const kind = value.kind;
  if (!['chat', 'caption', 'transcript', 'observation', 'gap'].includes(kind)) throw new Fault('invalid_event_kind');
  const account = handle(value.account);
  if (account && kind !== 'chat' && kind !== 'observation') throw new Fault('speech_account_requires_assertion');
  const raw = value.raw ?? {};
  object(raw);
  const rawJson = JSON.stringify(raw);
  if (Buffer.byteLength(rawJson) > 16_384) throw new Fault('raw_event_too_large');
  const result = {
    source: { adapter: ident(value.source.adapter), eventId: text(value.source.eventId, 256) },
    kind, text: text(value.text, 16_384, true), account,
    speakerId: value.speakerId == null ? null : ident(value.speakerId),
    sourceTimestampMs: timestamp(value.sourceTimestampMs, true), raw: JSON.parse(rawJson),
  };
  return { content: result, capturedAtMs: timestamp(value.capturedAtMs, true) };
}

export function markdownText(value) {
  return String(value).replace(/[\r\n]+/g, ' ').replace(/([\\`*_{}\[\]<>#+.!|~-])/g, '\\$1');
}
