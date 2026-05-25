import type { MANETResponse } from "../api/rest";

export const STORAGE_KEY = "qsim.savedGraphs.v1";
export const SCHEMA_VERSION = 1 as const;

export interface SavedGraph {
  id: string;
  name: string;
  description: string;
  createdAt: string;
  schemaVersion: typeof SCHEMA_VERSION;
  payload: MANETResponse;
}

function getStorage(): Storage | null {
  try {
    if (typeof localStorage === "undefined") return null;
    return localStorage;
  } catch {
    return null;
  }
}

function readAll(): SavedGraph[] {
  const storage = getStorage();
  if (!storage) return [];
  const raw = storage.getItem(STORAGE_KEY);
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(isSavedGraph);
  } catch {
    return [];
  }
}

function writeAll(list: SavedGraph[]): void {
  const storage = getStorage();
  if (!storage) throw new Error("localStorage לא זמין בדפדפן הזה.");
  storage.setItem(STORAGE_KEY, JSON.stringify(list));
}

function makeId(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  return `g_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
}

function isSavedGraph(x: unknown): x is SavedGraph {
  if (!x || typeof x !== "object") return false;
  const o = x as Record<string, unknown>;
  if (typeof o.id !== "string") return false;
  if (typeof o.name !== "string") return false;
  if (typeof o.description !== "string") return false;
  if (typeof o.createdAt !== "string") return false;
  if (o.schemaVersion !== SCHEMA_VERSION) return false;
  return isMANETResponse(o.payload);
}

function isMANETResponse(x: unknown): x is MANETResponse {
  if (!x || typeof x !== "object") return false;
  const o = x as Record<string, unknown>;
  const graph = o.graph as Record<string, unknown> | undefined;
  const config = o.config as Record<string, unknown> | undefined;
  if (!graph || !config) return false;
  if (typeof graph.n_nodes !== "number") return false;
  if (!Array.isArray(graph.edges)) return false;
  if (typeof config.n_nodes !== "number") return false;
  if (typeof config.box_size !== "number") return false;
  if (typeof config.comm_radius !== "number") return false;
  return true;
}

export function listSaved(): SavedGraph[] {
  return readAll().sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

export function saveGraph(
  name: string,
  description: string,
  payload: MANETResponse,
): SavedGraph {
  const trimmedName = name.trim() || "ללא שם";
  const entry: SavedGraph = {
    id: makeId(),
    name: trimmedName,
    description: description.trim(),
    createdAt: new Date().toISOString(),
    schemaVersion: SCHEMA_VERSION,
    payload,
  };
  const list = readAll();
  list.push(entry);
  writeAll(list);
  return entry;
}

export function updateGraph(
  id: string,
  patch: Partial<Pick<SavedGraph, "name" | "description">>,
): void {
  const list = readAll();
  const idx = list.findIndex((g) => g.id === id);
  if (idx === -1) return;
  list[idx] = { ...list[idx], ...patch };
  writeAll(list);
}

export function deleteSaved(id: string): void {
  const list = readAll().filter((g) => g.id !== id);
  writeAll(list);
}

export function exportJSON(id: string): string {
  const entry = readAll().find((g) => g.id === id);
  if (!entry) throw new Error(`לא נמצא גרף עם id=${id}`);
  return JSON.stringify(entry, null, 2);
}

export function importJSON(text: string): SavedGraph {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch (e) {
    throw new Error(`JSON לא תקין: ${(e as Error).message}`);
  }
  if (!parsed || typeof parsed !== "object") {
    throw new Error("הקובץ אינו אובייקט JSON.");
  }
  const candidate = parsed as Record<string, unknown>;
  const payload = candidate.payload ?? parsed;
  if (!isMANETResponse(payload)) {
    throw new Error("הקובץ לא מכיל גרף MANET תקני (graph + config).");
  }
  const name =
    typeof candidate.name === "string" && candidate.name.trim()
      ? (candidate.name as string)
      : "מיובא";
  const description =
    typeof candidate.description === "string" ? (candidate.description as string) : "";
  return saveGraph(name, description, payload as MANETResponse);
}
