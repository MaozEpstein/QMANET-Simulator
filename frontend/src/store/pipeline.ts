import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";
import type {
  EmbedResponse,
  GapTraceDTO,
  MANETResponse,
  MISResponse,
  PhaseDiagramDTO,
  ScheduleResponse,
  SimulationFrameDTO,
  SpectrumTraceDTO,
} from "../api/rest";
import { stableHash } from "../lib/stageHash";

export interface SimulationState {
  frames: SimulationFrameDTO[];
  status: "idle" | "running" | "done" | "error";
  errorMessage?: string;
  currentFrameIndex: number;
  /** Populated once the simulation finishes — lets Stages 6 & 7 sample
   *  without re-running the (potentially expensive) sesolve. */
  finalBitstringProbs?: Record<string, number>;
  /** Per-frame probability time-series for the top-K bitstrings (by final
   *  probability). Only emitted by the backend at "done"; used by the
   *  bitstring-evolution heatmap. */
  trackedBitstrings?: Record<string, number[]>;
}

/**
 * Stage 4 spectral analyses. These are *derived* from the schedule + embed,
 * but each one costs the user ~30-120 sec (dense diagonalisation) so we keep
 * them in the store. That way navigating away to Stage 2 and back doesn't
 * discard a computation the user already paid for.
 *
 * Any change to schedule or embed invalidates all three; setSchedule and
 * setEmbed enforce that automatically so individual stage code doesn't have
 * to remember the cache-invalidation contract.
 */
export interface ScheduleAnalysis {
  gap: GapTraceDTO | null;
  gapTooMany: { n: number; max: number } | null;
  spectrum: SpectrumTraceDTO | null;
  spectrumTooMany: { n: number; max: number } | null;
  phase: PhaseDiagramDTO | null;
  phaseTooMany: { n: number; max: number } | null;
}

const EMPTY_ANALYSIS: ScheduleAnalysis = {
  gap: null,
  gapTooMany: null,
  spectrum: null,
  spectrumTooMany: null,
  phase: null,
  phaseTooMany: null,
};

export const STAGES = [
  { id: "manet", label: "MANET", he: "רשת ניידת" },
  { id: "complement", label: "Complement", he: "גרף משלים" },
  { id: "embedding", label: "Embedding", he: "השמת אטומים" },
  { id: "schedule", label: "Schedule", he: "פולס אדיאבטי" },
  { id: "evolution", label: "Sim + Hardware", he: "אבולוציה + חומרה" },
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

  scheduleAnalysis: ScheduleAnalysis;
  setGap: (gap: GapTraceDTO | null, tooMany?: { n: number; max: number } | null) => void;
  setSpectrum: (
    spectrum: SpectrumTraceDTO | null,
    tooMany?: { n: number; max: number } | null,
  ) => void;
  setPhase: (
    phase: PhaseDiagramDTO | null,
    tooMany?: { n: number; max: number } | null,
  ) => void;
  resetScheduleAnalysis: () => void;

  simulation: SimulationState;
  resetSimulation: () => void;
  pushSimulationFrame: (f: SimulationFrameDTO) => void;
  setSimulationFrames: (frames: SimulationFrameDTO[]) => void;
  setSimulationStatus: (s: SimulationState["status"], msg?: string) => void;
  setCurrentFrameIndex: (i: number) => void;
  setFinalBitstringProbs: (probs: Record<string, number> | undefined) => void;
  setTrackedBitstrings: (tracked: Record<string, number[]> | undefined) => void;

  /** Hashes of the upstream inputs that produced each derived state. Used by
   *  the stale-data banner system: a stage is considered "stale" if its stored
   *  hash differs from the live hash of its current upstream. */
  sourceHashes: SourceHashes;
  recordSourceHash: (key: keyof SourceHashes, hash: string) => void;
}

export interface SourceHashes {
  mis?: string;
  embed?: string;
  schedule?: string;
  simulation?: string;
}

const EMPTY_SIM: SimulationState = {
  frames: [],
  status: "idle",
  currentFrameIndex: 0,
};

/** Stages whose stored hash no longer matches their live upstream. Used by
 *  the StaleBanner. Returns a flag per derived stage — a downstream stage is
 *  also considered stale if any *upstream* stage is stale (cascade). */
export function selectStaleStages(state: PipelineState): {
  mis: boolean;
  embed: boolean;
  schedule: boolean;
  simulation: boolean;
} {
  const h = state.sourceHashes;
  const misUpstreamHash = state.manet ? stableHash(state.manet.graph) : undefined;
  const embedUpstreamHash = state.mis ? stableHash(state.mis.complement) : undefined;
  const scheduleUpstreamHash = state.embed
    ? stableHash({
        positions: state.embed.positions,
        blockade_radius_um: state.embed.blockade_radius_um,
      })
    : undefined;

  const misStale = !!state.mis && !!h.mis && h.mis !== misUpstreamHash;
  const embedStale = !!state.embed && !!h.embed && h.embed !== embedUpstreamHash;
  const scheduleStale =
    !!state.schedule && !!h.schedule && h.schedule !== scheduleUpstreamHash;

  // Simulation's upstream is (positions + schedule). We compare against the
  // hash recorded when the run was stored.
  const simulationUpstreamHash =
    state.embed && state.schedule
      ? stableHash({
          positions: state.embed.positions,
          schedule: state.schedule.schedule,
        })
      : undefined;
  const simulationStale =
    state.simulation.frames.length > 0 &&
    !!h.simulation &&
    h.simulation !== simulationUpstreamHash;

  // Cascade: if MIS is stale, embed is automatically stale (its upstream
  // moved out from under it), etc.
  return {
    mis: misStale,
    embed: misStale || embedStale,
    schedule: misStale || embedStale || scheduleStale,
    simulation: misStale || embedStale || scheduleStale || simulationStale,
  };
}

