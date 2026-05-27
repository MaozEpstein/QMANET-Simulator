/**
 * Live trajectory plot: ⟨n̂_i(t)⟩ for each atom, drawn as the simulation streams.
 *
 * Re-renders cheaply: SVG path strings built from the populations matrix.
 * The vertical cursor follows the current frame index for "scrubbing".
 */

import { palette } from "../theme/palette";
import type { SimulationFrameDTO } from "../api/rest";

export interface OverlaySeries {
  label: string;
  values: (number | null | undefined)[];
  color?: string;
  /** Optional explicit y-range for the secondary axis. Defaults to data extent. */
  yDomain?: [number, number];
  /** Formatter for the legend value. Defaults to `v.toFixed(3)`. */
  format?: (v: number) => string;
}

export interface Milestone {
  frameIndex: number;
  label: string;
  color?: string;
}

interface Props {
  frames: SimulationFrameDTO[];
  totalDurationUs: number;
  currentFrameIndex?: number;
  onScrub?: (index: number) => void;
  pixelWidth?: number;
  pixelHeight?: number;
  overlay?: OverlaySeries | null;
  milestones?: Milestone[];
}

export function EvolutionPlot({
  frames,
  totalDurationUs,
  currentFrameIndex,
  onScrub,
  pixelWidth = 700,
  pixelHeight = 260,
  overlay = null,
  milestones = [],
}: Props) {
  const padLeft = 50;
  const padRight = overlay ? 56 : 18;
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

  // Overlay: secondary y-axis on the right
  let overlayPath = "";
  let overlayDomain: [number, number] = [0, 1];
  let overlayValueAtCursor: number | null = null;
  if (overlay && overlay.values.length > 0) {
    const numeric = overlay.values
      .map((v) => (typeof v === "number" && Number.isFinite(v) ? v : null))
      .filter((v): v is number => v !== null);
    if (numeric.length > 0) {
      let lo = Math.min(...numeric);
      let hi = Math.max(...numeric);
      if (overlay.yDomain) {
        [lo, hi] = overlay.yDomain;
      } else if (lo === hi) {
        lo -= 0.5;
        hi += 0.5;
      } else {
        const pad = (hi - lo) * 0.08;
        lo -= pad;
        hi += pad;
      }
      overlayDomain = [lo, hi];
      const vToY = (v: number) =>
        padTop + (1 - (v - lo) / (hi - lo)) * innerH;
      const segs: string[] = [];
      let started = false;
      for (let j = 0; j < frames.length; j++) {
        const v = overlay.values[j];
        if (typeof v !== "number" || !Number.isFinite(v)) {
          started = false;
          continue;
        }
        const x = tToX(frames[j].t_us);
        const y = vToY(v);
        segs.push(`${started ? "L" : "M"}${x.toFixed(2)},${y.toFixed(2)}`);
        started = true;
      }
      overlayPath = segs.join(" ");
      if (currentFrameIndex !== undefined) {
        const v = overlay.values[currentFrameIndex];
        if (typeof v === "number" && Number.isFinite(v)) overlayValueAtCursor = v;
      }
    }
  }
  const overlayColor = overlay?.color ?? "#ffb84d";

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

        {/* Overlay series (secondary y-axis on right) */}
        {overlayPath && (
          <>
            <path
              d={overlayPath}
              fill="none"
              stroke={overlayColor}
              strokeWidth={1.8}
              strokeOpacity={0.95}
              strokeDasharray="6 3"
              data-testid="evolution-overlay-path"
            />
            {[0, 0.5, 1].map((frac) => {
              const v = overlayDomain[0] + frac * (overlayDomain[1] - overlayDomain[0]);
              const y = padTop + (1 - frac) * innerH;
              return (
                <text
                  key={`oy-${frac}`}
                  x={padLeft + innerW + 6}
                  y={y + 3}
                  fontSize={10}
                  fill={overlayColor}
                  fontFamily="JetBrains Mono"
                  textAnchor="start"
                >
                  {(overlay?.format ?? ((x: number) => x.toFixed(2)))(v)}
                </text>
              );
            })}
            <text
              x={pixelWidth - 4}
              y={padTop + 10}
              fontSize={11}
              fill={overlayColor}
              fontFamily="JetBrains Mono"
              textAnchor="end"
              data-testid="evolution-overlay-label"
            >
              {overlay?.label}
              {overlayValueAtCursor !== null
                ? ` = ${(overlay?.format ?? ((x: number) => x.toFixed(3)))(overlayValueAtCursor)}`
                : ""}
            </text>
          </>
        )}

        {/* Milestones along the time axis */}
        {milestones.map((m, mi) => {
          const f = frames[m.frameIndex];
          if (!f) return null;
          const x = tToX(f.t_us);
          const y = padTop + innerH;
          const c = m.color ?? palette.err;
          return (
            <g key={`ms-${mi}`} data-testid="evolution-milestone">
              <title>{m.label}</title>
              <line
                x1={x}
                x2={x}
                y1={padTop}
                y2={y}
                stroke={c}
                strokeOpacity={0.35}
                strokeWidth={1}
                strokeDasharray="2 4"
              />
              <polygon
                points={`${x - 5},${y + 1} ${x + 5},${y + 1} ${x},${y - 6}`}
                fill={c}
                opacity={0.95}
              />
            </g>
          );
        })}

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
