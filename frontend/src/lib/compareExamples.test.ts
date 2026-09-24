import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  computeConflictStats,
  computeDirectStats,
  computeStructuralStats,
} from "./compareExamples";
import type { GraphDTO } from "../api/rest";

const fetchMock = vi.fn();

beforeEach(() => {
  fetchMock.mockReset();
  globalThis.fetch = fetchMock as unknown as typeof fetch;
});

function ok<T>(body: T): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
}

function err(status: number, statusText: string): Response {
  return new Response("{}", { status, statusText });
}

const triangle: GraphDTO = {
  n_nodes: 3,
  edges: [
    [0, 1],
    [0, 2],
  ],
  node_positions: [
    { id: 0, x: 0, y: 0 },
    { id: 1, x: 10, y: 0 },
    { id: 2, x: 0, y: 10 },
  ],
};

describe("computeStructuralStats", () => {
  it("computes density and average degree", () => {
    // n=3, m=2 -> maxEdges=3, density=2/3; avgDeg=2*2/3
    const { density, avgDeg } = computeStructuralStats(3, triangle.edges);
    expect(density).toBeCloseTo(2 / 3);
    expect(avgDeg).toBeCloseTo(4 / 3);
  });

  it("returns zeros for an empty graph", () => {
    const { density, avgDeg } = computeStructuralStats(0, []);
    expect(density).toBe(0);
    expect(avgDeg).toBe(0);
  });
});

describe("computeDirectStats", () => {
  it("returns ok stats on a successful complement() call", async () => {
    fetchMock.mockResolvedValueOnce(
      ok({
        graph: triangle,
        complement: triangle,
        max_clique_in_G: [0, 1],
        mis_in_complement: [0, 1],
        size: 2,
        all_max_cliques: [[0, 1]],
        n_max_cliques: 1,
        alpha_g: 1,
        chromatic_lower: 2,
        chromatic_upper: 2,
      }),
    );
    const res = await computeDirectStats(triangle);
    expect(res).toEqual({ ok: true, stats: { size: 2, alpha: 1, chromaticLo: 2, chromaticHi: 2 } });
  });

  it("returns an error result instead of throwing on a failed call", async () => {
    fetchMock.mockResolvedValueOnce(err(500, "Internal Server Error"));
    const res = await computeDirectStats(triangle);
    expect(res.ok).toBe(false);
  });
});

describe("computeConflictStats", () => {
  it("chains conflictGraph() then complement() and returns ok stats", async () => {
    fetchMock
      .mockResolvedValueOnce(
        ok({
          conflict_graph: triangle,
          conflict_graph_complement: triangle,
          link_endpoints: [
            [0, 1],
            [0, 2],
          ],
        }),
      )
      .mockResolvedValueOnce(
        ok({
          graph: triangle,
          complement: triangle,
          max_clique_in_G: [0],
          mis_in_complement: [0],
          size: 1,
          all_max_cliques: [[0]],
          n_max_cliques: 1,
          alpha_g: 1,
          chromatic_lower: 1,
          chromatic_upper: 1,
        }),
      );
    const res = await computeConflictStats(triangle, 15);
    expect(res).toEqual({ ok: true, stats: { size: 1, alpha: 1, chromaticLo: 1, chromaticHi: 1 } });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("returns an error result when the first (conflictGraph) call fails", async () => {
    fetchMock.mockResolvedValueOnce(err(422, "Unprocessable"));
    const res = await computeConflictStats(triangle, 15);
    expect(res.ok).toBe(false);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
