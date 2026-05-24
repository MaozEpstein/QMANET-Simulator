/**
 * 2D atom-array visualization.
 *
 * Renders the 75×76 µm user region, the 4µm lattice grid, every atom as a
 * glowing dot, and an optional translucent blockade-radius disk around each.
 * Edges induced by the blockade are drawn so the user can see *which* logical
 * graph the geometry actually realizes.
 *
 * Coordinates: x∈[0, W_um] (left→right), y∈[0, H_um] (BOTTOM→TOP, like a
 * physics plot — NOT screen coordinates). The component flips y internally.
 */

import { useMemo } from "react";
import { palette } from "../theme/palette";
import type { NodePos } from "../api/rest";

/** Linearly interpolate two #rrggbb hex colors (0=a, 1=b). */
function mixHex(a: string, b: string, t: number): string {
  const pa = hexToRgb(a);
  const pb = hexToRgb(b);
  const r = Math.round(pa[0] + (pb[0] - pa[0]) * t);
  const g = Math.round(pa[1] + (pb[1] - pa[1]) * t);
  const bl = Math.round(pa[2] + (pb[2] - pa[2]) * t);
  return `rgb(${r},${g},${bl})`;
}
function hexToRgb(h: string): [number, number, number] {
  const s = h.replace("#", "");
  return [
    parseInt(s.slice(0, 2), 16),
    parseInt(s.slice(2, 4), 16),
    parseInt(s.slice(4, 6), 16),
  ];
}

interface Props {
  atoms: NodePos[];
  blockadeRadiusUm: number;
  /** Edges (i,j) to draw between atoms — typically the blockade-induced ones. */
  edges?: [number, number][];
  /** Aquila user region width in µm. */
  regionWidthUm?: number;
  regionHeightUm?: number;
  /** Lattice spacing for the background grid (µm). */
  latticeSpacingUm?: number;
  /** Pixel size of the SVG (the µm-frame is scaled to fit, preserving aspect). */
  pixelWidth?: number;
  pixelHeight?: number;
  /** Atom ids to highlight (e.g., violation locus). */
  highlight?: Set<number>;
  /** When true, draw blockade rings around each atom. */
  showBlockade?: boolean;
  /** When true, draw the lattice grid. */
  showGrid?: boolean;
  caption?: string;
  /**
   * Optional Rydberg populations per atom (same length as `atoms`).
   * Drives the emissive intensity: 0 → cool ground-state cyan,
   * 1 → glowing Rydberg purple. Phase 4 plumbs WS frames into this prop.
   */
  populations?: number[];
}

