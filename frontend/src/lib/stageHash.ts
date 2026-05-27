/**
 * Stable, value-based hash for pipeline-stage payloads.
 *
 * Used by the stale-data banner system: each downstream stage stores the
 * hash of the upstream input it was computed from; on render we compare it
 * against the hash of the current upstream and show a warning if they differ.
 *
 * Properties:
 *  - Key order independent: `{a:1,b:2}` and `{b:2,a:1}` hash identically.
 *  - Float-tolerant: numbers are quantised to 6 decimals so 1.0 and
 *    1.0000001 are equivalent (matches the contract of simulationCache).
 *  - Deterministic across runs (no clock, no randomness).
 *  - Cheap: single pass JSON.stringify; result is the JSON string itself.
 *    For typical pipeline payloads (few KB) this is sub-millisecond.
 */

function quantize(x: number): number {
  if (!Number.isFinite(x)) return x;
  return Number(x.toFixed(6));
}

function canonicalize(value: unknown): unknown {
  if (value === null || value === undefined) return value;
  if (typeof value === "number") return quantize(value);
  if (Array.isArray(value)) return value.map(canonicalize);
  if (typeof value === "object") {
    const obj = value as Record<string, unknown>;
    const keys = Object.keys(obj).sort();
    const out: Record<string, unknown> = {};
    for (const k of keys) out[k] = canonicalize(obj[k]);
    return out;
  }
  return value;
}

export function stableHash(value: unknown): string {
  return JSON.stringify(canonicalize(value));
}
