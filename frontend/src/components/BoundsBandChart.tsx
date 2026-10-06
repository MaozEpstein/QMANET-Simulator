/**
 * Throughput bounds band over the interference radius R': the upper bound
 * 1/ω(F) and lower bound 1/χ(F) as step functions of R', with the band
 * between them — the region where the classical method leaves the true
 * optimum undetermined. Same frame and interaction as InterferenceSweepChart
 * (hover crosshair + tooltip, click a step to set R').
 */

import { useMemo, useState } from "react";
import { palette } from "../theme/palette";
import type { InterferenceSweepPoint } from "../api/rest";

export const BOUND_COLORS = {
  lower: palette.atomGround,
  exact: palette.queraPurpleGlow,
  upper: palette.warn,
} as const;

interface Props {
  points: InterferenceSweepPoint[];
  currentR: number;
  onPick: (r: number) => void;
  pixelWidth?: number;
  pixelHeight?: number;
}

const TABULAR_FIGURES = '"tnum" 1, "zero" 1';
const MONO = "JetBrains Mono, monospace";

interface BandPoint {
  r: number;
  upper: number;
  lower: number;
  omega: number;
  chi: number;
}

function niceStep(span: number, count: number) {
  const raw = span / Math.max(2, count);
  const exp = Math.floor(Math.log10(raw));
  const f = raw / Math.pow(10, exp);
  const nf = f < 1.5 ? 1 : f < 3 ? 2 : f < 7 ? 5 : 10;
  return nf * Math.pow(10, exp);
}

