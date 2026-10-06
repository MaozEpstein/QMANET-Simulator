import type { ThroughputBounds, TimeShareSlot } from "../api/rest";

export type BoundsView = "coloring" | "lp" | "clique";

const EPS = 1e-9;

/** Right end of the bound bar's axis: a little past 1/ω, snapped to a
 * friendly step, never past 1 (a single link alone gets the whole frame). */
export function boundsAxisMax(upper: number): number {
  const raw = Math.min(1, upper * 1.25);
  const step = raw <= 0.1 ? 0.02 : raw <= 0.25 ? 0.05 : 0.1;
  return Math.min(1, Math.ceil(raw / step - EPS) * step);
}

/** How far each classical bound sits from the LP value, as a fraction of it. */
export function boundGaps(b: ThroughputBounds): { lower: number; upper: number; band: number } {
  const ref = b.lp_bound;
  return {
    lower: ref > 0 ? (ref - b.lower_bound) / ref : 0,
    upper: ref > 0 ? (b.upper_bound - ref) / ref : 0,
    band: b.upper_bound - b.lower_bound,
  };
}

export function allBoundsCoincide(b: ThroughputBounds): boolean {
  return Math.abs(b.upper_bound - b.lower_bound) < EPS;
}

/** The TDMA frame each view illustrates:
 * - coloring: one equal slot per color class;
 * - lp: the LP's optimal time-share over independent sets;
 * - clique: the ω clique links forced to take turns, one slot each. */
export function slotsForView(b: ThroughputBounds, view: BoundsView): TimeShareSlot[] {
  if (view === "lp") return b.lp_schedule;
  if (view === "clique") {
    return b.max_clique.map((v) => ({ links: [v], fraction: 1 / b.omega }));
  }
  const classes = new Map<number, number[]>();
  b.coloring.forEach((c, v) => {
    const arr = classes.get(c);
    if (arr) arr.push(v);
    else classes.set(c, [v]);
  });
  return [...classes.keys()]
    .sort((a, z) => a - z)
    .map((c) => ({ links: classes.get(c)!, fraction: 1 / b.chi }));
}

export function fmtRate(x: number): string {
  return x.toFixed(3);
}

/** Prints χ_f as a short exact fraction when it is one (e.g. 5/2), else 3 decimals. */
export function fmtChiF(x: number): string {
  for (let q = 1; q <= 12; q++) {
    const p = Math.round(x * q);
    if (Math.abs(p / q - x) < 1e-6) return q === 1 ? String(p) : `${p}/${q}`;
  }
  return x.toFixed(3);
}
