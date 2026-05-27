import { useCallback, useEffect, useMemo, useState } from "react";
import { motion } from "framer-motion";
import { api } from "../api/rest";
import type { MeasureResponse } from "../api/rest";
import { AtomArray2D } from "../components/AtomArray2D";
import { BitstringHistogram } from "../components/BitstringHistogram";
import { Panel } from "../components/Panel";
import { Slider } from "../components/Slider";
import { StaleBanner } from "../components/StaleBanner";
import {
  bitstringIsIndependent,
  bitstringSize,
  type Edge,
} from "../lib/misMetrics";
import {
  sampleMultinomial,
  totalVariationDistance,
} from "../lib/sampling";
import { selectStaleStages, usePipeline } from "../store/pipeline";
import { palette } from "../theme/palette";

// Log-spaced N values for the TVD-vs-N convergence curve. Range 10 → 5000.
const CONVERGENCE_NS = [
  10, 20, 40, 80, 150, 300, 600, 1000, 1800, 3000, 5000,
] as const;

export function Stage6_Measurement() {
  const { embed, schedule, mis, simulation } = usePipeline();
  const [nShots, setNShots] = useState(200);
  const [seed, setSeed] = useState(42);
  const [noisy, setNoisy] = useState<MeasureResponse | null>(null);
  const [clean, setClean] = useState<MeasureResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const staleSim = usePipeline((s) => selectStaleStages(s).simulation);

  const probs = simulation.finalBitstringProbs;
  const inducedEdges: readonly Edge[] = useMemo(
    () => (embed?.induced_edges ?? []) as Edge[],
    [embed?.induced_edges],
  );
  const targetMisSize = mis?.size ?? null;

  // Shared bitstring ordering: by truth probability desc. Drives all three
  // histograms + the four convergence minis so the user can visually trace a
  // single bitstring across all panels.
  const orderedKeys = useMemo(() => {
    if (!probs) return [] as string[];
    return Object.entries(probs)
      .sort(([, a], [, b]) => b - a)
      .map(([k]) => k);
  }, [probs]);

  const sample = useCallback(async () => {
    if (!probs) return;
    setLoading(true);
    setErr(null);
    try {
      const [n, c] = await Promise.all([
        api.measure({ bitstring_probs: probs, n_shots: nShots, apply_noise: true, seed }),
        api.measure({ bitstring_probs: probs, n_shots: nShots, apply_noise: false, seed }),
      ]);
      setNoisy(n);
      setClean(c);
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, [probs, nShots, seed]);

  useEffect(() => {
    if (probs) sample();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [probs]);

  // Shot replay — paused by default; manual + slow auto-advance.
  const [shotIndex, setShotIndex] = useState(0);
  const [autoPlay, setAutoPlay] = useState(false);
  const [shotsPerSec, setShotsPerSec] = useState(2);
  useEffect(() => {
    if (!autoPlay || !noisy || noisy.bitstrings.length === 0) return;
    const interval = Math.max(50, Math.round(1000 / shotsPerSec));
    const id = window.setInterval(() => {
      setShotIndex((i) => (i + 1) % noisy.bitstrings.length);
    }, interval);
    return () => window.clearInterval(id);
  }, [autoPlay, shotsPerSec, noisy?.bitstrings]);
  useEffect(() => {
    setShotIndex(0);
  }, [noisy?.bitstrings]);

  const currentShotBits = noisy?.bitstrings[shotIndex] ?? "";
  const shotPopulations = useMemo(
    () => [...currentShotBits].map((c) => (c === "1" ? 1 : 0)),
    [currentShotBits],
  );

  // Hamming-weight distribution over the noisy shots. Length = nAtoms + 1
  // (weight can be 0..N). The MIS-validity flag per weight is computed by
  // checking whether ANY shot at that weight is a valid independent set —
  // a coarse heuristic that's still useful for the green/red bar coloring.
  const weightHistogram = useMemo(() => {
    if (!noisy || !embed) return null;
    const N = embed.n_atoms;
    const counts = new Array(N + 1).fill(0) as number[];
    const validAtWeight = new Array(N + 1).fill(0) as number[];
    for (const bs of noisy.bitstrings) {
      const w = bitstringSize(bs);
      counts[w] += 1;
      if (bitstringIsIndependent(bs, inducedEdges)) validAtWeight[w] += 1;
    }
    return { counts, validAtWeight, total: noisy.bitstrings.length, N };
  }, [noisy, embed, inducedEdges]);

  // Per-shot classification, accumulated over the noisy shots (these are the
  // ones that will flow to Stage 7).
  const quality = useMemo(() => {
    if (!noisy) return null;
    let valid = 0;
    let feasible = 0;
    let violations = 0;
    let bestSize = 0;
    let totalSize = 0;
    for (const bs of noisy.bitstrings) {
      const size = bitstringSize(bs);
      totalSize += size;
      if (size > bestSize) bestSize = size;
      if (bitstringIsIndependent(bs, inducedEdges)) {
        feasible += 1;
        if (targetMisSize !== null && size === targetMisSize) valid += 1;
      } else {
        violations += 1;
      }
    }
    const n = noisy.bitstrings.length || 1;
    return {
      validPct: valid / n,
      feasiblePct: feasible / n,
      violationPct: violations / n,
      bestSize,
      meanSize: totalSize / n,
      validCount: valid,
      total: noisy.bitstrings.length,
    };
  }, [noisy, inducedEdges, targetMisSize]);

  // Shot chip classification (for the current replay frame).
  const currentClass = useMemo(() => {
    if (!currentShotBits) return null;
    const indep = bitstringIsIndependent(currentShotBits, inducedEdges);
    const size = bitstringSize(currentShotBits);
    const isMis = indep && targetMisSize !== null && size === targetMisSize;
    return { indep, size, isMis };
  }, [currentShotBits, inducedEdges, targetMisSize]);

  // Convergence curve: TVD(N) for log-spaced N. Pure frontend multinomial
  // draws — no backend roundtrip, refreshes instantly when the seed slider
  // moves. Markers also include the user's current `nShots` so they can read
  // off "where am I on this curve".
  // When the truth distribution is concentrated (delta-like: a single
  // bitstring with p > 0.99), TVD is identically 0 for all N — the graph
  // looks empty. We flag this so the user gets an explanation instead of
  // wondering whether the plot is broken.
  const convergence = useMemo(() => {
    if (!probs) return null;
    const points = CONVERGENCE_NS.map((n) => {
      const hist = sampleMultinomial(probs, n, seed);
      const tvd = totalVariationDistance(hist, probs);
      return { n, tvd };
    });
    const currentHist = sampleMultinomial(probs, nShots, seed);
    const currentTvd = totalVariationDistance(currentHist, probs);
    const maxProb = Math.max(...Object.values(probs));
    const deltaLike = maxProb > 0.99;
    return {
      points,
      current: { n: nShots, tvd: currentTvd },
      deltaLike,
      maxProb,
    };
  }, [probs, seed, nShots]);

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
      {staleSim && (
        <StaleBanner
          upstreamLabel="שלב 5 (אבולוציה)"
          actionLabel="חזור לשלב 5 והרץ"
          onAction={() => usePipeline.getState().setStage("evolution")}
        />
      )}

      <Panel
        title="שלב 6 · מדידת shots"
        subtitle="גשר בין |c_b|² התיאורטי לבין shots דיסקרטיים שיוצאים מ-Aquila. דגימה מוסיפה רעש סטטיסטי; SPAM מוסיף עיוות נוסף."
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
            }}
          >
            שלב 5 (אבולוציה) טרם רץ — אין התפלגות bitstrings למדוד. חזור לשלב 5 ולחץ "↻ הרץ אבולוציה" קודם.
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

            {quality && (
              <div
                style={{
                  display: "grid",
                  gridTemplateColumns: "1fr 1fr",
                  gap: 8,
                  marginTop: 10,
                }}
              >
                <MetricCard
                  label="% valid MIS"
                  value={`${(quality.validPct * 100).toFixed(1)}%`}
                  color={palette.ok}
                />
                <MetricCard
                  label="% feasible"
                  value={`${(quality.feasiblePct * 100).toFixed(1)}%`}
                  color={palette.queraPurpleGlow}
                />
                <MetricCard
                  label="% violations"
                  value={`${(quality.violationPct * 100).toFixed(1)}%`}
                  color={quality.violationPct > 0.2 ? palette.err : palette.warn}
                />
                <MetricCard
                  label="best |1|"
                  value={String(quality.bestSize)}
                  color={palette.queraPurpleGlow}
                />
                <MetricCard
                  label="mean |1|"
                  value={quality.meanSize.toFixed(2)}
                  color={palette.textSecondary}
                />
                <MetricCard
                  label="valid count"
                  value={`${quality.validCount} / ${quality.total}`}
                  color={palette.textSecondary}
                />
              </div>
            )}
          </div>

          <div>
            <ShotReplayToolbar
              autoPlay={autoPlay}
              setAutoPlay={setAutoPlay}
              shotsPerSec={shotsPerSec}
              setShotsPerSec={setShotsPerSec}
              shotIndex={shotIndex}
              total={noisy?.bitstrings.length ?? 0}
              setShotIndex={setShotIndex}
              chip={currentClass}
              chipBits={currentShotBits}
            />
            <AtomArray2D
              atoms={embed.positions}
              blockadeRadiusUm={embed.blockade_radius_um}
              edges={embed.induced_edges}
              latticeSpacingUm={5}
              populations={shotPopulations}
              caption={`shot #${shotIndex + 1}: ${currentShotBits}`}
              pixelWidth={620}
              pixelHeight={500}
            />
          </div>
        </div>
      </Panel>

      {weightHistogram && (
        <Panel
          title="התפלגות Hamming weight · גודל קבוצת הפתרון"
          subtitle="כמה shots החזירו k אטומים ב-|r⟩. עמודה גבוהה ב-k=|MIS*| = המחשב הקוונטי מצא פתרון בגודל הנכון."
        >
          <HammingWeightPlot
            counts={weightHistogram.counts}
            validAtWeight={weightHistogram.validAtWeight}
            total={weightHistogram.total}
            N={weightHistogram.N}
            targetMisSize={targetMisSize}
          />
        </Panel>
      )}

      {noisy && quality && (
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            padding: "10px 14px",
            background: "rgba(61,220,151,0.08)",
            border: `1px solid ${palette.ok}`,
            borderRadius: 8,
            color: palette.ok,
            fontSize: 12.5,
          }}
        >
          <span>
            ✓ {noisy.bitstrings.length} shots מוכנים ({quality.validCount}{" "}
            תקפי MIS) — המשך לשלב 7 לתיקון violations ופוסט-פרוסס.
          </span>
          <button
            onClick={() => usePipeline.getState().setStage("postprocess")}
            style={{
              background: palette.ok,
              color: "#0a1a12",
              border: "none",
              borderRadius: 6,
              padding: "5px 14px",
              fontSize: 12,
              fontWeight: 700,
              cursor: "pointer",
            }}
          >
            לשלב 7 →
          </button>
        </div>
      )}

      {probs && noisy && clean && (
        <Panel
          title="התפלגות bitstrings · השוואה משולשת"
          subtitle="(1) Truth |c_b|²  ↔  (2) Sampled noiseless  ↔  (3) Sampled with Aquila SPAM. אותו ציר X לכל הגרפים."
        >
          <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
            <CompactHistogramRow
              caption={`(1) Truth · |c_b|²  ·  N(unique)=${Object.keys(probs).length}`}
              hint="מה התיאוריה אומרת — הסתברות יחסית לכל bitstring אחרי האבולוציה (סכום = 1)."
              histogram={probs}
              totalShots={Object.values(probs).reduce((s, v) => s + v, 0)}
              orderedKeys={orderedKeys}
              valueKind="probability"
              highlightSize={targetMisSize ?? undefined}
            />
            <CompactHistogramRow
              caption={`(2) Sampled, noiseless · N=${nShots} shots`}
              hint="מה היה רואים על חומרה אידיאלית. הפער מ-(1) = רעש סטטיסטי שמצטמצם כש-N גדל."
              histogram={clean.histogram}
              totalShots={clean.n_shots}
              orderedKeys={orderedKeys}
              highlightSize={targetMisSize ?? undefined}
            />
            <CompactHistogramRow
              caption={`(3) Sampled, Aquila SPAM · N=${nShots} shots`}
              hint="מה רואים בפועל ב-Aquila. הפער מ-(2) = שגיאות זיהוי (g→r ≈ 1%, r→g ≈ 8%). שימו לב ל-bitstrings חדשים שצצים."
              histogram={noisy.histogram}
              totalShots={noisy.n_shots}
              orderedKeys={orderedKeys}
              highlight
              highlightSize={targetMisSize ?? undefined}
            />
          </div>
        </Panel>
      )}

      {convergence && (
        <Panel
          title="התכנסות · TVD(N) מ-truth"
          subtitle="ככל ש-N גדל, TVD בין הדגימה ל-|c_b|² התיאורטי יורד. אפס = זהה. הנקודה הצהובה = ה-N הנוכחי שלך."
          collapsible
          collapseGroup="convergence"
        >
          {convergence.deltaLike && (
            <div
              style={{
                marginBottom: 10,
                padding: "10px 14px",
                background: "rgba(255,181,71,0.08)",
                border: `1px solid ${palette.warn}`,
                borderRadius: 8,
                color: palette.warn,
                fontSize: 12.5,
                lineHeight: 1.65,
              }}
            >
              💡 ההתפלגות הסופית מרוכזת על bitstring יחיד (
              <span dir="ltr" style={{ fontFamily: "JetBrains Mono" }}>
                p_max = {convergence.maxProb.toFixed(3)}
              </span>
              ) — לכן TVD ≈ 0 לכל N והעקומה שטוחה. זה{" "}
              <strong>סימן טוב</strong>: האבולוציה האדיאבטית בשלב 5 הצליחה לרכז
              את כל המסה על MIS האופטימלי. כדי לראות עקומת התכנסות אמיתית:
              הקצר את T בשלב 4, או הפעל רעש Lindblad בשלב 5.
            </div>
          )}
          <TvdConvergencePlot
            points={convergence.points}
            currentN={convergence.current.n}
            currentTvd={convergence.current.tvd}
          />
        </Panel>
      )}

      {simulation.frames.length > 0 && (
        <Panel title="הסבר" subtitle="מה אנו מודדים" collapsible collapseGroup="explanations">
          <p style={{ margin: 0, color: palette.textSecondary, lineHeight: 1.7 }}>
            המצב הסופי{" "}
            <span dir="ltr" className="mono">
              |ψ(T)⟩
            </span>{" "}
            הוא סופרפוזיציה. מדידה במצב המחשוב מתמוטטת אותו ל-bitstring יחיד שכל סיבית בו אומרת אם
            האטום היה ב-|r⟩ (=1) או |g⟩ (=0). דוגמים{" "}
            <span dir="ltr" className="mono">n_shots</span> פעמים מהתפלגות{" "}
            <span dir="ltr" className="mono">|c_b|²</span>. עם רעש Aquila (§1.4) מוחל גם שגיאת
            זיהוי אסימטרית (g↔r ≈ 1%↔8%) — הסיבה לכך שהגרף השלישי שונה מהשני.
          </p>
        </Panel>
      )}
    </motion.div>
  );
}

