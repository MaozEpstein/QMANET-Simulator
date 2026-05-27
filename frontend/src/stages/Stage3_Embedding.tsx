import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { motion } from "framer-motion";
import { api, type EmbedConfigDTO, type EmbedResponse } from "../api/rest";
import { AtomArray2D } from "../components/AtomArray2D";
import { ConstraintBadge, ConstraintSummary } from "../components/ConstraintBadge";
import { Panel } from "../components/Panel";
import { Slider } from "../components/Slider";
import { blockadeRadiusUm } from "../lib/aquilaConstants";
import { selectStaleStages, usePipeline } from "../store/pipeline";
import { StaleBanner } from "../components/StaleBanner";
import { palette } from "../theme/palette";

const DEFAULT_CFG: EmbedConfigDTO = {
  lattice_spacing_um: 5,
  rabi_rad_us: 15,
  detuning_rad_us: 0,
  layout_seed: 0,
  layout_iterations: 200,
  snap_to_grid: true,
  rescale_to_region: true,
  margin_um: 2,
};

// Auto-tune search space. 7 × 7 = 49 trials, ~1-2 sec at N=16 (see Stage 3
// review). Lattice spacings concentrate near typical values (4-6 µm) with a
// few wider options for graphs that benefit from larger atom separations.
const AUTO_TUNE_SPACINGS = [4, 4.5, 5, 5.5, 6, 7, 8];
const AUTO_TUNE_SEEDS = [0, 1, 2, 3, 4, 5, 6];

interface AutoTuneOutcome {
  spacing: number;
  seed: number;
  fidelity: number;
  violations: number;
  missing: number;
  spurious: number;
}

/**
 * Decide which of two embedding results is "better" for the auto-tune ranker.
 * Lexicographic ordering:
 *   1. fewer hard violations (any violation kills usability on hardware)
 *   2. higher embedding_fidelity (Jaccard of induced vs target edge sets)
 *   3. fewer total bad edges (missing + spurious) — secondary tiebreak
 */
function isBetter(a: EmbedResponse, b: EmbedResponse): boolean {
  if (a.violations.length !== b.violations.length) {
    return a.violations.length < b.violations.length;
  }
  const df = a.embedding_fidelity - b.embedding_fidelity;
  if (Math.abs(df) > 1e-6) return df > 0;
  const aBad = a.missing_edges.length + a.spurious_edges.length;
  const bBad = b.missing_edges.length + b.spurious_edges.length;
  return aBad < bBad;
}

