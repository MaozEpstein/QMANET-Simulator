/**
 * Live KaTeX rendering of the Rydberg Hamiltonian.
 *
 * Shows the symbolic form from Aquila §1.3 and, when the parent supplies
 * numeric values (sampled from a schedule at time t), renders a second line
 * with the values substituted.
 */

import { useEffect, useRef } from "react";
import katex from "katex";
import { palette } from "../theme/palette";

interface Props {
  /** Optional numeric sample: Ω, Δ, φ (in rad/µs, rad). When omitted, only the symbolic form is shown. */
  omega?: number;
  delta?: number;
  phi?: number;
  /** Atom count for context — used to display N in the sums. */
  nAtoms?: number;
  showTitle?: boolean;
}

const SYMBOLIC = String.raw`
H(t) = \frac{\Omega(t)}{2}\sum_{i=1}^{N}\left[e^{i\phi(t)}|g\rangle\langle r|_i + e^{-i\phi(t)}|r\rangle\langle g|_i\right]
- \Delta(t)\sum_{i=1}^{N}\hat n_i
+ \sum_{i<j}\frac{C_6}{|\vec x_i - \vec x_j|^6}\hat n_i \hat n_j
`;

function substituted(omega: number, delta: number, phi: number, n: number): string {
  const N = n.toString();
  // KaTeX is fine with \cdot for scalar multiplication
  return String.raw`
H(t_0) = \frac{${omega.toFixed(2)}}{2}\sum_{i=1}^{${N}}\left[e^{i\,${phi.toFixed(2)}}|g\rangle\langle r|_i + \text{h.c.}\right]
- (${delta.toFixed(2)})\sum_{i=1}^{${N}}\hat n_i
+ \sum_{i<j}\frac{C_6}{|\vec x_i - \vec x_j|^6}\hat n_i \hat n_j
`;
}

export function HamiltonianTeX({
  omega,
  delta,
  phi,
  nAtoms,
  showTitle = true,
}: Props) {
  const symRef = useRef<HTMLDivElement>(null);
  const subRef = useRef<HTMLDivElement>(null);

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
    </div>
  );
}
