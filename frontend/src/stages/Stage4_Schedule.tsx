import type { ReactNode } from "react";
import { useCallback, useEffect, useRef, useState } from "react";
import { motion } from "framer-motion";
import { api } from "../api/rest";
import type {
  GapTraceDTO,
  PhaseDiagramDTO,
  ScheduleResponse,
  SpectrumTraceDTO,
} from "../api/rest";
import { ConstraintBadge, ConstraintSummary } from "../components/ConstraintBadge";
import { HamiltonianTeX } from "../components/HamiltonianTeX";
import { HamiltonianReflectionModal } from "../components/HamiltonianReflectionModal";
import { Panel } from "../components/Panel";
import { PhaseDiagram2D, type PhaseTrajectoryPoint } from "../components/PhaseDiagram2D";
import { PulsePlot, valueAt } from "../components/PulsePlot";
import { Slider } from "../components/Slider";
import { SpectrumPlot } from "../components/SpectrumPlot";
import { usePipeline } from "../store/pipeline";
import { palette } from "../theme/palette";

type PresetName = "paper_linear_ramp" | "paper_smooth_blackman";

const PRESET_LABELS: Record<PresetName, string> = {
  paper_linear_ramp: "Linear ramp (טרפז)",
  paper_smooth_blackman: "Blackman חלק",
};

const AQUILA_LIMITS = {
  rabiMax: 15.8,
  detuningMax: 125,
  detuningMin: -125,
};

interface PaperPresetParams {
  t_total_us: number;
  omega_max_rad_us: number;
  delta_initial_rad_us: number;
  delta_final_rad_us: number;
}

const DEFAULT_PARAMS: PaperPresetParams = {
  t_total_us: 4.0,
  omega_max_rad_us: 15.0,
  delta_initial_rad_us: -30.0,
  delta_final_rad_us: 40.0,
};