export function AtomArray2D({
  atoms,
  blockadeRadiusUm,
  edges = [],
  regionWidthUm = 75,
  regionHeightUm = 76,
  latticeSpacingUm = 5,
  pixelWidth = 600,
  pixelHeight = 600,
  highlight,
  showBlockade = true,
  showGrid = true,
  caption,
  populations,
}: Props) {
  // Preserve aspect ratio in µm-space → pixel-space.
  const scale = useMemo(
    () => Math.min(pixelWidth / regionWidthUm, pixelHeight / regionHeightUm),
    [pixelWidth, pixelHeight, regionWidthUm, regionHeightUm],
  );
  const padding = 24;
  const innerW = regionWidthUm * scale;
  const innerH = regionHeightUm * scale;
  const W = innerW + padding * 2;
  const H = innerH + padding * 2;

  // µm → px transform: x stays, y flips (so y=0 is at bottom)
  const toX = (um: number) => padding + um * scale;
  const toY = (um: number) => padding + (regionHeightUm - um) * scale;
  const toR = (um: number) => um * scale;

  // Grid lines
  const gridLines: { x1: number; y1: number; x2: number; y2: number }[] = [];
  if (showGrid && latticeSpacingUm > 0) {
    for (let x = 0; x <= regionWidthUm; x += latticeSpacingUm) {
      gridLines.push({ x1: toX(x), y1: toY(0), x2: toX(x), y2: toY(regionHeightUm) });
    }
    for (let y = 0; y <= regionHeightUm; y += latticeSpacingUm) {
      gridLines.push({ x1: toX(0), y1: toY(y), x2: toX(regionWidthUm), y2: toY(y) });
    }
  }

  return (
    <div dir="ltr" style={{ display: "inline-block" }}>
      <svg
        width={W}
        height={H}
        role="img"
        aria-label={caption ?? "Atom array"}
        style={{
          background: palette.bgInset,
          border: `1px solid ${palette.queraPurpleSoft}`,
          borderRadius: 12,
          display: "block",
        }}
      >
        <defs>
          <filter id="atom-glow" x="-50%" y="-50%" width="200%" height="200%">
            <feGaussianBlur stdDeviation="2.5" result="blur" />
            <feMerge>
              <feMergeNode in="blur" />
              <feMergeNode in="SourceGraphic" />
            </feMerge>
          </filter>
          <radialGradient id="atom-gradient">
            <stop offset="0%" stopColor={palette.queraPurpleGlow} stopOpacity="1" />
            <stop offset="60%" stopColor={palette.queraPurple} stopOpacity="0.95" />
            <stop offset="100%" stopColor={palette.queraPurple} stopOpacity="0.7" />
          </radialGradient>
        </defs>

        {/* User region rectangle */}
        <rect
          x={toX(0)}
          y={toY(regionHeightUm)}
          width={innerW}
          height={innerH}
          fill="none"
          stroke={palette.queraPurple}
          strokeOpacity={0.5}
          strokeWidth={1.5}
          strokeDasharray="4 4"
        />

        {/* Grid */}
        {gridLines.map((g, i) => (
          <line
            key={`grid-${i}`}
            x1={g.x1}
            y1={g.y1}
            x2={g.x2}
            y2={g.y2}
            stroke={palette.queraPurpleSoft}
            strokeOpacity={0.4}
            strokeWidth={0.5}
          />
        ))}

        {/* Axes labels */}
        <text x={toX(0)} y={toY(0) + 16} fontSize={10} fill={palette.textMuted}>
          0
        </text>
        <text x={toX(regionWidthUm) - 18} y={toY(0) + 16} fontSize={10} fill={palette.textMuted}>
          {regionWidthUm}µm
        </text>
        <text x={toX(0) - 18} y={toY(regionHeightUm) + 4} fontSize={10} fill={palette.textMuted}>
          {regionHeightUm}
        </text>

        {/* Blockade rings */}
        {showBlockade &&
          atoms.map((a) => (
            <circle
              key={`bl-${a.id}`}
              cx={toX(a.x)}
              cy={toY(a.y)}
              r={toR(blockadeRadiusUm)}
              fill={palette.queraPurpleGlow}
              fillOpacity={0.06}
              stroke={palette.queraPurple}
              strokeOpacity={0.4}
              strokeWidth={1}
              strokeDasharray="2 3"
            />
          ))}

        {/* Edges between atoms */}
        {edges.map(([u, v], i) => {
          const a = atoms.find((p) => p.id === u);
          const b = atoms.find((p) => p.id === v);
          if (!a || !b) return null;
          return (
            <line
              key={`edge-${i}`}
              x1={toX(a.x)}
              y1={toY(a.y)}
              x2={toX(b.x)}
              y2={toY(b.y)}
              stroke={palette.queraPurpleGlow}
              strokeOpacity={0.55}
              strokeWidth={1.2}
            />
          );
        })}

        {/* Atoms */}
        {atoms.map((a, idx) => {
          const isHi = highlight?.has(a.id) ?? false;
          const p = populations?.[idx] ?? 0;
          // Interpolate ground-state cyan → Rydberg purple based on ⟨n̂_i⟩
          const groundColor = palette.atomGround; // #3ed3ff
          const rydColor = palette.queraPurpleGlow; // #b388ff
          const fill = isHi
            ? palette.err
            : populations !== undefined
              ? mixHex(groundColor, rydColor, Math.max(0, Math.min(1, p)))
              : "url(#atom-gradient)";
          const radius = isHi ? 8 : 6 + (populations !== undefined ? 2 * p : 0);
          return (
            <g key={`atom-${a.id}`} transform={`translate(${toX(a.x)}, ${toY(a.y)})`}>
              <circle
                r={radius}
                fill={fill}
                stroke="#fff"
                strokeOpacity={0.9}
                strokeWidth={isHi ? 2 : 1}
                filter="url(#atom-glow)"
              />
              <text
                fontSize={9}
                fill="#fff"
                textAnchor="middle"
                dy={3}
                style={{ fontFamily: "JetBrains Mono, monospace", pointerEvents: "none" }}
              >
                {a.id}
              </text>
            </g>
          );
        })}

        {caption && (
          <text x={12} y={18} fontSize={11} fill={palette.textSecondary} fontFamily="JetBrains Mono">
            {caption}
          </text>
        )}
      </svg>
    </div>
  );
}
