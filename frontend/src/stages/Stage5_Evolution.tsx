import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { motion } from "framer-motion";
import { AtomArray2D } from "../components/AtomArray2D";
import { BraketPanel } from "../components/BraketPanel";
import { EvolutionPlot } from "../components/EvolutionPlot";
import { ExportButton } from "../components/ExportButton";
import { Panel } from "../components/Panel";
import { Slider } from "../components/Slider";
import { streamSimulation } from "../api/ws";
import type { EvolutionHandle } from "../api/ws";
import { usePipeline } from "../store/pipeline";
import { palette } from "../theme/palette";

export function Stage5_Evolution() {
  const {
    embed,
    schedule,
    simulation,
    resetSimulation,
    pushSimulationFrame,
    setSimulationStatus,
    setCurrentFrameIndex,
  } = usePipeline();
  const [nFrames, setNFrames] = useState(80);
  const [autoPlay, setAutoPlay] = useState(true);
  const handleRef = useRef<EvolutionHandle | null>(null);

  const startStream = useCallback(() => {
    if (!embed || !schedule) return;
    handleRef.current?.close();
    resetSimulation();
    setSimulationStatus("running");
    handleRef.current = streamSimulation(
      {
        positions: embed.positions,
        schedule: schedule.schedule,
        n_frames: nFrames,
      },
      {
        onFrame: (f) => pushSimulationFrame(f),
        onDone: () => setSimulationStatus("done"),
        onError: (msg) => setSimulationStatus("error", msg),
      },
    );
  }, [embed, schedule, nFrames, resetSimulation, pushSimulationFrame, setSimulationStatus]);

  useEffect(() => {
    // Start a fresh stream when this stage mounts (or when atoms/schedule changed materially)
    startStream();
    return () => {
      handleRef.current?.close();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [embed?.n_atoms, schedule?.schedule.duration]);

  // Autoplay: after stream finishes, march the cursor forward at ~30fps
  useEffect(() => {
    if (!autoPlay || simulation.status === "idle") return;
    const totalFrames = simulation.frames.length;
    if (totalFrames === 0) return;
    const id = window.setInterval(() => {
      const idx = usePipeline.getState().simulation.currentFrameIndex;
      const next = (idx + 1) % usePipeline.getState().simulation.frames.length;
      setCurrentFrameIndex(next);
    }, 33);
    return () => window.clearInterval(id);
  }, [autoPlay, simulation.status, simulation.frames.length, setCurrentFrameIndex]);

  const currentFrame =
    simulation.frames[Math.min(simulation.currentFrameIndex, simulation.frames.length - 1)];

  const populations = useMemo(
    () => currentFrame?.rydberg_populations ?? [],
    [currentFrame],
  );

  if (!embed || !schedule) {
    return (
      <Panel title="שלב 5 · אבולוציה אדיאבטית">
        <div style={{ color: palette.textSecondary }}>
          השלם תחילה את שלבים 3 (השמת אטומים) ו-4 (פולס).
        </div>
      </Panel>
    );
  }

  return (
    <motion.div
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.4 }}
      style={{ display: "grid", gap: 16 }}
    >
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
            <StatusBadge status={simulation.status} message={simulation.errorMessage} />
          </div>
        }
      >
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "minmax(260px, 320px) 1fr",
            gap: 24,
            alignItems: "start",
          }}
        >
          <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
            <Slider
              label="מס׳ פריימים"
              value={nFrames}
              onChange={setNFrames}
              min={20}
              max={300}
              step={10}
            />
            <PlaybackControls
              autoPlay={autoPlay}
              setAutoPlay={setAutoPlay}
              frameIndex={simulation.currentFrameIndex}
              totalFrames={simulation.frames.length}
              setIndex={setCurrentFrameIndex}
            />
            <button
              onClick={startStream}
              disabled={simulation.status === "running"}
              style={{
                marginTop: 6,
                padding: "10px 16px",
                background: palette.queraPurple,
                color: "#fff",
                border: "none",
                borderRadius: 8,
                fontWeight: 600,
                cursor: simulation.status === "running" ? "wait" : "pointer",
              }}
            >
              {simulation.status === "running" ? "מריץ…" : "↻ הרץ אבולוציה"}
            </button>

            {currentFrame && (
              <div
                style={{
                  marginTop: 16,
                  padding: 12,
                  background: palette.bgInset,
                  borderRadius: 8,
                  fontSize: 12,
                  color: palette.textSecondary,
                  display: "grid",
                  gridTemplateColumns: "1fr 1fr",
                  gap: 8,
                }}
              >
                <Stat label="t" value={`${currentFrame.t_us.toFixed(3)} µs`} />
                <Stat label="frame" value={`${simulation.currentFrameIndex + 1} / ${simulation.frames.length}`} />
                <Stat
                  label="⟨n_total⟩"
                  value={populations.reduce((a, b) => a + b, 0).toFixed(2)}
                />
                <Stat label="‖ψ‖" value={currentFrame.norm.toFixed(4)} />
              </div>
            )}
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
            />
          </div>
        </div>
      </Panel>

      {simulation.frames.length > 0 && (
        <Panel
          title="עקומות ⟨n̂_i(t)⟩"
          subtitle="כל קו = אטום אחד. גרור על הגרף כדי לבחור frame."
        >
          <EvolutionPlot
            frames={simulation.frames}
            totalDurationUs={schedule.schedule.duration}
            currentFrameIndex={simulation.currentFrameIndex}
            onScrub={(i) => {
              setAutoPlay(false);
              setCurrentFrameIndex(i);
            }}
            pixelWidth={780}
            pixelHeight={260}
          />
        </Panel>
      )}

      <BraketPanel
        positions={embed.positions}
        schedule={schedule.schedule}
        defaultShots={100}
      />

      <Panel
        title="הסבר"
        subtitle="מה רואים בגרף"
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
      </Panel>
    </motion.div>
  );
}

