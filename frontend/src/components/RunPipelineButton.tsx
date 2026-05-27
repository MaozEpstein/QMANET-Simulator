/**
 * One-shot "🚀 Run full pipeline" button for the header.
 *
 * Sequentially fires Stage 2→5 using the current Stage-1 graph (or loads a
 * default 4-cycle if none exists). Each step calls the same backend endpoints
 * each stage uses individually, populating the same store slots, so the user
 * can flip to any tab afterwards and see fresh, mutually consistent results.
 *
 * On completion navigates to Stage 5 (where the most interesting output is).
 * On error: shows the failing step inline with a retry; the partial state in
 * the store stays so the user can see how far the pipeline got.
 */

import { useCallback, useState } from "react";
import { api } from "../api/rest";
import { streamSimulation } from "../api/ws";
import { buildC4Example } from "../lib/examples";
import { usePipeline } from "../store/pipeline";
import { palette } from "../theme/palette";

type Status =
  | { kind: "idle" }
  | { kind: "running"; step: number; label: string }
  | { kind: "done"; elapsedMs: number }
  | { kind: "error"; step: number; message: string };

const TOTAL_STEPS = 5;

export function RunPipelineButton() {
  const [status, setStatus] = useState<Status>({ kind: "idle" });

  const run = useCallback(async () => {
    const t0 = performance.now();
    let currentStep = 1;
    const setStep = (step: number, label: string) => {
      currentStep = step;
      setStatus({ kind: "running", step, label });
    };

    try {
      setStep(1, "MANET");
      let manet = usePipeline.getState().manet;
      if (!manet) {
        manet = buildC4Example();
        usePipeline.getState().setManet(manet);
      }

      setStep(2, "MIS");
      const mis = await api.complement(manet.graph);
      usePipeline.getState().setMIS(mis);

      setStep(3, "Embedding");
      const embed = await api.embed({
        target_graph: mis.complement,
        config: { rabi_rad_us: 12.0, lattice_spacing_um: 5.0 },
      });
      usePipeline.getState().setEmbed(embed);

      setStep(4, "Schedule");
      const schedule = await api.schedule({ preset: "paper_linear_ramp" });
      usePipeline.getState().setSchedule(schedule);

      setStep(5, "Evolution");
      usePipeline.getState().resetSimulation();
      usePipeline.getState().setSimulationStatus("running");
      await new Promise<void>((resolve, reject) => {
        streamSimulation(
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
              resolve();
            },
            onError: (msg) => {
              usePipeline.getState().setSimulationStatus("error", msg);
              reject(new Error(msg));
            },
          },
        );
      });

      usePipeline.getState().setStage("evolution");
      setStatus({ kind: "done", elapsedMs: performance.now() - t0 });
    } catch (e) {
      setStatus({
        kind: "error",
        step: currentStep,
        message: (e as Error).message,
      });
    }
  }, []);

  const reset = useCallback(() => setStatus({ kind: "idle" }), []);

  const label =
    status.kind === "running"
      ? `${status.step}/${TOTAL_STEPS}: ${status.label}…`
      : status.kind === "done"
        ? `✓ ${(status.elapsedMs / 1000).toFixed(1)}s`
        : status.kind === "error"
          ? `✕ שגיאה בשלב ${status.step}`
          : "🚀 הרץ צינור";

  const bg =
    status.kind === "running"
      ? palette.queraPurpleSoft
      : status.kind === "done"
        ? "rgba(61,220,151,0.15)"
        : status.kind === "error"
          ? "rgba(255,84,112,0.15)"
          : palette.queraPurple;
  const color =
    status.kind === "done" ? palette.ok : status.kind === "error" ? palette.err : "#fff";

  return (
    <button
      onClick={status.kind === "running" ? undefined : status.kind === "idle" ? run : reset}
      title={
        status.kind === "error"
          ? status.message
          : status.kind === "running"
            ? `Running step ${status.step}/${TOTAL_STEPS}`
            : "Run Stages 1-5 in sequence (default 4-cycle if no graph yet)"
      }
      disabled={status.kind === "running"}
      style={{
        padding: "6px 14px",
        borderRadius: 6,
        border: `1px solid ${status.kind === "error" ? palette.err : palette.queraPurpleSoft}`,
        background: bg,
        color,
        fontSize: 11.5,
        fontWeight: 600,
        cursor: status.kind === "running" ? "wait" : "pointer",
      }}
    >
      {label}
    </button>
  );
}
