/**
 * Tests for the typed REST client wrappers.
 *
 * These guard against:
 *  - silently dropping HTTP error codes
 *  - sending malformed bodies
 *  - drift between TS types and what the backend actually returns
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  api,
  type EmbedResponse,
  type GraphDTO,
  type MANETResponse,
  type MISResponse,
} from "./rest";

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

describe("api.embed", () => {
  it("posts target_graph and parses EmbedResponse", async () => {
    const fake: EmbedResponse = {
      positions: [{ id: 0, x: 10, y: 10 }],
      n_atoms: 1,
      blockade_radius_um: 8.7,
      induced_edges: [],
      embedding_fidelity: 1.0,
      missing_edges: [],
      spurious_edges: [],
      violations: [],
    };
    fetchMock.mockResolvedValueOnce(ok(fake));
    const res = await api.embed({
      target_graph: { n_nodes: 1, edges: [], node_positions: null },
    });
    expect(res.n_atoms).toBe(1);
    expect(res.blockade_radius_um).toBeCloseTo(8.7);

    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("/api/embed/atoms");
    expect(init.method).toBe("POST");
  });

  it("forwards optional config", async () => {
    fetchMock.mockResolvedValueOnce(
      ok({
        positions: [],
        n_atoms: 0,
        blockade_radius_um: 8,
        induced_edges: [],
        embedding_fidelity: 1,
        missing_edges: [],
        spurious_edges: [],
        violations: [],
      } satisfies EmbedResponse),
    );
    await api.embed({
      target_graph: { n_nodes: 0, edges: [], node_positions: null },
      config: { rabi_rad_us: 10, lattice_spacing_um: 6 },
    });
    const [, init] = fetchMock.mock.calls[0];
    const body = JSON.parse(init.body);
    expect(body.config.rabi_rad_us).toBe(10);
    expect(body.config.lattice_spacing_um).toBe(6);
  });

  it("rejects on 422 (Aquila Pydantic validation)", async () => {
    fetchMock.mockResolvedValueOnce(err(422, "Unprocessable Entity"));
    await expect(
      api.embed({
        target_graph: { n_nodes: 0, edges: [], node_positions: null },
        config: { rabi_rad_us: 20 },
      }),
    ).rejects.toThrow(/422/);
  });
});

describe("api.schedule + api.presets", () => {
  it("presets() returns the registered names", async () => {
    fetchMock.mockResolvedValueOnce(
      ok({ presets: ["paper_linear_ramp", "bernien_2017_sweep"] }),
    );
    const res = await api.presets();
    expect(res.presets).toContain("paper_linear_ramp");
  });

  it("schedule() posts preset and parses ScheduleResponse", async () => {
    fetchMock.mockResolvedValueOnce(
      ok({
        schedule: {
          omega: { times: [0, 4], values: [0, 0] },
          delta: { times: [0, 4], values: [-30, 40] },
          phi: { times: [0, 4], values: [0, 0] },
          duration: 4,
        },
        violations: [],
        max_omega_slew_rate: 37.5,
      }),
    );
    const res = await api.schedule({ preset: "paper_linear_ramp" });
    expect(res.schedule.duration).toBe(4);
    expect(res.max_omega_slew_rate).toBe(37.5);

    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("/api/schedule/build");
    expect(init.method).toBe("POST");
    expect(JSON.parse(init.body).preset).toBe("paper_linear_ramp");
  });

  it("schedule() rejects on 422 for unknown preset", async () => {
    fetchMock.mockResolvedValueOnce(err(422, "Unprocessable Entity"));
    await expect(api.schedule({ preset: "no_such" })).rejects.toThrow(/422/);
  });
});

describe("api.simulate", () => {
  it("posts SimulateRequest and parses SimulateResponse", async () => {
    fetchMock.mockResolvedValueOnce(
      ok({
        frames: [
          { t_us: 0, rydberg_populations: [0, 0], norm: 1 },
          { t_us: 1, rydberg_populations: [0.5, 0.5], norm: 1 },
        ],
        final_bitstring_probs: { "01": 0.5, "10": 0.5 },
        n_atoms: 2,
        duration_us: 1,
      }),
    );
    const res = await api.simulate({
      positions: [
        { id: 0, x: 10, y: 10 },
        { id: 1, x: 14, y: 10 },
      ],
      schedule: {
        omega: { times: [0, 1], values: [5, 5] },
        delta: { times: [0, 1], values: [0, 0] },
        phi: { times: [0, 1], values: [0, 0] },
        duration: 1,
      },
      n_frames: 2,
    });
    expect(res.frames.length).toBe(2);
    expect(res.n_atoms).toBe(2);

    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("/api/simulate/run");
    expect(init.method).toBe("POST");
  });

  it("rejects on 422 (invalid n_frames)", async () => {
    fetchMock.mockResolvedValueOnce(err(422, "Unprocessable Entity"));
    await expect(
      api.simulate({
        positions: [],
        schedule: {
          omega: { times: [], values: [] },
          delta: { times: [], values: [] },
          phi: { times: [], values: [] },
          duration: 0,
        },
        n_frames: 0,
      }),
    ).rejects.toThrow(/422/);
  });
});

describe("api.measure / api.postprocess / api.classicalSA", () => {
  it("measure() posts probs and parses response", async () => {
    fetchMock.mockResolvedValueOnce(
      ok({
        bitstrings: ["00", "01"],
        histogram: { "00": 1, "01": 1 },
        n_shots: 2,
        n_atoms: 2,
      }),
    );
    const res = await api.measure({
      bitstring_probs: { "00": 0.5, "01": 0.5 },
      n_shots: 2,
      apply_noise: false,
    });
    expect(res.n_atoms).toBe(2);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("/api/measure");
    expect(init.method).toBe("POST");
  });

  it("postprocess() posts a bitstring + graph", async () => {
    fetchMock.mockResolvedValueOnce(
      ok({
        raw_bitstring: "11",
        raw_size: 2,
        raw_violations: 1,
        after_fix_bitstring: "10",
        after_fix_size: 1,
        removed: [1],
        final_bitstring: "10",
        final_size: 1,
        added: [],
        is_valid: true,
      }),
    );
    const res = await api.postprocess(
      "11",
      { n_nodes: 2, edges: [[0, 1]], node_positions: null },
      42,
    );
    expect(res.is_valid).toBe(true);
    expect(res.final_size).toBe(1);
  });

  it("classicalSA() posts graph + config", async () => {
    fetchMock.mockResolvedValueOnce(
      ok({
        best_set: [0, 2],
        best_size: 2,
        best_energy: -2,
        n_iterations: 100,
        energy_trace: [0, -1, -2],
      }),
    );
    const res = await api.classicalSA(
      { n_nodes: 3, edges: [[0, 1], [1, 2]], node_positions: null },
      { n_sweeps: 100 },
    );
    expect(res.best_size).toBe(2);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("/api/classical/sa");
    expect(JSON.parse(init.body).config.n_sweeps).toBe(100);
  });

  it("routing() posts graph + backbone and parses RoutingResponse", async () => {
    fetchMock.mockResolvedValueOnce(
      ok({
        backbone: [0, 1, 2],
        is_clique: true,
        covered_nodes: [0, 1, 2, 3],
        coverage_fraction: 1.0,
        n_reachable_pairs: 12,
        mean_hops: 1.5,
        max_hops: 2,
        routes: [],
      }),
    );
    const res = await api.routing(
      { n_nodes: 4, edges: [[0, 1], [0, 2], [1, 2], [2, 3]], node_positions: null },
      [0, 1, 2],
    );
    expect(res.is_clique).toBe(true);
    expect(res.coverage_fraction).toBe(1.0);
    const [url] = fetchMock.mock.calls[0];
    expect(url).toBe("/api/routing/build");
  });

  it("postprocessBatch() forwards shots and parses summary", async () => {
    fetchMock.mockResolvedValueOnce(
      ok({
        results: [
          {
            raw_bitstring: "00",
            raw_size: 0,
            raw_violations: 0,
            after_fix_bitstring: "00",
            after_fix_size: 0,
            removed: [],
            final_bitstring: "10",
            final_size: 1,
            added: [0],
            is_valid: true,
          },
        ],
        summary: {
          n_shots: 1,
          mean_raw_size: 0,
          mean_fixed_size: 0,
          mean_final_size: 1,
          best_final_size: 1,
        },
      }),
    );
    const res = await api.postprocessBatch(
      ["00"],
      { n_nodes: 2, edges: [[0, 1]], node_positions: null },
      0,
    );
    expect(res.results.length).toBe(1);
    expect(res.summary.best_final_size).toBe(1);
  });
});
