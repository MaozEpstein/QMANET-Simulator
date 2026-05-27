/**
 * One-shot "🚀 Run full pipeline" button for the header.
 *
 * Sequentially fires Stage 2→5 using the current Stage-1 graph (or loads a
 * default 4-cycle if none exists). Each step calls the same backend endpoints
 * each stage uses individually, populating the same store slots, so the user
 * can flip to any tab afterwards and see fresh, mutually consistent results.
 *
 * Cancellation: clicking the button while running prompts for confirmation
 * and aborts cooperatively — the in-flight WebSocket is closed immediately,
 * and the run loop checks a flag between steps. Already-completed steps
 * remain in the store (so the user can see how far it got).
 */

import { useCallback, useRef, useState } from "react";
import { api } from "../api/rest";
import { streamSimulation } from "../api/ws";
import type { EvolutionHandle } from "../api/ws";
import { buildC4Example } from "../lib/examples";
import { usePipeline } from "../store/pipeline";
import { palette } from "../theme/palette";

type Status =
  | { kind: "idle" }
  | { kind: "running"; step: number; label: string }
  | { kind: "done"; elapsedMs: number }
  | { kind: "error"; step: number; message: string }
  | { kind: "cancelled"; step: number };

const TOTAL_STEPS = 5;
const CANCELLED = Symbol("pipeline-cancelled");

export function RunPipelineButton() {
  const [status, setStatus] = useState<Status>({ kind: "idle" });
  // Mutable handles for the live run. Stored in refs so the cancel handler
  // can reach into them without re-creating the run callback on every render.
  const cancelFlagRef = useRef<{ aborted: boolean }>({ aborted: false });
  const liveWsRef = useRef<EvolutionHandle | null>(null);
  // When the user cancels during the Stage-5 WS step, the WebSocket close()
  // does NOT trigger onError → our Promise wrapper would hang. We store the
  // pending resolver here so requestCancel can short-circuit it directly.
  const wsResolverRef = useRef<(() => void) | null>(null);

  const run = useCallback(async () => {
    const t0 = performance.now();
    const flag = { aborted: false };
    cancelFlagRef.current = flag;
    let currentStep = 1;
    const setStep = (step: number, label: string) => {
      currentStep = step;
      setStatus({ kind: "running", step, label });
    };
    const checkpoint = () => {
      if (flag.aborted) throw CANCELLED;
    };

    try {
      setStep(1, "MANET");
      let manet = usePipeline.getState().manet;
      if (!manet) {
        manet = buildC4Example();
        usePipeline.getState().setManet(manet);
      }
      checkpoint();

      setStep(2, "MIS");
      const mis = await api.complement(manet.graph);
      checkpoint();
      usePipeline.getState().setMIS(mis);

      setStep(3, "Embedding");
      const embed = await api.embed({
        target_graph: mis.complement,
        config: { rabi_rad_us: 12.0, lattice_spacing_um: 5.0 },
      });
      checkpoint();
      usePipeline.getState().setEmbed(embed);

      setStep(4, "Schedule");
      const schedule = await api.schedule({ preset: "paper_linear_ramp" });
      checkpoint();
      usePipeline.getState().setSchedule(schedule);

      setStep(5, "Evolution");
      usePipeline.getState().resetSimulation();
      usePipeline.getState().setSimulationStatus("running");
      await new Promise<void>((resolve, reject) => {
        wsResolverRef.current = resolve;
        const handle = streamSimulation(
          {
            positions: embed.positions,
            schedule: schedule.schedule,
            n_frames: 80,
            track_bitstrings: true,
            top_k: 8,
          },
          {
            onFrame: (f) => usePipeline.getState().pushSimulationFrame(f),
            onDone: (info) => {
              if (info.final_bitstring_probs) {
                usePipeline.getState().setFinalBitstringProbs(info.final_bitstring_probs);
              }
              if (info.tracked_bitstrings) {
                usePipeline.getState().setTrackedBitstrings(info.tracked_bitstrings);
              }
              usePipeline.getState().setSimulationStatus("done");
              wsResolverRef.current = null;
              resolve();
            },
            onError: (msg) => {
              wsResolverRef.current = null;
              if (flag.aborted) {
                resolve();
                return;
              }
              usePipeline.getState().setSimulationStatus("error", msg);
              reject(new Error(msg));
            },
          },
        );
        liveWsRef.current = handle;
      });
      liveWsRef.current = null;
      checkpoint();

      usePipeline.getState().setStage("evolution");
      setStatus({ kind: "done", elapsedMs: performance.now() - t0 });
    } catch (e) {
      liveWsRef.current = null;
      if (e === CANCELLED) {
        // Roll Stage 5 status back to idle so the user sees a clean state.
        usePipeline.getState().setSimulationStatus("idle");
        setStatus({ kind: "cancelled", step: currentStep });
        return;
      }
      setStatus({
        kind: "error",
        step: currentStep,
        message: (e as Error).message,
      });
    }
  }, []);

  const requestCancel = useCallback(() => {
    if (!window.confirm("האם אתה בטוח שאתה רוצה לעצור את ההרצה?")) return;
    cancelFlagRef.current.aborted = true;
    liveWsRef.current?.close();
    liveWsRef.current = null;
    // Wake up the Stage-5 promise (manual close() doesn't fire onError).
    const r = wsResolverRef.current;
    wsResolverRef.current = null;
    if (r) r();
  }, []);

  const reset = useCallback(() => setStatus({ kind: "idle" }), []);

  const onClick =
    status.kind === "running"
      ? requestCancel
      : status.kind === "idle"
        ? run
        : reset;

  const label =
    status.kind === "running"
      ? `${status.step}/${TOTAL_STEPS}: ${status.label}…  ✕ עצור`
      : status.kind === "done"
        ? `✓ ${(status.elapsedMs / 1000).toFixed(1)}s`
        : status.kind === "error"
          ? `✕ שגיאה בשלב ${status.step}`
          : status.kind === "cancelled"
            ? `⏹ נעצר בשלב ${status.step}`
            : "🚀 הרץ צינור";

  const bg =
    status.kind === "running"
      ? palette.queraPurpleSoft
      : status.kind === "done"
        ? "rgba(61,220,151,0.15)"
        : status.kind === "error"
          ? "rgba(255,84,112,0.15)"
          : status.kind === "cancelled"
            ? "rgba(154,166,191,0.15)"
            : palette.queraPurple;
  const color =
    status.kind === "done"
      ? palette.ok
      : status.kind === "error"
        ? palette.err
        : status.kind === "cancelled"
          ? palette.textSecondary
          : "#fff";
  const borderColor =
    status.kind === "error"
      ? palette.err
      : status.kind === "running"
        ? palette.warn
        : palette.queraPurpleSoft;

  return (
    <button
      onClick={onClick}
      title={
        status.kind === "error"
          ? status.message
          : status.kind === "running"
            ? `לחץ כדי לעצור (שלב ${status.step}/${TOTAL_STEPS})`
            : "Run Stages 1-5 in sequence (default 4-cycle if no graph yet)"
      }
      style={{
        padding: "6px 14px",
        borderRadius: 6,
        border: `1px solid ${borderColor}`,
        background: bg,
        color,
        fontSize: 11.5,
        fontWeight: 600,
        cursor: "pointer",
      }}
    >
      {label}
    </button>
  );
}
