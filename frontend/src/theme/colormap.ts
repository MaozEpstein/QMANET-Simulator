/**
 * Perceptual colormaps for heatmap-style visualisations.
 *
 * The "inferno" ramp matches the one PhaseDiagram2D uses for ⟨n⟩ cells; reused
 * here so all of the project's heatmap visualisations stay visually coherent.
 * Input is normalised to [0, 1] (unlike PhaseDiagram2D's version which divides
 * by nAtoms — that's a different semantic for occupancy, not probability).
 */

const INFERNO_STOPS: { at: number; hex: string }[] = [
  { at: 0.0, hex: "#1b0c41" },
  { at: 0.33, hex: "#781c6d" },
  { at: 0.66, hex: "#ed6925" },
  { at: 1.0, hex: "#fcffa4" },
];

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

/** Inferno-style ramp for a probability in [0, 1]. */
export function infernoColor(v: number): string {
  const t = Math.max(0, Math.min(1, v));
  for (let i = 0; i < INFERNO_STOPS.length - 1; i++) {
    const a = INFERNO_STOPS[i];
    const b = INFERNO_STOPS[i + 1];
    if (t <= b.at) {
      const f = b.at > a.at ? (t - a.at) / (b.at - a.at) : 0;
      return mixHex(a.hex, b.hex, f);
    }
  }
  return INFERNO_STOPS[INFERNO_STOPS.length - 1].hex;
}
