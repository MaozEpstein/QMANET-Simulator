import { Fragment, useCallback, useEffect, useMemo, useState } from "react";
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

function bitsToIndices(bs: string): number[] {
  const out: number[] = [];
  for (let i = 0; i < bs.length; i++) if (bs[i] === "1") out.push(i);
  return out;
}

type Phase = "raw" | "fixed" | "final";

export function Stage7_PostProcess() {
  const {
    embed,
    schedule,
    mis,
    simulation,
    setFinalBitstringProbs,
    setPostProcess,
    setStage,
  } = usePipeline();
  const [measurement, setMeasurement] = useState<MeasureResponse | null>(null);
  const [batch, setBatch] = useState<PostProcessBatchResponse | null>(null);
  const [sa, setSa] = useState<SAResponse | null>(null);
  const [shotIdx, setShotIdx] = useState(0);
  const [phase, setPhase] = useState<Phase>("raw");
  const [err, setErr] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [autoCycle, setAutoCycle] = useState(true);

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
        // Publish the best result to the store so Stage 8 can route over the
        // quantum-derived backbone, and reload-after-refresh stays useful.
        if (b.results.length > 0) {
          let bestIdx = 0;
          for (let i = 1; i < b.results.length; i++) {
            if (b.results[i].final_size > b.results[bestIdx].final_size) bestIdx = i;
          }
          const best = b.results[bestIdx];
          setPostProcess({
            bestVMIS: bitsToIndices(best.final_bitstring),
            bestBitstring: best.final_bitstring,
            bestSize: best.final_size,
            bestRatio: b.summary.best_r_ratio ?? null,
            nShots: b.summary.n_shots,
            generatedAt: new Date().toISOString(),
          });
        }
        const s = await api.classicalSA(targetGraph, { n_sweeps: 200, seed: 7 });
        setSa(s);
      } catch (e) {
        setErr((e as Error).message);
      } finally {
        setLoading(false);
      }
    },
    [embed, schedule, targetGraph, probs, setFinalBitstringProbs, setPostProcess],
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
    if (!autoCycle) return;
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
  }, [batch, autoCycle]);

  // Best-shot index — used by the Hero panel + jump-to-best.
  const bestShotIdx = useMemo(() => {
    if (!batch || batch.results.length === 0) return -1;
    let best = 0;
    for (let i = 1; i < batch.results.length; i++) {
      if (batch.results[i].final_size > batch.results[best].final_size) best = i;
    }
    return best;
  }, [batch]);
  const bestShot = bestShotIdx >= 0 ? batch?.results[bestShotIdx] : undefined;

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
      {batch && bestShot && embed && (
        <ResultHero
          best={bestShot}
          batchSummary={batch.summary}
          atoms={embed.positions}
          blockadeRadiusUm={embed.blockade_radius_um}
          inducedEdges={embed.induced_edges}
          onContinueToStage8={() => setStage("routing")}
        />
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
            gridTemplateColumns: "minmax(360px, 420px) 1fr",
            gap: 20,
            alignItems: "start",
          }}
        >
          <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
            <div style={{ display: "flex", gap: 8 }}>
              <button
                onClick={() => runAll({ allowSimulate: true })}
                disabled={loading}
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
                {loading ? "מעבד…" : "↻ הרץ pipeline מלא"}
              </button>
              {batch && bestShotIdx >= 0 && (
                <button
                  onClick={() => {
                    setAutoCycle(false);
                    setShotIdx(bestShotIdx);
                    setPhase("final");
                  }}
                  title="קפוץ ל-shot עם best |IS|"
                  style={{
                    padding: "10px 14px",
                    background: "transparent",
                    color: palette.ok,
                    border: `1px solid ${palette.ok}`,
                    borderRadius: 8,
                    fontWeight: 600,
                    cursor: "pointer",
                    fontSize: 12,
                  }}
                >
                  🏆 best
                </button>
              )}
              <button
                onClick={() => setAutoCycle((v) => !v)}
                title={autoCycle ? "השהה אנימציה" : "המשך אנימציה"}
                style={{
                  padding: "10px 12px",
                  background: "transparent",
                  color: palette.textSecondary,
                  border: `1px solid ${palette.queraPurpleSoft}`,
                  borderRadius: 8,
                  cursor: "pointer",
                  fontSize: 13,
                }}
              >
                {autoCycle ? "⏸" : "▶"}
              </button>
            </div>
            {err && (
              <div style={{ color: palette.err, fontSize: 12 }} dir="ltr">
                {err}
              </div>
            )}

            <PhaseStepper
              phase={phase}
              onSelect={(p) => {
                setAutoCycle(false);
                setPhase(p);
              }}
              shotIdx={shotIdx}
              total={batch?.results.length ?? 0}
            />

            {current && <BitstringDiff result={current} />}

            {current && <TransformSummary result={current} />}

            {batch && (
              <ShotsSummaryCard
                batch={batch}
                sa={sa}
                exactMisSize={mis?.size ?? 0}
              />
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
                  ? `shot #${shotIdx + 1} · ${
                      phase === "raw"
                        ? "raw"
                        : phase === "fixed"
                          ? "after greedy fix"
                          : "after extension"
                    }`
                  : "—"
              }
              pixelWidth={500}
              pixelHeight={420}
              showBlockade={false}
            />
          </div>
        </div>
      </Panel>

      {batch && batch.results.length > 0 && (
        <Panel
          title="דיאגנוסטיקה · עבודת ה-post-process"
          subtitle="היסטוגרמת violations ב-shots הגולמיים + מפת raw → final size לכל shot."
        >
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "1fr 1fr",
              gap: 16,
              alignItems: "start",
            }}
          >
            <ViolationsHistogram results={batch.results} />
            <RawVsFinalScatter
              results={batch.results}
              nAtoms={embed?.n_atoms ?? 0}
            />
          </div>
        </Panel>
      )}

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

      <Panel title="הסבר" subtitle="למה צריך post-processing אחרי מדידה" collapsible collapseGroup="explanations">
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

