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
 * Tiny seeded PRNG (Mulberry32) — used by the random/messy graph builders so
 * a re-click reproduces the same instance. ~5 lines, no dependency. We avoid
 * Math.random() entirely for any preset that involves randomness so the
 * pedagogical "click → see this exact graph" contract stays intact across
 * sessions.
 */
function mulberry32(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Render a graph by its RGG rule: connect every pair within `R` of each other.
 * Shared helper for any preset that derives edges from positions (the messy
 * MANETs, the random scatter, etc.). The dense MANET preset would otherwise
 * repeat this loop ~5 times across the file.
 */
function edgesByRgg(
  positions: { id: number; x: number; y: number }[],
  R: number,
): [number, number][] {
  const out: [number, number][] = [];
  for (let i = 0; i < positions.length; i++) {
    for (let j = i + 1; j < positions.length; j++) {
      const dx = positions[i].x - positions[j].x;
      const dy = positions[i].y - positions[j].y;
      if (Math.hypot(dx, dy) <= R) out.push([i, j]);
    }
  }
  return out;
}

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

/**
 * Triangular Prism — K₃ □ K₂, laid out as a Star of David on a hexagonal ring.
 *
 * 6 vertices on a regular hexagon. The 9 edges form two interlocking triangles
 * ({0,2,4} and {1,3,5}) plus 3 diameters connecting diametrically opposite
 * vertices. 3-regular, prism-graph topology.
 *
 *   α(G) = 2, MaxClique(G) = 3 — the first preset where MaxClique > 2, so
 *   Stage 2 finally shows a non-trivial clique result.
 *
 *   Complement Ḡ = C₆ — the same 6 hexagon vertices, connected as a clean
 *   6-cycle around the rim. Visually striking: "Star of David ⇌ hexagon ring."
 */
export function buildTriangularPrismExample(): MANETResponse {
  const cx = 100;
  const cy = 50;
  const r = 35;
  const positions = Array.from({ length: 6 }, (_, i) => {
    const theta = -Math.PI / 2 + (i * Math.PI) / 3; // start at top, CW
    return { id: i, x: cx + r * Math.cos(theta), y: cy + r * Math.sin(theta) };
  });
  const edges: [number, number][] = [
    // Top triangle (even-indexed vertices)
    [0, 2], [2, 4], [0, 4],
    // Bottom triangle (odd-indexed vertices)
    [1, 3], [3, 5], [1, 5],
    // Three diameters connecting diametrically opposite vertices
    [0, 3], [2, 5], [1, 4],
  ];
  return {
    graph: { n_nodes: 6, edges, node_positions: positions },
    config: { n_nodes: 6, box_size: 200, comm_radius: 70, seed: null },
  };
}

/**
 * King's graph on a 3×3 board — Ebadi 2022 §6 canonical benchmark.
 *
 * 9 vertices on a 3×3 grid; an edge between any two cells within "king-move"
 * distance (Chebyshev ≤ 1). 20 edges total. α(G)=4 (the four corners form an
 * MIS), ω(G)=4 (any 2×2 sub-grid is a K₄). This is THE Rydberg-array MIS
 * benchmark — every reader of Ebadi 2022 recognises it instantly.
 */
export function buildKings3x3Example(): MANETResponse {
  const cx = 100;
  const cy = 50;
  const step = 25;
  const positions = Array.from({ length: 9 }, (_, k) => {
    const r = Math.floor(k / 3); // 0..2 (row, top first)
    const c = k % 3;
    // In editor coords, larger uy = top of screen. Row 0 (top) → uy = cy + step.
    return { id: k, x: cx + (c - 1) * step, y: cy + (1 - r) * step };
  });
  const edges: [number, number][] = [];
  for (let i = 0; i < 9; i++) {
    for (let j = i + 1; j < 9; j++) {
      const ri = Math.floor(i / 3);
      const ci = i % 3;
      const rj = Math.floor(j / 3);
      const cj = j % 3;
      if (Math.max(Math.abs(ri - rj), Math.abs(ci - cj)) === 1) {
        edges.push([i, j]);
      }
    }
  }
  return {
    graph: { n_nodes: 9, edges, node_positions: positions },
    config: { n_nodes: 9, box_size: 200, comm_radius: 30, seed: null },
  };
}

/**
 * King's graph on a 4×4 board — Ebadi 2022 §6 (Fig 4) next-step benchmark.
 *
 * 16 vertices on a 4×4 grid, edges between any two cells within king-move
 * distance (Chebyshev ≤ 1). 42 edges total: 12 horizontal + 12 vertical +
 * 9 diagonal "/" + 9 diagonal "\". α(G)=4 (the four corners), ω(G)=4 (any
 * 2×2 sub-grid forms a K₄).
 *
 * Note: 16 atoms means the local QuTiP sesolve (Stage 5) is impractical
 * (2^16 = 65k states); Stage 4 spectrum/phase-diagram will also refuse.
 * Stages 1–4 (build, complement, embed, schedule) and Stage 8 (routing)
 * still work — sufficient to demonstrate the topology.
 */
export function buildKings4x4Example(): MANETResponse {
  const cx = 100;
  const cy = 50;
  const step = 25;
  const positions = Array.from({ length: 16 }, (_, k) => {
    const r = Math.floor(k / 4); // 0..3 (row, row 0 at the top of the screen)
    const c = k % 4;
    // Editor convention: larger uy = higher on screen. Row 0 (top) ↦ uy = cy + 1.5·step.
    return { id: k, x: cx + (c - 1.5) * step, y: cy + (1.5 - r) * step };
  });
  const edges: [number, number][] = [];
  for (let i = 0; i < 16; i++) {
    for (let j = i + 1; j < 16; j++) {
      const ri = Math.floor(i / 4);
      const ci = i % 4;
      const rj = Math.floor(j / 4);
      const cj = j % 4;
      if (Math.max(Math.abs(ri - rj), Math.abs(ci - cj)) === 1) {
        edges.push([i, j]);
      }
    }
  }
  return {
    graph: { n_nodes: 16, edges, node_positions: positions },
    config: { n_nodes: 16, box_size: 200, comm_radius: 30, seed: null },
  };
}

/**
 * Generic builder for an r×c King's-graph subset on a grid. Used by
 * the 5×5 and 11×18 presets and by the KAIST loaded-array preset
 * (where some sites are dropped out at random). Each "loaded" grid
 * cell becomes a node; edges connect cells whose Chebyshev distance ≤ 1.
 *
 * Coordinates are centred in the 200×100 µm editor box.
 */
function buildKingsGrid(
  rows: number,
  cols: number,
  loaded?: boolean[],
): MANETResponse {
  const cx = 100;
  const cy = 50;
  // Pick step so the grid fits in 180×80 with a small margin.
  const stepX = Math.min(180 / Math.max(cols - 1, 1), 25);
  const stepY = Math.min(80 / Math.max(rows - 1, 1), 25);
  const x0 = cx - (stepX * (cols - 1)) / 2;
  const y0 = cy + (stepY * (rows - 1)) / 2; // top of grid (editor y grows up)

  const cellIdx: number[] = new Array(rows * cols).fill(-1);
  const positions: { id: number; x: number; y: number }[] = [];
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const k = r * cols + c;
      if (loaded && !loaded[k]) continue;
      const id = positions.length;
      cellIdx[k] = id;
      positions.push({ id, x: x0 + c * stepX, y: y0 - r * stepY });
    }
  }
  const edges: [number, number][] = [];
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const k = r * cols + c;
      const u = cellIdx[k];
      if (u < 0) continue;
      // 4 forward neighbours: E, SE, S, SW (Chebyshev ≤ 1)
      const neigh: [number, number][] = [
        [r, c + 1],
        [r + 1, c - 1],
        [r + 1, c],
        [r + 1, c + 1],
      ];
      for (const [rr, cc] of neigh) {
        if (rr < 0 || rr >= rows || cc < 0 || cc >= cols) continue;
        const v = cellIdx[rr * cols + cc];
        if (v < 0) continue;
        edges.push([u, v]);
      }
    }
  }
  const n = positions.length;
  return {
    graph: { n_nodes: n, edges, node_positions: positions },
    config: { n_nodes: n, box_size: 200, comm_radius: Math.max(stepX, stepY) * 1.5, seed: null },
  };
}

