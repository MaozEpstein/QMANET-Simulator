import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { motion } from "framer-motion";
import { AtomArray2D } from "../components/AtomArray2D";
import { BitstringEvolutionHeatmap } from "../components/BitstringEvolutionHeatmap";
import { BraketPanel } from "../components/BraketPanel";
import { EvolutionPlot, type OverlaySeries, type Milestone } from "../components/EvolutionPlot";
import { ExportButton } from "../components/ExportButton";
import { Panel } from "../components/Panel";
import { PulsePlot } from "../components/PulsePlot";
import { Slider } from "../components/Slider";
import { streamSimulation } from "../api/ws";
import type { EvolutionHandle } from "../api/ws";
import { selectStaleStages, usePipeline } from "../store/pipeline";
import { StaleBanner } from "../components/StaleBanner";
import { stableHash } from "../lib/stageHash";
import { palette } from "../theme/palette";
import { computeMisMetrics, type Edge } from "../lib/misMetrics";
import { getCachedRun, makeRunKey, setCachedRun } from "../lib/simulationCache";
import { api, type NoiseConfigDTO, type SweepPoint } from "../api/rest";

type OverlayKey = "none" | "gap" | "fidelity" | "energy" | "purity";

const DEFAULT_NOISE: NoiseConfigDTO = { enabled: false, t1_us: 30, t2_us: 4 };

