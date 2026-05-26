/**
 * Client-side mirror of the small subset of Aquila constants that Stage 3 and
 * Stage 4 need to compute *live* (without round-tripping to the backend).
 *
 * The authoritative source is `backend/aquila/constants.py` — these values
 * are duplicated here only because the Stage 3 R_b preview must update on
 * every slider tick, which is too fast to fetch over HTTP.
 *
 * If a constant moves in the backend, mirror the change here. Compile-time
 * cross-checks are out of scope but the value is small enough to spot-check
 * by eye in code review.
 */

/** C₆ coefficient for the 70S_{1/2} Rydberg state of Rb-87, in (rad/µs)·µm⁶.
 *  Equals 2π × 862,690 MHz·µm⁶. Matches `aquila/constants.py:C6_RAD_US_UM6`. */
export const C6_RAD_US_UM6 = 5_420_503;

/**
 * Rydberg blockade radius:
 *   R_b = (C₆ / √(Ω² + Δ²))^(1/6)
 *
 * Inputs in rad/µs, output in µm. Returns +∞ when both drives are zero — the
 * caller can clamp this to the array size for display.
 */
export function blockadeRadiusUm(omegaRadUs: number, deltaRadUs: number): number {
  const energy = Math.sqrt(omegaRadUs * omegaRadUs + deltaRadUs * deltaRadUs);
  if (energy <= 0) return Infinity;
  return Math.pow(C6_RAD_US_UM6 / energy, 1 / 6);
}
