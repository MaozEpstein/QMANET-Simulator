import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";
import type {
  ConflictGraphResponse,
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

/**
 * Stage 2 method. "direct" is the original clique↔MIS-on-complement track;
 * "conflict" builds the interference conflict graph F over the MANET's links
 * (Jain et al., MobiCom 2003) and runs the same complement+MIS machinery on
 * F instead of on the MANET graph itself. Each track keeps its own result
 * slot (see `misDirect`/`misConflict`) so switching between them never loses
 * work or forces a recompute of an already-fresh result.
 */
export type MisTrack = "direct" | "conflict";

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

/** Stage 7 post-process output, exposed for Stage 8 + persistence.
 *  Only the *summary* (best result indices/bitstring/size) is persisted to
 *  localStorage — the full shot batch lives in component-local state and is
 *  not worth the bytes across reloads. */
export interface PostProcessState {
  bestVMIS: number[];
  bestBitstring: string;
  bestSize: number;
  /** Best approximation ratio achieved across all shots — already in
   *  batch.summary.best_r_ratio, copied here for handoff to Stage 8 + UI. */
  bestRatio: number | null;
  /** Number of shots in the batch. Lets Stage 8's chip say "N shots". */
  nShots: number;
  generatedAt: string;
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

  /** Which Stage-2 method is active. Downstream stages (3–8) never read this
   *  directly — they consume `mis`, which always mirrors the active track's
   *  slot, so they stay generic over the method that produced it. */
  track: MisTrack;
  setTrack: (t: MisTrack) => void;

  /** Independent per-track result slots — see `MisTrack` doc comment. */
  misDirect: MISResponse | null;
  misConflict: MISResponse | null;
  /** Mirror of `track === "direct" ? misDirect : misConflict`. This is what
   *  every stage from 3 onward reads; kept in sync by `setMIS`/`setTrack` so
   *  those stages need no awareness of the two-track split. */
  mis: MISResponse | null;
  /** Writes into the *active* track's slot and refreshes the `mis` mirror. */
  setMIS: (m: MISResponse | null) => void;

  /** Stage-2 conflict-track intermediate: F, built from the MANET graph. */
  conflictGraph: ConflictGraphResponse | null;
  setConflictGraph: (c: ConflictGraphResponse | null) => void;
  /** Interference radius R' used to build the conflict graph. Defaults to
   *  the MANET's comm_radius the first time the conflict track is used. */
  interferenceRadius: number;
  setInterferenceRadius: (r: number) => void;

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

  postProcess: PostProcessState | null;
  setPostProcess: (p: PostProcessState | null) => void;

  /** Hashes of the upstream inputs that produced each derived state. Used by
   *  the stale-data banner system: a stage is considered "stale" if its stored
   *  hash differs from the live hash of its current upstream. */
  sourceHashes: SourceHashes;
  recordSourceHash: (key: keyof SourceHashes, hash: string) => void;
}

export interface SourceHashes {
  /** Keyed per Stage-2 track — each slot's freshness is judged against its
   *  own upstream (MANET graph for "direct"; MANET graph + interference
   *  radius for "conflict"), independent of which track is currently active. */
  mis?: { direct?: string; conflict?: string };
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
  // The active track's own upstream — "direct" depends only on the MANET
  // graph, "conflict" also depends on the interference radius used to build
  // F, so editing R' correctly flags the conflict-track MIS as stale even
  // when the MANET graph itself hasn't changed.
  const misUpstreamHash = state.manet
    ? state.track === "direct"
      ? stableHash(state.manet.graph)
      : stableHash({ graph: state.manet.graph, interferenceRadius: state.interferenceRadius })
    : undefined;
  const embedUpstreamHash = state.mis ? stableHash(state.mis.complement) : undefined;
  const scheduleUpstreamHash = state.embed
    ? stableHash({
        positions: state.embed.positions,
        blockade_radius_um: state.embed.blockade_radius_um,
      })
    : undefined;

  const misHash = h.mis?.[state.track];
  const misStale = !!state.mis && !!misHash && misHash !== misUpstreamHash;
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
      track: "conflict",
      setTrack: (t) =>
        set((state) => ({
          track: t,
          // Swap the mirror to whatever the other slot already holds — this
          // is what makes switching tracks free (no recompute) when a fresh
          // result is already cached there. If nothing is cached, `mis`
          // becomes null and Stage 2's effect will fetch it.
          mis: t === "direct" ? state.misDirect : state.misConflict,
          postProcess: null,
        })),
      misDirect: null,
      misConflict: null,
      mis: null,
      setMIS: (m) => {
        const track = get().track;
        const manetGraph = get().manet?.graph;
        const interferenceRadius = get().interferenceRadius;
        const upstreamHash = m
          ? track === "direct"
            ? stableHash(manetGraph ?? null)
            : stableHash({ graph: manetGraph ?? null, interferenceRadius })
          : undefined;
        set((state) => ({
          mis: m,
          misDirect: track === "direct" ? m : state.misDirect,
          misConflict: track === "conflict" ? m : state.misConflict,
          // MIS change cascades through embed/schedule/sim — drop the
          // post-process cache so Stage 8 doesn't route over a stale backbone.
          postProcess: null,
          sourceHashes: {
            ...state.sourceHashes,
            mis: { ...state.sourceHashes.mis, [track]: upstreamHash },
          },
        }));
      },
      conflictGraph: null,
      setConflictGraph: (c) => set({ conflictGraph: c }),
      interferenceRadius: 35,
      setInterferenceRadius: (r) => set({ interferenceRadius: r }),
      embed: null,
      // Changing the embed invalidates all schedule-derived analyses (positions
      // feed every diagonalisation).
      setEmbed: (e) => {
        const upstream = get().mis?.complement;
        set((state) => ({
          embed: e,
          scheduleAnalysis: { ...EMPTY_ANALYSIS },
          postProcess: null,
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
          postProcess: null,
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
      postProcess: null,
      setPostProcess: (p) => set({ postProcess: p }),
    }),
    {
      name: "qsim.pipeline.v1",
      storage: createJSONStorage(() => localStorage),
      // v2 added scheduleAnalysis (gap / spectrum / phase). v3 added the
      // Stage-2 conflict-graph track (`track`, `misDirect`/`misConflict`,
      // `conflictGraph`, `interferenceRadius`) alongside the pre-existing
      // `mis` field, which now acts as a mirror of the active slot.
      version: 3,
      migrate: (persisted: unknown, from) => {
        const p = (persisted ?? {}) as Record<string, unknown>;
        if (!("scheduleAnalysis" in p)) {
          p.scheduleAnalysis = { ...EMPTY_ANALYSIS };
        }
        if (from < 3) {
          // A pre-v3 payload's `mis` is the (only) direct-track result —
          // preserve it there and start the conflict track empty.
          p.track = "direct";
          p.misDirect = p.mis ?? null;
          p.misConflict = null;
          p.conflictGraph = null;
          const manet = p.manet as { config?: { comm_radius?: number } } | null | undefined;
          p.interferenceRadius = manet?.config?.comm_radius ?? 35;
          const sourceHashes = (p.sourceHashes ?? {}) as Record<string, unknown>;
          if (typeof sourceHashes.mis === "string") {
            sourceHashes.mis = { direct: sourceHashes.mis };
          }
          p.sourceHashes = sourceHashes;
        }
        return p;
      },
      // Persist the pipeline structure but NEVER the heavy frame array — a
      // 30-atom × 120-frame run is ~5 MB. On rehydrate we ship Stage 5 back
      // to "idle" so the UI doesn't show a stale "running" banner.
      partialize: (state) => ({
        currentStage: state.currentStage,
        manet: state.manet,
        track: state.track,
        mis: state.mis,
        misDirect: state.misDirect,
        misConflict: state.misConflict,
        conflictGraph: state.conflictGraph,
        interferenceRadius: state.interferenceRadius,
        embed: state.embed,
        schedule: state.schedule,
        sourceHashes: state.sourceHashes,
        // Lightweight (< 1 KB for N ≤ 28) — keeps Stage 8's quantum backbone
        // available after a reload without needing to re-run Stage 7.
        postProcess: state.postProcess,
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