function PhaseStepper({
  phase,
  onSelect,
  shotIdx,
  total,
}: {
  phase: Phase;
  onSelect: (p: Phase) => void;
  shotIdx: number;
  total: number;
}) {
  const phases: { id: Phase; label: string; sub: string }[] = [
    { id: "raw", label: "raw", sub: "measurement" },
    { id: "fixed", label: "fix", sub: "greedy removal" },
    { id: "final", label: "final", sub: "extension" },
  ];
  const activeIdx = phases.findIndex((p) => p.id === phase);
  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        gap: 8,
        padding: "10px 12px",
        background: palette.bgInset,
        borderRadius: 10,
        border: `1px solid ${palette.queraPurpleSoft}`,
      }}
    >
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          fontSize: 11,
          color: palette.textMuted,
          fontFamily: "JetBrains Mono",
        }}
        dir="ltr"
      >
        <span>walkthrough</span>
        {total > 0 && (
          <span>
            shot {shotIdx + 1} / {total}
          </span>
        )}
      </div>
      <div style={{ display: "flex", alignItems: "center", gap: 0 }} dir="ltr">
        {phases.map((p, i) => {
          const isActive = p.id === phase;
          const isPast = i < activeIdx;
          const fg = isActive
            ? "#fff"
            : isPast
              ? palette.queraPurpleGlow
              : palette.textMuted;
          const bg = isActive
            ? palette.queraPurple
            : isPast
              ? `${palette.queraPurpleSoft}66`
              : "transparent";
          return (
            <div key={p.id} style={{ display: "flex", alignItems: "center", flex: 1 }}>
              <button
                onClick={() => onSelect(p.id)}
                style={{
                  flex: 1,
                  padding: "8px 6px",
                  background: bg,
                  color: fg,
                  border: `1px solid ${isActive ? palette.queraPurpleGlow : palette.queraPurpleSoft}`,
                  borderRadius: 8,
                  cursor: "pointer",
                  display: "flex",
                  flexDirection: "column",
                  alignItems: "center",
                  gap: 1,
                  transition: "all 200ms ease",
                  fontFamily: "JetBrains Mono",
                }}
              >
                <span style={{ fontSize: 13, fontWeight: 700 }}>
                  {i + 1}. {p.label}
                </span>
                <span style={{ fontSize: 10, opacity: isActive ? 0.85 : 0.6 }}>
                  {p.sub}
                </span>
              </button>
              {i < phases.length - 1 && (
                <span
                  style={{
                    color: i < activeIdx ? palette.queraPurpleGlow : palette.textMuted,
                    fontSize: 14,
                    padding: "0 4px",
                  }}
                >
                  →
                </span>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

function TransformSummary({ result }: { result: PostProcessResultDTO }) {
  const dFix = result.after_fix_size - result.raw_size; // negative or 0
  const dExt = result.final_size - result.after_fix_size; // positive or 0
  return (
    <div
      style={{
        display: "grid",
        gridTemplateColumns: "1fr auto 1fr auto 1fr",
        gap: 6,
        alignItems: "stretch",
      }}
      dir="ltr"
    >
      <SizeBox
        label="raw"
        value={result.raw_size}
        sub={`${result.raw_violations} violations`}
        subColor={result.raw_violations > 0 ? palette.err : palette.ok}
        color={palette.queraPurpleGlow}
      />
      <DeltaArrow delta={dFix} negative />
      <SizeBox
        label="fix"
        value={result.after_fix_size}
        sub="independent"
        subColor={palette.queraPurpleGlow}
        color={palette.queraPurpleGlow}
      />
      <DeltaArrow delta={dExt} />
      <SizeBox
        label="final"
        value={result.final_size}
        sub={result.is_valid ? "✓ valid IS" : "✕ invalid"}
        subColor={result.is_valid ? palette.ok : palette.err}
        color={palette.ok}
        highlight
      />
    </div>
  );
}

function SizeBox({
  label,
  value,
  sub,
  subColor,
  color,
  highlight,
}: {
  label: string;
  value: number;
  sub: string;
  subColor: string;
  color: string;
  highlight?: boolean;
}) {
  return (
    <div
      style={{
        padding: "8px 10px",
        background: palette.bgInset,
        border: highlight ? `1.5px solid ${color}` : `1px solid ${palette.queraPurpleSoft}`,
        borderRadius: 8,
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        gap: 2,
        boxShadow: highlight ? `0 0 12px ${color}33` : "none",
      }}
    >
      <div
        style={{
          fontSize: 10,
          color: palette.textMuted,
          textTransform: "uppercase",
          letterSpacing: 1,
          fontFamily: "JetBrains Mono",
        }}
      >
        {label}
      </div>
      <div
        style={{
          fontSize: 22,
          color,
          fontWeight: 800,
          lineHeight: 1.1,
          fontFamily: "JetBrains Mono",
        }}
      >
        {value}
      </div>
      <div style={{ fontSize: 10, color: subColor, fontFamily: "JetBrains Mono" }}>
        {sub}
      </div>
    </div>
  );
}

function DeltaArrow({ delta, negative }: { delta: number; negative?: boolean }) {
  const sign = delta > 0 ? "+" : "";
  const color =
    delta === 0
      ? palette.textMuted
      : negative
        ? palette.err
        : palette.ok;
  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        minWidth: 36,
        color,
        fontFamily: "JetBrains Mono",
      }}
    >
      <div style={{ fontSize: 18 }}>→</div>
      <div style={{ fontSize: 11, fontWeight: 700 }}>
        {sign}{delta}
      </div>
    </div>
  );
}

function ShotsSummaryCard({
  batch,
  sa,
  exactMisSize,
}: {
  batch: PostProcessBatchResponse;
  sa: SAResponse | null;
  exactMisSize: number;
}) {
  const cmp = (a: number, b: number) =>
    a > b ? palette.ok : a < b ? palette.warn : palette.textSecondary;
  const rows: { label: string; value: string; color: string }[] = [
    {
      label: "quantum · mean",
      value: batch.summary.mean_final_size.toFixed(2),
      color: palette.queraPurpleGlow,
    },
    {
      label: "quantum · best",
      value: String(batch.summary.best_final_size),
      color: palette.queraPurpleGlow,
    },
  ];
  if (sa) {
    rows.push({
      label: "classical SA",
      value: String(sa.best_size),
      color: cmp(batch.summary.best_final_size, sa.best_size),
    });
  }
  if (exactMisSize > 0) {
    rows.push({
      label: "exact MIS*",
      value: String(exactMisSize),
      color: palette.warn,
    });
  }
  return (
    <div
      style={{
        padding: "10px 12px",
        background: palette.bgInset,
        borderRadius: 10,
        border: `1px solid ${palette.queraPurpleSoft}`,
      }}
    >
      <div
        style={{
          fontSize: 11,
          color: palette.textMuted,
          textTransform: "uppercase",
          letterSpacing: 1,
          marginBottom: 8,
          fontFamily: "JetBrains Mono",
        }}
        dir="ltr"
      >
        across all {batch.summary.n_shots} shots
      </div>
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "auto 1fr",
          gap: "4px 12px",
          alignItems: "baseline",
        }}
      >
        {rows.map((r) => (
          <Fragment key={r.label}>
            <span style={{ fontSize: 11.5, color: palette.textMuted, fontFamily: "JetBrains Mono" }} dir="ltr">
              {r.label}
            </span>
            <span
              style={{
                fontFamily: "JetBrains Mono",
                fontSize: 15,
                color: r.color,
                fontWeight: 700,
              }}
              dir="ltr"
            >
              {r.value}
            </span>
          </Fragment>
        ))}
      </div>
    </div>
  );
}


// ───────────────────────────────────────────────────────────────────────────
// 1. ResultHero — the academic V_MIS, presented prominently.
// ───────────────────────────────────────────────────────────────────────────

function ResultHero({
  best,
  batchSummary,
  atoms,
  blockadeRadiusUm,
  inducedEdges,
  onContinueToStage8,
}: {
  best: PostProcessResultDTO;
  batchSummary: PostProcessBatchResponse["summary"];
  atoms: { id: number; x: number; y: number }[];
  blockadeRadiusUm: number;
  inducedEdges: [number, number][];
  onContinueToStage8: () => void;
}) {
  const indices = useMemo(() => bitsToIndices(best.final_bitstring), [best]);
  const ratio = batchSummary.best_r_ratio ?? null;
  const target = batchSummary.target_mis_size ?? null;
  const ratioColor = ratioBorderColor(ratio);
  const populations = useMemo(
    () => [...best.final_bitstring].map((c) => (c === "1" ? 1 : 0)),
    [best],
  );
  const setNotation = `{${indices.join(", ")}}`;

  const onCopy = useCallback(() => {
    navigator.clipboard?.writeText(setNotation).catch(() => undefined);
  }, [setNotation]);

  const onDownload = useCallback(() => {
    const blob = new Blob(
      [
        JSON.stringify(
          {
            V_MIS: indices,
            size: best.final_size,
            bitstring: best.final_bitstring,
            r_ratio: ratio,
            target_mis_size: target,
            n_shots: batchSummary.n_shots,
            generated_at: new Date().toISOString(),
          },
          null,
          2,
        ),
      ],
      { type: "application/json" },
    );
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "V_MIS.json";
    a.click();
    URL.revokeObjectURL(url);
  }, [indices, best, ratio, target, batchSummary]);

  return (
    <div
      style={{
        background: `radial-gradient(ellipse at top right, ${palette.queraPurple}22 0%, ${palette.bgPanel} 50%, ${palette.bgPanelElevated} 100%)`,
        border: `2px solid ${ratioColor}`,
        borderRadius: 16,
        padding: "22px 26px",
        boxShadow:
          ratio != null && ratio >= 0.95
            ? `0 0 48px ${palette.ok}44, inset 0 0 24px ${palette.ok}11`
            : `0 6px 32px ${palette.queraPurple}33`,
        position: "relative",
        overflow: "hidden",
      }}
    >
      {/* Decorative corner accent */}
      <div
        style={{
          position: "absolute",
          top: -40,
          insetInlineStart: -40,
          width: 120,
          height: 120,
          borderRadius: "50%",
          background: `radial-gradient(circle, ${ratioColor}33 0%, transparent 70%)`,
          pointerEvents: "none",
        }}
      />

      {/* Title strip with subtle underline */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          gap: 12,
          marginBottom: 18,
          paddingBottom: 12,
          borderBottom: `1px solid ${palette.queraPurpleSoft}55`,
        }}
      >
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 10,
            fontSize: 13,
            fontWeight: 700,
            color: palette.textPrimary,
            letterSpacing: 0.3,
          }}
        >
          <span style={{ fontSize: 18 }}>🏁</span>
          <span>התוצר הסופי</span>
          <span style={{ color: palette.textMuted, fontWeight: 400 }} dir="ltr">
            ·  V_MIS (Quantum-derived backbone)
          </span>
        </div>
        <div
          style={{
            padding: "4px 10px",
            background: best.is_valid ? "rgba(61,220,151,0.15)" : "rgba(255,84,112,0.15)",
            border: `1px solid ${best.is_valid ? palette.ok : palette.err}`,
            borderRadius: 999,
            color: best.is_valid ? palette.ok : palette.err,
            fontSize: 11.5,
            fontWeight: 700,
          }}
        >
          {best.is_valid ? "✓ Verified IS" : "✕ Has violations"}
        </div>
      </div>

      <div
        style={{
          display: "grid",
          gridTemplateColumns: "minmax(300px, 360px) 1fr",
          gap: 28,
          alignItems: "center",
        }}
      >
        {/* Compact atom array */}
        <div>
          <AtomArray2D
            atoms={atoms}
            blockadeRadiusUm={blockadeRadiusUm}
            edges={inducedEdges}
            latticeSpacingUm={5}
            populations={populations}
            showBlockade={false}
            showGrid={false}
            caption={`${best.final_size} atoms selected`}
            pixelWidth={360}
            pixelHeight={300}
          />
        </div>

        {/* Right column — answer hierarchy */}
        <div style={{ display: "flex", flexDirection: "column", gap: 18 }}>
          {/* Hero row: massive |V_MIS| + ratio gauge */}
          <div
            style={{
              display: "flex",
              alignItems: "stretch",
              gap: 18,
              flexWrap: "wrap",
            }}
          >
            <div style={{ flex: "1 1 auto", minWidth: 180 }}>
              <div
                style={{
                  fontSize: 11.5,
                  color: palette.textMuted,
                  letterSpacing: 1,
                  textTransform: "uppercase",
                  marginBottom: 2,
                }}
                dir="ltr"
              >
                |V_MIS|  ·  גודל הפתרון
              </div>
              <div
                style={{
                  display: "flex",
                  alignItems: "baseline",
                  gap: 12,
                  fontFamily: "JetBrains Mono",
                }}
                dir="ltr"
              >
                <span
                  style={{
                    fontSize: 64,
                    fontWeight: 800,
                    lineHeight: 1,
                    color: palette.queraPurpleGlow,
                    textShadow: `0 0 24px ${palette.queraPurpleGlow}88`,
                  }}
                >
                  {best.final_size}
                </span>
                {target != null && (
                  <span style={{ fontSize: 22, color: palette.textMuted }}>
                    / {target}
                    <span style={{ fontSize: 13, marginInlineStart: 6, color: palette.textMuted }}>
                      = |MIS*|
                    </span>
                  </span>
                )}
              </div>
            </div>
            {ratio != null && <RatioGauge ratio={ratio} color={ratioColor} />}
          </div>

          {/* V_MIS set rendered as atom pills */}
          <div>
            <div
              style={{
                fontSize: 11.5,
                color: palette.textMuted,
                letterSpacing: 1,
                textTransform: "uppercase",
                marginBottom: 6,
              }}
              dir="ltr"
            >
              V_MIS  ·  selected atoms
            </div>
            <AtomPillSet indices={indices} />
          </div>

          {/* Bitstring representation */}
          <div>
            <div
              style={{
                fontSize: 11.5,
                color: palette.textMuted,
                letterSpacing: 1,
                textTransform: "uppercase",
                marginBottom: 6,
              }}
              dir="ltr"
            >
              bitstring  ·  computational basis
            </div>
            <ColoredBitstring bitstring={best.final_bitstring} />
          </div>

          {/* Actions: CTA + secondary text-style links */}
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: 12,
              flexWrap: "wrap",
              paddingTop: 4,
            }}
          >
            <button
              onClick={onContinueToStage8}
              style={{
                padding: "12px 22px",
                background: `linear-gradient(135deg, ${palette.queraPurple}, ${palette.queraPurpleGlow})`,
                color: "#fff",
                border: "none",
                borderRadius: 10,
                cursor: "pointer",
                fontWeight: 800,
                fontSize: 14,
                letterSpacing: 0.3,
                boxShadow: `0 4px 16px ${palette.queraPurple}77`,
              }}
            >
              ←  המשך לשלב 8 · Routing
            </button>
            <button
              onClick={onCopy}
              style={{
                padding: "8px 12px",
                background: "transparent",
                color: palette.textSecondary,
                border: `1px solid ${palette.queraPurpleSoft}`,
                borderRadius: 8,
                cursor: "pointer",
                fontSize: 12,
              }}
            >
              📋 Copy set
            </button>
            <button
              onClick={onDownload}
              style={{
                padding: "8px 12px",
                background: "transparent",
                color: palette.textSecondary,
                border: `1px solid ${palette.queraPurpleSoft}`,
                borderRadius: 8,
                cursor: "pointer",
                fontSize: 12,
              }}
            >
              ⬇ Download JSON
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

