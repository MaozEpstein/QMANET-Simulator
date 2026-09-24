/**
 * |MIS(F)| as a step function of the interference radius R' — Jain et al.'s
 * canonical sweep, computed exactly at each geometric breakpoint (see
 * backend pipeline.conflict_graph.compute_interference_breakpoints) rather
 * than an arbitrary R' grid, since |MIS(F)| only changes exactly where an
 * edge of F turns on.
 *
 * Styled to match SpectrumPlot/PulsePlot: dark inset frame, queraPurple
 * palette, JetBrains Mono axis labels, tabular figures for the numbers.
 *
 * The chart only draws the step curve starting at the first breakpoint —
 * before it, F has only "shared-endpoint" edges (always present regardless
 * of R'), so |MIS(F)| there is a real but different value we don't compute;
 * showing nothing there is honest, extrapolating would not be.
 */

import { useMemo, useState } from "react";
import { palette } from "../theme/palette";
import type { InterferenceSweepPoint } from "../api/rest";

interface Props {
  points: InterferenceSweepPoint[];
  /** Current R' value (the input field) — drawn as a vertical marker. */
  currentR: number;
  /** Fired when the user clicks a step; passes that step's exact R'. */
  onPick: (r: number) => void;
  pixelWidth?: number;
  pixelHeight?: number;
}

const TABULAR_FIGURES = '"tnum" 1, "zero" 1';

/** "Nice number" axis helper — tick spacings of 1/2/5 × 10^k. Small and
 * self-contained, matching the precedent set by SpectrumPlot's own copy
 * rather than sharing one module-level helper across chart components. */
function niceNum(x: number, round: boolean) {
  if (x <= 0) return 1;
  const exp = Math.floor(Math.log10(x));
  const f = x / Math.pow(10, exp);
  let nf: number;
  if (round) nf = f < 1.5 ? 1 : f < 3 ? 2 : f < 7 ? 5 : 10;
  else nf = f <= 1 ? 1 : f <= 2 ? 2 : f <= 5 ? 5 : 10;
  return nf * Math.pow(10, exp);
}
function niceTicks(min: number, max: number, count: number) {
  if (!isFinite(min) || !isFinite(max) || max - min < 1e-9) {
    return { ticks: [min, max] };
  }
  const range = niceNum(max - min, false);
  const step = niceNum(range / Math.max(2, count), true);
  const niceMin = Math.floor(min / step) * step;
  const niceMax = Math.ceil(max / step) * step;
  const ticks: number[] = [];
  for (let v = niceMin; v <= niceMax + step / 2; v += step) {
    ticks.push(Math.round(v / step) * step);
  }
  return { ticks };
}

