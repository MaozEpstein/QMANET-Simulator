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

import { useMemo, useRef, useState } from "react";
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
  /** When true, draw atom-id labels next to each atom (not just inside).
   *  Off by default for the existing live-evolution view (would be too noisy
   *  on top of the population-colour animation) but Stage 3 needs them so
   *  the user can map "violation on atom 7" back to a specific dot. */
  showAtomLabels?: boolean;
  caption?: string;
  /**
   * Optional Rydberg populations per atom (same length as `atoms`).
   * Drives the emissive intensity: 0 → cool ground-state cyan,
   * 1 → glowing Rydberg purple. Phase 4 plumbs WS frames into this prop.
   */
  populations?: number[];
  /** Fires when the user clicks an atom dot. Stage 5 uses this for inspect. */
  onAtomClick?: (atomId: number) => void;
  /** Atom id rendered with an extra outline ring + bold label. */
  selectedAtom?: number | null;
  /** Enables drag-to-move on each atom. Called with the new µm coords on
   *  every pointermove (throttled by rAF) and on pointerup. Coordinates are
   *  clamped to the region and snapped to `dragSnapUm` µm. */
  onAtomDrag?: (atomId: number, x_um: number, y_um: number) => void;
  /** Grid snap for drag, in µm. Default 1 — stabilises sub-pixel jitter. */
  dragSnapUm?: number;
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
  showAtomLabels = false,
  caption,
  populations,
  onAtomClick,
  selectedAtom = null,
  onAtomDrag,
  dragSnapUm = 1,
}: Props) {
  const dragRafRef = useRef<number | null>(null);
  const dragLatestRef = useRef<{ id: number; x: number; y: number } | null>(null);
  // Hover state for the Aquila user-region rectangle — used to surface a
  // tooltip explaining what the dashed frame is the first time the user sees it.
  const [regionHover, setRegionHover] = useState(false);
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

        {/* User region rectangle. A wide transparent stroke acts as a hit
            target so the user can hover the dashed boundary without having
            to pixel-hunt the 1.5px line. */}
        <rect
          x={toX(0)}
          y={toY(regionHeightUm)}
          width={innerW}
          height={innerH}
          fill="none"
          stroke="transparent"
          strokeWidth={14}
          onMouseEnter={() => setRegionHover(true)}
          onMouseLeave={() => setRegionHover(false)}
          style={{ cursor: "help" }}
        />
        <rect
          x={toX(0)}
          y={toY(regionHeightUm)}
          width={innerW}
          height={innerH}
          fill="none"
          stroke={regionHover ? palette.queraPurpleGlow : palette.queraPurple}
          strokeOpacity={regionHover ? 0.95 : 0.55}
          strokeWidth={regionHover ? 2.2 : 1.6}
          strokeDasharray="4 4"
          style={{ transition: "stroke 120ms ease, stroke-opacity 120ms ease" }}
          pointerEvents="none"
        />
        {/* Small region label, always visible in the upper-right of the frame. */}
        <text
          x={toX(regionWidthUm) - 4}
          y={toY(regionHeightUm) - 6}
          fontSize={9.5}
          fill={regionHover ? palette.queraPurpleGlow : palette.queraPurpleSoft}
          fontFamily="JetBrains Mono, monospace"
          textAnchor="end"
          pointerEvents="none"
          style={{ transition: "fill 120ms ease" }}
        >
          Aquila {regionWidthUm}×{regionHeightUm} µm
        </text>

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
          // External label offset: 1.5x the atom radius, off to the upper-right
          // so it doesn't clash with the blockade ring or the (cramped) text
          // that previously sat *inside* the circle. Stage 3 needs to be able
          // to read "atom 7 violated min_spacing" → find atom 7 → so the label
          // has to be legible at a glance.
          const labelDx = radius + 4;
          const labelDy = -(radius + 4);
          const isSel = selectedAtom === a.id;
          const handleDragMove = (clientX: number, clientY: number, svgEl: SVGSVGElement) => {
            if (!onAtomDrag) return;
            const rect = svgEl.getBoundingClientRect();
            // px relative to SVG → µm. Invert the (toX, toY) transforms.
            const x_um = (clientX - rect.left - padding) / scale;
            const y_um = regionHeightUm - (clientY - rect.top - padding) / scale;
            // Clamp to region + snap.
            const cx = Math.max(0, Math.min(regionWidthUm, x_um));
            const cy = Math.max(0, Math.min(regionHeightUm, y_um));
            const sx = dragSnapUm > 0 ? Math.round(cx / dragSnapUm) * dragSnapUm : cx;
            const sy = dragSnapUm > 0 ? Math.round(cy / dragSnapUm) * dragSnapUm : cy;
            dragLatestRef.current = { id: a.id, x: sx, y: sy };
            if (dragRafRef.current === null) {
              dragRafRef.current = requestAnimationFrame(() => {
                dragRafRef.current = null;
                const v = dragLatestRef.current;
                if (v) onAtomDrag(v.id, v.x, v.y);
              });
            }
          };
          return (
            <g
              key={`atom-${a.id}`}
              transform={`translate(${toX(a.x)}, ${toY(a.y)})`}
              onClick={onAtomClick ? () => onAtomClick(a.id) : undefined}
              onPointerDown={
                onAtomDrag
                  ? (e) => {
                      e.preventDefault();
                      e.stopPropagation();
                      const target = e.currentTarget;
                      target.setPointerCapture(e.pointerId);
                      const svg = target.ownerSVGElement;
                      if (!svg) return;
                      const onMove = (ev: PointerEvent) => {
                        if (ev.pointerId !== e.pointerId) return;
                        handleDragMove(ev.clientX, ev.clientY, svg);
                      };
                      const onUp = (ev: PointerEvent) => {
                        if (ev.pointerId !== e.pointerId) return;
                        target.releasePointerCapture(e.pointerId);
                        target.removeEventListener("pointermove", onMove);
                        target.removeEventListener("pointerup", onUp);
                        target.removeEventListener("pointercancel", onUp);
                        if (dragRafRef.current !== null) {
                          cancelAnimationFrame(dragRafRef.current);
                          dragRafRef.current = null;
                        }
                        const v = dragLatestRef.current;
                        if (v) onAtomDrag(v.id, v.x, v.y);
                        dragLatestRef.current = null;
                      };
                      target.addEventListener("pointermove", onMove);
                      target.addEventListener("pointerup", onUp);
                      target.addEventListener("pointercancel", onUp);
                    }
                  : undefined
              }
              style={
                onAtomDrag
                  ? { cursor: "grab", touchAction: "none" }
                  : onAtomClick
                    ? { cursor: "pointer" }
                    : undefined
              }
              data-testid={`atom-${a.id}`}
            >
              {isSel && (
                <circle
                  r={radius + 4}
                  fill="none"
                  stroke={palette.queraPurpleGlow}
                  strokeOpacity={0.95}
                  strokeWidth={2}
                />
              )}
              <circle
                r={radius}
                fill={fill}
                stroke="#fff"
                strokeOpacity={0.9}
                strokeWidth={isHi || isSel ? 2 : 1}
                filter="url(#atom-glow)"
              />
              {showAtomLabels ? (
                <>
                  {/* Subtle backdrop so the label stays readable over the dense
                      grid + blockade rings without obscuring the atom dot. */}
                  <text
                    x={labelDx}
                    y={labelDy}
                    fontSize={11}
                    fontWeight={700}
                    fill={palette.bgInset}
                    stroke={palette.bgInset}
                    strokeWidth={3}
                    paintOrder="stroke"
                    textAnchor="start"
                    style={{ fontFamily: "JetBrains Mono, monospace", pointerEvents: "none" }}
                  >
                    {a.id}
                  </text>
                  <text
                    x={labelDx}
                    y={labelDy}
                    fontSize={11}
                    fontWeight={700}
                    fill={isHi ? palette.err : palette.queraPurpleGlow}
                    textAnchor="start"
                    style={{ fontFamily: "JetBrains Mono, monospace", pointerEvents: "none" }}
                  >
                    {a.id}
                  </text>
                </>
              ) : (
                <text
                  fontSize={9}
                  fill="#fff"
                  textAnchor="middle"
                  dy={3}
                  style={{ fontFamily: "JetBrains Mono, monospace", pointerEvents: "none" }}
                >
                  {a.id}
                </text>
              )}
            </g>
          );
        })}

        {caption && (
          <text x={12} y={18} fontSize={11} fill={palette.textSecondary} fontFamily="JetBrains Mono">
            {caption}
          </text>
        )}

        {/* Hover tooltip — explains what the dashed frame represents. Positioned
            just inside the top-left of the region so it never clips off-screen
            for any pixel size we render at. */}
        {regionHover && (
          <g style={{ pointerEvents: "none" }}>
            <rect
              x={toX(0) + 8}
              y={toY(regionHeightUm) + 8}
              width={258}
              height={62}
              rx={6}
              fill={palette.bgPanel}
              stroke={palette.queraPurpleGlow}
              strokeOpacity={0.7}
            />
            <text
              x={toX(0) + 18}
              y={toY(regionHeightUm) + 26}
              fontSize={11.5}
              fontWeight={700}
              fill={palette.queraPurpleGlow}
              fontFamily="JetBrains Mono, monospace"
            >
              Aquila user region
            </text>
            <text
              x={toX(0) + 18}
              y={toY(regionHeightUm) + 43}
              fontSize={10.5}
              fill={palette.textSecondary}
              fontFamily="JetBrains Mono, monospace"
            >
              {regionWidthUm}×{regionHeightUm} µm — מסגרת השדה הלייזרי
            </text>
            <text
              x={toX(0) + 18}
              y={toY(regionHeightUm) + 58}
              fontSize={10}
              fill={palette.textMuted}
              fontFamily="JetBrains Mono, monospace"
            >
              כל האטומים חייבים להיות בתוך המסגרת
            </text>
          </g>
        )}
      </svg>
    </div>
  );
}
