/**
 * Publication-quality SVG line chart of the k lowest eigenvalues E_0(t)…E_{k-1}(t)
 * along the schedule.
 *
 * Aesthetic decisions:
 *  • A radial-glow plot rectangle inside a darker frame gives the chart depth
 *    without busying the data area.
 *  • E_0 is the hero — a soft area fill under the curve, a 2.6px stroke, and a
 *    barely-perceptible drop-shadow. The other levels are present but quieter
 *    (lower opacity, thinner strokes).
 *  • Levels that trace the same curve to within 0.5% of the y-range are
 *    clustered into a "degeneracy group" rendered as a single line with an
 *    inline ×N chip on its flattest segment.
 *  • The δ_min annotation moved out of the curve area entirely. It now reads
 *    as: a subtle vertical guide → a square-bracket mark "[" between E_0 and
 *    E_1 → a leader line down to a bottom-anchored callout that uses what
 *    used to be wasted space. No more in-chart pill.
 *  • A Δ(t) = E_1 − E_0 mini-strip sits under the main chart, sharing the
 *    x-axis. The avoided-crossing dip becomes the visual anchor of the whole
 *    figure — exactly what a Nature-style spectrum figure does.
 *  • Cursor is a two-layer band (wide translucent + thin opaque) with a
 *    diamond playhead — reads as "playhead" rather than "data point".
 *  • Legend shows live values at cursor (hover takes precedence) using
 *    2px colored left-rules instead of swatches. Tabular figures throughout.
 */

import { useMemo, useState } from "react";
import { palette } from "../theme/palette";
import type { SpectrumTraceDTO } from "../api/rest";

interface Props {
  trace: SpectrumTraceDTO;
  /** Optional δ_min marker (from a separate GapTrace call). */
  minGapHighlight?: { t_us: number; gap: number } | null;
  pixelWidth?: number;
  pixelHeight?: number;
  /** Live cursor (µs) shared with the PulsePlot / Stage 4 scrubber. */
  cursorT?: number;
}

interface GroupStyle {
  color: string;
  width: number;
  opacity: number;
  role: string;
}

const GROUP_STYLES: GroupStyle[] = [
  { color: palette.ok, width: 2.6, opacity: 1.0, role: "ground state · adiabatic target" },
  { color: palette.warn, width: 1.9, opacity: 0.92, role: "first excited · the obstacle" },
  { color: "#a78bfa", width: 1.5, opacity: 0.78, role: "next excited band" },
  { color: "#7cc1ff", width: 1.5, opacity: 0.7, role: "higher band" },
];
function styleForGroup(idx: number): GroupStyle {
  return GROUP_STYLES[idx] ?? GROUP_STYLES[GROUP_STYLES.length - 1];
}

const TABULAR_FIGURES = '"tnum" 1, "zero" 1';

/** "Nice number" axis helper — tick spacings of 1/2/5 × 10^k. */
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
    return { ticks: [min, max], niceMin: min, niceMax: max, step: 1 };
  }
  const range = niceNum(max - min, false);
  const step = niceNum(range / Math.max(2, count), true);
  const niceMin = Math.floor(min / step) * step;
  const niceMax = Math.ceil(max / step) * step;
  const ticks: number[] = [];
  for (let v = niceMin; v <= niceMax + step / 2; v += step) {
    ticks.push(Math.round(v / step) * step);
  }
  return { ticks, niceMin, niceMax, step };
}

/**
 * Sample index where |dE/dt| is smallest — the curve's "flattest" spot, where
 * an inline chip can sit cleanly without being squashed against a steep slope.
 */
function findFlatSample(values: number[]): number {
  if (values.length < 3) return Math.floor(values.length / 2);
  let bestI = 1;
  let bestSlope = Infinity;
  for (let i = 1; i < values.length - 1; i++) {
    const slope = Math.abs(values[i + 1] - values[i - 1]);
    if (slope < bestSlope) {
      bestSlope = slope;
      bestI = i;
    }
  }
  return bestI;
}