export function Stage5_Evolution() {
  const {
    embed,
    schedule,
    mis,
    simulation,
    resetSimulation,
    pushSimulationFrame,
    setSimulationFrames,
    setSimulationStatus,
    setCurrentFrameIndex,
    setFinalBitstringProbs,
    setTrackedBitstrings,
  } = usePipeline();
  const recordSourceHash = usePipeline((s) => s.recordSourceHash);
  const staleSim = usePipeline((s) => selectStaleStages(s).simulation);
  const [cacheHit, setCacheHit] = useState(false);
  const [noise, setNoise] = useState<NoiseConfigDTO>(DEFAULT_NOISE);
  const [nFrames, setNFrames] = useState(80);
  const [nFramesTouched, setNFramesTouched] = useState(false);

  // Smart default: scale frame count with schedule duration so short pulses
  // don't waste extras compute and long pulses keep enough resolution for
  // gap-minimum detection. Capped at 120 to bound the worst case for N=10.
  // Stops adapting once the user has manually moved the slider.
  useEffect(() => {
    if (nFramesTouched) return;
    const T = schedule?.schedule.duration;
    if (!T || T <= 0) return;
    const recommended = Math.min(120, Math.max(60, Math.round(20 * T)));
    setNFrames(recommended);
  }, [schedule?.schedule.duration, nFramesTouched]);
  const [autoPlay, setAutoPlay] = useState(true);
  const [speed, setSpeed] = useState(1);
  const [loop, setLoop] = useState(true);
  const [overlayKey, setOverlayKey] = useState<OverlayKey>("gap");
  const [selectedAtom, setSelectedAtom] = useState<number | null>(null);
  const [runStartMs, setRunStartMs] = useState<number | null>(null);
  const [firstFrameMs, setFirstFrameMs] = useState<number | null>(null);
  const handleRef = useRef<EvolutionHandle | null>(null);
  const playAccumRef = useRef<number>(0);

  const startStream = useCallback(
    (forceRerun = false) => {
      if (!embed || !schedule) return;
      handleRef.current?.close();
      resetSimulation();
      setCacheHit(false);
      setTrackedBitstrings(undefined);
      const key = makeRunKey(embed.positions, schedule.schedule, nFrames, noise);
      if (!forceRerun) {
        const cached = getCachedRun(key);
        if (cached) {
          setSimulationFrames(cached.frames);
          if (cached.finalBitstringProbs) {
            setFinalBitstringProbs(cached.finalBitstringProbs);
          }
          if (cached.trackedBitstrings) {
            setTrackedBitstrings(cached.trackedBitstrings);
          }
          setSimulationStatus("done");
          recordSourceHash(
            "simulation",
            stableHash({
              positions: embed.positions,
              schedule: schedule.schedule,
            }),
          );
          setCacheHit(true);
          return;
        }
      }
      setSimulationStatus("running");
      setRunStartMs(performance.now());
      setFirstFrameMs(null);
      const collected: import("../api/rest").SimulationFrameDTO[] = [];
      handleRef.current = streamSimulation(
        {
          positions: embed.positions,
          schedule: schedule.schedule,
          n_frames: nFrames,
          noise: noise.enabled ? noise : null,
          track_bitstrings: true,
          top_k: 8,
        },
        {
          onFrame: (f) => {
            setFirstFrameMs((prev) => prev ?? performance.now());
            collected.push(f);
            pushSimulationFrame(f);
          },
          onDone: (info) => {
            if (info.final_bitstring_probs) {
              setFinalBitstringProbs(info.final_bitstring_probs);
            }
            if (info.tracked_bitstrings) {
              setTrackedBitstrings(info.tracked_bitstrings);
            }
            setSimulationStatus("done");
            recordSourceHash(
              "simulation",
              stableHash({
                positions: embed.positions,
                schedule: schedule.schedule,
              }),
            );
            setCachedRun(key, {
              frames: collected,
              finalBitstringProbs: info.final_bitstring_probs,
              trackedBitstrings: info.tracked_bitstrings,
            });
          },
          onError: (msg) => setSimulationStatus("error", msg),
        },
      );
    },
    [
      embed,
      schedule,
      nFrames,
      noise,
      resetSimulation,
      pushSimulationFrame,
      setSimulationFrames,
      setSimulationStatus,
      setFinalBitstringProbs,
      setTrackedBitstrings,
    ],
  );

  const cancelStream = useCallback(() => {
    handleRef.current?.close();
    handleRef.current = null;
    setSimulationStatus("idle");
    setRunStartMs(null);
  }, [setSimulationStatus]);

  useEffect(() => {
    return () => {
      handleRef.current?.close();
    };
  }, []);

  // Auto-restore from cache on mount (or when embed/schedule change), but only
  // if the store is empty for this stage — we don't want to clobber a run the
  // user is already looking at. This is what makes "switch tab and come back"
  // feel instant.
  useEffect(() => {
    if (!embed || !schedule) return;
    if (simulation.frames.length > 0) return;
    if (simulation.status === "running") return;
    const key = makeRunKey(embed.positions, schedule.schedule, nFrames, noise);
    const cached = getCachedRun(key);
    if (cached) {
      setSimulationFrames(cached.frames);
      if (cached.finalBitstringProbs) {
        setFinalBitstringProbs(cached.finalBitstringProbs);
      }
      if (cached.trackedBitstrings) {
        setTrackedBitstrings(cached.trackedBitstrings);
      }
      setSimulationStatus("done");
      recordSourceHash(
        "simulation",
        stableHash({
          positions: embed.positions,
          schedule: schedule.schedule,
        }),
      );
      setCacheHit(true);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [embed, schedule, nFrames, noise]);

  // Animation loop using rAF (smoother than setInterval, respects speed).
  useEffect(() => {
    if (!autoPlay) return;
    const totalFrames = simulation.frames.length;
    if (totalFrames === 0) return;
    let raf = 0;
    let last = performance.now();
    playAccumRef.current = 0;
    const FRAMES_PER_SEC = 30;
    const tick = (now: number) => {
      const dt = (now - last) / 1000;
      last = now;
      playAccumRef.current += dt * FRAMES_PER_SEC * speed;
      while (playAccumRef.current >= 1) {
        playAccumRef.current -= 1;
        const state = usePipeline.getState().simulation;
        const total = state.frames.length;
        if (total === 0) break;
        const next = state.currentFrameIndex + 1;
        if (next >= total) {
          if (loop) setCurrentFrameIndex(0);
          else {
            setAutoPlay(false);
            return;
          }
        } else {
          setCurrentFrameIndex(next);
        }
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [autoPlay, speed, loop, simulation.frames.length, setCurrentFrameIndex]);

  // Keyboard shortcuts
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const tag = (document.activeElement?.tagName ?? "").toLowerCase();
      if (tag === "input" || tag === "textarea" || tag === "select") return;
      const total = usePipeline.getState().simulation.frames.length;
      if (total === 0 && e.code !== "Space") return;
      const idx = usePipeline.getState().simulation.currentFrameIndex;
      const step = e.shiftKey ? 10 : 1;
      switch (e.code) {
        case "Space":
          e.preventDefault();
          setAutoPlay((v) => !v);
          break;
        case "ArrowLeft":
          e.preventDefault();
          setAutoPlay(false);
          setCurrentFrameIndex(Math.max(0, idx - step));
          break;
        case "ArrowRight":
          e.preventDefault();
          setAutoPlay(false);
          setCurrentFrameIndex(Math.min(total - 1, idx + step));
          break;
        case "Home":
          e.preventDefault();
          setAutoPlay(false);
          setCurrentFrameIndex(0);
          break;
        case "End":
          e.preventDefault();
          setAutoPlay(false);
          setCurrentFrameIndex(total - 1);
          break;
        case "Digit0":
          setSpeed(1);
          break;
        default:
          break;
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [setCurrentFrameIndex]);

  const currentFrame =
    simulation.frames[Math.min(simulation.currentFrameIndex, simulation.frames.length - 1)];

  const populations = useMemo(
    () => currentFrame?.rydberg_populations ?? [],
    [currentFrame],
  );

  // Derived series across frames
  const gapValues = useMemo(
    () => simulation.frames.map((f) => f.gap ?? null),
    [simulation.frames],
  );
  const fidelityValues = useMemo(
    () => simulation.frames.map((f) => f.fidelity_gs ?? null),
    [simulation.frames],
  );
  const energyValues = useMemo(
    () => simulation.frames.map((f) => f.energy_expect ?? null),
    [simulation.frames],
  );
  const purityValues = useMemo(
    () => simulation.frames.map((f) => f.purity ?? null),
    [simulation.frames],
  );
  const nTotalValues = useMemo(
    () =>
      simulation.frames.map((f) =>
        f.rydberg_populations.reduce((a, b) => a + b, 0),
      ),
    [simulation.frames],
  );

  const minGap = useMemo(() => argMinFinite(gapValues), [gapValues]);
  const minFidelity = useMemo(() => argMinFinite(fidelityValues), [fidelityValues]);

  const overlay: OverlaySeries | null = useMemo(() => {
    if (overlayKey === "gap")
      return {
        label: "Δ_gap (rad/µs)",
        values: gapValues,
        color: palette.warn,
        format: (v) => v.toFixed(2),
      };
    if (overlayKey === "fidelity")
      return {
        label: "F = |⟨GS|ψ⟩|²",
        values: fidelityValues,
        color: palette.ok,
        yDomain: [0, 1.02],
        format: (v) => v.toFixed(3),
      };
    if (overlayKey === "energy")
      return {
        label: "⟨H⟩ (rad/µs)",
        values: energyValues,
        color: palette.channelDelta,
        format: (v) => v.toFixed(2),
      };
    if (overlayKey === "purity")
      return {
        label: "Tr(ρ²)",
        values: purityValues,
        color: palette.warn,
        yDomain: [0, 1.02],
        format: (v) => v.toFixed(3),
      };
    return null;
  }, [overlayKey, gapValues, fidelityValues, energyValues, purityValues]);

  const milestones: Milestone[] = useMemo(() => {
    const m: Milestone[] = [];
    if (minGap && minGap.index >= 0) {
      m.push({
        frameIndex: minGap.index,
        label: `Δ_min ≈ ${minGap.value.toFixed(3)} rad/µs`,
        color: palette.err,
      });
    }
    if (
      minFidelity &&
      minFidelity.index >= 0 &&
      minFidelity.value < 0.99
    ) {
      m.push({
        frameIndex: minFidelity.index,
        label: `F_min ≈ ${minFidelity.value.toFixed(3)}`,
        color: palette.warn,
      });
    }
    return m;
  }, [minGap, minFidelity]);

  // ETA (only while running, after first frame arrived)
  const eta = useMemo(() => {
    if (
      simulation.status !== "running" ||
      simulation.frames.length === 0 ||
      firstFrameMs === null ||
      runStartMs === null
    )
      return null;
    const elapsed = performance.now() - firstFrameMs;
    const perFrame = elapsed / Math.max(1, simulation.frames.length);
    const remaining = Math.max(0, nFrames - simulation.frames.length) * perFrame;
    return remaining / 1000;
  }, [simulation.status, simulation.frames.length, firstFrameMs, runStartMs, nFrames]);

  // Solution quality (only when done)
  const inducedEdges: Edge[] = useMemo(
    () => (embed?.induced_edges ?? []) as Edge[],
    [embed?.induced_edges],
  );
  const targetMisSize = mis?.size ?? null;
  const quality = useMemo(() => {
    if (!simulation.finalBitstringProbs) return null;
    return computeMisMetrics(simulation.finalBitstringProbs, inducedEdges, targetMisSize, 5);
  }, [simulation.finalBitstringProbs, inducedEdges, targetMisSize]);

  if (!embed || !schedule) {
    return (
      <Panel title="שלב 5 · אבולוציה אדיאבטית">
        <div style={{ color: palette.textSecondary }}>
          השלם תחילה את שלבים 3 (השמת אטומים) ו-4 (פולס).
        </div>
      </Panel>
    );
  }

  const isRunning = simulation.status === "running";

  return (
    <motion.div
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.4 }}
      style={{ display: "grid", gap: 16 }}
    >
      {staleSim && (
        <StaleBanner
          upstreamLabel="המיקומים או ה-pulse (שלבים 3-4)"
          actionLabel="הרץ אבולוציה מחדש"
          onAction={() => startStream(true)}
        />
      )}
      <Panel
        title="שלב 5 · אבולוציה אדיאבטית בזמן אמת"
        subtitle={`Schrödinger evolution תחת H(t) הנוכחי · QuTiP sesolve · ${embed.n_atoms} אטומים`}
        right={
          <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
            <ExportButton
              filename="evolution"
              data={
                simulation.frames.length > 0
                  ? { frames: simulation.frames, atoms: embed.positions }
                  : null
              }
            />
            {cacheHit && simulation.status === "done" && (
              <span
                title="הוחזר מקאש — לא רצה QuTiP מחדש"
                style={{
                  padding: "4px 10px",
                  fontSize: 11,
                  background: "rgba(61,220,151,0.1)",
                  border: `1px solid ${palette.ok}`,
                  color: palette.ok,
                  borderRadius: 8,
                  fontFamily: "JetBrains Mono",
                }}
              >
                ⚡ cached
              </span>
            )}
            <StatusBadge
              status={simulation.status}
              message={simulation.errorMessage}
              eta={eta}
            />
          </div>
        }
      >
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "minmax(280px, 360px) 1fr",
            gap: 24,
            alignItems: "start",
          }}
        >
          <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
            <Slider
              label="מס׳ פריימים"
              value={nFrames}
              onChange={(v) => {
                setNFramesTouched(true);
                setNFrames(v);
              }}
              min={20}
              max={300}
              step={10}
            />

            <div style={{ display: "flex", gap: 8 }}>
              <button
                onClick={() => startStream(true)}
                disabled={isRunning}
                style={{
                  flex: 1,
                  padding: "10px 16px",
                  background: palette.queraPurple,
                  color: "#fff",
                  border: "none",
                  borderRadius: 8,
                  fontWeight: 600,
                  cursor: isRunning ? "wait" : "pointer",
                }}
              >
                {isRunning ? "מריץ…" : "↻ הרץ אבולוציה"}
              </button>
              {isRunning && (
                <button
                  onClick={cancelStream}
                  style={{
                    padding: "10px 14px",
                    background: "transparent",
                    color: palette.err,
                    border: `1px solid ${palette.err}`,
                    borderRadius: 8,
                    fontWeight: 600,
                    cursor: "pointer",
                  }}
                >
                  ✕ בטל
                </button>
              )}
            </div>

            {simulation.status === "error" && simulation.errorMessage && (
              <div
                style={{
                  padding: 10,
                  background: "rgba(255,84,112,0.1)",
                  border: `1px solid ${palette.err}`,
                  borderRadius: 8,
                  color: palette.err,
                  fontSize: 12,
                  display: "flex",
                  justifyContent: "space-between",
                  alignItems: "center",
                  gap: 8,
                }}
              >
                <span>✕ {simulation.errorMessage}</span>
                <button
                  onClick={() => startStream(true)}
                  style={{
                    padding: "4px 10px",
                    background: palette.err,
                    color: "#fff",
                    border: "none",
                    borderRadius: 6,
                    cursor: "pointer",
                    fontSize: 12,
                  }}
                >
                  נסה שוב
                </button>
              </div>
            )}

            <NoisePanel noise={noise} setNoise={setNoise} />

            <KPICards
              t={currentFrame?.t_us ?? 0}
              norm={currentFrame?.norm ?? 1}
              nTotal={populations.reduce((a, b) => a + b, 0)}
              gap={currentFrame?.gap ?? null}
              fidelity={currentFrame?.fidelity_gs ?? null}
              energy={currentFrame?.energy_expect ?? null}
              purity={currentFrame?.purity ?? null}
              gapHistory={gapValues}
              fidelityHistory={fidelityValues}
              energyHistory={energyValues}
              purityHistory={purityValues}
              nTotalHistory={nTotalValues}
            />

            <PlaybackToolbar
              autoPlay={autoPlay}
              setAutoPlay={setAutoPlay}
              speed={speed}
              setSpeed={setSpeed}
              loop={loop}
              setLoop={setLoop}
              frameIndex={simulation.currentFrameIndex}
              totalFrames={simulation.frames.length}
              setIndex={setCurrentFrameIndex}
            />

            <div
              style={{
                fontSize: 10.5,
                color: palette.textMuted,
                lineHeight: 1.5,
              }}
            >
              ⌨ Space=נגן/עצור · ←/→ frame · Shift+←/→ קפיצת 10 · Home/End · 0 איפוס מהירות
            </div>
          </div>

          <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
            <AtomArray2D
              atoms={embed.positions}
              blockadeRadiusUm={embed.blockade_radius_um}
              edges={embed.induced_edges}
              latticeSpacingUm={5}
              populations={populations}
              caption={`t = ${currentFrame?.t_us.toFixed(3) ?? 0} µs · live`}
              pixelWidth={620}
              pixelHeight={520}
              onAtomClick={(id) =>
                setSelectedAtom((prev) => (prev === id ? null : id))
              }
              selectedAtom={selectedAtom}
            />
            {selectedAtom !== null && simulation.frames.length > 0 && (
              <AtomInspector
                atomId={selectedAtom}
                frames={simulation.frames}
                currentFrameIndex={simulation.currentFrameIndex}
                onClose={() => setSelectedAtom(null)}
              />
            )}
          </div>
        </div>
      </Panel>

      {simulation.frames.length > 0 && (
        <Panel
          title="Schedule + populations · synced cursor"
          subtitle="הסטריפ העליון = ה-pulse של שלב 4 בציר זמן זהה. גרור על כל אחד מהגרפים כדי לסקרב."
          right={
            <OverlayChips current={overlayKey} setCurrent={setOverlayKey} />
          }
        >
          <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            <PulsePlot
              channels={[
                {
                  data: schedule.schedule.omega,
                  label: "Ω(t)",
                  units: "rad/µs",
                  color: palette.channelOmega,
                },
                {
                  data: schedule.schedule.delta,
                  label: "Δ(t)",
                  units: "rad/µs",
                  color: palette.channelDelta,
                },
              ]}
              totalDurationUs={schedule.schedule.duration}
              pixelWidth={820}
              channelHeight={58}
              cursorT={currentFrame?.t_us}
              onCursorChange={(t) => {
                setAutoPlay(false);
                const i = nearestFrameIndex(simulation.frames, t);
                if (i >= 0) setCurrentFrameIndex(i);
              }}
            />
            <EvolutionPlot
              frames={simulation.frames}
              totalDurationUs={schedule.schedule.duration}
              currentFrameIndex={simulation.currentFrameIndex}
              onScrub={(i) => {
                setAutoPlay(false);
                setCurrentFrameIndex(i);
              }}
              pixelWidth={820}
              pixelHeight={280}
              overlay={overlay}
              milestones={milestones}
            />
          </div>
        </Panel>
      )}

      {simulation.trackedBitstrings &&
        Object.keys(simulation.trackedBitstrings).length > 0 && (
          <Panel
            title="התפלגות bitstrings לאורך זמן"
            subtitle="כל שורה = bitstring מהטופ-K לפי הסתברות סופית. צבע = הסתברות. ✓ ירוק = MIS אופטימלי."
          >
            <BitstringEvolutionHeatmap
              trackedBitstrings={simulation.trackedBitstrings}
              totalDurationUs={schedule.schedule.duration}
              inducedEdges={inducedEdges}
              targetMisSize={targetMisSize}
              currentFrameIndex={simulation.currentFrameIndex}
              onScrub={(i) => {
                setAutoPlay(false);
                setCurrentFrameIndex(i);
              }}
              pixelWidth={820}
            />
          </Panel>
        )}

      {quality && (
        <Panel
          title="איכות הפתרון"
          subtitle={
            targetMisSize
              ? `MIS* = ${targetMisSize} · מבוסס על ההסתברויות הסופיות + induced edges`
              : "MIS* לא ידוע — הריצו שלב 2 כדי לקבל גודל MIS אופטימלי"
          }
        >
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(3, 1fr)",
              gap: 16,
              marginBottom: 18,
            }}
          >
            <QualityCard
              label="Approximation ratio"
              value={quality.approximationRatio}
              color={palette.ok}
              hint="E[|S|·𝟙{indep}] / |MIS*|"
            />
            <QualityCard
              label="MIS probability"
              value={quality.misProbability}
              color={palette.queraPurpleGlow}
              hint="Σ probs of optimal-MIS bitstrings"
            />
            <QualityCard
              label="Violation probability"
              value={quality.violationProbability}
              color={palette.err}
              hint="Σ probs with a blockade-violating pair"
              warnIfHigh
            />
          </div>
          <div
            style={{
              fontSize: 12,
              color: palette.textSecondary,
              marginBottom: 8,
            }}
          >
            Top {quality.topBitstrings.length} bitstrings בסוף האבולוציה:
          </div>
          <TopBitstrings rows={quality.topBitstrings} />
        </Panel>
      )}

      {embed && schedule && (
        <TSweepPanel
          positions={embed.positions}
          schedule={schedule.schedule}
          inducedEdges={inducedEdges}
          targetMisSize={targetMisSize}
          noise={noise}
          currentT={schedule.schedule.duration}
        />
      )}

      <div
        role="separator"
        aria-label="Step 3 — Hardware bridge"
        style={{
          margin: "32px 0 14px",
          display: "flex",
          alignItems: "center",
          gap: 14,
        }}
      >
        <div
          style={{
            flex: "0 0 auto",
            padding: "6px 14px",
            borderRadius: 999,
            background: `linear-gradient(90deg, ${palette.queraPurple}, ${palette.queraPurpleGlow})`,
            color: "#fff",
            fontWeight: 700,
            fontSize: 13,
            letterSpacing: 0.3,
            boxShadow: `0 0 18px ${palette.queraPurpleSoft}`,
          }}
        >
          🔁 Step 3 · Run the same Hamiltonian on real hardware
        </div>
        <div
          style={{
            flex: 1,
            height: 1,
            background: `linear-gradient(90deg, ${palette.queraPurpleGlow}, transparent)`,
          }}
        />
        <div
          style={{
            flex: "0 0 auto",
            fontSize: 12,
            color: palette.textMuted,
            fontStyle: "italic",
          }}
        >
          סימולציה מקומית למעלה ↑ · חומרה מרוחקת למטה ↓
        </div>
      </div>

      <div
        style={{
          padding: 2,
          borderRadius: 14,
          background: `linear-gradient(135deg, ${palette.queraPurpleSoft}, transparent 60%)`,
        }}
      >
        <BraketPanel
          positions={embed.positions}
          schedule={schedule.schedule}
          defaultShots={100}
        />
      </div>

      <Panel
        title="הסבר"
        subtitle="מה רואים בגרף"
        collapsible
        collapseGroup="explanations"
      >
        <p style={{ margin: 0, color: palette.textSecondary, lineHeight: 1.7 }}>
          ב-t=0 כל האטומים ב-|g⟩ ולכן{" "}
          <span dir="ltr" className="mono">
            ⟨n̂_i⟩ = 0
          </span>{" "}
          (האטומים בציאן). כשה-Δ סורק מ-שלילי לחיובי, פונקציית הגל עוברת בהדרגה ל-MIS הקלאסי
          של גרף הדיסקים-יחידה. אטומים שמגיעים ל-|r⟩ זוהרים בסגול. צפיפות{" "}
          <span dir="ltr" className="mono">
            ⟨n_total⟩(T)
          </span>{" "}
          ≈ גודל ה-MIS שאותר.
        </p>
        <p style={{ margin: "10px 0 0", color: palette.textSecondary, lineHeight: 1.7 }}>
          קריטריון אדיאבטי (Landau–Zener):{" "}
          <span dir="ltr" className="mono">T ≫ ℏ / Δ_min²</span>. אם הסקירה{" "}
          <span dir="ltr" className="mono">F = |⟨GS(t)|ψ(t)⟩|²</span> צוללת ליד{" "}
          <span dir="ltr" className="mono">Δ_min</span> — זה סימן שהקצב מהיר מדי. הגדילו את משך
          ה-schedule או הוסיפו תיקון בסביבת המינימום.
        </p>
      </Panel>
    </motion.div>
  );
}

