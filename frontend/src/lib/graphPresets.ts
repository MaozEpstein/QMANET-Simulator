import type { NodePos } from "../api/rest";

export interface PresetResult {
  positions: NodePos[];
  edges: [number, number][];
}

export interface PresetSpec {
  id: string;
  name: string;
  description: string;
  paramLabel: string;
  paramMin: number;
  paramMax: number;
  paramDefault: number;
  build: (param: number) => PresetResult;
}

// The editor's working area is 200×100 µm (wide rectangle). Presets center
// their layouts at (CX, CY) so they sit inside the box regardless of shape.
const CX = 100;
const CY = 50;
const RING_R = 40;
const MARGIN = 10;
const BOX_W = 200;

function ringPositions(n: number, radius = RING_R): NodePos[] {
  return Array.from({ length: n }, (_, i) => {
    const theta = -Math.PI / 2 + (2 * Math.PI * i) / n;
    return { id: i, x: CX + radius * Math.cos(theta), y: CY + radius * Math.sin(theta) };
  });
}

export function buildRing(n: number): PresetResult {
  const positions = ringPositions(n);
  const edges: [number, number][] = [];
  for (let i = 0; i < n; i++) edges.push([i, (i + 1) % n]);
  return { positions, edges };
}

export function buildWheel(nOuter: number): PresetResult {
  const positions: NodePos[] = [{ id: 0, x: CX, y: CY }];
  for (let i = 0; i < nOuter; i++) {
    const theta = -Math.PI / 2 + (2 * Math.PI * i) / nOuter;
    positions.push({ id: i + 1, x: CX + RING_R * Math.cos(theta), y: CY + RING_R * Math.sin(theta) });
  }
  const edges: [number, number][] = [];
  for (let i = 0; i < nOuter; i++) {
    edges.push([0, i + 1]);
    edges.push([i + 1, ((i + 1) % nOuter) + 1]);
  }
  return { positions, edges };
}

export function buildStar(nLeaves: number): PresetResult {
  const positions: NodePos[] = [{ id: 0, x: CX, y: CY }];
  for (let i = 0; i < nLeaves; i++) {
    const theta = -Math.PI / 2 + (2 * Math.PI * i) / nLeaves;
    positions.push({ id: i + 1, x: CX + RING_R * Math.cos(theta), y: CY + RING_R * Math.sin(theta) });
  }
  const edges: [number, number][] = positions.slice(1).map((_, i) => [0, i + 1]);
  return { positions, edges };
}

export function buildPath(n: number): PresetResult {
  const span = BOX_W - 2 * MARGIN;
  const step = n > 1 ? span / (n - 1) : 0;
  const positions: NodePos[] = Array.from({ length: n }, (_, i) => ({
    id: i,
    x: MARGIN + i * step,
    y: CY,
  }));
  const edges: [number, number][] = [];
  for (let i = 0; i < n - 1; i++) edges.push([i, i + 1]);
  return { positions, edges };
}

export function buildComplete(n: number): PresetResult {
  const positions = ringPositions(n);
  const edges: [number, number][] = [];
  for (let i = 0; i < n; i++) for (let j = i + 1; j < n; j++) edges.push([i, j]);
  return { positions, edges };
}

export function buildSquareGrid(k: number): PresetResult {
  const span = 100 - 2 * MARGIN;
  const step = k > 1 ? span / (k - 1) : 0;
  const xOffset = (BOX_W - 100) / 2 + MARGIN; // center horizontally in wide box
  const yOffset = MARGIN;
  const positions: NodePos[] = [];
  for (let row = 0; row < k; row++) {
    for (let col = 0; col < k; col++) {
      positions.push({
        id: row * k + col,
        x: xOffset + col * step,
        y: yOffset + row * step,
      });
    }
  }
  const edges: [number, number][] = [];
  for (let row = 0; row < k; row++) {
    for (let col = 0; col < k; col++) {
      const id = row * k + col;
      if (col < k - 1) edges.push([id, id + 1]);
      if (row < k - 1) edges.push([id, id + k]);
    }
  }
  return { positions, edges };
}

