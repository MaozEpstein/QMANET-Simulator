/**
 * Histogram of measurement bitstrings.
 *
 * Sorts bars by descending count and shows up to `topK` entries. Bars are
 * drawn at integer x-positions; each label is rotated 90° so long bitstrings
 * (e.g. 60 bits) still fit. Designed to scale visually whether we have 4 or
 * 64 unique outcomes.
 */

import { useMemo } from "react";
import { palette } from "../theme/palette";

interface Props {
  histogram: Record<string, number>;
  totalShots: number;
  pixelWidth?: number;
  pixelHeight?: number;
  topK?: number;
  /** Optional: highlight bars where the bitstring's Hamming weight = expected MIS size. */
  highlightSize?: number;
  caption?: string;
  /** When given, marks a specific bitstring with a special color (e.g. the SA optimum). */
  markedBitstring?: string;
  /** When provided, render bars in this exact order (zero-padded for missing
   *  keys) instead of sorting by descending count. Used by Stage 6 to keep
   *  three side-by-side histograms on a shared x-axis. */
  orderedKeys?: string[];
  /** Unit semantics for the bar values: "shots" (counts) or "probability"
   *  (already normalised to [0,1]). Default "shots" matches the original
   *  contract. Affects the Y-axis label and the bottom-left summary text. */
  valueKind?: "shots" | "probability";
}

export function BitstringHistogram({
  histogram,
  totalShots,
  pixelWidth = 760,
  pixelHeight = 260,
  topK = 24,
  highlightSize,
  caption,
  markedBitstring,
  orderedKeys,
  valueKind = "shots",
}: Props) {
  const padLeft = 50;
  const padRight = 14;
  const padTop = 14;
  const padBottom = 80;
  const innerW = pixelWidth - padLeft - padRight;
  const innerH = pixelHeight - padTop - padBottom;

  const sorted = useMemo(() => {
    if (orderedKeys && orderedKeys.length > 0) {
      return orderedKeys
        .slice(0, topK)
        .map((k) => [k, histogram[k] ?? 0] as [string, number]);
    }
    return Object.entries(histogram)
      .sort(([, a], [, b]) => b - a)
      .slice(0, topK);
  }, [histogram, topK, orderedKeys]);

  const maxCount = sorted[0]?.[1] ?? 1;
  const barW = sorted.length > 0 ? innerW / sorted.length : 0;

  const yMax = Math.max(1, maxCount);
  const countToY = (c: number) => padTop + (1 - c / yMax) * innerH;

  return (
    <div dir="ltr" style={{ display: "inline-block" }}>
      <svg
        width={pixelWidth}
        height={pixelHeight}
        role="img"
        aria-label="Bitstring histogram"
        style={{
          background: palette.bgInset,
          border: `1px solid ${palette.queraPurpleSoft}`,
          borderRadius: 12,
          display: "block",
        }}
      >
        {/* gridlines */}
        {[0, 0.25, 0.5, 0.75, 1].map((f) => {
          const y = padTop + (1 - f) * innerH;
          const raw = yMax * f;
          const v =
            valueKind === "probability"
              ? raw.toFixed(2)
              : String(Math.round(raw));
          return (
            <g key={`g-${f}`}>
              <line
                x1={padLeft}
                x2={padLeft + innerW}
                y1={y}
                y2={y}
                stroke={palette.queraPurpleSoft}
                strokeOpacity={0.3}
                strokeWidth={0.5}
              />
              <text
                x={padLeft - 6}
                y={y + 3}
                fontSize={10}
                fill={palette.textMuted}
                textAnchor="end"
                fontFamily="JetBrains Mono"
              >
                {v}
              </text>
            </g>
          );
        })}

        {/* bars */}
        {sorted.map(([bits, count], i) => {
          const x = padLeft + i * barW + barW * 0.15;
          const w = barW * 0.7;
          const y = countToY(count);
          const h = padTop + innerH - y;
          const ones = [...bits].filter((c) => c === "1").length;
          const matchesHighlight =
            highlightSize !== undefined && ones === highlightSize;
          const isMarked = markedBitstring && bits === markedBitstring;
          const fill = isMarked
            ? palette.ok
            : matchesHighlight
              ? palette.queraPurpleGlow
              : palette.queraPurple;
          return (
            <g key={`bar-${i}`}>
              <rect
                x={x}
                y={y}
                width={Math.max(1, w)}
                height={h}
                fill={fill}
                fillOpacity={isMarked || matchesHighlight ? 0.95 : 0.7}
                stroke={isMarked ? "#fff" : "none"}
                strokeWidth={isMarked ? 1.2 : 0}
                rx={2}
              />
              <text
                x={x + w / 2}
                y={padTop + innerH + 8}
                fontSize={9}
                fill={palette.textMuted}
                textAnchor="end"
                transform={`rotate(-60 ${x + w / 2} ${padTop + innerH + 8})`}
                fontFamily="JetBrains Mono"
              >
                {bits}
              </text>
              {count >= maxCount * 0.05 && (
                <text
                  x={x + w / 2}
                  y={y - 3}
                  fontSize={9}
                  fill={palette.textSecondary}
                  textAnchor="middle"
                  fontFamily="JetBrains Mono"
                >
                  {valueKind === "probability" ? count.toFixed(3) : count}
                </text>
              )}
            </g>
          );
        })}

        {/* axes labels */}
        <text
          x={8}
          y={padTop + innerH / 2}
          fontSize={11}
          fill={palette.textSecondary}
          fontFamily="JetBrains Mono"
        >
          {valueKind === "probability" ? "p" : "shots"}
        </text>
        <text
          x={padLeft + innerW - 80}
          y={pixelHeight - 6}
          fontSize={10}
          fill={palette.textMuted}
          fontFamily="JetBrains Mono"
        >
          {sorted.length} / {Object.keys(histogram).length} unique
        </text>
        <text
          x={padLeft}
          y={pixelHeight - 6}
          fontSize={10}
          fill={palette.textMuted}
          fontFamily="JetBrains Mono"
        >
          {valueKind === "probability"
            ? `probabilities · Σp ≈ ${totalShots.toFixed(2)}`
            : `${totalShots} shots total`}
        </text>
        {caption && (
          <text
            x={padLeft}
            y={12}
            fontSize={11}
            fill={palette.textSecondary}
            fontFamily="JetBrains Mono"
          >
            {caption}
          </text>
        )}
      </svg>
    </div>
  );
}
