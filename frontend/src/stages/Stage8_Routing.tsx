import { useCallback, useEffect, useMemo, useState } from "react";
import { motion } from "framer-motion";
import { api } from "../api/rest";
import type { RouteDTO, RoutingResponse } from "../api/rest";
import { Panel } from "../components/Panel";
import { RoutingView } from "../components/RoutingView";
import { usePipeline } from "../store/pipeline";
import { palette } from "../theme/palette";

export function Stage8_Routing() {
  const { manet, mis } = usePipeline();
  const [routing, setRouting] = useState<RoutingResponse | null>(null);
  const [src, setSrc] = useState<number | undefined>(undefined);
  const [dst, setDst] = useState<number | undefined>(undefined);
  const [err, setErr] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const backbone = mis?.max_clique_in_G ?? [];

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
  }, [manet?.graph.n_nodes, mis?.size]);

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
                dir="ltr"
              >
                <div
                  style={{ color: palette.textPrimary, fontWeight: 600, marginBottom: 4 }}
                >
                  current route
                </div>
                {activeRoute.hops === 0 ? (
                  <span style={{ color: palette.err }}>unreachable</span>
                ) : (
                  <div
                    style={{
                      fontFamily: "var(--font-mono)",
                      color: palette.atomGround,
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

      <Panel title="הסבר" subtitle="הקשר בין ה-MIS הקוונטי לניתוב המעשי">
        <p style={{ margin: 0, color: palette.textSecondary, lineHeight: 1.7 }}>
          ה-backbone הוא קליק ב-G — כל זוג מכשירים בו רואים אחד את השני בטווח התקשורת.
          זה אומר שכל שני נציגי backbone מתקשרים ב-1-hop. צמתים שאינם בקליק "מתקרבים" ל-backbone
          דרך השכן הקליקאי הקרוב, וזוג צמתים מחוץ ל-backbone יכול לתקשר בלכל היותר 3 hops: שכן→backbone→backbone→שכן.
          coverage חלקי = יש צמתים שלא רואים אף אחד מה-backbone — שם נדרשת רוטינה fallback.
        </p>
      </Panel>
    </motion.div>
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
