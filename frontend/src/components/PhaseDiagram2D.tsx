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

interface Props {
  diagram: PhaseDiagramDTO;
  pixelWidth?: number;
  pixelHeight?: number;
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
                    onMouseEnter={() =>
                      setHover({ o, d, v, px: x + cellW / 2, py: y + cellH / 2 })
                    }
                  />
                );
              })}
            </g>
          );
        })}

        {/* Frame */}
        <rect
          x={PAD_LEFT}
          y={PAD_TOP}
          width={innerW}
          height={innerH}
          fill="none"
          stroke={palette.queraPurpleSoft}
        />

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
