import { create } from "zustand";
import type {
  EmbedResponse,
  MANETResponse,
  MISResponse,
  ScheduleResponse,
  SimulationFrameDTO,
} from "../api/rest";

export interface SimulationState {
  frames: SimulationFrameDTO[];
  status: "idle" | "running" | "done" | "error";
  errorMessage?: string;
  currentFrameIndex: number;
}

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

  embed: EmbedResponse | null;
  setEmbed: (e: EmbedResponse | null) => void;

  schedule: ScheduleResponse | null;
  setSchedule: (s: ScheduleResponse | null) => void;

  simulation: SimulationState;
  resetSimulation: () => void;
  pushSimulationFrame: (f: SimulationFrameDTO) => void;
  setSimulationStatus: (s: SimulationState["status"], msg?: string) => void;
  setCurrentFrameIndex: (i: number) => void;
}

const EMPTY_SIM: SimulationState = {
  frames: [],
  status: "idle",
  currentFrameIndex: 0,
};

export const usePipeline = create<PipelineState>((set) => ({
  currentStage: "manet",
  setStage: (s) => set({ currentStage: s }),
  manet: null,
  setManet: (m) => set({ manet: m }),
  mis: null,
  setMIS: (m) => set({ mis: m }),
  embed: null,
  setEmbed: (e) => set({ embed: e }),
  schedule: null,
  setSchedule: (s) => set({ schedule: s }),
  simulation: { ...EMPTY_SIM },
  resetSimulation: () => set({ simulation: { ...EMPTY_SIM } }),
  pushSimulationFrame: (f) =>
    set((state) => ({
      simulation: {
        ...state.simulation,
        frames: [...state.simulation.frames, f],
        currentFrameIndex: state.simulation.frames.length, // points at the new frame
      },
    })),
  setSimulationStatus: (status, msg) =>
    set((state) => ({
      simulation: { ...state.simulation, status, errorMessage: msg },
    })),
  setCurrentFrameIndex: (i) =>
    set((state) => ({
      simulation: {
        ...state.simulation,
        currentFrameIndex: Math.max(
          0,
          Math.min(i, state.simulation.frames.length - 1),
        ),
      },
    })),
}));
