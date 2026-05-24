/**
 * Publication-quality palette — anchored to QuEra's whitepaper navy + purple.
 * Use these tokens everywhere; do not hard-code colors in components.
 */

export const palette = {
  // Backgrounds
  bgDeep: "#0a0f1e",
  bgPanel: "#121a2e",
  bgPanelElevated: "#1a2440",
  bgInset: "#0f1426",

  // Foreground
  textPrimary: "#e8ecf5",
  textSecondary: "#9aa6bf",
  textMuted: "#5d6885",

  // Brand
  queraPurple: "#6b3fa0",
  queraPurpleGlow: "#b388ff",
  queraPurpleSoft: "#3a2861",

  // Atom states
  atomGround: "#3ed3ff", // dim cyan
  atomRydberg: "#b388ff", // glowing purple
  blockadeRing: "#b388ff",

  // Feedback
  ok: "#3ddc97",
  warn: "#ffb547",
  err: "#ff5470",

  // Plot palette (D3 viridis-ish, hand-tuned)
  plot: [
    "#b388ff",
    "#3ed3ff",
    "#ffb547",
    "#3ddc97",
    "#ff5470",
    "#9aa6bf",
  ],
} as const;

export type Palette = typeof palette;