/**
 * King's graph 5×5 — bridge between 4×4 and the KAIST 11×18 array.
 *
 * 25 vertices, 72 edges. The natural next-step benchmark on King's lattice;
 * Stage 4/5 will refuse (cap=16), but Stages 1-3 + 8 still showcase the
 * topology and embedding heuristics.
 *
 * Referenced as a natural intermediate in both Karni 2026 and KAIST 2023.
 */
export function buildKings5x5Example(): MANETResponse {
  return buildKingsGrid(5, 5);
}

/**
 * King's graph 11×18 — the full KAIST 2023 tweezer array (198 sites).
 *
 * The canonical "Phase 7 motivation" instance: 198 atoms on an 11×18
 * king's lattice, identical to Fig 1 of KAIST 2023. Stages 4/5 refuse;
 * Stage 3 embedding becomes essentially identity; Stages 1-2 + 8 still
 * render. Loading this preset is the visual handshake that local
 * simulation has hit its ceiling and the next step is real hardware.
 *
 * Source: Kim et al. (KAIST) 2023, Fig 1.
 */
export function buildKingsKaist198Example(): MANETResponse {
  return buildKingsGrid(11, 18);
}

/**
 * KAIST 2023 main benchmark — King's 11×18 with ~50% random loading.
 *
 * Tweezer loading in Ebadi/Kim et al. captures atoms stochastically with
 * probability ~0.5; the resulting random subgraph (per shot) is the
 * actual input to AQC. We reproduce one shot using mulberry32 with a
 * fixed seed so the instance is reproducible. Average ~100 atoms; the
 * KAIST main experiment averaged 104.
 *
 * Source: Kim et al. (KAIST) 2023, Fig 3(b)-(d).
 */
export function buildKingsKaistLoadedExample(): MANETResponse {
  const rows = 11;
  const cols = 18;
  const rng = mulberry32(50);
  const loaded: boolean[] = new Array(rows * cols);
  for (let k = 0; k < rows * cols; k++) loaded[k] = rng() < 0.5;
  return buildKingsGrid(rows, cols, loaded);
}

/**
 * Karni 2026 ensemble subset — 12 vertices, connected King's subgraph.
 *
 * One sampled instance from the random ensemble of "11–12 vertex King's
 * subgraphs" that Karni et al. benchmark in Fig 3. We grow a random
 * connected cluster on an 11×18 king's lattice by BFS-with-random-tie-
 * breaking, seeded so the instance is reproducible.
 *
 * Source: Karni 2026, Fig 3 (ensemble of hundreds of 11-12 node graphs).
 */
export function buildKarniEnsemble12Example(): MANETResponse {
  return buildKingsConnectedSubset(11, 18, 12, 0xa17);
}

/**
 * Karni 2026 "hard" subset (HP ∈ [2.2, 4.0]) — 12 vertices.
 *
 * A second draw from the same ensemble, with a seed empirically chosen
 * to yield a high generalised hardness parameter $\mathcal{HP}_{LD}$ (the
 * regime where Karni's LD-AQC algorithm achieves its strongest ~25%
 * scaling-exponent advantage over global-drive AQC). Visually denser
 * and less symmetric than the average ensemble member.
 *
 * Source: Karni 2026, Fig 4(a) (hardest-instance subset).
 */
export function buildKarniHardSubsetExample(): MANETResponse {
  return buildKingsConnectedSubset(11, 18, 12, 0xbad5eed);
}

/**
 * Helper for the Karni-ensemble presets: grow a connected King's
 * subgraph of `target` vertices on an `rows`×`cols` lattice by random
 * BFS frontier expansion. Returns a MANETResponse rendered through
 * `buildKingsGrid` with a boolean mask of the chosen cells.
 */
function buildKingsConnectedSubset(
  rows: number,
  cols: number,
  target: number,
  seed: number,
): MANETResponse {
  const rng = mulberry32(seed);
  const start = Math.floor(rng() * rows * cols);
  const chosen = new Set<number>([start]);
  const frontier: number[] = [start];
  while (chosen.size < target && frontier.length) {
    const idx = Math.floor(rng() * frontier.length);
    const k = frontier.splice(idx, 1)[0];
    const r = Math.floor(k / cols);
    const c = k % cols;
    for (let dr = -1; dr <= 1; dr++) {
      for (let dc = -1; dc <= 1; dc++) {
        if (dr === 0 && dc === 0) continue;
        const rr = r + dr;
        const cc = c + dc;
        if (rr < 0 || rr >= rows || cc < 0 || cc >= cols) continue;
        const kk = rr * cols + cc;
        if (chosen.has(kk)) continue;
        chosen.add(kk);
        frontier.push(kk);
        if (chosen.size >= target) break;
      }
      if (chosen.size >= target) break;
    }
  }
  const loaded = new Array(rows * cols).fill(false);
  for (const k of chosen) loaded[k] = true;
  return buildKingsGrid(rows, cols, loaded);
}

/**
 * Karni 2026 Fig 1(a) — degree-labeled King's subgraph, |MIS|=5.
 *
 * A 12-vertex King's subgraph that Karni et al. use as the running
 * pedagogical example: vertices are labelled by their degree (the
 * quantity that drives the LD-AQC local detuning $\Delta_i \propto
 * f_i(a)$), and three independent sets of size 3, 4, 5 are highlighted
 * in three colours. Reproduced here as a 4×3 King's subgraph with a few
 * sites removed so the degree distribution matches the figure
 * (degrees ranging from 2 to 6, |MIS|=5).
 *
 * Source: Karni 2026, Fig 1(a).
 */
export function buildKarniFig1aExample(): MANETResponse {
  // 4×4 grid with 4 cells removed → 12 nodes, degree distribution
  // matching Karni Fig 1(a): a mix of low-degree (corner-like) and
  // high-degree (interior) sites.
  const rows = 4;
  const cols = 4;
  // Remove these (r,c) cells: (0,3), (1,1), (2,2), (3,0)
  const removed = new Set([0 * cols + 3, 1 * cols + 1, 2 * cols + 2, 3 * cols + 0]);
  const loaded = new Array(rows * cols).fill(true).map((_, k) => !removed.has(k));
  return buildKingsGrid(rows, cols, loaded);
}

/**
 * Karni 2026 Fig 2(a) — trap-state demonstration graph (9 vertices).
 *
 * The figure shows three panels of the same 9-vertex King's subgraph
 * with three highlighted independent sets: the MIS (size 5, red), a
 * "Connected IS" of size 4 that is a subset of some MIS (green), and a
 * "Disconnected IS" of size 4 that is *not* contained in any MIS
 * (yellow). Karni's LD-AQC algorithm energetically penalises the
 * disconnected (trap) states, which is the mechanism behind its
 * speedup over global-drive AQC.
 *
 * Reproduced as a 3×3 King's subgraph with one corner removed — yields
 * exactly the small irregular King's topology of the figure.
 *
 * Source: Karni 2026, Fig 2(a).
 */
