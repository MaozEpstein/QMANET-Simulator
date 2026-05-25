export type GridType = "none" | "square" | "polar" | "triangular" | "hex";

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

export interface GridTypeSpec {
  id: GridType;
  label: string;
  description: string;
  sizeLabel: string;
}

export const GRID_TYPES: GridTypeSpec[] = [
  { id: "none", label: "ללא", description: "ללא רשת רקע — קנבס נקי. ההצמדה מושבתת.", sizeLabel: "" },
  { id: "square", label: "ריבועית", description: "קווים אופקיים ואנכיים — קודקודים יוצמדו לפינות תאים.", sizeLabel: "גודל תא (µm)" },
  { id: "polar", label: "עגולה", description: "טבעות קונצנטריות + שורות רדיאליות. שימושי לטופולוגיות סלולריות.", sizeLabel: "מרווח טבעות (µm)" },
  { id: "triangular", label: "משולשית", description: "סריג משולשי — כל קודקוד עם 6 שכנים פוטנציאליים.", sizeLabel: "מרווח סריג (µm)" },
  { id: "hex", label: "משושית (חלת דבש)", description: "תבנית חלת-דבש — קודקודים על קודקודי משושים.", sizeLabel: "צלע משושה (µm)" },
];

function squareGeometry(step: number, boxW: number, boxH: number): GridGeometry {
  const points: GridPoint[] = [];
  const lines: GridLine[] = [];
  const bigStep = Math.max(step, Math.round(50 / step) * step);
  for (let x = 0; x <= boxW + 1e-9; x += step) {
    const bold = x > 0 && Math.abs(x - Math.round(x / bigStep) * bigStep) < 1e-6;
    lines.push({ x1: x, y1: 0, x2: x, y2: boxH, bold });
  }
  for (let y = 0; y <= boxH + 1e-9; y += step) {
    const bold = y > 0 && Math.abs(y - Math.round(y / bigStep) * bigStep) < 1e-6;
    lines.push({ x1: 0, y1: y, x2: boxW, y2: y, bold });
  }
  for (let x = 0; x <= boxW + 1e-9; x += step) {
    for (let y = 0; y <= boxH + 1e-9; y += step) {
      points.push({ x, y });
    }
  }
  return { points, lines };
}

function polarGeometry(step: number, boxW: number, boxH: number): GridGeometry {
  const cx = boxW / 2;
  const cy = boxH / 2;
  const maxR = Math.hypot(Math.max(cx, boxW - cx), Math.max(cy, boxH - cy));
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
      if (x >= -1e-6 && x <= boxW + 1e-6 && y >= -1e-6 && y <= boxH + 1e-6) {
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

function triangularGeometry(step: number, boxW: number, boxH: number): GridGeometry {
  const rowH = (step * Math.sqrt(3)) / 2;
  const points: GridPoint[] = [];
  let rowIdx = 0;
  for (let y = 0; y <= boxH + 1e-9; y += rowH, rowIdx++) {
    const offset = (rowIdx % 2) * (step / 2);
    for (let x = -offset; x <= boxW + 1e-9; x += step) {
      if (x >= -1e-6) points.push({ x, y });
    }
  }
  const lines: GridLine[] = [];
  // Horizontal rows
  for (let y = 0; y <= boxH + 1e-9; y += rowH) {
    lines.push({ x1: 0, y1: y, x2: boxW, y2: y });
  }
  // Two diagonal families at ±60°
  const dy = rowH * 2;
  const dx = step;
  for (let xStart = -2 * boxW; xStart <= 2 * boxW; xStart += step / 2) {
    lines.push({ x1: xStart, y1: 0, x2: xStart + (boxH / dy) * dx, y2: boxH });
    lines.push({ x1: xStart, y1: 0, x2: xStart - (boxH / dy) * dx, y2: boxH });
  }
  return { points, lines };
}

function hexGeometry(step: number, boxW: number, boxH: number): GridGeometry {
  const colSpacing = step * Math.sqrt(3);
  const rowSpacing = step * 1.5;
  const rawPoints: GridPoint[] = [];
  const lines: GridLine[] = [];
  for (let row = 0; row * rowSpacing - step <= boxH; row++) {
    const yCenter = row * rowSpacing;
    const offsetX = (row % 2) * (colSpacing / 2);
    for (let col = 0; col * colSpacing - offsetX - colSpacing <= boxW; col++) {
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
          (a.x >= -step && a.x <= boxW + step && a.y >= -step && a.y <= boxH + step) ||
          (b.x >= -step && b.x <= boxW + step && b.y >= -step && b.y <= boxH + step)
        ) {
          lines.push({ x1: a.x, y1: a.y, x2: b.x, y2: b.y });
        }
      }
    }
  }
  const seen = new Map<string, GridPoint>();
  for (const p of rawPoints) {
    if (p.x < -1e-6 || p.x > boxW + 1e-6 || p.y < -1e-6 || p.y > boxH + 1e-6) continue;
    const key = `${Math.round(p.x * 100)},${Math.round(p.y * 100)}`;
    if (!seen.has(key)) seen.set(key, p);
  }
  return { points: [...seen.values()], lines };
}

