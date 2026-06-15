/**
 * Relationship-strength + temperature engine.
 *
 * PURE + UNIT-TESTABLE: this module imports nothing from electron / node and
 * touches no disk. The caller (electron/main.ts) computes the raw `signals`
 * from the gift ledger + sessions + the fan record, then calls
 * `computeStrength(fan, signals)`. Keeping it pure means it can be exercised
 * directly from vitest and reused unchanged in the browser bridge-mock.
 *
 * Formula (from the CRM research brief):
 *   recencyScore     = exp(-daysSinceLastInteraction / 14)        → 0..1
 *   generosityScore  = normalized diamonds in the last 30 days     → 0..1
 *   frequencyScore   = normalized interaction count last 30 days   → 0..1
 *   loyaltyScore     = session attendance rate                     → 0..1
 *   strength = round(100 * (0.35*rec + 0.25*gen + 0.25*freq + 0.15*loy))
 *
 * Temperature bands (on the 0–100 strength):
 *   hot     >= 75
 *   warm     50–74
 *   cooling  25–49
 *   cold    < 25
 * …with one override: a VIP/Whale that hasn't been contacted in more than the
 * community `coldDays` threshold is forced to 'cold' regardless of score — a
 * lapsed big spender is the single most important "win them back" signal, so we
 * surface it even if their lifetime generosity still props the number up.
 */

export type Temperature = 'hot' | 'warm' | 'cooling' | 'cold';

export type StrengthBreakdown = {
  /** each 0–100 */
  recency: number;
  generosity: number;
  frequency: number;
  loyalty: number;
};

export type StrengthResult = {
  strength: number; // 0–100
  temperature: Temperature;
  daysSinceContact: number;
  breakdown: StrengthBreakdown;
};

/** Tier shape needed for the cold-VIP override (kept minimal + structural). */
type TierLike = 'New' | 'Regular' | 'VIP' | 'Whale' | string;

export type StrengthFanInput = {
  tier?: TierLike;
};

/**
 * Raw, pre-aggregated relationship signals. The caller derives these from the
 * ledger/sessions so this module stays pure. All fields are optional and
 * defaulted defensively so a partial/empty fan never throws.
 */
export type StrengthSignals = {
  /** epoch ms of the most recent interaction of ANY kind (gift/comment/session/note). */
  lastInteractionAt?: number | null;
  /** diamonds received in the last 30 days. */
  diamonds30d?: number;
  /** count of interactions (gifts + comments + sessions + manual) in the last 30 days. */
  interactions30d?: number;
  /** sessions this fan actually attended (all-time, or windowed by the caller). */
  sessionsAttended?: number;
  /** total sessions that happened in the same window (denominator for loyalty). */
  recentSessionsCount?: number;
  /** VIP/Whale cold override threshold in days (from community settings). Default 14. */
  coldDays?: number;
  /** clock injection for tests; defaults to Date.now(). */
  now?: number;
};

const DAY_MS = 86_400_000;

/**
 * Normalization references. Diamonds/interactions are normalized against a
 * "this is clearly a top fan" ceiling using a saturating curve so a single
 * whale gift doesn't peg everyone at 100 and a chatty-but-broke fan still earns
 * frequency credit. We use x/(x+k) saturation (smooth, bounded, divide-by-zero
 * safe) rather than a hard cap.
 */
const DIAMONDS_30D_HALF = 5000; // diamonds where generosity hits 0.5
const INTERACTIONS_30D_HALF = 12; // interactions where frequency hits 0.5

function clamp01(n: number): number {
  if (!Number.isFinite(n)) return 0;
  if (n < 0) return 0;
  if (n > 1) return 1;
  return n;
}

/** Smooth saturating normalizer: x/(x+half) → 0 at x=0, 0.5 at x=half, →1 as x→∞. */
function saturate(x: number, half: number): number {
  const v = Math.max(0, Number(x) || 0);
  if (half <= 0) return v > 0 ? 1 : 0;
  return v / (v + half);
}

function round100(score01: number): number {
  return Math.max(0, Math.min(100, Math.round(score01 * 100)));
}

/**
 * Compute relationship strength, temperature, days-since-contact and the 4-part
 * breakdown for a fan. Fully defensive: any missing/garbage signal degrades to
 * a sensible zero rather than NaN, and the function never throws.
 */
export function computeStrength(fan: StrengthFanInput, signals: StrengthSignals): StrengthResult {
  const now = Number.isFinite(signals.now as number) ? (signals.now as number) : Date.now();
  const coldDays = Number.isFinite(signals.coldDays as number) && (signals.coldDays as number) > 0
    ? (signals.coldDays as number)
    : 14;

  // --- days since last contact -------------------------------------------------
  const last = signals.lastInteractionAt;
  const daysSinceContact = last && Number.isFinite(last)
    ? Math.max(0, Math.floor((now - last) / DAY_MS))
    : Infinity;

  // --- recency (exponential decay, half-life-ish at 14 days) -------------------
  // No contact ever → recency 0. exp(-Inf) === 0 already, but guard explicitly.
  const recency01 = Number.isFinite(daysSinceContact)
    ? clamp01(Math.exp(-daysSinceContact / 14))
    : 0;

  // --- generosity (normalized diamonds in last 30d) ----------------------------
  const generosity01 = clamp01(saturate(signals.diamonds30d ?? 0, DIAMONDS_30D_HALF));

  // --- frequency (normalized interaction count in last 30d) --------------------
  const frequency01 = clamp01(saturate(signals.interactions30d ?? 0, INTERACTIONS_30D_HALF));

  // --- loyalty (session attendance rate) ---------------------------------------
  const attended = Math.max(0, Number(signals.sessionsAttended) || 0);
  const possible = Math.max(0, Number(signals.recentSessionsCount) || 0);
  // No sessions to attend yet → neutral-but-honest 0 (not a divide-by-zero / 1).
  const loyalty01 = possible > 0 ? clamp01(attended / possible) : 0;

  const breakdown: StrengthBreakdown = {
    recency: round100(recency01),
    generosity: round100(generosity01),
    frequency: round100(frequency01),
    loyalty: round100(loyalty01),
  };

  const strength = round100(
    0.35 * recency01 + 0.25 * generosity01 + 0.25 * frequency01 + 0.15 * loyalty01,
  );

  let temperature = temperatureForStrength(strength);

  // Cold-VIP override: a lapsed big spender is always 'cold' so the win-back
  // surfacing fires even when lifetime generosity keeps the score warm.
  const isBigFish = fan.tier === 'VIP' || fan.tier === 'Whale';
  if (isBigFish && Number.isFinite(daysSinceContact) && daysSinceContact > coldDays) {
    temperature = 'cold';
  } else if (isBigFish && !Number.isFinite(daysSinceContact)) {
    // Never contacted at all but tagged VIP/Whale (e.g. imported) → cold too.
    temperature = 'cold';
  }

  return {
    strength,
    temperature,
    daysSinceContact: Number.isFinite(daysSinceContact) ? daysSinceContact : 9999,
    breakdown,
  };
}

/** Pure band lookup on a 0–100 strength score. */
export function temperatureForStrength(strength: number): Temperature {
  const s = Number.isFinite(strength) ? strength : 0;
  if (s >= 75) return 'hot';
  if (s >= 50) return 'warm';
  if (s >= 25) return 'cooling';
  return 'cold';
}
