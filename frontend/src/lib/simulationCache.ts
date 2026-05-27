/**
 * In-memory cache for completed Stage-5 runs.
 *
 * Keyed by a stable hash of (positions, schedule, n_frames). When the same
 * combination is requested again the cached frames + final-bitstring-probs
 * are returned instantly — so navigating away from Stage 5 and back doesn't
 * re-run QuTiP. Persists for the lifetime of the page (module-level Map);
 * not written to localStorage because 80–300 frames × N atoms is heavy (~5 MB
 * for large runs) and we already deliberately keep frames out of persist.
 */

import type { NoiseConfigDTO, NodePos, ScheduleDTO, SimulationFrameDTO } from "../api/rest";

interface CachedRun {
  frames: SimulationFrameDTO[];
  finalBitstringProbs?: Record<string, number>;
  trackedBitstrings?: Record<string, number[]>;
}

const cache = new Map<string, CachedRun>();
const MAX_ENTRIES = 8;

function quantize(x: number, digits = 6): number {
  return Number(x.toFixed(digits));
}

export function makeRunKey(
  positions: readonly NodePos[],
  schedule: ScheduleDTO,
  nFrames: number,
  noise?: NoiseConfigDTO | null,
): string {
  const pos = positions.map((p) => [p.id, quantize(p.x), quantize(p.y)]);
  const sched = {
    o: [schedule.omega.times.map((t) => quantize(t)), schedule.omega.values.map((v) => quantize(v))],
    d: [schedule.delta.times.map((t) => quantize(t)), schedule.delta.values.map((v) => quantize(v))],
    p: [schedule.phi.times.map((t) => quantize(t)), schedule.phi.values.map((v) => quantize(v))],
    T: quantize(schedule.duration),
  };
  // Two runs with the same geometry/schedule but different noise must be
  // distinct cache entries. `null` (noise off) is its own bucket.
  const ns =
    noise && noise.enabled
      ? { e: 1, t1: noise.t1_us ?? null, t2: noise.t2_us ?? null }
      : null;
  return JSON.stringify({ pos, sched, n: nFrames, ns });
}

export function getCachedRun(key: string): CachedRun | undefined {
  const v = cache.get(key);
  if (v) {
    // LRU-touch: re-insert moves to the end.
    cache.delete(key);
    cache.set(key, v);
  }
  return v;
}

export function setCachedRun(key: string, run: CachedRun): void {
  cache.set(key, run);
  while (cache.size > MAX_ENTRIES) {
    const oldest = cache.keys().next().value;
    if (oldest === undefined) break;
    cache.delete(oldest);
  }
}

export function clearSimulationCache(): void {
  cache.clear();
}