function MetricCard({
  label,
  value,
  color,
}: {
  label: string;
  value: string;
  color: string;
}) {
  return (
    <div
      style={{
        padding: 10,
        background: palette.bgInset,
        border: `1px solid ${palette.queraPurpleSoft}`,
        borderRadius: 8,
      }}
    >
      <div style={{ color: palette.textMuted, fontSize: 11 }}>{label}</div>
      <div
        style={{ fontFamily: "JetBrains Mono", color, fontSize: 16, marginTop: 2 }}
        dir="ltr"
      >
        {value}
      </div>
    </div>
  );
}

function CompactHistogramRow({
  caption,
  hint,
  histogram,
  totalShots,
  orderedKeys,
  highlight,
  valueKind,
  highlightSize,
}: {
  caption: string;
  hint?: string;
  histogram: Record<string, number>;
  totalShots: number;
  orderedKeys: string[];
  highlight?: boolean;
  valueKind?: "shots" | "probability";
  highlightSize?: number;
}) {
  return (
    <div>
      <div
        style={{
          fontSize: 11.5,
          color: highlight ? palette.queraPurpleGlow : palette.textSecondary,
          marginBottom: 2,
          fontWeight: 600,
        }}
      >
        {caption}
      </div>
      {hint && (
        <div
          style={{
            fontSize: 11,
            color: palette.textMuted,
            marginBottom: 6,
            lineHeight: 1.5,
          }}
        >
          {hint}
        </div>
      )}
      <BitstringHistogram
        histogram={histogram}
        totalShots={totalShots}
        pixelWidth={860}
        pixelHeight={170}
        topK={Math.min(24, orderedKeys.length)}
        orderedKeys={orderedKeys}
        valueKind={valueKind}
        highlightSize={highlightSize}
      />
    </div>
  );
}

