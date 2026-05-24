/**
 * Tests for the Zustand pipeline store.
 * The store is the spine connecting all 8 stages, so regressions here
 * break the entire pipeline chain.
 */

import { beforeEach, describe, expect, it } from "vitest";
import { STAGES, usePipeline } from "./pipeline";

beforeEach(() => {
  usePipeline.setState({
    currentStage: "manet",
    manet: null,
    mis: null,
    embed: null,
    schedule: null,
  });
});

describe("STAGES", () => {
  it("has exactly 8 stages in canonical order", () => {
    expect(STAGES.length).toBe(8);
    expect(STAGES.map((s) => s.id)).toEqual([
      "manet",
      "complement",
      "embedding",
      "schedule",
      "evolution",
      "measurement",
      "postprocess",
      "routing",
    ]);
  });

  it("every stage has a Hebrew label", () => {
    for (const s of STAGES) {
      expect(s.he).toBeTruthy();
      expect(s.label).toBeTruthy();
    }
  });

  it("stage ids are unique", () => {
    const ids = STAGES.map((s) => s.id);
    expect(new Set(ids).size).toBe(ids.length);
  });
});

describe("usePipeline store", () => {
  it("initial currentStage is 'manet'", () => {
    expect(usePipeline.getState().currentStage).toBe("manet");
  });

  it("setStage updates currentStage", () => {
    usePipeline.getState().setStage("evolution");
    expect(usePipeline.getState().currentStage).toBe("evolution");
  });

  it("initial manet and mis are null", () => {
    expect(usePipeline.getState().manet).toBeNull();
    expect(usePipeline.getState().mis).toBeNull();
  });

  it("setManet stores a MANETResponse", () => {
    const fake = {
      graph: { n_nodes: 2, edges: [[0, 1] as [number, number]], node_positions: null },
      config: { n_nodes: 2, box_size: 10, comm_radius: 5, seed: 1 },
    };
    usePipeline.getState().setManet(fake);
    expect(usePipeline.getState().manet).toEqual(fake);
  });

  it("setEmbed stores and clears", () => {
    const fake = {
      positions: [{ id: 0, x: 10, y: 10 }],
      n_atoms: 1,
      blockade_radius_um: 8,
      induced_edges: [],
      embedding_fidelity: 1,
      missing_edges: [],
      spurious_edges: [],
      violations: [],
    };
    usePipeline.getState().setEmbed(fake);
    expect(usePipeline.getState().embed).toEqual(fake);
    usePipeline.getState().setEmbed(null);
    expect(usePipeline.getState().embed).toBeNull();
  });

  it("setSchedule stores and clears", () => {
    const fake = {
      schedule: {
        omega: { times: [0, 4], values: [0, 0] },
        delta: { times: [0, 4], values: [-30, 40] },
        phi: { times: [0, 4], values: [0, 0] },
        duration: 4,
      },
      violations: [],
      max_omega_slew_rate: 37.5,
    };
    usePipeline.getState().setSchedule(fake);
    expect(usePipeline.getState().schedule).toEqual(fake);
    usePipeline.getState().setSchedule(null);
    expect(usePipeline.getState().schedule).toBeNull();
  });

  it("setMIS clears with null", () => {
    usePipeline.getState().setMIS({
      graph: { n_nodes: 0, edges: [], node_positions: null },
      complement: { n_nodes: 0, edges: [], node_positions: null },
      max_clique_in_G: [],
      mis_in_complement: [],
      size: 0,
    });
    expect(usePipeline.getState().mis).not.toBeNull();
    usePipeline.getState().setMIS(null);
    expect(usePipeline.getState().mis).toBeNull();
  });
});