function RatioGauge({ ratio, color }: { ratio: number; color: string }) {
  const pct = Math.max(0, Math.min(1, ratio));
  const W = 140;
  const H = 100;
  const cx = W / 2;
  const cy = H - 12;
  const r = 56;
  // Half-circle arc from (cx-r, cy) to (cx+r, cy) → pct fill.
  const angle = Math.PI * (1 - pct); // 0 = right, π = left
  const ex = cx - r * Math.cos(Math.PI - angle);
  const ey = cy - r * Math.sin(Math.PI - angle);
  const largeArc = pct > 0.5 ? 1 : 0;
  const arcPath = `M ${cx - r} ${cy} A ${r} ${r} 0 ${largeArc} 1 ${ex.toFixed(2)} ${ey.toFixed(2)}`;
  const trackPath = `M ${cx - r} ${cy} A ${r} ${r} 0 1 1 ${cx + r} ${cy}`;
  return (
    <div
      style={{
        flex: "0 0 auto",
        background: palette.bgInset,
        border: `1.5px solid ${color}`,
        borderRadius: 12,
        padding: "10px 14px 6px",
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        boxShadow: `0 0 24px ${color}22`,
      }}
    >
      <div
        style={{
          fontSize: 10.5,
          color: palette.textMuted,
          letterSpacing: 1,
          textTransform: "uppercase",
        }}
      >
        R · approximation
      </div>
      <svg width={W} height={H}>
        <path d={trackPath} fill="none" stroke={palette.queraPurpleSoft} strokeWidth={8} strokeLinecap="round" />
        <path d={arcPath} fill="none" stroke={color} strokeWidth={8} strokeLinecap="round" />
        <text
          x={cx}
          y={cy - 14}
          fontSize={26}
          fill={color}
          fontFamily="JetBrains Mono"
          fontWeight={800}
          textAnchor="middle"
        >
          {ratio.toFixed(3)}
        </text>
      </svg>
    </div>
  );
}

