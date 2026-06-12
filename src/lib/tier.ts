import type { Tier } from '../types';

export type TierThresholds = { regular: number; vip: number; whale: number };
export const DEFAULT_TIER_THRESHOLDS: TierThresholds = { regular: 100, vip: 1000, whale: 10000 };

/** Diamond totals → tier (mirrors electron/fans.ts; thresholds configurable in Settings). */
export function tierForDiamonds(d: number, t: TierThresholds = DEFAULT_TIER_THRESHOLDS): Tier {
  return d >= t.whale ? 'Whale' : d >= t.vip ? 'VIP' : d >= t.regular ? 'Regular' : 'New';
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