export function InterferenceSweepChart({
  points,
  currentR,
  onPick,
  pixelWidth = 640,
  pixelHeight = 220,
}: Props) {
  const padLeft = 44;
  const padRight = 18;
  const padTop = 16;
  const padBottom = 30;
  const innerW = pixelWidth - padLeft - padRight;
  const innerH = pixelHeight - padTop - padBottom;

  const sorted = useMemo(
    () => [...points].sort((a, b) => a.interference_radius - b.interference_radius),
    [points],
  );

  const { xMin, xMax, yMin, yMax } = useMemo(() => {
    if (sorted.length === 0) return { xMin: 0, xMax: 1, yMin: 0, yMax: 1 };
    const rMin = sorted[0].interference_radius;
    const rMax = sorted[sorted.length - 1].interference_radius;
    const rSpan = Math.max(1e-6, rMax - rMin);
    const misMax = Math.max(...sorted.map((p) => p.mis_size));
    return {
      // A touch of left margin so the first step's dot isn't clipped by the
      // axis, and a right margin so the final held plateau reads clearly.
      xMin: rMin - rSpan * 0.04,
      xMax: rMax + rSpan * 0.12,
      yMin: 0,
      yMax: Math.max(1, misMax) * 1.15,
    };
  }, [sorted]);

  const xToPx = (r: number) =>
    padLeft + (xMax > xMin ? (r - xMin) / (xMax - xMin) : 0) * innerW;
  const yToPx = (v: number) =>
    padTop + (yMax > yMin ? 1 - (v - yMin) / (yMax - yMin) : 0.5) * innerH;

  const xTicks = useMemo(() => niceTicks(xMin, xMax, 6).ticks, [xMin, xMax]);
  const yTicks = useMemo(() => niceTicks(yMin, yMax, 4).ticks, [yMin, yMax]);

  // Step-after path: hold each point's value until the next breakpoint,
  // then jump. The last value holds all the way to the right edge.
  const { linePath, areaPath } = useMemo(() => {
    if (sorted.length === 0) return { linePath: "", areaPath: "" };
    const segs: string[] = [];
    const first = sorted[0];
    segs.push(`M${xToPx(first.interference_radius).toFixed(2)},${yToPx(first.mis_size).toFixed(2)}`);
    for (let i = 1; i < sorted.length; i++) {
      const prev = sorted[i - 1];
      const cur = sorted[i];
      const xJump = xToPx(cur.interference_radius);
      segs.push(`L${xJump.toFixed(2)},${yToPx(prev.mis_size).toFixed(2)}`);
      segs.push(`L${xJump.toFixed(2)},${yToPx(cur.mis_size).toFixed(2)}`);
    }
    const last = sorted[sorted.length - 1];
    const rightEdge = xToPx(xMax);
    segs.push(`L${rightEdge.toFixed(2)},${yToPx(last.mis_size).toFixed(2)}`);
    const line = segs.join(" ");
    const area =
      `${line} L${rightEdge.toFixed(2)},${yToPx(yMin).toFixed(2)} ` +
      `L${xToPx(first.interference_radius).toFixed(2)},${yToPx(yMin).toFixed(2)} Z`;
    return { linePath: line, areaPath: area };
  }, [sorted, xMax, yMin]);

  const [hoverIdx, setHoverIdx] = useState<number | null>(null);

  const onMouseMove = (e: React.MouseEvent<SVGSVGElement>) => {
    if (sorted.length === 0) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const px = e.clientX - rect.left;
    let best = 0;
    let bestD = Infinity;
    for (let i = 0; i < sorted.length; i++) {
      const d = Math.abs(xToPx(sorted[i].interference_radius) - px);
      if (d < bestD) {
        bestD = d;
        best = i;
      }
    }
    setHoverIdx(best);
  };

  if (sorted.length === 0) {
    return (
      <div
        style={{
          padding: "14px 16px",
          borderRadius: 12,
          background: palette.bgInset,
          border: `1px solid ${palette.queraPurpleSoft}`,
          color: palette.textMuted,
          fontSize: 12,
        }}
      >
        אין מספיק קישורים לא-שכנים ברשת כדי לחשב סוויפ (צריך לפחות שני קישורים שלא חולקים
        מכשיר).
      </div>
    );
  }

  const hover = hoverIdx !== null ? sorted[hoverIdx] : null;

  return (
    <div dir="ltr" style={{ display: "inline-block", position: "relative" }}>
      <svg
        width={pixelWidth}
        height={pixelHeight}
        onMouseMove={onMouseMove}
        onMouseLeave={() => setHoverIdx(null)}
        onClick={() => hover && onPick(hover.interference_radius)}
        role="img"
        aria-label="|MIS(F)| as a function of the interference radius R'"
        style={{
          background: palette.bgInset,
          border: `1px solid ${palette.queraPurpleSoft}`,
          borderRadius: 12,
          display: "block",
          cursor: "pointer",
        }}
      >
        {/* Gridlines + y ticks */}
        {yTicks.map((v, i) => (
          <g key={`y-${i}`}>
            <line
              x1={padLeft}
              x2={pixelWidth - padRight}
              y1={yToPx(v)}
              y2={yToPx(v)}
              stroke={palette.queraPurpleSoft}
              strokeOpacity={0.25}
              strokeWidth={0.7}
            />
            <text
              x={padLeft - 8}
              y={yToPx(v) + 3}
              textAnchor="end"
              fontSize={10}
              fill={palette.textMuted}
              fontFamily="JetBrains Mono, monospace"
              style={{ fontFeatureSettings: TABULAR_FIGURES }}
            >
              {Math.round(v)}
            </text>
          </g>
        ))}
        {xTicks.map((v, i) => (
          <text
            key={`x-${i}`}
            x={xToPx(v)}
            y={pixelHeight - padBottom + 16}
            textAnchor="middle"
            fontSize={10}
            fill={palette.textMuted}
            fontFamily="JetBrains Mono, monospace"
            style={{ fontFeatureSettings: TABULAR_FIGURES }}
          >
            {Math.round(v)}
          </text>
        ))}

        {/* Axis titles */}
        <text
          x={padLeft}
          y={12}
          fontSize={10.5}
          fill={palette.textSecondary}
          fontFamily="JetBrains Mono, monospace"
        >
          |MIS(F)|
        </text>
        <text
          x={pixelWidth - padRight}
          y={pixelHeight - 4}
          textAnchor="end"
          fontSize={10.5}
          fill={palette.textSecondary}
          fontFamily="JetBrains Mono, monospace"
        >
          R' (µm)
        </text>

        {/* Area fill + step line */}
        <path d={areaPath} fill={palette.ok} fillOpacity={0.1} stroke="none" />
        <path d={linePath} fill="none" stroke={palette.ok} strokeWidth={2} />

        {/* Breakpoint dots */}
        {sorted.map((p, i) => (
          <circle
            key={i}
            cx={xToPx(p.interference_radius)}
            cy={yToPx(p.mis_size)}
            r={hoverIdx === i ? 4.5 : 3}
            fill={palette.ok}
            stroke={palette.bgInset}
            strokeWidth={1.2}
          />
        ))}

        {/* Current R' marker */}
        {currentR >= xMin && currentR <= xMax && (
          <>
            <line
              x1={xToPx(currentR)}
              x2={xToPx(currentR)}
              y1={padTop}
              y2={pixelHeight - padBottom}
              stroke={palette.queraPurpleGlow}
              strokeOpacity={0.8}
              strokeWidth={1.4}
              strokeDasharray="3 3"
            />
            <text
              x={xToPx(currentR)}
              y={padTop - 4}
              textAnchor="middle"
              fontSize={9.5}
              fill={palette.queraPurpleGlow}
              fontFamily="JetBrains Mono, monospace"
            >
              R'={currentR}
            </text>
          </>
        )}

        {/* Hover crosshair */}
        {hover && (
          <line
            x1={xToPx(hover.interference_radius)}
            x2={xToPx(hover.interference_radius)}
            y1={padTop}
            y2={pixelHeight - padBottom}
            stroke={palette.textSecondary}
            strokeOpacity={0.35}
            strokeWidth={1}
          />
        )}
      </svg>

      {hover && (
        <div
          role="tooltip"
          style={{
            position: "absolute",
            left: Math.min(xToPx(hover.interference_radius) + 10, pixelWidth - 150),
            top: 8,
            padding: "6px 9px",
            background: "rgba(15,20,38,0.94)",
            backdropFilter: "blur(6px)",
            border: `1px solid ${palette.queraPurpleSoft}`,
            borderRadius: 7,
            fontSize: 11,
            fontFamily: "JetBrains Mono, monospace",
            color: palette.textPrimary,
            pointerEvents: "none",
            boxShadow: "0 4px 16px rgba(0,0,0,0.45)",
          }}
        >
          R' = {hover.interference_radius.toFixed(2)} · |MIS(F)| = {hover.mis_size}
          <div style={{ color: palette.textMuted, fontSize: 9.5, marginTop: 2 }}>
            קליק כדי להגדיר R'
          </div>
        </div>
      )}
    </div>
  );
}
