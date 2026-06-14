import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import './helpers'; // installs the electron mock (hoisted)
import {
  tierForDiamonds,
  setRulesGetter,
  normalizeBirthday,
  DEFAULT_RULES,
  type CommunityRules,
} from '../electron/fans';
import { wipeDataDir } from './helpers';

function resetRules() {
  // Restore the default getter so a custom getter from one test can't leak.
  setRulesGetter(() => DEFAULT_RULES);
}

describe('tierForDiamonds — default thresholds (regular 100, vip 1000, whale 10000)', () => {
  beforeEach(() => {
    wipeDataDir();
    resetRules();
  });

  it('classifies zero and sub-Regular as New', () => {
    expect(tierForDiamonds(0)).toBe('New');
    expect(tierForDiamonds(99)).toBe('New');
  });

  it('classifies exactly at each boundary as the higher tier (>=)', () => {
    expect(tierForDiamonds(100)).toBe('Regular');
    expect(tierForDiamonds(1000)).toBe('VIP');
    expect(tierForDiamonds(10000)).toBe('Whale');
  });

  it('classifies just-below boundaries as the lower tier', () => {
    expect(tierForDiamonds(999)).toBe('Regular');
    expect(tierForDiamonds(9999)).toBe('VIP');
  });

  it('classifies just-above boundaries and huge values', () => {
    expect(tierForDiamonds(101)).toBe('Regular');
    expect(tierForDiamonds(1001)).toBe('VIP');
    expect(tierForDiamonds(10001)).toBe('Whale');
    expect(tierForDiamonds(Number.MAX_SAFE_INTEGER)).toBe('Whale');
  });
});

describe('tierForDiamonds — custom thresholds via setRulesGetter', () => {
  beforeEach(() => wipeDataDir());
  afterEach(() => resetRules());

  it('uses injected custom thresholds at the new boundaries', () => {
    const custom: CommunityRules = {
      quietDays: 14,
      birthdayWindowDays: 30,
      tiers: { regular: 5, vip: 50, whale: 500 },
    };
    setRulesGetter(() => custom);
    expect(tierForDiamonds(4)).toBe('New');
    expect(tierForDiamonds(5)).toBe('Regular');
    expect(tierForDiamonds(49)).toBe('Regular');
    expect(tierForDiamonds(50)).toBe('VIP');
    expect(tierForDiamonds(499)).toBe('VIP');
    expect(tierForDiamonds(500)).toBe('Whale');
  });

  it('falls back to DEFAULT_RULES when the rules getter throws', () => {
    setRulesGetter(() => {
      throw new Error('settings store unavailable');
    });
    // setRulesGetter wraps the getter in a try/catch that returns DEFAULT_RULES,
    // so thresholds must revert to the defaults (vip = 1000).
    expect(tierForDiamonds(999)).toBe('Regular');
    expect(tierForDiamonds(1000)).toBe('VIP');
  });

  it('falls back to DEFAULT_RULES when the getter returns a malformed object', () => {
    // Missing `.tiers` -> wrapper rejects it and returns DEFAULT_RULES.
    setRulesGetter(() => ({}) as unknown as CommunityRules);
    expect(tierForDiamonds(10000)).toBe('Whale');
    expect(tierForDiamonds(50)).toBe('New');
  });
});

describe('normalizeBirthday', () => {
  it('passes through MM-DD and zero-pads single digits', () => {
    expect(normalizeBirthday('03-14')).toBe('03-14');
    expect(normalizeBirthday('3-4')).toBe('03-04');
  });

  it('strips the year from YYYY-MM-DD (ISO)', () => {
    expect(normalizeBirthday('1990-12-25')).toBe('12-25');
    expect(normalizeBirthday('2001-01-02T00:00:00Z')).toBe('01-02');
  });

  it('reorders DD/MM into MM-DD', () => {
    expect(normalizeBirthday('25/12')).toBe('12-25');
  });

  it('returns undefined for empty / nullish / unparseable input', () => {
    expect(normalizeBirthday('')).toBeUndefined();
    expect(normalizeBirthday('   ')).toBeUndefined();
    expect(normalizeBirthday(null)).toBeUndefined();
    expect(normalizeBirthday(undefined)).toBeUndefined();
    expect(normalizeBirthday('not-a-date')).toBeUndefined();
    expect(normalizeBirthday('December')).toBeUndefined();
  });
});