export function Stage4_Schedule() {
  // The three analyses (gap, spectrum, phase) live in the persisted store so
  // they survive a tab switch — see `scheduleAnalysis` in store/pipeline.ts.
  // Local UI-only state (loading flags, slider params) stays here.
  const {
    embed,
    schedule,
    setSchedule,
    scheduleAnalysis,
    setGap,
    setSpectrum,
    setPhase,
  } = usePipeline();
  const { gap, gapTooMany, spectrum, spectrumTooMany, phase, phaseTooMany } =
    scheduleAnalysis;
  const [params, setParams] = useState<PaperPresetParams>(DEFAULT_PARAMS);
  const [preset, setPreset] = useState<PresetName>("paper_linear_ramp");
  const [cursorT, setCursorT] = useState<number>(2.0);
  const [isPlaying, setIsPlaying] = useState(false);
  // Real-time seconds per simulated µs. 1 ⇒ 1 µs takes 1 wall-clock second.
  // We default to a 3 s sweep across the typical 4 µs schedule.
  const [playSpeed, setPlaySpeed] = useState(1.0);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [gapLoading, setGapLoading] = useState(false);
  const [spectrumLoading, setSpectrumLoading] = useState(false);
  const [phaseLoading, setPhaseLoading] = useState(false);
  // Click-to-set override from PhaseDiagram2D — when set, the live Hamiltonian
  // panel uses these (Ω, Δ) instead of the values from the schedule cursor.
  const [phasePick, setPhasePick] = useState<{ omega: number; delta: number } | null>(null);
  const [reflectOpen, setReflectOpen] = useState(false);
  // Auto-tune: K=5 candidate parameter configurations evaluated by δ_min.
  const [autoTuning, setAutoTuning] = useState(false);
  const [autoTuneProgress, setAutoTuneProgress] = useState<{
    step: number;
    total: number;
  } | null>(null);
  const [autoTuneResult, setAutoTuneResult] = useState<{
    baselineGap: number | null;
    bestGap: number;
    chosenIdx: number;
  } | null>(null);

  const run = useCallback(async () => {
    setLoading(true);
    setErr(null);
    try {
      const res = await api.schedule({
        preset,
        preset_params: { ...params },
      });
      // setSchedule resets scheduleAnalysis internally — see store/pipeline.ts.
      setSchedule(res);
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, [params, preset, setSchedule]);

  const runGapAnalysis = useCallback(async () => {
    if (!schedule || !embed) return;
    setGapLoading(true);
    setErr(null);
    try {
      const res = await api.scheduleGap({
        positions: embed.positions,
        schedule: schedule.schedule,
        n_samples: 25,
      });
      if (res.trace === null) {
        setGap(null, { n: res.n_atoms, max: res.max_atoms });
      } else {
        setGap(res.trace, null);
      }
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setGapLoading(false);
    }
  }, [schedule, embed, setGap]);

  const runSpectrumAnalysis = useCallback(async () => {
    if (!schedule || !embed) return;
    setSpectrumLoading(true);
    setErr(null);
    try {
      const res = await api.scheduleSpectrum({
        positions: embed.positions,
        schedule: schedule.schedule,
        n_samples: 30,
        n_levels: 4,
      });
      if (res.trace === null) {
        setSpectrum(null, { n: res.n_atoms, max: res.max_atoms });
      } else {
        setSpectrum(res.trace, null);
      }
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setSpectrumLoading(false);
    }
  }, [schedule, embed, setSpectrum]);

  const runPhaseDiagram = useCallback(async () => {
    if (!embed) return;
    setPhaseLoading(true);
    setErr(null);
    try {
      const res = await api.phaseDiagram({
        positions: embed.positions,
        omega_min: 0.5,
        omega_max: 15.0,
        n_omega: 25,
        delta_min: -30.0,
        delta_max: 30.0,
        n_delta: 25,
      });
      if (res.diagram === null) {
        setPhase(null, { n: res.n_atoms, max: res.max_atoms });
      } else {
        setPhase(res.diagram, null);
      }
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setPhaseLoading(false);
    }
  }, [embed, setPhase]);

  /**
   * Auto-tune (K=5): evaluate five candidate (T, Ω, Δ_start, Δ_end) configs
   * and pick the one whose schedule maximises the adiabatic gap δ_min. The
   * five candidates span:
   *   1. Current settings (baseline — must always be in the pool)
   *   2. Ω-scaled symmetric sweep      (Δ_range = ±2·Ω_max)
   *   3. Wide aggressive sweep         (Δ ∈ ±60, full Ω plateau)
   *   4. Long, gentle sweep            (T·1.5, lower Ω, narrow Δ)
   *   5. Short, aggressive sweep       (T·0.5, full Ω, wide Δ)
   * After picking the winner we also stretch T to ≥ suggested_t_us if it
   * exceeds the winner's T (capped at 4.0 µs per Aquila).
   *
   * Cost: 5 × (schedule build + gap analysis). See the timing table in the
   * spec — typically a few seconds for N ≤ 12, ~minute for N=16.
   */
  const runAutoTune = useCallback(async () => {
    if (!embed) return;
    const omegaMax = AQUILA_LIMITS.rabiMax * 0.95; // 15.0 rad/µs (5% headroom)
    const T0 = params.t_total_us;
    const candidates: PaperPresetParams[] = [
      params,
      {
        t_total_us: T0,
        omega_max_rad_us: omegaMax,
        delta_initial_rad_us: -2 * omegaMax,
        delta_final_rad_us: 2 * omegaMax,
      },
      {
        t_total_us: T0,
        omega_max_rad_us: omegaMax,
        delta_initial_rad_us: -60,
        delta_final_rad_us: 60,
      },
      {
        t_total_us: Math.min(4.0, T0 * 1.5),
        omega_max_rad_us: omegaMax * 0.7,
        delta_initial_rad_us: -20,
        delta_final_rad_us: 20,
      },
      {
        t_total_us: Math.max(1.0, T0 * 0.5),
        omega_max_rad_us: omegaMax,
        delta_initial_rad_us: -50,
        delta_final_rad_us: 50,
      },
    ];

    setAutoTuning(true);
    setErr(null);
    setAutoTuneResult(null);
    let bestIdx = 0;
    let bestGap = -Infinity;
    let bestSuggestedT: number | null = null;
    let baselineGap: number | null = null;

    try {
      for (let i = 0; i < candidates.length; i++) {
        setAutoTuneProgress({ step: i + 1, total: candidates.length });
        const sched = await api.schedule({
          preset,
          preset_params: { ...candidates[i] },
        });
        const gapRes = await api.scheduleGap({
          positions: embed.positions,
          schedule: sched.schedule,
          n_samples: 25,
        });
        if (gapRes.trace == null) {
          // Too many atoms — abort autotune entirely; the gap signal we rely
          // on isn't available, so any "best" pick would be meaningless.
          setErr(
            `Auto-tune אינו זמין: גרף עם ${gapRes.n_atoms} אטומים גדול מהמקסימום הנתמך (${gapRes.max_atoms}) לחישוב δ_min.`,
          );
          setAutoTuning(false);
          setAutoTuneProgress(null);
          return;
        }
        const minGap = gapRes.trace.min_gap;
        if (i === 0) baselineGap = minGap;
        if (minGap > bestGap) {
          bestGap = minGap;
          bestIdx = i;
          bestSuggestedT = gapRes.trace.suggested_t_us;
        }
      }

      let chosen = candidates[bestIdx];
      // Stretch T to meet the adiabatic recommendation if the winner needs it.
      if (bestSuggestedT != null && bestSuggestedT > chosen.t_total_us) {
        chosen = { ...chosen, t_total_us: Math.min(4.0, bestSuggestedT) };
      }
      setParams(chosen);

      // Build the final winning schedule and refresh the gap analysis so the
      // Adiabaticity Score and Gap tab reflect the tuned result immediately.
      const finalSched = await api.schedule({
        preset,
        preset_params: { ...chosen },
      });
      setSchedule(finalSched);
      const finalGap = await api.scheduleGap({
        positions: embed.positions,
        schedule: finalSched.schedule,
        n_samples: 25,
      });
      if (finalGap.trace) setGap(finalGap.trace, null);

      setAutoTuneResult({
        baselineGap,
        bestGap: finalGap.trace ? finalGap.trace.min_gap : bestGap,
        chosenIdx: bestIdx,
      });
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setAutoTuning(false);
      setAutoTuneProgress(null);
    }
  }, [embed, params, preset, setSchedule, setGap]);

  // Cursor animation loop — drives cursorT from its current value forward at
  // playSpeed µs/s (real time), looping back to 0 when it hits the schedule
  // duration. Uses rAF so it stays in sync with paint and pauses on tab blur.
  const rafRef = useRef<number | null>(null);
  const lastTickRef = useRef<number | null>(null);
  useEffect(() => {
    if (!isPlaying || !schedule) return;
    const total = schedule.schedule.duration;
    if (total <= 0) return;
    const tick = (now: number) => {
      if (lastTickRef.current == null) lastTickRef.current = now;
      const dtSec = (now - lastTickRef.current) / 1000;
      lastTickRef.current = now;
      setCursorT((prev) => {
        let next = prev + playSpeed * dtSec;
        if (next > total) next = next % total;
        return next;
      });
      rafRef.current = requestAnimationFrame(tick);
    };
    rafRef.current = requestAnimationFrame(tick);
    return () => {
      if (rafRef.current != null) cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
      lastTickRef.current = null;
    };
  }, [isPlaying, playSpeed, schedule]);

  useEffect(() => {
    // Only auto-build a schedule the very first time the user visits this
    // stage. Re-entering with a schedule already in the store would otherwise
    // trigger setSchedule on every mount, which (by design) wipes the cached
    // gap/spectrum/phase analyses — defeating the persistence we just added.
    if (!schedule) {
      run();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <motion.div
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.4 }}
      style={{ display: "grid", gap: 16 }}
    >
      <Panel
        title="שלב 4 · פולס אדיאבטי (Ω, Δ, φ)"
        subtitle="פרוטוקול אדיאבטי מותאם ל-Ebadi-2022 §6.1 — מתחילים מ-Δ שלילי גדול, סורקים ל-Δ חיובי"
        right={schedule ? <ConstraintSummary violations={schedule.violations} /> : null}
      >
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "minmax(280px, 320px) 1fr",
            gap: 24,
            alignItems: "start",
          }}
        >
          <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
            <div>
              <div
                style={{
                  fontSize: 11.5,
                  color: palette.textSecondary,
                  marginBottom: 6,
                }}
              >
                סוג פולס
              </div>
              <div style={{ display: "flex", gap: 6 }}>
                {(Object.keys(PRESET_LABELS) as PresetName[]).map((p) => {
                  const active = p === preset;
                  return (
                    <button
                      key={p}
                      onClick={() => setPreset(p)}
                      style={{
                        flex: 1,
                        padding: "6px 10px",
                        borderRadius: 6,
                        border: `1px solid ${active ? palette.queraPurpleGlow : palette.queraPurpleSoft}`,
                        background: active ? palette.queraPurple : "transparent",
                        color: active ? "#fff" : palette.textSecondary,
                        fontSize: 11.5,
                        fontWeight: 600,
                        cursor: "pointer",
                      }}
                    >
                      {PRESET_LABELS[p]}
                    </button>
                  );
                })}
              </div>
            </div>
            <Slider
              label="משך כולל T"
              value={params.t_total_us}
              onChange={(v) => setParams({ ...params, t_total_us: v })}
              min={0.5}
              max={4.0}
              step={0.1}
              unit="µs"
            />
            <Slider
              label="Ω plateau"
              value={params.omega_max_rad_us}
              onChange={(v) => setParams({ ...params, omega_max_rad_us: v })}
              min={1}
              max={15.8}
              step={0.1}
              unit="rad/µs"
            />
            <Slider
              label="Δ התחלתי"
              value={params.delta_initial_rad_us}
              onChange={(v) => setParams({ ...params, delta_initial_rad_us: v })}
              min={-120}
              max={0}
              step={1}
              unit="rad/µs"
            />
            <Slider
              label="Δ סופי"
              value={params.delta_final_rad_us}
              onChange={(v) => setParams({ ...params, delta_final_rad_us: v })}
              min={0}
              max={120}
              step={1}
              unit="rad/µs"
            />
            <div style={{ display: "flex", gap: 8, marginTop: 6 }}>
              <button
                onClick={run}
                disabled={loading || autoTuning}
                style={{
                  flex: 1,
                  padding: "10px 16px",
                  background: palette.queraPurple,
                  color: "#fff",
                  border: "none",
                  borderRadius: 8,
                  fontWeight: 600,
                  cursor: loading ? "wait" : "pointer",
                }}
              >
                {loading ? "בונה schedule…" : "↻ בנה פולס"}
              </button>
              <button
                onClick={runAutoTune}
                disabled={autoTuning || !embed}
                title="מנסה K=5 קונפיגורציות ובוחר את זו עם δ_min הגדול ביותר"
                style={{
                  flex: 1,
                  padding: "10px 16px",
                  background: autoTuning
                    ? palette.queraPurpleSoft
                    : `linear-gradient(135deg, ${palette.ok}, #2ab37a)`,
                  color: "#fff",
                  border: "none",
                  borderRadius: 8,
                  fontWeight: 600,
                  cursor: autoTuning ? "wait" : "pointer",
                  boxShadow: autoTuning
                    ? "none"
                    : `0 0 16px ${palette.ok}55`,
                  transition: "all 200ms ease",
                }}
              >
                {autoTuning
                  ? autoTuneProgress
                    ? `🎯 ${autoTuneProgress.step}/${autoTuneProgress.total}…`
                    : "🎯 מכוונן…"
                  : "🎯 Auto-tune"}
              </button>
            </div>
            {autoTuneResult && (
              <div
                style={{
                  marginTop: 2,
                  padding: "8px 12px",
                  background: "rgba(61,220,151,0.1)",
                  border: `1px solid ${palette.ok}`,
                  borderRadius: 8,
                  fontSize: 11,
                  color: palette.ok,
                  lineHeight: 1.5,
                }}
              >
                <div style={{ fontWeight: 600 }}>✓ Auto-tune הסתיים</div>
                <div style={{ color: palette.textSecondary, marginTop: 2 }} dir="ltr">
                  {autoTuneResult.baselineGap != null
                    ? `δ_min: ${autoTuneResult.baselineGap.toFixed(2)} → ${autoTuneResult.bestGap.toFixed(2)} rad/µs`
                    : `δ_min = ${autoTuneResult.bestGap.toFixed(2)} rad/µs`}
                  {" · "}candidate #{autoTuneResult.chosenIdx + 1}/5
                </div>
              </div>
            )}
            {err && (
              <div style={{ color: palette.err, fontSize: 12 }} dir="ltr">
                {err}
              </div>
            )}
            {schedule && (
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
                <Stat
                  label="T"
                  value={`${schedule.schedule.duration.toFixed(2)} µs`}
                />
                <Stat
                  label="max |dΩ/dt|"
                  value={`${schedule.max_omega_slew_rate.toFixed(1)} rad/µs²`}
                  color={
                    schedule.max_omega_slew_rate > 250
                      ? palette.err
                      : palette.queraPurpleGlow
                  }
                />
                <Stat label="cursor t" value={`${cursorT.toFixed(2)} µs`} />
                <Stat
                  label="atoms"
                  value={String(embed?.n_atoms ?? 0)}
                />
                <div style={{ gridColumn: "1 / -1" }}>
                  <AdiabaticityScore
                    gap={gap}
                    actualT={schedule.schedule.duration}
                  />
                </div>
              </div>
            )}
          </div>

          <div>
            {schedule && (
              <PlayControls
                isPlaying={isPlaying}
                onTogglePlay={() => setIsPlaying((p) => !p)}
                onReset={() => {
                  setIsPlaying(false);
                  setCursorT(0);
                }}
                speed={playSpeed}
                onSpeedChange={setPlaySpeed}
                cursorT={cursorT}
                totalT={schedule.schedule.duration}
              />
            )}
            {schedule && (
              <PulsePlot
                totalDurationUs={schedule.schedule.duration}
                cursorT={cursorT}
                onCursorChange={(t) => {
                  if (isPlaying) setIsPlaying(false);
                  setCursorT(t);
                }}
                channels={[
                  {
                    data: schedule.schedule.omega,
                    label: "Ω(t)",
                    units: "rad/µs",
                    upperLimit: AQUILA_LIMITS.rabiMax,
                    lowerLimit: 0,
                    yMin: -1,
                    yMax: Math.max(16.5, AQUILA_LIMITS.rabiMax),
                    color: palette.channelOmega,
                  },
                  {
                    data: schedule.schedule.delta,
                    label: "Δ(t)",
                    units: "rad/µs",
                    upperLimit: AQUILA_LIMITS.detuningMax,
                    lowerLimit: AQUILA_LIMITS.detuningMin,
                    color: palette.channelDelta,
                  },
                  {
                    data: schedule.schedule.phi,
                    label: "φ(t)",
                    units: "rad",
                    yMin: -3.2,
                    yMax: 3.2,
                    color: palette.channelPhi,
                  },
                ]}
              />
            )}
          </div>
        </div>
      </Panel>

      {schedule && embed && (
        <AnalysesPanel
          schedule={schedule}
          gap={gap}
          gapTooMany={gapTooMany}
          spectrum={spectrum}
          spectrumTooMany={spectrumTooMany}
          phase={phase}
          phaseTooMany={phaseTooMany}
          gapLoading={gapLoading}
          spectrumLoading={spectrumLoading}
          phaseLoading={phaseLoading}
          onRunGap={runGapAnalysis}
          onRunSpectrum={runSpectrumAnalysis}
          onRunPhase={runPhaseDiagram}
          trajectory={buildTrajectory(schedule, 96)}
          cursorT={cursorT}
          onPickPhase={(omega, delta) => setPhasePick({ omega, delta })}
          phasePick={phasePick}
          onClearPhasePick={() => setPhasePick(null)}
        />
      )}

      {schedule && (
        <Panel
          title="Hamiltonian בזמן הנוכחי"
          subtitle="ערוך את הסליידרים או גרור מעל הגרף כדי לדגום t אחר"
          right={
            <button
              onClick={() => setReflectOpen(true)}
              title="פתח חלון מסביר שלוש-שלבי על איך ה-Hamiltonian נבנה ופועל"
              style={{
                padding: "7px 14px",
                borderRadius: 8,
                border: `1px solid ${palette.queraPurpleGlow}`,
                background: `linear-gradient(135deg, ${palette.queraPurple}, ${palette.queraPurpleSoft})`,
                color: "#fff",
                fontSize: 12,
                fontWeight: 600,
                cursor: "pointer",
                boxShadow: `0 0 14px ${palette.queraPurpleGlow}40`,
                display: "inline-flex",
                alignItems: "center",
                gap: 6,
              }}
            >
              🔬 איך זה מחושב?
            </button>
          }
        >
          {phasePick && (
            <div
              style={{
                marginBottom: 10,
                padding: "8px 12px",
                background: "rgba(155,107,255,0.1)",
                border: `1px solid ${palette.queraPurpleGlow}`,
                borderRadius: 8,
                fontSize: 12,
                color: palette.queraPurpleGlow,
                display: "flex",
                justifyContent: "space-between",
                alignItems: "center",
              }}
              dir="ltr"
            >
              <span>
                ★ Showing H at picked point: Ω = {phasePick.omega.toFixed(2)},
                Δ = {phasePick.delta.toFixed(2)} (φ from schedule)
              </span>
              <button
                onClick={() => setPhasePick(null)}
                style={{
                  padding: "3px 10px",
                  borderRadius: 6,
                  border: `1px solid ${palette.queraPurpleGlow}`,
                  background: "transparent",
                  color: palette.queraPurpleGlow,
                  fontSize: 10.5,
                  fontWeight: 600,
                  cursor: "pointer",
                }}
              >
                clear
              </button>
            </div>
          )}
          <HamiltonianTeX
            omega={
              phasePick ? phasePick.omega : valueAt(schedule.schedule.omega, cursorT)
            }
            delta={
              phasePick ? phasePick.delta : valueAt(schedule.schedule.delta, cursorT)
            }
            phi={valueAt(schedule.schedule.phi, cursorT)}
            nAtoms={embed?.n_atoms ?? 0}
            positions={embed?.positions}
          />
        </Panel>
      )}

      {schedule && schedule.violations.length > 0 && (
        <Panel title="הפרות אילוצים בפולס">
          <div style={{ display: "grid", gap: 8 }}>
            {schedule.violations.map((v, i) => (
              <ConstraintBadge key={i} violation={v} />
            ))}
          </div>
        </Panel>
      )}

      {schedule && embed && (
        <HamiltonianReflectionModal
          open={reflectOpen}
          onClose={() => setReflectOpen(false)}
          omega={phasePick ? phasePick.omega : valueAt(schedule.schedule.omega, cursorT)}
          delta={phasePick ? phasePick.delta : valueAt(schedule.schedule.delta, cursorT)}
          phi={valueAt(schedule.schedule.phi, cursorT)}
          nAtoms={embed.n_atoms}
          positions={embed.positions}
        />
      )}

      <Panel
        title="הסבר"
        subtitle="הקשר בין הפרוטוקול האדיאבטי לחיפוש MIS"
        collapsible
        collapseGroup="explanations"
      >
        <p style={{ margin: 0, color: palette.textSecondary, lineHeight: 1.7 }}>
          הרעיון: כאשר{" "}
          <span dir="ltr" className="mono">
            Δ ≪ 0
          </span>{" "}
          (התחלה), מצב היסוד של ה-Hamiltonian הוא{" "}
          <span dir="ltr" className="mono">
            |gg...g⟩
          </span>{" "}
          — כל האטומים ב-ground state. כש-Δ נסרק לאט ל-
          <span dir="ltr" className="mono">
            Δ ≫ 0
          </span>
          , מצב היסוד עובר רציפות לקבוצה בלתי-תלויה מקסימלית בגרף הדיסקים-יחידה (האטומים
          המתקבלים ב-Rydberg). המשפט האדיאבטי מבטיח שאם המעבר איטי דיו ביחס לפער האנרגטי
          המינימלי, המערכת תישאר במצב היסוד לכל אורך הדרך — וזה ה-MIS.
        </p>
      </Panel>
    </motion.div>
  );
}