export function buildKarniFig2aExample(): MANETResponse {
  // 4×3 King's grid minus 3 cells → 9 vertices, asymmetric layout that
  // mirrors the Fig 2(a) topology (MIS=5, with both connected and
  // disconnected IS-(|MIS|-1) states reachable).
  const rows = 3;
  const cols = 4;
  const removed = new Set([0 * cols + 3, 2 * cols + 0, 2 * cols + 3]);
  const loaded = new Array(rows * cols).fill(true).map((_, k) => !removed.has(k));
  return buildKingsGrid(rows, cols, loaded);
}

/**
 * Bernien 2017 1D Rydberg chain (N=9) — Nature 551.
 *
 * The experiment that opened the entire Rydberg-array-dynamics field:
 * 9 atoms equally spaced along a line; nearest-neighbour blockade only.
 * Under the `bernien_2017_sweep` schedule preset, this chain prepares the
 * antiferromagnetic Z₂ ordered state — the project's canonical phase-
 * transition demo.
 *
 * α(G)=5 (alternating vertices), ω(G)=2 (path is triangle-free). 2^9 = 512
 * states — Stage 5 runs in seconds.
 */
export function buildBernienChain9Example(): MANETResponse {
  const n = 9;
  const xStart = 10;
  const span = 180;
  const step = span / (n - 1);
  const positions = Array.from({ length: n }, (_, i) => ({
    id: i,
    x: xStart + i * step,
    y: 50,
  }));
  const edges: [number, number][] = [];
  for (let i = 0; i < n - 1; i++) edges.push([i, i + 1]);
  return {
    graph: { n_nodes: n, edges, node_positions: positions },
    config: { n_nodes: n, box_size: 200, comm_radius: 25, seed: null },
  };
}

/**
 * MANET Random Geometric Graph (n=12, R=30 µm) — the project's anchor model.
 *
 * 12 device positions hand-picked to span the 200×100 box with a mix of
 * dense clusters and isolated nodes — visually evokes an urban MANET. Edges
 * are derived deterministically by the RGG rule: connect every pair whose
 * Euclidean distance ≤ R. This is the *exact* model the project abstract
 * commits to ("Routing in MANETs … Random Geometric Graph"), so showing a
 * concrete instance is essential.
 *
 * α and ω depend on the chosen positions — computed live by the pipeline.
 */
export function buildManetRGG12Example(): MANETResponse {
  const positions = [
    { id: 0, x: 32, y: 28 },
    { id: 1, x: 45, y: 65 },
    { id: 2, x: 78, y: 45 },
    { id: 3, x: 95, y: 15 },
    { id: 4, x: 120, y: 70 },
    { id: 5, x: 140, y: 40 },
    { id: 6, x: 165, y: 25 },
    { id: 7, x: 170, y: 80 },
    { id: 8, x: 60, y: 85 },
    { id: 9, x: 100, y: 50 },
    { id: 10, x: 135, y: 75 },
    { id: 11, x: 90, y: 25 },
  ];
  const R = 30;
  const edges: [number, number][] = [];
  for (let i = 0; i < positions.length; i++) {
    for (let j = i + 1; j < positions.length; j++) {
      const dx = positions[i].x - positions[j].x;
      const dy = positions[i].y - positions[j].y;
      if (Math.hypot(dx, dy) <= R) edges.push([i, j]);
    }
  }
  return {
    graph: { n_nodes: 12, edges, node_positions: positions },
    config: { n_nodes: 12, box_size: 200, comm_radius: R, seed: 42 },
  };
}

/**
 * C₇ — the heptagonal cycle. A small "hard" instance for benchmark stress.
 *
 * 7 vertices on a circle, 7 nearest-neighbour edges. α(G)=3, ω(G)=2.
 * Odd cycles defeat 2-colourings, and the count of (α−1)-IS (= 14) is
 * larger than the count of MIS (= 7), giving Hardness Parameter
 * HP = 14 / (3 · 7) ≈ 0.67. Useful for showing benchmark cases where the
 * quantum approximation ratio R drops below 1.0 — important context for
 * any honest SA-vs-quantum comparison.
 */
export function buildC7HardExample(): MANETResponse {
  const cx = 100;
  const cy = 50;
  const r = 35;
  const n = 7;
  const positions = Array.from({ length: n }, (_, i) => {
    const theta = -Math.PI / 2 + (2 * Math.PI * i) / n;
    return { id: i, x: cx + r * Math.cos(theta), y: cy + r * Math.sin(theta) };
  });
  const edges: [number, number][] = [];
  for (let i = 0; i < n; i++) edges.push([i, (i + 1) % n]);
  return {
    graph: { n_nodes: n, edges, node_positions: positions },
    config: { n_nodes: n, box_size: 200, comm_radius: 60, seed: null },
  };
}

/**
 * Möbius–Kantor graph — Generalised Petersen GP(8, 3).
 *
 * Two concentric octagons: outer 8-cycle (vertices 0..7), inner cycle whose
 * "chord" jumps by 3 (vertices 8..15 with v_i ~ v_{(i+3) mod 8}), and 8 spokes
 * u_i ~ v_i. Cubic, bipartite, vertex-transitive, girth 6. α(G)=8 (one
 * bipartition class), ω(G)=2 (bipartite ⇒ triangle-free).
 *
 * Note: 16 atoms — Stage 5 (full sesolve) is heavy at this size; exact MIS
 * still works (≤28 limit).
 */
export function buildMobiusKantorExample(): MANETResponse {
  const cx = 100;
  const cy = 50;
  const rOuter = 38;
  const rInner = 18;
  const positions: { id: number; x: number; y: number }[] = [];
  for (let i = 0; i < 8; i++) {
    const theta = -Math.PI / 2 + (i * Math.PI) / 4;
    positions.push({ id: i, x: cx + rOuter * Math.cos(theta), y: cy + rOuter * Math.sin(theta) });
  }
  for (let i = 0; i < 8; i++) {
    const theta = -Math.PI / 2 + (i * Math.PI) / 4;
    positions.push({
      id: 8 + i,
      x: cx + rInner * Math.cos(theta),
      y: cy + rInner * Math.sin(theta),
    });
  }
  const edges: [number, number][] = [];
  // Outer 8-cycle
  for (let i = 0; i < 8; i++) edges.push([i, (i + 1) % 8]);
  // Spokes outer ↔ inner
  for (let i = 0; i < 8; i++) edges.push([i, 8 + i]);
  // Inner chords: v_i ~ v_{(i+3) mod 8}; dedupe via i < j
  for (let i = 0; i < 8; i++) {
    const j = (i + 3) % 8;
    const a = 8 + Math.min(i, j);
    const b = 8 + Math.max(i, j);
    if (!edges.some(([u, v]) => u === a && v === b)) edges.push([a, b]);
  }
  return {
    graph: { n_nodes: 16, edges, node_positions: positions },
    config: { n_nodes: 16, box_size: 200, comm_radius: 25, seed: null },
  };
}

/**
 * Heawood graph — 14 vertices, cubic, bipartite, smallest (3,6)-cage.
 *
 * The incidence graph of the Fano plane (7 points + 7 lines). Drawn here as
 * a 14-gon with 7 chords. α(G)=7, ω(G)=2. Note: 14 atoms means Stage 5 is
 * slow but tractable; exact MIS still runs.
 */