export function Stage3_Embedding() {
  const { mis, embed, setEmbed } = usePipeline();
  const [cfg, setCfg] = useState<EmbedConfigDTO>(DEFAULT_CFG);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  // Auto-tune state — progress counter + the winning trial so we can flash a
  // "found X" toast after the sweep completes.
  const [autoTuning, setAutoTuning] = useState(false);
  const [autoTuneProgress, setAutoTuneProgress] = useState({ done: 0, total: 0 });
  const [autoTuneWin, setAutoTuneWin] = useState<AutoTuneOutcome | null>(null);

  const targetGraph = mis?.complement ?? null;

  const stale = usePipeline((s) => selectStaleStages(s).embed);

  // Drag-to-move atoms: immediate local update for snappy feedback, debounced
  // backend recompute for authoritative induced-edges/violations/fidelity.
  const recomputeTimerRef = useRef<number | null>(null);
  const handleAtomDrag = useCallback(
    (id: number, x: number, y: number) => {
      if (!embed) return;
      const newPositions = embed.positions.map((p) =>
        p.id === id ? { ...p, x, y } : p,
      );
      // Optimistic local update — keeps the atom + blockade ring under the cursor.
      setEmbed({ ...embed, positions: newPositions });

      if (recomputeTimerRef.current !== null) {
        window.clearTimeout(recomputeTimerRef.current);
      }
      recomputeTimerRef.current = window.setTimeout(async () => {
        recomputeTimerRef.current = null;
        try {
          const res = await api.embedRecompute({
            positions: newPositions,
            target_graph: targetGraph!,
            blockade_radius_um: embed.blockade_radius_um,
          });
          setEmbed(res);
        } catch (e) {
          // Drag is best-effort — surface only via console; the local update
          // remains and the next manual "↻ הרץ embedding" will resync.
          console.warn("embedRecompute failed:", e);
        }
      }, 150);
    },
    [embed, targetGraph, setEmbed],
  );

  const run = useCallback(async () => {
    if (!targetGraph) return;
    setLoading(true);
    setErr(null);
    try {
      const res = await api.embed({ target_graph: targetGraph, config: cfg });
      setEmbed(res);
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, [targetGraph, cfg, setEmbed]);

  const runAutoTune = useCallback(async () => {
    if (!targetGraph || autoTuning) return;
    const total = AUTO_TUNE_SPACINGS.length * AUTO_TUNE_SEEDS.length;
    setAutoTuning(true);
    setAutoTuneProgress({ done: 0, total });
    setAutoTuneWin(null);
    setErr(null);
    // Track the best (config, response) pair while sweeping. We keep both so
    // we can apply the winner to the UI sliders (cfg) and to the visualization
    // (setEmbed) in a single commit after the sweep.
    let bestRes: EmbedResponse | null = null;
    let bestCfg: EmbedConfigDTO | null = null;
    let done = 0;
    try {
      for (const spacing of AUTO_TUNE_SPACINGS) {
        for (const seed of AUTO_TUNE_SEEDS) {
          const trialCfg: EmbedConfigDTO = {
            ...cfg,
            lattice_spacing_um: spacing,
            layout_seed: seed,
          };
          const res = await api.embed({
            target_graph: targetGraph,
            config: trialCfg,
          });
          if (!bestRes || isBetter(res, bestRes)) {
            bestRes = res;
            bestCfg = trialCfg;
          }
          done++;
          setAutoTuneProgress({ done, total });
        }
      }
      if (bestRes && bestCfg) {
        setCfg(bestCfg);
        setEmbed(bestRes);
        setAutoTuneWin({
          spacing: bestCfg.lattice_spacing_um,
          seed: bestCfg.layout_seed,
          fidelity: bestRes.embedding_fidelity,
          violations: bestRes.violations.length,
          missing: bestRes.missing_edges.length,
          spurious: bestRes.spurious_edges.length,
        });
      }
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setAutoTuning(false);
    }
  }, [targetGraph, cfg, setEmbed, autoTuning]);

  useEffect(() => {
    if (targetGraph && (!embed || embed.n_atoms !== targetGraph.n_nodes)) {
      run();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [targetGraph]);

  const violationLoci = useMemo(() => {
    const set = new Set<number>();
    if (!embed) return set;
    for (const v of embed.violations) {
      if (typeof v.locus.atom_idx === "number") set.add(v.locus.atom_idx as number);
      if (typeof v.locus.other_idx === "number") set.add(v.locus.other_idx as number);
    }
    return set;
  }, [embed]);

  // Live R_b: recomputed from the current sliders on every render, so the
  // blockade rings in the visualization update *as the user drags Ω*, before
  // they click "↻ הרץ embedding" to actually rebuild the atom array. The
  // formula matches backend/aquila/constants.py:blockade_radius_um.
  const liveBlockadeRadiusUm = useMemo(
    () => blockadeRadiusUm(cfg.rabi_rad_us, cfg.detuning_rad_us),
    [cfg.rabi_rad_us, cfg.detuning_rad_us],
  );
  // True when the slider has been moved since the last "Run" — used to
  // visually distinguish "preview, not yet applied" from "matches actual run".
  const liveDiffersFromRun = useMemo(() => {
    if (!embed) return false;
    return Math.abs(embed.blockade_radius_um - liveBlockadeRadiusUm) > 1e-3;
  }, [embed, liveBlockadeRadiusUm]);

  if (!targetGraph) {
    return (
      <Panel title="שלב 3 · השמת אטומים">
        <div style={{ color: palette.textSecondary }}>
          ראשית הריצו את שלב 2 (גרף משלים) כדי לקבל את גרף המטרה (Ḡ).
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
      {stale && (
        <StaleBanner
          upstreamLabel="גרף ה-MIS (שלב 2)"
          actionLabel="הרץ embedding מחדש"
          onAction={run}
        />
      )}
      <Panel
        title="שלב 3 · השמת אטומים על מערך Aquila"
        subtitle="ממקמים את קודקודי Ḡ על אטומים פיזיים כך שרדיוס הבליעה (Rydberg blockade) משחזר את הקשתות"
        right={embed ? <ConstraintSummary violations={embed.violations} /> : null}
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
              label="מרווח סריג"
              value={cfg.lattice_spacing_um}
              onChange={(v) => setCfg({ ...cfg, lattice_spacing_um: v })}
              min={4}
              max={15}
              step={0.5}
              unit="µm"
            />
            <Slider
              label="Ω (Rabi)"
              value={cfg.rabi_rad_us}
              onChange={(v) => setCfg({ ...cfg, rabi_rad_us: v })}
              min={1}
              max={15.8}
              step={0.1}
              unit="rad/µs"
            />
            <Slider
              label="Δ (detuning)"
              value={cfg.detuning_rad_us}
              onChange={(v) => setCfg({ ...cfg, detuning_rad_us: v })}
              min={-30}
              max={30}
              step={0.5}
              unit="rad/µs"
            />
            <Slider
              label="layout seed"
              value={cfg.layout_seed}
              onChange={(v) => setCfg({ ...cfg, layout_seed: v })}
              min={0}
              max={99}
              step={1}
            />
            <ToggleRow
              label="snap לרשת"
              value={cfg.snap_to_grid}
              onChange={(v) => setCfg({ ...cfg, snap_to_grid: v })}
            />
            <ToggleRow
              label="התאם לאזור 75×76"
              value={cfg.rescale_to_region}
              onChange={(v) => setCfg({ ...cfg, rescale_to_region: v })}
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
                  cursor: loading || autoTuning ? "wait" : "pointer",
                  opacity: autoTuning ? 0.55 : 1,
                }}
              >
                {loading ? "מחשב embedding…" : "↻ הרץ embedding"}
              </button>
              <button
                onClick={runAutoTune}
                disabled={loading || autoTuning}
                title="סורק 49 שילובים של lattice_spacing × layout_seed ובוחר את זה עם הכי הרבה fidelity"
                style={{
                  padding: "10px 14px",
                  background: autoTuning ? palette.bgInset : "transparent",
                  color: palette.queraPurpleGlow,
                  border: `1px solid ${palette.queraPurpleGlow}`,
                  borderRadius: 8,
                  fontWeight: 600,
                  fontSize: 12,
                  cursor: loading || autoTuning ? "wait" : "pointer",
                  whiteSpace: "nowrap",
                }}
              >
                🎯 Auto-tune
              </button>
            </div>
            {autoTuning && (
              <AutoTuneProgress
                done={autoTuneProgress.done}
                total={autoTuneProgress.total}
              />
            )}
            {!autoTuning && autoTuneWin && (
              <AutoTuneResult outcome={autoTuneWin} />
            )}
            {err && (
              <div style={{ color: palette.err, fontSize: 12 }} dir="ltr">
                {err}
              </div>
            )}
            {embed && (
              <StatsGrid
                embed={embed}
                liveBlockadeRadiusUm={liveBlockadeRadiusUm}
                liveDiffers={liveDiffersFromRun}
              />
            )}
          </div>

          <div>
            {embed && (
              <AtomArray2D
                atoms={embed.positions}
                // Live R_b drives the blockade rings — they update on every
                // Ω / Δ slider tick so the user can see the *effect* of a
                // change before paying the cost of re-running the embed.
                blockadeRadiusUm={liveBlockadeRadiusUm}
                edges={embed.induced_edges}
                latticeSpacingUm={cfg.lattice_spacing_um}
                highlight={violationLoci}
                showAtomLabels
                caption={
                  liveDiffersFromRun
                    ? `${embed.n_atoms} atoms · R_b (preview) = ${liveBlockadeRadiusUm.toFixed(2)} µm — run to apply`
                    : `${embed.n_atoms} atoms · R_b = ${liveBlockadeRadiusUm.toFixed(2)} µm`
                }
                pixelWidth={620}
                pixelHeight={620}
                onAtomDrag={handleAtomDrag}
                dragSnapUm={1}
              />
            )}
            {embed && (
              <div
                style={{
                  marginTop: 6,
                  fontSize: 11,
                  color: palette.textMuted,
                  textAlign: "center",
                }}
              >
                💡 גרור אטום כדי לתקן הפרה ידנית
              </div>
            )}
          </div>
        </div>
      </Panel>

      {embed && embed.violations.length > 0 && (
        <Panel title="הפרות אילוצים" subtitle="כל הפרה ניתנת לתיקון על-ידי שינוי הפרמטרים מימין">
          <div style={{ display: "grid", gap: 8 }}>
            {embed.violations.map((v, i) => (
              <ConstraintBadge key={i} violation={v} />
            ))}
          </div>
        </Panel>
      )}

      <Panel title="הסבר" subtitle="הקשר בין הגאומטריה למפעיל Rydberg של Aquila" collapsible collapseGroup="explanations">
        <p style={{ margin: 0, color: palette.textSecondary, lineHeight: 1.7 }}>
          האילוץ של Aquila: שני אטומים במרחק קטן מ-<span dir="ltr" className="mono">R_b</span> לא
          יכולים להיות שניהם במצב Rydberg. כלומר ה-MIS שמצא הסולבר על מערך האטומים שווה ל-MIS של
          גרף הדיסקים-יחידה — גרף שבו קשת קיימת אם המרחק ≤ R_b. <strong>embedding_fidelity</strong>{" "}
          מודד עד כמה הגאומטריה שלנו משחזרת את גרף המטרה: 1.0 = שחזור מושלם, ערכים נמוכים יותר =
          חלק מקשתות Ḡ אינן נתפסות. נוסחת R_b:{" "}
          <span dir="ltr" className="mono">
            R_b = (C₆ / √(Ω² + Δ²))^(1/6)
          </span>{" "}
          (מ-whitepaper §1.3).
        </p>
      </Panel>
    </motion.div>
  );
}

function StatsGrid({
  embed,
  liveBlockadeRadiusUm,
  liveDiffers,
}: {
  embed: EmbedResponse;
  liveBlockadeRadiusUm: number;
  liveDiffers: boolean;
}) {
  return (
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
      <Stat label="אטומים" value={String(embed.n_atoms)} />
      <Stat
        // R_b cell switches between "R_b live" (preview of slider) and the
        // value used by the last embed run. The double form is so the user
        // always knows whether the rings on the canvas match the rest of
        // the analysis or are mid-edit.
        label={liveDiffers ? "R_b (preview · live)" : "R_b"}
        value={
          liveDiffers
            ? `${liveBlockadeRadiusUm.toFixed(2)} → run ${embed.blockade_radius_um.toFixed(2)} µm`
            : `${liveBlockadeRadiusUm.toFixed(2)} µm`
        }
        color={liveDiffers ? palette.warn : palette.queraPurpleGlow}
      />
      <Stat label="קשתות מושרות" value={String(embed.induced_edges.length)} />
      <Stat
        label="Fidelity"
        value={`${(embed.embedding_fidelity * 100).toFixed(1)}%`}
        color={
          embed.embedding_fidelity > 0.9
            ? palette.ok
            : embed.embedding_fidelity > 0.6
              ? palette.warn
              : palette.err
        }
      />
      <Stat label="קשתות חסרות" value={String(embed.missing_edges.length)} />
      <Stat label="קשתות עודפות" value={String(embed.spurious_edges.length)} />
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

function ToggleRow({
  label,
  value,
  onChange,
}: {
  label: string;
  value: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
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
      <span>{label}</span>
      <input
        type="checkbox"
        checked={value}
        onChange={(e) => onChange(e.target.checked)}
        style={{ accentColor: palette.queraPurpleGlow }}
      />
    </label>
  );
}

function AutoTuneProgress({ done, total }: { done: number; total: number }) {
  const pct = total > 0 ? (done / total) * 100 : 0;
  return (
    <div
      style={{
        padding: 10,
        background: palette.bgInset,
        borderRadius: 8,
        fontSize: 11.5,
        color: palette.textSecondary,
      }}
    >
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          marginBottom: 6,
        }}
      >
        <span>סורק שילובים…</span>
        <span style={{ fontFamily: "var(--font-mono)", color: palette.queraPurpleGlow }} dir="ltr">
          {done} / {total}
        </span>
      </div>
      <div
        style={{
          height: 5,
          background: palette.bgPanel,
          borderRadius: 999,
          overflow: "hidden",
        }}
      >
        <div
          style={{
            width: `${pct}%`,
            height: "100%",
            background: palette.queraPurpleGlow,
            transition: "width 80ms linear",
          }}
        />
      </div>
    </div>
  );
}

function AutoTuneResult({ outcome }: { outcome: { spacing: number; seed: number; fidelity: number; violations: number; missing: number; spurious: number } }) {
  const fidPct = (outcome.fidelity * 100).toFixed(1);
  const fidColor =
    outcome.fidelity > 0.9
      ? palette.ok
      : outcome.fidelity > 0.6
        ? palette.warn
        : palette.err;
  return (
    <div
      style={{
        padding: 10,
        background: palette.bgInset,
        borderRadius: 8,
        border: `1px solid ${palette.queraPurpleGlow}55`,
        fontSize: 11.5,
        color: palette.textSecondary,
      }}
    >
      <div style={{ color: palette.queraPurpleGlow, fontWeight: 600, marginBottom: 6 }}>
        🎯 Auto-tune — נמצא שילוב מיטבי
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 6 }} dir="ltr">
        <div>
          <span style={{ color: palette.textMuted }}>spacing</span>{" "}
          <span style={{ fontFamily: "var(--font-mono)", color: palette.textPrimary }}>
            {outcome.spacing} µm
          </span>
        </div>
        <div>
          <span style={{ color: palette.textMuted }}>seed</span>{" "}
          <span style={{ fontFamily: "var(--font-mono)", color: palette.textPrimary }}>
            {outcome.seed}
          </span>
        </div>
        <div>
          <span style={{ color: palette.textMuted }}>fidelity</span>{" "}
          <span style={{ fontFamily: "var(--font-mono)", color: fidColor }}>
            {fidPct}%
          </span>
        </div>
        <div>
          <span style={{ color: palette.textMuted }}>violations</span>{" "}
          <span
            style={{
              fontFamily: "var(--font-mono)",
              color: outcome.violations === 0 ? palette.ok : palette.err,
            }}
          >
            {outcome.violations}
          </span>
        </div>
        <div style={{ gridColumn: "1 / -1" }}>
          <span style={{ color: palette.textMuted }}>edges</span>{" "}
          <span style={{ fontFamily: "var(--font-mono)" }}>
            {outcome.missing} missing · {outcome.spurious} spurious
          </span>
        </div>
      </div>
    </div>
  );
}