// --- Helpers ---------------------------------------------------------------

function argMinFinite(vals: (number | null | undefined)[]):
  | { index: number; value: number }
  | null {
  let bestI = -1;
  let bestV = Infinity;
  for (let i = 0; i < vals.length; i++) {
    const v = vals[i];
    if (typeof v !== "number" || !Number.isFinite(v)) continue;
    if (v < bestV) {
      bestV = v;
      bestI = i;
    }
  }
  return bestI >= 0 ? { index: bestI, value: bestV } : null;
}

function StatusBadge({
  status,
  message,
  eta,
}: {
  status: "idle" | "running" | "done" | "error";
  message?: string;
  eta?: number | null;
}) {
  const palettes = {
    idle: {
      bg: "rgba(154,166,191,0.12)",
      border: palette.textMuted,
      text: palette.textSecondary,
      label: "—",
    },
    running: {
      bg: "rgba(179,136,255,0.15)",
      border: palette.queraPurpleGlow,
      text: palette.queraPurpleGlow,
      label: "● זורם",
    },
    done: {
      bg: "rgba(61,220,151,0.1)",
      border: palette.ok,
      text: palette.ok,
      label: "✓ הסתיים",
    },
    error: {
      bg: "rgba(255,84,112,0.1)",
      border: palette.err,
      text: palette.err,
      label: "✕ שגיאה",
    },
  } as const;
  const p = palettes[status];
  return (
    <div
      style={{
        padding: "6px 12px",
        background: p.bg,
        border: `1px solid ${p.border}`,
        color: p.text,
        borderRadius: 8,
        fontSize: 12,
        fontWeight: 600,
        display: "flex",
        gap: 8,
        alignItems: "center",
      }}
      title={message}
    >
      <span>{p.label}</span>
      {status === "running" && typeof eta === "number" && (
        <span style={{ color: palette.textMuted, fontWeight: 500 }} dir="ltr">
          ~{eta.toFixed(1)}s
        </span>
      )}
    </div>
  );
}