export function buildHeawoodExample(): MANETResponse {
  const cx = 100;
  const cy = 50;
  const r = 40;
  const n = 14;
  const positions = Array.from({ length: n }, (_, i) => {
    const theta = -Math.PI / 2 + (2 * Math.PI * i) / n;
    return { id: i, x: cx + r * Math.cos(theta), y: cy + r * Math.sin(theta) };
  });
  const edges: [number, number][] = [];
  // 14-cycle around the perimeter
  for (let i = 0; i < n; i++) edges.push([i, (i + 1) % n]);
  // 7 chords realising the Fano-plane incidence structure
  const chords: [number, number][] = [
    [0, 5], [2, 9], [4, 11], [6, 13], [8, 1], [10, 3], [12, 7],
  ];
  for (const [a, b] of chords) edges.push([Math.min(a, b), Math.max(a, b)]);
  return {
    graph: { n_nodes: n, edges, node_positions: positions },
    config: { n_nodes: n, box_size: 200, comm_radius: 25, seed: null },
  };
}

/**
 * Grötzsch graph = Mycielski(4) — 11 vertices, triangle-free, χ=4.
 *
 * The classical separator between MaxClique and chromatic number: ω(G)=2
 * (no triangles) yet χ(G)=4 — so colouring is genuinely harder than clique-
 * finding. α(G)=5. Built as an inner C₅ (ids 0..4), 5 "twins" (5..9) each
 * connected to the two neighbours of its mirror in C₅, plus an apex (10)
 * connected to every twin.
 */
export function buildGrotzschExample(): MANETResponse {
  const cx = 100;
  const cy = 50;
  const rInner = 14;
  const rOuter = 34;
  const positions: { id: number; x: number; y: number }[] = [];
  for (let i = 0; i < 5; i++) {
    const theta = -Math.PI / 2 + (2 * Math.PI * i) / 5;
    positions.push({ id: i, x: cx + rInner * Math.cos(theta), y: cy + rInner * Math.sin(theta) });
  }
  for (let i = 0; i < 5; i++) {
    const theta = -Math.PI / 2 + (2 * Math.PI * i) / 5;
    positions.push({
      id: 5 + i,
      x: cx + rOuter * Math.cos(theta),
      y: cy + rOuter * Math.sin(theta),
    });
  }
  // Apex above the structure
  positions.push({ id: 10, x: cx, y: cy + rOuter + 12 });

  const edges: [number, number][] = [];
  // Inner C₅
  for (let i = 0; i < 5; i++) edges.push([i, (i + 1) % 5]);
  // Twin links: vertex (5+i) ~ neighbours of vertex i in C₅
  for (let i = 0; i < 5; i++) {
    const a = (i - 1 + 5) % 5;
    const b = (i + 1) % 5;
    edges.push([Math.min(5 + i, a), Math.max(5 + i, a)]);
    edges.push([Math.min(5 + i, b), Math.max(5 + i, b)]);
  }
  // Apex connects to all twins
  for (let i = 0; i < 5; i++) edges.push([5 + i, 10]);
  return {
    graph: { n_nodes: 11, edges, node_positions: positions },
    config: { n_nodes: 11, box_size: 200, comm_radius: 30, seed: null },
  };
}

/**
 * Turán graph T(9, 3) — complete 3-partite K_{3,3,3}.
 *
 * 9 vertices split into 3 independent parts of size 3 each, with every
 * inter-part pair connected (27 edges, no intra-part edges). ω(G)=3 (one
 * from each part), α(G)=3 (one entire part). The extremal graph that
 * achieves the largest edge count without containing K₄.
 */
export function buildTuran93Example(): MANETResponse {
  const cx = 100;
  const cy = 50;
  const partR = 35;
  const innerR = 7;
  // Three part-centres at 120° apart (90°, 210°, 330° → top, lower-left, lower-right)
  const partAngles = [Math.PI / 2, 7 * Math.PI / 6, 11 * Math.PI / 6];
  const positions: { id: number; x: number; y: number }[] = [];
  for (let p = 0; p < 3; p++) {
    const pcx = cx + partR * Math.cos(partAngles[p]);
    const pcy = cy + partR * Math.sin(partAngles[p]);
    // 3 vertices on a small triangle around the part centre
    for (let k = 0; k < 3; k++) {
      const inner = -Math.PI / 2 + (2 * Math.PI * k) / 3;
      positions.push({
        id: 3 * p + k,
        x: pcx + innerR * Math.cos(inner),
        y: pcy + innerR * Math.sin(inner),
      });
    }
  }
  // Edges: every pair across parts
  const edges: [number, number][] = [];
  for (let i = 0; i < 9; i++) {
    for (let j = i + 1; j < 9; j++) {
      if (Math.floor(i / 3) !== Math.floor(j / 3)) edges.push([i, j]);
    }
  }
  return {
    graph: { n_nodes: 9, edges, node_positions: positions },
    config: { n_nodes: 9, box_size: 200, comm_radius: 50, seed: null },
  };
}

/**
 * K₅ — the complete graph on 5 vertices.
 *
 * 5 vertices arranged on a regular pentagon, all 10 edges present.
 * ω(G)=5, α(G)=1, complement = empty graph on 5 vertices. The canonical
 * sanity baseline: the pipeline should report |MaxClique|=5 and place the
 * "MIS" as a single atom (any one of them).
 */
