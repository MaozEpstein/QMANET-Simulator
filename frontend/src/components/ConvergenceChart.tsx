/**
 * Throughput bounds vs. Effort — Jain et al. (MobiCom 2003) Fig 5, computed
 * live from the column-generation LP. One point per MWIS oracle call:
 *   - lower bound 1/z (stepped, rises as independent sets are added),
 *   - 1/ω clique bound (flat),
 *   - Lagrangian upper bound (dashed, falls whenever the exact oracle runs),
 *   - the shaded gap between them, closing to the certified optimum.
 * The x axis is either oracle calls or cumulative runtime.
 */

import { useMemo, useState } from "react";
import type { ConvergencePoint } from "../api/rest";
import { palette } from "../theme/palette";
import { BOUND_COLORS } from "./BoundsBandChart";

export type EffortAxis = "calls" | "time";

interface Props {
  points: ConvergencePoint[];
  omega: number;
  axis: EffortAxis;
  /** How many points are revealed (playback); defaults to all. */
  revealCount?: number;
  selectedIdx: number | null;
  onSelect: (idx: number | null) => void;
  certified: boolean;
  linkLabel?: (id: number) => string;
  pixelWidth?: number;
  pixelHeight?: number;
}

const MONO = "JetBrains Mono, monospace";
const TABULAR = '"tnum" 1, "zero" 1';

function niceStep(span: number, count: number) {
  if (span <= 0) return 1;
  const raw = span / Math.max(2, count);
  const exp = Math.floor(Math.log10(raw));
  const f = raw / Math.pow(10, exp);
  const nf = f < 1.5 ? 1 : f < 3 ? 2 : f < 7 ? 5 : 10;
  return nf * Math.pow(10, exp);
}

function fmtMs(ms: number): string {
  if (ms < 1) return `${ms.toFixed(2)} ms`;
  if (ms < 100) return `${ms.toFixed(1)} ms`;
  if (ms < 10000) return `${Math.round(ms)} ms`;
  return `${(ms / 1000).toFixed(1)} s`;
}

