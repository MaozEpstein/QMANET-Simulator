/**
 * Curated example graphs. Each builder returns a MANETResponse-shaped payload
 * we can drop into the pipeline store as if it had come from
 * /api/manet/generate. Edges and positions are hand-specified, so the
 * (otherwise random) RGG generator is bypassed entirely.
 *
 * Positions live in the editor's 200×100 µm workspace; presets center
 * themselves at (100, 50) so they sit in the middle of the wide canvas.
 */

import type { MANETResponse } from "../api/rest";

/**
 * Petersen graph — N=10, 15 edges, 3-regular, triangle-free.
 *
 * Layout: outer pentagon (vertices 0-4) at radius 38 around the box centre,
 * inner pentagram (vertices 5-9) at radius 16. Each outer vertex `i` is
 * connected to its outer neighbours (i±1 mod 5), to the inner vertex i+5
 * (spoke), and inner vertex `i+5` is connected to inner vertices (i+2)+5
 * and (i-2)+5 (pentagram chords).
 *
 * α(Petersen) = 4. MaxClique(Petersen) = 2 (the graph is triangle-free).
 */
/**
 * C₄ — the 4-cycle (square). N=4, 4 edges around the rim.
 *
 * The simplest non-trivial graph where the complement is visually obvious:
 * remove the rim edges, keep the two diagonals — i.e. the complement of
 * C₄ is exactly a perfect matching on 4 vertices (two disjoint edges).
 *
 * α(C₄) = 2 (pick any two opposite corners). MaxClique(C₄) = 2 (it's
 * triangle-free). Pedagogically perfect for showing the MIS↔clique
 * relationship between G and its complement.
 */
export function buildC4Example(): MANETResponse {
  const positions = [
    { id: 0, x: 70, y: 20 },
    { id: 1, x: 130, y: 20 },
    { id: 2, x: 130, y: 80 },
    { id: 3, x: 70, y: 80 },
  ];
  const edges: [number, number][] = [
    [0, 1],
    [1, 2],
    [2, 3],
    [3, 0],
  ];
  return {
    graph: { n_nodes: 4, edges, node_positions: positions },
    config: { n_nodes: 4, box_size: 200, comm_radius: 60, seed: null },
  };
}

/**
 * K₃,₃ — the complete bipartite graph on two sets of 3 vertices.
 *
 * Two rows of 3 vertices, every cross-pair connected (9 edges). The
 * complement is 2K₃ — two disjoint triangles, one per row. Loading this
 * example produces a visually clean Stage 2 (bipartite ↔ two triangles),
 * a well-separated 2-cluster embedding on Aquila, and a Stage 8 backbone
 * with two equivalent candidates.
 *
 * α(K₃,₃) = 3 (an entire row). MaxClique(K₃,₃) = 2 (bipartite =⇒ no
 * triangles). On the complement: ω(Ḡ) = 3 (each triangle).
 */
export function buildK33Example(): MANETResponse {
  // Each partition forms a triangle (not a line!) so the complement's
  // K₃ ∪ K₃ structure renders as two clearly visible triangles in
  // Stage 2 — collinear vertices would collapse all three triangle
  // edges into a single line segment.
  const positions = [
    // Upper partition — triangle with apex pointing up
    { id: 0, x: 70, y: 65 },
    { id: 1, x: 130, y: 65 },
    { id: 2, x: 100, y: 90 },
    // Lower partition — triangle with apex pointing down
    { id: 3, x: 70, y: 35 },
    { id: 4, x: 130, y: 35 },
    { id: 5, x: 100, y: 10 },
  ];
  const edges: [number, number][] = [];
  for (const top of [0, 1, 2]) {
    for (const bot of [3, 4, 5]) {
      edges.push([top, bot]);
    }
  }
  return {
    graph: { n_nodes: 6, edges, node_positions: positions },
    config: { n_nodes: 6, box_size: 200, comm_radius: 50, seed: null },
  };
}

/**
 * Q₃ — the 3-cube graph (also known as the hypercube graph).
 *
 * 8 vertices = corners of a cube, 12 edges = the cube's edges. Each
 * vertex has degree 3; the graph is bipartite (so triangle-free, hence
 * MaxClique=2) but the MIS is much harder to spot by eye:
 *
 *   α(Q₃) = 4 — the four "even-parity" corners form an MIS.
 *
 * On the complement: ω(Ḡ) = 4 (that same 4-set becomes a K₄!), so
 * Stage 2 shows a dramatically denser graph and asks the solver to
 * locate a specific 4-clique among 16 edges. Embedding has to place
 * those 4 atoms within mutual blockade — a classic stress-test for
 * the layout heuristic.
 *
 * Layout: the textbook "two squares" rendering — an outer rectangle
 * (corners 0..3) and an inner rectangle (corners 4..7), with corner i
 * of the outer linked to corner (i+4) of the inner.
 */
export function buildQ3Example(): MANETResponse {
  const positions = [
    // Outer rectangle (CCW from top-left)
    { id: 0, x: 30, y: 90 },
    { id: 1, x: 170, y: 90 },
    { id: 2, x: 170, y: 10 },
    { id: 3, x: 30, y: 10 },
    // Inner rectangle (CCW from top-left)
    { id: 4, x: 75, y: 65 },
    { id: 5, x: 125, y: 65 },
    { id: 6, x: 125, y: 35 },
    { id: 7, x: 75, y: 35 },
  ];
  const edges: [number, number][] = [
    // Outer square
    [0, 1], [1, 2], [2, 3], [3, 0],
    // Inner square
    [4, 5], [5, 6], [6, 7], [7, 4],
    // Connectors (corresponding corners)
    [0, 4], [1, 5], [2, 6], [3, 7],
  ];
  return {
    graph: { n_nodes: 8, edges, node_positions: positions },
    config: { n_nodes: 8, box_size: 200, comm_radius: 50, seed: null },
  };
}

export function buildPetersenExample(): MANETResponse {
  const cx = 100;
  const cy = 50;
  const outerR = 38;
  const innerR = 16;
  const positions: { id: number; x: number; y: number }[] = [];

  for (let i = 0; i < 5; i++) {
    const theta = -Math.PI / 2 + (i * 2 * Math.PI) / 5;
    positions.push({ id: i, x: cx + outerR * Math.cos(theta), y: cy + outerR * Math.sin(theta) });
  }
  for (let i = 0; i < 5; i++) {
    const theta = -Math.PI / 2 + (i * 2 * Math.PI) / 5;
    positions.push({ id: i + 5, x: cx + innerR * Math.cos(theta), y: cy + innerR * Math.sin(theta) });
  }

  const edges: [number, number][] = [
    // Outer pentagon
    [0, 1], [1, 2], [2, 3], [3, 4], [4, 0],
    // Spokes
    [0, 5], [1, 6], [2, 7], [3, 8], [4, 9],
    // Inner pentagram — each inner vertex connects to the one two steps away
    [5, 7], [6, 8], [7, 9], [8, 5], [9, 6],
  ];

  return {
    graph: {
      n_nodes: 10,
      edges,
      node_positions: positions,
    },
    config: {
      // These numbers are cosmetic on a hand-built graph: the edges are fixed.
      // We expose plausible MANET-style parameters so the Stage 1 sidebar
      // doesn't show empty fields.
      n_nodes: 10,
      box_size: 200,
      comm_radius: 30,
      seed: null,
    },
  };
}
