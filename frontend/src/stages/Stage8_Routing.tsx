import { useCallback, useEffect, useMemo, useState } from "react";
import { motion } from "framer-motion";
import { api } from "../api/rest";
import type { RouteDTO, RouteVia, RoutingResponse } from "../api/rest";
import { Panel } from "../components/Panel";
import { RoutingView, viaColor } from "../components/RoutingView";
import { usePipeline } from "../store/pipeline";
import { palette } from "../theme/palette";

const VIA_LABEL: Record<RouteVia, string> = {
  direct: "ישיר (1 hop)",
  backbone: "דרך ה-backbone",
  fallback: "fallback (BFS)",
};

export function Stage8_Routing() {
  const { manet, mis, postProcess } = usePipeline();
  const [routing, setRouting] = useState<RoutingResponse | null>(null);
  const [src, setSrc] = useState<number | undefined>(undefined);
  const [dst, setDst] = useState<number | undefined>(undefined);
  const [err, setErr] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  // Prefer the quantum-derived V_MIS from Stage 7 when available — that's
  // the whole pipeline narrative ("MANET → MIS via Rydberg → routing"). Fall
  // back to Stage 2's exact MIS when Stage 7 hasn't run yet so the routing
  // panel is still useful on a fresh pipeline.
  const backboneSource: "quantum" | "exact" | "none" =
    postProcess && postProcess.bestVMIS.length > 0
      ? "quantum"
      : (mis?.max_clique_in_G?.length ?? 0) > 0
        ? "exact"
        : "none";
  const backbone =
    backboneSource === "quantum"
      ? postProcess!.bestVMIS
      : (mis?.max_clique_in_G ?? []);

  const compute = useCallback(async () => {
    if (!manet || backbone.length === 0) return;
    setLoading(true);
    setErr(null);
    try {
      const res = await api.routing(manet.graph, backbone);
      setRouting(res);
      if (res.backbone.length >= 2) {
        // Pick a default route showcasing the backbone hop
        const nonBack = Array.from({ length: manet.graph.n_nodes }, (_, i) => i).filter(
          (i) => !res.backbone.includes(i),
        );
        setSrc(nonBack[0] ?? res.backbone[0]);
        setDst(nonBack[nonBack.length - 1] ?? res.backbone[1]);
      }
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, [manet, backbone]);

  useEffect(() => {
    compute();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [manet?.graph.n_nodes, mis?.size, postProcess?.bestSize, postProcess?.bestBitstring]);

  const activeRoute: RouteDTO | undefined = useMemo(() => {
    if (!routing || src === undefined || dst === undefined || src === dst) return undefined;
    return routing.routes.find((r) => r.src === src && r.dst === dst);
  }, [routing, src, dst]);

  if (!manet) {
    return (
      <Panel title="שלב 8 · ניתוב MANET">
        <div style={{ color: palette.textSecondary }}>השלם תחילה את שלב 1 (רשת MANET).</div>
      </Panel>
    );
  }
  if (backbone.length === 0) {
    return (
      <Panel title="שלב 8 · ניתוב MANET">
        <div style={{ color: palette.textSecondary }}>
          השלם תחילה את שלב 2 (קליק → MIS) כדי לקבל את ה-backbone.
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
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 10,
          padding: "8px 14px",
          background:
            backboneSource === "quantum"
              ? "rgba(179,136,255,0.10)"
              : "rgba(154,166,191,0.08)",
          border: `1px solid ${backboneSource === "quantum" ? palette.queraPurpleGlow : palette.queraPurpleSoft}`,
          borderRadius: 8,
          fontSize: 12.5,
          color: backboneSource === "quantum" ? palette.queraPurpleGlow : palette.textSecondary,
        }}
      >
        {backboneSource === "quantum" ? (
          <>
            🌀 <strong>backbone מ-quantum</strong> (שלב 7) · |V_MIS| = {backbone.length}
            {postProcess?.bestRatio !== null && postProcess?.bestRatio !== undefined && (
              <span style={{ color: palette.textMuted }} dir="ltr">
                {" "}· R = {postProcess.bestRatio.toFixed(3)}
              </span>
            )}
          </>
        ) : (
          <>
            🧮 <strong>backbone מ-exact MIS</strong> (שלב 2 — קלאסי) · |backbone| = {backbone.length}.
            הרץ את שלב 7 כדי לראות את ה-backbone שמיוצר מהמחשב הקוונטי.
          </>
        )}
      </div>
      <Panel
        title="שלב 8 · ניתוב MANET לפי backbone"
        subtitle="הקליק שמצאנו = backbone של הניתוב. כל שני קודקודים בו זמינים ב-1-hop. לחץ על קודקודים כדי לבחור (src, dst)."
        right={
          routing && (
            <div
              style={{
                fontFamily: "var(--font-mono)",
                fontSize: 12,
                color: routing.is_clique ? palette.ok : palette.err,
                background: palette.bgInset,
                padding: "6px 12px",
                borderRadius: 8,
              }}
              dir="ltr"
            >
              {routing.is_clique ? "✓ backbone הוא clique" : "✕ backbone לא clique"}
            </div>
          )
        }
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
            <NodePicker
              label="src"
              value={src}
              onChange={setSrc}
              max={manet.graph.n_nodes - 1}
              color={palette.ok}
            />
            <NodePicker
              label="dst"
              value={dst}
              onChange={setDst}
              max={manet.graph.n_nodes - 1}
              color={palette.warn}
            />
            <button
              onClick={compute}
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
              {loading ? "מחשב…" : "↻ חשב טבלת ניתוב"}
            </button>
            {err && (
              <div style={{ color: palette.err, fontSize: 12 }} dir="ltr">
                {err}
              </div>
            )}

            {routing && (
              <>
                <div
                  style={{
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
                  <Stat label="|backbone|" value={String(routing.backbone.length)} />
                  <Stat
                    label="coverage"
                    value={`${(routing.coverage_fraction * 100).toFixed(0)}%`}
                    color={
                      routing.coverage_fraction === 1
                        ? palette.ok
                        : routing.coverage_fraction > 0.8
                          ? palette.queraPurpleGlow
                          : palette.warn
                    }
                  />
                  <Stat label="mean hops" value={routing.mean_hops.toFixed(2)} />
                  <Stat label="max hops" value={String(routing.max_hops)} />
                  <Stat
                    label="reachable pairs"
                    value={`${routing.n_reachable_pairs} / ${manet.graph.n_nodes * (manet.graph.n_nodes - 1)}`}
                  />
                  {activeRoute && (
                    <Stat
                      label="active hops"
                      value={String(activeRoute.hops)}
                      color={palette.atomGround}
                    />
                  )}
                </div>
                <ViaBreakdown routing={routing} />
              </>
            )}

            {activeRoute && (
              <div
                style={{
                  padding: 12,
                  background: palette.bgInset,
                  borderRadius: 8,
                  fontSize: 12,
                  color: palette.textSecondary,
                }}
              >
                <div
                  style={{
                    display: "flex",
                    justifyContent: "space-between",
                    alignItems: "center",
                    marginBottom: 4,
                  }}
                >
                  <span style={{ color: palette.textPrimary, fontWeight: 600 }}>current route</span>
                  {activeRoute.hops > 0 && (
                    <span
                      style={{
                        padding: "2px 8px",
                        borderRadius: 999,
                        fontSize: 10.5,
                        fontWeight: 600,
                        background: viaColor(activeRoute.via) + "22",
                        color: viaColor(activeRoute.via),
                        border: `1px solid ${viaColor(activeRoute.via)}66`,
                      }}
                    >
                      {VIA_LABEL[activeRoute.via]}
                    </span>
                  )}
                </div>
                {activeRoute.hops === 0 ? (
                  <span style={{ color: palette.err }} dir="ltr">
                    unreachable (graph component disconnected)
                  </span>
                ) : (
                  <div
                    dir="ltr"
                    style={{
                      fontFamily: "var(--font-mono)",
                      color: viaColor(activeRoute.via),
                    }}
                  >
                    {activeRoute.path.join(" → ")}
                  </div>
                )}
              </div>
            )}
          </div>

          <div>
            <RoutingView
              nodes={manet.graph.node_positions ?? []}
              edges={manet.graph.edges}
              backbone={backbone}
              activeRoute={activeRoute}
              selectedSrc={src}
              selectedDst={dst}
              onPickNode={(id) => {
                if (src === undefined) setSrc(id);
                else if (dst === undefined || dst === id) setDst(id);
                else setSrc(id);
              }}
            />
          </div>
        </div>
      </Panel>

      <Panel title="הסבר" subtitle="הקשר בין ה-MIS הקוונטי לניתוב המעשי" collapsible collapseGroup="explanations">
        <p style={{ margin: 0, color: palette.textSecondary, lineHeight: 1.7 }}>
          ה-backbone הוא קליק ב-G — כל זוג מכשירים בו רואים אחד את השני בטווח התקשורת.
          האלגוריתם בוחר ראשית את ה-backbone כ-"highway" של הניתוב; אם המסלול עובר דרכו —{" "}
          <span style={{ color: palette.queraPurpleGlow, fontWeight: 600 }}>זו ההצלחה של החלק הקוונטי</span>{" "}
          (קצר ויציב). אם זוג קודקודים לא ניתן לניתוב דרך ה-backbone (למשל שניהם רחוקים מהקליק), המערכת
          מבצעת BFS shortest-path בגרף המלא ומספקת מסלול{" "}
          <span style={{ color: palette.warn, fontWeight: 600 }}>fallback</span> — צהוב מקווקו במסך.
          השוואת mean-hops בין backbone ל-fallback היא המידה שבה הקליק חוסך hops לעומת ניתוב ללא backbone:
          ככל שההפרש גדול יותר, ה-backbone הקוונטי בעל ערך מעשי גבוה יותר.
        </p>
      </Panel>
    </motion.div>
  );
}

function ViaBreakdown({ routing }: { routing: RoutingResponse }) {
  const total = routing.n_via_direct + routing.n_via_backbone + routing.n_via_fallback;
  if (total === 0) return null;
  const rows: { via: RouteVia; n: number; mean: number }[] = [
    { via: "direct", n: routing.n_via_direct, mean: routing.mean_hops_direct },
    { via: "backbone", n: routing.n_via_backbone, mean: routing.mean_hops_backbone },
    { via: "fallback", n: routing.n_via_fallback, mean: routing.mean_hops_fallback },
  ];

  const savings =
    routing.mean_hops_backbone > 0 && routing.mean_hops_fallback > 0
      ? 1 - routing.mean_hops_backbone / routing.mean_hops_fallback
      : null;

  return (
    <div
      style={{
        padding: 12,
        background: palette.bgInset,
        borderRadius: 8,
        fontSize: 12,
        color: palette.textSecondary,
      }}
    >
      <div style={{ color: palette.textPrimary, fontWeight: 600, marginBottom: 8 }}>
        ניתוח לפי מסלול
      </div>
      {rows.map((row) => {
        const pct = total > 0 ? (row.n / total) * 100 : 0;
        const c = viaColor(row.via);
        return (
          <div key={row.via} style={{ marginBottom: 6 }}>
            <div
              style={{
                display: "flex",
                justifyContent: "space-between",
                fontSize: 11,
                color: palette.textMuted,
                marginBottom: 3,
              }}
            >
              <span>{VIA_LABEL[row.via]}</span>
              <span dir="ltr">
                {row.n} ({pct.toFixed(0)}%) · {row.mean > 0 ? `${row.mean.toFixed(2)} hops` : "—"}
              </span>
            </div>
            <div
              style={{
                height: 4,
                background: palette.bgPanel,
                borderRadius: 999,
                overflow: "hidden",
              }}
            >
              <div
                style={{
                  width: `${pct}%`,
                  height: "100%",
                  background: c,
                  transition: "width 200ms ease",
                }}
              />
            </div>
          </div>
        );
      })}
      {savings !== null && (
        <div
          dir="ltr"
          style={{
            marginTop: 10,
            paddingTop: 8,
            borderTop: `1px solid ${palette.queraPurpleSoft}55`,
            color: palette.queraPurpleGlow,
            fontSize: 12,
            fontWeight: 600,
            textAlign: "center",
          }}
        >
          backbone hop savings: {(savings * 100).toFixed(0)}%
          <span style={{ display: "block", fontSize: 10.5, color: palette.textMuted, fontWeight: 400, marginTop: 2 }}>
            (= 1 − mean_hops_backbone / mean_hops_fallback)
          </span>
        </div>
      )}
    </div>
  );
}

function NodePicker({
  label,
  value,
  onChange,
  max,
  color,
}: {
  label: string;
  value: number | undefined;
  onChange: (v: number) => void;
  max: number;
  color: string;
}) {
  return (
    <label
      style={{
        display: "flex",
        flexDirection: "column",
        gap: 6,
        fontSize: 12,
        color: palette.textSecondary,
      }}
    >
      <span style={{ display: "flex", justifyContent: "space-between" }}>
        <span>{label}</span>
        <span
          dir="ltr"
          style={{ fontFamily: "var(--font-mono)", color }}
        >
          {value ?? "—"}
        </span>
      </span>
      <input
        type="range"
        min={0}
        max={max}
        step={1}
        value={value ?? 0}
        onChange={(e) => onChange(Number(e.target.value))}
        dir="ltr"
        style={{ accentColor: color }}
      />
    </label>
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