export const usePipeline = create<PipelineState>()(
  persist(
    (set, get) => ({
      currentStage: "manet",
      setStage: (s) => set({ currentStage: s }),
      manet: null,
      setManet: (m) => set({ manet: m }),
      mis: null,
      setMIS: (m) => {
        const upstream = get().manet?.graph;
        set((state) => ({
          mis: m,
          sourceHashes: {
            ...state.sourceHashes,
            mis: m ? stableHash(upstream ?? null) : undefined,
          },
        }));
      },
      embed: null,
      // Changing the embed invalidates all schedule-derived analyses (positions
      // feed every diagonalisation).
      setEmbed: (e) => {
        const upstream = get().mis?.complement;
        set((state) => ({
          embed: e,
          scheduleAnalysis: { ...EMPTY_ANALYSIS },
          sourceHashes: {
            ...state.sourceHashes,
            embed: e ? stableHash(upstream ?? null) : undefined,
          },
        }));
      },
      schedule: null,
      // Same contract for schedule changes — gap/spectrum/phase all depend on
      // Ω(t), Δ(t), φ(t).
      setSchedule: (s) => {
        const embed = get().embed;
        set((state) => ({
          schedule: s,
          scheduleAnalysis: { ...EMPTY_ANALYSIS },
          sourceHashes: {
            ...state.sourceHashes,
            schedule: s
              ? stableHash({
                  positions: embed?.positions ?? null,
                  blockade_radius_um: embed?.blockade_radius_um ?? null,
                })
              : undefined,
          },
        }));
      },
      scheduleAnalysis: { ...EMPTY_ANALYSIS },
      setGap: (gap, tooMany = null) =>
        set((state) => ({
          scheduleAnalysis: { ...state.scheduleAnalysis, gap, gapTooMany: tooMany },
        })),
      setSpectrum: (spectrum, tooMany = null) =>
        set((state) => ({
          scheduleAnalysis: {
            ...state.scheduleAnalysis,
            spectrum,
            spectrumTooMany: tooMany,
          },
        })),
      setPhase: (phase, tooMany = null) =>
        set((state) => ({
          scheduleAnalysis: { ...state.scheduleAnalysis, phase, phaseTooMany: tooMany },
        })),
      resetScheduleAnalysis: () => set({ scheduleAnalysis: { ...EMPTY_ANALYSIS } }),
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
      setSimulationFrames: (frames) =>
        set((state) => ({
          simulation: {
            ...state.simulation,
            frames,
            currentFrameIndex: Math.max(0, frames.length - 1),
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
      setFinalBitstringProbs: (probs) =>
        set((state) => ({
          simulation: { ...state.simulation, finalBitstringProbs: probs },
        })),
      setTrackedBitstrings: (tracked) =>
        set((state) => ({
          simulation: { ...state.simulation, trackedBitstrings: tracked },
        })),
      sourceHashes: {},
      recordSourceHash: (key, hash) =>
        set((state) => ({
          sourceHashes: { ...state.sourceHashes, [key]: hash },
        })),
    }),
    {
      name: "qsim.pipeline.v1",
      storage: createJSONStorage(() => localStorage),
      // v2 added scheduleAnalysis (gap / spectrum / phase). A v1 payload simply
      // didn't carry that field — merging it onto the runtime defaults gives
      // us the right behaviour (empty analysis, ready to be recomputed) without
      // wiping the rest of the user's pipeline.
      version: 2,
      migrate: (persisted: unknown, _from) => {
        const p = (persisted ?? {}) as Record<string, unknown>;
        if (!("scheduleAnalysis" in p)) {
          p.scheduleAnalysis = { ...EMPTY_ANALYSIS };
        }
        return p;
      },
      // Persist the pipeline structure but NEVER the heavy frame array — a
      // 30-atom × 120-frame run is ~5 MB. On rehydrate we ship Stage 5 back
      // to "idle" so the UI doesn't show a stale "running" banner.
      partialize: (state) => ({
        currentStage: state.currentStage,
        manet: state.manet,
        mis: state.mis,
        embed: state.embed,
        schedule: state.schedule,
        sourceHashes: state.sourceHashes,
        // Spectrum / gap / phase are small (< 5 KB combined) and each one
        // costs the user tens of seconds to recompute, so they ride along.
        scheduleAnalysis: state.scheduleAnalysis,
        simulation: {
          frames: [],
          status: "idle" as const,
          currentFrameIndex: 0,
          finalBitstringProbs: state.simulation.finalBitstringProbs,
          trackedBitstrings: state.simulation.trackedBitstrings,
        },
      }),
    },
  ),
);
