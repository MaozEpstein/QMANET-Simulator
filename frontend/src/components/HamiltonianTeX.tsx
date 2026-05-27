/**
 * Live KaTeX rendering of the Rydberg Hamiltonian.
 *
 * Shows the symbolic form from Aquila §1.3 and, when the parent supplies
 * numeric values (sampled from a schedule at time t), renders a second line
 * with the values substituted.
 */

import { useEffect, useMemo, useRef } from "react";
import katex from "katex";
import { palette } from "../theme/palette";

/** Bloqade default — see backend/aquila/constants.py and README. */
const C6_RAD_PER_US_UM6 = 5_420_503;

interface Props {
  /** Optional numeric sample: Ω, Δ, φ (in rad/µs, rad). When omitted, only the symbolic form is shown. */
  omega?: number;
  delta?: number;
  phi?: number;
  /** Atom count for context — used to display N in the sums. */
  nAtoms?: number;
  /** Atom positions (µm). When provided, enables the magnitude breakdown bars. */
  positions?: { x: number; y: number }[];
  showTitle?: boolean;
}

const SYMBOLIC = String.raw`
H(t) = \frac{\Omega(t)}{2}\sum_{i=1}^{N}\left[e^{i\phi(t)}|g\rangle\langle r|_i + e^{-i\phi(t)}|r\rangle\langle g|_i\right]
- \Delta(t)\sum_{i=1}^{N}\hat n_i
+ \sum_{i<j}\frac{C_6}{|\vec x_i - \vec x_j|^6}\hat n_i \hat n_j
`;

function substituted(omega: number, delta: number, phi: number, n: number): string {
  const N = n.toString();
  // Color tokens kept in sync with palette.channelOmega/Delta/Phi (frontend/src/theme/palette.ts).
  // KaTeX renders raw hex codes via \textcolor{#rrggbb}{...}.
  const OMEGA_COLOR = "#3ed3ff";
  const DELTA_COLOR = "#b388ff";
  const PHI_COLOR = "#3ddc97";
  return String.raw`
H(t_0) = \frac{\textcolor{${OMEGA_COLOR}}{${omega.toFixed(2)}}}{2}\sum_{i=1}^{${N}}\left[e^{i\,\textcolor{${PHI_COLOR}}{${phi.toFixed(2)}}}|g\rangle\langle r|_i + \text{h.c.}\right]
- (\textcolor{${DELTA_COLOR}}{${delta.toFixed(2)}})\sum_{i=1}^{${N}}\hat n_i
+ \sum_{i<j}\frac{C_6}{|\vec x_i - \vec x_j|^6}\hat n_i \hat n_j
`;
}

export function HamiltonianTeX({
  omega,
  delta,
  phi,
  nAtoms,
  positions,
  showTitle = true,
}: Props) {
  const symRef = useRef<HTMLDivElement>(null);
  const subRef = useRef<HTMLDivElement>(null);

  // Pre-compute the pairwise V_ij = C6 / r_ij^6 sum once per positions change.
  // We surface (max V, sum V) since both have meaning: max V = the blockade
  // scale (sets R_b), sum V = the total interaction energy bound on a fully-
  // excited state. Pairs farther than ~10 µm contribute negligibly.
  const interaction = useMemo(() => {
    if (!positions || positions.length < 2) return { maxV: 0, sumV: 0, dominant: 0 };
    let maxV = 0;
    let sumV = 0;
    const threshold = 1; // rad/µs — pairs above this count as "dominant"
    let dominant = 0;
    for (let i = 0; i < positions.length; i++) {
      for (let j = i + 1; j < positions.length; j++) {
        const dx = positions[i].x - positions[j].x;
        const dy = positions[i].y - positions[j].y;
        const r2 = dx * dx + dy * dy;
        if (r2 <= 0) continue;
        const v = C6_RAD_PER_US_UM6 / Math.pow(r2, 3); // r^6 = (r^2)^3
        if (v > maxV) maxV = v;
        sumV += v;
        if (v > threshold) dominant++;
      }
    }
    return { maxV, sumV, dominant };
  }, [positions]);

  useEffect(() => {
    if (symRef.current) {
      katex.render(SYMBOLIC, symRef.current, {
        throwOnError: false,
        displayMode: true,
      });
    }
  }, []);

  useEffect(() => {
    if (subRef.current && omega !== undefined && delta !== undefined && phi !== undefined) {
      katex.render(substituted(omega, delta, phi, nAtoms ?? 0), subRef.current, {
        throwOnError: false,
        displayMode: true,
      });
    }
  }, [omega, delta, phi, nAtoms]);

  const hasNumeric =
    omega !== undefined && delta !== undefined && phi !== undefined;

  return (
    <div
      style={{
        background: palette.bgInset,
        border: `1px solid ${palette.queraPurpleSoft}`,
        borderRadius: 12,
        padding: "18px 22px",
        direction: "ltr",
      }}
    >
      {showTitle && (
        <div
          style={{
            fontSize: 12,
            color: palette.textMuted,
            marginBottom: 8,
            fontFamily: "JetBrains Mono",
          }}
        >
          Rydberg Hamiltonian · Aquila whitepaper §1.3
        </div>
      )}
      <div
        ref={symRef}
        data-testid="symbolic-hamiltonian"
        style={{ color: palette.textPrimary }}
      />
      {hasNumeric && (
        <>
          <div
            style={{
              fontSize: 12,
              color: palette.textMuted,
              marginTop: 18,
              marginBottom: 6,
              fontFamily: "JetBrains Mono",
            }}
          >
            substituted at t = t₀:
          </div>
          <div
            ref={subRef}
            data-testid="numeric-hamiltonian"
            style={{ color: palette.queraPurpleGlow }}
          />
        </>
      )}
      {hasNumeric && positions && positions.length >= 2 && (
        <ComponentMagnitudeBars
          omega={omega!}
          delta={delta!}
          maxV={interaction.maxV}
          sumV={interaction.sumV}
          dominantPairs={interaction.dominant}
          nAtoms={nAtoms ?? positions.length}
        />
      )}
    </div>
  );
}