function ShotReplayToolbar({
  autoPlay,
  setAutoPlay,
  shotsPerSec,
  setShotsPerSec,
  shotIndex,
  total,
  setShotIndex,
  chip,
  chipBits,
}: {
  autoPlay: boolean;
  setAutoPlay: (v: boolean | ((p: boolean) => boolean)) => void;
  shotsPerSec: number;
  setShotsPerSec: (n: number) => void;
  shotIndex: number;
  total: number;
  setShotIndex: (i: number) => void;
  chip: { indep: boolean; size: number; isMis: boolean } | null;
  chipBits: string;
}) {
  const speeds = [1, 2, 5];
  const step = (d: number) => {
    if (total === 0) return;
    setAutoPlay(false);
    setShotIndex((shotIndex + d + total) % total);
  };
  if (total === 0) return null;
  const chipColor = chip?.isMis
    ? palette.ok
    : chip?.indep
      ? palette.queraPurpleGlow
      : palette.err;
  const chipLabel = chip?.isMis
    ? "✓ MIS"
    : chip?.indep
      ? "feasible"
      : "✕ violation";
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        gap: 8,
        padding: "8px 10px",
        marginBottom: 8,
        background: palette.bgInset,
        borderRadius: 8,
        border: `1px solid ${palette.queraPurpleSoft}`,
      }}
    >
      <IconBtn onClick={() => { setAutoPlay(false); setShotIndex(0); }} title="לתחילה">⏮</IconBtn>
      <IconBtn onClick={() => step(-1)} title="קודם">◀</IconBtn>
      <IconBtn
        onClick={() => setAutoPlay((v) => !v)}
        title={autoPlay ? "השהה" : "נגן"}
        primary={autoPlay}
      >
        {autoPlay ? "⏸" : "▶"}
      </IconBtn>
      <IconBtn onClick={() => step(1)} title="הבא">▶</IconBtn>
      <IconBtn onClick={() => { setAutoPlay(false); setShotIndex(total - 1); }} title="לסוף">⏭</IconBtn>
      <div style={{ display: "flex", alignItems: "center", gap: 4, marginInlineStart: 6 }}>
        <span style={{ fontSize: 10.5, color: palette.textMuted }}>קצב:</span>
        {speeds.map((s) => (
          <button
            key={s}
            onClick={() => setShotsPerSec(s)}
            style={{
              padding: "2px 7px",
              fontSize: 10.5,
              background: shotsPerSec === s ? palette.queraPurple : "transparent",
              color: shotsPerSec === s ? "#fff" : palette.textSecondary,
              border: `1px solid ${palette.queraPurpleSoft}`,
              borderRadius: 4,
              cursor: "pointer",
            }}
          >
            {s}/s
          </button>
        ))}
      </div>
      <div
        style={{
          marginInlineStart: "auto",
          display: "flex",
          gap: 10,
          alignItems: "center",
          fontFamily: "JetBrains Mono",
          fontSize: 11.5,
        }}
        dir="ltr"
      >
        <span style={{ color: palette.textPrimary }}>
          |{chipBits || "—"}⟩
        </span>
        <span style={{ color: chipColor }}>
          weight={chip?.size ?? 0} · {chipLabel}
        </span>
        <span style={{ color: palette.textMuted }}>
          {shotIndex + 1} / {total}
        </span>
      </div>
    </div>
  );
}

