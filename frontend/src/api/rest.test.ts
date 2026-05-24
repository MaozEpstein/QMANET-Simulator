/**
 * Tests for the typed REST client wrappers.
 *
 * These guard against:
 *  - silently dropping HTTP error codes
 *  - sending malformed bodies
 *  - drift between TS types and what the backend actually returns
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { api, type GraphDTO, type MANETResponse, type MISResponse } from "./rest";

const fetchMock = vi.fn();

beforeEach(() => {
  fetchMock.mockReset();
  globalThis.fetch = fetchMock as unknown as typeof fetch;
});

afterEach(() => {
  vi.restoreAllMocks();
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

describe("api.health", () => {
  it("returns the health JSON on 200", async () => {
    fetchMock.mockResolvedValueOnce(
      ok({ status: "ok", service: "qsimulator-backend", version: "0.1.0" }),
    );
    const res = await api.health();
    expect(res.status).toBe("ok");
    expect(fetchMock).toHaveBeenCalledWith("/");
  });

  it("throws on 5xx", async () => {
    fetchMock.mockResolvedValueOnce(err(500, "Internal Server Error"));
    await expect(api.health()).rejects.toThrow(/500/);
  });
});

describe("api.aquila", () => {
  it("returns the full Aquila spec shape", async () => {
    const fakeSpec = {
      max_qubits: 256,
      max_width_um: 75,
      max_height_um: 76,
      min_site_spacing_um: 4,
      min_row_spacing_um: 4,
      max_rabi_rad_us: 15.8,
      rabi_slew_rate: 250,
      detuning_max_rad_us: 125,
      max_duration_us: 4,
      c6_rad_us_um6: 862690,
      noise: { sigma_xy_um: 0.2, t2_star_us: 5.8 },
    };
    fetchMock.mockResolvedValueOnce(ok(fakeSpec));
    const res = await api.aquila();
    expect(res.max_qubits).toBe(256);
    expect(res.noise.sigma_xy_um).toBe(0.2);
  });

  it("throws on 404", async () => {
    fetchMock.mockResolvedValueOnce(err(404, "Not Found"));
    await expect(api.aquila()).rejects.toThrow(/404/);
  });
});

describe("api.generateMANET", () => {
  it("posts JSON body and parses MANETResponse", async () => {
    const fake: MANETResponse = {
      graph: {
        n_nodes: 3,
        edges: [[0, 1]],
        node_positions: [
          { id: 0, x: 1, y: 2 },
          { id: 1, x: 3, y: 4 },
          { id: 2, x: 5, y: 6 },
        ],
      },
      config: { n_nodes: 3, box_size: 100, comm_radius: 35, seed: 1 },
    };
    fetchMock.mockResolvedValueOnce(ok(fake));
    const res = await api.generateMANET({
      n_nodes: 3,
      box_size: 100,
      comm_radius: 35,
      seed: 1,
    });
    expect(res.graph.n_nodes).toBe(3);
    expect(res.graph.edges).toEqual([[0, 1]]);

    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("/api/manet/generate");
    expect(init.method).toBe("POST");
    expect(init.headers["Content-Type"]).toBe("application/json");
    expect(JSON.parse(init.body)).toEqual({
      n_nodes: 3,
      box_size: 100,
      comm_radius: 35,
      seed: 1,
    });
  });

  it("surfaces 422 validation errors", async () => {
    fetchMock.mockResolvedValueOnce(err(422, "Unprocessable Entity"));
    await expect(
      api.generateMANET({ n_nodes: 1, box_size: 100, comm_radius: 35, seed: 1 }),
    ).rejects.toThrow(/422/);
  });
});

describe("api.complement", () => {
  it("wraps the graph in {graph: ...} and parses MISResponse", async () => {
    const inputGraph: GraphDTO = {
      n_nodes: 3,
      edges: [
        [0, 1],
        [0, 2],
        [1, 2],
      ],
      node_positions: null,
    };
    const fake: MISResponse = {
      graph: inputGraph,
      complement: { n_nodes: 3, edges: [], node_positions: null },
      max_clique_in_G: [0, 1, 2],
      mis_in_complement: [0, 1, 2],
      size: 3,
    };
    fetchMock.mockResolvedValueOnce(ok(fake));
    const res = await api.complement(inputGraph);
    expect(res.size).toBe(3);
    expect(res.max_clique_in_G).toEqual([0, 1, 2]);

    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("/api/graph/complement");
    expect(JSON.parse(init.body)).toEqual({ graph: inputGraph });
  });

  it("throws on network failure", async () => {
    fetchMock.mockRejectedValueOnce(new TypeError("Failed to fetch"));
    await expect(
      api.complement({ n_nodes: 0, edges: [], node_positions: null }),
    ).rejects.toThrow(/fetch/);
  });
});