export function ConvergenceChart({
  points,
  omega,
  axis,
  revealCount,
  selectedIdx,
  onSelect,
  certified,
  linkLabel,
  pixelWidth = 1100,
  pixelHeight = 320,
}: Props) {
  const padLeft = 58;
  const padRight = 128;
  const padTop = 22;
  const padBottom = 44;
  const innerW = pixelWidth - padLeft - padRight;
  const innerH = pixelHeight - padTop - padBottom;

  const shown = points.slice(0, Math.max(1, revealCount ?? points.length));
  const xOf = (p: ConvergencePoint) => (axis === "calls" ? p.calls : p.time_ms);
  const clique = 1 / omega;

  const { xMax, yMax } = useMemo(() => {
    const last = points[points.length - 1];
    const xm = axis === "calls" ? Math.max(1, last.calls) : Math.max(1e-3, last.time_ms);
    const step = niceStep(clique, 4);
    return { xMax: xm, yMax: Math.min(1, Math.ceil((clique * 1.12) / step) * step) };
  }, [points, axis, clique]);

  const xToPx = (x: number) => padLeft + (x / xMax) * innerW;
  const yToPx = (v: number) => padTop + (1 - v / yMax) * innerH;
  const xEnd = padLeft + innerW;

  const xTicks = useMemo(() => {
    const step = axis === "calls" ? Math.max(1, Math.round(niceStep(xMax, 8))) : niceStep(xMax, 6);
    const out: number[] = [];
    for (let v = 0; v <= xMax + step * 1e-6; v += step) out.push(v);
    return out;
  }, [xMax, axis]);
  const yTicks = useMemo(() => {
    const step = niceStep(yMax, 5);
    const out: number[] = [];
    for (let v = 0; v <= yMax + step / 2; v += step) out.push(v);
    return out;
  }, [yMax]);

  const step = (key: "lower" | "upper") => {
    const segs = [`M${xToPx(xOf(shown[0]))},${yToPx(shown[0][key])}`];
    for (let i = 1; i < shown.length; i++) {
      const x = xToPx(xOf(shown[i]));
      segs.push(`L${x},${yToPx(shown[i - 1][key])}`, `L${x},${yToPx(shown[i][key])}`);
    }
    return segs.join(" ");
  };
  const lowerPath = step("lower");
  const upperPath = step("upper");
  const back: string[] = [];
  for (let i = shown.length - 1; i >= 1; i--) {
    const x = xToPx(xOf(shown[i]));
    back.push(`L${x},${yToPx(shown[i].lower)}`, `L${x},${yToPx(shown[i - 1].lower)}`);
  }
  back.push(`L${xToPx(xOf(shown[0]))},${yToPx(shown[0].lower)} Z`);
  const bandPath = `${upperPath} ${back.join(" ")}`;
  const lagrangianActive = shown.some((p) => p.upper < clique - 1e-9);
  // Dashed Lagrangian line only from where it first drops below 1/ω.
  const lagrangianPath = (() => {
    const k = shown.findIndex((p) => p.upper < clique - 1e-9);
    if (k < 0) return "";
    const x0 = xToPx(xOf(shown[k]));
    const segs = [`M${x0},${yToPx(clique)}`, `L${x0},${yToPx(shown[k].upper)}`];
    for (let i = k + 1; i < shown.length; i++) {
      const x = xToPx(xOf(shown[i]));
      segs.push(`L${x},${yToPx(shown[i - 1].upper)}`, `L${x},${yToPx(shown[i].upper)}`);
    }
    return segs.join(" ");
  })();

  const [hoverIdx, setHoverIdx] = useState<number | null>(null);
  const onMouseMove = (e: React.MouseEvent<SVGSVGElement>) => {
    const px = e.clientX - e.currentTarget.getBoundingClientRect().left;
    let best = 0;
    let bestD = Infinity;
    shown.forEach((p, i) => {
      const d = Math.abs(xToPx(xOf(p)) - px);
      if (d < bestD) {
        bestD = d;
        best = i;
      }
    });
    setHoverIdx(best);
  };

  const last = shown[shown.length - 1];
  const done = shown.length === points.length;
  const met = done && certified;
  const focusIdx = hoverIdx ?? selectedIdx;
  const focus = focusIdx !== null ? shown[focusIdx] : null;
  const label = (v: number) => linkLabel?.(v) ?? String(v);

  return (
    <div dir="ltr" style={{ position: "relative", width: pixelWidth }}>
      <svg
        width={pixelWidth}
        height={pixelHeight}
        onMouseMove={onMouseMove}
        onMouseLeave={() => setHoverIdx(null)}
        onClick={() => {
          if (hoverIdx === null) return;
          onSelect(selectedIdx === hoverIdx ? null : hoverIdx);
        }}
        role="img"
        aria-label="Throughput lower and upper bounds as a function of effort (MWIS oracle calls)"
        style={{ display: "block", cursor: "pointer" }}
      >
        <defs>
          <filter id="cv-glow" x="-100%" y="-100%" width="300%" height="300%">
            <feGaussianBlur stdDeviation="4" result="b" />
            <feMerge>
              <feMergeNode in="b" />
              <feMergeNode in="SourceGraphic" />
            </feMerge>
          </filter>
          <linearGradient id="cv-band" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={BOUND_COLORS.upper} stopOpacity={0.16} />
            <stop offset="100%" stopColor={BOUND_COLORS.lower} stopOpacity={0.16} />
          </linearGradient>
        </defs>

        {yTicks.map((v, i) => (
          <g key={`y-${i}`}>
            <line
              x1={padLeft}
              x2={xEnd}
              y1={yToPx(v)}
              y2={yToPx(v)}
              stroke={palette.queraPurpleSoft}
              strokeOpacity={v === 0 ? 0.7 : 0.25}
              strokeWidth={v === 0 ? 1 : 0.7}
            />
            <text
              x={padLeft - 10}
              y={yToPx(v) + 4}
              textAnchor="end"
              fontSize={12}
              fill={palette.textMuted}
              fontFamily={MONO}
              style={{ fontFeatureSettings: TABULAR }}
            >
              {v.toFixed(2)}
            </text>
          </g>
        ))}
        {xTicks.map((v, i) => (
          <g key={`x-${i}`}>
            <line
              x1={xToPx(v)}
              x2={xToPx(v)}
              y1={yToPx(0)}
              y2={yToPx(0) + 5}
              stroke={palette.queraPurpleSoft}
            />
            <text
              x={xToPx(v)}
              y={yToPx(0) + 19}
              textAnchor="middle"
              fontSize={12}
              fill={palette.textMuted}
              fontFamily={MONO}
              style={{ fontFeatureSettings: TABULAR }}
            >
              {axis === "calls" ? Math.round(v) : fmtMs(v)}
            </text>
          </g>
        ))}
        <text x={padLeft} y={12} fontSize={12} fill={palette.textSecondary} fontFamily={MONO}>
          throughput bound x
        </text>
        <text
          x={xEnd}
          y={pixelHeight - 6}
          textAnchor="end"
          fontSize={12.5}
          fill={palette.textSecondary}
          fontFamily={MONO}
        >
          {axis === "calls" ? "Effort — MWIS oracle calls" : "Runtime (cumulative)"}
        </text>

        {/* 1/ω clique bound across the full width */}
        <line
          x1={padLeft}
          x2={xEnd}
          y1={yToPx(clique)}
          y2={yToPx(clique)}
          stroke={BOUND_COLORS.upper}
          strokeWidth={2}
        />

        <path d={bandPath} fill="url(#cv-band)" stroke="none" />
        {lagrangianActive && (
          <path
            d={lagrangianPath}
            fill="none"
            stroke={BOUND_COLORS.upper}
            strokeWidth={2}
            strokeDasharray="7 5"
          />
        )}
        <path d={lowerPath} fill="none" stroke={BOUND_COLORS.lower} strokeWidth={2.5} />

        {/* Per-call markers: circle = greedy oracle, diamond = exact oracle. */}
        {shown.map((p, i) => {
          const cx = xToPx(xOf(p));
          const cy = yToPx(p.lower);
          const isSel = selectedIdx === i;
          const isHover = hoverIdx === i;
          const r = isSel || isHover ? 6 : 4.5;
          if (p.pricer === "exact") {
            return (
              <rect
                key={i}
                x={cx - r}
                y={cy - r}
                width={r * 2}
                height={r * 2}
                transform={`rotate(45 ${cx} ${cy})`}
                fill={palette.bgInset}
                stroke={BOUND_COLORS.exact}
                strokeWidth={2.2}
              />
            );
          }
          return (
            <circle
              key={i}
              cx={cx}
              cy={cy}
              r={r}
              fill={p.pricer === "start" ? palette.bgInset : BOUND_COLORS.lower}
              stroke={p.pricer === "start" ? BOUND_COLORS.lower : palette.bgInset}
              strokeWidth={2}
            />
          );
        })}

        {/* Selected call */}
        {selectedIdx !== null && shown[selectedIdx] && (
          <>
            <line
              x1={xToPx(xOf(shown[selectedIdx]))}
              x2={xToPx(xOf(shown[selectedIdx]))}
              y1={padTop}
              y2={yToPx(0)}
              stroke={BOUND_COLORS.exact}
              strokeOpacity={0.7}
              strokeWidth={1.4}
              strokeDasharray="3 3"
            />
            <circle
              cx={xToPx(xOf(shown[selectedIdx]))}
              cy={yToPx(shown[selectedIdx].lower)}
              r={11}
              fill="none"
              stroke={BOUND_COLORS.exact}
              strokeWidth={2}
            />
          </>
        )}

        {hoverIdx !== null && (
          <line
            x1={xToPx(xOf(shown[hoverIdx]))}
            x2={xToPx(xOf(shown[hoverIdx]))}
            y1={padTop}
            y2={yToPx(0)}
            stroke={palette.textSecondary}
            strokeOpacity={0.3}
          />
        )}

        {/* Bounds met: certified optimum */}
        {met && (
          <g filter="url(#cv-glow)">
            <circle cx={xToPx(xOf(last))} cy={yToPx(last.lower)} r={8} fill={BOUND_COLORS.exact} />
          </g>
        )}

        {/* Direct labels at the right end */}
        <EndLabel
          x={xEnd + 10}
          y={yToPx(clique)}
          color={BOUND_COLORS.upper}
          text={`1/ω = ${clique.toFixed(3)}`}
        />
        {lagrangianActive && last.upper < clique - 1e-9 && Math.abs(yToPx(last.upper) - yToPx(clique)) > 16 && !met && (
          <EndLabel x={xEnd + 10} y={yToPx(last.upper)} color={BOUND_COLORS.upper} text={`UB ${last.upper.toFixed(3)}`} dashed />
        )}
        <EndLabel
          x={xEnd + 10}
          y={Math.abs(yToPx(last.lower) - yToPx(clique)) < 16 ? yToPx(clique) + 18 : yToPx(last.lower)}
          color={met ? BOUND_COLORS.exact : BOUND_COLORS.lower}
          text={met ? `x* = ${last.lower.toFixed(3)} ✓` : `LB ${last.lower.toFixed(3)}`}
          strong
        />
      </svg>

      {focus && (
        <div
          role="tooltip"
          style={{
            position: "absolute",
            left: Math.min(xToPx(xOf(focus)) + 14, pixelWidth - 300),
            top: 30,
            width: 270,
            padding: "9px 12px",
            background: "rgba(15,20,38,0.95)",
            backdropFilter: "blur(6px)",
            border: `1px solid ${palette.queraPurpleSoft}`,
            borderRadius: 9,
            fontSize: 12.5,
            fontFamily: MONO,
            color: palette.textPrimary,
            pointerEvents: "none",
            boxShadow: "0 6px 22px rgba(0,0,0,0.5)",
            lineHeight: 1.65,
            fontFeatureSettings: TABULAR,
          }}
        >
          <div style={{ display: "flex", justifyContent: "space-between", color: palette.textSecondary }}>
            <span>
              {focus.pricer === "start" ? "start" : `call #${focus.calls}`}
            </span>
            <span>{fmtMs(focus.time_ms)}</span>
          </div>
          <TipRow color={BOUND_COLORS.upper} k="upper" v={focus.upper} dashed={focus.upper < clique - 1e-9} />
          <TipRow color={BOUND_COLORS.lower} k="lower" v={focus.lower} />
          <div style={{ color: palette.textMuted, fontSize: 11.5 }}>
            gap {(focus.upper - focus.lower).toFixed(3)} · oracle:{" "}
            <span style={{ color: focus.pricer === "exact" ? BOUND_COLORS.exact : palette.textSecondary }}>
              {focus.pricer === "start" ? "—" : focus.pricer}
            </span>
          </div>
          {focus.added && (
            <div
              style={{
                marginTop: 4,
                paddingTop: 5,
                borderTop: `1px solid ${palette.queraPurpleSoft}`,
                fontSize: 11.5,
                color: palette.textSecondary,
                whiteSpace: "normal",
              }}
            >
              + IS {"{"} {focus.added.map(label).join(", ")} {"}"}
            </div>
          )}
          <div style={{ color: palette.textMuted, fontSize: 10.5, marginTop: 3 }} dir="rtl">
            {focus.added ? "קליק — הדגש את הקבוצה על F" : "קליק לבחירה"}
          </div>
        </div>
      )}
    </div>
  );
}

function EndLabel({
  x,
  y,
  color,
  text,
  strong = false,
  dashed = false,
}: {
  x: number;
  y: number;
  color: string;
  text: string;
  strong?: boolean;
  dashed?: boolean;
}) {
  return (
    <g>
      <line
        x1={x - 4}
        x2={x + 10}
        y1={y}
        y2={y}
        stroke={color}
        strokeWidth={2.5}
        strokeDasharray={dashed ? "4 3" : undefined}
      />
      <text
        x={x + 15}
        y={y + 4.5}
        fontSize={12.5}
        fontWeight={strong ? 700 : 500}
        fill={palette.textPrimary}
        fontFamily={MONO}
        style={{ fontFeatureSettings: TABULAR }}
      >
        {text}
      </text>
    </g>
  );
}

function TipRow({ color, k, v, dashed = false }: { color: string; k: string; v: number; dashed?: boolean }) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
      <span
        style={{
          width: 14,
          height: 0,
          borderTop: `2.5px ${dashed ? "dashed" : "solid"} ${color}`,
        }}
      />
      <span style={{ flex: 1, color: palette.textSecondary }}>{k}</span>
      <span>{v.toFixed(4)}</span>
    </div>
  );
}
