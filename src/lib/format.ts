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
 * Optional money estimate next to diamond counts (Settings → Earnings estimate).
 * OFF by default; diamonds stay the primary unit. Returns e.g. "(~£124)" or
 * null when the estimate is disabled / not meaningful.
 */
export type EarningsLike = { enabled: boolean; ratePer1000: number; currency: string } | null | undefined;
export function estimateMoney(diamonds: number, earnings: EarningsLike): string | null {
  if (!earnings?.enabled) return null;
  const rate = Number(earnings.ratePer1000);
  if (!Number.isFinite(rate) || rate <= 0 || !Number.isFinite(diamonds)) return null;
  const money = (diamonds / 1000) * rate;
  const amount = money >= 100 ? Math.round(money).toLocaleString() : money.toFixed(2);
  return `(~${earnings.currency}${amount})`;
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

/** Human relative time spanning seconds → years, e.g. "just now", "5m ago", "3d ago". */
export function relativeTime(ts: number, now = Date.now()): string {
  const s = Math.floor((now - ts) / 1000);
  if (s < 0) return 'just now';
  if (s < 45) return 'just now';
  if (s < 90) return '1m ago';
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.floor(h / 24);
  if (d < 30) return `${d}d ago`;
  const mo = Math.floor(d / 30);
  if (mo < 12) return `${mo}mo ago`;
  return `${Math.floor(mo / 12)}y ago`;
}