/**
 * Sample the (Ω(t), Δ(t)) schedule into N evenly-spaced points along [0, T].
 * Used to overlay the pulse trajectory on the Phase Diagram heatmap.
 */
function buildTrajectory(
  schedule: ScheduleResponse,
  nSamples: number,
): PhaseTrajectoryPoint[] {
  const T = schedule.schedule.duration;
  if (T <= 0 || nSamples < 2) return [];
  const pts: PhaseTrajectoryPoint[] = [];
  for (let i = 0; i < nSamples; i++) {
    const t = (i / (nSamples - 1)) * T;
    pts.push({
      t_us: t,
      omega: valueAt(schedule.schedule.omega, t),
      delta: valueAt(schedule.schedule.delta, t),
    });
  }
  return pts;
}

/**
 * Side-by-side panel for the three Stage-4 quantum analyses (Gap, Spectrum,
 * Phase Diagram). Gap sits at the top full-width (it's lightweight and gives
 * the headline number δ_min); Spectrum and Phase Diagram split a 2-column grid
 * below so they can be read together — exactly the comparison the user needs
 * for the avoided-crossing story.
 */
function AnalysesPanel({
  schedule,
  gap,
  gapTooMany,
  spectrum,
  spectrumTooMany,
  phase,
  phaseTooMany,
  gapLoading,
  spectrumLoading,
  phaseLoading,
  onRunGap,
  onRunSpectrum,
  onRunPhase,
  trajectory,
  cursorT,
  onPickPhase,
  phasePick,
  onClearPhasePick,
}: {
  schedule: ScheduleResponse;
  gap: GapTraceDTO | null;
  gapTooMany: { n: number; max: number } | null;
  spectrum: SpectrumTraceDTO | null;
  spectrumTooMany: { n: number; max: number } | null;
  phase: PhaseDiagramDTO | null;
  phaseTooMany: { n: number; max: number } | null;
  gapLoading: boolean;
  spectrumLoading: boolean;
  phaseLoading: boolean;
  onRunGap: () => void;
  onRunSpectrum: () => void;
  onRunPhase: () => void;
  trajectory: PhaseTrajectoryPoint[];
  cursorT: number;
  onPickPhase: (omega: number, delta: number) => void;
  phasePick: { omega: number; delta: number } | null;
  onClearPhasePick: () => void;
}) {
  return (
    <Panel
      title="ניתוחים קוונטיים"
      subtitle="Gap למעלה · ספקטרום ומפת פאזות זה לצד זה"
    >
      <div style={{ display: "flex", flexDirection: "column", gap: 18 }}>
        <SubSection title="⚡ Gap" subtitle="δ_min ו-T מומלץ לפי המשפט האדיאבטי">
          <GapTab
            gap={gap}
            gapTooMany={gapTooMany}
            gapLoading={gapLoading}
            actualT={schedule.schedule.duration}
            onRunGap={onRunGap}
          />
        </SubSection>
        <SubSection
          title="📊 Spectrum"
          subtitle="ארבעת הע״ע הנמוכים של H(t) — ה-avoided crossing"
        >
          <SpectrumTab
            spectrum={spectrum}
            spectrumTooMany={spectrumTooMany}
            spectrumLoading={spectrumLoading}
            gap={gap}
            onRunSpectrum={onRunSpectrum}
            cursorT={cursorT}
          />
        </SubSection>
        <SubSection
          title="📐 Phase diagram"
          subtitle="⟨Σnᵢ⟩ של מצב היסוד במישור (Ω, Δ)"
        >
          <PhaseTab
            phase={phase}
            phaseTooMany={phaseTooMany}
            phaseLoading={phaseLoading}
            onRunPhase={onRunPhase}
            trajectory={trajectory}
            cursorT={cursorT}
            onPickPhase={onPickPhase}
            phasePick={phasePick}
            onClearPhasePick={onClearPhasePick}
          />
        </SubSection>
      </div>
    </Panel>
  );
}

