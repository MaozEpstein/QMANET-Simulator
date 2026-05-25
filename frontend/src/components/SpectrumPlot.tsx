/**
 * SVG line chart of the k lowest eigenvalues E_0(t)…E_{k-1}(t) along the
 * schedule. The minimum gap point (where δ_min lives) is marked with a
 * green ✦, so the user can SEE the avoided crossing that controls
 * adiabaticity.
 *
 * Style mirrors EvolutionPlot — pure SVG, palette.plot colours, no chart lib.
 */

import { palette } from "../theme/palette";
import type { SpectrumTraceDTO } from "../api/rest";

interface Props {
  trace: SpectrumTraceDTO;
  /** Optional δ_min marker (from a separate GapTrace call). */
  minGapHighlight?: { t_us: number; gap: number } | null;
  pixelWidth?: number;
  pixelHeight?: number;
}

export function SpectrumPlot({
  trace,
  minGapHighlight,
  pixelWidth = 700,
  pixelHeight = 300,
}: Props) {
  const padLeft = 56;
  const padRight = 18;
  const padTop = 16;
  const padBottom = 30;
  const innerW = pixelWidth - padLeft - padRight;
  const innerH = pixelHeight - padTop - padBottom;

  const times = trace.times;
  const nSamples = times.length;
  const nLevels = trace.n_levels;

  // y-range: tight around all eigenvalues seen
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
  const yPad = (yMax - yMin) * 0.08;
  yMin -= yPad;
  yMax += yPad;

  const tMin = times[0] ?? 0;
  const tMax = times[nSamples - 1] ?? 1;
  const tToX = (t: number) =>
    padLeft + (tMax > tMin ? (t - tMin) / (tMax - tMin) : 0) * innerW;
  const eToY = (e: number) =>
    padTop + (yMax > yMin ? 1 - (e - yMin) / (yMax - yMin) : 0.5) * innerH;

  // Build one SVG path per level
  const paths: string[] = [];
  for (let lvl = 0; lvl < nLevels; lvl++) {
    const segs: string[] = [];
    for (let j = 0; j < nSamples; j++) {
      const x = tToX(times[j]);
      const y = eToY(trace.eigenvalues[j][lvl]);
      segs.push(`${j === 0 ? "M" : "L"}${x.toFixed(2)},${y.toFixed(2)}`);
    }
    paths.push(segs.join(" "));
  }

  const levelColors = palette.plot;

  // Axis tick values
  const xTicks = 5;
  const yTicks = 4;
  const xTickValues = Array.from({ length: xTicks + 1 }, (_, i) =>
    tMin + ((tMax - tMin) * i) / xTicks,
  );
  const yTickValues = Array.from({ length: yTicks + 1 }, (_, i) =>
    yMin + ((yMax - yMin) * i) / yTicks,
  );

  return (
    <div dir="ltr" style={{ display: "inline-block" }}>
      <svg
        width={pixelWidth}
        height={pixelHeight}
        style={{
          background: palette.bgInset,
          border: `1px solid ${palette.queraPurpleSoft}`,
          borderRadius: 12,
          display: "block",
        }}
      >
        {/* y-axis gridlines + labels */}
        {yTickValues.map((v, i) => {
          const y = eToY(v);
          return (
            <g key={`yt-${i}`}>
              <line
                x1={padLeft}
                y1={y}
                x2={pixelWidth - padRight}
                y2={y}
                stroke={palette.queraPurpleSoft}
                strokeOpacity={0.3}
                strokeDasharray="2 3"
              />
              <text
                x={padLeft - 6}
                y={y + 3}
                textAnchor="end"
                fontSize={10}
                fill={palette.textMuted}
                fontFamily="JetBrains Mono, monospace"
              >
                {v.toFixed(0)}
              </text>
            </g>
          );
        })}

        {/* x-axis tick labels */}
        {xTickValues.map((t, i) => (
          <text
            key={`xt-${i}`}
            x={tToX(t)}
            y={pixelHeight - padBottom + 14}
            textAnchor="middle"
            fontSize={10}
            fill={palette.textMuted}
            fontFamily="JetBrains Mono, monospace"
          >
            {t.toFixed(2)}
          </text>
        ))}

        {/* axes captions */}
        <text
          x={pixelWidth / 2}
          y={pixelHeight - 4}
          textAnchor="middle"
          fontSize={11}
          fill={palette.textSecondary}
        >
          t (µs)
        </text>
        <text
          x={12}
          y={padTop + innerH / 2}
          textAnchor="middle"
          fontSize={11}
          fill={palette.textSecondary}
          transform={`rotate(-90 12 ${padTop + innerH / 2})`}
        >
          E (rad/µs)
        </text>

        {/* eigenvalue traces */}
        {paths.map((d, i) => (
          <path
            key={`p-${i}`}
            d={d}
            fill="none"
            stroke={levelColors[i % levelColors.length]}
            strokeWidth={2}
            strokeOpacity={0.95}
          />
        ))}

        {/* δ_min marker */}
        {minGapHighlight && times.length > 0 && (
          <g>
            <line
              x1={tToX(minGapHighlight.t_us)}
              y1={padTop}
              x2={tToX(minGapHighlight.t_us)}
              y2={pixelHeight - padBottom}
              stroke={palette.ok}
              strokeOpacity={0.7}
              strokeDasharray="4 4"
              strokeWidth={1.4}
            />
            <text
              x={tToX(minGapHighlight.t_us) + 6}
              y={padTop + 12}
              fontSize={11}
              fontFamily="JetBrains Mono, monospace"
              fill={palette.ok}
            >
              ✦ δ_min = {minGapHighlight.gap.toFixed(2)}
            </text>
          </g>
        )}

        {/* legend strip — top-right corner */}
        <g transform={`translate(${pixelWidth - padRight - 90} ${padTop})`}>
          {Array.from({ length: nLevels }, (_, i) => (
            <g key={`lg-${i}`} transform={`translate(0 ${i * 14})`}>
              <rect
                width={12}
                height={3}
                y={5}
                fill={levelColors[i % levelColors.length]}
              />
              <text
                x={18}
                y={10}
                fontSize={10}
                fill={palette.textSecondary}
                fontFamily="JetBrains Mono, monospace"
              >
                E_{i}
              </text>
            </g>
          ))}
        </g>
      </svg>
    </div>
  );
}
