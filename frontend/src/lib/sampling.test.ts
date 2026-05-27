import { describe, expect, it } from "vitest";
import { mulberry32, sampleMultinomial, totalVariationDistance } from "./sampling";

describe("mulberry32", () => {
  it("is deterministic per seed", () => {
    const r1 = mulberry32(42);
    const r2 = mulberry32(42);
    expect([r1(), r1(), r1()]).toEqual([r2(), r2(), r2()]);
  });

  it("differs across seeds", () => {
    const r1 = mulberry32(1);
    const r2 = mulberry32(2);
    expect(r1()).not.toBe(r2());
  });
});

describe("sampleMultinomial", () => {
  it("returns counts summing to n", () => {
    const out = sampleMultinomial({ a: 0.7, b: 0.3 }, 1000, 7);
    const total = Object.values(out).reduce((s, v) => s + v, 0);
    expect(total).toBe(1000);
  });

  it("respects relative weights at large N", () => {
    const out = sampleMultinomial({ a: 0.8, b: 0.2 }, 5000, 11);
    expect(out.a / 5000).toBeGreaterThan(0.7);
    expect(out.b / 5000).toBeLessThan(0.3);
  });

  it("handles single-key distributions", () => {
    const out = sampleMultinomial({ only: 1.0 }, 50, 1);
    expect(out).toEqual({ only: 50 });
  });

  it("returns empty for n=0 or empty probs", () => {
    expect(sampleMultinomial({}, 100, 1)).toEqual({});
    expect(sampleMultinomial({ a: 1 }, 0, 1)).toEqual({});
  });
});

describe("totalVariationDistance", () => {
  it("is zero for identical distributions", () => {
    expect(totalVariationDistance({ a: 0.5, b: 0.5 }, { a: 0.5, b: 0.5 })).toBe(0);
  });

  it("is 1 for fully disjoint supports", () => {
    const d = totalVariationDistance({ a: 1 }, { b: 1 });
    expect(d).toBeCloseTo(1, 9);
  });

  it("converges to 0 as N grows (sampling vs truth)", () => {
    const truth = { a: 0.6, b: 0.3, c: 0.1 };
    const dSmall = totalVariationDistance(truth, sampleMultinomial(truth, 20, 42));
    const dLarge = totalVariationDistance(truth, sampleMultinomial(truth, 5000, 42));
    expect(dLarge).toBeLessThan(dSmall);
    expect(dLarge).toBeLessThan(0.05);
  });
});
