/**
 * SVG heatmap of the ground-state phase diagram in (Ω, Δ) space.
 *
 * Each cell of the n_delta × n_omega grid is coloured by the mean Rydberg
 * occupation ⟨Σ n̂⟩ — interpolating between dark navy (no Rydberg) and the
 * QuEra glow purple (fully excited). Distinct phases (no-Rydberg / Z₂ /
 * MIS / fully excited) appear as flat coloured regions.
 *
 * Hover any cell to read the exact (Ω, Δ, ⟨n⟩) values; the legend strip at
 * the right makes the colour ⇄ value mapping concrete.
 */

import { useMemo, useState } from "react";
import type { PhaseDiagramDTO } from "../api/rest";
import { palette } from "../theme/palette";

/**
 * One sample of the (Ω(t), Δ(t)) schedule path in phase space, used to overlay
 * the pulse trajectory on the heatmap so the user can see *which path* the
 * schedule traces through the (Ω, Δ) parameter space.
 */
export interface PhaseTrajectoryPoint {
  t_us: number;
  omega: number;
  delta: number;
}

interface Props {
  diagram: PhaseDiagramDTO;
  pixelWidth?: number;
  pixelHeight?: number;
  /** Optional schedule path in (Ω, Δ) space; drawn as a glowing line. */
  trajectory?: PhaseTrajectoryPoint[];
  /** If set, marks the trajectory point closest to this t (µs) with a halo. */
  cursorT?: number;
  /**
   * If provided, clicking any cell calls this with the (Ω, Δ) coordinates of
   * that cell. Enables "click-to-set" behaviour from the parent stage.
   */
  onPick?: (omega: number, delta: number, meanN: number) => void;
  /**
   * If provided, marks the picked (Ω, Δ) point with a "★" marker so the user
   * can see which point in phase space drives the live Hamiltonian view.
   */
  pickedPoint?: { omega: number; delta: number } | null;
}

const PAD_LEFT = 60;
const PAD_RIGHT = 110;
const PAD_TOP = 18;
const PAD_BOTTOM = 36;

/** Linear interpolation between two hex colors (matches AtomArray2D.mixHex). */
function mixHex(a: string, b: string, t: number): string {
  const ah = parseInt(a.slice(1), 16);
  const bh = parseInt(b.slice(1), 16);
  const ar = (ah >> 16) & 0xff;
  const ag = (ah >> 8) & 0xff;
  const ab = ah & 0xff;
  const br = (bh >> 16) & 0xff;
  const bg = (bh >> 8) & 0xff;
  const bb = bh & 0xff;
  const r = Math.round(ar + (br - ar) * t);
  const g = Math.round(ag + (bg - ag) * t);
  const bl = Math.round(ab + (bb - ab) * t);
  return `#${((1 << 24) | (r << 16) | (g << 8) | bl).toString(16).slice(1)}`;
}

