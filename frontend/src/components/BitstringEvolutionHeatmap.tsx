/**
 * Bitstring × time × probability heatmap.
 *
 * Visualises how the wavefunction concentrates onto the MIS solution as the
 * adiabatic sweep progresses. Rows = top-K bitstrings (already pre-sorted by
 * final probability descending, as the backend emits them). Columns = frames.
 * Cell colour = inferno ramp on probability ∈ [0, 1].
 *
 * Valid MIS bitstrings get a small green tick on the left margin. Vertical
 * cursor mirrors the same `currentFrameIndex` used by the other Stage 5 plots,
 * so scrubbing one plot moves all of them in lock-step.
 */

import { useMemo } from "react";
import { palette } from "../theme/palette";
import { infernoColor } from "../theme/colormap";
import { bitstringIsIndependent, type Edge } from "../lib/misMetrics";

interface Props {
  trackedBitstrings: Record<string, number[]>;
  totalDurationUs: number;
  inducedEdges: readonly Edge[];
  targetMisSize: number | null;
  currentFrameIndex?: number;
  onScrub?: (frameIndex: number) => void;
  pixelWidth?: number;
  rowHeight?: number;
}

export function BitstringEvolutionHeatmap({
  trackedBitstrings,
  totalDurationUs,
  inducedEdges,
  targetMisSize,
  currentFrameIndex,
  onScrub,
  pixelWidth = 820,
  rowHeight = 22,
}: Props) {
  const entries = useMemo(
    () => Object.entries(trackedBitstrings),
    [trackedBitstrings],
  );

  if (entries.length === 0) return null;

  const nFrames = entries[0][1].length;
  const nRows = entries.length;
  const padLeft = 110;
  const padRight = 16;
  const padTop = 18;
  const padBottom = 26;
  const innerW = pixelWidth - padLeft - padRight;
  const innerH = rowHeight * nRows;
  const totalH = padTop + innerH + padBottom;

  const cellW = innerW / Math.max(1, nFrames - 1);

  // Frame index → x. We center cells on the frame time, so column j spans
  // [j-0.5, j+0.5] · cellW relative to padLeft. Rendering as rects.
  const xFor = (j: number) => padLeft + j * cellW - cellW / 2;

  const handleMove = (e: React.MouseEvent<SVGSVGElement>) => {
    if (!onScrub) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const x = e.clientX - rect.left - padLeft;
    if (nFrames <= 1) return;
    const j = Math.round((x / innerW) * (nFrames - 1));
    onScrub(Math.max(0, Math.min(nFrames - 1, j)));
  };

  return (
    <div dir="ltr" style={{ display: "inline-block" }}>
      <svg
        width={pixelWidth}
        height={totalH}
        role="img"
        aria-label="Bitstring probability evolution heatmap"
        onMouseMove={handleMove}
        style={{
          background: palette.bgInset,
          border: `1px solid ${palette.queraPurpleSoft}`,
          borderRadius: 12,
          display: "block",
          cursor: onScrub ? "ew-resize" : "default",
        }}
      >
        {entries.map(([label, series], rowIdx) => {
          const isMis =
            targetMisSize !== null &&
            targetMisSize > 0 &&
            bitstringIsIndependent(label, inducedEdges) &&
            countOnes(label) === targetMisSize;
          const indep = bitstringIsIndependent(label, inducedEdges);
          const y = padTop + rowIdx * rowHeight;
          return (
            <g key={label}>
              {/* Row label */}
              <text
                x={padLeft - 8}
                y={y + rowHeight / 2 + 4}
                fontSize={11}
                fontFamily="JetBrains Mono"
                fill={
                  isMis
                    ? palette.ok
                    : indep
                      ? palette.textPrimary
                      : palette.textMuted
                }
                textAnchor="end"
              >
                {isMis ? "✓ " : ""}|{label}⟩
              </text>
              {/* Heat cells */}
              {series.map((p, j) => (
                <rect
                  key={j}
                  x={xFor(j)}
                  y={y}
                  width={cellW + 0.5}
                  height={rowHeight - 1}
                  fill={infernoColor(p)}
                  opacity={0.95}
                />
              ))}
            </g>
          );
        })}

        {/* Cursor */}
        {currentFrameIndex !== undefined && nFrames > 0 && (
          <line
            x1={padLeft + currentFrameIndex * cellW}
            x2={padLeft + currentFrameIndex * cellW}
            y1={padTop}
            y2={padTop + innerH}
            stroke={palette.queraPurpleGlow}
            strokeOpacity={0.95}
            strokeWidth={1.4}
            strokeDasharray="3 3"
          />
        )}

        {/* X axis */}
        <line
          x1={padLeft}
          x2={padLeft + innerW}
          y1={padTop + innerH}
          y2={padTop + innerH}
          stroke={palette.textMuted}
          strokeOpacity={0.4}
          strokeWidth={0.7}
        />
        <text
          x={padLeft}
          y={padTop + innerH + 14}
          fontSize={10}
          fill={palette.textMuted}
          fontFamily="JetBrains Mono"
        >
          0
        </text>
        <text
          x={padLeft + innerW}
          y={padTop + innerH + 14}
          fontSize={10}
          fill={palette.textMuted}
          fontFamily="JetBrains Mono"
          textAnchor="end"
        >
          {totalDurationUs.toFixed(2)} µs
        </text>
        <text
          x={padLeft + innerW / 2}
          y={padTop + innerH + 14}
          fontSize={10}
          fill={palette.textMuted}
          fontFamily="JetBrains Mono"
          textAnchor="middle"
        >
          t
        </text>

        {/* Legend gradient */}
        <defs>
          <linearGradient id="bitheat-legend" x1="0" x2="1" y1="0" y2="0">
            {[0, 0.25, 0.5, 0.75, 1].map((s) => (
              <stop key={s} offset={`${s * 100}%`} stopColor={infernoColor(s)} />
            ))}
          </linearGradient>
        </defs>
        <rect
          x={pixelWidth - 110}
          y={4}
          width={94}
          height={10}
          fill="url(#bitheat-legend)"
          stroke={palette.queraPurpleSoft}
          strokeWidth={0.5}
        />
        <text
          x={pixelWidth - 110}
          y={14 + 6}
          fontSize={9}
          fill={palette.textMuted}
          fontFamily="JetBrains Mono"
        >
          0
        </text>
        <text
          x={pixelWidth - 16}
          y={14 + 6}
          fontSize={9}
          fill={palette.textMuted}
          fontFamily="JetBrains Mono"
          textAnchor="end"
        >
          1
        </text>
      </svg>
    </div>
  );
}

function countOnes(bs: string): number {
  let c = 0;
  for (let i = 0; i < bs.length; i++) if (bs[i] === "1") c++;
  return c;
}