function AtomPillSet({ indices }: { indices: number[] }) {
  const SHOW_MAX = 14;
  const shown = indices.slice(0, SHOW_MAX);
  const overflow = indices.length - shown.length;
  return (
    <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }} dir="ltr">
      {shown.map((i) => (
        <span
          key={i}
          style={{
            display: "inline-flex",
            alignItems: "center",
            justifyContent: "center",
            minWidth: 36,
            height: 30,
            padding: "0 10px",
            background: `linear-gradient(135deg, ${palette.queraPurple}66, ${palette.queraPurpleGlow}55)`,
            border: `1px solid ${palette.queraPurpleGlow}`,
            borderRadius: 999,
            color: "#fff",
            fontFamily: "JetBrains Mono",
            fontSize: 14,
            fontWeight: 700,
            boxShadow: `0 0 12px ${palette.queraPurpleGlow}55`,
          }}
        >
          {i}
        </span>
      ))}
      {overflow > 0 && (
        <span
          style={{
            display: "inline-flex",
            alignItems: "center",
            justifyContent: "center",
            height: 30,
            padding: "0 12px",
            background: palette.bgInset,
            border: `1px dashed ${palette.queraPurpleSoft}`,
            borderRadius: 999,
            color: palette.textMuted,
            fontFamily: "JetBrains Mono",
            fontSize: 12,
          }}
        >
          +{overflow} more
        </span>
      )}
    </div>
  );
}

