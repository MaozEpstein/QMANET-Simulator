import { beforeEach, describe, expect, it } from "vitest";
import {
  STORAGE_KEY,
  deleteSaved,
  exportJSON,
  importJSON,
  listSaved,
  saveGraph,
  updateGraph,
} from "./savedGraphs";
import type { MANETResponse } from "../api/rest";

function mkPayload(n = 3): MANETResponse {
  return {
    graph: {
      n_nodes: n,
      edges: [[0, 1]],
      node_positions: Array.from({ length: n }, (_, i) => ({ id: i, x: 10 * i, y: 10 })),
    },
    config: { n_nodes: n, box_size: 100, comm_radius: 30, seed: null },
  };
}

beforeEach(() => {
  localStorage.clear();
});

describe("savedGraphs round-trip", () => {
  it("starts empty", () => {
    expect(listSaved()).toEqual([]);
  });

  it("saveGraph persists and listSaved returns it", () => {
    const saved = saveGraph("Triangle", "three nodes", mkPayload(3));
    const list = listSaved();
    expect(list).toHaveLength(1);
    expect(list[0].id).toBe(saved.id);
    expect(list[0].name).toBe("Triangle");
    expect(list[0].payload.graph.n_nodes).toBe(3);
  });

  it("trims whitespace from name and falls back to placeholder", () => {
    saveGraph("   ", "", mkPayload(2));
    expect(listSaved()[0].name).toBe("ללא שם");
  });

  it("deleteSaved removes the entry", () => {
    const saved = saveGraph("A", "", mkPayload(2));
    deleteSaved(saved.id);
    expect(listSaved()).toEqual([]);
  });

  it("updateGraph patches name and description", () => {
    const saved = saveGraph("old name", "old", mkPayload(2));
    updateGraph(saved.id, { name: "new name" });
    const list = listSaved();
    expect(list[0].name).toBe("new name");
    expect(list[0].description).toBe("old");
  });

  it("listSaved sorts newest first", async () => {
    saveGraph("old", "", mkPayload(2));
    await new Promise((r) => setTimeout(r, 5));
    saveGraph("new", "", mkPayload(2));
    expect(listSaved().map((g) => g.name)).toEqual(["new", "old"]);
  });
});

describe("exportJSON / importJSON", () => {
  it("round-trips a saved graph through JSON", () => {
    const saved = saveGraph("Tri", "for tests", mkPayload(3));
    const text = exportJSON(saved.id);
    deleteSaved(saved.id);
    expect(listSaved()).toEqual([]);

    const restored = importJSON(text);
    expect(restored.payload.graph.n_nodes).toBe(3);
    expect(listSaved()).toHaveLength(1);
  });

  it("importJSON accepts a bare MANETResponse payload", () => {
    const text = JSON.stringify(mkPayload(4));
    const saved = importJSON(text);
    expect(saved.name).toBe("מיובא");
    expect(saved.payload.graph.n_nodes).toBe(4);
  });

  it("importJSON throws on invalid JSON", () => {
    expect(() => importJSON("not json {{{")).toThrow(/JSON/);
  });

  it("importJSON throws when payload is missing required fields", () => {
    expect(() => importJSON(JSON.stringify({ name: "x", foo: "bar" }))).toThrow(/MANET/);
  });

  it("exportJSON throws when id is unknown", () => {
    expect(() => exportJSON("does-not-exist")).toThrow(/לא נמצא/);
  });
});

describe("storage robustness", () => {
  it("ignores corrupt JSON in localStorage", () => {
    localStorage.setItem(STORAGE_KEY, "not-json");
    expect(listSaved()).toEqual([]);
  });

  it("filters out entries with wrong schemaVersion", () => {
    localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify([{ id: "x", name: "y", description: "", createdAt: "", schemaVersion: 999, payload: mkPayload() }]),
    );
    expect(listSaved()).toEqual([]);
  });
});
