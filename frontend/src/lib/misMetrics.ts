/**
 * Solution-quality metrics for the final bitstring distribution coming out of
 * Stage 5. Computed on the frontend from `finalBitstringProbs`, the induced
 * (blockade) edges of the embedding, and the known target MIS size.
 *
 * Bitstring convention matches the backend: leftmost character = atom 0.
 * '1' = |r⟩ (in the chosen set), '0' = |g⟩ (not in the set).
 */

export type Edge = readonly [number, number];

export function bitstringSize(bs: string): number {
  let s = 0;
  for (let i = 0; i < bs.length; i++) if (bs[i] === "1") s++;
  return s;
}

export function bitstringIsIndependent(bs: string, edges: readonly Edge[]): boolean {
  for (const [u, v] of edges) {
    if (bs[u] === "1" && bs[v] === "1") return false;
  }
  return true;
}

export interface MisMetrics {
  /** E[|S| · 1{S is independent}] / |MIS*|. Range [0, 1]. */
  approximationRatio: number;
  /** Σ probs over bitstrings that are independent AND have size = |MIS*|. */
  misProbability: number;
  /** Σ probs over bitstrings that have at least one blockade-violating pair. */
  violationProbability: number;
  /** Σ probs over independent sets (size irrelevant). */
  feasibleProbability: number;
  /** Top-K bitstrings sorted by probability, with quality flags. */
  topBitstrings: {
    bitstring: string;
    prob: number;
    size: number;
    independent: boolean;
    isMis: boolean;
  }[];
}

export function computeMisMetrics(
  probs: Record<string, number>,
  edges: readonly Edge[],
  targetMisSize: number | null | undefined,
  topK = 5,
): MisMetrics {
  let approxNum = 0;
  let misProb = 0;
  let violProb = 0;
  let feasibleProb = 0;
  const target = targetMisSize ?? 0;

  const enriched: MisMetrics["topBitstrings"] = [];
  for (const [bs, p] of Object.entries(probs)) {
    const indep = bitstringIsIndependent(bs, edges);
    const size = bitstringSize(bs);
    if (indep) {
      feasibleProb += p;
      if (target > 0) approxNum += (p * size) / target;
      if (target > 0 && size === target) misProb += p;
    } else {
      violProb += p;
    }
    enriched.push({
      bitstring: bs,
      prob: p,
      size,
      independent: indep,
      isMis: indep && target > 0 && size === target,
    });
  }

  enriched.sort((a, b) => b.prob - a.prob);

  return {
    approximationRatio: target > 0 ? approxNum : 0,
    misProbability: misProb,
    violationProbability: violProb,
    feasibleProbability: feasibleProb,
    topBitstrings: enriched.slice(0, topK),
  };
}
