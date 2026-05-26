import { useCallback, useEffect, useState } from "react";
import { motion } from "framer-motion";
import { api } from "../api/rest";
import { ConstraintBadge, ConstraintSummary } from "../components/ConstraintBadge";
import { HamiltonianTeX } from "../components/HamiltonianTeX";
import { Panel } from "../components/Panel";
import { PhaseDiagram2D } from "../components/PhaseDiagram2D";
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
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [gapLoading, setGapLoading] = useState(false);
  const [spectrumLoading, setSpectrumLoading] = useState(false);
  const [phaseLoading, setPhaseLoading] = useState(false);

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
            <button
              onClick={run}
              disabled={loading}
              style={{
                marginTop: 6,
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
              </div>
            )}
            {schedule && embed && (
              <div
                style={{
                  padding: 12,
                  background: palette.bgInset,
                  borderRadius: 8,
                  border: `1px solid ${palette.queraPurpleSoft}`,
                  display: "flex",
                  flexDirection: "column",
                  gap: 8,
                }}
              >
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 6 }}>
                  <div style={{ fontWeight: 600, fontSize: 12, color: palette.textPrimary }}>
                    ניתוח גאפ אדיאבטי
                  </div>
                  <div style={{ display: "flex", gap: 4 }}>
                    <button
                      onClick={runGapAnalysis}
                      disabled={gapLoading}
                      style={{
                        padding: "5px 10px",
                        borderRadius: 6,
                        border: "none",
                        background: palette.queraPurple,
                        color: "#fff",
                        fontSize: 11,
                        fontWeight: 600,
                        cursor: gapLoading ? "wait" : "pointer",
                      }}
                    >
                      {gapLoading ? "מחשב…" : "↻ חשב δ_min"}
                    </button>
                    <button
                      onClick={runSpectrumAnalysis}
                      disabled={spectrumLoading}
                      style={{
                        padding: "5px 10px",
                        borderRadius: 6,
                        border: `1px solid ${palette.queraPurpleSoft}`,
                        background: "transparent",
                        color: palette.textSecondary,
                        fontSize: 11,
                        fontWeight: 600,
                        cursor: spectrumLoading ? "wait" : "pointer",
                      }}
                    >
                      {spectrumLoading ? "מחשב…" : "📊 ספקטרום"}
                    </button>
                  </div>
                </div>
                {gap && (
                  <div
                    style={{
                      display: "grid",
                      gridTemplateColumns: "1fr 1fr",
                      gap: 8,
                      fontSize: 11.5,
                      color: palette.textSecondary,
                    }}
                  >
                    <Stat
                      label="δ_min"
                      value={`${gap.min_gap.toFixed(2)} rad/µs`}
                      color={gap.min_gap < 1 ? palette.warn : palette.ok}
                    />
                    <Stat
                      label="t @ δ_min"
                      value={`${gap.t_at_min_gap.toFixed(2)} µs`}
                    />
                    <Stat
                      label="T מומלץ"
                      value={
                        gap.suggested_t_us == null
                          ? "—"
                          : `${gap.suggested_t_us.toFixed(2)} µs`
                      }
                      color={
                        gap.suggested_t_us != null && gap.suggested_t_us > schedule.schedule.duration
                          ? palette.warn
                          : palette.queraPurpleGlow
                      }
                    />
                    <Stat
                      label="T נוכחי"
                      value={`${schedule.schedule.duration.toFixed(2)} µs`}
                    />
                    {gap.suggested_t_us != null && gap.suggested_t_us > schedule.schedule.duration && (
                      <div
                        style={{
                          gridColumn: "1 / -1",
                          color: palette.warn,
                          fontSize: 11,
                          lineHeight: 1.4,
                        }}
                      >
                        ⚠ T הנוכחי קצר מהמומלץ — צפי לסטייה אדיאבטית.
                      </div>
                    )}
                  </div>
                )}
                {gapTooMany && (
                  <div style={{ fontSize: 11, color: palette.textMuted }}>
                    הגרף גדול מ-{gapTooMany.max} אטומים ({gapTooMany.n}) — diagonalisation
                    מלאה איטית מדי לחישוב מיידי.
                  </div>
                )}
                {!gap && !gapTooMany && (
                  <div style={{ fontSize: 11, color: palette.textMuted }}>
                    לחץ כדי למצוא את הפער המינימלי E_1−E_0 לאורך הפולס. ה-T המומלץ ≈ 1/δ_min².
                  </div>
                )}
              </div>
            )}
          </div>

          <div>
            {schedule && (
              <PulsePlot
                totalDurationUs={schedule.schedule.duration}
                cursorT={cursorT}
                onCursorChange={setCursorT}
                channels={[
                  {
                    data: schedule.schedule.omega,
                    label: "Ω(t)",
                    units: "rad/µs",
                    upperLimit: AQUILA_LIMITS.rabiMax,
                    lowerLimit: 0,
                    yMin: -1,
                    yMax: Math.max(16.5, AQUILA_LIMITS.rabiMax),
                  },
                  {
                    data: schedule.schedule.delta,
                    label: "Δ(t)",
                    units: "rad/µs",
                    upperLimit: AQUILA_LIMITS.detuningMax,
                    lowerLimit: AQUILA_LIMITS.detuningMin,
                  },
                  {
                    data: schedule.schedule.phi,
                    label: "φ(t)",
                    units: "rad",
                    yMin: -3.2,
                    yMax: 3.2,
                  },
                ]}
              />
            )}
          </div>
        </div>
      </Panel>

      {spectrum && (
        <Panel
          title="📊 ספקטרום אנרגיות לאורך הפולס"
          subtitle="ארבעת הע״ע הנמוכים של H(t). ה-avoided crossing במינימום הגאפ הוא הצוואר הבקבוק האדיאבטי."
        >
          <SpectrumPlot
            trace={spectrum}
            minGapHighlight={
              gap && gap.min_gap > 0
                ? { t_us: gap.t_at_min_gap, gap: gap.min_gap }
                : null
            }
            pixelWidth={920}
            pixelHeight={300}
          />
        </Panel>
      )}
      {spectrumTooMany && (
        <Panel title="📊 ספקטרום אנרגיות">
          <div style={{ fontSize: 12, color: palette.textMuted }}>
            הגרף גדול מ-{spectrumTooMany.max} אטומים ({spectrumTooMany.n}). דיאגונליזציה מלאה איטית
            מדי לחישוב סינכרוני.
          </div>
        </Panel>
      )}

      {embed && (
        <Panel
          title="📐 פאזות במישור (Ω, Δ)"
          subtitle="⟨Σnᵢ⟩ של מצב היסוד בכל נקודה במישור. אזורי צבע = פאזות (no-Rydberg / Z₂ / MIS / fully excited)."
          right={
            <button
              onClick={runPhaseDiagram}
              disabled={phaseLoading}
              style={{
                padding: "6px 12px",
                borderRadius: 6,
                border: "none",
                background: palette.queraPurple,
                color: "#fff",
                fontSize: 11.5,
                fontWeight: 600,
                cursor: phaseLoading ? "wait" : "pointer",
              }}
            >
              {phaseLoading ? "מחשב…" : phase ? "↻ חשב מחדש" : "↻ חשב מפת פאזות"}
            </button>
          }
        >
          {phase && <PhaseDiagram2D diagram={phase} pixelWidth={780} pixelHeight={460} />}
          {phaseTooMany && (
            <div style={{ fontSize: 12, color: palette.textMuted }}>
              הגרף גדול מ-{phaseTooMany.max} אטומים ({phaseTooMany.n}). diagonalisation מלאה על
              מטריצה 2^N × 2^N על גרידה 25×25 איטית מדי.
            </div>
          )}
          {!phase && !phaseTooMany && (
            <div style={{ fontSize: 12, color: palette.textMuted }}>
              לחץ כדי לסרוק את מישור (Ω, Δ) ולראות את הפאזות של מצב היסוד. סריקה אורכת ~1–5 שניות
              עבור N≤8.
            </div>
          )}
        </Panel>
      )}

      {schedule && (
        <Panel
          title="Hamiltonian בזמן הנוכחי"
          subtitle="ערוך את הסליידרים או גרור מעל הגרף כדי לדגום t אחר"
        >
          <HamiltonianTeX
            omega={valueAt(schedule.schedule.omega, cursorT)}
            delta={valueAt(schedule.schedule.delta, cursorT)}
            phi={valueAt(schedule.schedule.phi, cursorT)}
            nAtoms={embed?.n_atoms ?? 0}
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
