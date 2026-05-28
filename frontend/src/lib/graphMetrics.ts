/**
 * Small graph-level utilities shared across stages.
 *
 * Degree is the central quantity behind Karni 2026's LD-AQC algorithm:
 * each atom's local detuning slope is $f_i(a)$ as a monotonic function of
 * its vertex degree $d_i$. We expose it once here so Stage 1/2 overlays,
 * Stage 4 LD-AQC schedule preview, and the Stage 4 request payload all
 * stay in sync.
 */

export function computeDegrees(
  nNodes: number,
  edges: readonly (readonly [number, number])[],
): number[] {
  const deg = new Array<number>(nNodes).fill(0);
  for (const [a, b] of edges) {
    if (a >= 0 && a < nNodes) deg[a]++;
    if (b >= 0 && b < nNodes) deg[b]++;
  }
  return deg;
}