export function buildTriangularGrid(rows: number): PresetResult {
  const span = 100 - 2 * MARGIN;
  const cols = rows;
  const xStep = cols > 1 ? span / (cols - 1) : span;
  const yStep = (xStep * Math.sqrt(3)) / 2;
  const totalHeight = (rows - 1) * yStep;
  const yOffset = (100 - totalHeight) / 2;
  const xBase = (BOX_W - 100) / 2 + MARGIN; // center horizontally in wide box
  const positions: NodePos[] = [];
  const idAt: number[][] = [];
  for (let row = 0; row < rows; row++) {
    const rowIds: number[] = [];
    const colsThisRow = cols;
    const rowOffsetX = (row % 2 === 0 ? 0 : xStep / 2);
    for (let col = 0; col < colsThisRow; col++) {
      if (xBase + rowOffsetX + col * xStep > xBase + 100 - 2 * MARGIN + 1e-6) break;
      const id = positions.length;
      positions.push({
        id,
        x: xBase + rowOffsetX + col * xStep,
        y: yOffset + row * yStep,
      });
      rowIds.push(id);
    }
    idAt.push(rowIds);
  }
  const edges: [number, number][] = [];
  for (let row = 0; row < idAt.length; row++) {
    const rowIds = idAt[row];
    for (let i = 0; i < rowIds.length - 1; i++) edges.push([rowIds[i], rowIds[i + 1]]);
    if (row + 1 < idAt.length) {
      const next = idAt[row + 1];
      const offset = row % 2 === 0 ? 0 : 1;
      for (let i = 0; i < rowIds.length; i++) {
        if (i - offset >= 0 && i - offset < next.length) edges.push([rowIds[i], next[i - offset]]);
        if (i - offset + 1 >= 0 && i - offset + 1 < next.length) edges.push([rowIds[i], next[i - offset + 1]]);
      }
    }
  }
  return { positions, edges };
}

export function buildHexagonalFlower(rings: number): PresetResult {
  const cellSize = Math.min(40 / Math.max(rings, 1), 22);
  const positions: NodePos[] = [{ id: 0, x: CX, y: CY }];
  const dirs = Array.from({ length: 6 }, (_, i) => {
    const theta = (Math.PI / 3) * i;
    return { dx: cellSize * Math.cos(theta), dy: cellSize * Math.sin(theta) };
  });

  let id = 1;
  for (let r = 1; r <= rings; r++) {
    let { dx, dy } = { dx: r * dirs[4].dx, dy: r * dirs[4].dy };
    for (let side = 0; side < 6; side++) {
      const step = dirs[side];
      for (let k = 0; k < r; k++) {
        positions.push({ id, x: CX + dx, y: CY + dy });
        id++;
        dx += step.dx;
        dy += step.dy;
      }
    }
  }

  const edges: [number, number][] = [];
  const tol = cellSize * 0.15;
  for (let i = 0; i < positions.length; i++) {
    for (let j = i + 1; j < positions.length; j++) {
      const a = positions[i];
      const b = positions[j];
      const d = Math.hypot(a.x - b.x, a.y - b.y);
      if (Math.abs(d - cellSize) < tol) edges.push([i, j]);
    }
  }
  return { positions, edges };
}

export const PRESETS: PresetSpec[] = [
  {
    id: "ring",
    name: "טבעת",
    description: "N קודקודים על מעגל, מחוברים לשכנים הסמוכים.",
    paramLabel: "N",
    paramMin: 3,
    paramMax: 30,
    paramDefault: 8,
    build: buildRing,
  },
  {
    id: "wheel",
    name: "גלגל",
    description: "טבעת חיצונית + מרכז עם חישורים לכל הקודקודים.",
    paramLabel: "חיצוניים",
    paramMin: 3,
    paramMax: 24,
    paramDefault: 8,
    build: buildWheel,
  },
  {
    id: "star",
    name: "כוכב",
    description: "מרכז יחיד עם N עלים סביבו.",
    paramLabel: "עלים",
    paramMin: 2,
    paramMax: 20,
    paramDefault: 6,
    build: buildStar,
  },
  {
    id: "path",
    name: "שרשרת",
    description: "N קודקודים בשורה, מחוברים סדרתית.",
    paramLabel: "N",
    paramMin: 2,
    paramMax: 25,
    paramDefault: 6,
    build: buildPath,
  },
  {
    id: "complete",
    name: "מלא (K_n)",
    description: "כל זוג קודקודים מחובר. גדל מהר — שמור על N קטן.",
    paramLabel: "N",
    paramMin: 3,
    paramMax: 12,
    paramDefault: 5,
    build: buildComplete,
  },
  {
    id: "grid",
    name: "רשת ריבועית",
    description: "k×k קודקודים עם קשתות לשכנים בשורה/עמודה.",
    paramLabel: "k",
    paramMin: 2,
    paramMax: 6,
    paramDefault: 4,
    build: buildSquareGrid,
  },
  {
    id: "triangular",
    name: "רשת משולשית",
    description: "סריג משולשי — כל קודקוד עם עד 6 שכנים.",
    paramLabel: "שורות",
    paramMin: 2,
    paramMax: 6,
    paramDefault: 4,
    build: buildTriangularGrid,
  },
  {
    id: "hex",
    name: "פרח משושים",
    description: "טבעות משושיות קונצנטריות סביב מרכז.",
    paramLabel: "טבעות",
    paramMin: 1,
    paramMax: 3,
    paramDefault: 1,
    build: buildHexagonalFlower,
  },
];