function SubSection({
  title,
  subtitle,
  children,
}: {
  title: string;
  subtitle?: string;
  children: ReactNode;
}) {
  return (
    <section
      style={{
        padding: 14,
        background: palette.bgInset,
        border: `1px solid ${palette.queraPurpleSoft}`,
        borderRadius: 10,
        display: "flex",
        flexDirection: "column",
        gap: 10,
      }}
    >
      <header style={{ display: "flex", flexDirection: "column", gap: 2 }}>
        <div style={{ fontWeight: 700, fontSize: 13, color: palette.textPrimary }}>
          {title}
        </div>
        {subtitle && (
          <div style={{ fontSize: 11, color: palette.textMuted }}>{subtitle}</div>
        )}
      </header>
      {children}
    </section>
  );
}

function TabActionButton({
  onClick,
  loading,
  label,
  loadingLabel = "מחשב…",
}: {
  onClick: () => void;
  loading: boolean;
  label: string;
  loadingLabel?: string;
}) {
  return (
    <button
      onClick={onClick}
      disabled={loading}
      style={{
        padding: "8px 14px",
        borderRadius: 8,
        border: "none",
        background: palette.queraPurple,
        color: "#fff",
        fontSize: 12,
        fontWeight: 600,
        cursor: loading ? "wait" : "pointer",
        boxShadow: `0 2px 10px ${palette.queraPurpleSoft}`,
      }}
    >
      {loading ? loadingLabel : label}
    </button>
  );
}