function ColoredBitstring({ bitstring }: { bitstring: string }) {
  return (
    <div
      style={{
        display: "inline-flex",
        gap: 4,
        padding: "8px 14px",
        background: palette.bgInset,
        borderRadius: 10,
        border: `1px solid ${palette.queraPurpleSoft}`,
        fontFamily: "JetBrains Mono",
      }}
      dir="ltr"
    >
      <span style={{ color: palette.textMuted, fontSize: 20, lineHeight: 1 }}>|</span>
      {[...bitstring].map((c, i) => (
        <span
          key={i}
          style={{
            display: "inline-flex",
            alignItems: "center",
            justifyContent: "center",
            width: 22,
            height: 26,
            fontSize: 16,
            fontWeight: c === "1" ? 800 : 500,
            color: c === "1" ? palette.ok : palette.textMuted,
            background: c === "1" ? `${palette.ok}22` : "transparent",
            border: c === "1" ? `1px solid ${palette.ok}66` : "1px solid transparent",
            borderRadius: 4,
          }}
        >
          {c}
        </span>
      ))}
      <span style={{ color: palette.textMuted, fontSize: 20, lineHeight: 1 }}>⟩</span>
    </div>
  );
}

// ───────────────────────────────────────────────────────────────────────────
// 2. BitstringDiff — per-shot raw/fixed/final with colored deltas.
// ───────────────────────────────────────────────────────────────────────────