function IconBtn({
  children,
  onClick,
  title,
  primary,
}: {
  children: React.ReactNode;
  onClick: () => void;
  title: string;
  primary?: boolean;
}) {
  return (
    <button
      onClick={onClick}
      title={title}
      style={{
        padding: "3px 0",
        minWidth: 30,
        background: primary ? palette.queraPurple : "transparent",
        color: primary ? "#fff" : palette.textSecondary,
        border: `1px solid ${palette.queraPurpleSoft}`,
        borderRadius: 4,
        fontSize: 12,
        cursor: "pointer",
      }}
    >
      {children}
    </button>
  );
}

function HammingWeightPlot({
  counts,
  validAtWeight,
  total,
  N,
  targetMisSize,
}: {
  counts: number[];
  validAtWeight: number[];
  total: number;
  N: number;
  targetMisSize: number | null;
}) {
  const W = 880;
  const H = 220;
  const padLeft = 56;
  const padRight = 20;
  const padTop = 14;
  const padBottom = 38;
  const innerW = W - padLeft - padRight;
  const innerH = H - padTop - padBottom;
  const maxCount = Math.max(1, ...counts);
  const barSlot = innerW / (N + 1);
  const barW = barSlot * 0.7;
  const yFor = (c: number) => padTop + (1 - c / maxCount) * innerH;

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
        {/* Y axis grid */}
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
                x={padLeft - 8}
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

        {/* Target-MIS vertical marker */}
        {targetMisSize !== null && targetMisSize >= 0 && targetMisSize <= N && (
          <g>
            <line
              x1={padLeft + (targetMisSize + 0.5) * barSlot}
              x2={padLeft + (targetMisSize + 0.5) * barSlot}
              y1={padTop}
              y2={padTop + innerH}
              stroke={palette.ok}
              strokeOpacity={0.65}
              strokeWidth={1.4}
              strokeDasharray="4 3"
            />
            <text
              x={padLeft + (targetMisSize + 0.5) * barSlot + 5}
              y={padTop + 12}
              fontSize={11}
              fill={palette.ok}
              fontFamily="JetBrains Mono"
            >
              |MIS*| = {targetMisSize}
            </text>
          </g>
        )}

        {/* Bars: stacked (valid in green on top of invalid in purple) */}
        {counts.map((c, k) => {
          const valid = validAtWeight[k] ?? 0;
          const invalid = c - valid;
          const x = padLeft + k * barSlot + (barSlot - barW) / 2;
          const yTopValid = yFor(c);
          const hValid = (valid / maxCount) * innerH;
          const hInvalid = (invalid / maxCount) * innerH;
          return (
            <g key={k}>
              {/* Invalid (independent-set violators) — purple */}
              {invalid > 0 && (
                <rect
                  x={x}
                  y={yTopValid + hValid}
                  width={barW}
                  height={Math.max(0.5, hInvalid)}
                  fill={palette.queraPurple}
                  fillOpacity={0.55}
                  rx={2}
                />
              )}
              {/* Valid (passes independence check) — green */}
              {valid > 0 && (
                <rect
                  x={x}
                  y={yTopValid}
                  width={barW}
                  height={Math.max(0.5, hValid)}
                  fill={palette.ok}
                  fillOpacity={0.85}
                  rx={2}
                />
              )}
              {/* Count label */}
              {c >= maxCount * 0.05 && (
                <text
                  x={x + barW / 2}
                  y={yFor(c) - 4}
                  fontSize={10}
                  fill={palette.textSecondary}
                  textAnchor="middle"
                  fontFamily="JetBrains Mono"
                >
                  {c}
                </text>
              )}
              {/* X label */}
              <text
                x={x + barW / 2}
                y={padTop + innerH + 14}
                fontSize={10}
                fill={k === targetMisSize ? palette.ok : palette.textMuted}
                textAnchor="middle"
                fontFamily="JetBrains Mono"
                fontWeight={k === targetMisSize ? 700 : 400}
              >
                {k}
              </text>
            </g>
          );
        })}

        {/* Axes labels */}
        <text
          x={padLeft + innerW / 2}
          y={H - 6}
          fontSize={11}
          fill={palette.textSecondary}
          fontFamily="JetBrains Mono"
          textAnchor="middle"
        >
          Hamming weight k (= atoms in |r⟩)
        </text>
        <text
          x={14}
          y={padTop + innerH / 2}
          fontSize={11}
          fill={palette.textSecondary}
          fontFamily="JetBrains Mono"
          transform={`rotate(-90 14 ${padTop + innerH / 2})`}
          textAnchor="middle"
        >
          shots
        </text>

        {/* Legend */}
        <g transform={`translate(${padLeft + innerW - 200}, ${padTop + 4})`}>
          <rect width={10} height={10} fill={palette.ok} fillOpacity={0.85} />
          <text x={14} y={9} fontSize={10.5} fill={palette.ok} fontFamily="JetBrains Mono">
            valid (independent)
          </text>
          <rect y={16} width={10} height={10} fill={palette.queraPurple} fillOpacity={0.55} />
          <text x={14} y={25} fontSize={10.5} fill={palette.queraPurple} fontFamily="JetBrains Mono">
            violation
          </text>
        </g>
      </svg>
      <div
        style={{
          fontSize: 11,
          color: palette.textMuted,
          marginTop: 6,
          lineHeight: 1.5,
        }}
      >
        ✓ ירוק = shots ש-bitstring שלהם הוא independent set; סגול = הפרת blockade.
        סך הכל: {total} shots.
      </div>
    </div>
  );
}