function StatusBadge({
  status,
  message,
}: {
  status: "idle" | "running" | "done" | "error";
  message?: string;
}) {
  const palettes = {
    idle: { bg: "rgba(154,166,191,0.12)", border: palette.textMuted, text: palette.textSecondary, label: "—" },
    running: { bg: "rgba(179,136,255,0.15)", border: palette.queraPurpleGlow, text: palette.queraPurpleGlow, label: "● זורם" },
    done: { bg: "rgba(61,220,151,0.1)", border: palette.ok, text: palette.ok, label: "✓ הסתיים" },
    error: { bg: "rgba(255,84,112,0.1)", border: palette.err, text: palette.err, label: "✕ שגיאה" },
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
      }}
      title={message}
    >
      {p.label}
    </div>
  );
}

function PlaybackControls({
  autoPlay,
  setAutoPlay,
  frameIndex,
  totalFrames,
  setIndex,
}: {
  autoPlay: boolean;
  setAutoPlay: (v: boolean) => void;
  frameIndex: number;
  totalFrames: number;
  setIndex: (i: number) => void;
}) {
  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        gap: 8,
        padding: 10,
        background: palette.bgInset,
        borderRadius: 8,
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
        <button
          onClick={() => setAutoPlay(!autoPlay)}
          style={{
            padding: "6px 14px",
            background: autoPlay ? palette.queraPurple : "transparent",
            color: autoPlay ? "#fff" : palette.textSecondary,
            border: `1px solid ${palette.queraPurpleSoft}`,
            borderRadius: 6,
            fontSize: 12,
            cursor: "pointer",
            minWidth: 76,
          }}
        >
          {autoPlay ? "⏸ עצור" : "▶ נגן"}
        </button>
        <button
          onClick={() => {
            setAutoPlay(false);
            setIndex(0);
          }}
          style={{
            padding: "6px 12px",
            background: "transparent",
            color: palette.textSecondary,
            border: `1px solid ${palette.queraPurpleSoft}`,
            borderRadius: 6,
            fontSize: 12,
            cursor: "pointer",
          }}
        >
          ⏮ אפס
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
    </div>
  );
}

function Stat({
  label,
  value,
  color = palette.queraPurpleGlow,
}: {
  label: string;
  value: string;
  color?: string;
}) {
  return (
    <div>
      <div style={{ color: palette.textMuted, fontSize: 11 }}>{label}</div>
      <div style={{ fontFamily: "var(--font-mono)", color, fontSize: 16 }} dir="ltr">
        {value}
      </div>
    </div>
  );
}
