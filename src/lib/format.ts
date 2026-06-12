export function formatNumber(n: number): string {
  if (n < 1000) return String(n);
  if (n < 1_000_000) return (n / 1000).toFixed(n < 10_000 ? 1 : 0) + 'K';
  return (n / 1_000_000).toFixed(n < 10_000_000 ? 1 : 0) + 'M';
}

export function formatUptime(ms: number): string {
  const s = Math.floor(ms / 1000);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  if (h) return `${h}:${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')}`;
  return `${m}:${String(sec).padStart(2, '0')}`;
}

/** Currency unit of this app is DIAMONDS (TikTok coins). */
export function formatDiamonds(n: number): string {
  return `${formatNumber(n)} 💎`;
}

/**
 * Rough £ estimate (~£0.005/diamond creator payout). OFF by default —
 * call sites must opt in explicitly; never show without a "≈" qualifier.
 */
export const SHOW_MONEY_ESTIMATE = false;
export function estimateGbp(diamonds: number): string {
  return `≈ £${(diamonds * 0.005).toFixed(2)}`;
}

export function formatDate(ts: number): string {
  return new Date(ts).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' });
}

export function daysAgoLabel(ts: number, now = Date.now()): string {
  const d = Math.floor((now - ts) / 86400000);
  if (d <= 0) return 'today';
  if (d === 1) return 'yesterday';
  return `${d}d ago`;
}

export function timeAgo(ts: number, now = Date.now()): string {
  const s = Math.floor((now - ts) / 1000);
  if (s < 5) return 'now';
  if (s < 60) return `${s}s`;
  if (s < 3600) return `${Math.floor(s / 60)}m`;
  return `${Math.floor(s / 3600)}h`;
}