function PlaybackToolbar({
  autoPlay,
  setAutoPlay,
  speed,
  setSpeed,
  loop,
  setLoop,
  frameIndex,
  totalFrames,
  setIndex,
}: {
  autoPlay: boolean;
  setAutoPlay: (v: boolean | ((p: boolean) => boolean)) => void;
  speed: number;
  setSpeed: (v: number) => void;
  loop: boolean;
  setLoop: (v: boolean | ((p: boolean) => boolean)) => void;
  frameIndex: number;
  totalFrames: number;
  setIndex: (i: number) => void;
}) {
  const speeds = [0.25, 0.5, 1, 2, 4];
  const step = (delta: number) => {
    setAutoPlay(false);
    setIndex(Math.max(0, Math.min(totalFrames - 1, frameIndex + delta)));
  };
  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        gap: 10,
        padding: 10,
        background: palette.bgInset,
        borderRadius: 8,
      }}
    >
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 6,
          flexWrap: "wrap",
        }}
      >
        <IconBtn onClick={() => step(-totalFrames)} title="לתחילה (Home)">⏮</IconBtn>
        <IconBtn onClick={() => step(-10)} title="-10 (Shift+←)">◀◀</IconBtn>
        <IconBtn
          onClick={() => setAutoPlay((v) => !v)}
          title="Play/Pause (Space)"
          primary={autoPlay}
          wide
        >
          {autoPlay ? "⏸" : "▶"}
        </IconBtn>
        <IconBtn onClick={() => step(10)} title="+10 (Shift+→)">▶▶</IconBtn>
        <IconBtn onClick={() => step(totalFrames)} title="לסוף (End)">⏭</IconBtn>
      </div>
      <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
        <span style={{ fontSize: 11, color: palette.textMuted }}>מהירות:</span>
        {speeds.map((s) => (
          <button
            key={s}
            onClick={() => setSpeed(s)}
            style={{
              padding: "3px 8px",
              fontSize: 11,
              background: speed === s ? palette.queraPurple : "transparent",
              color: speed === s ? "#fff" : palette.textSecondary,
              border: `1px solid ${palette.queraPurpleSoft}`,
              borderRadius: 4,
              cursor: "pointer",
            }}
          >
            {s}×
          </button>
        ))}
        <button
          onClick={() => setLoop((v) => !v)}
          title="Loop"
          style={{
            marginInlineStart: "auto",
            padding: "3px 10px",
            fontSize: 11,
            background: loop ? palette.queraPurpleSoft : "transparent",
            color: loop ? palette.queraPurpleGlow : palette.textMuted,
            border: `1px solid ${palette.queraPurpleSoft}`,
            borderRadius: 4,
            cursor: "pointer",
          }}
        >
          ↻ loop
        </button>
      </div>
      <input
        type="range"
        min={0}
        max={Math.max(0, totalFrames - 1)}
        value={frameIndex}
        onChange={(e) => {
          setAutoPlay(false);
          setIndex(Number(e.target.value));
        }}
        dir="ltr"
        style={{ accentColor: palette.queraPurpleGlow }}
      />
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          fontSize: 10.5,
          color: palette.textMuted,
          fontFamily: "JetBrains Mono",
        }}
        dir="ltr"
      >
        <span>frame {frameIndex + 1} / {totalFrames || 0}</span>
      </div>
    </div>
  );
}

