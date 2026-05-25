import type { GraphDTO } from "../api/rest";

export const MIN_NODES = 2;
export const SOFT_MAX_NODES = 30;
export const COLLISION_DISTANCE = 0.5;
export const PROXIMITY_WARN_DISTANCE = 2;

export type ValidationResult =
  | { ok: true; warnings: string[] }
  | { ok: false; errors: string[]; warnings: string[] };

function dist(ax: number, ay: number, bx: number, by: number): number {
  const dx = ax - bx;
  const dy = ay - by;
  return Math.sqrt(dx * dx + dy * dy);
}

export function validateGraph(graph: GraphDTO): ValidationResult {
  const errors: string[] = [];
  const warnings: string[] = [];
  const positions = graph.node_positions ?? [];

  if (graph.n_nodes < MIN_NODES) {
    errors.push(`צריך לפחות ${MIN_NODES} קודקודים — בגרף יש ${graph.n_nodes}.`);
  }

  for (let i = 0; i < positions.length; i++) {
    for (let j = i + 1; j < positions.length; j++) {
      const a = positions[i];
      const b = positions[j];
      const d = dist(a.x, a.y, b.x, b.y);
      if (d < COLLISION_DISTANCE) {
        errors.push(`קודקודים ${a.id} ו‑${b.id} נמצאים על אותה נקודה.`);
      } else if (d < PROXIMITY_WARN_DISTANCE) {
        warnings.push(
          `קודקודים ${a.id} ו‑${b.id} קרובים מאוד (${d.toFixed(2)} µm) — עלול לפגוע בשיכון.`,
        );
      }
    }
  }

  if (graph.n_nodes > SOFT_MAX_NODES) {
    warnings.push(
      `מעל ${SOFT_MAX_NODES} קודקודים (${graph.n_nodes}) — Aquila עלולה לא להצליח לשכן, או שהריצה תיתקע.`,
    );
  }

  if (errors.length > 0) {
    return { ok: false, errors, warnings };
  }
  return { ok: true, warnings };
}

export function normalizeEdges(edges: [number, number][]): [number, number][] {
  const seen = new Set<string>();
  const out: [number, number][] = [];
  for (const [a, b] of edges) {
    if (a === b) continue;
    const lo = Math.min(a, b);
    const hi = Math.max(a, b);
    const key = `${lo}-${hi}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push([lo, hi]);
  }
  return out;
}

export function wouldCollideWithExisting(
  positions: { id: number; x: number; y: number }[],
  x: number,
  y: number,
  ignoreId?: number,
): boolean {
  return positions.some(
    (p) => p.id !== ignoreId && dist(p.x, p.y, x, y) < COLLISION_DISTANCE,
  );
}
