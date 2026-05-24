/**
 * Multi-channel pulse plot (Ω, Δ, φ).
 *
 * Renders three stacked plots sharing a time axis. For each channel:
 *  - Solid line: piecewise-linear interpolation between breakpoints
 *  - Breakpoint dots highlighted at vertices
 *  - Red dashed horizontal at the Aquila constraint
 *  - Optional vertical time-cursor (used when the parent wants to sample
 *    the schedule at a specific t and link to a Hamiltonian view)
 *  - Constraint-violating segments drawn in red
 */

import { useMemo } from "react";
import { palette } from "../theme/palette";
import type { PiecewiseLinearDTO } from "../api/rest";

interface ChannelSpec {
  data: PiecewiseLinearDTO;
  /** Channel label, e.g. "Ω(t)" — used in axis and tooltip. */
  label: string;
  /** Units displayed on the y-axis, e.g. "rad/µs". */
  units: string;
  /** Constraint limits in Aquila's units; drawn as red dashed lines. */
  upperLimit?: number;
  lowerLimit?: number;
  /** y-range hint (auto-fit if omitted). */
  yMin?: number;
  yMax?: number;
}

interface Props {
  channels: ChannelSpec[];
  totalDurationUs: number;
  pixelWidth?: number;
  channelHeight?: number;
  /** When set, draws a vertical cursor at this time. */
  cursorT?: number;
  onCursorChange?: (t: number) => void;
}

export function PulsePlot({
  channels,
  totalDurationUs,
  pixelWidth = 700,
  channelHeight = 130,
  cursorT,
  onCursorChange,
}: Props) {
  const padLeft = 60;
  const padRight = 24;
  const padTop = 14;
  const padBottom = 18;
  const W = pixelWidth;
  const H = channels.length * channelHeight + padBottom;

  const innerW = W - padLeft - padRight;

  const tToX = (t: number) => padLeft + (totalDurationUs > 0 ? t / totalDurationUs : 0) * innerW;
  const xToT = (x: number) =>
    totalDurationUs > 0 ? ((x - padLeft) / innerW) * totalDurationUs : 0;

  const onMouseMove = (e: React.MouseEvent<SVGSVGElement>) => {
    if (!onCursorChange) return;
    const rect = (e.currentTarget as SVGSVGElement).getBoundingClientRect();
    const x = e.clientX - rect.left;
    const t = Math.max(0, Math.min(totalDurationUs, xToT(x)));
    onCursorChange(t);
  };

  return (
    <div dir="ltr" style={{ display: "inline-block" }}>
      <svg
        width={W}
        height={H}
        onMouseMove={onMouseMove}
        role="img"
        aria-label="Pulse schedule plot"
        style={{
          background: palette.bgInset,
          border: `1px solid ${palette.queraPurpleSoft}`,
          borderRadius: 12,
          display: "block",
          cursor: onCursorChange ? "ew-resize" : "default",
        }}
      >
        {channels.map((ch, idx) => (
          <ChannelPanel
            key={ch.label}
            channel={ch}
            yOffset={padTop + idx * channelHeight}
            height={channelHeight - 8}
            innerW={innerW}
            padLeft={padLeft}
            totalDurationUs={totalDurationUs}
            tToX={tToX}
          />
        ))}

        {/* Shared time axis */}
        <text
          x={padLeft}
          y={H - 4}
          fontSize={10}
          fill={palette.textMuted}
          fontFamily="JetBrains Mono"
        >
          0
        </text>
        <text
          x={W - padRight - 30}
          y={H - 4}
          fontSize={10}
          fill={palette.textMuted}
          fontFamily="JetBrains Mono"
        >
          {totalDurationUs.toFixed(2)} µs
        </text>

        {/* Vertical time cursor */}
        {cursorT !== undefined && totalDurationUs > 0 && (
          <line
            x1={tToX(cursorT)}
            x2={tToX(cursorT)}
            y1={0}
            y2={H - padBottom}
            stroke={palette.queraPurpleGlow}
            strokeOpacity={0.7}
            strokeWidth={1.2}
            strokeDasharray="3 3"
          />
        )}
      </svg>
    </div>
  );
}

