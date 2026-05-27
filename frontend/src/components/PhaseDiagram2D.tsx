/**
 * Publication-quality SVG heatmap of the ground-state phase diagram in (Ω, Δ)
 * space.
 *
 * Each cell is coloured by mean Rydberg occupation ⟨Σ n̂⟩ on a 3-stop perceptual
 * ramp (teal → purple → amber). Three contour lines mark phase boundaries
 * (no Rydberg / Z₂ MIS band / fully excited), each color-coded to its own
 * phase. The schedule's (Ω(t), Δ(t)) trajectory is overlaid with a glowing
 * green underlay, sharp top stroke, direction arrowheads, and T/4 · T/2 · 3T/4
 * tick markers. A diamond playhead tracks the live cursorT.
 *
 * Aesthetic choices anchored to the sister SpectrumPlot (same simulator) so
 * the two panels read as one figure:
 *  • Layered SVG defs (linear+radial gradients, clip paths, filters)
 *  • Container with rounded border, inset top highlight, soft outer shadow
 *  • External rich legend panel beside the SVG with live cursor/pick values
 *  • Tabular figures everywhere
 *  • Drop-shadow on small markers (arrowheads, pick card)
 *  • Bottom-anchored "publication signature": a ⟨n⟩(t) sub-strip that samples
 *    the heatmap along the trajectory. Its area fill is a per-render gradient
 *    whose colour at any t equals the heatmap colour at the schedule's
 *    (Ω(t), Δ(t)) at that t — directly linking time to phase.
 */

import { useId, useMemo, useState } from "react";
import type { PhaseDiagramDTO } from "../api/rest";
import { palette } from "../theme/palette";

export interface PhaseTrajectoryPoint {
  t_us: number;
  omega: number;
  delta: number;
}

interface Props {
  diagram: PhaseDiagramDTO;
  pixelWidth?: number;
  pixelHeight?: number;
  /** Optional schedule path in (Ω, Δ) space; drawn as a glowing line. */
  trajectory?: PhaseTrajectoryPoint[];
  /** If set, marks the trajectory point closest to this t (µs) with a halo. */
  cursorT?: number;
  /** Click handler: (omega, delta, meanN) for the cell clicked. */
  onPick?: (omega: number, delta: number, meanN: number) => void;
  /** Picked (Ω, Δ) point — rendered as a crosshair-diamond with a value card. */
  pickedPoint?: { omega: number; delta: number } | null;
}

const TABULAR_FIGURES = '"tnum" 1, "zero" 1';

// 4-stop Inferno colormap — perceptually uniform, designed for dark backgrounds.
// Hex values match matplotlib's `inferno` at t = 0, 0.33, 0.66, 1.0.
const RAMP_STOPS = [
  { at: 0.0, hex: "#1b0c41" },  // deep purple — no Rydberg
  { at: 0.33, hex: "#781c6d" }, // magenta-purple — onset of excitation
  { at: 0.66, hex: "#ed6925" }, // orange — Z₂ / MIS band
  { at: 1.0, hex: "#fcffa4" },  // pale yellow — fully excited
];

// Contour line colors — lighter variants that sit ABOVE the underlying Inferno
// cell colours at each threshold. Chosen so each boundary reads against its
// local heatmap colour without low-contrast clash.
const CONTOUR_COLORS = {
  vacuum: "#c0a4ff",   // light lavender — over deep purple cells
  midband: "#ffb0cc",  // light pink — over magenta→orange transition
  full: "#ffe8a0",     // light cream-yellow — over orange→yellow cells
};

// Stable axis-identifier colours for Ω / Δ / ⟨n⟩ labels in pick cards, legend,
// and tooltip. Kept independent of the heatmap ramp so the user can always tell
// which value is which, even if we swap colormaps later.
const AXIS_COLORS = {
  omega: "#3ed3ff",  // cyan (matches palette.channelOmega in PulsePlot)
  delta: "#b388ff",  // purple (matches palette.channelDelta)
  meanN: "#ed6925",  // orange — anchored to the warm end of the Inferno ramp
};

/** Linear-RGB interpolation between two hex colors. */
function mixHex(a: string, b: string, t: number): string {
  const ah = parseInt(a.slice(1), 16);
  const bh = parseInt(b.slice(1), 16);
  const ar = (ah >> 16) & 0xff;
  const ag = (ah >> 8) & 0xff;
  const ab = ah & 0xff;
  const br = (bh >> 16) & 0xff;
  const bg = (bh >> 8) & 0xff;
  const bb = bh & 0xff;
  const r = Math.round(ar + (br - ar) * t);
  const g = Math.round(ag + (bg - ag) * t);
  const bl = Math.round(ab + (bb - ab) * t);
  return `#${((1 << 24) | (r << 16) | (g << 8) | bl).toString(16).slice(1)}`;
}

/**
 * N-stop perceptual ramp for the phase heatmap. Linear-RGB interpolation
 * between consecutive stops. Works for any number of stops in RAMP_STOPS.
 */
function rampColor(v: number, nAtoms: number): string {
  if (nAtoms <= 0) return RAMP_STOPS[0].hex;
  const t = Math.max(0, Math.min(1, v / nAtoms));
  for (let i = 0; i < RAMP_STOPS.length - 1; i++) {
    const a = RAMP_STOPS[i];
    const b = RAMP_STOPS[i + 1];
    if (t <= b.at) {
      const f = b.at > a.at ? (t - a.at) / (b.at - a.at) : 0;
      return mixHex(a.hex, b.hex, f);
    }
  }
  return RAMP_STOPS[RAMP_STOPS.length - 1].hex;
}

