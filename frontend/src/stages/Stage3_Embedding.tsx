import { useCallback, useEffect, useMemo, useState } from "react";
import { motion } from "framer-motion";
import { api, type EmbedConfigDTO, type EmbedResponse } from "../api/rest";
import { AtomArray2D } from "../components/AtomArray2D";
import { ConstraintBadge, ConstraintSummary } from "../components/ConstraintBadge";
import { Panel } from "../components/Panel";
import { Slider } from "../components/Slider";
import { usePipeline } from "../store/pipeline";
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

export function Stage3_Embedding() {
  const { mis, embed, setEmbed } = usePipeline();
  const [cfg, setCfg] = useState<EmbedConfigDTO>(DEFAULT_CFG);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const targetGraph = mis?.complement ?? null;

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
              {loading ? "מחשב embedding…" : "↻ הרץ embedding"}
            </button>
            {err && (
              <div style={{ color: palette.err, fontSize: 12 }} dir="ltr">
                {err}
              </div>
            )}
            {embed && <StatsGrid embed={embed} />}
          </div>

          <div>
            {embed && (
              <AtomArray2D
                atoms={embed.positions}
                blockadeRadiusUm={embed.blockade_radius_um}
                edges={embed.induced_edges}
                latticeSpacingUm={cfg.lattice_spacing_um}
                highlight={violationLoci}
                caption={`${embed.n_atoms} atoms · R_b = ${embed.blockade_radius_um.toFixed(2)} µm`}
                pixelWidth={620}
                pixelHeight={620}
              />
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

function StatsGrid({ embed }: { embed: EmbedResponse }) {
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
      <Stat label="R_b" value={`${embed.blockade_radius_um.toFixed(2)} µm`} />
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