function GapTab({
  gap,
  gapTooMany,
  gapLoading,
  actualT,
  onRunGap,
}: {
  gap: GapTraceDTO | null;
  gapTooMany: { n: number; max: number } | null;
  gapLoading: boolean;
  actualT: number;
  onRunGap: () => void;
}) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
      <div style={{ display: "flex", justifyContent: "flex-end" }}>
        <TabActionButton onClick={onRunGap} loading={gapLoading} label="↻ חשב δ_min" />
      </div>
      {gap && (
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(4, 1fr)",
            gap: 10,
            fontSize: 11.5,
            color: palette.textSecondary,
          }}
        >
          <Stat
            label="δ_min"
            value={`${gap.min_gap.toFixed(2)} rad/µs`}
            color={gap.min_gap < 1 ? palette.warn : palette.ok}
          />
          <Stat label="t @ δ_min" value={`${gap.t_at_min_gap.toFixed(2)} µs`} />
          <Stat
            label="T מומלץ"
            value={gap.suggested_t_us == null ? "—" : `${gap.suggested_t_us.toFixed(2)} µs`}
            color={
              gap.suggested_t_us != null && gap.suggested_t_us > actualT
                ? palette.warn
                : palette.queraPurpleGlow
            }
          />
          <Stat label="T נוכחי" value={`${actualT.toFixed(2)} µs`} />
        </div>
      )}
      {gap && gap.suggested_t_us != null && gap.suggested_t_us > actualT && (
        <div style={{ color: palette.warn, fontSize: 12, lineHeight: 1.5 }}>
          ⚠ T הנוכחי קצר מהמומלץ — צפי לסטייה אדיאבטית. שקול להאריך את T או להפעיל Auto-tune.
        </div>
      )}
      {gapTooMany && (
        <div style={{ fontSize: 12, color: palette.textMuted }}>
          הגרף גדול מ-{gapTooMany.max} אטומים ({gapTooMany.n}) — diagonalisation מלאה איטית
          מדי לחישוב מיידי.
        </div>
      )}
      {!gap && !gapTooMany && (
        <div style={{ fontSize: 12, color: palette.textMuted, lineHeight: 1.6 }}>
          לחץ כדי למצוא את הפער המינימלי E₁−E₀ לאורך הפולס. ה-T המומלץ ≈ 1/δ_min² נובע ישירות
          מהמשפט האדיאבטי.
        </div>
      )}
    </div>
  );
}

