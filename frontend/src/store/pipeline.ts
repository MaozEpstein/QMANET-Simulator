import { create } from "zustand";
import type { MANETResponse, MISResponse } from "../api/rest";

export const STAGES = [
  { id: "manet", label: "MANET", he: "רשת ניידת" },
  { id: "complement", label: "Complement", he: "גרף משלים" },
  { id: "embedding", label: "Embedding", he: "השמת אטומים" },
  { id: "schedule", label: "Schedule", he: "פולס אדיאבטי" },
  { id: "evolution", label: "Evolution", he: "אבולוציה" },
  { id: "measurement", label: "Measurement", he: "מדידה" },
  { id: "postprocess", label: "Post-process", he: "תיקון" },
  { id: "routing", label: "Routing", he: "ניתוב" },
] as const;

export type StageId = (typeof STAGES)[number]["id"];

interface PipelineState {
  currentStage: StageId;
  setStage: (s: StageId) => void;

  manet: MANETResponse | null;
  setManet: (m: MANETResponse | null) => void;

  mis: MISResponse | null;
  setMIS: (m: MISResponse | null) => void;
}

export const usePipeline = create<PipelineState>((set) => ({
  currentStage: "manet",
  setStage: (s) => set({ currentStage: s }),
  manet: null,
  setManet: (m) => set({ manet: m }),
  mis: null,
  setMIS: (m) => set({ mis: m }),
}));