function IconBtn({
  children,
  onClick,
  title,
  primary,
  wide,
}: {
  children: React.ReactNode;
  onClick: () => void;
  title: string;
  primary?: boolean;
  wide?: boolean;
}) {
  return (
    <button
      onClick={onClick}
      title={title}
      style={{
        padding: "6px 0",
        minWidth: wide ? 56 : 36,
        background: primary ? palette.queraPurple : "transparent",
        color: primary ? "#fff" : palette.textSecondary,
        border: `1px solid ${palette.queraPurpleSoft}`,
        borderRadius: 6,
        fontSize: 13,
        cursor: "pointer",
      }}
    >
      {children}
    </button>
  );
}

function KPICards({
  t,
  norm,
  nTotal,
  gap,
  fidelity,
  energy,
  purity,
  gapHistory,
  fidelityHistory,
  energyHistory,
  purityHistory,
  nTotalHistory,
}: {
  t: number;
  norm: number;
  nTotal: number;
  gap: number | null;
  fidelity: number | null;
  energy: number | null;
  purity: number | null;
  gapHistory: (number | null | undefined)[];
  fidelityHistory: (number | null | undefined)[];
  energyHistory: (number | null | undefined)[];
  purityHistory: (number | null | undefined)[];
  nTotalHistory: number[];
}) {
  const normOk = Math.abs(norm - 1) < 1e-3;
  return (
    <div
      style={{
        display: "grid",
        gridTemplateColumns: "1fr 1fr",
        gap: 8,
        padding: 12,
        background: palette.bgInset,
        borderRadius: 8,
      }}
    >
      <KPI label="t (µs)" value={t.toFixed(3)} sparkValues={null} color={palette.queraPurpleGlow} />
      <KPI
        label="‖ψ‖"
        value={norm.toFixed(4)}
        color={normOk ? palette.ok : palette.warn}
        sparkValues={null}
      />
      <KPI
        label="⟨n_total⟩"
        value={nTotal.toFixed(2)}
        color={palette.queraPurpleGlow}
        sparkValues={nTotalHistory}
      />
      <KPI
        label="Δ_gap"
        value={gap !== null ? gap.toFixed(2) : "—"}
        color={palette.warn}
        sparkValues={gapHistory}
      />
      <KPI
        label="Fidelity"
        value={fidelity !== null ? fidelity.toFixed(3) : "—"}
        color={
          fidelity !== null && fidelity < 0.9 ? palette.warn : palette.ok
        }
        sparkValues={fidelityHistory}
      />
      <KPI
        label="⟨H⟩"
        value={energy !== null ? energy.toFixed(2) : "—"}
        color={palette.channelDelta}
        sparkValues={energyHistory}
      />
      {purity !== null && (
        <KPI
          label="Purity"
          value={purity.toFixed(3)}
          color={
            purity > 0.95
              ? palette.ok
              : purity > 0.8
                ? palette.warn
                : palette.err
          }
          sparkValues={purityHistory}
        />
      )}
    </div>
  );
}