function SpectrumTab({
  spectrum,
  spectrumTooMany,
  spectrumLoading,
  gap,
  onRunSpectrum,
  cursorT,
}: {
  spectrum: SpectrumTraceDTO | null;
  spectrumTooMany: { n: number; max: number } | null;
  spectrumLoading: boolean;
  gap: GapTraceDTO | null;
  onRunSpectrum: () => void;
  cursorT: number;
}) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
      <div style={{ display: "flex", justifyContent: "flex-end" }}>
        <TabActionButton onClick={onRunSpectrum} loading={spectrumLoading} label="↻ חשב ספקטרום" />
      </div>
      {spectrum && (
        <SpectrumPlot
          trace={spectrum}
          minGapHighlight={
            gap && gap.min_gap > 0
              ? { t_us: gap.t_at_min_gap, gap: gap.min_gap }
              : null
          }
          pixelWidth={980}
          pixelHeight={420}
          cursorT={cursorT}
        />
      )}
      {spectrumTooMany && (
        <div style={{ fontSize: 12, color: palette.textMuted }}>
          הגרף גדול מ-{spectrumTooMany.max} אטומים ({spectrumTooMany.n}). דיאגונליזציה מלאה
          איטית מדי לחישוב סינכרוני.
        </div>
      )}
      {!spectrum && !spectrumTooMany && (
        <div style={{ fontSize: 12, color: palette.textMuted, lineHeight: 1.6 }}>
          לחץ כדי לראות את 4 הרמות הנמוכות של H(t). ה-avoided crossing במינימום הגאפ הוא צוואר
          הבקבוק האדיאבטי.
        </div>
      )}
    </div>
  );
}