export function BoundsBandChart({
  points,
  currentR,
  onPick,
  pixelWidth = 640,
  pixelHeight = 220,
}: Props) {
  const padLeft = 48;
  const padRight = 18;
  const padTop = 18;
  const padBottom = 30;
  const innerW = pixelWidth - padLeft - padRight;
  const innerH = pixelHeight - padTop - padBottom;

  const data = useMemo<BandPoint[]>(
    () =>
      points
        .filter((p) => p.omega && p.chi_upper)
        .map((p) => ({
          r: p.interference_radius,
          omega: p.omega!,
          chi: p.chi_upper!,
          upper: 1 / p.omega!,
          lower: 1 / p.chi_upper!,
        }))
        .sort((a, b) => a.r - b.r),
    [points],
  );

  const { xMin, xMax, yMax } = useMemo(() => {
    if (data.length === 0) return { xMin: 0, xMax: 1, yMax: 1 };
    const rMin = data[0].r;
    const rMax = data[data.length - 1].r;
    const span = Math.max(1e-6, rMax - rMin);
    const top = Math.max(...data.map((d) => d.upper));
    const step = niceStep(top, 4);
    return {
      xMin: rMin - span * 0.04,
      xMax: rMax + span * 0.12,
      yMax: Math.min(1, Math.ceil((top * 1.1) / step) * step),
    };
  }, [data]);

  const xToPx = (r: number) => padLeft + ((r - xMin) / (xMax - xMin)) * innerW;
  const yToPx = (v: number) => padTop + (1 - v / yMax) * innerH;

  const xTicks = useMemo(() => {
    const step = niceStep(xMax - xMin, 6);
    const out: number[] = [];
    for (let v = Math.ceil(xMin / step) * step; v <= xMax; v += step) out.push(v);
    return out;
  }, [xMin, xMax]);
  const yTicks = useMemo(() => {
    const step = niceStep(yMax, 4);
    const out: number[] = [];
    for (let v = 0; v <= yMax + step / 2; v += step) out.push(v);
    return out;
  }, [yMax]);

  const stepPath = (key: "upper" | "lower") => {
    if (data.length === 0) return "";
    const segs = [`M${xToPx(data[0].r)},${yToPx(data[0][key])}`];
    for (let i = 1; i < data.length; i++) {
      const x = xToPx(data[i].r);
      segs.push(`L${x},${yToPx(data[i - 1][key])}`, `L${x},${yToPx(data[i][key])}`);
    }
    segs.push(`L${xToPx(xMax)},${yToPx(data[data.length - 1][key])}`);
    return segs.join(" ");
  };

  const [hoverIdx, setHoverIdx] = useState<number | null>(null);

  if (data.length === 0) {
    return (
      <div style={{ color: palette.textMuted, fontSize: 13 }}>
        אין נתוני חסמים בסוויפ (ייתכן ש-backend ישן — הפעל מחדש את uvicorn).
      </div>
    );
  }

  const upperPath = stepPath("upper");
  const lowerPath = stepPath("lower");
  // Band = upper step forward, then the lower step traced backwards.
  const back: string[] = [`L${xToPx(xMax)},${yToPx(data[data.length - 1].lower)}`];
  for (let i = data.length - 1; i >= 1; i--) {
    const x = xToPx(data[i].r);
    back.push(`L${x},${yToPx(data[i].lower)}`, `L${x},${yToPx(data[i - 1].lower)}`);
  }
  back.push(`L${xToPx(data[0].r)},${yToPx(data[0].lower)} Z`);
  const bandPath = `${upperPath} ${back.join(" ")}`;

  const onMouseMove = (e: React.MouseEvent<SVGSVGElement>) => {
    const px = e.clientX - e.currentTarget.getBoundingClientRect().left;
    // Step-after semantics: the active step is the last breakpoint left of the cursor.
    let idx = 0;
    for (let i = 0; i < data.length; i++) if (xToPx(data[i].r) <= px) idx = i;
    setHoverIdx(idx);
  };
  const hover = hoverIdx !== null ? data[hoverIdx] : null;

  return (
    <div dir="ltr" style={{ display: "inline-block", position: "relative" }}>
      <div style={{ display: "flex", gap: 16, fontSize: 12.5, color: palette.textSecondary, marginBottom: 6 }}>
        <LegendSwatch color={BOUND_COLORS.upper} label="1/ω · upper bound (clique)" />
        <LegendSwatch color={BOUND_COLORS.lower} label="1/χ · lower bound (coloring)" />
        <span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
          <span style={{ width: 14, height: 10, borderRadius: 2, background: `${palette.queraPurpleGlow}33` }} />
          uncertainty band
        </span>
      </div>
      <svg
        width={pixelWidth}
        height={pixelHeight}
        onMouseMove={onMouseMove}
        onMouseLeave={() => setHoverIdx(null)}
        onClick={() => hover && onPick(hover.r)}
        role="img"
        aria-label="Throughput bounds 1/ω and 1/χ as a function of the interference radius R'"
        style={{
          background: palette.bgInset,
          border: `1px solid ${palette.queraPurpleSoft}`,
          borderRadius: 12,
          display: "block",
          cursor: "pointer",
        }}
      >
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
              fontSize={11.5}
              fill={palette.textMuted}
              fontFamily={MONO}
              style={{ fontFeatureSettings: TABULAR_FIGURES }}
            >
              {v.toFixed(2)}
            </text>
          </g>
        ))}
        {xTicks.map((v, i) => (
          <text
            key={`x-${i}`}
            x={xToPx(v)}
            y={pixelHeight - padBottom + 16}
            textAnchor="middle"
            fontSize={11.5}
            fill={palette.textMuted}
            fontFamily={MONO}
            style={{ fontFeatureSettings: TABULAR_FIGURES }}
          >
            {Math.round(v)}
          </text>
        ))}
        <text x={padLeft} y={12} fontSize={12} fill={palette.textSecondary} fontFamily={MONO}>
          rate per link x
        </text>
        <text
          x={pixelWidth - padRight}
          y={pixelHeight - 4}
          textAnchor="end"
          fontSize={12}
          fill={palette.textSecondary}
          fontFamily={MONO}
        >
          R'
        </text>

        <path d={bandPath} fill={palette.queraPurpleGlow} fillOpacity={0.16} stroke="none" />
        <path d={upperPath} fill="none" stroke={BOUND_COLORS.upper} strokeWidth={2} />
        <path d={lowerPath} fill="none" stroke={BOUND_COLORS.lower} strokeWidth={2} />

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
              y={padTop - 5}
              textAnchor="middle"
              fontSize={11}
              fill={palette.queraPurpleGlow}
              fontFamily={MONO}
            >
              R'={currentR}
            </text>
          </>
        )}

        {hover && (
          <>
            <line
              x1={xToPx(hover.r)}
              x2={xToPx(hover.r)}
              y1={padTop}
              y2={pixelHeight - padBottom}
              stroke={palette.textSecondary}
              strokeOpacity={0.35}
              strokeWidth={1}
            />
            <circle cx={xToPx(hover.r)} cy={yToPx(hover.upper)} r={4.5} fill={BOUND_COLORS.upper} stroke={palette.bgInset} strokeWidth={2} />
            <circle cx={xToPx(hover.r)} cy={yToPx(hover.lower)} r={4.5} fill={BOUND_COLORS.lower} stroke={palette.bgInset} strokeWidth={2} />
          </>
        )}
      </svg>

      {hover && (
        <div
          role="tooltip"
          style={{
            position: "absolute",
            left: Math.min(xToPx(hover.r) + 12, pixelWidth - 190),
            top: 34,
            padding: "7px 10px",
            background: "rgba(15,20,38,0.94)",
            backdropFilter: "blur(6px)",
            border: `1px solid ${palette.queraPurpleSoft}`,
            borderRadius: 7,
            fontSize: 12.5,
            fontFamily: MONO,
            color: palette.textPrimary,
            pointerEvents: "none",
            boxShadow: "0 4px 16px rgba(0,0,0,0.45)",
            lineHeight: 1.6,
            fontFeatureSettings: TABULAR_FIGURES,
          }}
        >
          <div style={{ color: palette.textSecondary }}>R' = {hover.r.toFixed(2)}</div>
          <TooltipRow color={BOUND_COLORS.upper} label={`1/ω = 1/${hover.omega}`} value={hover.upper} />
          <TooltipRow color={BOUND_COLORS.lower} label={`1/χ = 1/${hover.chi}`} value={hover.lower} />
          <div style={{ color: palette.textMuted, fontSize: 11, marginTop: 2 }}>
            {hover.omega === hover.chi ? "חסמים מתלכדים — ערך מדויק" : `פער ${(hover.upper - hover.lower).toFixed(3)}`} · קליק להגדרת R'
          </div>
        </div>
      )}
    </div>
  );
}

function LegendSwatch({ color, label }: { color: string; label: string }) {
  return (
    <span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
      <span style={{ width: 14, height: 2, borderRadius: 1, background: color }} />
      {label}
    </span>
  );
}

function TooltipRow({ color, label, value }: { color: string; label: string; value: number }) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
      <span style={{ width: 8, height: 8, borderRadius: "50%", background: color }} />
      <span style={{ flex: 1 }}>{label}</span>
      <span>{value.toFixed(3)}</span>
    </div>
  );
}