function KPI({
  label,
  value,
  color,
  sparkValues,
}: {
  label: string;
  value: string;
  color: string;
  sparkValues: (number | null | undefined)[] | null;
}) {
  return (
    <div
      style={{
        background: palette.bgPanel,
        borderRadius: 6,
        padding: "6px 8px",
        border: `1px solid ${palette.queraPurpleSoft}`,
      }}
    >
      <div style={{ color: palette.textMuted, fontSize: 10 }}>{label}</div>
      <div
        style={{ fontFamily: "var(--font-mono)", color, fontSize: 15 }}
        dir="ltr"
      >
        {value}
      </div>
      {sparkValues && sparkValues.length > 1 && (
        <Sparkline values={sparkValues} color={color} />
      )}
    </div>
  );
}

function Sparkline({
  values,
  color,
  width = 120,
  height = 22,
}: {
  values: (number | null | undefined)[];
  color: string;
  width?: number;
  height?: number;
}) {
  const finite = values
    .map((v) => (typeof v === "number" && Number.isFinite(v) ? v : null))
    .filter((v): v is number => v !== null);
  if (finite.length < 2) return null;
  const lo = Math.min(...finite);
  const hi = Math.max(...finite);
  const range = hi - lo || 1;
  const segs: string[] = [];
  let started = false;
  for (let i = 0; i < values.length; i++) {
    const v = values[i];
    if (typeof v !== "number" || !Number.isFinite(v)) {
      started = false;
      continue;
    }
    const x = (i / Math.max(1, values.length - 1)) * width;
    const y = height - ((v - lo) / range) * height;
    segs.push(`${started ? "L" : "M"}${x.toFixed(1)},${y.toFixed(1)}`);
    started = true;
  }
  return (
    <svg
      width={width}
      height={height}
      style={{ display: "block", marginTop: 2 }}
    >
      <path d={segs.join(" ")} fill="none" stroke={color} strokeWidth={1.2} />
    </svg>
  );
}

