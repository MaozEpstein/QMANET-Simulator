/**
 * Deterministic multinomial sampling + Total Variation Distance.
 *
 * Used by Stage 6's convergence panel: we draw N shots from the theoretical
 * `|c_b|²` distribution at several N values to visually show how the empirical
 * histogram approaches truth.
 *
 * RNG is mulberry32 — tiny, deterministic per seed, more than good enough for
 * a pedagogical sampling demo (it is NOT a cryptographic RNG).
 */

export function mulberry32(seed: number): () => number {
  let t = seed >>> 0;
  return () => {
    t = (t + 0x6d2b79f5) >>> 0;
    let r = t;
    r = Math.imul(r ^ (r >>> 15), r | 1);
    r ^= r + Math.imul(r ^ (r >>> 7), r | 61);
    return ((r ^ (r >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Draw `n` samples from a discrete distribution given as a map
 * { bitstring → probability }. Returns a histogram { bitstring → count }.
 * Probabilities are renormalised internally so callers don't have to worry
 * about numerical drift from the backend.
 */
export function sampleMultinomial(
  probs: Record<string, number>,
  n: number,
  seed: number,
): Record<string, number> {
  const keys = Object.keys(probs);
  if (keys.length === 0 || n <= 0) return {};
  const weights = keys.map((k) => Math.max(0, probs[k]));
  const total = weights.reduce((a, b) => a + b, 0);
  if (total <= 0) return {};
  // Build a CDF for inverse-transform sampling.
  const cdf = new Float64Array(keys.length);
  let acc = 0;
  for (let i = 0; i < keys.length; i++) {
    acc += weights[i] / total;
    cdf[i] = acc;
  }
  const rng = mulberry32(seed);
  const out: Record<string, number> = {};
  for (let s = 0; s < n; s++) {
    const u = rng();
    // Linear scan — keys ≤ 2^N ≤ ~1024 for the dim we care about, no need
    // for binary search.
    let i = 0;
    while (i < cdf.length - 1 && u > cdf[i]) i++;
    const k = keys[i];
    out[k] = (out[k] ?? 0) + 1;
  }
  return out;
}

/**
 * Total Variation Distance between two discrete distributions:
 *   TVD(p, q) = ½ · Σ_x |p(x) − q(x)|
 * Both inputs are { key → mass }; missing keys treated as 0. Inputs are
 * renormalised internally (so the function works for histograms as well as
 * probability dicts).
 */
export function totalVariationDistance(
  a: Record<string, number>,
  b: Record<string, number>,
): number {
  const totalA = Object.values(a).reduce((s, v) => s + v, 0);
  const totalB = Object.values(b).reduce((s, v) => s + v, 0);
  if (totalA <= 0 || totalB <= 0) return 1;
  const keys = new Set([...Object.keys(a), ...Object.keys(b)]);
  let acc = 0;
  for (const k of keys) {
    const pa = (a[k] ?? 0) / totalA;
    const pb = (b[k] ?? 0) / totalB;
    acc += Math.abs(pa - pb);
  }
  return 0.5 * acc;
}
