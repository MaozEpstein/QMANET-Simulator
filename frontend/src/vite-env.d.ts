/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** Base URL of the deployed backend (e.g. "https://qsimulator-backend.onrender.com").
   *  Leave unset for local dev — the Vite dev-server proxy (vite.config.ts)
   *  handles /api and /ws locally. See .env.example. */
  readonly VITE_API_URL?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