function OverlayChips({
  current,
  setCurrent,
}: {
  current: OverlayKey;
  setCurrent: (k: OverlayKey) => void;
}) {
  const opts: { key: OverlayKey; label: string }[] = [
    { key: "none", label: "—" },
    { key: "gap", label: "Δ_gap" },
    { key: "fidelity", label: "F(GS)" },
    { key: "energy", label: "⟨H⟩" },
    { key: "purity", label: "Purity" },
  ];
  return (
    <div style={{ display: "flex", gap: 4 }}>
      {opts.map((o) => (
        <button
          key={o.key}
          onClick={() => setCurrent(o.key)}
          style={{
            padding: "4px 10px",
            fontSize: 11,
            background:
              current === o.key ? palette.queraPurple : "transparent",
            color:
              current === o.key ? "#fff" : palette.textSecondary,
            border: `1px solid ${palette.queraPurpleSoft}`,
            borderRadius: 4,
            cursor: "pointer",
            fontFamily: "JetBrains Mono",
          }}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

function AtomInspector({
  atomId,
  frames,
  currentFrameIndex,
  onClose,
}: {
  atomId: number;
  frames: import("../api/rest").SimulationFrameDTO[];
  currentFrameIndex: number;
  onClose: () => void;
}) {
  const series = frames.map((f) => f.rydberg_populations[atomId] ?? 0);
  const cur = series[Math.min(currentFrameIndex, series.length - 1)] ?? 0;
  return (
    <div
      style={{
        background: palette.bgInset,
        border: `1px solid ${palette.queraPurpleSoft}`,
        borderRadius: 8,
        padding: 10,
        display: "flex",
        alignItems: "center",
        gap: 12,
      }}
    >
      <div style={{ flex: "0 0 auto" }}>
        <div style={{ color: palette.textMuted, fontSize: 11 }}>
          אטום {atomId}
        </div>
        <div
          style={{
            color: palette.queraPurpleGlow,
            fontSize: 16,
            fontFamily: "JetBrains Mono",
          }}
          dir="ltr"
        >
          ⟨n̂⟩ = {cur.toFixed(3)}
        </div>
      </div>
      <div style={{ flex: 1 }}>
        <Sparkline values={series} color={palette.queraPurpleGlow} width={420} height={42} />
      </div>
      <button
        onClick={onClose}
        style={{
          background: "transparent",
          color: palette.textMuted,
          border: `1px solid ${palette.queraPurpleSoft}`,
          borderRadius: 6,
          padding: "4px 10px",
          cursor: "pointer",
          fontSize: 12,
        }}
      >
        ✕
      </button>
    </div>
  );
}

function QualityCard({
  label,
  value,
  color,
  hint,
  warnIfHigh,
}: {
  label: string;
  value: number;
  color: string;
  hint: string;
  warnIfHigh?: boolean;
}) {
  const display = (value * 100).toFixed(1) + "%";
  const effectiveColor = warnIfHigh && value > 0.2 ? palette.err : color;
  return (
    <div
      style={{
        padding: 14,
        background: palette.bgInset,
        border: `1px solid ${palette.queraPurpleSoft}`,
        borderRadius: 10,
      }}
    >
      <div style={{ color: palette.textMuted, fontSize: 11 }}>{label}</div>
      <div
        style={{
          fontFamily: "JetBrains Mono",
          color: effectiveColor,
          fontSize: 28,
          fontWeight: 600,
          marginTop: 2,
        }}
        dir="ltr"
      >
        {display}
      </div>
      <div style={{ color: palette.textMuted, fontSize: 10.5, marginTop: 4 }} dir="ltr">
        {hint}
      </div>
    </div>
  );
}

function TopBitstrings({
  rows,
}: {
  rows: {
    bitstring: string;
    prob: number;
    size: number;
    independent: boolean;
    isMis: boolean;
  }[];
}) {
  if (rows.length === 0) return null;
  const max = Math.max(...rows.map((r) => r.prob), 1e-9);
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
      {rows.map((r) => {
        const w = (r.prob / max) * 100;
        const color = r.isMis
          ? palette.ok
          : r.independent
            ? palette.queraPurpleGlow
            : palette.err;
        return (
          <div
            key={r.bitstring}
            style={{ display: "flex", alignItems: "center", gap: 10 }}
          >
            <span
              dir="ltr"
              style={{
                fontFamily: "JetBrains Mono",
                color: palette.textPrimary,
                fontSize: 12,
                minWidth: 130,
              }}
            >
              |{r.bitstring}⟩
            </span>
            <div
              style={{
                flex: 1,
                height: 14,
                background: palette.bgPanel,
                borderRadius: 4,
                overflow: "hidden",
                border: `1px solid ${palette.queraPurpleSoft}`,
              }}
            >
              <div
                style={{
                  width: `${w}%`,
                  height: "100%",
                  background: color,
                  opacity: 0.85,
                }}
              />
            </div>
            <span
              dir="ltr"
              style={{
                fontFamily: "JetBrains Mono",
                color,
                fontSize: 12,
                minWidth: 60,
                textAlign: "end",
              }}
            >
              {(r.prob * 100).toFixed(1)}%
            </span>
            <span
              style={{
                color: palette.textMuted,
                fontSize: 11,
                minWidth: 72,
              }}
            >
              {r.isMis
                ? "✓ MIS"
                : r.independent
                  ? `size ${r.size}`
                  : "✕ violation"}
            </span>
          </div>
        );
      })}
    </div>
  );
}

function nearestFrameIndex(
  frames: import("../api/rest").SimulationFrameDTO[],
  t: number,
): number {
  if (frames.length === 0) return -1;
  let best = 0;
  let bestErr = Infinity;
  for (let i = 0; i < frames.length; i++) {
    const e = Math.abs(frames[i].t_us - t);
    if (e < bestErr) {
      bestErr = e;
      best = i;
    }
  }
  return best;
}

function NoisePanel({
  noise,
  setNoise,
}: {
  noise: NoiseConfigDTO;
  setNoise: (n: NoiseConfigDTO) => void;
}) {
  return (
    <div
      style={{
        background: palette.bgInset,
        border: `1px solid ${palette.queraPurpleSoft}`,
        borderRadius: 8,
        padding: 10,
      }}
    >
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          marginBottom: 6,
        }}
      >
        <label style={{ display: "flex", alignItems: "center", gap: 8, cursor: "pointer" }}>
          <input
            type="checkbox"
            checked={noise.enabled}
            onChange={(e) => setNoise({ ...noise, enabled: e.target.checked })}
          />
          <span style={{ fontSize: 12.5, color: palette.textPrimary, fontWeight: 600 }}>
            🌫️ Lindblad noise (Aquila)
          </span>
        </label>
        <button
          onClick={() => setNoise({ ...DEFAULT_NOISE, enabled: noise.enabled })}
          title="↺ Aquila defaults: T₁=30, T₂=4"
          style={{
            background: "transparent",
            color: palette.textMuted,
            border: `1px solid ${palette.queraPurpleSoft}`,
            borderRadius: 4,
            padding: "2px 8px",
            fontSize: 10.5,
            cursor: "pointer",
          }}
        >
          ↺ Aquila
        </button>
      </div>
      {noise.enabled && (
        <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
          <NumberInput
            label="T₁ (µs) — Rydberg decay"
            value={noise.t1_us ?? 30}
            onChange={(v) => setNoise({ ...noise, t1_us: v })}
            min={0.5}
            max={200}
            step={0.5}
          />
          <NumberInput
            label="T₂ (µs) — coherence"
            value={noise.t2_us ?? 4}
            onChange={(v) => setNoise({ ...noise, t2_us: v })}
            min={0.5}
            max={100}
            step={0.5}
          />
          <div style={{ fontSize: 10, color: palette.textMuted, lineHeight: 1.5 }}>
            עלות חישובית: ~2-3× לעומת unitary. הפעלה משנה גם את ה-cache key.
          </div>
        </div>
      )}
    </div>
  );
}

function NumberInput({
  label,
  value,
  onChange,
  min,
  max,
  step,
}: {
  label: string;
  value: number;
  onChange: (v: number) => void;
  min: number;
  max: number;
  step: number;
}) {
  return (
    <label style={{ display: "flex", flexDirection: "column", gap: 2 }}>
      <span style={{ fontSize: 11, color: palette.textMuted }}>{label}</span>
      <input
        type="number"
        value={value}
        min={min}
        max={max}
        step={step}
        onChange={(e) => {
          const v = Number(e.target.value);
          if (Number.isFinite(v)) onChange(v);
        }}
        style={{
          background: palette.bgPanel,
          color: palette.textPrimary,
          border: `1px solid ${palette.queraPurpleSoft}`,
          borderRadius: 4,
          padding: "4px 6px",
          fontSize: 12,
          fontFamily: "JetBrains Mono",
        }}
      />
    </label>
  );
}

function TSweepPanel({
  positions,
  schedule,
  inducedEdges,
  targetMisSize,
  noise,
  currentT,
}: {
  positions: import("../api/rest").NodePos[];
  schedule: import("../api/rest").ScheduleDTO;
  inducedEdges: readonly Edge[];
  targetMisSize: number | null;
  noise: NoiseConfigDTO;
  currentT: number;
}) {
  const [tMin, setTMin] = useState(0.5);
  const [tMax, setTMax] = useState(Math.max(4, currentT * 2));
  const [nPoints, setNPoints] = useState(6);
  const [points, setPoints] = useState<SweepPoint[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const runSweepWith = useCallback(
    async (range: { tMin: number; tMax: number; nPoints: number }) => {
      setBusy(true);
      setError(null);
      try {
        const step =
          range.nPoints > 1 ? (range.tMax - range.tMin) / (range.nPoints - 1) : 0;
        const durations = Array.from(
          { length: range.nPoints },
          (_, i) => range.tMin + i * step,
        );
        const res = await api.simulateSweepDurations({
          positions,
          schedule,
          durations_us: durations,
          n_frames: 60,
          noise: noise.enabled ? noise : null,
        });
        setPoints(res.points);
      } catch (e) {
        setError((e as Error).message);
      } finally {
        setBusy(false);
      }
    },
    [positions, schedule, noise],
  );

  const runSweep = useCallback(
    () => runSweepWith({ tMin, tMax, nPoints }),
    [runSweepWith, tMin, tMax, nPoints],
  );

  // Auto-tune: pick a sweep range that brackets the current schedule's T so
  // the canonical S-curve of approximation_ratio(T) lands inside the window,
  // and choose n_points so total wall-time stays in budget — ~30s unitary,
  // ~90s with noise. Per-run cost grows as ~0.03·2^N seconds (calibrated
  // against the split-Hamiltonian sesolve in pipeline/simulate.py). Auto
  // also kicks off the sweep immediately — one click = canonical curve.
  const autoTune = useCallback(() => {
    const N = positions.length;
    const perRunSec = 0.03 * Math.pow(2, N) * (noise.enabled ? 2.5 : 1);
    const budget = noise.enabled ? 90 : 30;
    const recommended = Math.max(
      3,
      Math.min(8, Math.round(budget / Math.max(0.05, perRunSec))),
    );
    const newTMin = Math.max(0.1, Number((currentT / 6).toFixed(2)));
    const newTMax = Number((currentT * 3).toFixed(2));
    setTMin(newTMin);
    setTMax(newTMax);
    setNPoints(recommended);
    void runSweepWith({ tMin: newTMin, tMax: newTMax, nPoints: recommended });
  }, [positions.length, noise.enabled, currentT, runSweepWith]);

  const metrics = useMemo(
    () =>
      points.map((p) => ({
        T: p.duration_us,
        ...computeMisMetrics(p.final_bitstring_probs, inducedEdges, targetMisSize, 1),
      })),
    [points, inducedEdges, targetMisSize],
  );

  return (
    <Panel
      title="📈 סריקת T — אדיאבטיות"
      subtitle="הרצה של אותו pulse ב-T שונים. מציג approximation-ratio(T) ו-MIS-prob(T)."
      collapsible
      collapseGroup="t-sweep"
    >
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(3, 1fr) auto auto",
          gap: 10,
          alignItems: "end",
          marginBottom: 14,
        }}
      >
        <NumberInput label="T_min (µs)" value={tMin} onChange={setTMin} min={0.1} max={20} step={0.1} />
        <NumberInput label="T_max (µs)" value={tMax} onChange={setTMax} min={0.2} max={40} step={0.1} />
        <NumberInput label="n_points" value={nPoints} onChange={(v) => setNPoints(Math.round(v))} min={2} max={12} step={1} />
        <button
          onClick={autoTune}
          disabled={busy}
          title={`Auto-tune לפי N=${positions.length}, currentT=${currentT.toFixed(2)}µs, רעש ${noise.enabled ? "דלוק" : "כבוי"}`}
          style={{
            padding: "8px 12px",
            background: "transparent",
            color: palette.queraPurpleGlow,
            border: `1px solid ${palette.queraPurpleSoft}`,
            borderRadius: 6,
            cursor: busy ? "wait" : "pointer",
            fontWeight: 600,
            fontSize: 12,
            height: 34,
          }}
        >
          📐 Auto
        </button>
        <button
          onClick={runSweep}
          disabled={busy || tMax <= tMin}
          style={{
            padding: "8px 14px",
            background: busy ? palette.queraPurpleSoft : palette.queraPurple,
            color: "#fff",
            border: "none",
            borderRadius: 6,
            cursor: busy ? "wait" : "pointer",
            fontWeight: 600,
            fontSize: 12,
            height: 34,
          }}
        >
          {busy ? "רץ…" : "🚀 הרץ סריקה"}
        </button>
      </div>
      {error && (
        <div
          style={{
            padding: 8,
            marginBottom: 10,
            background: "rgba(255,84,112,0.1)",
            border: `1px solid ${palette.err}`,
            borderRadius: 6,
            color: palette.err,
            fontSize: 12,
          }}
        >
          ✕ {error}
        </div>
      )}
      {metrics.length > 0 && (
        <SweepPlot points={metrics} currentT={currentT} />
      )}
    </Panel>
  );
}

function SweepPlot({
  points,
  currentT,
}: {
  points: { T: number; approximationRatio: number; misProbability: number }[];
  currentT: number;
}) {
  const W = 760;
  const H = 240;
  const padLeft = 50;
  const padRight = 20;
  const padTop = 18;
  const padBottom = 32;
  const innerW = W - padLeft - padRight;
  const innerH = H - padTop - padBottom;
  const tMin = Math.min(...points.map((p) => p.T));
  const tMax = Math.max(...points.map((p) => p.T));
  const tToX = (t: number) =>
    padLeft + (tMax > tMin ? (t - tMin) / (tMax - tMin) : 0.5) * innerW;
  const yToY = (y: number) => padTop + (1 - Math.max(0, Math.min(1, y))) * innerH;

  const ratioPath = points
    .map((p, i) => `${i === 0 ? "M" : "L"}${tToX(p.T).toFixed(1)},${yToY(p.approximationRatio).toFixed(1)}`)
    .join(" ");
  const misPath = points
    .map((p, i) => `${i === 0 ? "M" : "L"}${tToX(p.T).toFixed(1)},${yToY(p.misProbability).toFixed(1)}`)
    .join(" ");

  return (
    <div dir="ltr">
      <svg
        width={W}
        height={H}
        style={{
          background: palette.bgInset,
          border: `1px solid ${palette.queraPurpleSoft}`,
          borderRadius: 10,
          display: "block",
        }}
      >
        {[0, 0.25, 0.5, 0.75, 1].map((v) => (
          <g key={v}>
            <line
              x1={padLeft}
              x2={padLeft + innerW}
              y1={yToY(v)}
              y2={yToY(v)}
              stroke={palette.queraPurpleSoft}
              strokeOpacity={0.3}
              strokeWidth={0.5}
            />
            <text
              x={padLeft - 6}
              y={yToY(v) + 3}
              fontSize={10}
              fill={palette.textMuted}
              fontFamily="JetBrains Mono"
              textAnchor="end"
            >
              {v.toFixed(2)}
            </text>
          </g>
        ))}
        <path d={ratioPath} fill="none" stroke={palette.queraPurpleGlow} strokeWidth={2} />
        <path d={misPath} fill="none" stroke={palette.ok} strokeWidth={2} strokeDasharray="5 3" />
        {points.map((p) => (
          <g key={p.T}>
            <circle cx={tToX(p.T)} cy={yToY(p.approximationRatio)} r={3} fill={palette.queraPurpleGlow} />
            <circle cx={tToX(p.T)} cy={yToY(p.misProbability)} r={3} fill={palette.ok} />
          </g>
        ))}
        {currentT >= tMin && currentT <= tMax && (
          <line
            x1={tToX(currentT)}
            x2={tToX(currentT)}
            y1={padTop}
            y2={padTop + innerH}
            stroke={palette.warn}
            strokeOpacity={0.7}
            strokeWidth={1.2}
            strokeDasharray="2 3"
          />
        )}
        {/* X labels */}
        <text x={padLeft} y={H - 8} fontSize={10} fill={palette.textMuted} fontFamily="JetBrains Mono">
          {tMin.toFixed(2)} µs
        </text>
        <text
          x={padLeft + innerW}
          y={H - 8}
          fontSize={10}
          fill={palette.textMuted}
          fontFamily="JetBrains Mono"
          textAnchor="end"
        >
          {tMax.toFixed(2)} µs
        </text>
        {/* Legend */}
        <g transform={`translate(${padLeft + 8}, ${padTop + 4})`}>
          <rect width={2} height={10} y={2} fill={palette.queraPurpleGlow} />
          <text x={8} y={11} fontSize={11} fill={palette.queraPurpleGlow} fontFamily="JetBrains Mono">
            approx ratio
          </text>
          <rect width={2} height={10} y={18} fill={palette.ok} />
          <text x={8} y={27} fontSize={11} fill={palette.ok} fontFamily="JetBrains Mono">
            MIS prob
          </text>
        </g>
      </svg>
    </div>
  );
}
