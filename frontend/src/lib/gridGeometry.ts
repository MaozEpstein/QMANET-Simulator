export type GridType = "square" | "polar" | "triangular" | "hex";

export interface GridLine {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  bold?: boolean;
}

export interface GridPoint {
  x: number;
  y: number;
}

export interface GridGeometry {
  points: GridPoint[];
  lines: GridLine[];
}

export const GRID_TYPES: { id: GridType; label: string; description: string }[] = [
  { id: "square", label: "ריבועית", description: "קווים אופקיים ואנכיים — קודקודים יוצמדו לפינות תאים." },
  { id: "polar", label: "עגולה", description: "טבעות קונצנטריות + שורות רדיאליות. שימושי לטופולוגיות סלולריות." },
  { id: "triangular", label: "משולשית", description: "סריג משולשי — כל קודקוד עם 6 שכנים פוטנציאליים." },
  { id: "hex", label: "משושית (חלת דבש)", description: "תבנית חלת-דבש — קודקודים על קודקודי משושים." },
];

function squareGeometry(step: number, boxSize: number): GridGeometry {
  const points: GridPoint[] = [];
  const lines: GridLine[] = [];
  for (let v = 0; v <= boxSize + 1e-9; v += step) {
    const bold = Math.abs(((v / step) % Math.round(50 / step)) * step) < 1e-6 && v > 0;
    lines.push({ x1: v, y1: 0, x2: v, y2: boxSize, bold });
    lines.push({ x1: 0, y1: v, x2: boxSize, y2: v, bold });
  }
  for (let x = 0; x <= boxSize + 1e-9; x += step) {
    for (let y = 0; y <= boxSize + 1e-9; y += step) {
      points.push({ x, y });
    }
  }
  return { points, lines };
}

function polarGeometry(step: number, boxSize: number): GridGeometry {
  const cx = boxSize / 2;
  const cy = boxSize / 2;
  const maxR = Math.sqrt(2) * cx;
  const spokes = 12;
  const points: GridPoint[] = [{ x: cx, y: cy }];
  const lines: GridLine[] = [];
  for (let r = step; r <= maxR + 1e-9; r += step) {
    const segments = 64;
    for (let i = 0; i < segments; i++) {
      const t0 = (2 * Math.PI * i) / segments;
      const t1 = (2 * Math.PI * (i + 1)) / segments;
      lines.push({
        x1: cx + r * Math.cos(t0),
        y1: cy + r * Math.sin(t0),
        x2: cx + r * Math.cos(t1),
        y2: cy + r * Math.sin(t1),
        bold: Math.abs(r - Math.round(r / 25) * 25) < 1e-6,
      });
    }
    for (let s = 0; s < spokes; s++) {
      const theta = (2 * Math.PI * s) / spokes;
      const x = cx + r * Math.cos(theta);
      const y = cy + r * Math.sin(theta);
      if (x >= -1e-6 && x <= boxSize + 1e-6 && y >= -1e-6 && y <= boxSize + 1e-6) {
        points.push({ x, y });
      }
    }
  }
  for (let s = 0; s < spokes; s++) {
    const theta = (2 * Math.PI * s) / spokes;
    lines.push({
      x1: cx,
      y1: cy,
      x2: cx + maxR * Math.cos(theta),
      y2: cy + maxR * Math.sin(theta),
      bold: s % 3 === 0,
    });
  }
  return { points, lines };
}

function triangularGeometry(step: number, boxSize: number): GridGeometry {
  const rowH = (step * Math.sqrt(3)) / 2;
  const points: GridPoint[] = [];
  let rowIdx = 0;
  for (let y = 0; y <= boxSize + 1e-9; y += rowH, rowIdx++) {
    const offset = (rowIdx % 2) * (step / 2);
    for (let x = -offset; x <= boxSize + 1e-9; x += step) {
      if (x >= -1e-6) points.push({ x, y });
    }
  }
  const lines: GridLine[] = [];
  // Horizontal rows
  for (let y = 0; y <= boxSize + 1e-9; y += rowH) {
    lines.push({ x1: 0, y1: y, x2: boxSize, y2: y });
  }
  // Two diagonal families at ±60°
  const dy = rowH * 2;
  const dx = step;
  // Slope = ±dy/dx
  for (let xStart = -2 * boxSize; xStart <= 2 * boxSize; xStart += step / 2) {
    lines.push({ x1: xStart, y1: 0, x2: xStart + (boxSize / dy) * dx, y2: boxSize });
    lines.push({ x1: xStart, y1: 0, x2: xStart - (boxSize / dy) * dx, y2: boxSize });
  }
  return { points, lines };
}

function hexGeometry(step: number, boxSize: number): GridGeometry {
  const colSpacing = step * Math.sqrt(3);
  const rowSpacing = step * 1.5;
  const rawPoints: GridPoint[] = [];
  const lines: GridLine[] = [];
  for (let row = 0; row * rowSpacing - step <= boxSize; row++) {
    const yCenter = row * rowSpacing;
    const offsetX = (row % 2) * (colSpacing / 2);
    for (let col = 0; col * colSpacing - offsetX - colSpacing <= boxSize; col++) {
      const xCenter = col * colSpacing - offsetX;
      const vs: GridPoint[] = Array.from({ length: 6 }, (_, k) => {
        const theta = Math.PI / 2 + (Math.PI / 3) * k;
        return { x: xCenter + step * Math.cos(theta), y: yCenter + step * Math.sin(theta) };
      });
      rawPoints.push(...vs);
      for (let k = 0; k < 6; k++) {
        const a = vs[k];
        const b = vs[(k + 1) % 6];
        if (
          (a.x >= -step && a.x <= boxSize + step && a.y >= -step && a.y <= boxSize + step) ||
          (b.x >= -step && b.x <= boxSize + step && b.y >= -step && b.y <= boxSize + step)
        ) {
          lines.push({ x1: a.x, y1: a.y, x2: b.x, y2: b.y });
        }
      }
    }
  }
  const seen = new Map<string, GridPoint>();
  for (const p of rawPoints) {
    if (p.x < -1e-6 || p.x > boxSize + 1e-6 || p.y < -1e-6 || p.y > boxSize + 1e-6) continue;
    const key = `${Math.round(p.x * 100)},${Math.round(p.y * 100)}`;
    if (!seen.has(key)) seen.set(key, p);
  }
  return { points: [...seen.values()], lines };
}

export function computeGridGeometry(
  type: GridType,
  step: number,
  boxSize: number,
): GridGeometry {
  switch (type) {
    case "square":
      return squareGeometry(step, boxSize);
    case "polar":
      return polarGeometry(step, boxSize);
    case "triangular":
      return triangularGeometry(step, boxSize);
    case "hex":
      return hexGeometry(step, boxSize);
  }
}

export function snapToGridPoint(
  ux: number,
  uy: number,
  geom: GridGeometry,
  step: number,
): { x: number; y: number } {
  if (geom.points.length === 0) return { x: ux, y: uy };
  let bestX = ux;
  let bestY = uy;
  let bestD2 = Infinity;
  for (const p of geom.points) {
    const dx = p.x - ux;
    const dy = p.y - uy;
    const d2 = dx * dx + dy * dy;
    if (d2 < bestD2) {
      bestD2 = d2;
      bestX = p.x;
      bestY = p.y;
    }
  }
  // Don't snap when the user is far from any grid point (e.g. outside polar
  // coverage). 1.5 * step gives some forgiveness while still keeping snap
  // local enough to feel intentional.
  if (Math.sqrt(bestD2) > step * 1.5) return { x: ux, y: uy };
  return { x: bestX, y: bestY };
}
