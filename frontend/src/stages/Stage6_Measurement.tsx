import { useCallback, useEffect, useMemo, useState } from "react";
import { motion } from "framer-motion";
import { api } from "../api/rest";
import type { MeasureResponse } from "../api/rest";
import { AtomArray2D } from "../components/AtomArray2D";
import { BitstringHistogram } from "../components/BitstringHistogram";
import { Panel } from "../components/Panel";
import { Slider } from "../components/Slider";
import { usePipeline } from "../store/pipeline";
import { palette } from "../theme/palette";

export function Stage6_Measurement() {
  const { embed, schedule, simulation, setFinalBitstringProbs } = usePipeline();
  const [nShots, setNShots] = useState(200);
  const [applyNoise, setApplyNoise] = useState(true);
  const [seed, setSeed] = useState(42);
  const [measurement, setMeasurement] = useState<MeasureResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  // If Stage 5 already ran, its final bitstring distribution is in the store
  // — measurement proceeds automatically. If not, we *do not* auto-fire a
  // sesolve here: that's the heavy step, and we want the user to authorise
  // it explicitly (either via Stage 5 or the "compute now" button below).
  const probs = simulation.finalBitstringProbs;
  const [computingProbs, setComputingProbs] = useState(false);
  const computeProbsNow = useCallback(async () => {
    if (!embed || !schedule) return;
    setComputingProbs(true);
    setErr(null);
    try {
      const res = await api.simulate({
        positions: embed.positions,
        schedule: schedule.schedule,
        n_frames: 20,
      });
      setFinalBitstringProbs(res.final_bitstring_probs);
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setComputingProbs(false);
    }
  }, [embed, schedule, setFinalBitstringProbs]);

  const sample = useCallback(async () => {
    if (!probs) return;
    setLoading(true);
    setErr(null);
    try {
      const m = await api.measure({
        bitstring_probs: probs,
        n_shots: nShots,
        apply_noise: applyNoise,
        seed,
      });
      setMeasurement(m);
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, [probs, nShots, applyNoise, seed]);

  useEffect(() => {
    if (probs) sample();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [probs]);

  // Shot replay: cycle through bitstrings as if they came in one at a time
  const [shotIndex, setShotIndex] = useState(0);
  useEffect(() => {
    if (!measurement || measurement.bitstrings.length === 0) return;
    setShotIndex(0);
    const id = window.setInterval(() => {
      setShotIndex((idx) => (idx + 1) % measurement.bitstrings.length);
    }, 280);
    return () => window.clearInterval(id);
  }, [measurement?.bitstrings]);

  const currentShotBits = measurement?.bitstrings[shotIndex] ?? "";
  const shotPopulations = useMemo(
    () => [...currentShotBits].map((c) => (c === "1" ? 1 : 0)),
    [currentShotBits],
  );

  if (!embed || !schedule) {
    return (
      <Panel title="שלב 6 · מדידה">
        <div style={{ color: palette.textSecondary }}>
          השלם תחילה את שלב 4 (פולס) ו-5 (אבולוציה).
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
        title="שלב 6 · מדידת shots"
        subtitle="כל shot מתפרק לסיביות מ-Aquila. רעש זיהוי + fill מוחל לפי whitepaper §1.4."
      >
        {!probs && (
          <div
            role="status"
            style={{
              marginBottom: 14,
              padding: "12px 14px",
              borderRadius: 8,
              background: "rgba(255, 181, 71, 0.08)",
              border: `1px solid ${palette.warn}`,
              color: palette.warn,
              fontSize: 12.5,
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              gap: 12,
            }}
          >
            <span>
              שלב 5 (אבולוציה) טרם רץ — אין התפלגות bitstrings למדוד. רוץ את שלב 5 קודם, או חשב מקומית עכשיו.
            </span>
            <button
              onClick={computeProbsNow}
              disabled={computingProbs}
              style={{
                padding: "6px 14px",
                background: palette.warn,
                color: "#000",
                border: "none",
                borderRadius: 6,
                fontSize: 12,
                fontWeight: 600,
                cursor: computingProbs ? "wait" : "pointer",
                whiteSpace: "nowrap",
              }}
            >
              {computingProbs ? "מחשב…" : "חשב מקומית"}
            </button>
          </div>
        )}
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
              label="מס׳ shots"
              value={nShots}
              onChange={setNShots}
              min={10}
              max={2000}
              step={10}
            />
            <Slider label="seed" value={seed} onChange={setSeed} min={0} max={999} step={1} />
            <label
              style={{
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
                fontSize: 12,
                color: palette.textSecondary,
                cursor: "pointer",
              }}
            >
              <span>הפעל רעש Aquila (§1.4)</span>
              <input
                type="checkbox"
                checked={applyNoise}
                onChange={(e) => setApplyNoise(e.target.checked)}
                style={{ accentColor: palette.queraPurpleGlow }}
              />
            </label>
            <button
              onClick={sample}
              disabled={loading || !probs}
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
              {loading ? "מדגם…" : "↻ דגום shots"}
            </button>

            {err && (
              <div style={{ color: palette.err, fontSize: 12 }} dir="ltr">
                {err}
              </div>
            )}

            {measurement && (
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
                <Stat label="shots" value={String(measurement.n_shots)} />
                <Stat label="unique" value={String(Object.keys(measurement.histogram).length)} />
                <Stat
                  label="best |1|"
                  value={String(
                    Math.max(
                      0,
                      ...Object.keys(measurement.histogram).map(
                        (b) => [...b].filter((c) => c === "1").length,
                      ),
                    ),
                  )}
                />
                <Stat label="shot idx" value={`${shotIndex + 1}`} />
              </div>
            )}
          </div>

          <div>
            <AtomArray2D
              atoms={embed.positions}
              blockadeRadiusUm={embed.blockade_radius_um}
              edges={embed.induced_edges}
              latticeSpacingUm={5}
              populations={shotPopulations}
              caption={`shot #${shotIndex + 1}: ${currentShotBits}`}
              pixelWidth={620}
              pixelHeight={520}
            />
          </div>
        </div>
      </Panel>

      {measurement && (
        <Panel
          title="התפלגות bitstrings"
          subtitle="עמודה גבוהה = bitstring שחזר בהרבה shots"
        >
          <BitstringHistogram
            histogram={measurement.histogram}
            totalShots={measurement.n_shots}
            pixelWidth={840}
            pixelHeight={280}
            topK={24}
            caption={applyNoise ? "with noise (§1.4)" : "noiseless"}
          />
        </Panel>
      )}

      {simulation.frames.length > 0 && (
        <Panel
          title="הסבר"
          subtitle="מה אנו מודדים"
          collapsible
          collapseGroup="explanations"
        >
          <p style={{ margin: 0, color: palette.textSecondary, lineHeight: 1.7 }}>
            המצב הסופי{" "}
            <span dir="ltr" className="mono">
              |ψ(T)⟩
            </span>{" "}
            הוא סופרפוזיציה. מדידה במצב המחשוב מתמוטטת אותו ל-bitstring יחיד שכל סיבית בו אומרת אם
            האטום היה ב-|r⟩ (=1) או |g⟩ (=0). אנו מסמלצים את התהליך: דוגמים{" "}
            <span dir="ltr" className="mono">
              n_shots
            </span>{" "}
            פעמים מתפלגות
            <span dir="ltr" className="mono">
              {" "}
              |c_b|²{" "}
            </span>
            ואז (אם הופעל) מחילים את שגיאות הזיהוי האסימטריות (גרעין ↔ ריידברג ≈ 1% ↔ 8%).
            ה-bitstring המוצלח ביותר (משקל המינג גבוה ביותר ⇒ MIS) מודגש בסגול בוהק.
          </p>
        </Panel>
      )}
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
      <div style={{ fontFamily: "var(--font-mono)", color, fontSize: 16 }} dir="ltr">
        {value}
      </div>
    </div>
  );
}
