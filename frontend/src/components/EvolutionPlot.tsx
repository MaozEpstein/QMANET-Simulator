/**
 * Live trajectory plot: ⟨n̂_i(t)⟩ for each atom, drawn as the simulation streams.
 *
 * Re-renders cheaply: SVG path strings built from the populations matrix.
 * The vertical cursor follows the current frame index for "scrubbing".
 */

import { palette } from "../theme/palette";
import type { SimulationFrameDTO } from "../api/rest";

interface Props {
  frames: SimulationFrameDTO[];
  totalDurationUs: number;
  currentFrameIndex?: number;
  onScrub?: (index: number) => void;
  pixelWidth?: number;
  pixelHeight?: number;
}

export function EvolutionPlot({
  frames,
  totalDurationUs,
  currentFrameIndex,
  onScrub,
  pixelWidth = 700,
  pixelHeight = 260,
}: Props) {
  const padLeft = 50;
  const padRight = 18;
  const padTop = 14;
  const padBottom = 26;
  const innerW = pixelWidth - padLeft - padRight;
  const innerH = pixelHeight - padTop - padBottom;

  const tToX = (t: number) => padLeft + (totalDurationUs > 0 ? t / totalDurationUs : 0) * innerW;
  const popToY = (p: number) => padTop + (1 - p) * innerH;

  const nAtoms = frames[0]?.rydberg_populations.length ?? 0;

  // Build one SVG path per atom
  const paths: string[] = [];
  for (let i = 0; i < nAtoms; i++) {
    const segments: string[] = [];
    for (let j = 0; j < frames.length; j++) {
      const x = tToX(frames[j].t_us);
      const y = popToY(frames[j].rydberg_populations[i]);
      segments.push(`${j === 0 ? "M" : "L"}${x.toFixed(2)},${y.toFixed(2)}`);
    }
    paths.push(segments.join(" "));
  }

  // 6-color palette cycling through atoms
  const atomColors = palette.plot;

  const handleMove = (e: React.MouseEvent<SVGSVGElement>) => {
    if (!onScrub || frames.length === 0) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const t = totalDurationUs > 0 ? ((x - padLeft) / innerW) * totalDurationUs : 0;
    // Map to nearest frame index
    let best = 0;
    let bestErr = Infinity;
    for (let i = 0; i < frames.length; i++) {
      const e = Math.abs(frames[i].t_us - t);
      if (e < bestErr) {
        bestErr = e;
        best = i;
      }
    }
    onScrub(best);
  };

  return (
    <div dir="ltr" style={{ display: "inline-block" }}>
      <svg
        width={pixelWidth}
        height={pixelHeight}
        role="img"
        aria-label="Evolution of Rydberg populations"
        onMouseMove={handleMove}
        style={{
          background: palette.bgInset,
          border: `1px solid ${palette.queraPurpleSoft}`,
          borderRadius: 12,
          display: "block",
          cursor: onScrub ? "ew-resize" : "default",
        }}
      >
        {/* y-axis labels */}
        {[0, 0.25, 0.5, 0.75, 1].map((v) => (
          <g key={`y-${v}`}>
            <line
              x1={padLeft}
              x2={padLeft + innerW}
              y1={popToY(v)}
              y2={popToY(v)}
              stroke={palette.queraPurpleSoft}
              strokeOpacity={0.3}
              strokeWidth={0.6}
            />
            <text
              x={padLeft - 6}
              y={popToY(v) + 3}
              fontSize={10}
              fill={palette.textMuted}
              fontFamily="JetBrains Mono"
              textAnchor="end"
            >
              {v.toFixed(2)}
            </text>
          </g>
        ))}

        {/* y-axis label */}
        <text
          x={10}
          y={padTop + innerH / 2}
          fontSize={11}
          fill={palette.textSecondary}
          fontFamily="JetBrains Mono"
        >
          ⟨n̂_i⟩
        </text>

        {/* Trajectory paths */}
        {paths.map((d, i) => (
          <path
            key={`path-${i}`}
            d={d}
            fill="none"
            stroke={atomColors[i % atomColors.length]}
            strokeWidth={1.4}
            strokeOpacity={0.95}
          />
        ))}

        {/* Frame markers along x-axis */}
        <line
          x1={padLeft}
          x2={padLeft + innerW}
          y1={padTop + innerH}
          y2={padTop + innerH}
          stroke={palette.textMuted}
          strokeOpacity={0.35}
          strokeWidth={0.7}
        />
        <text
          x={padLeft}
          y={pixelHeight - 6}
          fontSize={10}
          fill={palette.textMuted}
          fontFamily="JetBrains Mono"
        >
          0
        </text>
        <text
          x={padLeft + innerW - 30}
          y={pixelHeight - 6}
          fontSize={10}
          fill={palette.textMuted}
          fontFamily="JetBrains Mono"
        >
          {totalDurationUs.toFixed(2)} µs
        </text>

        {/* Cursor */}
        {currentFrameIndex !== undefined && frames[currentFrameIndex] && (
          <line
            x1={tToX(frames[currentFrameIndex].t_us)}
            x2={tToX(frames[currentFrameIndex].t_us)}
            y1={padTop}
            y2={padTop + innerH}
            stroke={palette.queraPurpleGlow}
            strokeOpacity={0.8}
            strokeWidth={1.2}
            strokeDasharray="3 3"
          />
        )}
      </svg>
    </div>
  );
}