function BitstringDiff({ result }: { result: PostProcessResultDTO }) {
  const removed = useMemo(() => new Set(result.removed), [result.removed]);
  const added = useMemo(() => new Set(result.added), [result.added]);
  const rows: { label: string; bits: string; mark: (i: number) => string | undefined }[] = [
    {
      label: "raw",
      bits: result.raw_bitstring,
      mark: (i) => (removed.has(i) ? palette.err : undefined),
    },
    {
      label: "fixed",
      bits: result.after_fix_bitstring,
      mark: (i) => (removed.has(i) ? palette.err : undefined),
    },
    {
      label: "final",
      bits: result.final_bitstring,
      mark: (i) => (added.has(i) ? palette.ok : undefined),
    },
  ];
  return (
    <div
      style={{
        padding: 10,
        background: palette.bgInset,
        borderRadius: 8,
        border: `1px solid ${palette.queraPurpleSoft}`,
        display: "flex",
        flexDirection: "column",
        gap: 6,
      }}
    >
      <div style={{ fontSize: 11, color: palette.textMuted, marginBottom: 2 }}>
        bitstring diff · אדום = הוסר, ירוק = נוסף
      </div>
      {rows.map((row) => (
        <div
          key={row.label}
          style={{ display: "flex", alignItems: "center", gap: 10, fontFamily: "JetBrains Mono", fontSize: 13 }}
          dir="ltr"
        >
          <span style={{ width: 44, color: palette.textMuted, fontSize: 11 }}>{row.label}</span>
          <span style={{ letterSpacing: 1 }}>
            <span style={{ color: palette.textMuted }}>|</span>
            {[...row.bits].map((c, i) => {
              const color = row.mark(i);
              return (
                <span
                  key={i}
                  style={{
                    color: color ?? (c === "1" ? palette.queraPurpleGlow : palette.textMuted),
                    fontWeight: color ? 800 : c === "1" ? 600 : 400,
                  }}
                >
                  {c}
                </span>
              );
            })}
            <span style={{ color: palette.textMuted }}>⟩</span>
          </span>
        </div>
      ))}
    </div>
  );
}

