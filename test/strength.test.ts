import { describe, it, expect } from 'vitest';
import {
  computeStrength,
  temperatureForStrength,
  type StrengthSignals,
} from '../electron/strength';

// strength.ts is PURE (no electron / no disk), so this test needs no fs mock or
// wipeDataDir — it exercises the engine directly.

const DAY = 86_400_000;
const NOW = 1_700_000_000_000; // fixed clock for deterministic recency

function sig(partial: Partial<StrengthSignals>): StrengthSignals {
  return { now: NOW, coldDays: 14, ...partial };
}

describe('temperatureForStrength — band boundaries', () => {
  it('maps each band by its lower edge', () => {
    expect(temperatureForStrength(75)).toBe('hot');
    expect(temperatureForStrength(74)).toBe('warm');
    expect(temperatureForStrength(50)).toBe('warm');
    expect(temperatureForStrength(49)).toBe('cooling');
    expect(temperatureForStrength(25)).toBe('cooling');
    expect(temperatureForStrength(24)).toBe('cold');
    expect(temperatureForStrength(0)).toBe('cold');
  });

  it('treats 100 as hot and clamps garbage to cold', () => {
    expect(temperatureForStrength(100)).toBe('hot');
    expect(temperatureForStrength(NaN)).toBe('cold');
  });
});

describe('computeStrength — breakdown components', () => {
  it('a fan contacted today with strong signals scores hot with high parts', () => {
    const r = computeStrength(
      { tier: 'VIP' },
      sig({
        lastInteractionAt: NOW, // 0 days → recency ~1
        diamonds30d: 20000, // well above the 5000 half → generosity high
        interactions30d: 40, // well above the 12 half → frequency high
        sessionsAttended: 10,
        recentSessionsCount: 10, // perfect attendance → loyalty 100
      }),
    );
    expect(r.daysSinceContact).toBe(0);
    expect(r.breakdown.recency).toBe(100);
    expect(r.breakdown.loyalty).toBe(100);
    expect(r.breakdown.generosity).toBeGreaterThan(75);
    expect(r.breakdown.frequency).toBeGreaterThan(75);
    expect(r.strength).toBeGreaterThanOrEqual(75);
    expect(r.temperature).toBe('hot');
  });

  it('recency decays ~exp(-days/14): ~37 at 14 days, ~50 at ~9.7 days', () => {
    const at14 = computeStrength({}, sig({ lastInteractionAt: NOW - 14 * DAY }));
    // exp(-1) ≈ 0.3679 → 37
    expect(at14.breakdown.recency).toBe(37);
    const at0 = computeStrength({}, sig({ lastInteractionAt: NOW }));
    expect(at0.breakdown.recency).toBe(100);
  });

  it('loyalty is attendance rate and never divides by zero', () => {
    const half = computeStrength({}, sig({ lastInteractionAt: NOW, sessionsAttended: 5, recentSessionsCount: 10 }));
    expect(half.breakdown.loyalty).toBe(50);
    const noSessions = computeStrength({}, sig({ lastInteractionAt: NOW, sessionsAttended: 0, recentSessionsCount: 0 }));
    expect(noSessions.breakdown.loyalty).toBe(0); // no divide-by-zero / no fake 100
  });

  it('generosity/frequency saturate at the half-point to exactly 50', () => {
    const r = computeStrength({}, sig({ lastInteractionAt: NOW, diamonds30d: 5000, interactions30d: 12 }));
    expect(r.breakdown.generosity).toBe(50);
    expect(r.breakdown.frequency).toBe(50);
  });
});

describe('computeStrength — empty / garbage inputs are safe', () => {
  it('a never-contacted fan with no signals is cold and 9999 days', () => {
    const r = computeStrength({}, sig({ lastInteractionAt: null }));
    expect(r.strength).toBe(0);
    expect(r.temperature).toBe('cold');
    expect(r.daysSinceContact).toBe(9999);
    expect(r.breakdown).toEqual({ recency: 0, generosity: 0, frequency: 0, loyalty: 0 });
  });

  it('NaN/undefined signals degrade to 0 rather than NaN', () => {
    const r = computeStrength({}, sig({ lastInteractionAt: NaN as any, diamonds30d: NaN as any, interactions30d: undefined }));
    expect(Number.isFinite(r.strength)).toBe(true);
    expect(r.breakdown.generosity).toBe(0);
    expect(r.breakdown.frequency).toBe(0);
  });
});

describe('computeStrength — cold-VIP/Whale override', () => {
  it('forces a lapsed Whale to cold even when the score is otherwise warm', () => {
    // 20 days since contact (> coldDays 14) but huge lifetime-ish 30d diamonds.
    const r = computeStrength(
      { tier: 'Whale' },
      sig({ lastInteractionAt: NOW - 20 * DAY, diamonds30d: 50000, interactions30d: 30 }),
    );
    expect(r.daysSinceContact).toBe(20);
    expect(r.temperature).toBe('cold');
  });

  it('does NOT force cold for a non-VIP fan past coldDays', () => {
    const r = computeStrength(
      { tier: 'Regular' },
      sig({ lastInteractionAt: NOW - 20 * DAY, diamonds30d: 50000, interactions30d: 30 }),
    );
    // Regular fan: temperature follows the band, not the override.
    expect(r.temperature).toBe(temperatureForStrength(r.strength));
  });

  it('respects a custom coldDays threshold from community settings', () => {
    // coldDays 30: a VIP 20 days out is NOT yet cold by override.
    const r = computeStrength(
      { tier: 'VIP' },
      sig({ lastInteractionAt: NOW - 20 * DAY, diamonds30d: 50000, interactions30d: 30, coldDays: 30 }),
    );
    expect(r.temperature).toBe(temperatureForStrength(r.strength));
    expect(r.temperature).not.toBe('cold');
  });

  it('a never-contacted VIP (e.g. imported) is cold', () => {
    const r = computeStrength({ tier: 'VIP' }, sig({ lastInteractionAt: null }));
    expect(r.temperature).toBe('cold');
  });
});