/** Bilinear interpolation of the heatmap at an arbitrary (Ω, Δ). */
function interpMeanN(
  omega: number,
  delta: number,
  omegas: number[],
  deltas: number[],
  mean_n: number[][],
): number {
  const nO = omegas.length;
  const nD = deltas.length;
  if (nO === 0 || nD === 0) return 0;
  // Clamp to grid bounds.
  const o = Math.max(omegas[0], Math.min(omegas[nO - 1], omega));
  const d = Math.max(deltas[0], Math.min(deltas[nD - 1], delta));
  // Find bracketing indices.
  let oi = 0;
  while (oi < nO - 2 && omegas[oi + 1] < o) oi++;
  let di = 0;
  while (di < nD - 2 && deltas[di + 1] < d) di++;
  const o0 = omegas[oi];
  const o1 = omegas[oi + 1] ?? o0;
  const d0 = deltas[di];
  const d1 = deltas[di + 1] ?? d0;
  const tO = o1 > o0 ? (o - o0) / (o1 - o0) : 0;
  const tD = d1 > d0 ? (d - d0) / (d1 - d0) : 0;
  const v00 = mean_n[di][oi];
  const v01 = mean_n[di][oi + 1] ?? v00;
  const v10 = mean_n[di + 1] ? mean_n[di + 1][oi] : v00;
  const v11 = mean_n[di + 1] ? (mean_n[di + 1][oi + 1] ?? v10) : v00;
  return (
    v00 * (1 - tO) * (1 - tD) +
    v01 * tO * (1 - tD) +
    v10 * (1 - tO) * tD +
    v11 * tO * tD
  );
}

