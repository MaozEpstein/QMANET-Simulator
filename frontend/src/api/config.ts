/**
 * Backend base URL, resolved once at build/runtime.
 *
 * Local dev: left empty (""), so requests go out as relative paths (e.g.
 * `/api/manet/generate`) and Vite's dev-server proxy (vite.config.ts) routes
 * them to the local FastAPI backend on :8000 — no env var needed.
 *
 * Production (split deployment, e.g. Vercel frontend + Render backend):
 * set VITE_API_URL to the deployed backend's origin (no trailing slash),
 * e.g. `https://qsimulator-backend.onrender.com`. Vite only exposes env
 * vars prefixed `VITE_` to client code (see .env.example).
 */
export const API_BASE: string = import.meta.env.VITE_API_URL ?? "";

/**
 * WebSocket base, derived from API_BASE so the two never drift apart.
 * Falls back to the current page's own origin (matching the old
 * same-origin assumption) when API_BASE is empty — i.e. local dev via the
 * Vite proxy, which forwards /ws too.
 *
 * A function, not a precomputed constant: reads `window.location` at call
 * time rather than at module-import time, so it reflects the real page
 * origin (and stays testable against a stubbed `window`).
 */
export function getWsBase(): string {
  if (API_BASE) return API_BASE.replace(/^http/, "ws");
  return `${window.location.protocol === "https:" ? "wss:" : "ws:"}//${window.location.host}`;
}