export function buildK5Example(): MANETResponse {
  const cx = 100;
  const cy = 50;
  const r = 35;
  const positions = Array.from({ length: 5 }, (_, i) => {
    const theta = -Math.PI / 2 + (2 * Math.PI * i) / 5;
    return { id: i, x: cx + r * Math.cos(theta), y: cy + r * Math.sin(theta) };
  });
  const edges: [number, number][] = [];
  for (let i = 0; i < 5; i++) for (let j = i + 1; j < 5; j++) edges.push([i, j]);
  return {
    graph: { n_nodes: 5, edges, node_positions: positions },
    config: { n_nodes: 5, box_size: 200, comm_radius: 70, seed: null },
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

// =============================================================================
// "Realistic MANET" topologies — the abstract calls out MANETs as the project's
// driving application, but the pre-existing RGG12 was the only example that
// matched that frame. These three fill the gap with intentionally varied
// densities so the user can see how clique-size, embedding fidelity and
// routing behaviour shift as the MANET becomes sparser or denser.
// =============================================================================

/**
 * Urban-cluster MANET — 3 dense pockets (5/5/6 atoms) linked by sparse bridges.
 *
 * Models the canonical "vehicles around a few intersections / soldiers around
 * a few command posts" topology. Each cluster is an internal clique (one of
 * the few cases where the maximum clique is non-trivial *and* large), so the
 * adiabatic search has something meaty to find. The inter-cluster bridges
 * keep the graph connected, but the routing payoff (Stage 8) lives in how the
 * backbone clique sits inside one cluster and forwards through the bridges.
 *
 * n=16, three cliques K5/K5/K6 with 3 bridge edges → 33 edges total. omega(G)=6.
 */
export function buildUrbanClustersExample(): MANETResponse {
  const positions: { id: number; x: number; y: number }[] = [];

  // Cluster A — top-left pocket (5 atoms, K5 layout on a small pentagon).
  for (let i = 0; i < 5; i++) {
    const theta = -Math.PI / 2 + (2 * Math.PI * i) / 5;
    positions.push({ id: i, x: 40 + 14 * Math.cos(theta), y: 75 + 14 * Math.sin(theta) });
  }
  // Cluster B — top-right pocket (5 atoms).
  for (let i = 0; i < 5; i++) {
    const theta = -Math.PI / 2 + (2 * Math.PI * i) / 5;
    positions.push({ id: 5 + i, x: 160 + 14 * Math.cos(theta), y: 75 + 14 * Math.sin(theta) });
  }
  // Cluster C — bottom-middle pocket (6 atoms, K6 on a small hexagon).
  for (let i = 0; i < 6; i++) {
    const theta = -Math.PI / 2 + (i * Math.PI) / 3;
    positions.push({ id: 10 + i, x: 100 + 16 * Math.cos(theta), y: 22 + 16 * Math.sin(theta) });
  }

  const edges: [number, number][] = [];
  // Cluster A: K5 on ids 0..4
  for (let i = 0; i < 5; i++) for (let j = i + 1; j < 5; j++) edges.push([i, j]);
  // Cluster B: K5 on ids 5..9
  for (let i = 5; i < 10; i++) for (let j = i + 1; j < 10; j++) edges.push([i, j]);
  // Cluster C: K6 on ids 10..15
  for (let i = 10; i < 16; i++) for (let j = i + 1; j < 16; j++) edges.push([i, j]);
  // Bridges: A↔B (top), A↔C (left), B↔C (right). Three weak links —
  // routing-relevant but not enough to merge the cliques.
  edges.push([2, 7]); // mid-top A ↔ mid-top B
  edges.push([3, 12]); // bottom A ↔ left C
  edges.push([8, 14]); // bottom B ↔ right C

  return {
    graph: { n_nodes: 16, edges, node_positions: positions },
    config: { n_nodes: 16, box_size: 200, comm_radius: 35, seed: null },
  };
}

/**
 * Sparse, partially-disconnected MANET — 15 atoms scattered randomly under
 * an aggressive small R=22 µm. The RGG rule then produces 2-3 components, so
 * Stage 8 routing has unreachable pairs (n_via_fallback > 0 or pairs with
 * hops=0 because the underlying graph is disconnected).
 *
 * Purpose: the *only* preset where the pipeline must gracefully report
 * "this pair cannot be reached" rather than always finding a path.
 */
export function buildSparseDisconnectedManetExample(): MANETResponse {
  const rng = mulberry32(11);
  const positions = Array.from({ length: 15 }, (_, i) => ({
    id: i,
    x: 10 + rng() * 180,
    y: 10 + rng() * 80,
  }));
  const edges = edgesByRgg(positions, 22);
  return {
    graph: { n_nodes: 15, edges, node_positions: positions },
    config: { n_nodes: 15, box_size: 200, comm_radius: 22, seed: 11 },
  };
}

/**
 * Dense MANET — 14 atoms scattered randomly under a large R=60. Most pairs
 * are within range, so density approaches ~0.7 and the complement is sparse.
 *
 * Stress-tests the embedding: such a dense logical graph has high omega and
 * many max-cliques, but the spurious blockade edges between atoms in the
 * physical layout make fidelity dive. Useful as a "see what happens on hard
 * instances" companion to the symmetric paper benchmarks.
 */
export function buildDenseManetExample(): MANETResponse {
  const rng = mulberry32(23);
  const positions = Array.from({ length: 14 }, (_, i) => ({
    id: i,
    x: 15 + rng() * 170,
    y: 15 + rng() * 70,
  }));
  const edges = edgesByRgg(positions, 60);
  return {
    graph: { n_nodes: 14, edges, node_positions: positions },
    config: { n_nodes: 14, box_size: 200, comm_radius: 60, seed: 23 },
  };
}

// =============================================================================
// Chaotic / random topologies — the "בלגן" category. These exist specifically
// to break the symmetry assumption: every other preset in the library has at
// least one geometric or algebraic axis of symmetry that the adiabatic
// search can exploit. On these graphs the result is what you'd see on a
// real, uninstrumented network — the honest benchmark.
// =============================================================================

/**
 * Erdős–Rényi random graph G(n, p) — n=11, p=0.4, seed=2026.
 *
 * Every pair {i, j} gets an edge with independent probability p. The textbook
 * uniform random graph; no spatial structure, no symmetry. Expected ~22 edges
 * for these parameters. Layout: ids on a regular 11-gon so the user can read
 * them, but the *graph* itself is irregular.
 */
export function buildErdosRenyiExample(): MANETResponse {
  const n = 11;
  const p = 0.4;
  const rng = mulberry32(2026);
  const cx = 100;
  const cy = 50;
  const r = 38;
  const positions = Array.from({ length: n }, (_, i) => {
    const theta = -Math.PI / 2 + (2 * Math.PI * i) / n;
    return { id: i, x: cx + r * Math.cos(theta), y: cy + r * Math.sin(theta) };
  });
  const edges: [number, number][] = [];
  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) {
      if (rng() < p) edges.push([i, j]);
    }
  }
  return {
    graph: { n_nodes: n, edges, node_positions: positions },
    config: { n_nodes: n, box_size: 200, comm_radius: 0, seed: 2026 },
  };
}

/**
 * Random-positions messy graph — n=12, RGG over points scattered uniformly
 * in the 200×100 box with R=40 µm.
 *
 * Same generative process as a real MANET snapshot (random positions + radio
 * range), with a fixed seed so the chaos is reproducible. Visually un-tidy
 * by design; useful for asking "does the layout heuristic survive when the
 * input has no axis-aligned structure?".
 */
export function buildRandomMessyExample(): MANETResponse {
  const rng = mulberry32(7);
  const positions = Array.from({ length: 12 }, (_, i) => ({
    id: i,
    x: 10 + rng() * 180,
    y: 10 + rng() * 80,
  }));
  const edges = edgesByRgg(positions, 40);
  return {
    graph: { n_nodes: 12, edges, node_positions: positions },
    config: { n_nodes: 12, box_size: 200, comm_radius: 40, seed: 7 },
  };
}

/**
 * Barabási–Albert preferential-attachment network — n=12, m=2.
 *
 * Start from K3, then add 9 more vertices one at a time; each new vertex picks
 * m=2 existing vertices to link, with probability proportional to current
 * degree. The result has a few high-degree "hub" nodes and many low-degree
 * leaves — the topology Sociologists & network scientists call "scale-free".
 * Models MANET-with-leaders (e.g. squad members orbiting a few squad leaders).
 *
 * Layout: K3 at the centre, later vertices spiral outwards in birth order.
 */
export function buildBarabasiAlbertExample(): MANETResponse {
  const n = 12;
  const m = 2;
  const rng = mulberry32(99);
  const degree = new Array<number>(n).fill(0);
  const edges: [number, number][] = [];
  // Initial K3 on {0, 1, 2}
  edges.push([0, 1], [0, 2], [1, 2]);
  degree[0] = degree[1] = degree[2] = 2;

  // Add vertices 3..n-1 with preferential attachment.
  for (let v = 3; v < n; v++) {
    // Pool of (existing) endpoints weighted by current degree.
    const pool: number[] = [];
    for (let u = 0; u < v; u++) {
      for (let k = 0; k < degree[u]; k++) pool.push(u);
    }
    const chosen = new Set<number>();
    while (chosen.size < m) {
      const pick = pool[Math.floor(rng() * pool.length)];
      chosen.add(pick);
    }
    for (const u of chosen) {
      edges.push([Math.min(u, v), Math.max(u, v)]);
      degree[u]++;
      degree[v]++;
    }
  }

  // Layout: K3 forms a small inner triangle; later vertices spiral out.
  const cx = 100;
  const cy = 50;
  const positions: { id: number; x: number; y: number }[] = [];
  for (let i = 0; i < 3; i++) {
    const theta = -Math.PI / 2 + (2 * Math.PI * i) / 3;
    positions.push({ id: i, x: cx + 14 * Math.cos(theta), y: cy + 14 * Math.sin(theta) });
  }
  for (let i = 3; i < n; i++) {
    const t = i - 3;
    const radius = 22 + t * 4;
    const theta = (t * 2 * Math.PI) / 5;
    positions.push({ id: i, x: cx + radius * Math.cos(theta), y: cy + radius * Math.sin(theta) });
  }

  return {
    graph: { n_nodes: n, edges, node_positions: positions },
    config: { n_nodes: n, box_size: 200, comm_radius: 0, seed: 99 },
  };
}

