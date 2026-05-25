/**
 * Curated example graphs. Each builder returns a MANETResponse-shaped payload
 * we can drop into the pipeline store as if it had come from
 * /api/manet/generate. Edges and positions are hand-specified, so the
 * (otherwise random) RGG generator is bypassed entirely.
 *
 * The positions live in the same 100×100 µm box the live generator uses,
 * so downstream stages (embedding, blockade rings, etc.) render without any
 * special handling.
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
export function buildPetersenExample(): MANETResponse {
  const cx = 50;
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
      box_size: 100,
      comm_radius: 30,
      seed: null,
    },
  };
}