function ChannelPanel({
  channel,
  yOffset,
  height,
  innerW,
  padLeft,
  tToX,
}: {
  channel: ChannelSpec;
  yOffset: number;
  height: number;
  innerW: number;
  padLeft: number;
  totalDurationUs: number;
  tToX: (t: number) => number;
}) {
  const { data, label, units, upperLimit, lowerLimit } = channel;

  const { yMin, yMax } = useMemo(() => {
    const all = data.values.slice();
    if (upperLimit !== undefined) all.push(upperLimit);
    if (lowerLimit !== undefined) all.push(lowerLimit);
    let lo = channel.yMin ?? Math.min(...all, 0);
    let hi = channel.yMax ?? Math.max(...all, 0);
    if (lo === hi) {
      lo -= 1;
      hi += 1;
    }
    const span = hi - lo;
    return { yMin: lo - span * 0.1, yMax: hi + span * 0.1 };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data, upperLimit, lowerLimit, channel.yMin, channel.yMax]);

  const valueToY = (v: number) => yOffset + (1 - (v - yMin) / (yMax - yMin)) * height;

  // Highlight any segment whose slope violates the channel's slew limit (handled at parent level via violations,
  // but we still color segments where breakpoint pairs jump over limit).
  const segments: { x1: number; y1: number; x2: number; y2: number; over: boolean }[] = [];
  for (let i = 1; i < data.times.length; i++) {
    const t0 = data.times[i - 1];
    const t1 = data.times[i];
    const v0 = data.values[i - 1];
    const v1 = data.values[i];
    const over =
      (upperLimit !== undefined && (v0 > upperLimit || v1 > upperLimit)) ||
      (lowerLimit !== undefined && (v0 < lowerLimit || v1 < lowerLimit));
    segments.push({
      x1: tToX(t0),
      y1: valueToY(v0),
      x2: tToX(t1),
      y2: valueToY(v1),
      over,
    });
  }

  return (
    <g>
      {/* y-axis label */}
      <text
        x={6}
        y={yOffset + height / 2}
        fontSize={12}
        fill={palette.textSecondary}
        fontFamily="JetBrains Mono"
      >
        {label}
      </text>
      <text
        x={6}
        y={yOffset + height / 2 + 14}
        fontSize={9}
        fill={palette.textMuted}
        fontFamily="JetBrains Mono"
      >
        {units}
      </text>

      {/* y=0 baseline */}
      {yMin <= 0 && yMax >= 0 && (
        <line
          x1={padLeft}
          x2={padLeft + innerW}
          y1={valueToY(0)}
          y2={valueToY(0)}
          stroke={palette.textMuted}
          strokeOpacity={0.25}
          strokeWidth={0.7}
        />
      )}

      {/* Upper/lower constraint lines */}
      {upperLimit !== undefined && upperLimit <= yMax && upperLimit >= yMin && (
        <line
          x1={padLeft}
          x2={padLeft + innerW}
          y1={valueToY(upperLimit)}
          y2={valueToY(upperLimit)}
          stroke={palette.err}
          strokeOpacity={0.7}
          strokeWidth={1}
          strokeDasharray="4 4"
        />
      )}
      {lowerLimit !== undefined && lowerLimit <= yMax && lowerLimit >= yMin && (
        <line
          x1={padLeft}
          x2={padLeft + innerW}
          y1={valueToY(lowerLimit)}
          y2={valueToY(lowerLimit)}
          stroke={palette.err}
          strokeOpacity={0.7}
          strokeWidth={1}
          strokeDasharray="4 4"
        />
      )}

      {/* Pulse line segments */}
      {segments.map((s, i) => (
        <line
          key={`seg-${i}`}
          x1={s.x1}
          y1={s.y1}
          x2={s.x2}
          y2={s.y2}
          stroke={s.over ? palette.err : palette.queraPurpleGlow}
          strokeWidth={s.over ? 2 : 1.6}
        />
      ))}

      {/* Breakpoint dots */}
      {data.times.map((t, i) => (
        <circle
          key={`bp-${i}`}
          cx={tToX(t)}
          cy={valueToY(data.values[i])}
          r={3}
          fill={palette.queraPurple}
          stroke="#fff"
          strokeWidth={1}
        />
      ))}

      {/* Border + y tick labels */}
      <rect
        x={padLeft}
        y={yOffset}
        width={innerW}
        height={height}
        fill="none"
        stroke={palette.queraPurpleSoft}
        strokeWidth={0.8}
      />
      <text
        x={padLeft - 4}
        y={valueToY(yMax) + 9}
        fontSize={9}
        fill={palette.textMuted}
        fontFamily="JetBrains Mono"
        textAnchor="end"
      >
        {yMax.toFixed(1)}
      </text>
      <text
        x={padLeft - 4}
        y={valueToY(yMin) - 2}
        fontSize={9}
        fill={palette.textMuted}
        fontFamily="JetBrains Mono"
        textAnchor="end"
      >
        {yMin.toFixed(1)}
      </text>
    </g>
  );
}

/** Linear-interpolate a piecewise-linear at time t. Exported for parent components. */
export function valueAt(pwl: PiecewiseLinearDTO, t: number): number {
  if (pwl.times.length === 0) return 0;
  if (t <= pwl.times[0]) return pwl.values[0];
  if (t >= pwl.times[pwl.times.length - 1]) return pwl.values[pwl.values.length - 1];
  for (let i = 1; i < pwl.times.length; i++) {
    if (t <= pwl.times[i]) {
      const t0 = pwl.times[i - 1];
      const t1 = pwl.times[i];
      const v0 = pwl.values[i - 1];
      const v1 = pwl.values[i];
      if (t1 === t0) return v1;
      return v0 + ((t - t0) / (t1 - t0)) * (v1 - v0);
    }
  }
  return pwl.values[pwl.values.length - 1];
}