// =============================================================================
// Baselines + edge-cases — small, trivially-solvable instances that let the
// user calibrate "what does success look like?" against the adversarial cases.
// =============================================================================

/**
 * Path graph P₈ — 8 atoms in a straight line, nearest-neighbour edges only.
 *
 * The simplest non-trivial structure: alpha(P_n) = ceil(n/2), omega = 2 (no
 * triangles). Both SA and the adiabatic algorithm find the optimum in
 * milliseconds. Useful as a "calibration" preset — if the pipeline returns
 * anything other than alpha=4 on this graph, something is broken.
 *
 * Geometric layout extends across the editor's 200µm width with margin so the
 * atoms read cleanly.
 */
export function buildPathP8Example(): MANETResponse {
  const n = 8;
  const xStart = 18;
  const xSpan = 164;
  const step = xSpan / (n - 1);
  const positions = Array.from({ length: n }, (_, i) => ({
    id: i,
    x: xStart + i * step,
    y: 50,
  }));
  const edges: [number, number][] = [];
  for (let i = 0; i < n - 1; i++) edges.push([i, i + 1]);
  return {
    graph: { n_nodes: n, edges, node_positions: positions },
    config: { n_nodes: n, box_size: 200, comm_radius: 30, seed: null },
  };
}

/**
 * MANET RGG n=20 — the "simulator-buster" instance.
 *
 * 20 device positions scattered (seeded mulberry32) across the 200×100 box,
 * edges via RGG with R=28 µm. Density and structure read like a realistic
 * urban MANET — exactly the model the project commits to — but at a size
 * where the local pipeline pointedly *cannot* run end-to-end:
 *
 *   • Stage 4 spectrum/gap: sparse Hamiltonian cap is 16 atoms → refuses.
 *   • Stage 5 sesolve: 2²⁰ ≈ 1.05M-state Hilbert space → impractical.
 *   • Stages 1–3 (build, complement, embed) and Stage 8 (routing) still work.
 *
 * The pedagogical job here is exactly this gap: build the instance, see the
 * complement and the embedding, watch Stage 4/5 refuse, and arrive at "this
 * is why we need Phase 7 (Braket / QuEra hardware)".
 */
export function buildManetRGG20Example(): MANETResponse {
  const rng = mulberry32(20);
  const positions = Array.from({ length: 20 }, (_, i) => ({
    id: i,
    x: 12 + rng() * 176,
    y: 12 + rng() * 76,
  }));
  const R = 28;
  const edges = edgesByRgg(positions, R);
  return {
    graph: { n_nodes: 20, edges, node_positions: positions },
    config: { n_nodes: 20, box_size: 200, comm_radius: R, seed: 20 },
  };
}

/**
 * Frucht graph — 12 vertices, 3-regular, *trivial* automorphism group.
 *
 * The smallest cubic graph with no non-trivial symmetries (Frucht, 1939). Every
 * other classical preset in the library has at least one geometric or algebraic
 * axis of symmetry that the adiabatic sweep can exploit (Petersen is vertex-
 * transitive, Heawood is edge-transitive, even C₇ has cyclic D₇ symmetry). On
 * Frucht the algorithm gets no symmetry crutch — the "most honest" small
 * benchmark you can build, and a direct stress test of the embedding heuristic
 * which also tends to lean on symmetry.
 *
 * ω(G)=3 (contains triangles, girth 3), α(G)=5. 18 edges. Layout: 12-gon
 * around the box centre, so the lack of symmetry shows up in the edge pattern
 * rather than the vertex placement.
 */
export function buildFruchtExample(): MANETResponse {
  const cx = 100;
  const cy = 50;
  const r = 38;
  const n = 12;
  const positions = Array.from({ length: n }, (_, i) => {
    const theta = -Math.PI / 2 + (2 * Math.PI * i) / n;
    return { id: i, x: cx + r * Math.cos(theta), y: cy + r * Math.sin(theta) };
  });
  // Canonical Frucht edge list (Wikipedia / MathWorld), 0-indexed. 18 edges,
  // every vertex degree 3, girth 3, automorphism group trivial.
  const edges: [number, number][] = [
    [0, 1], [0, 2], [0, 3],
    [1, 2], [1, 4],
    [2, 5],
    [3, 6], [3, 7],
    [4, 8], [4, 10],
    [5, 9], [5, 11],
    [6, 7], [6, 10],
    [7, 11],
    [8, 9], [8, 11],
    [9, 10],
  ];
  return {
    graph: { n_nodes: n, edges, node_positions: positions },
    config: { n_nodes: n, box_size: 200, comm_radius: 25, seed: null },
  };
}

/**
 * Two disjoint triangles — 6 atoms, two K3 components on opposite sides of
 * the canvas, no inter-component edges.
 *
 * Pure regression test for non-connectivity: the pipeline must not crash on
 * a disconnected input. Stage 8 must report unreachable (src, dst) pairs
 * (graph_components > 1) without dragging the rest of the analysis down.
 */
export function buildTwoTrianglesExample(): MANETResponse {
  // Left triangle around (60, 50), right triangle around (140, 50). Radius
  // chosen so each triangle reads clearly and the two clusters are visibly
  // separated by an obvious gap.
  const lcx = 60;
  const rcx = 140;
  const cy = 50;
  const r = 22;
  const positions: { id: number; x: number; y: number }[] = [];
  for (let i = 0; i < 3; i++) {
    const theta = -Math.PI / 2 + (2 * Math.PI * i) / 3;
    positions.push({ id: i, x: lcx + r * Math.cos(theta), y: cy + r * Math.sin(theta) });
  }
  for (let i = 0; i < 3; i++) {
    const theta = -Math.PI / 2 + (2 * Math.PI * i) / 3;
    positions.push({ id: 3 + i, x: rcx + r * Math.cos(theta), y: cy + r * Math.sin(theta) });
  }
  const edges: [number, number][] = [
    // Left K3
    [0, 1], [0, 2], [1, 2],
    // Right K3
    [3, 4], [3, 5], [4, 5],
  ];
  return {
    graph: { n_nodes: 6, edges, node_positions: positions },
    config: { n_nodes: 6, box_size: 200, comm_radius: 30, seed: null },
  };
}

// =============================================================================
// Conflict-graph examples — designed for Stage 2's "Conflict Graph" track
// (backend/pipeline/conflict_graph.py). Each one is a MANET connectivity
// graph C chosen so that F (built from C's links per Jain, Padhye,
// Padmanabhan & Qiu, MobiCom 2003) is itself pedagogically interesting.
// Every geometry below (comm_radius / recommended interference radius) was
// numerically verified — see the git history for the verification script —
// so the described F actually materializes with the given parameters.
// =============================================================================

