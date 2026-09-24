/**
 * Pure, store-free helpers for the "Compare Examples" tool
 * (CompareExamplesButton.tsx). No React, no usePipeline — these just wrap
 * the same plain API calls Stage 2 / ExamplesButton already use
 * (api.complement, api.conflictGraph), so a comparison run can never touch
 * or invalidate the main pipeline's state.
 */

import { api } from "../api/rest";
import type { GraphDTO } from "../api/rest";

export interface TrackStats {
  size: number;
  alpha: number;
  chromaticLo: number;
  chromaticHi: number;
}

export type TrackResult = { ok: true; stats: TrackStats } | { ok: false; error: string };

export interface StructuralStats {
  density: number;
  avgDeg: number;
}

/** Same formula as Stage2_Complement.tsx's computeGraphStats — ported, not
 * imported, so this tool has no dependency on Stage 2 internals. */
export function computeStructuralStats(n: number, edges: readonly (readonly [number, number])[]): StructuralStats {
  const m = edges.length;
  const maxEdges = n > 1 ? (n * (n - 1)) / 2 : 0;
  const density = maxEdges > 0 ? m / maxEdges : 0;
  const avgDeg = n > 0 ? (2 * m) / n : 0;
  return { density, avgDeg };
}

/** MaxClique(G) = MIS(Ḡ) on the direct track — a single api.complement call. */
export async function computeDirectStats(graph: GraphDTO): Promise<TrackResult> {
  try {
    const mis = await api.complement(graph);
    return {
      ok: true,
      stats: {
        size: mis.size,
        alpha: mis.alpha_g,
        chromaticLo: mis.chromatic_lower,
        chromaticHi: mis.chromatic_upper,
      },
    };
  } catch (e) {
    return { ok: false, error: (e as Error).message };
  }
}

/** Conflict track: build F over graph's links at the given R', then feed F̄
 * into the same complement/MIS machinery — mirrors ExamplesButton's
 * loadExample (which additionally writes into the pipeline store; this
 * doesn't). */
export async function computeConflictStats(
  graph: GraphDTO,
  interferenceRadius: number,
): Promise<TrackResult> {
  try {
    const cg = await api.conflictGraph(graph, interferenceRadius);
    const mis = await api.complement(cg.conflict_graph_complement);
    return {
      ok: true,
      stats: {
        size: mis.size,
        alpha: mis.alpha_g,
        chromaticLo: mis.chromatic_lower,
        chromaticHi: mis.chromatic_upper,
      },
    };
  } catch (e) {
    return { ok: false, error: (e as Error).message };
  }
}
