import { describe, expect, it } from "vitest";
import type { ThroughputBounds } from "../api/rest";
import { allBoundsCoincide, boundGaps, boundsAxisMax, fmtChiF, slotsForView } from "./throughputBounds";

// C5: ω=2, χ_f=5/2, χ=3.
const c5: ThroughputBounds = {
  omega: 2,
  max_clique: [0, 1],
  chi: 3,
  chi_exact: false,
  coloring: [0, 1, 0, 1, 2],
  coloring_strategy: "saturation_largest_first",
  chi_f: 2.5,
  chi_f_lower: 2.5,
  chi_f_exact: true,
  lp_schedule: [
    { links: [0, 2], fraction: 0.2 },
    { links: [1, 3], fraction: 0.2 },
    { links: [2, 4], fraction: 0.2 },
    { links: [3, 0], fraction: 0.2 },
    { links: [4, 1], fraction: 0.2 },
  ],
  lp_iterations: 3,
  lp_columns: 5,
  exact_pricing: true,
  lower_bound: 1 / 3,
  lp_bound: 0.4,
  upper_bound: 0.5,
};

describe("throughputBounds helpers", () => {
  it("axis max sits past the upper bound and never exceeds 1", () => {
    expect(boundsAxisMax(0.5)).toBeCloseTo(0.7);
    expect(boundsAxisMax(1)).toBe(1);
    expect(boundsAxisMax(0.04)).toBeCloseTo(0.06);
    expect(boundsAxisMax(0.5)).toBeGreaterThan(0.5);
  });

  it("gaps are relative to the LP value", () => {
    const g = boundGaps(c5);
    expect(g.lower).toBeCloseTo((0.4 - 1 / 3) / 0.4);
    expect(g.upper).toBeCloseTo(0.25);
    expect(g.band).toBeCloseTo(0.5 - 1 / 3);
    expect(allBoundsCoincide(c5)).toBe(false);
  });

  it("coloring slots are one equal slot per color", () => {
    const slots = slotsForView(c5, "coloring");
    expect(slots.map((s) => s.links)).toEqual([[0, 2], [1, 3], [4]]);
    expect(slots.every((s) => Math.abs(s.fraction - 1 / 3) < 1e-12)).toBe(true);
  });

  it("clique slots give each clique link its own turn", () => {
    expect(slotsForView(c5, "clique")).toEqual([
      { links: [0], fraction: 0.5 },
      { links: [1], fraction: 0.5 },
    ]);
  });

  it("formats χ_f as a fraction when exact", () => {
    expect(fmtChiF(2.5)).toBe("5/2");
    expect(fmtChiF(7 / 3)).toBe("7/3");
    expect(fmtChiF(4)).toBe("4");
    expect(fmtChiF(2.9)).toBe("29/10");
    expect(fmtChiF(Math.PI)).toBe("3.142");
  });
});
