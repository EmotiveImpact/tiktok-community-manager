import type { Tier } from '../types';

/** Diamond totals → tier (mirrors electron/fans.ts thresholds). */
export function tierForDiamonds(d: number): Tier {
  return d >= 10000 ? 'Whale' : d >= 1000 ? 'VIP' : d >= 100 ? 'Regular' : 'New';
}

export function tierClass(tier: string): string {
  switch (tier) {
    case 'Whale': return 'tier-chip tier-whale';
    case 'VIP': return 'tier-chip tier-vip';
    case 'Regular': return 'tier-chip tier-regular';
    default: return 'tier-chip tier-new';
  }
}

export const TIERS: Tier[] = ['New', 'Regular', 'VIP', 'Whale'];