export function PhaseDiagram2D({
  diagram,
  pixelWidth = 720,
  pixelHeight = 460,
  trajectory,
  cursorT,
  onPick,
  pickedPoint,
}: Props) {
  const { omegas, deltas, mean_n, n_atoms } = diagram;
  const nO = omegas.length;
  const nD = deltas.length;

  const innerW = pixelWidth - PAD_LEFT - PAD_RIGHT;
  const innerH = pixelHeight - PAD_TOP - PAD_BOTTOM;

  // Map (Ω, Δ) ranges to pixel coordinates.
  const oMin = omegas[0];
  const oMax = omegas[nO - 1];
  const dMin = deltas[0];
  const dMax = deltas[nD - 1];
  const cellW = innerW / nO;
  const cellH = innerH / nD;
  const oToX = (o: number) =>
    PAD_LEFT + ((o - oMin) / (oMax - oMin || 1)) * innerW;
  const dToY = (d: number) =>
    PAD_TOP + (1 - (d - dMin) / (dMax - dMin || 1)) * innerH;

  // Color ramp: dark navy bgInset → bright queraPurpleGlow.
  const colorFor = useMemo(() => {
    const lo = palette.bgInset;
    const hi = palette.queraPurpleGlow;
    return (val: number) => {
      const t = n_atoms > 0 ? Math.max(0, Math.min(1, val / n_atoms)) : 0;
      return mixHex(lo, hi, t);
    };
  }, [n_atoms]);

  const [hover, setHover] = useState<
    | { o: number; d: number; v: number; px: number; py: number }
    | null
  >(null);

  // Axis ticks
  const oTicks = 5;
  const dTicks = 5;
  const oTickValues = Array.from({ length: oTicks + 1 }, (_, i) =>
    oMin + ((oMax - oMin) * i) / oTicks,
  );
  const dTickValues = Array.from({ length: dTicks + 1 }, (_, i) =>
    dMin + ((dMax - dMin) * i) / dTicks,
  );

  // Legend strip (gradient bar with N+1 stops)
  const legendX = pixelWidth - PAD_RIGHT + 22;
  const legendW = 18;
  const legendStops = 24;

  // ---------------------------------------------------------------------------
  // Contour lines (marching squares).
  // For each threshold value, walk every grid cell; classify its four corners
  // as above/below; emit a line segment with linearly-interpolated endpoints.
  // The four interesting thresholds correspond to phase boundaries in the
  // Rydberg MIS Hamiltonian: vacuum→Z₂ (~1), Z₂→MIS (~N/3), MIS→full (~3N/4).
  // ---------------------------------------------------------------------------
  const contourLines = useMemo(() => {
    if (n_atoms <= 0) return [] as { d: string; level: number; label: string }[];
    const levels = [
      { level: 0.5, label: "no Rydberg ▸" },
      { level: n_atoms / 3, label: "▸ MIS" },
      { level: (3 * n_atoms) / 4, label: "▸ fully excited" },
    ];
    const corner = (di: number, oi: number) => ({
      v: mean_n[di][oi],
      x: oToX(omegas[oi]),
      y: dToY(deltas[di]),
    });
    const interp = (a: { v: number; x: number; y: number }, b: { v: number; x: number; y: number }, t: number) => {
      if (Math.abs(b.v - a.v) < 1e-9) return { x: a.x, y: a.y };
      const f = (t - a.v) / (b.v - a.v);
      return { x: a.x + (b.x - a.x) * f, y: a.y + (b.y - a.y) * f };
    };
    return levels.map(({ level, label }) => {
      const segs: string[] = [];
      for (let di = 0; di < nD - 1; di++) {
        for (let oi = 0; oi < nO - 1; oi++) {
          const tl = corner(di, oi);
          const tr = corner(di, oi + 1);
          const br = corner(di + 1, oi + 1);
          const bl = corner(di + 1, oi);
          const code =
            ((tl.v > level ? 1 : 0) << 3) |
            ((tr.v > level ? 1 : 0) << 2) |
            ((br.v > level ? 1 : 0) << 1) |
            (bl.v > level ? 1 : 0);
          // Only emit when the cell straddles the threshold (not all-in / all-out).
          if (code === 0 || code === 15) continue;
          // Compute intersection on each of the four edges (top/right/bottom/left)
          // only when those edges actually cross — straight from the MS table.
          const top = ((tl.v > level) !== (tr.v > level)) ? interp(tl, tr, level) : null;
          const right = ((tr.v > level) !== (br.v > level)) ? interp(tr, br, level) : null;
          const bottom = ((br.v > level) !== (bl.v > level)) ? interp(br, bl, level) : null;
          const left = ((bl.v > level) !== (tl.v > level)) ? interp(bl, tl, level) : null;
          const pts = [top, right, bottom, left].filter(Boolean) as { x: number; y: number }[];
          // Two-edge cell ⇒ one segment; four-edge cell (saddle) ⇒ two segments.
          if (pts.length === 2) {
            segs.push(`M${pts[0].x.toFixed(1)},${pts[0].y.toFixed(1)} L${pts[1].x.toFixed(1)},${pts[1].y.toFixed(1)}`);
          } else if (pts.length === 4) {
            segs.push(`M${pts[0].x.toFixed(1)},${pts[0].y.toFixed(1)} L${pts[1].x.toFixed(1)},${pts[1].y.toFixed(1)}`);
            segs.push(`M${pts[2].x.toFixed(1)},${pts[2].y.toFixed(1)} L${pts[3].x.toFixed(1)},${pts[3].y.toFixed(1)}`);
          }
        }
      }
      return { d: segs.join(" "), level, label };
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mean_n, omegas, deltas, n_atoms, nO, nD, pixelWidth, pixelHeight]);

  // ---------------------------------------------------------------------------
  // Region labels — heuristic placement at the cell whose ⟨n⟩ is closest to a
  // canonical phase target. Targets: 0 (vacuum), N/2 (Z₂-ish), N (fully excited).
  // ---------------------------------------------------------------------------
  const regionLabels = useMemo(() => {
    if (n_atoms <= 0) return [] as { x: number; y: number; text: string; color: string }[];
    const targets: { target: number; text: string; color: string }[] = [
      { target: 0, text: "no Rydberg", color: "#7cc1ff" },
      { target: n_atoms / 2, text: "Z₂ / MIS", color: palette.queraPurpleGlow },
      { target: n_atoms, text: "fully excited", color: palette.warn },
    ];
    return targets.map(({ target, text, color }) => {
      let best = { di: 0, oi: 0, dist: Infinity };
      for (let di = 0; di < nD; di++) {
        for (let oi = 0; oi < nO; oi++) {
          const d = Math.abs(mean_n[di][oi] - target);
          if (d < best.dist) best = { di, oi, dist: d };
        }
      }
      return {
        x: oToX(omegas[best.oi]),
        y: dToY(deltas[best.di]),
        text,
        color,
      };
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mean_n, omegas, deltas, n_atoms, nO, nD, pixelWidth, pixelHeight]);

  return (
    <div dir="ltr" style={{ display: "inline-block", position: "relative" }}>
      <svg
        width={pixelWidth}
        height={pixelHeight}
        style={{
          background: palette.bgPanel,
          border: `1px solid ${palette.queraPurpleSoft}`,
          borderRadius: 12,
          display: "block",
        }}
        onMouseLeave={() => setHover(null)}
      >
        {/* Heatmap cells. Iterate rows = Δ from highest (top) to lowest (bottom). */}
        {deltas.map((d, di) => {
          // We iterate top-to-bottom (so render from largest Δ first if our y-axis grows downward).
          // dToY already handles orientation — just place rect at correct y.
          const y = dToY(d) - cellH / 2;
          return (
            <g key={`row-${di}`}>
              {omegas.map((o, oi) => {
                const x = oToX(o) - cellW / 2;
                const v = mean_n[di][oi];
                return (
                  <rect
                    key={`c-${di}-${oi}`}
                    x={x}
                    y={y}
                    width={cellW + 1}
                    height={cellH + 1}
                    fill={colorFor(v)}
                    style={{ cursor: onPick ? "crosshair" : "default" }}
                    onMouseEnter={() =>
                      setHover({ o, d, v, px: x + cellW / 2, py: y + cellH / 2 })
                    }
                    onClick={onPick ? () => onPick(o, d, v) : undefined}
                  />
                );
              })}
            </g>
          );
        })}

        {/* Trajectory overlay — (Ω(t), Δ(t)) path through phase space.
            Points outside the visible diagram range are clamped to the edges
            so the line stays on-chart; in-range portions render normally. */}
        {trajectory && trajectory.length > 1 && (() => {
          const clampO = (o: number) => Math.max(oMin, Math.min(oMax, o));
          const clampD = (d: number) => Math.max(dMin, Math.min(dMax, d));
          const pts = trajectory.map((p) => ({
            x: oToX(clampO(p.omega)),
            y: dToY(clampD(p.delta)),
            inRange:
              p.omega >= oMin && p.omega <= oMax && p.delta >= dMin && p.delta <= dMax,
            t: p.t_us,
          }));
          const pathD = pts
            .map((p, i) => `${i === 0 ? "M" : "L"}${p.x.toFixed(2)},${p.y.toFixed(2)}`)
            .join(" ");
          // Cursor marker: nearest sample by |t - cursorT|.
          let cursorPt: (typeof pts)[number] | null = null;
          if (cursorT != null) {
            let best = Infinity;
            for (const p of pts) {
              const d = Math.abs(p.t - cursorT);
              if (d < best) {
                best = d;
                cursorPt = p;
              }
            }
          }
          const startPt = pts[0];
          const endPt = pts[pts.length - 1];
          // Quarter-time markers (T/4, T/2, 3T/4) and a few direction
          // arrowheads placed along the curve. The arrowheads convey *direction*
          // — phase diagrams alone don't say which way the schedule sweeps.
          const tStart = trajectory[0].t_us;
          const tEnd = trajectory[trajectory.length - 1].t_us;
          const tSpan = tEnd - tStart || 1;
          const quarterTargets = [
            { frac: 0.25, label: "T/4" },
            { frac: 0.5, label: "T/2" },
            { frac: 0.75, label: "3T/4" },
          ];
          const findIdxForFrac = (f: number) => {
            const target = tStart + f * tSpan;
            let bestI = 0;
            let bestD = Infinity;
            for (let i = 0; i < trajectory.length; i++) {
              const d = Math.abs(trajectory[i].t_us - target);
              if (d < bestD) {
                bestD = d;
                bestI = i;
              }
            }
            return bestI;
          };
          const arrowFracs = [0.15, 0.4, 0.65, 0.9];
          return (
            <g pointerEvents="none">
              {/* Glow underlay */}
              <path
                d={pathD}
                fill="none"
                stroke={palette.ok}
                strokeOpacity={0.35}
                strokeWidth={6}
                strokeLinecap="round"
                strokeLinejoin="round"
              />
              {/* Sharp top line */}
              <path
                d={pathD}
                fill="none"
                stroke={palette.ok}
                strokeWidth={2}
                strokeLinecap="round"
                strokeLinejoin="round"
              />
              {/* Direction arrowheads — triangles tangent to the curve */}
              {arrowFracs.map((f, k) => {
                const idx = findIdxForFrac(f);
                if (idx < 1 || idx >= pts.length) return null;
                const p = pts[idx];
                const pPrev = pts[idx - 1];
                const dx = p.x - pPrev.x;
                const dy = p.y - pPrev.y;
                const len = Math.hypot(dx, dy);
                if (len < 1) return null;
                const ux = dx / len;
                const uy = dy / len;
                // Triangle: tip at (p.x, p.y), base ~7px back, ~6px wide.
                const back = 8;
                const wide = 5;
                const bx = p.x - ux * back;
                const by = p.y - uy * back;
                const lx = bx + uy * wide;
                const ly = by - ux * wide;
                const rx = bx - uy * wide;
                const ry = by + ux * wide;
                return (
                  <polygon
                    key={`arrow-${k}`}
                    points={`${p.x},${p.y} ${lx},${ly} ${rx},${ry}`}
                    fill={palette.ok}
                    stroke="#0a0f1e"
                    strokeWidth={0.6}
                  />
                );
              })}
              {/* Quarter-time markers — small dots with t labels */}
              {quarterTargets.map((q, k) => {
                const idx = findIdxForFrac(q.frac);
                const p = pts[idx];
                if (!p) return null;
                return (
                  <g key={`qt-${k}`}>
                    <circle
                      cx={p.x}
                      cy={p.y}
                      r={3.5}
                      fill={palette.bgPanel}
                      stroke={palette.ok}
                      strokeWidth={1.5}
                    />
                    <text
                      x={p.x + 6}
                      y={p.y - 6}
                      fontSize={9}
                      fill={palette.ok}
                      fontFamily="JetBrains Mono, monospace"
                      style={{ paintOrder: "stroke", stroke: "#0a0f1e", strokeWidth: 2 }}
                    >
                      {q.label}
                    </text>
                  </g>
                );
              })}
              {/* Start marker (t=0) */}
              <circle
                cx={startPt.x}
                cy={startPt.y}
                r={5}
                fill={palette.bgPanel}
                stroke={palette.ok}
                strokeWidth={2}
              />
              <text
                x={startPt.x + 8}
                y={startPt.y - 6}
                fontSize={10}
                fill={palette.ok}
                fontFamily="JetBrains Mono, monospace"
                style={{ paintOrder: "stroke", stroke: "#0a0f1e", strokeWidth: 2 }}
              >
                t=0
              </text>
              {/* End marker (t=T) */}
              <circle
                cx={endPt.x}
                cy={endPt.y}
                r={5}
                fill={palette.ok}
                stroke="#fff"
                strokeWidth={1.5}
              />
              <text
                x={endPt.x + 8}
                y={endPt.y + 12}
                fontSize={10}
                fill={palette.ok}
                fontFamily="JetBrains Mono, monospace"
                style={{ paintOrder: "stroke", stroke: "#0a0f1e", strokeWidth: 2 }}
              >
                t=T
              </text>
              {/* Live cursor marker */}
              {cursorPt && (
                <g>
                  <circle
                    cx={cursorPt.x}
                    cy={cursorPt.y}
                    r={10}
                    fill={palette.warn}
                    fillOpacity={0.2}
                  />
                  <circle
                    cx={cursorPt.x}
                    cy={cursorPt.y}
                    r={5}
                    fill={palette.warn}
                    stroke="#fff"
                    strokeWidth={1.5}
                  />
                </g>
              )}
            </g>
          );
        })()}

        {/* Contour lines (phase boundaries) */}
        {contourLines.map((c, i) => (
          <path
            key={`contour-${i}`}
            d={c.d}
            fill="none"
            stroke="#fff"
            strokeOpacity={0.55}
            strokeWidth={1}
            strokeDasharray="3 3"
            pointerEvents="none"
          />
        ))}

        {/* Region labels — drawn after contours so they sit on top */}
        {regionLabels.map((r, i) => (
          <g key={`region-${i}`} pointerEvents="none">
            <rect
              x={r.x - 36}
              y={r.y - 9}
              width={72}
              height={16}
              rx={3}
              fill="rgba(10,15,30,0.72)"
              stroke={r.color}
              strokeOpacity={0.5}
            />
            <text
              x={r.x}
              y={r.y + 3}
              textAnchor="middle"
              fontSize={10}
              fontWeight={700}
              fill={r.color}
              fontFamily="JetBrains Mono, monospace"
              style={{ paintOrder: "stroke", stroke: "rgba(10,15,30,0.9)", strokeWidth: 3 }}
            >
              {r.text}
            </text>
          </g>
        ))}

        {/* Frame */}
        <rect
          x={PAD_LEFT}
          y={PAD_TOP}
          width={innerW}
          height={innerH}
          fill="none"
          stroke={palette.queraPurpleSoft}
        />

        {/* Picked-point marker (★) from click-to-set */}
        {pickedPoint && (
          <g pointerEvents="none">
            <circle
              cx={oToX(pickedPoint.omega)}
              cy={dToY(pickedPoint.delta)}
              r={11}
              fill={palette.queraPurpleGlow}
              fillOpacity={0.25}
            />
            <text
              x={oToX(pickedPoint.omega)}
              y={dToY(pickedPoint.delta) + 5}
              textAnchor="middle"
              fontSize={18}
              fill={palette.queraPurpleGlow}
              style={{ paintOrder: "stroke", stroke: "#000", strokeWidth: 2 }}
            >
              ★
            </text>
          </g>
        )}

        {/* Hover marker */}
        {hover && (
          <rect
            x={hover.px - cellW / 2}
            y={hover.py - cellH / 2}
            width={cellW}
            height={cellH}
            fill="none"
            stroke={palette.queraPurpleGlow}
            strokeWidth={1.5}
          />
        )}

        {/* X-axis (Ω) ticks */}
        {oTickValues.map((o, i) => (
          <g key={`xt-${i}`}>
            <line
              x1={oToX(o)}
              y1={PAD_TOP + innerH}
              x2={oToX(o)}
              y2={PAD_TOP + innerH + 4}
              stroke={palette.textMuted}
            />
            <text
              x={oToX(o)}
              y={PAD_TOP + innerH + 16}
              textAnchor="middle"
              fontSize={10}
              fill={palette.textMuted}
              fontFamily="JetBrains Mono, monospace"
            >
              {o.toFixed(1)}
            </text>
          </g>
        ))}

        {/* Y-axis (Δ) ticks */}
        {dTickValues.map((d, i) => (
          <g key={`yt-${i}`}>
            <line
              x1={PAD_LEFT - 4}
              y1={dToY(d)}
              x2={PAD_LEFT}
              y2={dToY(d)}
              stroke={palette.textMuted}
            />
            <text
              x={PAD_LEFT - 8}
              y={dToY(d) + 3}
              textAnchor="end"
              fontSize={10}
              fill={palette.textMuted}
              fontFamily="JetBrains Mono, monospace"
            >
              {d.toFixed(0)}
            </text>
          </g>
        ))}

        {/* Axis captions */}
        <text
          x={PAD_LEFT + innerW / 2}
          y={pixelHeight - 6}
          textAnchor="middle"
          fontSize={11}
          fill={palette.textSecondary}
        >
          Ω (rad/µs)
        </text>
        <text
          x={14}
          y={PAD_TOP + innerH / 2}
          textAnchor="middle"
          fontSize={11}
          fill={palette.textSecondary}
          transform={`rotate(-90 14 ${PAD_TOP + innerH / 2})`}
        >
          Δ (rad/µs)
        </text>

        {/* Legend: vertical gradient + tick labels */}
        <g>
          {Array.from({ length: legendStops }, (_, i) => {
            const t = i / (legendStops - 1);
            const v = n_atoms * t;
            const y =
              PAD_TOP + (1 - t) * innerH - innerH / (legendStops * 2);
            return (
              <rect
                key={`lg-${i}`}
                x={legendX}
                y={y}
                width={legendW}
                height={innerH / legendStops + 1}
                fill={colorFor(v)}
              />
            );
          })}
          <text
            x={legendX + legendW + 6}
            y={PAD_TOP + 10}
            fontSize={10}
            fill={palette.textMuted}
            fontFamily="JetBrains Mono, monospace"
          >
            ⟨Σn⟩ = {n_atoms}
          </text>
          <text
            x={legendX + legendW + 6}
            y={PAD_TOP + innerH + 4}
            fontSize={10}
            fill={palette.textMuted}
            fontFamily="JetBrains Mono, monospace"
          >
            0
          </text>
          <text
            x={legendX + legendW + 6}
            y={PAD_TOP + innerH / 2 + 4}
            fontSize={10}
            fill={palette.textMuted}
            fontFamily="JetBrains Mono, monospace"
          >
            {(n_atoms / 2).toFixed(1)}
          </text>
        </g>
      </svg>

      {hover && (
        <div
          role="tooltip"
          style={{
            position: "absolute",
            left: Math.min(hover.px + 14, pixelWidth - 180),
            top: Math.max(hover.py - 36, 4),
            padding: "6px 10px",
            background: palette.bgPanel,
            border: `1px solid ${palette.queraPurpleSoft}`,
            borderRadius: 6,
            fontSize: 11,
            color: palette.textPrimary,
            fontFamily: "JetBrains Mono, monospace",
            pointerEvents: "none",
            whiteSpace: "nowrap",
          }}
        >
          Ω = {hover.o.toFixed(2)} · Δ = {hover.d.toFixed(2)} · ⟨n⟩ ={" "}
          {hover.v.toFixed(2)}
        </div>
      )}
    </div>
  );
}