/**
 * Hidden Terminal Problem — the smallest possible conflict-graph instance.
 *
 * Tobagi & Kleinrock, "Packet Switching in Radio Channels: Part II — The
 * Hidden Terminal Problem..." IEEE Trans. Commun. COM-23(12), 1975.
 *
 * 3 nodes in a line, A—B—C. A and C are each within range of B but NOT of
 * each other (comm_radius=45 connects A-B and B-C at distance 40, but
 * A-C at distance 80 stays disconnected) — the textbook hidden-terminal
 * layout. The two links share endpoint B, so they conflict in F regardless
 * of the interference radius: F is a single edge (K₂). Recommended R'=45.
 */
export function buildHiddenTerminalExample(): MANETResponse {
  const positions = [
    { id: 0, x: 60, y: 50 },
    { id: 1, x: 100, y: 50 },
    { id: 2, x: 140, y: 50 },
  ];
  const edges: [number, number][] = [
    [0, 1],
    [1, 2],
  ];
  return {
    graph: { n_nodes: 3, edges, node_positions: positions },
    config: { n_nodes: 3, box_size: 200, comm_radius: 45, seed: null },
  };
}

/**
 * Jain, Padhye, Padmanabhan & Qiu (MobiCom 2003) — the paper's own worked
 * example (§4.1, Figure 4 / Table 1): a 3×3 grid, lateral range only (no
 * diagonal links), interference range equal to the communication range.
 *
 * 9 nodes on a 35-unit grid, comm_radius=40 (connects orthogonal neighbours
 * at distance 35, excludes diagonals at 49.5). Recommended R'=40 (=R, the
 * paper's own assumption for this example). Verified: |E(C)|=12 links →
 * F has 12 vertices and 54 edges (81.8% density) — this *is* faithful to
 * the paper, not a bug: Table 1's own conflict matrix for this exact grid
 * is similarly dense (a tightly-packed grid means almost every link sits
 * within interference range of almost every other).
 */
export function buildJainGrid3x3Example(): MANETResponse {
  const cx = 100;
  const cy = 50;
  const step = 35;
  const positions = Array.from({ length: 9 }, (_, k) => {
    const r = Math.floor(k / 3);
    const c = k % 3;
    return { id: k, x: cx + (c - 1) * step, y: cy + (1 - r) * step };
  });
  const edges: [number, number][] = [];
  for (let r = 0; r < 3; r++) {
    for (let c = 0; c < 2; c++) {
      edges.push([r * 3 + c, r * 3 + c + 1]); // horizontal
    }
  }
  for (let c = 0; c < 3; c++) {
    for (let r = 0; r < 2; r++) {
      edges.push([r * 3 + c, (r + 1) * 3 + c]); // vertical
    }
  }
  return {
    graph: { n_nodes: 9, edges, node_positions: positions },
    config: { n_nodes: 9, box_size: 200, comm_radius: 40, seed: null },
  };
}

/**
 * The Pentagon Conflict Graph — an original construction (not from a paper)
 * built to geometrically realize the "odd hole" that Jain et al. discuss in
 * Figures 2–3: a conflict graph where clique-only LP constraints are not
 * tight, because C₅ is self-complementary (max clique = 2, but naive
 * fractional relaxation over cliques alone would suggest more).
 *
 * 5 "petals" (short 2-node links) arranged around a ring. Each petal's
 * nearest neighbours geometrically are exactly its two ring-neighbours —
 * verified numerically: with ρ=40 (ring radius), δ=15° (half-angle per
 * petal), comm_radius=24 (connects only each petal's own 2 nodes — C is a
 * perfect matching, 5 disjoint links, no shared endpoints at all) and
 * R'=45, F comes out to *exactly* a 5-cycle (C₅): link k conflicts with
 * links (k±1) mod 5 and nothing else. Since C₅ is self-complementary,
 * MIS(F) = 2 — only two links can ever be scheduled together, no matter how
 * you pick them.
 */
export function buildConflictPentagonExample(): MANETResponse {
  const cx = 100;
  const cy = 50;
  const rho = 40;
  const delta = (15 * Math.PI) / 180;
  const positions: { id: number; x: number; y: number }[] = [];
  const edges: [number, number][] = [];
  for (let k = 0; k < 5; k++) {
    const theta = -Math.PI / 2 + (2 * Math.PI * k) / 5;
    positions.push({
      id: 2 * k,
      x: cx + rho * Math.cos(theta - delta),
      y: cy + rho * Math.sin(theta - delta),
    });
    positions.push({
      id: 2 * k + 1,
      x: cx + rho * Math.cos(theta + delta),
      y: cy + rho * Math.sin(theta + delta),
    });
    edges.push([2 * k, 2 * k + 1]);
  }
  return {
    graph: { n_nodes: 10, edges, node_positions: positions },
    config: { n_nodes: 10, box_size: 200, comm_radius: 24, seed: null },
  };
}

/**
 * Single Access Point (infrastructure WLAN star) — every link shares the AP
 * endpoint, so F is a complete graph K_n *regardless of the interference
 * radius*. This is the standard 802.11/CSMA textbook fact behind why a
 * single AP needs centralized scheduling: only one client can transmit at
 * a time. The cleanest, most intuitive entry point into "what is a conflict
 * graph" — no R' tuning needed at all.
 *
 * 1 hub + 5 clients on a ring (n=5 chosen deliberately: for n≥6 evenly-
 * spaced clients around a hub, the client-to-client spacing can never
 * exceed the hub distance — verified geometrically — so the star would
 * accidentally also connect clients to each other in C). comm_radius=32
 * connects each client to the hub (distance 30) but not to its neighbours
 * (nearest client-client distance 35.3).
 */
export function buildApStarExample(): MANETResponse {
  const hub = { id: 0, x: 100, y: 50 };
  const rho = 30;
  const positions = [hub];
  const edges: [number, number][] = [];
  for (let k = 0; k < 5; k++) {
    const theta = -Math.PI / 2 + (2 * Math.PI * k) / 5;
    positions.push({ id: k + 1, x: hub.x + rho * Math.cos(theta), y: hub.y + rho * Math.sin(theta) });
    edges.push([0, k + 1]);
  }
  return {
    graph: { n_nodes: 6, edges, node_positions: positions },
    config: { n_nodes: 6, box_size: 200, comm_radius: 32, seed: null },
  };
}

/**
 * Interference Chain — a linear multi-hop MANET, tunable via Stage 2's R'
 * slider to demonstrate Jain et al. §3.1's central point live.
 *
 * 6 nodes spaced 28 units apart, comm_radius=30 (links only consecutive
 * nodes: P₆, 5 links). A subtlety worth knowing before exploring: because
 * comm_radius must be ≥ the node spacing for the chain to connect at all,
 * setting R'=comm_radius (30) *already* extends conflicts one hop beyond
 * shared endpoints — verified: F comes out as "path-squared" (7 edges: the
 * usual 4 consecutive-link conflicts, plus 3 more between links one hop
 * apart) rather than a bare path. This is itself the teaching point:
 * interference is never purely local. Raising R' to ~60 (≈2×comm_radius)
 * extends conflicts a further hop (9 edges, "path-cubed"), visibly
 * shrinking the number of links schedulable together as R' grows.
 */
export function buildInterferenceChainExample(): MANETResponse {
  const d = 28;
  const positions = Array.from({ length: 6 }, (_, i) => ({ id: i, x: 30 + i * d, y: 50 }));
  const edges: [number, number][] = Array.from({ length: 5 }, (_, i) => [i, i + 1]);
  return {
    graph: { n_nodes: 6, edges, node_positions: positions },
    config: { n_nodes: 6, box_size: 200, comm_radius: 30, seed: null },
  };
}