function PhaseTab({
  phase,
  phaseTooMany,
  phaseLoading,
  onRunPhase,
  trajectory,
  cursorT,
  onPickPhase,
  phasePick,
  onClearPhasePick,
}: {
  phase: PhaseDiagramDTO | null;
  phaseTooMany: { n: number; max: number } | null;
  phaseLoading: boolean;
  onRunPhase: () => void;
  trajectory: PhaseTrajectoryPoint[];
  cursorT: number;
  onPickPhase: (omega: number, delta: number) => void;
  phasePick: { omega: number; delta: number } | null;
  onClearPhasePick: () => void;
}) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 8 }}>
        <div style={{ fontSize: 11, color: palette.textMuted, display: "flex", alignItems: "center", gap: 10 }}>
          <span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
            <span style={{ width: 14, height: 3, background: palette.ok, borderRadius: 2, boxShadow: `0 0 6px ${palette.ok}` }} />
            נתיב הפולס (Ω(t), Δ(t))
          </span>
          <span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
            <span style={{ width: 10, height: 10, borderRadius: 999, background: palette.warn, boxShadow: `0 0 6px ${palette.warn}` }} />
            מיקום הסמן הנוכחי
          </span>
        </div>
        <TabActionButton
          onClick={onRunPhase}
          loading={phaseLoading}
          label={phase ? "↻ חשב מחדש" : "↻ חשב מפת פאזות"}
        />
      </div>
      {phase && (
        <>
          <div
            style={{
              fontSize: 11,
              color: phasePick ? palette.queraPurpleGlow : palette.textMuted,
              display: "flex",
              alignItems: "center",
              gap: 8,
            }}
          >
            <span>💡 לחץ על נקודה במישור — ה-Hamiltonian למטה יציג את (Ω, Δ) שלה.</span>
            {phasePick && (
              <button
                onClick={onClearPhasePick}
                style={{
                  marginInlineStart: "auto",
                  padding: "3px 10px",
                  borderRadius: 6,
                  border: `1px solid ${palette.queraPurpleSoft}`,
                  background: "transparent",
                  color: palette.textSecondary,
                  fontSize: 10,
                  cursor: "pointer",
                }}
                dir="ltr"
              >
                clear ★ pick
              </button>
            )}
          </div>
          <PhaseDiagram2D
            diagram={phase}
            pixelWidth={980}
            pixelHeight={580}
            trajectory={trajectory}
            cursorT={cursorT}
            onPick={onPickPhase}
            pickedPoint={phasePick}
          />
        </>
      )}
      {phaseTooMany && (
        <div style={{ fontSize: 12, color: palette.textMuted }}>
          הגרף גדול מ-{phaseTooMany.max} אטומים ({phaseTooMany.n}). diagonalisation מלאה על
          מטריצה 2^N × 2^N על גרידה 25×25 איטית מדי.
        </div>
      )}
      {!phase && !phaseTooMany && (
        <div style={{ fontSize: 12, color: palette.textMuted, lineHeight: 1.6 }}>
          לחץ כדי לסרוק את מישור (Ω, Δ) ולראות את הפאזות של מצב היסוד. סריקה אורכת ~1–5 שניות
          עבור N≤8.
        </div>
      )}
    </div>
  );
}

/**
 * Compact play/pause/reset control + speed selector for the cursor animation.
 * Lives just above the PulsePlot. When playing, the cursor sweeps from its
 * current t through to T, then loops to 0.
 */