// ───────────────────────────────────────────────────────────────────────────
// 3. ViolationsHistogram — distribution of raw_violations across shots.
// ───────────────────────────────────────────────────────────────────────────

function ViolationsHistogram({ results }: { results: PostProcessResultDTO[] }) {
  const counts = useMemo(() => {
    if (results.length === 0) return [];
    const maxV = Math.max(...results.map((r) => r.raw_violations));
    const c = new Array(maxV + 1).fill(0) as number[];
    for (const r of results) c[r.raw_violations] += 1;
    return c;
  }, [results]);
  const W = 420;
  const H = 220;
  const padLeft = 44;
  const padRight = 14;
  const padTop = 14;
  const padBottom = 36;
  const innerW = W - padLeft - padRight;
  const innerH = H - padTop - padBottom;
  const maxCount = Math.max(1, ...counts);
  const slot = innerW / Math.max(1, counts.length);
  const barW = slot * 0.7;
  const yFor = (c: number) => padTop + (1 - c / maxCount) * innerH;
  return (
    <div>
      <div style={{ fontSize: 12, color: palette.textSecondary, marginBottom: 4 }}>
        violations ב-shots הגולמיים — מציין כמה האבולוציה היתה "מלוכלכת"
      </div>
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
        {[0, 0.25, 0.5, 0.75, 1].map((f) => {
          const y = padTop + (1 - f) * innerH;
          return (
            <g key={f}>
              <line
                x1={padLeft}
                x2={padLeft + innerW}
                y1={y}
                y2={y}
                stroke={palette.queraPurpleSoft}
                strokeOpacity={0.3}
                strokeWidth={0.5}
              />
              <text
                x={padLeft - 6}
                y={y + 3}
                fontSize={10}
                fill={palette.textMuted}
                textAnchor="end"
                fontFamily="JetBrains Mono"
              >
                {Math.round(maxCount * f)}
              </text>
            </g>
          );
        })}
        {counts.map((c, k) => {
          const x = padLeft + k * slot + (slot - barW) / 2;
          const y = yFor(c);
          const h = padTop + innerH - y;
          const fill = k === 0 ? palette.ok : k <= 2 ? palette.warn : palette.err;
          return (
            <g key={k}>
              <rect x={x} y={y} width={barW} height={Math.max(0.5, h)} fill={fill} fillOpacity={0.85} rx={2} />
              {c >= maxCount * 0.05 && (
                <text
                  x={x + barW / 2}
                  y={y - 4}
                  fontSize={10}
                  fill={palette.textSecondary}
                  textAnchor="middle"
                  fontFamily="JetBrains Mono"
                >
                  {c}
                </text>
              )}
              <text
                x={x + barW / 2}
                y={padTop + innerH + 14}
                fontSize={10}
                fill={palette.textMuted}
                textAnchor="middle"
                fontFamily="JetBrains Mono"
              >
                {k}
              </text>
            </g>
          );
        })}
        <text
          x={padLeft + innerW / 2}
          y={H - 6}
          fontSize={11}
          fill={palette.textSecondary}
          fontFamily="JetBrains Mono"
          textAnchor="middle"
        >
          raw violations per shot
        </text>
      </svg>
    </div>
  );
}