export function SpectrumPlot({
  trace,
  minGapHighlight,
  pixelWidth = 980,
  pixelHeight = 420,
  cursorT,
}: Props) {
  const padLeft = 64;
  const padRight = 44;
  const padTop = 44; // headroom for chart title + micro-stats
  const padBottom = 44;
  const gapStripHeight = 56;
  const gapStripGap = 12;

  // Main chart inner rect.
  const mainTop = padTop;
  const mainBottom = pixelHeight - padBottom - gapStripHeight - gapStripGap;
  const innerW = pixelWidth - padLeft - padRight;
  const innerH = mainBottom - mainTop;

  // Δ(t) strip inner rect.
  const stripTop = mainBottom + gapStripGap;
  const stripBottom = pixelHeight - padBottom;
  const stripH = stripBottom - stripTop;

  const times = trace.times;
  const nSamples = times.length;
  const nLevels = trace.n_levels;

  // y-range for the main chart.
  const rawRange = useMemo(() => {
    let yMin = Infinity;
    let yMax = -Infinity;
    for (const row of trace.eigenvalues) {
      for (const v of row) {
        if (v < yMin) yMin = v;
        if (v > yMax) yMax = v;
      }
    }
    if (!isFinite(yMin) || !isFinite(yMax) || yMax - yMin < 1e-9) {
      yMin = -1;
      yMax = 1;
    }
    return { yMin, yMax };
  }, [trace.eigenvalues]);

  const yTickInfo = useMemo(
    () => niceTicks(rawRange.yMin, rawRange.yMax, 5),
    [rawRange.yMin, rawRange.yMax],
  );
  const yMin = yTickInfo.niceMin;
  const yMax = yTickInfo.niceMax;

  const tMin = times[0] ?? 0;
  const tMax = times[nSamples - 1] ?? 1;
  const xTickInfo = useMemo(() => niceTicks(tMin, tMax, 6), [tMin, tMax]);

  const tToX = (t: number) =>
    padLeft + (tMax > tMin ? (t - tMin) / (tMax - tMin) : 0) * innerW;
  const eToY = (e: number) =>
    mainTop + (yMax > yMin ? 1 - (e - yMin) / (yMax - yMin) : 0.5) * innerH;
  const xToT = (x: number) =>
    tMax > tMin ? tMin + ((x - padLeft) / innerW) * (tMax - tMin) : 0;

  // Cluster consecutive levels into degeneracy groups.
  const groups = useMemo(() => {
    if (nSamples === 0 || nLevels === 0)
      return [] as { lvls: number[]; rep: number }[];
    const tol = 0.005 * Math.max(1e-9, yMax - yMin);
    const result: { lvls: number[]; rep: number }[] = [];
    for (let lvl = 0; lvl < nLevels; lvl++) {
      let merged = false;
      for (const g of result) {
        let maxDiff = 0;
        for (let j = 0; j < nSamples; j++) {
          const d = Math.abs(
            trace.eigenvalues[j][lvl] - trace.eigenvalues[j][g.rep],
          );
          if (d > maxDiff) {
            maxDiff = d;
            if (maxDiff >= tol) break;
          }
        }
        if (maxDiff < tol) {
          g.lvls.push(lvl);
          merged = true;
          break;
        }
      }
      if (!merged) result.push({ lvls: [lvl], rep: lvl });
    }
    return result;
  }, [trace.eigenvalues, nLevels, nSamples, yMin, yMax]);

  // One SVG path per group (use the group's rep level for the data).
  const groupPaths = useMemo(() => {
    return groups.map((g) => {
      const segs: string[] = [];
      for (let j = 0; j < nSamples; j++) {
        const x = tToX(times[j]);
        const y = eToY(trace.eigenvalues[j][g.rep]);
        segs.push(`${j === 0 ? "M" : "L"}${x.toFixed(2)},${y.toFixed(2)}`);
      }
      return segs.join(" ");
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [groups, trace.eigenvalues, nSamples, times, yMin, yMax, pixelWidth, pixelHeight]);

  // Closed area-fill path under E_0 for the hero treatment.
  const e0AreaPath = useMemo(() => {
    if (groups.length === 0 || nSamples === 0) return "";
    const g = groups[0];
    const segs: string[] = [];
    for (let j = 0; j < nSamples; j++) {
      const x = tToX(times[j]);
      const y = eToY(trace.eigenvalues[j][g.rep]);
      segs.push(`${j === 0 ? "M" : "L"}${x.toFixed(2)},${y.toFixed(2)}`);
    }
    segs.push(`L${tToX(times[nSamples - 1]).toFixed(2)},${mainBottom.toFixed(2)}`);
    segs.push(`L${tToX(times[0]).toFixed(2)},${mainBottom.toFixed(2)} Z`);
    return segs.join(" ");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [groups, trace.eigenvalues, nSamples, times, yMin, yMax, pixelWidth, pixelHeight]);

  // Hover state.
  const [hover, setHover] = useState<{ x: number; y: number; t: number } | null>(
    null,
  );
  const hoverIdx = useMemo(() => {
    if (!hover || nSamples === 0) return -1;
    let best = 0;
    let bestD = Infinity;
    for (let j = 0; j < nSamples; j++) {
      const d = Math.abs(times[j] - hover.t);
      if (d < bestD) {
        bestD = d;
        best = j;
      }
    }
    return best;
  }, [hover, times, nSamples]);

  // The "active" sample for live legend values — hover overrides cursor.
  const liveIdx = useMemo(() => {
    if (hoverIdx >= 0) return hoverIdx;
    if (cursorT === undefined || nSamples === 0) return -1;
    let best = 0;
    let bestD = Infinity;
    for (let j = 0; j < nSamples; j++) {
      const d = Math.abs(times[j] - cursorT);
      if (d < bestD) {
        bestD = d;
        best = j;
      }
    }
    return best;
  }, [hoverIdx, cursorT, times, nSamples]);

  // Gap arrow position — E_0 → E_1 at t_at_min_gap.
  const gapArrow = useMemo(() => {
    if (!minGapHighlight || nLevels < 2 || nSamples === 0) return null;
    let bestI = 0;
    let bestD = Infinity;
    for (let j = 0; j < nSamples; j++) {
      const d = Math.abs(times[j] - minGapHighlight.t_us);
      if (d < bestD) {
        bestD = d;
        bestI = j;
      }
    }
    return {
      x: tToX(minGapHighlight.t_us),
      yTop: eToY(trace.eigenvalues[bestI][1]),
      yBottom: eToY(trace.eigenvalues[bestI][0]),
      gap: minGapHighlight.gap,
      t_us: minGapHighlight.t_us,
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [minGapHighlight, trace.eigenvalues, nSamples, nLevels, yMin, yMax, pixelWidth, pixelHeight]);

  // Δ(t) = E_1 − E_0 for the strip.
  const gapSeries = useMemo(() => {
    if (groups.length < 2 || nSamples === 0)
      return { values: [] as number[], max: 1, min: 0 };
    const e0Lvl = groups[0].rep;
    const e1Lvl = groups[1].rep;
    const values: number[] = [];
    let max = -Infinity;
    let min = Infinity;
    for (let j = 0; j < nSamples; j++) {
      const v = trace.eigenvalues[j][e1Lvl] - trace.eigenvalues[j][e0Lvl];
      values.push(v);
      if (v > max) max = v;
      if (v < min) min = v;
    }
    if (!isFinite(max) || !isFinite(min)) return { values, max: 1, min: 0 };
    return { values, max, min };
  }, [groups, trace.eigenvalues, nSamples]);

  // Back-to-front: hero on top.
  const drawOrder: number[] = [];
  for (let g = groups.length - 1; g >= 0; g--) drawOrder.push(g);

  const titleStats =
    `N=${trace.n_atoms} · samples=${nSamples} · T=${(tMax - tMin).toFixed(2)} µs`;

  return (
    <div
      dir="ltr"
      style={{
        display: "flex",
        gap: 14,
        alignItems: "flex-start",
      }}
    >
      <div
        style={{
          position: "relative",
          border: `1px solid ${palette.queraPurpleSoft}`,
          borderRadius: 14,
          overflow: "hidden",
          boxShadow:
            "0 1px 0 rgba(255,255,255,0.03) inset, 0 8px 24px rgba(0,0,0,0.35)",
        }}
      >
        <svg
          width={pixelWidth}
          height={pixelHeight}
          onMouseMove={(e) => {
            const rect = (e.currentTarget as SVGSVGElement).getBoundingClientRect();
            const x = e.clientX - rect.left;
            const y = e.clientY - rect.top;
            if (
              x < padLeft ||
              x > padLeft + innerW ||
              y < mainTop ||
              y > mainBottom
            ) {
              setHover(null);
              return;
            }
            setHover({ x, y, t: xToT(x) });
          }}
          onMouseLeave={() => setHover(null)}
          style={{
            display: "block",
            background: "transparent",
            fontFeatureSettings: TABULAR_FIGURES,
          }}
        >
          <defs>
            <linearGradient id="sp-bg" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0" stopColor="#11182c" />
              <stop offset="1" stopColor="#0c1124" />
            </linearGradient>
            <radialGradient id="sp-bg-glow" cx="50%" cy="62%" r="55%">
              <stop offset="0" stopColor="#1a2547" stopOpacity="0.55" />
              <stop offset="1" stopColor="#0c1124" stopOpacity="0" />
            </radialGradient>
            <linearGradient id="sp-e0-fill" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0" stopColor={palette.ok} stopOpacity="0.22" />
              <stop offset="1" stopColor={palette.ok} stopOpacity="0" />
            </linearGradient>
            <linearGradient id="sp-strip-fill" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0" stopColor={palette.ok} stopOpacity="0.35" />
              <stop offset="1" stopColor={palette.ok} stopOpacity="0" />
            </linearGradient>
            <clipPath id="sp-clip-main">
              <rect
                x={padLeft}
                y={mainTop}
                width={innerW}
                height={innerH}
                rx={6}
              />
            </clipPath>
            <clipPath id="sp-clip-strip">
              <rect
                x={padLeft}
                y={stripTop}
                width={innerW}
                height={stripH}
                rx={4}
              />
            </clipPath>
          </defs>

          {/* Full-bleed background gradient */}
          <rect x={0} y={0} width={pixelWidth} height={pixelHeight} fill="url(#sp-bg)" />

          {/* Inner plot area highlight (radial glow) */}
          <rect
            x={padLeft}
            y={mainTop}
            width={innerW}
            height={innerH}
            fill="url(#sp-bg-glow)"
          />

          {/* Decorative plot frame */}
          <rect
            x={padLeft}
            y={mainTop}
            width={innerW}
            height={innerH}
            fill="none"
            stroke="#2a3358"
            strokeOpacity={0.55}
            rx={6}
          />

          {/* === Chart title + micro-stats === */}
          <text
            x={padLeft}
            y={20}
            fontSize={12}
            fontWeight={600}
            fill={palette.textPrimary}
            letterSpacing={0.3}
            fontFamily="Heebo, system-ui, sans-serif"
          >
            Eₙ(t) — instantaneous spectrum
          </text>
          <text
            x={pixelWidth - padRight}
            y={20}
            textAnchor="end"
            fontSize={10}
            fill={palette.textMuted}
            fontFamily="JetBrains Mono, monospace"
          >
            {titleStats}
          </text>

          {/* Y-axis caption (matplotlib labelpad style, above the plot) */}
          <text
            x={padLeft}
            y={mainTop - 10}
            fontSize={10}
            fill={palette.textMuted}
            letterSpacing={0.6}
            fontFamily="JetBrains Mono, monospace"
          >
            E (rad / µs)
          </text>

          {/* === Minor grid (4 sub-divisions between majors) === */}
          {yTickInfo.ticks.slice(0, -1).map((v, i) => {
            const minorStep = yTickInfo.step / 4;
            return Array.from({ length: 3 }, (_, k) => {
              const mv = v + (k + 1) * minorStep;
              if (mv < yMin - 1e-9 || mv > yMax + 1e-9) return null;
              const y = eToY(mv);
              return (
                <line
                  key={`mg-${i}-${k}`}
                  x1={padLeft}
                  y1={y}
                  x2={pixelWidth - padRight}
                  y2={y}
                  stroke="#2a3358"
                  strokeOpacity={0.18}
                />
              );
            });
          })}

          {/* === Major grid + y-tick labels === */}
          {yTickInfo.ticks.map((v, i) => {
            const y = eToY(v);
            return (
              <g key={`yt-${i}`}>
                <line
                  x1={padLeft}
                  y1={y}
                  x2={pixelWidth - padRight}
                  y2={y}
                  stroke="#2a3358"
                  strokeOpacity={0.45}
                />
                <text
                  x={padLeft - 6}
                  y={y + 3.2}
                  textAnchor="end"
                  fontSize={10}
                  fill={palette.textSecondary}
                  fontFamily="JetBrains Mono, monospace"
                >
                  {formatTick(v, yTickInfo.step)}
                </text>
              </g>
            );
          })}

          {/* === Zero line emphasis === */}
          {yMin <= 0 && yMax >= 0 && (
            <line
              x1={padLeft}
              y1={eToY(0)}
              x2={pixelWidth - padRight}
              y2={eToY(0)}
              stroke="#3a4878"
              strokeOpacity={0.55}
              strokeWidth={1}
            />
          )}

          {/* === Eigenvalue traces inside clip === */}
          <g clipPath="url(#sp-clip-main)">
            {/* E_0 area fill (hero) */}
            {e0AreaPath && (
              <path d={e0AreaPath} fill="url(#sp-e0-fill)" stroke="none" />
            )}
            {/* Curves back-to-front */}
            {drawOrder.map((gi) => {
              const s = styleForGroup(gi);
              const isHero = gi === 0;
              return (
                <path
                  key={`grp-${gi}`}
                  d={groupPaths[gi]}
                  fill="none"
                  stroke={s.color}
                  strokeWidth={s.width}
                  strokeOpacity={s.opacity}
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  vectorEffect="non-scaling-stroke"
                  style={
                    isHero
                      ? { filter: `drop-shadow(0 0 4px rgba(61,220,151,0.35))` }
                      : undefined
                  }
                />
              );
            })}

            {/* Cursor sync — wide band + thin line + diamond top */}
            {cursorT !== undefined &&
              nSamples > 0 &&
              cursorT >= tMin &&
              cursorT <= tMax && (
                <g pointerEvents="none">
                  <rect
                    x={tToX(cursorT) - 3}
                    y={mainTop}
                    width={6}
                    height={innerH}
                    fill={palette.warn}
                    fillOpacity={0.08}
                  />
                  <line
                    x1={tToX(cursorT)}
                    y1={mainTop}
                    x2={tToX(cursorT)}
                    y2={mainBottom}
                    stroke={palette.warn}
                    strokeOpacity={0.55}
                    strokeWidth={1}
                  />
                </g>
              )}

            {/* Hover crosshair + per-group dots */}
            {hover && hoverIdx >= 0 && (
              <g pointerEvents="none">
                <line
                  x1={tToX(times[hoverIdx])}
                  y1={mainTop}
                  x2={tToX(times[hoverIdx])}
                  y2={mainBottom}
                  stroke={palette.textSecondary}
                  strokeOpacity={0.32}
                  strokeWidth={1}
                />
                {groups.map((g, gi) => {
                  const s = styleForGroup(gi);
                  return (
                    <circle
                      key={`hov-${gi}`}
                      cx={tToX(times[hoverIdx])}
                      cy={eToY(trace.eigenvalues[hoverIdx][g.rep])}
                      r={4}
                      fill={palette.bgPanel}
                      stroke={s.color}
                      strokeWidth={2}
                    />
                  );
                })}
              </g>
            )}
          </g>

          {/* Diamond playhead at top of cursor line (outside clip so it doesn't get cropped) */}
          {cursorT !== undefined &&
            nSamples > 0 &&
            cursorT >= tMin &&
            cursorT <= tMax && (
              <g pointerEvents="none">
                <rect
                  x={-2.5}
                  y={-2.5}
                  width={5}
                  height={5}
                  fill={palette.warn}
                  stroke="#0c1124"
                  strokeWidth={1}
                  transform={`translate(${tToX(cursorT)},${mainTop}) rotate(45)`}
                />
              </g>
            )}

          {/* === δ_min annotation (bracket + leader + bottom callout) === */}
          {gapArrow && (() => {
            const isLeft = gapArrow.x < padLeft + innerW / 2;
            // Square bracket between E_0 and E_1
            const bracketX = gapArrow.x;
            const tickLen = 6;
            // Leader and callout
            const calloutText = `δ_min = ${gapArrow.gap.toFixed(2)} rad/µs`;
            const calloutSub = `at t = ${gapArrow.t_us.toFixed(2)} µs`;
            const textW = Math.max(calloutText.length, calloutSub.length) * 6.4;
            const calloutBoxW = textW + 16;
            const calloutBoxH = 30;
            const calloutY = mainBottom - calloutBoxH - 6;
            // Anchor opposite the crossing side, so the leader has room
            const calloutX = isLeft
              ? padLeft + innerW - calloutBoxW - 8
              : padLeft + 8;
            const midY = (gapArrow.yTop + gapArrow.yBottom) / 2;
            const leaderEndX = isLeft
              ? calloutX + 6
              : calloutX + calloutBoxW - 6;
            const leaderEndY = calloutY;
            return (
              <g pointerEvents="none">
                {/* Vertical guide */}
                <line
                  x1={bracketX}
                  y1={mainTop}
                  x2={bracketX}
                  y2={mainBottom}
                  stroke={palette.ok}
                  strokeOpacity={0.22}
                  strokeDasharray="2 4"
                  strokeWidth={1}
                />
                {/* Square bracket */}
                <line
                  x1={bracketX - tickLen}
                  y1={gapArrow.yTop}
                  x2={bracketX}
                  y2={gapArrow.yTop}
                  stroke={palette.ok}
                  strokeWidth={1.5}
                />
                <line
                  x1={bracketX - tickLen}
                  y1={gapArrow.yBottom}
                  x2={bracketX}
                  y2={gapArrow.yBottom}
                  stroke={palette.ok}
                  strokeWidth={1.5}
                />
                <line
                  x1={bracketX - tickLen}
                  y1={gapArrow.yTop}
                  x2={bracketX - tickLen}
                  y2={gapArrow.yBottom}
                  stroke={palette.ok}
                  strokeWidth={1.5}
                />
                {/* Leader line */}
                <line
                  x1={bracketX - tickLen}
                  y1={midY}
                  x2={leaderEndX}
                  y2={leaderEndY}
                  stroke={palette.ok}
                  strokeOpacity={0.6}
                  strokeWidth={1}
                />
                {/* Backing rect for legibility */}
                <rect
                  x={calloutX}
                  y={calloutY}
                  width={calloutBoxW}
                  height={calloutBoxH}
                  rx={4}
                  fill="rgba(15,20,38,0.55)"
                />
                {/* 2px colored left rule */}
                <rect
                  x={calloutX}
                  y={calloutY + 1}
                  width={2}
                  height={calloutBoxH - 2}
                  fill={palette.ok}
                />
                {/* Top line */}
                <text
                  x={calloutX + 10}
                  y={calloutY + 13}
                  fontSize={11.5}
                  fontWeight={700}
                  fill={palette.ok}
                  fontFamily="JetBrains Mono, monospace"
                >
                  {calloutText}
                </text>
                {/* Sub line */}
                <text
                  x={calloutX + 10}
                  y={calloutY + 25}
                  fontSize={10}
                  fill={palette.textMuted}
                  fontFamily="JetBrains Mono, monospace"
                >
                  {calloutSub}
                </text>
              </g>
            );
          })()}

          {/* === Multiplicity badges (inline on the curve, at flat spots) === */}
          {groups.map((g, gi) => {
            if (g.lvls.length < 2 || nSamples === 0) return null;
            const s = styleForGroup(gi);
            const values = trace.eigenvalues.map((row) => row[g.rep]);
            const idx = nSamples >= 8 ? findFlatSample(values) : nSamples - 1;
            const x = tToX(times[idx]);
            const y = eToY(values[idx]);
            const text = `×${g.lvls.length}`;
            return (
              <g key={`mult-${gi}`} pointerEvents="none">
                <rect
                  x={x - 11}
                  y={y - 7}
                  width={22}
                  height={14}
                  rx={7}
                  fill={palette.bgInset}
                  stroke={s.color}
                  strokeWidth={1.25}
                />
                <text
                  x={x}
                  y={y + 3.5}
                  textAnchor="middle"
                  fontSize={9.5}
                  fontWeight={700}
                  fill={s.color}
                  fontFamily="JetBrains Mono, monospace"
                >
                  {text}
                </text>
              </g>
            );
          })}

          {/* === Δ(t) mini-strip === */}
          <GapStripe
            tMin={tMin}
            tMax={tMax}
            tToX={tToX}
            stripTop={stripTop}
            stripH={stripH}
            padLeft={padLeft}
            innerW={innerW}
            gapSeries={gapSeries}
            minGapHighlight={minGapHighlight}
          />

          {/* === Shared x-axis (under the strip) === */}
          {xTickInfo.ticks.map((t, i) => {
            if (t < tMin - 1e-9 || t > tMax + 1e-9) return null;
            const x = tToX(t);
            return (
              <g key={`xt-${i}`}>
                <line
                  x1={x}
                  y1={stripBottom}
                  x2={x}
                  y2={stripBottom + 3}
                  stroke={palette.textMuted}
                  strokeOpacity={0.4}
                />
                <text
                  x={x}
                  y={stripBottom + 14}
                  textAnchor="middle"
                  fontSize={10}
                  fill={palette.textSecondary}
                  fontFamily="JetBrains Mono, monospace"
                >
                  {t.toFixed(2)}
                </text>
              </g>
            );
          })}
          <text
            x={padLeft + innerW / 2}
            y={pixelHeight - 6}
            textAnchor="middle"
            fontSize={10.5}
            fill={palette.textMuted}
            letterSpacing={0.5}
            fontFamily="JetBrains Mono, monospace"
          >
            T (µs)
          </text>
        </svg>

        {/* Hover tooltip */}
        {hover && hoverIdx >= 0 && (
          <div
            role="tooltip"
            style={{
              position: "absolute",
              left: Math.min(hover.x + 14, pixelWidth - 240),
              top: Math.max(8, Math.min(hover.y + 10, pixelHeight - 160)),
              padding: "10px 12px",
              background:
                "linear-gradient(180deg, rgba(18,24,46,0.96), rgba(13,18,36,0.96))",
              backdropFilter: "blur(8px) saturate(140%)",
              border: "1px solid rgba(122,140,200,0.22)",
              borderRadius: 10,
              fontSize: 10.5,
              fontFamily: "JetBrains Mono, monospace",
              color: palette.textPrimary,
              pointerEvents: "none",
              boxShadow:
                "0 6px 22px rgba(0,0,0,0.55), 0 0 0 1px rgba(255,255,255,0.02) inset",
              minWidth: 200,
              fontFeatureSettings: TABULAR_FIGURES,
            }}
          >
            <div
              style={{
                display: "flex",
                justifyContent: "space-between",
                color: palette.textMuted,
                fontSize: 10,
                paddingBottom: 5,
                marginBottom: 5,
                boxShadow: "inset 0 -1px 0 rgba(122,140,200,0.18)",
              }}
            >
              <span>t = {times[hoverIdx].toFixed(3)} µs</span>
              <span>
                j = {hoverIdx + 1}/{nSamples}
              </span>
            </div>
            {groups.map((g, gi) => {
              const s = styleForGroup(gi);
              const v = trace.eigenvalues[hoverIdx][g.rep];
              const labelLevels = g.lvls.map((l) => `E_${l}`).join(", ");
              return (
                <div
                  key={`tt-${gi}`}
                  style={{
                    display: "flex",
                    justifyContent: "space-between",
                    paddingInlineStart: 8,
                    borderInlineStart: `2px solid ${s.color}`,
                    marginBlock: 2,
                  }}
                >
                  <span style={{ color: s.color, fontWeight: 600 }}>
                    {labelLevels}
                    {g.lvls.length > 1 ? ` ×${g.lvls.length}` : ""}
                  </span>
                  <span style={{ color: palette.textPrimary }}>{v.toFixed(2)}</span>
                </div>
              );
            })}
            {groups.length >= 2 && (
              <div
                style={{
                  marginTop: 6,
                  paddingTop: 5,
                  display: "flex",
                  justifyContent: "space-between",
                  color: palette.warn,
                  fontWeight: 700,
                  boxShadow: "inset 0 1px 0 rgba(122,140,200,0.18)",
                }}
              >
                <span>↑ Δ = E₁ − E₀</span>
                <span>
                  {(
                    trace.eigenvalues[hoverIdx][groups[1].rep] -
                    trace.eigenvalues[hoverIdx][groups[0].rep]
                  ).toFixed(2)}
                </span>
              </div>
            )}
          </div>
        )}
      </div>

      {/* === External legend === */}
      <div
        style={{
          display: "flex",
          flexDirection: "column",
          gap: 10,
          padding: "12px 14px",
          background:
            "linear-gradient(180deg, #11182c, #0d1325)",
          border: `1px solid ${palette.queraPurpleSoft}`,
          borderRadius: 12,
          minWidth: 168,
          maxWidth: 200,
          fontFeatureSettings: TABULAR_FIGURES,
        }}
      >
        <div
          style={{
            fontSize: 9.5,
            color: palette.textMuted,
            fontFamily: "JetBrains Mono, monospace",
            textTransform: "uppercase",
            letterSpacing: 0.8,
            paddingBottom: 6,
            boxShadow: "inset 0 -1px 0 rgba(122,140,200,0.18)",
          }}
        >
          Eₙ at cursor
        </div>
        {groups.map((g, gi) => {
          const s = styleForGroup(gi);
          const isHero = gi === 0;
          const isDegen = g.lvls.length > 1;
          const labelLevels = g.lvls.map((l) => `E_${l}`).join(", ");
          const liveV =
            liveIdx >= 0 ? trace.eigenvalues[liveIdx][g.rep] : null;
          return (
            <div
              key={`lg-${gi}`}
              style={{
                display: "flex",
                flexDirection: "column",
                gap: 2,
                paddingInlineStart: 10,
                borderInlineStart: `2px solid ${s.color}`,
              }}
            >
              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 6,
                }}
              >
                <span
                  style={{
                    fontFamily: "JetBrains Mono, monospace",
                    fontSize: 11.5,
                    color: s.color,
                    fontWeight: isHero ? 700 : 500,
                  }}
                >
                  {labelLevels}
                </span>
                {isDegen && (
                  <span
                    style={{
                      marginInlineStart: "auto",
                      padding: "1px 6px",
                      borderRadius: 6,
                      background: s.color,
                      color: "#0a0f1e",
                      fontSize: 9.5,
                      fontWeight: 700,
                      fontFamily: "JetBrains Mono, monospace",
                    }}
                  >
                    ×{g.lvls.length}
                  </span>
                )}
              </div>
              <div
                style={{
                  fontSize: 11,
                  fontFamily: "JetBrains Mono, monospace",
                  color: liveV != null ? palette.textPrimary : palette.textMuted,
                  textAlign: "end",
                }}
              >
                {liveV != null ? liveV.toFixed(2) : "—"}
              </div>
              <div
                style={{
                  fontSize: 9.5,
                  color: palette.textMuted,
                  lineHeight: 1.35,
                }}
              >
                {isDegen ? "degenerate · same energy" : s.role}
              </div>
            </div>
          );
        })}
        {minGapHighlight && (
          <div
            style={{
              marginTop: 4,
              paddingTop: 8,
              paddingInlineStart: 10,
              borderInlineStart: `2px solid ${palette.ok}`,
              boxShadow: "inset 0 1px 0 rgba(122,140,200,0.18)",
              fontFamily: "JetBrains Mono, monospace",
            }}
            dir="ltr"
          >
            <div
              style={{
                fontSize: 11.5,
                fontWeight: 700,
                color: palette.ok,
              }}
            >
              δ_min = {minGapHighlight.gap.toFixed(2)}
            </div>
            <div style={{ fontSize: 10, color: palette.textMuted, marginTop: 2 }}>
              at t = {minGapHighlight.t_us.toFixed(2)} µs
            </div>
          </div>
        )}
        {cursorT !== undefined && (
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: 6,
              fontSize: 10,
              color: palette.warn,
              fontFamily: "JetBrains Mono, monospace",
            }}
            dir="ltr"
          >
            <span
              style={{
                width: 6,
                height: 6,
                background: palette.warn,
                transform: "rotate(45deg)",
                display: "inline-block",
              }}
            />
            t = {cursorT.toFixed(2)} µs
          </div>
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Δ(t) mini-strip — local component
// ---------------------------------------------------------------------------

function GapStripe({
  tMin,
  tMax,
  tToX,
  stripTop,
  stripH,
  padLeft,
  innerW,
  gapSeries,
  minGapHighlight,
}: {
  tMin: number;
  tMax: number;
  tToX: (t: number) => number;
  stripTop: number;
  stripH: number;
  padLeft: number;
  innerW: number;
  gapSeries: { values: number[]; max: number; min: number };
  minGapHighlight: { t_us: number; gap: number } | null | undefined;
}) {
  const { values, max } = gapSeries;
  const nSamples = values.length;

  if (nSamples < 2) return null;

  // Strip uses [0, max] — Δ is always ≥ 0 (E_1 ≥ E_0 by definition).
  const yMaxLocal = Math.max(max * 1.05, 1e-9);
  const valueToY = (v: number) =>
    stripTop + (1 - Math.max(0, v) / yMaxLocal) * stripH;

  // Build paths: area fill + top-edge stroke.
  const stripBottom = stripTop + stripH;
  const dtStep = (tMax - tMin) / Math.max(1, nSamples - 1);
  const linePts: string[] = [];
  const fillPts: string[] = [];
  for (let j = 0; j < nSamples; j++) {
    const t = tMin + j * dtStep;
    const x = tToX(t);
    const y = valueToY(values[j]);
    linePts.push(`${j === 0 ? "M" : "L"}${x.toFixed(2)},${y.toFixed(2)}`);
    fillPts.push(`${j === 0 ? "M" : "L"}${x.toFixed(2)},${y.toFixed(2)}`);
  }
  fillPts.push(`L${tToX(tMax).toFixed(2)},${stripBottom.toFixed(2)}`);
  fillPts.push(`L${tToX(tMin).toFixed(2)},${stripBottom.toFixed(2)} Z`);

  return (
    <g>
      {/* Strip frame */}
      <rect
        x={padLeft}
        y={stripTop}
        width={innerW}
        height={stripH}
        fill="url(#sp-bg-glow)"
      />
      <rect
        x={padLeft}
        y={stripTop}
        width={innerW}
        height={stripH}
        fill="none"
        stroke="#2a3358"
        strokeOpacity={0.4}
        rx={4}
      />

      <g clipPath="url(#sp-clip-strip)">
        <path d={fillPts.join(" ")} fill="url(#sp-strip-fill)" />
        <path
          d={linePts.join(" ")}
          fill="none"
          stroke={palette.ok}
          strokeWidth={1.4}
          strokeLinecap="round"
          strokeLinejoin="round"
        />
        {/* δ_min horizontal floor */}
        {minGapHighlight && (
          <line
            x1={padLeft}
            y1={valueToY(minGapHighlight.gap)}
            x2={padLeft + innerW}
            y2={valueToY(minGapHighlight.gap)}
            stroke={palette.ok}
            strokeOpacity={0.5}
            strokeDasharray="1 3"
          />
        )}
        {/* δ_min point marker */}
        {minGapHighlight && (
          <circle
            cx={tToX(minGapHighlight.t_us)}
            cy={valueToY(minGapHighlight.gap)}
            r={3.5}
            fill={palette.ok}
            stroke="#0c1124"
            strokeWidth={1}
          />
        )}
      </g>

      {/* Strip label */}
      <text
        x={padLeft + innerW - 4}
        y={stripTop + 12}
        textAnchor="end"
        fontSize={9.5}
        fill={palette.textMuted}
        fontFamily="JetBrains Mono, monospace"
        letterSpacing={0.4}
      >
        Δ(t) = E₁ − E₀
      </text>
    </g>
  );
}

/**
 * Tick number formatter — uses minimal precision based on the tick step so we
 * don't show "100" as "100.00" but a step of 0.5 gets ".5"-precision values.
 */
function formatTick(v: number, step: number): string {
  if (step >= 10) return Math.round(v).toString();
  if (step >= 1) return v.toFixed(0);
  if (step >= 0.1) return v.toFixed(1);
  return v.toFixed(2);
}