function PlayControls({
  isPlaying,
  onTogglePlay,
  onReset,
  speed,
  onSpeedChange,
  cursorT,
  totalT,
}: {
  isPlaying: boolean;
  onTogglePlay: () => void;
  onReset: () => void;
  speed: number;
  onSpeedChange: (v: number) => void;
  cursorT: number;
  totalT: number;
}) {
  const progress = totalT > 0 ? Math.min(1, cursorT / totalT) : 0;
  const speeds = [0.25, 0.5, 1, 2];
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        gap: 12,
        padding: "8px 12px",
        marginBottom: 8,
        background: palette.bgInset,
        border: `1px solid ${palette.queraPurpleSoft}`,
        borderRadius: 10,
      }}
    >
      <button
        onClick={onTogglePlay}
        aria-label={isPlaying ? "השהה" : "נגן"}
        style={{
          width: 34,
          height: 34,
          borderRadius: 999,
          border: "none",
          background: isPlaying
            ? `linear-gradient(135deg, ${palette.queraPurpleGlow}, ${palette.queraPurple})`
            : `linear-gradient(135deg, ${palette.ok}, #2ab37a)`,
          color: "#fff",
          cursor: "pointer",
          fontSize: 14,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          boxShadow: isPlaying
            ? `0 0 18px ${palette.queraPurpleGlow}80`
            : `0 0 14px ${palette.ok}60`,
          transition: "background 200ms ease, box-shadow 200ms ease",
        }}
      >
        {isPlaying ? "❚❚" : "▶"}
      </button>
      <button
        onClick={onReset}
        aria-label="התחל מחדש"
        title="reset cursor to t=0"
        style={{
          width: 30,
          height: 30,
          borderRadius: 999,
          border: `1px solid ${palette.queraPurpleSoft}`,
          background: "transparent",
          color: palette.textSecondary,
          cursor: "pointer",
          fontSize: 14,
        }}
      >
        ↺
      </button>
      <div
        style={{
          flex: 1,
          height: 6,
          background: palette.bgPanel,
          borderRadius: 999,
          overflow: "hidden",
          position: "relative",
        }}
      >
        <div
          style={{
            width: `${progress * 100}%`,
            height: "100%",
            background: `linear-gradient(90deg, ${palette.channelOmega}, ${palette.channelDelta})`,
            boxShadow: `0 0 8px ${palette.channelDelta}60`,
            transition: isPlaying ? "none" : "width 200ms ease",
          }}
        />
      </div>
      <div
        style={{
          fontFamily: "var(--font-mono)",
          fontSize: 11.5,
          color: palette.textSecondary,
          minWidth: 86,
          textAlign: "right",
        }}
        dir="ltr"
      >
        t = {cursorT.toFixed(2)} / {totalT.toFixed(2)} µs
      </div>
      <div style={{ display: "flex", gap: 4 }}>
        {speeds.map((s) => {
          const active = Math.abs(s - speed) < 1e-6;
          return (
            <button
              key={s}
              onClick={() => onSpeedChange(s)}
              title={`${s}× µs/s`}
              style={{
                padding: "4px 8px",
                borderRadius: 6,
                border: `1px solid ${
                  active ? palette.queraPurpleGlow : palette.queraPurpleSoft
                }`,
                background: active ? palette.queraPurple : "transparent",
                color: active ? "#fff" : palette.textSecondary,
                fontSize: 10.5,
                fontWeight: 600,
                cursor: "pointer",
                fontFamily: "var(--font-mono)",
              }}
            >
              {s}×
            </button>
          );
        })}
      </div>
    </div>
  );
}

/**
 * Compact "Adiabaticity Score" gauge.
 *
 * Score = clamp(T_actual / T_required, 0, 1) × 100, where T_required is the
 * gap-analysis-suggested duration (~1/δ_min² per the adiabatic theorem). When
 * the analysis hasn't been run yet, show a soft prompt instead of a number —
 * we don't want to guess.
 *
 * Colour-coded bar: ≥80 green, 50–79 yellow, <50 red. Mirrors how Stage 7
 * frames the approximation-ratio R.
 */
function AdiabaticityScore({
  gap,
  actualT,
}: {
  gap: { suggested_t_us: number | null; min_gap: number } | null;
  actualT: number;
}) {
  if (!gap || gap.suggested_t_us == null || gap.suggested_t_us <= 0) {
    return (
      <div
        style={{
          padding: "8px 10px",
          background: "rgba(155,107,255,0.06)",
          border: `1px dashed ${palette.queraPurpleSoft}`,
          borderRadius: 8,
          fontSize: 11,
          color: palette.textMuted,
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
        }}
      >
        <span>Adiabaticity Score</span>
        <span style={{ fontStyle: "italic" }} dir="ltr">
          run ↻ δ_min to compute
        </span>
      </div>
    );
  }

  const ratio = actualT / gap.suggested_t_us;
  const score = Math.max(0, Math.min(100, ratio * 100));
  const tier =
    score >= 80
      ? { color: palette.ok, label: "adiabatic" }
      : score >= 50
        ? { color: palette.warn, label: "marginal" }
        : { color: palette.err, label: "diabatic risk" };

  return (
    <div
      style={{
        padding: "10px 12px",
        background: "rgba(155,107,255,0.08)",
        border: `1px solid ${tier.color}55`,
        borderRadius: 8,
        display: "flex",
        flexDirection: "column",
        gap: 6,
      }}
    >
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "baseline",
          fontSize: 11,
          color: palette.textSecondary,
        }}
      >
        <span style={{ fontWeight: 600 }}>Adiabaticity Score</span>
        <span style={{ color: tier.color, fontWeight: 600 }} dir="ltr">
          {score.toFixed(0)} / 100 · {tier.label}
        </span>
      </div>
      <div
        style={{
          position: "relative",
          height: 8,
          background: palette.bgPanel,
          borderRadius: 999,
          overflow: "hidden",
        }}
      >
        <div
          style={{
            width: `${score}%`,
            height: "100%",
            background: `linear-gradient(90deg, ${tier.color}, ${tier.color}cc)`,
            boxShadow: `0 0 10px ${tier.color}80`,
            transition: "width 320ms ease, background 320ms ease",
          }}
        />
      </div>
      <div
        style={{
          fontSize: 10.5,
          color: palette.textMuted,
          fontFamily: "var(--font-mono)",
        }}
        dir="ltr"
      >
        T / T_required = {actualT.toFixed(2)} / {gap.suggested_t_us.toFixed(2)} µs
      </div>
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
      <div
        style={{ fontFamily: "var(--font-mono)", color, fontSize: 16 }}
        dir="ltr"
      >
        {value}
      </div>
    </div>
  );
}