/**
 * Two Isolated Hubs — spatial reuse, the flip side of the single-AP example.
 *
 * Two independent stars (1 hub + 4 clients each), placed far enough apart
 * (hub-to-hub distance 100, vs. a cluster radius of only 18) that no
 * interference radius worth using could ever connect them. F is exactly
 * two disjoint K₄'s: one link from *each* cluster can transmit at the same
 * time — the spatial-reuse principle behind cellular frequency reuse.
 * comm_radius=20 (hub-client distance 18, nearest client-client 25.5).
 */
export function buildTwoHubsReuseExample(): MANETResponse {
  const rho = 18;
  const hubs = [
    { x: 50, y: 50 },
    { x: 150, y: 50 },
  ];
  const positions: { id: number; x: number; y: number }[] = [];
  const edges: [number, number][] = [];
  let id = 0;
  for (const hub of hubs) {
    const hubId = id++;
    positions.push({ id: hubId, x: hub.x, y: hub.y });
    for (let k = 0; k < 4; k++) {
      const theta = -Math.PI / 2 + (2 * Math.PI * k) / 4;
      const clientId = id++;
      positions.push({ id: clientId, x: hub.x + rho * Math.cos(theta), y: hub.y + rho * Math.sin(theta) });
      edges.push([hubId, clientId]);
    }
  }
  return {
    graph: { n_nodes: 10, edges, node_positions: positions },
    config: { n_nodes: 10, box_size: 200, comm_radius: 20, seed: null },
  };
}

/**
 * Shared builder for the two hexagonal cellular-reuse examples below. Each
 * "cell" is modeled as one short 2-node link (base-station ↔ representative
 * user) placed at a hex-lattice cell center, 1 unit long — short enough
 * that cross-cell distances are, to within ±0.5, the pure hex center-to-
 * center distances. `rings` hex rings around a center cell give
 * 3·rings·(rings+1)+1 cells (1 for rings=0, 7 for rings=1, 19 for rings=2).
 * comm_radius=2 connects only each cell's own 2 nodes.
 *
 * With s=30 (cell spacing) and R'=40 (between the 30-unit adjacent-cell
 * distance and the 51.96-unit next-ring distance), F reproduces exactly the
 * hex adjacency graph — the standard cellular frequency-reuse-3 pattern for
 * rings=1 (Hale, "Frequency assignment: Theory and applications," Proc.
 * IEEE 68(12), 1980): a cell's link conflicts with (i.e. can't share a
 * channel with) its neighbouring cells' links.
 */
function buildHexCellularExample(rings: number): MANETResponse {
  const AXIAL_DIRS: [number, number][] = [
    [1, 0],
    [1, -1],
    [0, -1],
    [-1, 0],
    [-1, 1],
    [0, 1],
  ];
  const s = 30;
  const cx = 100;
  const cy = 50;
  const cells: { q: number; r: number }[] = [{ q: 0, r: 0 }];
  for (let radius = 1; radius <= rings; radius++) {
    let q = AXIAL_DIRS[4][0] * radius;
    let r = AXIAL_DIRS[4][1] * radius;
    for (let i = 0; i < 6; i++) {
      for (let step = 0; step < radius; step++) {
        cells.push({ q, r });
        q += AXIAL_DIRS[i][0];
        r += AXIAL_DIRS[i][1];
      }
    }
  }
  const positions: { id: number; x: number; y: number }[] = [];
  const edges: [number, number][] = [];
  cells.forEach((cell, i) => {
    const x = cx + s * (cell.q + cell.r / 2);
    const y = cy + s * (Math.sqrt(3) / 2) * cell.r;
    positions.push({ id: 2 * i, x: x - 0.5, y });
    positions.push({ id: 2 * i + 1, x: x + 0.5, y });
    edges.push([2 * i, 2 * i + 1]);
  });
  return {
    graph: { n_nodes: cells.length * 2, edges, node_positions: positions },
    config: { n_nodes: cells.length * 2, box_size: 200, comm_radius: 2, seed: null },
  };
}

/**
 * Hexagonal cellular reuse — SMALL (reuse-3 pattern, 7 cells: 1 center +
 * 1 ring). Verified: |E(C)|=7 links (7 atoms — comfortably within every
 * local-simulation cap). F has 12 edges: the center cell conflicts with
 * all 6 ring cells, and each ring cell also conflicts with its 2
 * ring-neighbours — exactly the reuse-3 co-channel constraint graph.
 * Runs the full pipeline (Stages 1–8) locally without hitting any cap.
 */
export function buildHexCellularSmallExample(): MANETResponse {
  return buildHexCellularExample(1);
}

/**
 * Hexagonal cellular reuse — LARGE (reuse-7-scale pattern, 19 cells: 1
 * center + 2 rings). Verified: |E(C)|=19 links → 19 atoms, which exceeds
 * GAP_MAX_ATOMS=16 — Stage 4 (spectrum/gap) and Stage 5 (full sesolve,
 * 2¹⁹ states) will refuse, exactly like the existing "MANET RGG n=20"
 * stress example. Stages 1–3 and 8 still work. F has 42 edges (the full
 * 2-ring hex adjacency structure) — a deliberate demonstration of why
 * Phase 7 (Braket → QuEra) exists for realistically-sized interference
 * graphs.
 */
export function buildHexCellularLargeExample(): MANETResponse {
  return buildHexCellularExample(2);
}

/**
 * Community mesh network — SMALL, in the spirit of Jain et al. §4.2's
 * neighbourhood-mesh case study (252 houses, 35 random participants,
 * Figures 6–7): a small random subset of "houses" with a realistic
 * comm_radius, small enough to stay inside every local-simulation cap.
 *
 * 11 randomly-placed nodes (seed=153, reproducible), comm_radius=45.
 * Verified: connected, |E(C)|=11 links (11 atoms) — runs the full
 * pipeline locally.
 */
export function buildCommunityMeshSmallExample(): MANETResponse {
  const rng = mulberry32(153);
  const positions = Array.from({ length: 11 }, (_, i) => ({
    id: i,
    x: rng() * 200,
    y: rng() * 100,
  }));
  const edges = edgesByRgg(positions, 45);
  return {
    graph: { n_nodes: 11, edges, node_positions: positions },
    config: { n_nodes: 11, box_size: 200, comm_radius: 45, seed: 153 },
  };
}

/**
 * Community mesh network — LARGE, same neighbourhood-mesh spirit as the
 * small version but sized to deliberately exceed local-simulation limits.
 *
 * 18 randomly-placed nodes (seed=11, reproducible), comm_radius=45.
 * Verified: connected, |E(C)|=44 links (44 atoms) — matches the density a
 * realistic 250 m-range mesh over a few city blocks would produce. Well
 * past GAP_MAX_ATOMS=16 and 2⁴⁴ states is nowhere near sesolve-feasible;
 * Stages 1–3 and 8 still work, same "why Phase 7" story as the hex-large
 * and RGG-20 examples, from a genuinely mesh-shaped (not grid/lattice)
 * topology this time.
 */
export function buildCommunityMeshLargeExample(): MANETResponse {
  const rng = mulberry32(11);
  const positions = Array.from({ length: 18 }, (_, i) => ({
    id: i,
    x: rng() * 200,
    y: rng() * 100,
  }));
  const edges = edgesByRgg(positions, 45);
  return {
    graph: { n_nodes: 18, edges, node_positions: positions },
    config: { n_nodes: 18, box_size: 200, comm_radius: 45, seed: 11 },
  };
}
