import { describe, expect, it } from "vitest";
import {
  COLLISION_DISTANCE,
  PROXIMITY_WARN_DISTANCE,
  SOFT_MAX_NODES,
  normalizeEdges,
  validateGraph,
  wouldCollideWithExisting,
} from "./graphValidation";
import type { GraphDTO } from "../api/rest";

function mkGraph(positions: { id: number; x: number; y: number }[], edges: [number, number][] = []): GraphDTO {
  return { n_nodes: positions.length, edges, node_positions: positions };
}

describe("validateGraph", () => {
  it("blocks a graph with fewer than 2 nodes", () => {
    const res = validateGraph(mkGraph([{ id: 0, x: 10, y: 10 }]));
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.errors[0]).toContain("לפחות 2");
  });

  it("blocks two nodes on the exact same position", () => {
    const res = validateGraph(
      mkGraph([
        { id: 0, x: 50, y: 50 },
        { id: 1, x: 50, y: 50 },
      ]),
    );
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.errors.join(" ")).toContain("אותה נקודה");
  });

  it("warns (but accepts) when two nodes are very close", () => {
    const res = validateGraph(
      mkGraph([
        { id: 0, x: 50, y: 50 },
        { id: 1, x: 50 + (COLLISION_DISTANCE + PROXIMITY_WARN_DISTANCE) / 2, y: 50 },
      ]),
    );
    expect(res.ok).toBe(true);
    if (res.ok) expect(res.warnings.join(" ")).toContain("קרובים מאוד");
  });

  it("warns (but accepts) when above SOFT_MAX_NODES", () => {
    const n = SOFT_MAX_NODES + 1;
    const positions = Array.from({ length: n }, (_, i) => ({ id: i, x: i * 2, y: 0 }));
    const res = validateGraph(mkGraph(positions));
    expect(res.ok).toBe(true);
    if (res.ok) expect(res.warnings.join(" ")).toContain("מעל");
  });

  it("accepts a clean graph with no warnings", () => {
    const res = validateGraph(
      mkGraph([
        { id: 0, x: 10, y: 10 },
        { id: 1, x: 80, y: 80 },
      ]),
    );
    expect(res.ok).toBe(true);
    if (res.ok) expect(res.warnings).toEqual([]);
  });
});

describe("normalizeEdges", () => {
  it("removes self-loops", () => {
    expect(normalizeEdges([[0, 0], [1, 2]])).toEqual([[1, 2]]);
  });

  it("dedups [a,b] and [b,a]", () => {
    expect(normalizeEdges([[1, 2], [2, 1]])).toEqual([[1, 2]]);
  });

  it("always orders smaller id first", () => {
    expect(normalizeEdges([[5, 3]])).toEqual([[3, 5]]);
  });
});

describe("wouldCollideWithExisting", () => {
  const positions = [{ id: 0, x: 50, y: 50 }];

  it("returns true for a point within COLLISION_DISTANCE", () => {
    expect(wouldCollideWithExisting(positions, 50, 50)).toBe(true);
    expect(wouldCollideWithExisting(positions, 50.1, 50)).toBe(true);
  });

  it("returns false for a clearly separated point", () => {
    expect(wouldCollideWithExisting(positions, 60, 60)).toBe(false);
  });

  it("ignores its own id during a drag", () => {
    expect(wouldCollideWithExisting(positions, 50, 50, 0)).toBe(false);
  });
});
