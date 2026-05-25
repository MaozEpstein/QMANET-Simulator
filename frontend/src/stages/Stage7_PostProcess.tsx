import { useCallback, useEffect, useMemo, useState } from "react";
import { motion } from "framer-motion";
import { api } from "../api/rest";
import type {
  GraphDTO,
  MeasureResponse,
  PostProcessBatchResponse,
  PostProcessResultDTO,
  SAResponse,
} from "../api/rest";
import { AtomArray2D } from "../components/AtomArray2D";
import { BitstringHistogram } from "../components/BitstringHistogram";
import { ExportButton } from "../components/ExportButton";
import { Panel } from "../components/Panel";
import { usePipeline } from "../store/pipeline";
import { palette } from "../theme/palette";

type Phase = "raw" | "fixed" | "final";

export function Stage7_PostProcess() {
  const { embed, schedule, mis, simulation, setFinalBitstringProbs } = usePipeline();
  const [measurement, setMeasurement] = useState<MeasureResponse | null>(null);
  const [batch, setBatch] = useState<PostProcessBatchResponse | null>(null);
  const [sa, setSa] = useState<SAResponse | null>(null);
  const [shotIdx, setShotIdx] = useState(0);
  const [phase, setPhase] = useState<Phase>("raw");
  const [err, setErr] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const targetGraph: GraphDTO | null = mis?.complement ?? null;

  const probs = simulation.finalBitstringProbs;

  const runAll = useCallback(
    async ({ allowSimulate }: { allowSimulate: boolean }) => {
      if (!embed || !schedule || !targetGraph) return;
      setLoading(true);
      setErr(null);
      try {
        let p = probs;
        if (!p) {
          if (!allowSimulate) return;
          const sim = await api.simulate({
            positions: embed.positions,
            schedule: schedule.schedule,
            n_frames: 15,
          });
          p = sim.final_bitstring_probs;
          setFinalBitstringProbs(p);
        }
        const m = await api.measure({
          bitstring_probs: p,
          n_shots: 200,
          apply_noise: true,
          seed: 42,
        });
        setMeasurement(m);
        const b = await api.postprocessBatch(m.bitstrings, targetGraph, 0);
        setBatch(b);
        const s = await api.classicalSA(targetGraph, { n_sweeps: 200, seed: 7 });
        setSa(s);
      } catch (e) {
        setErr((e as Error).message);
      } finally {
        setLoading(false);
      }
    },
    [embed, schedule, targetGraph, probs, setFinalBitstringProbs],
  );

  // Auto-run on mount only if Stage 5 has already produced the distribution.
  // Otherwise wait for the user to authorise the heavy sesolve via the banner.
  useEffect(() => {
    if (probs) runAll({ allowSimulate: false });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [probs, targetGraph]);

  const current: PostProcessResultDTO | undefined = batch?.results[shotIdx];

  const populations = useMemo(() => {
    if (!current) return [];
    const bits =
      phase === "raw"
        ? current.raw_bitstring
        : phase === "fixed"
          ? current.after_fix_bitstring
          : current.final_bitstring;
    return [...bits].map((c) => (c === "1" ? 1 : 0));
  }, [current, phase]);

  // Auto-advance through raw → fixed → final → next shot, like a slow film
  useEffect(() => {
    if (!batch || batch.results.length === 0) return;
    const id = window.setInterval(() => {
      setPhase((p) => {
        if (p === "raw") return "fixed";
        if (p === "fixed") return "final";
        // advance shot
        setShotIdx((i) => (i + 1) % batch.results.length);
        return "raw";
      });
    }, 1500);
    return () => window.clearInterval(id);
  }, [batch]);

  if (!embed || !schedule || !targetGraph) {
    return (
      <Panel title="שלב 7 · Post-process">
        <div style={{ color: palette.textSecondary }}>
          השלם תחילה את שלבים 2 (גרף משלים), 3 (השמת אטומים), ו-4 (פולס).
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
      {!probs && (
        <Panel title="שלב 7 · Post-processing — ממתין לסימולציה">
          <div
            role="status"
            style={{
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
              שלב 5 (אבולוציה) טרם רץ — Post-processing מצריך shots קוונטיים. רוץ את שלב 5 קודם, או חשב מקומית עכשיו.
            </span>
            <button
              onClick={() => runAll({ allowSimulate: true })}
              disabled={loading}
              style={{
                padding: "6px 14px",
                background: palette.warn,
                color: "#000",
                border: "none",
                borderRadius: 6,
                fontSize: 12,
                fontWeight: 600,
                cursor: loading ? "wait" : "pointer",
                whiteSpace: "nowrap",
              }}
            >
              {loading ? "מחשב…" : "חשב מקומית"}
            </button>
          </div>
        </Panel>
      )}
      {batch && (
        <Panel
          title="Approximation Ratio · השוואת קוונטי ↔ קלאסי"
          subtitle="R = ⟨|IS|⟩ / |MIS*|  — המטריקה הקנונית של Ebadi 2022 (Fig. 5). 1.0 = פתרון אופטימלי."
        >
          <ApproximationRatioPanel batch={batch} sa={sa} />
        </Panel>
      )}

      <Panel
        title="שלב 7 · Post-processing — greedy fix → extension"
        subtitle="כל shot עובר את אלגוריתם §6 של whitepaper: מסירים violations, מרחיבים ל-mIS"
        right={
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <ExportButton
              filename="postprocess"
              data={batch ? { batch, sa, measurement } : null}
            />
            {batch && (
              <div
                style={{
                  fontFamily: "var(--font-mono)",
                  fontSize: 13,
                  color: palette.queraPurpleGlow,
                  background: palette.bgInset,
                  padding: "6px 12px",
                  borderRadius: 8,
                }}
                dir="ltr"
              >
                best |IS| = {batch.summary.best_final_size}
              </div>
            )}
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
            <button
              onClick={() => runAll({ allowSimulate: true })}
              disabled={loading}
              style={{
                padding: "10px 16px",
                background: palette.queraPurple,
                color: "#fff",
                border: "none",
                borderRadius: 8,
                fontWeight: 600,
                cursor: loading ? "wait" : "pointer",
              }}
            >
              {loading ? "מעבד…" : "↻ הרץ pipeline מלא"}
            </button>
            {err && (
              <div style={{ color: palette.err, fontSize: 12 }} dir="ltr">
                {err}
              </div>
            )}

            <PhaseStrip phase={phase} />

            {current && (
              <div
                style={{
                  marginTop: 8,
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
                <Stat label="shot" value={`${shotIdx + 1} / ${batch?.results.length}`} />
                <Stat
                  label="phase"
                  value={
                    phase === "raw"
                      ? "raw measurement"
                      : phase === "fixed"
                        ? "after greedy fix"
                        : "after extension"
                  }
                />
                <Stat label="raw |1|" value={String(current.raw_size)} />
                <Stat
                  label="raw viol."
                  value={String(current.raw_violations)}
                  color={current.raw_violations > 0 ? palette.err : palette.ok}
                />
                <Stat label="fixed |1|" value={String(current.after_fix_size)} />
                <Stat
                  label="final |1|"
                  value={String(current.final_size)}
                  color={palette.ok}
                />
              </div>
            )}

            {batch && (
              <div
                style={{
                  padding: 12,
                  background: palette.bgInset,
                  borderRadius: 8,
                  fontSize: 12,
                  color: palette.textSecondary,
                }}
              >
                <div style={{ marginBottom: 6, color: palette.textPrimary, fontWeight: 600 }}>
                  סיכום בכל ה-shots
                </div>
                <Stat label="quantum mean |IS|" value={batch.summary.mean_final_size.toFixed(2)} />
                <Stat
                  label="quantum best |IS|"
                  value={String(batch.summary.best_final_size)}
                />
                {sa && (
                  <Stat
                    label="classical SA |IS|"
                    value={String(sa.best_size)}
                    color={
                      sa.best_size > batch.summary.best_final_size
                        ? palette.warn
                        : palette.ok
                    }
                  />
                )}
                {mis && mis.size > 0 && (
                  <Stat
                    label="exact MIS |IS|"
                    value={String(mis.size)}
                    color={palette.queraPurpleGlow}
                  />
                )}
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
              highlight={
                phase === "fixed" && current
                  ? new Set(current.removed)
                  : phase === "final" && current
                    ? new Set(current.added)
                    : undefined
              }
              caption={
                current
                  ? `shot #${shotIdx + 1} · phase=${phase}`
                  : "—"
              }
              pixelWidth={620}
              pixelHeight={520}
            />
          </div>
        </div>
      </Panel>

      {measurement && batch && (
        <Panel
          title="התפלגות אחרי post-processing"
          subtitle={`ירוק = best |IS|=${batch.summary.best_final_size}; סגול בוהק = bitstrings במשקל הזה`}
        >
          <BitstringHistogram
            histogram={Object.fromEntries(
              batch.results
                .map((r) => r.final_bitstring)
                .reduce((m: Map<string, number>, b) => m.set(b, (m.get(b) ?? 0) + 1), new Map())
                .entries(),
            )}
            totalShots={batch.results.length}
            highlightSize={batch.summary.best_final_size}
            markedBitstring={
              sa ? bitsFromSet(sa.best_set, embed.n_atoms) : undefined
            }
            pixelWidth={840}
            pixelHeight={260}
            topK={24}
            caption={`quantum × ${batch.results.length} · SA solution marked green`}
          />
        </Panel>
      )}

      <Panel title="הסבר" subtitle="למה צריך post-processing אחרי מדידה">
        <p style={{ margin: 0, color: palette.textSecondary, lineHeight: 1.7 }}>
          המעבר האדיאבטי לא מושלם — diabatic transitions ורעש decoherence (T2*≈5.8µs) גורמים
          ל-shot להפר את אילוץ ה-IS (שני אטומים סמוכים שניהם ב-|r⟩). פתרון Ebadi 2022:
          (א) להסיר greedy את הקודקוד בעל הכי הרבה violations עד שאין; (ב) להוסיף בחזרה כל קודקוד
          שלא יוצר violation — מבטיח שהתוצאה היא mIS מקסימלי. ההשוואה לקלאסי (SA) מראה האם
          הקוונטי נותן יתרון: בשלוש שורות סיכום מימין רואים את ה-quantum mean, classical SA,
          ו-exact MIS.
        </p>
      </Panel>
    </motion.div>
  );
}

function ratioBorderColor(r: number | null): string {
  if (r == null) return palette.queraPurpleSoft;
  if (r >= 0.95) return palette.ok;
  if (r >= 0.8) return palette.warn;
  return palette.err;
}

function ApproximationRatioPanel({
  batch,
  sa,
}: {
  batch: PostProcessBatchResponse;
  sa: SAResponse | null;
}) {
  const target = batch.summary.target_mis_size ?? null;
  const targetUnknown = target == null;
  const qBest = batch.summary.best_r_ratio ?? null;
  const qMean = batch.summary.mean_r_ratio ?? null;
  const saR = sa?.r_ratio ?? null;

  const pct = (r: number | null) => (r == null ? "?" : `${(r * 100).toFixed(1)}%`);
  const summary = targetUnknown
    ? "הגרף גדול מ-28 קודקודים — לא ניתן לחשב את ה-MIS האקזקטי, ולכן R לא זמין."
    : `הקוונטי השיג ${pct(qBest)} מהאופטימום (best), ממוצע ${pct(qMean)} על פני ${batch.summary.n_shots} shots; ה-SA הקלסי השיג ${pct(saR)}.`;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))",
          gap: 14,
        }}
      >
        <RatioCard
          label="Quantum · best R"
          ratio={qBest}
          sub={`best size = ${batch.summary.best_final_size}`}
          numberColor={palette.queraPurpleGlow}
        />
        <RatioCard
          label="Quantum · mean R"
          ratio={qMean}
          sub={`⟨size⟩ = ${batch.summary.mean_final_size.toFixed(2)} · ${batch.summary.n_shots} shots`}
          numberColor={palette.atomGround}
        />
        <RatioCard
          label="Classical SA · R"
          ratio={saR}
          sub={
            sa
              ? `size = ${sa.best_size}${
                  sa.penalty_used ? ` · penalty = ${sa.penalty_used.toFixed(1)}` : ""
                }`
              : "—"
          }
          numberColor={palette.warn}
        />
        <TargetCard targetMis={target} />
      </div>
      <div
        style={{
          padding: "10px 14px",
          background: palette.bgInset,
          border: `1px solid ${palette.queraPurpleSoft}`,
          borderRadius: 8,
          fontSize: 12.5,
          color: palette.textSecondary,
          lineHeight: 1.6,
        }}
      >
        {summary}
      </div>
    </div>
  );
}

function RatioCard({
  label,
  ratio,
  sub,
  numberColor,
}: {
  label: string;
  ratio: number | null;
  sub: string;
  numberColor: string;
}) {
  const display = ratio == null ? "—" : ratio.toFixed(3);
  const border = ratioBorderColor(ratio);
  return (
    <div
      style={{
        background: palette.bgInset,
        border: `1px solid ${border}`,
        borderRadius: 10,
        padding: "14px 16px",
        display: "flex",
        flexDirection: "column",
        gap: 6,
        boxShadow: ratio != null && ratio >= 0.95 ? `0 0 18px ${palette.ok}33` : undefined,
      }}
    >
      <div style={{ fontSize: 11.5, color: palette.textSecondary, letterSpacing: 0.4 }}>
        {label}
      </div>
      <div
        style={{
          fontFamily: "var(--font-mono)",
          color: numberColor,
          fontSize: 32,
          lineHeight: 1.1,
          fontWeight: 700,
        }}
        dir="ltr"
      >
        {display}
      </div>
      <div style={{ fontSize: 11, color: palette.textMuted }} dir="ltr">
        {sub}
      </div>
    </div>
  );
}

function TargetCard({ targetMis }: { targetMis: number | null }) {
  return (
    <div
      style={{
        background: palette.bgInset,
        border: `1px dashed ${palette.queraPurpleSoft}`,
        borderRadius: 10,
        padding: "14px 16px",
        display: "flex",
        flexDirection: "column",
        gap: 6,
      }}
    >
      <div style={{ fontSize: 11.5, color: palette.textSecondary, letterSpacing: 0.4 }}>
        Target · |MIS*|
      </div>
      <div
        style={{
          fontFamily: "var(--font-mono)",
          color: palette.textPrimary,
          fontSize: 32,
          lineHeight: 1.1,
          fontWeight: 700,
        }}
        dir="ltr"
      >
        {targetMis == null ? "—" : targetMis}
      </div>
      <div style={{ fontSize: 11, color: palette.textMuted }} dir="ltr">
        {targetMis == null ? "graph too large for exact MIS" : "exact (networkx Bron–Kerbosch)"}
      </div>
    </div>
  );
}

function bitsFromSet(set: number[], n: number): string {
  const s = new Set(set);
  return Array.from({ length: n }, (_, i) => (s.has(i) ? "1" : "0")).join("");
}

function PhaseStrip({ phase }: { phase: Phase }) {
  const phases: { id: Phase; label: string }[] = [
    { id: "raw", label: "raw measurement" },
    { id: "fixed", label: "greedy fix" },
    { id: "final", label: "extension" },
  ];
  return (
    <div style={{ display: "flex", gap: 4 }}>
      {phases.map((p) => (
        <div
          key={p.id}
          style={{
            flex: 1,
            padding: "6px 8px",
            background: p.id === phase ? palette.queraPurple : palette.bgInset,
            color: p.id === phase ? "#fff" : palette.textMuted,
            border: `1px solid ${palette.queraPurpleSoft}`,
            borderRadius: 6,
            textAlign: "center",
            fontSize: 11,
            fontWeight: p.id === phase ? 600 : 400,
            transition: "all 200ms ease",
          }}
        >
          {p.label}
        </div>
      ))}
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
