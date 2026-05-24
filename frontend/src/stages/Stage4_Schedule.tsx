import { useCallback, useEffect, useState } from "react";
import { motion } from "framer-motion";
import { api } from "../api/rest";
import { ConstraintBadge, ConstraintSummary } from "../components/ConstraintBadge";
import { HamiltonianTeX } from "../components/HamiltonianTeX";
import { Panel } from "../components/Panel";
import { PulsePlot, valueAt } from "../components/PulsePlot";
import { Slider } from "../components/Slider";
import { usePipeline } from "../store/pipeline";
import { palette } from "../theme/palette";

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
  const { embed, schedule, setSchedule } = usePipeline();
  const [params, setParams] = useState<PaperPresetParams>(DEFAULT_PARAMS);
  const [cursorT, setCursorT] = useState<number>(2.0);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const run = useCallback(async () => {
    setLoading(true);
    setErr(null);
    try {
      const res = await api.schedule({
        preset: "paper_linear_ramp",
        preset_params: { ...params },
      });
      setSchedule(res);
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, [params, setSchedule]);

  useEffect(() => {
    run();
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
