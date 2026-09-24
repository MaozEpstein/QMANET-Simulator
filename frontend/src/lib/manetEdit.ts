/**
 * Small, direct edits to a MANETResponse — used by Stage 2's inline editing
 * on the raw graph panels (G / C), so quick fixes don't force a trip back to
 * Stage 1. Node ids are kept contiguous (0..n-1) after a deletion, matching
 * GraphEditor.buildPayload's convention.
 */
import type { MANETResponse } from "../api/rest";

export function deleteManetNode(m: MANETResponse, id: number): MANETResponse {
  const positions = (m.graph.node_positions ?? []).filter((p) => p.id !== id);
  const idToIndex = new Map<number, number>();
  positions.forEach((p, i) => idToIndex.set(p.id, i));
  const newPositions = positions.map((p, i) => ({ id: i, x: p.x, y: p.y }));
  const newEdges = m.graph.edges
    .filter(([a, b]) => a !== id && b !== id)
    .map(([a, b]) => [idToIndex.get(a)!, idToIndex.get(b)!] as [number, number]);
  return {
    ...m,
    graph: { n_nodes: newPositions.length, edges: newEdges, node_positions: newPositions },
    config: { ...m.config, n_nodes: newPositions.length },
  };
}

export function deleteManetEdge(m: MANETResponse, a: number, b: number): MANETResponse {
  return {
    ...m,
    graph: {
      ...m.graph,
      edges: m.graph.edges.filter(([x, y]) => !((x === a && y === b) || (x === b && y === a))),
    },
  };
}

/** Returns null when the edge already exists or a === b (no-op edits). */
export function addManetEdge(m: MANETResponse, a: number, b: number): MANETResponse | null {
  if (a === b) return null;
  const lo = Math.min(a, b);
  const hi = Math.max(a, b);
  const exists = m.graph.edges.some(([x, y]) => Math.min(x, y) === lo && Math.max(x, y) === hi);
  if (exists) return null;
  return { ...m, graph: { ...m.graph, edges: [...m.graph.edges, [lo, hi]] } };
}
