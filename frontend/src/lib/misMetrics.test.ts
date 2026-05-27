import { describe, expect, it } from "vitest";
import {
  bitstringIsIndependent,
  bitstringSize,
  computeMisMetrics,
  type Edge,
} from "./misMetrics";

describe("bitstring helpers", () => {
  it("counts 1s", () => {
    expect(bitstringSize("0000")).toBe(0);
    expect(bitstringSize("1010")).toBe(2);
    expect(bitstringSize("1111")).toBe(4);
  });

  it("detects independence on a triangle", () => {
    const edges: Edge[] = [
      [0, 1],
      [1, 2],
      [0, 2],
    ];
    expect(bitstringIsIndependent("100", edges)).toBe(true);
    expect(bitstringIsIndependent("110", edges)).toBe(false);
    expect(bitstringIsIndependent("000", edges)).toBe(true);
  });
});

describe("computeMisMetrics", () => {
  it("P4 (path 0-1-2-3): MIS* = 2, two optimal MIS are 1010 and 0101", () => {
    const edges: Edge[] = [
      [0, 1],
      [1, 2],
      [2, 3],
    ];
    const probs = {
      "1010": 0.4, // MIS, size 2
      "0101": 0.3, // MIS, size 2
      "1100": 0.2, // violates (0,1)
      "0000": 0.1, // independent, size 0
    };
    const m = computeMisMetrics(probs, edges, 2);
    // MIS prob = 0.4 + 0.3 = 0.7
    expect(m.misProbability).toBeCloseTo(0.7, 6);
    // Violation = 0.2 (1100 has edge (0,1))
    expect(m.violationProbability).toBeCloseTo(0.2, 6);
    // Feasible = 0.4 + 0.3 + 0.1 = 0.8
    expect(m.feasibleProbability).toBeCloseTo(0.8, 6);
    // ApproxRatio = (0.4*2 + 0.3*2 + 0.1*0) / 2 = 0.7
    expect(m.approximationRatio).toBeCloseTo(0.7, 6);
    expect(m.topBitstrings[0].bitstring).toBe("1010");
    expect(m.topBitstrings[0].isMis).toBe(true);
  });

  it("triangle: MIS* = 1, any single 1 is MIS", () => {
    const edges: Edge[] = [
      [0, 1],
      [1, 2],
      [0, 2],
    ];
    const probs = { "100": 0.5, "111": 0.5 };
    const m = computeMisMetrics(probs, edges, 1);
    expect(m.misProbability).toBeCloseTo(0.5, 6);
    expect(m.violationProbability).toBeCloseTo(0.5, 6);
  });

  it("missing target size yields zero ratio", () => {
    const m = computeMisMetrics({ "10": 1 }, [], null);
    expect(m.approximationRatio).toBe(0);
    expect(m.misProbability).toBe(0);
  });
});
