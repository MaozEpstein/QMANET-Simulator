import { describe, expect, it } from "vitest";
import { computeDegrees } from "./graphMetrics";

describe("computeDegrees", () => {
  it("returns zeros for a graph with no edges", () => {
    expect(computeDegrees(5, [])).toEqual([0, 0, 0, 0, 0]);
  });

  it("counts each endpoint of every edge", () => {
    expect(computeDegrees(3, [[0, 1], [1, 2]])).toEqual([1, 2, 1]);
  });

  it("matches Petersen: 3-regular on 10 nodes", () => {
    const edges: [number, number][] = [
      [0, 1], [1, 2], [2, 3], [3, 4], [4, 0],
      [0, 5], [1, 6], [2, 7], [3, 8], [4, 9],
      [5, 7], [6, 8], [7, 9], [8, 5], [9, 6],
    ];
    const deg = computeDegrees(10, edges);
    expect(deg.every((d) => d === 3)).toBe(true);
  });

  it("matches K3,3: all six vertices have degree 3", () => {
    const edges: [number, number][] = [];
    for (const a of [0, 1, 2]) for (const b of [3, 4, 5]) edges.push([a, b]);
    expect(computeDegrees(6, edges)).toEqual([3, 3, 3, 3, 3, 3]);
  });

  it("ignores out-of-range endpoints but still counts the valid endpoint of mixed edges", () => {
    // [0,1] counts both; [1,5] only counts 1; [5,0] only counts 0.
    expect(computeDegrees(2, [[0, 1], [1, 5], [5, 0]])).toEqual([2, 2]);
  });
});