/**
 * Three horizontal bars showing the *order of magnitude* of each Hamiltonian
 * term at the cursor time:
 *   • Drive       — Ω (the off-diagonal Rabi coupling per atom)
 *   • Detuning    — |Δ| (the diagonal site energy per atom)
 *   • Interaction — max V_ij (the strongest pairwise blockade)
 *
 * All three are in rad/µs so a shared linear x-axis is meaningful — the longest
 * bar is literally the dominant term in H(t). When the sweep starts Δ ≪ 0 so
 * the detuning bar dwarfs the others; near the avoided crossing the bars are
 * comparable; at the end of the sweep the interaction bar dominates. That
 * visual is exactly the adiabatic story.
 */
function ComponentMagnitudeBars({
  omega,
  delta,
  maxV,
  sumV,
  dominantPairs,
  nAtoms,
}: {
  omega: number;
  delta: number;
  maxV: number;
  sumV: number;
  dominantPairs: number;
  nAtoms: number;
}) {
  const driveMag = Math.abs(omega);
  const detMag = Math.abs(delta);
  const intMag = maxV;
  const scale = Math.max(driveMag, detMag, intMag, 1e-6);

  const rows = [
    {
      key: "drive",
      label: "Drive",
      symbol: "Ω",
      value: driveMag,
      formula: `${omega.toFixed(2)} rad/µs`,
      color: palette.channelOmega,
      hint: `per-atom Rabi coupling · N = ${nAtoms}`,
    },
    {
      key: "detuning",
      label: "Detuning",
      symbol: "|Δ|",
      value: detMag,
      formula: `${delta >= 0 ? "+" : ""}${delta.toFixed(2)} rad/µs`,
      color: palette.channelDelta,
      hint: delta < 0 ? "negative ⇒ ground favoured" : "positive ⇒ Rydberg favoured",
    },
    {
      key: "interaction",
      label: "Interaction",
      symbol: "max Vᵢⱼ",
      value: intMag,
      formula: `${intMag.toFixed(1)} rad/µs`,
      color: palette.warn,
      hint: `Σ V = ${sumV.toFixed(0)} · ${dominantPairs} blockade pairs`,
    },
  ];
  const dominantIdx = rows.reduce(
    (best, r, i) => (r.value > rows[best].value ? i : best),
    0,
  );

  return (
    <div
      style={{
        marginTop: 22,
        paddingTop: 14,
        borderTop: `1px solid ${palette.queraPurpleSoft}`,
        display: "flex",
        flexDirection: "column",
        gap: 8,
      }}
    >
      <div
        style={{
          fontSize: 11,
          color: palette.textMuted,
          fontFamily: "JetBrains Mono",
          letterSpacing: 0.4,
        }}
      >
        component magnitudes (rad/µs)
      </div>
      {rows.map((row, i) => {
        const widthPct = (row.value / scale) * 100;
        const isDominant = i === dominantIdx && row.value > 1e-6;
        return (
          <div key={row.key} style={{ display: "flex", flexDirection: "column", gap: 3 }}>
            <div
              style={{
                display: "flex",
                justifyContent: "space-between",
                fontSize: 11,
                fontFamily: "JetBrains Mono",
                alignItems: "baseline",
              }}
            >
              <span style={{ color: palette.textSecondary }}>
                <span style={{ color: row.color, fontWeight: 700 }}>{row.symbol}</span>
                <span style={{ marginInlineStart: 6 }}>{row.label}</span>
                {isDominant && (
                  <span
                    style={{
                      marginInlineStart: 8,
                      padding: "1px 6px",
                      borderRadius: 4,
                      background: row.color,
                      color: "#000",
                      fontSize: 9,
                      fontWeight: 700,
                      letterSpacing: 0.4,
                    }}
                  >
                    DOMINANT
                  </span>
                )}
              </span>
              <span style={{ color: row.color }}>{row.formula}</span>
            </div>
            <div
              style={{
                position: "relative",
                height: 8,
                background: palette.bgPanel,
                borderRadius: 999,
                overflow: "hidden",
                border: `1px solid ${palette.queraPurpleSoft}`,
              }}
            >
              <div
                style={{
                  width: `${widthPct}%`,
                  height: "100%",
                  background: `linear-gradient(90deg, ${row.color}, ${row.color}aa)`,
                  boxShadow: isDominant ? `0 0 10px ${row.color}` : "none",
                  transition: "width 280ms ease, box-shadow 280ms ease",
                }}
              />
            </div>
            <div style={{ fontSize: 10, color: palette.textMuted }} dir="ltr">
              {row.hint}
            </div>
          </div>
        );
      })}
    </div>
  );
}