function TvdConvergencePlot({
  points,
  currentN,
  currentTvd,
}: {
  points: { n: number; tvd: number }[];
  currentN: number;
  currentTvd: number;
}) {
  const W = 880;
  const H = 240;
  const padLeft = 60;
  const padRight = 30;
  const padTop = 18;
  const padBottom = 38;
  const innerW = W - padLeft - padRight;
  const innerH = H - padTop - padBottom;
  // Log-X axis. Domain in log10(N): [log10(min), log10(max)]; include the
  // current N so the cursor line never falls outside the plot.
  const minN = Math.max(1, Math.min(...points.map((p) => p.n), currentN));
  const maxN = Math.max(...points.map((p) => p.n), currentN);
  const logMin = Math.log10(minN);
  const logMax = Math.log10(maxN);
  const xFor = (n: number) =>
    padLeft + ((Math.log10(n) - logMin) / Math.max(1e-9, logMax - logMin)) * innerW;
  const yFor = (tvd: number) =>
    padTop + (1 - Math.max(0, Math.min(1, tvd))) * innerH;

  const path = points
    .map((p, i) => `${i === 0 ? "M" : "L"}${xFor(p.n).toFixed(1)},${yFor(p.tvd).toFixed(1)}`)
    .join(" ");

  // Log-decade tick marks (N = 10, 100, 1000, …) within the actual data range.
  const decades: number[] = [];
  for (let e = Math.ceil(logMin); e <= Math.floor(logMax); e++) {
    decades.push(Math.pow(10, e));
  }

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
        {/* Y gridlines + labels at 0, 0.25, 0.5, 0.75, 1 */}
        {[0, 0.25, 0.5, 0.75, 1].map((v) => (
          <g key={v}>
            <line
              x1={padLeft}
              x2={padLeft + innerW}
              y1={yFor(v)}
              y2={yFor(v)}
              stroke={palette.queraPurpleSoft}
              strokeOpacity={0.3}
              strokeWidth={0.6}
            />
            <text
              x={padLeft - 8}
              y={yFor(v) + 3}
              fontSize={11}
              fill={palette.textMuted}
              fontFamily="JetBrains Mono"
              textAnchor="end"
            >
              {v.toFixed(2)}
            </text>
          </g>
        ))}

        {/* X axis: log-decade ticks */}
        {decades.map((n) => (
          <g key={n}>
            <line
              x1={xFor(n)}
              x2={xFor(n)}
              y1={padTop + innerH}
              y2={padTop + innerH + 4}
              stroke={palette.textMuted}
              strokeWidth={0.7}
            />
            <text
              x={xFor(n)}
              y={padTop + innerH + 18}
              fontSize={11}
              fill={palette.textMuted}
              fontFamily="JetBrains Mono"
              textAnchor="middle"
            >
              {n >= 1000 ? `${n / 1000}k` : String(n)}
            </text>
          </g>
        ))}
        <text
          x={padLeft + innerW / 2}
          y={H - 6}
          fontSize={11}
          fill={palette.textSecondary}
          fontFamily="JetBrains Mono"
          textAnchor="middle"
        >
          N (shots, log scale)
        </text>
        <text
          x={14}
          y={padTop + innerH / 2}
          fontSize={11.5}
          fill={palette.textSecondary}
          fontFamily="JetBrains Mono"
          transform={`rotate(-90 14 ${padTop + innerH / 2})`}
          textAnchor="middle"
        >
          TVD
        </text>

        {/* Convergence curve */}
        <path d={path} fill="none" stroke={palette.queraPurpleGlow} strokeWidth={2} />
        {points.map((p) => (
          <circle
            key={p.n}
            cx={xFor(p.n)}
            cy={yFor(p.tvd)}
            r={3.5}
            fill={palette.queraPurpleGlow}
          />
        ))}

        {/* Current-N marker */}
        <line
          x1={xFor(currentN)}
          x2={xFor(currentN)}
          y1={padTop}
          y2={padTop + innerH}
          stroke={palette.warn}
          strokeOpacity={0.6}
          strokeDasharray="4 3"
          strokeWidth={1.2}
        />
        <circle cx={xFor(currentN)} cy={yFor(currentTvd)} r={5} fill={palette.warn} />
        <text
          x={Math.min(W - 8, xFor(currentN) + 8)}
          y={Math.max(padTop + 12, yFor(currentTvd) - 8)}
          fontSize={11}
          fill={palette.warn}
          fontFamily="JetBrains Mono"
          textAnchor="start"
        >
          you · N={currentN} · TVD={currentTvd.toFixed(3)}
        </text>
      </svg>
    </div>
  );
}