// ───────────────────────────────────────────────────────────────────────────
// 4. RawVsFinalScatter — raw_size → final_size scatter with diagonal.
// ───────────────────────────────────────────────────────────────────────────

function RawVsFinalScatter({
  results,
  nAtoms,
}: {
  results: PostProcessResultDTO[];
  nAtoms: number;
}) {
  const W = 420;
  const H = 220;
  const padLeft = 44;
  const padRight = 16;
  const padTop = 14;
  const padBottom = 36;
  const innerW = W - padLeft - padRight;
  const innerH = H - padTop - padBottom;
  const N = Math.max(
    nAtoms,
    1,
    ...results.map((r) => Math.max(r.raw_size, r.final_size)),
  );
  const xFor = (v: number) => padLeft + (v / N) * innerW;
  const yFor = (v: number) => padTop + (1 - v / N) * innerH;

  // Bin overlapping dots for visual density (jitter would distort positions).
  const bins = useMemo(() => {
    const m = new Map<string, number>();
    for (const r of results) {
      const k = `${r.raw_size}|${r.final_size}`;
      m.set(k, (m.get(k) ?? 0) + 1);
    }
    return Array.from(m.entries()).map(([k, count]) => {
      const [raw, fin] = k.split("|").map(Number);
      return { raw, fin, count };
    });
  }, [results]);
  const maxBin = Math.max(1, ...bins.map((b) => b.count));
  const meanDelta = useMemo(() => {
    if (results.length === 0) return 0;
    const sum = results.reduce((s, r) => s + (r.final_size - r.raw_size), 0);
    return sum / results.length;
  }, [results]);

  return (
    <div>
      <div style={{ fontSize: 12, color: palette.textSecondary, marginBottom: 4 }}>
        raw → final size · נקודה לכל shot. מעל האלכסון = ה-extension הוסיף ביטים.
      </div>
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
        {/* Grid */}
        {[0, 0.25, 0.5, 0.75, 1].map((f) => {
          const y = padTop + (1 - f) * innerH;
          return (
            <g key={f}>
              <line
                x1={padLeft}
                x2={padLeft + innerW}
                y1={y}
                y2={y}
                stroke={palette.queraPurpleSoft}
                strokeOpacity={0.25}
                strokeWidth={0.5}
              />
              <text
                x={padLeft - 6}
                y={y + 3}
                fontSize={10}
                fill={palette.textMuted}
                textAnchor="end"
                fontFamily="JetBrains Mono"
              >
                {Math.round(N * f)}
              </text>
            </g>
          );
        })}
        {/* Diagonal y = x */}
        <line
          x1={xFor(0)}
          y1={yFor(0)}
          x2={xFor(N)}
          y2={yFor(N)}
          stroke={palette.textMuted}
          strokeDasharray="4 4"
          strokeOpacity={0.5}
        />
        {/* Dots (radius scaled by bin count) */}
        {bins.map((b, i) => (
          <circle
            key={i}
            cx={xFor(b.raw)}
            cy={yFor(b.fin)}
            r={3 + 4 * (b.count / maxBin)}
            fill={palette.queraPurpleGlow}
            fillOpacity={0.75}
            stroke={palette.queraPurple}
            strokeWidth={0.5}
          />
        ))}
        {/* Axis labels */}
        <text
          x={padLeft + innerW / 2}
          y={H - 6}
          fontSize={11}
          fill={palette.textSecondary}
          fontFamily="JetBrains Mono"
          textAnchor="middle"
        >
          raw_size →
        </text>
        <text
          x={14}
          y={padTop + innerH / 2}
          fontSize={11}
          fill={palette.textSecondary}
          fontFamily="JetBrains Mono"
          textAnchor="middle"
          transform={`rotate(-90 14 ${padTop + innerH / 2})`}
        >
          final_size
        </text>
        {/* Mean Δ chip */}
        <g transform={`translate(${padLeft + 8}, ${padTop + 4})`}>
          <rect
            width={120}
            height={22}
            rx={4}
            fill={palette.bgPanel}
            stroke={meanDelta > 0 ? palette.ok : palette.warn}
            strokeWidth={1}
          />
          <text
            x={60}
            y={15}
            fontSize={11}
            fill={meanDelta > 0 ? palette.ok : palette.warn}
            fontFamily="JetBrains Mono"
            textAnchor="middle"
          >
            mean Δ = +{meanDelta.toFixed(2)}
          </text>
        </g>
      </svg>
    </div>
  );
}
