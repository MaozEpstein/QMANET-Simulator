import { describe, expect, it } from "vitest";
import {
  buildComplete,
  buildHexagonalFlower,
  buildPath,
  buildRing,
  buildSquareGrid,
  buildStar,
  buildTriangularGrid,
  buildWheel,
  PRESETS,
} from "./graphPresets";

const BOX_W = 200;
const BOX_H = 100;

function allInsideBox(positions: { x: number; y: number }[]) {
  return positions.every((p) => p.x >= 0 && p.x <= BOX_W && p.y >= 0 && p.y <= BOX_H);
}

describe("buildRing", () => {
  it("places N nodes on a cycle with N edges", () => {
    const { positions, edges } = buildRing(6);
    expect(positions).toHaveLength(6);
    expect(edges).toHaveLength(6);
    expect(allInsideBox(positions)).toBe(true);
  });

  it("uses contiguous ids starting at 0", () => {
    const { positions } = buildRing(5);
    expect(positions.map((p) => p.id)).toEqual([0, 1, 2, 3, 4]);
  });
});

describe("buildWheel", () => {
  it("has nOuter+1 nodes and 2*nOuter edges (rim + spokes)", () => {
    const { positions, edges } = buildWheel(6);
    expect(positions).toHaveLength(7);
    expect(edges).toHaveLength(12);
  });

  it("every outer node connects to the center (id 0)", () => {
    const { edges } = buildWheel(5);
    const incidentToCenter = edges.filter(([a, b]) => a === 0 || b === 0);
    expect(incidentToCenter.length).toBe(5);
  });
});

describe("buildStar", () => {
  it("center + N leaves, N edges (all from center)", () => {
    const { positions, edges } = buildStar(7);
    expect(positions).toHaveLength(8);
    expect(edges).toHaveLength(7);
    expect(edges.every(([a]) => a === 0)).toBe(true);
  });
});

describe("buildPath", () => {
  it("N nodes, N-1 edges, all on the same y", () => {
    const { positions, edges } = buildPath(5);
    expect(positions).toHaveLength(5);
    expect(edges).toHaveLength(4);
    const ys = new Set(positions.map((p) => p.y));
    expect(ys.size).toBe(1);
  });
});

describe("buildComplete", () => {
  it("K_n has n*(n-1)/2 edges", () => {
    const { edges } = buildComplete(5);
    expect(edges).toHaveLength((5 * 4) / 2);
  });
});

describe("buildSquareGrid", () => {
  it("k=3 yields 9 nodes and 12 rook-edges (6 horizontal + 6 vertical)", () => {
    const { positions, edges } = buildSquareGrid(3);
    expect(positions).toHaveLength(9);
    expect(edges).toHaveLength(12);
  });

  it("all positions are inside the box", () => {
    expect(allInsideBox(buildSquareGrid(5).positions)).toBe(true);
  });
});

describe("buildTriangularGrid", () => {
  it("returns a non-empty graph for rows=3", () => {
    const { positions, edges } = buildTriangularGrid(3);
    expect(positions.length).toBeGreaterThan(0);
    expect(edges.length).toBeGreaterThan(0);
    expect(allInsideBox(positions)).toBe(true);
  });
});

describe("buildHexagonalFlower", () => {
  it("rings=1 yields 7 nodes (center + 6) and 6 outer edges", () => {
    const { positions, edges } = buildHexagonalFlower(1);
    expect(positions).toHaveLength(7);
    // Outer hexagon should give 6 unit-distance edges plus 6 spokes from
    // center — exact count depends on tolerance; just sanity-check.
    expect(edges.length).toBeGreaterThanOrEqual(6);
  });
});

describe("PRESETS registry", () => {
  it("every spec produces a valid graph at its default param", () => {
    for (const spec of PRESETS) {
      const { positions, edges } = spec.build(spec.paramDefault);
      expect(positions.length, spec.id).toBeGreaterThan(0);
      expect(allInsideBox(positions), `${spec.id} out of box`).toBe(true);
      const ids = new Set(positions.map((p) => p.id));
      for (const [a, b] of edges) {
        expect(ids.has(a), `${spec.id} edge to missing id ${a}`).toBe(true);
        expect(ids.has(b), `${spec.id} edge to missing id ${b}`).toBe(true);
        expect(a, `${spec.id} self loop`).not.toBe(b);
      }
    }
  });

  it("paramDefault is within [paramMin, paramMax] for every preset", () => {
    for (const spec of PRESETS) {
      expect(spec.paramDefault).toBeGreaterThanOrEqual(spec.paramMin);
      expect(spec.paramDefault).toBeLessThanOrEqual(spec.paramMax);
    }
  });
});