export function PhaseDiagram2D({
  diagram,
  pixelWidth = 980,
  pixelHeight = 580,
  trajectory,
  cursorT,
  onPick,
  pickedPoint,
}: Props) {
  const { omegas, deltas, mean_n, n_atoms } = diagram;
  const nO = omegas.length;
  const nD = deltas.length;

  // Unique ids — allow multiple PhaseDiagram2D instances on one page without
  // colliding on SVG def IDs.
  const uid = useId().replace(/[:]/g, "");
  const ID = {
    bg: `pd-bg-${uid}`,
    glow: `pd-bg-glow-${uid}`,
    ramp: `pd-ramp-${uid}`,
    stripFill: `pd-strip-fill-${uid}`,
    clipHeat: `pd-clip-heat-${uid}`,
    clipStrip: `pd-clip-strip-${uid}`,
    softGlow: `pd-soft-glow-${uid}`,
    markerShadow: `pd-marker-shadow-${uid}`,
  };

  // Layout
  const PAD_LEFT = 60;
  const PAD_RIGHT = 20;
  const PAD_TOP = 44;
  const PAD_BOTTOM = 44;
  const STRIP_H = 50;
  const STRIP_GAP = 12;

  const heatTop = PAD_TOP;
  const heatBottom = pixelHeight - PAD_BOTTOM - STRIP_H - STRIP_GAP;
  const heatLeft = PAD_LEFT;
  const heatRight = pixelWidth - PAD_RIGHT;
  const innerW = heatRight - heatLeft;
  const innerH = heatBottom - heatTop;
  const stripTop = heatBottom + STRIP_GAP;
  const stripBottom = stripTop + STRIP_H;

  // (Ω, Δ) range mapping.
  const oMin = omegas[0];
  const oMax = omegas[nO - 1];
  const dMin = deltas[0];
  const dMax = deltas[nD - 1];
  const cellW = innerW / Math.max(1, nO);
  const cellH = innerH / Math.max(1, nD);
  const oToX = (o: number) =>
    heatLeft + ((o - oMin) / Math.max(1e-9, oMax - oMin)) * innerW;
  const dToY = (d: number) =>
    heatTop + (1 - (d - dMin) / Math.max(1e-9, dMax - dMin)) * innerH;

  // Precompute cell colors with the new ramp.
  const cellColors = useMemo(() => {
    const out: string[][] = [];
    for (let di = 0; di < nD; di++) {
      const row: string[] = [];
      for (let oi = 0; oi < nO; oi++) {
        row.push(rampColor(mean_n[di][oi], n_atoms));
      }
      out.push(row);
    }
    return out;
  }, [mean_n, n_atoms, nD, nO]);

  // Marching-squares contour generator.
  const contourLines = useMemo(() => {
    if (n_atoms <= 0)
      return [] as { d: string; level: number; color: string }[];
    const levels = [
      { level: 0.5, color: CONTOUR_COLORS.vacuum },
      { level: n_atoms / 3, color: CONTOUR_COLORS.midband },
      { level: (3 * n_atoms) / 4, color: CONTOUR_COLORS.full },
    ];
    const corner = (di: number, oi: number) => ({
      v: mean_n[di][oi],
      x: oToX(omegas[oi]),
      y: dToY(deltas[di]),
    });
    const interp = (
      a: { v: number; x: number; y: number },
      b: { v: number; x: number; y: number },
      t: number,
    ) => {
      if (Math.abs(b.v - a.v) < 1e-9) return { x: a.x, y: a.y };
      const f = (t - a.v) / (b.v - a.v);
      return { x: a.x + (b.x - a.x) * f, y: a.y + (b.y - a.y) * f };
    };
    return levels.map(({ level, color }) => {
      const segs: string[] = [];
      for (let di = 0; di < nD - 1; di++) {
        for (let oi = 0; oi < nO - 1; oi++) {
          const tl = corner(di, oi);
          const tr = corner(di, oi + 1);
          const br = corner(di + 1, oi + 1);
          const bl = corner(di + 1, oi);
          const code =
            ((tl.v > level ? 1 : 0) << 3) |
            ((tr.v > level ? 1 : 0) << 2) |
            ((br.v > level ? 1 : 0) << 1) |
            (bl.v > level ? 1 : 0);
          if (code === 0 || code === 15) continue;
          const top = ((tl.v > level) !== (tr.v > level)) ? interp(tl, tr, level) : null;
          const right = ((tr.v > level) !== (br.v > level)) ? interp(tr, br, level) : null;
          const bottom = ((br.v > level) !== (bl.v > level)) ? interp(br, bl, level) : null;
          const left = ((bl.v > level) !== (tl.v > level)) ? interp(bl, tl, level) : null;
          const pts = [top, right, bottom, left].filter(Boolean) as { x: number; y: number }[];
          if (pts.length === 2) {
            segs.push(`M${pts[0].x.toFixed(1)},${pts[0].y.toFixed(1)} L${pts[1].x.toFixed(1)},${pts[1].y.toFixed(1)}`);
          } else if (pts.length === 4) {
            segs.push(`M${pts[0].x.toFixed(1)},${pts[0].y.toFixed(1)} L${pts[1].x.toFixed(1)},${pts[1].y.toFixed(1)}`);
            segs.push(`M${pts[2].x.toFixed(1)},${pts[2].y.toFixed(1)} L${pts[3].x.toFixed(1)},${pts[3].y.toFixed(1)}`);
          }
        }
      }
      return { d: segs.join(" "), level, color };
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mean_n, omegas, deltas, n_atoms, nO, nD, pixelWidth, pixelHeight]);

  // Trajectory analysis.
  const trajInfo = useMemo(() => {
    if (!trajectory || trajectory.length < 2)
      return { arcLength: 0, mappedPts: [] as { x: number; y: number; t: number; inRange: boolean }[] };
    const mappedPts = trajectory.map((p) => {
      const inRange =
        p.omega >= oMin && p.omega <= oMax && p.delta >= dMin && p.delta <= dMax;
      const co = Math.max(oMin, Math.min(oMax, p.omega));
      const cd = Math.max(dMin, Math.min(dMax, p.delta));
      return { x: oToX(co), y: dToY(cd), t: p.t_us, inRange };
    });
    let arc = 0;
    for (let i = 1; i < trajectory.length; i++) {
      const dO = trajectory[i].omega - trajectory[i - 1].omega;
      const dD = trajectory[i].delta - trajectory[i - 1].delta;
      arc += Math.hypot(dO, dD);
    }
    return { arcLength: arc, mappedPts };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [trajectory, oMin, oMax, dMin, dMax, pixelWidth, pixelHeight]);

  // Cursor sample on the trajectory.
  const cursorSampleIdx = useMemo(() => {
    if (cursorT === undefined || !trajectory || trajectory.length === 0) return -1;
    let best = 0;
    let bestD = Infinity;
    for (let i = 0; i < trajectory.length; i++) {
      const d = Math.abs(trajectory[i].t_us - cursorT);
      if (d < bestD) {
        bestD = d;
        best = i;
      }
    }
    return best;
  }, [cursorT, trajectory]);

  // Live ⟨n⟩ + (Ω, Δ) at the cursor.
  const cursorReadout = useMemo(() => {
    if (cursorSampleIdx < 0 || !trajectory) return null;
    const p = trajectory[cursorSampleIdx];
    return {
      omega: p.omega,
      delta: p.delta,
      meanN: interpMeanN(p.omega, p.delta, omegas, deltas, mean_n),
      t_us: p.t_us,
    };
  }, [cursorSampleIdx, trajectory, omegas, deltas, mean_n]);

  // Pick readout.
  const pickReadout = useMemo(() => {
    if (!pickedPoint) return null;
    return {
      omega: pickedPoint.omega,
      delta: pickedPoint.delta,
      meanN: interpMeanN(
        pickedPoint.omega,
        pickedPoint.delta,
        omegas,
        deltas,
        mean_n,
      ),
    };
  }, [pickedPoint, omegas, deltas, mean_n]);

  // Hover state.
  const [hover, setHover] = useState<
    | { o: number; d: number; v: number; px: number; py: number; oi: number; di: number }
    | null
  >(null);

  // Strip data (along the trajectory).
  const stripData = useMemo(() => {
    if (!trajectory || trajectory.length < 2 || n_atoms <= 0) return null;
    const samples = trajectory.map((p) => ({
      t: p.t_us,
      v: interpMeanN(p.omega, p.delta, omegas, deltas, mean_n),
    }));
    const tMin = samples[0].t;
    const tMax = samples[samples.length - 1].t;
    return { samples, tMin, tMax };
  }, [trajectory, omegas, deltas, mean_n, n_atoms]);

  // Build a per-render gradient of stops sampled along trajectory time.
  const stripGradientStops = useMemo(() => {
    if (!stripData) return [] as { offset: number; color: string }[];
    const N = 28;
    const { samples, tMin, tMax } = stripData;
    const result: { offset: number; color: string }[] = [];
    for (let i = 0; i < N; i++) {
      const tFrac = i / (N - 1);
      const t = tMin + tFrac * (tMax - tMin);
      let bestI = 0;
      let bestD = Infinity;
      for (let j = 0; j < samples.length; j++) {
        const d = Math.abs(samples[j].t - t);
        if (d < bestD) {
          bestD = d;
          bestI = j;
        }
      }
      result.push({ offset: tFrac, color: rampColor(samples[bestI].v, n_atoms) });
    }
    return result;
  }, [stripData, n_atoms]);

  // Axis ticks (5 each).
  const oTickValues = Array.from({ length: 6 }, (_, i) => oMin + ((oMax - oMin) * i) / 5);
  const dTickValues = Array.from({ length: 6 }, (_, i) => dMin + ((dMax - dMin) * i) / 5);

  // Quarter-time markers along trajectory.
  const quarterMarkers = useMemo(() => {
    if (!trajectory || trajectory.length < 4) return [];
    const tStart = trajectory[0].t_us;
    const tEnd = trajectory[trajectory.length - 1].t_us;
    const span = tEnd - tStart || 1;
    const fracs = [
      { frac: 0.25, label: "T/4" },
      { frac: 0.5, label: "T/2" },
      { frac: 0.75, label: "3T/4" },
    ];
    return fracs.map(({ frac, label }) => {
      const tTarget = tStart + frac * span;
      let bestI = 0;
      let bestD = Infinity;
      for (let i = 0; i < trajectory.length; i++) {
        const d = Math.abs(trajectory[i].t_us - tTarget);
        if (d < bestD) {
          bestD = d;
          bestI = i;
        }
      }
      return { idx: bestI, label };
    });
  }, [trajectory]);

  const titleStats =
    `N=${n_atoms} · grid=${nO}×${nD} · Ω∈[${oMin.toFixed(1)}, ${oMax.toFixed(1)}] · Δ∈[${dMin.toFixed(0)}, ${dMax.toFixed(0)}]`;

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
          background: "linear-gradient(180deg, #11182c, #0d1325)",
        }}
      >
        <svg
          width={pixelWidth}
          height={pixelHeight}
          onMouseLeave={() => setHover(null)}
          style={{
            display: "block",
            background: "transparent",
            fontFeatureSettings: TABULAR_FIGURES,
          }}
        >
          <defs>
            <linearGradient id={ID.bg} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0" stopColor="#11182c" />
              <stop offset="1" stopColor="#0c1124" />
            </linearGradient>
            <radialGradient id={ID.glow} cx="50%" cy="62%" r="55%">
              <stop offset="0" stopColor="#1a2547" stopOpacity="0.55" />
              <stop offset="1" stopColor="#0c1124" stopOpacity="0" />
            </radialGradient>
            <linearGradient id={ID.ramp} x1="0" y1="1" x2="0" y2="0">
              {RAMP_STOPS.map((s, i) => (
                <stop key={i} offset={s.at} stopColor={s.hex} />
              ))}
            </linearGradient>
            <linearGradient id={ID.stripFill} x1="0" y1="0" x2="1" y2="0">
              {stripGradientStops.map((s, i) => (
                <stop key={i} offset={s.offset} stopColor={s.color} stopOpacity={0.5} />
              ))}
            </linearGradient>
            <clipPath id={ID.clipHeat}>
              <rect x={heatLeft} y={heatTop} width={innerW} height={innerH} rx={6} />
            </clipPath>
            <clipPath id={ID.clipStrip}>
              <rect x={heatLeft} y={stripTop} width={innerW} height={STRIP_H} rx={4} />
            </clipPath>
            <filter id={ID.softGlow} x="-50%" y="-50%" width="200%" height="200%">
              <feGaussianBlur stdDeviation="2.2" />
            </filter>
            <filter id={ID.markerShadow} x="-50%" y="-50%" width="200%" height="200%">
              <feDropShadow dx="0" dy="1" stdDeviation="1.5" floodOpacity="0.55" />
            </filter>
          </defs>

          {/* Full-bleed background */}
          <rect x={0} y={0} width={pixelWidth} height={pixelHeight} fill={`url(#${ID.bg})`} />

          {/* Plot-area radial glow */}
          <rect
            x={heatLeft}
            y={heatTop}
            width={innerW}
            height={innerH}
            fill={`url(#${ID.glow})`}
          />

          {/* === Title + micro-stats === */}
          <text
            x={PAD_LEFT}
            y={22}
            fontSize={12}
            fontWeight={600}
            fill={palette.textPrimary}
            letterSpacing={0.3}
            fontFamily="Heebo, system-ui, sans-serif"
          >
            (Ω, Δ) phase diagram — ⟨Σn⟩ ground state
          </text>
          <text
            x={pixelWidth - PAD_RIGHT}
            y={22}
            textAnchor="end"
            fontSize={10}
            fill={palette.textMuted}
            fontFamily="JetBrains Mono, monospace"
          >
            {titleStats}
          </text>

          {/* Y-axis caption (labelpad style, above plot) */}
          <text
            x={PAD_LEFT}
            y={PAD_TOP - 10}
            fontSize={10}
            fill={palette.textMuted}
            letterSpacing={0.6}
            fontFamily="JetBrains Mono, monospace"
          >
            Δ (rad / µs)
          </text>

          {/* === Heatmap cells (clipped) === */}
          <g clipPath={`url(#${ID.clipHeat})`}>
            {deltas.map((d, di) => {
              const y = dToY(d) - cellH / 2;
              return (
                <g key={`row-${di}`}>
                  {omegas.map((o, oi) => {
                    const x = oToX(o) - cellW / 2;
                    const v = mean_n[di][oi];
                    return (
                      <rect
                        key={`c-${di}-${oi}`}
                        x={x}
                        y={y}
                        width={cellW + 1}
                        height={cellH + 1}
                        fill={cellColors[di][oi]}
                        shapeRendering="crispEdges"
                        style={{ cursor: onPick ? "crosshair" : "default" }}
                        onMouseEnter={() =>
                          setHover({
                            o,
                            d,
                            v,
                            px: x + cellW / 2,
                            py: y + cellH / 2,
                            oi,
                            di,
                          })
                        }
                        onClick={onPick ? () => onPick(o, d, v) : undefined}
                      />
                    );
                  })}
                </g>
              );
            })}

            {/* === Contour lines (halo + crisp) === */}
            {contourLines.map((c, i) => (
              <g key={`ctr-${i}`} pointerEvents="none">
                <path
                  d={c.d}
                  fill="none"
                  stroke={c.color}
                  strokeWidth={2.6}
                  strokeOpacity={0.25}
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  filter={`url(#${ID.softGlow})`}
                />
                <path
                  d={c.d}
                  fill="none"
                  stroke={c.color}
                  strokeWidth={1.1}
                  strokeOpacity={0.85}
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              </g>
            ))}

            {/* === Trajectory overlay === */}
            {trajectory && trajectory.length > 1 && trajInfo.mappedPts.length > 1 && (() => {
              const pts = trajInfo.mappedPts;
              const pathD = pts
                .map((p, i) => `${i === 0 ? "M" : "L"}${p.x.toFixed(2)},${p.y.toFixed(2)}`)
                .join(" ");
              const arrowFracs = [0.15, 0.4, 0.65, 0.9];
              return (
                <g pointerEvents="none">
                  {/* Underlay glow */}
                  <path
                    d={pathD}
                    fill="none"
                    stroke="#7CFFB2"
                    strokeOpacity={0.22}
                    strokeWidth={4.5}
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    filter={`url(#${ID.softGlow})`}
                  />
                  {/* Top crisp stroke */}
                  <path
                    d={pathD}
                    fill="none"
                    stroke="#7CFFB2"
                    strokeWidth={1.6}
                    strokeOpacity={0.95}
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  />
                  {/* Arrowheads */}
                  {arrowFracs.map((f, k) => {
                    const idx = Math.floor(f * (pts.length - 1));
                    if (idx < 1) return null;
                    const p = pts[idx];
                    const pPrev = pts[idx - 1];
                    const dx = p.x - pPrev.x;
                    const dy = p.y - pPrev.y;
                    const len = Math.hypot(dx, dy);
                    if (len < 1) return null;
                    const ux = dx / len;
                    const uy = dy / len;
                    const back = 9;
                    const wide = 5.5;
                    const bx = p.x - ux * back;
                    const by = p.y - uy * back;
                    const lx = bx + uy * wide;
                    const ly = by - ux * wide;
                    const rx = bx - uy * wide;
                    const ry = by + ux * wide;
                    return (
                      <polygon
                        key={`arr-${k}`}
                        points={`${p.x},${p.y} ${lx},${ly} ${rx},${ry}`}
                        fill="#7CFFB2"
                        opacity={0.95}
                        filter={`url(#${ID.markerShadow})`}
                      />
                    );
                  })}
                  {/* Quarter-time markers */}
                  {quarterMarkers.map((q, k) => {
                    const p = pts[q.idx];
                    if (!p) return null;
                    const pPrev = pts[Math.max(0, q.idx - 1)];
                    const dx = p.x - pPrev.x;
                    const dy = p.y - pPrev.y;
                    const len = Math.hypot(dx, dy) || 1;
                    const ux = dx / len;
                    const uy = dy / len;
                    // Perpendicular tick
                    const tickLen = 5;
                    const tx1 = p.x + uy * tickLen;
                    const ty1 = p.y - ux * tickLen;
                    const tx2 = p.x - uy * tickLen;
                    const ty2 = p.y + ux * tickLen;
                    // Label offset
                    const labelOffsetX = uy * 11;
                    const labelOffsetY = -ux * 11;
                    return (
                      <g key={`qm-${k}`}>
                        <line
                          x1={tx1}
                          y1={ty1}
                          x2={tx2}
                          y2={ty2}
                          stroke="#bfead0"
                          strokeOpacity={0.8}
                          strokeWidth={1}
                        />
                        <text
                          x={p.x + labelOffsetX}
                          y={p.y + labelOffsetY + 3}
                          textAnchor="middle"
                          fontSize={8.5}
                          fill="#bfead0"
                          fontFamily="JetBrains Mono, monospace"
                          style={{
                            paintOrder: "stroke",
                            stroke: "rgba(10,15,30,0.92)",
                            strokeWidth: 3,
                          }}
                        >
                          {q.label}
                        </text>
                      </g>
                    );
                  })}
                  {/* Endpoint markers */}
                  {(() => {
                    const start = pts[0];
                    const end = pts[pts.length - 1];
                    const startLabelDX = start.x > heatLeft + innerW / 2 ? -10 : 10;
                    const endLabelDX = end.x > heatLeft + innerW / 2 ? -10 : 10;
                    return (
                      <g>
                        {/* t=0 open ring */}
                        <circle
                          cx={start.x}
                          cy={start.y}
                          r={4.5}
                          fill="none"
                          stroke="#7CFFB2"
                          strokeWidth={1.4}
                        />
                        <text
                          x={start.x + startLabelDX}
                          y={start.y + 14}
                          textAnchor={start.x > heatLeft + innerW / 2 ? "end" : "start"}
                          fontSize={9}
                          fill={palette.textMuted}
                          fontFamily="JetBrains Mono, monospace"
                          style={{
                            paintOrder: "stroke",
                            stroke: "rgba(10,15,30,0.95)",
                            strokeWidth: 3,
                          }}
                        >
                          t=0
                        </text>
                        {/* t=T solid disc */}
                        <circle
                          cx={end.x}
                          cy={end.y}
                          r={4.5}
                          fill="#7CFFB2"
                          stroke="#fff"
                          strokeWidth={1}
                        />
                        <text
                          x={end.x + endLabelDX}
                          y={end.y - 8}
                          textAnchor={end.x > heatLeft + innerW / 2 ? "end" : "start"}
                          fontSize={9}
                          fill={palette.textMuted}
                          fontFamily="JetBrains Mono, monospace"
                          style={{
                            paintOrder: "stroke",
                            stroke: "rgba(10,15,30,0.95)",
                            strokeWidth: 3,
                          }}
                        >
                          t=T
                        </text>
                      </g>
                    );
                  })()}
                </g>
              );
            })()}
          </g>

          {/* === Decorative frame === */}
          <rect
            x={heatLeft}
            y={heatTop}
            width={innerW}
            height={innerH}
            fill="none"
            stroke="#2a3358"
            strokeOpacity={0.55}
            rx={6}
          />

          {/* === Hover cell highlight === */}
          {hover && (
            <rect
              x={hover.px - cellW / 2}
              y={hover.py - cellH / 2}
              width={cellW}
              height={cellH}
              fill="none"
              stroke="#ffffff"
              strokeOpacity={0.85}
              strokeWidth={1.4}
              pointerEvents="none"
            />
          )}

          {/* === Picked-point crosshair-diamond + inline card === */}
          {pickReadout && (() => {
            const px = oToX(pickReadout.omega);
            const py = dToY(pickReadout.delta);
            // Diamond + crosshair
            const d10 = 7; // half-diagonal
            const tick = 4;
            const tickGap = 6;
            // Card placement — try NE, flip SW if too close to edges
            const cardW = 132;
            const cardH = 56;
            const tryNE = {
              x: px + 12,
              y: py - cardH - 8,
            };
            const flipSW = tryNE.x + cardW > heatRight - 6 || tryNE.y < heatTop + 6;
            const cardX = flipSW ? Math.max(heatLeft + 6, px - cardW - 12) : tryNE.x;
            const cardY = flipSW ? Math.min(heatBottom - cardH - 6, py + 12) : tryNE.y;
            return (
              <g pointerEvents="none">
                {/* Outer diamond */}
                <polygon
                  points={`${px},${py - d10} ${px + d10},${py} ${px},${py + d10} ${px - d10},${py}`}
                  fill="none"
                  stroke="#ffffff"
                  strokeWidth={1.2}
                />
                {/* Inner dot */}
                <circle cx={px} cy={py} r={1.5} fill="#ffffff" />
                {/* N/E/S/W tick stubs */}
                {[
                  [0, -tickGap, 0, -tickGap - tick],
                  [tickGap, 0, tickGap + tick, 0],
                  [0, tickGap, 0, tickGap + tick],
                  [-tickGap, 0, -tickGap - tick, 0],
                ].map(([dx1, dy1, dx2, dy2], k) => (
                  <line
                    key={`tick-${k}`}
                    x1={px + dx1}
                    y1={py + dy1}
                    x2={px + dx2}
                    y2={py + dy2}
                    stroke="#ffffff"
                    strokeOpacity={0.6}
                    strokeWidth={1}
                  />
                ))}
                {/* Value card */}
                <rect
                  x={cardX}
                  y={cardY}
                  width={cardW}
                  height={cardH}
                  rx={5}
                  fill="rgba(13,19,38,0.88)"
                  stroke={palette.queraPurpleSoft}
                  filter={`url(#${ID.markerShadow})`}
                />
                {[
                  { lbl: "Ω", val: pickReadout.omega.toFixed(3), color: AXIS_COLORS.omega },
                  { lbl: "Δ", val: pickReadout.delta.toFixed(3), color: AXIS_COLORS.delta },
                  { lbl: "⟨n⟩", val: pickReadout.meanN.toFixed(2), color: AXIS_COLORS.meanN },
                ].map((row, k) => {
                  const rowY = cardY + 8 + k * 16;
                  return (
                    <g key={`pickrow-${k}`}>
                      <rect
                        x={cardX + 6}
                        y={rowY}
                        width={2}
                        height={12}
                        fill={row.color}
                      />
                      <text
                        x={cardX + 12}
                        y={rowY + 10}
                        fontSize={10.5}
                        fill={palette.textPrimary}
                        fontFamily="JetBrains Mono, monospace"
                      >
                        <tspan style={{ fill: row.color, fontWeight: 700 }}>{row.lbl}</tspan>
                        <tspan dx={6}>= {row.val}</tspan>
                      </text>
                    </g>
                  );
                })}
              </g>
            );
          })()}

          {/* === Cursor diamond playhead on trajectory === */}
          {cursorSampleIdx >= 0 && trajInfo.mappedPts[cursorSampleIdx] && (() => {
            const p = trajInfo.mappedPts[cursorSampleIdx];
            return (
              <g pointerEvents="none">
                <circle cx={p.x} cy={p.y} r={12} fill={palette.warn} fillOpacity={0.18} />
                <rect
                  x={-3}
                  y={-3}
                  width={6}
                  height={6}
                  fill={palette.warn}
                  stroke="#fff8d6"
                  strokeWidth={0.8}
                  transform={`translate(${p.x},${p.y}) rotate(45)`}
                />
              </g>
            );
          })()}

          {/* === Axis ticks (Ω x-axis, under the strip) === */}
          {oTickValues.map((o, i) => {
            const x = oToX(o);
            return (
              <g key={`ox-${i}`}>
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
                  {o.toFixed(1)}
                </text>
              </g>
            );
          })}

          {/* === Axis ticks (Δ y-axis) === */}
          {dTickValues.map((d, i) => {
            const y = dToY(d);
            return (
              <g key={`dy-${i}`}>
                <text
                  x={heatLeft - 6}
                  y={y + 3}
                  textAnchor="end"
                  fontSize={10}
                  fill={palette.textSecondary}
                  fontFamily="JetBrains Mono, monospace"
                >
                  {d.toFixed(0)}
                </text>
              </g>
            );
          })}

          {/* === ⟨n⟩(t) strip === */}
          <MeanNStrip
            stripData={stripData}
            stripTop={stripTop}
            stripBottom={stripBottom}
            heatLeft={heatLeft}
            innerW={innerW}
            stripH={STRIP_H}
            nAtoms={n_atoms}
            cursorSampleIdx={cursorSampleIdx}
            trajectoryLen={trajectory?.length ?? 0}
            stripFillId={ID.stripFill}
            stripClipId={ID.clipStrip}
            glowFillId={ID.glow}
          />

          {/* X-axis caption */}
          <text
            x={heatLeft + innerW / 2}
            y={pixelHeight - 6}
            textAnchor="middle"
            fontSize={10.5}
            fill={palette.textMuted}
            letterSpacing={0.5}
            fontFamily="JetBrains Mono, monospace"
          >
            Ω (RAD / µs)
          </text>
        </svg>

        {/* Hover tooltip */}
        {hover && (
          <div
            role="tooltip"
            style={{
              position: "absolute",
              left: Math.min(hover.px + 14, pixelWidth - 220),
              top: Math.max(8, Math.min(hover.py + 10, pixelHeight - 130)),
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
                color: palette.textMuted,
                fontSize: 10,
                paddingBottom: 5,
                marginBottom: 5,
                boxShadow: "inset 0 -1px 0 rgba(122,140,200,0.18)",
              }}
            >
              cell ({hover.oi + 1}, {hover.di + 1})
            </div>
            {[
              { lbl: "Ω", val: hover.o.toFixed(3), color: AXIS_COLORS.omega },
              { lbl: "Δ", val: hover.d.toFixed(3), color: AXIS_COLORS.delta },
              { lbl: "⟨n⟩", val: hover.v.toFixed(2), color: AXIS_COLORS.meanN },
            ].map((row, k) => (
              <div
                key={`tt-${k}`}
                style={{
                  display: "flex",
                  justifyContent: "space-between",
                  paddingInlineStart: 8,
                  borderInlineStart: `2px solid ${row.color}`,
                  marginBlock: 2,
                }}
              >
                <span style={{ color: row.color, fontWeight: 600 }}>{row.lbl}</span>
                <span style={{ color: palette.textPrimary }}>{row.val}</span>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* === External legend panel === */}
      <PhaseLegend
        cursorReadout={cursorReadout}
        pickReadout={pickReadout}
        rampId={ID.ramp}
        arcLength={trajInfo.arcLength}
      />
    </div>
  );
}

// ---------------------------------------------------------------------------
// ⟨n⟩(t) mini-strip
// ---------------------------------------------------------------------------

function MeanNStrip({
  stripData,
  stripTop,
  stripBottom,
  heatLeft,
  innerW,
  stripH,
  nAtoms,
  cursorSampleIdx,
  trajectoryLen,
  stripFillId,
  stripClipId,
  glowFillId,
}: {
  stripData: { samples: { t: number; v: number }[]; tMin: number; tMax: number } | null;
  stripTop: number;
  stripBottom: number;
  heatLeft: number;
  innerW: number;
  stripH: number;
  nAtoms: number;
  cursorSampleIdx: number;
  trajectoryLen: number;
  stripFillId: string;
  stripClipId: string;
  glowFillId: string;
}) {
  if (!stripData || nAtoms <= 0) {
    return (
      <g>
        <rect
          x={heatLeft}
          y={stripTop}
          width={innerW}
          height={stripH}
          fill={`url(#${glowFillId})`}
          stroke="#2a3358"
          strokeOpacity={0.4}
          rx={4}
        />
        <text
          x={heatLeft + innerW / 2}
          y={stripTop + stripH / 2 + 3}
          textAnchor="middle"
          fontSize={10}
          fill={palette.textMuted}
          fontFamily="JetBrains Mono, monospace"
        >
          ⟨n⟩(t) — load a schedule to see the trajectory cross-section
        </text>
      </g>
    );
  }

  const { samples, tMin, tMax } = stripData;
  const tSpan = Math.max(1e-9, tMax - tMin);
  const tToX = (t: number) => heatLeft + ((t - tMin) / tSpan) * innerW;
  const yMaxLocal = Math.max(0.001, nAtoms);
  const vToY = (v: number) =>
    stripTop + (1 - Math.max(0, Math.min(yMaxLocal, v)) / yMaxLocal) * stripH;

  const linePts: string[] = [];
  const fillPts: string[] = [];
  for (let j = 0; j < samples.length; j++) {
    const x = tToX(samples[j].t);
    const y = vToY(samples[j].v);
    linePts.push(`${j === 0 ? "M" : "L"}${x.toFixed(2)},${y.toFixed(2)}`);
    fillPts.push(`${j === 0 ? "M" : "L"}${x.toFixed(2)},${y.toFixed(2)}`);
  }
  fillPts.push(`L${tToX(tMax).toFixed(2)},${stripBottom.toFixed(2)}`);
  fillPts.push(`L${tToX(tMin).toFixed(2)},${stripBottom.toFixed(2)} Z`);

  const cursorOK =
    cursorSampleIdx >= 0 && cursorSampleIdx < trajectoryLen && trajectoryLen > 0;
  const cursorT = cursorOK ? samples[Math.min(cursorSampleIdx, samples.length - 1)].t : null;
  const cursorV = cursorOK ? samples[Math.min(cursorSampleIdx, samples.length - 1)].v : null;

  return (
    <g>
      {/* Strip background frame */}
      <rect
        x={heatLeft}
        y={stripTop}
        width={innerW}
        height={stripH}
        fill={`url(#${glowFillId})`}
      />
      <g clipPath={`url(#${stripClipId})`}>
        {/* Phase-aware area fill */}
        <path d={fillPts.join(" ")} fill={`url(#${stripFillId})`} />
        {/* Curve on top */}
        <path
          d={linePts.join(" ")}
          fill="none"
          stroke="#e8f0ff"
          strokeWidth={1.4}
          strokeOpacity={0.92}
          strokeLinecap="round"
          strokeLinejoin="round"
        />
        {/* Cursor */}
        {cursorT != null && cursorV != null && (
          <g>
            <line
              x1={tToX(cursorT)}
              y1={stripTop}
              x2={tToX(cursorT)}
              y2={stripBottom}
              stroke={palette.warn}
              strokeOpacity={0.7}
              strokeWidth={1}
            />
            <rect
              x={-3}
              y={-3}
              width={6}
              height={6}
              fill={palette.warn}
              stroke="#fff8d6"
              strokeWidth={0.8}
              transform={`translate(${tToX(cursorT)},${vToY(cursorV)}) rotate(45)`}
            />
          </g>
        )}
      </g>
      {/* Strip frame stroke */}
      <rect
        x={heatLeft}
        y={stripTop}
        width={innerW}
        height={stripH}
        fill="none"
        stroke="#2a3358"
        strokeOpacity={0.4}
        rx={4}
      />
      {/* Title */}
      <text
        x={heatLeft + 8}
        y={stripTop + 12}
        fontSize={9.5}
        fill={palette.textMuted}
        fontFamily="JetBrains Mono, monospace"
        letterSpacing={0.4}
      >
        ⟨n⟩(t) — along trajectory
      </text>
      {/* y-tick labels (0 / N) on the right of the strip */}
      <text
        x={heatLeft + innerW - 6}
        y={stripTop + 11}
        textAnchor="end"
        fontSize={9}
        fill={palette.textMuted}
        fontFamily="JetBrains Mono, monospace"
      >
        N={nAtoms}
      </text>
      <text
        x={heatLeft + innerW - 6}
        y={stripBottom - 3}
        textAnchor="end"
        fontSize={9}
        fill={palette.textMuted}
        fontFamily="JetBrains Mono, monospace"
      >
        0
      </text>
    </g>
  );
}

// ---------------------------------------------------------------------------
// External legend panel
// ---------------------------------------------------------------------------

function PhaseLegend({
  cursorReadout,
  pickReadout,
  rampId,
  arcLength,
}: {
  cursorReadout: { omega: number; delta: number; meanN: number; t_us: number } | null;
  pickReadout: { omega: number; delta: number; meanN: number } | null;
  rampId: string;
  arcLength: number;
}) {
  const RAMP_BAR_H = 140;
  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        gap: 10,
        padding: "12px 14px",
        background: "linear-gradient(180deg, #11182c, #0d1325)",
        border: `1px solid ${palette.queraPurpleSoft}`,
        borderRadius: 12,
        minWidth: 206,
        maxWidth: 230,
        fontFeatureSettings: TABULAR_FIGURES,
      }}
    >
      {/* Header */}
      <div>
        <div
          style={{
            fontSize: 11,
            fontWeight: 700,
            color: palette.textPrimary,
            letterSpacing: 0.4,
            textTransform: "uppercase",
          }}
        >
          Phase map
        </div>
        <div style={{ fontSize: 9.5, color: palette.textMuted, marginTop: 2 }}>
          ground-state ⟨Σn⟩
        </div>
      </div>

      {/* Color ramp */}
      <div
        style={{
          paddingTop: 8,
          boxShadow: "inset 0 1px 0 rgba(122,140,200,0.18)",
          display: "flex",
          gap: 10,
          alignItems: "stretch",
        }}
      >
        <svg width={18} height={RAMP_BAR_H + 4} style={{ flexShrink: 0 }}>
          <rect
            x={2}
            y={2}
            width={14}
            height={RAMP_BAR_H}
            rx={3}
            fill={`url(#${rampId})`}
            stroke={palette.queraPurpleSoft}
          />
        </svg>
        <div
          style={{
            display: "flex",
            flexDirection: "column",
            justifyContent: "space-between",
            fontSize: 9.5,
            fontFamily: "JetBrains Mono, monospace",
            color: palette.textSecondary,
            paddingBlock: 2,
          }}
        >
          <span>N</span>
          <span>3N/4</span>
          <span>N/2</span>
          <span>N/4</span>
          <span>0</span>
        </div>
      </div>

      {/* Phase chips */}
      <div
        style={{
          paddingTop: 8,
          display: "flex",
          flexDirection: "column",
          gap: 8,
          boxShadow: "inset 0 1px 0 rgba(122,140,200,0.18)",
        }}
      >
        {[
          {
            label: "no Rydberg",
            sub: "⟨n⟩ < 0.5",
            color: CONTOUR_COLORS.vacuum,
          },
          {
            label: "Z₂ / MIS band",
            sub: "N/3 ≤ ⟨n⟩ ≤ 2N/3",
            color: CONTOUR_COLORS.midband,
          },
          {
            label: "fully excited",
            sub: "⟨n⟩ > 3N/4",
            color: CONTOUR_COLORS.full,
          },
        ].map((chip, i) => (
          <div
            key={`chip-${i}`}
            style={{
              paddingInlineStart: 10,
              borderInlineStart: `2px solid ${chip.color}`,
            }}
          >
            <div
              style={{
                fontFamily: "JetBrains Mono, monospace",
                fontSize: 11,
                color: chip.color,
                fontWeight: 600,
              }}
            >
              {chip.label}
            </div>
            <div style={{ fontSize: 9.5, color: palette.textMuted }}>
              {chip.sub}
            </div>
          </div>
        ))}
      </div>

      {/* Cursor card */}
      {cursorReadout && (
        <div
          style={{
            paddingTop: 8,
            boxShadow: "inset 0 1px 0 rgba(122,140,200,0.18)",
          }}
        >
          <div
            style={{
              fontSize: 9.5,
              color: palette.warn,
              fontFamily: "JetBrains Mono, monospace",
              marginBottom: 4,
            }}
          >
            at t = {cursorReadout.t_us.toFixed(2)} µs
          </div>
          {[
            { lbl: "Ω", val: cursorReadout.omega.toFixed(3), color: AXIS_COLORS.omega },
            { lbl: "Δ", val: cursorReadout.delta.toFixed(3), color: AXIS_COLORS.delta },
            { lbl: "⟨n⟩", val: cursorReadout.meanN.toFixed(2), color: AXIS_COLORS.meanN },
          ].map((row, k) => (
            <div
              key={`crow-${k}`}
              style={{
                display: "flex",
                justifyContent: "space-between",
                paddingInlineStart: 8,
                borderInlineStart: `2px solid ${row.color}`,
                marginBlock: 2,
                fontFamily: "JetBrains Mono, monospace",
                fontSize: 10.5,
              }}
            >
              <span style={{ color: row.color, fontWeight: 600 }}>{row.lbl}</span>
              <span style={{ color: palette.textPrimary }}>{row.val}</span>
            </div>
          ))}
        </div>
      )}

      {/* Pick card */}
      <div
        style={{
          paddingTop: 8,
          boxShadow: "inset 0 1px 0 rgba(122,140,200,0.18)",
        }}
      >
        <div
          style={{
            fontSize: 9.5,
            color: palette.queraPurpleGlow,
            fontFamily: "JetBrains Mono, monospace",
            marginBottom: 4,
          }}
        >
          ★ pinned
        </div>
        {pickReadout ? (
          [
            { lbl: "Ω", val: pickReadout.omega.toFixed(3), color: AXIS_COLORS.omega },
            { lbl: "Δ", val: pickReadout.delta.toFixed(3), color: AXIS_COLORS.delta },
            { lbl: "⟨n⟩", val: pickReadout.meanN.toFixed(2), color: AXIS_COLORS.meanN },
          ].map((row, k) => (
            <div
              key={`prow-${k}`}
              style={{
                display: "flex",
                justifyContent: "space-between",
                paddingInlineStart: 8,
                borderInlineStart: `2px solid ${row.color}`,
                marginBlock: 2,
                fontFamily: "JetBrains Mono, monospace",
                fontSize: 10.5,
              }}
            >
              <span style={{ color: row.color, fontWeight: 600 }}>{row.lbl}</span>
              <span style={{ color: palette.textPrimary }}>{row.val}</span>
            </div>
          ))
        ) : (
          <div
            style={{
              fontSize: 9.5,
              color: palette.textMuted,
              fontStyle: "italic",
              lineHeight: 1.4,
            }}
          >
            click heatmap to pin a point
          </div>
        )}
      </div>

      {/* Trajectory stats */}
      {arcLength > 0 && (
        <div
          style={{
            paddingTop: 8,
            boxShadow: "inset 0 1px 0 rgba(122,140,200,0.18)",
          }}
        >
          <div
            style={{
              fontSize: 9.5,
              color: palette.textMuted,
              fontFamily: "JetBrains Mono, monospace",
              textTransform: "uppercase",
              letterSpacing: 0.4,
            }}
          >
            schedule path
          </div>
          <div
            style={{
              fontSize: 10.5,
              fontFamily: "JetBrains Mono, monospace",
              color: palette.textPrimary,
              marginTop: 2,
            }}
          >
            arc ≈ {arcLength.toFixed(2)} (Ω,Δ)
          </div>
        </div>
      )}
    </div>
  );
}