export function computeGridGeometry(
  type: GridType,
  step: number,
  boxW: number,
  boxH: number = boxW,
): GridGeometry {
  switch (type) {
    case "none":
      return { points: [], lines: [] };
    case "square":
      return squareGeometry(step, boxW, boxH);
    case "polar":
      return polarGeometry(step, boxW, boxH);
    case "triangular":
      return triangularGeometry(step, boxW, boxH);
    case "hex":
      return hexGeometry(step, boxW, boxH);
  }
}

function distanceToSegment(
  px: number,
  py: number,
  x1: number,
  y1: number,
  x2: number,
  y2: number,
): { x: number; y: number; d: number } {
  const dx = x2 - x1;
  const dy = y2 - y1;
  const len2 = dx * dx + dy * dy;
  if (len2 === 0) {
    return { x: x1, y: y1, d: Math.hypot(px - x1, py - y1) };
  }
  let t = ((px - x1) * dx + (py - y1) * dy) / len2;
  t = Math.max(0, Math.min(1, t));
  const x = x1 + t * dx;
  const y = y1 + t * dy;
  return { x, y, d: Math.hypot(px - x, py - y) };
}

/**
 * Snap (ux, uy) to the closest grid feature.
 *
 * Priority: a nearby intersection point wins over a line, since the user
 * "meant" to land on it. A line wins when the user clicked clearly on the
 * line but far from any intersection. If both are too far, fall back to
 * the original coordinate (no snap).
 */
export function snapToGrid(
  ux: number,
  uy: number,
  geom: GridGeometry,
  step: number,
): { x: number; y: number } {
  let pt = { x: ux, y: uy, d: Infinity };
  for (const p of geom.points) {
    const d = Math.hypot(p.x - ux, p.y - uy);
    if (d < pt.d) pt = { x: p.x, y: p.y, d };
  }

  let line = { x: ux, y: uy, d: Infinity };
  for (const l of geom.lines) {
    const r = distanceToSegment(ux, uy, l.x1, l.y1, l.x2, l.y2);
    if (r.d < line.d) line = r;
  }

  // Intersection wins inside its "click radius" (~⅓ of grid step), even if a
  // line is technically closer.
  const pointSnapRadius = step * 0.35;
  const lineSnapRadius = step * 0.5;

  if (pt.d <= pointSnapRadius) return { x: pt.x, y: pt.y };
  if (line.d <= lineSnapRadius) return { x: line.x, y: line.y };
  if (pt.d <= step * 1.5) return { x: pt.x, y: pt.y };
  return { x: ux, y: uy };
}

/** @deprecated kept for backward compat — prefer snapToGrid. */
export const snapToGridPoint = snapToGrid;
