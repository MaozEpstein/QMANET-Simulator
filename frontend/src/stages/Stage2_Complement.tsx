import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { motion } from "framer-motion";
import { api } from "../api/rest";
import { GraphView } from "../components/GraphView";
import { Panel } from "../components/Panel";
import { selectStaleStages, usePipeline } from "../store/pipeline";
import { StaleBanner } from "../components/StaleBanner";
import { palette } from "../theme/palette";

// Distinct colors per clique index — picked so cliques with overlapping
// vertices read clearly against the dark panel background.
const CLIQUE_PALETTE = [
  palette.queraPurpleGlow,
  "#f59e0b", // amber
  "#10b981", // emerald
  "#3b82f6", // blue
  "#ef4444", // red
  "#ec4899", // pink
  "#14b8a6", // teal
  "#a855f7", // violet
];

export function Stage2_Complement() {
  const { manet, mis, setMIS } = usePipeline();
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [cliqueIndex, setCliqueIndex] = useState(0);
  const [selectedNode, setSelectedNode] = useState<number | null>(null);
  // Master switch for the clique highlight. The toggle is always present so
  // the user always has a meaningful control:
  //   - n_max_cliques == 1 → ON shows the single optimum, OFF hides the
  //     highlight entirely (revealing the raw graph for inspection).
  //   - n_max_cliques  > 1 → ON also exposes the cycler so the user can step
  //     through alternative optima with the distinct color palette.
  const [showHighlight, setShowHighlight] = useState(true);

  const computeComplement = useCallback(async () => {
    if (!manet) return;
    setLoading(true);
    setErr(null);
    try {
      const res = await api.complement(manet.graph);
      setMIS(res);
      setCliqueIndex(0);
      setSelectedNode(null);
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, [manet, setMIS]);

  // Graph identity we last fetched a complement for — used to refetch exactly
  // once per graph change rather than chasing every mis mutation.
  const lastGraphSigRef = useRef<string | null>(null);
  // Whether we already retried due to a stale-cache detection on the *current*
  // graph. Without this guard, an old backend that doesn't return the new
  // metric fields would put us in an infinite refetch loop (each refetch
  // writes the same incomplete payload, which re-triggers the guard).
  const staleRetryAttemptedRef = useRef(false);

  useEffect(() => {
    if (!manet) return;
    const sig = `${manet.graph.n_nodes}:${manet.graph.edges.length}`;

    if (lastGraphSigRef.current !== sig) {
      // New graph — fetch fresh; reset the stale-retry guard so this graph
      // gets its own one-shot attempt.
      lastGraphSigRef.current = sig;
      staleRetryAttemptedRef.current = false;
      computeComplement();
      return;
    }

    if (mis === null) {
      // Same graph signature but no mis (e.g. user cleared it) — refetch once.
      computeComplement();
      return;
    }

    // Stale-cache detection on the same graph: at most one refetch attempt.
    // If we still don't get the new fields back the user is on an older
    // backend; we surface the banner instead of looping forever.
    if (!staleRetryAttemptedRef.current) {
      const missing =
        mis.alpha_g === undefined ||
        mis.chromatic_lower === undefined ||
        mis.chromatic_upper === undefined ||
        mis.n_max_cliques === undefined ||
        mis.all_max_cliques === undefined;
      if (missing) {
        staleRetryAttemptedRef.current = true;
        computeComplement();
      }
    }
  }, [manet, mis, computeComplement]);

  const cliques: number[][] = useMemo(() => {
    if (!mis) return [];
    if (mis.all_max_cliques && mis.all_max_cliques.length > 0) {
      return mis.all_max_cliques;
    }
    return mis.max_clique_in_G.length > 0 ? [mis.max_clique_in_G] : [];
  }, [mis]);

  const hasAlternatives = cliques.length > 1;
  const activeIdx = hasAlternatives && showHighlight ? cliqueIndex % cliques.length : 0;
  const activeClique = cliques[activeIdx] ?? [];
  const activeColor = hasAlternatives && showHighlight
    ? CLIQUE_PALETTE[activeIdx % CLIQUE_PALETTE.length]
    : palette.queraPurpleGlow;
  // When the highlight is off, GraphView receives an empty set so nothing
  // is drawn glowing — revealing the raw graph for structural inspection.
  const cliqueSet = showHighlight ? new Set(activeClique) : new Set<number>();

  // Neighbour sets — the dual viewpoint Stage 2 makes concrete: neighbours in
  // G ↔ non-neighbours in Ḡ.
  const { neighborsInG, neighborsInComplement } = useMemo(() => {
    if (selectedNode === null || !manet) {
      return { neighborsInG: new Set<number>(), neighborsInComplement: new Set<number>() };
    }
    const inG = new Set<number>();
    for (const [u, v] of manet.graph.edges) {
      if (u === selectedNode) inG.add(v);
      else if (v === selectedNode) inG.add(u);
    }
    const inGbar = new Set<number>();
    if (mis) {
      for (const [u, v] of mis.complement.edges) {
        if (u === selectedNode) inGbar.add(v);
        else if (v === selectedNode) inGbar.add(u);
      }
    }
    return { neighborsInG: inG, neighborsInComplement: inGbar };
  }, [selectedNode, manet, mis]);

  // Per-clique membership: each entry says whether the selected node is in
  // that clique. Drives the colored-dots indicator in the detail card.
  const cliqueMemberships = useMemo<boolean[]>(() => {
    if (selectedNode === null) return cliques.map(() => false);
    return cliques.map((c) => c.includes(selectedNode));
  }, [selectedNode, cliques]);

  const handleNodeClick = useCallback(
    (id: number) => setSelectedNode((prev) => (prev === id ? null : id)),
    [],
  );

  if (!manet) {
    return (
      <Panel title="שלב 2 · גרף משלים">
        <div style={{ color: palette.textSecondary }}>ראשית ייצר רשת MANET בשלב 1.</div>
      </Panel>
    );
  }

  const gStats = computeGraphStats(manet.graph.n_nodes, manet.graph.edges);
  const gbarStats = mis ? computeGraphStats(mis.complement.n_nodes, mis.complement.edges) : null;
  // Detect a backend that hasn't been restarted after the section-א metrics
  // landed. The refetch in useEffect re-issues /api/graph/complement, but if
  // the *response* still lacks alpha_g + chromatic bounds the user is on an
  // older backend revision and needs to restart uvicorn. We surface this so
  // they're not left wondering why the new metrics are '—'.
  const backendIsStale =
    mis !== null &&
    !loading &&
    (mis.alpha_g === undefined ||
      mis.chromatic_lower === undefined ||
      mis.chromatic_upper === undefined);

  const stale = usePipeline((s) => selectStaleStages(s).mis);

  return (
    <motion.div
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.4 }}
      style={{ display: "grid", gap: 16 }}
    >
      {stale && (
        <StaleBanner
          upstreamLabel="הגרף ב-MANET (שלב 1)"
          actionLabel="חשב MIS מחדש"
          onAction={computeComplement}
        />
      )}
      <Panel
        title="שלב 2 · קליק → MIS על הגרף המשלים"
        subtitle="זהות:  S קליק ב-G  ⇔  S קבוצה בלתי-תלויה ב-Ḡ. לחץ על קודקוד כדי לראות את השכנים שלו בשני הגרפים."
        right={
          mis ? (
            <div
              style={{
                display: "flex",
                alignItems: "center",
                gap: 8,
                fontFamily: "var(--font-mono)",
                fontSize: 13,
                color: activeColor,
                background: palette.bgInset,
                padding: "6px 12px",
                borderRadius: 8,
              }}
              dir="ltr"
            >
              <span
                style={{
                  width: 8,
                  height: 8,
                  borderRadius: "50%",
                  background: activeColor,
                  boxShadow: `0 0 8px ${activeColor}`,
                }}
              />
              <span>|MaxClique| = |MIS| = {mis.size}</span>
            </div>
          ) : null
        }
      >
        {backendIsStale && (
          <div
            style={{
              marginBottom: 14,
              padding: "10px 14px",
              background: `${palette.warn}15`,
              border: `1px solid ${palette.warn}66`,
              borderRadius: 8,
              fontSize: 12,
              color: palette.textPrimary,
              display: "flex",
              alignItems: "center",
              gap: 10,
            }}
          >
            <span style={{ fontSize: 16 }}>⚠</span>
            <div>
              <div style={{ fontWeight: 600 }}>backend ישן — מטריקות חדשות לא זמינות</div>
              <div style={{ color: palette.textSecondary, fontSize: 11, marginTop: 2 }}>
                ה-API לא החזיר את <code>alpha_g</code>, <code>chromatic_*</code> או{" "}
                <code>n_max_cliques</code>. הפעל מחדש את uvicorn:{" "}
                <code style={{ background: palette.bgInset, padding: "1px 6px", borderRadius: 4 }}>
                  cd backend && uvicorn api.server:app --reload
                </code>
              </div>
            </div>
          </div>
        )}

        {/* Highlight-control toolbar. The toggle is always present and always
            useful: OFF reveals the raw graph (no clique glow), ON shows the
            optimum. When there are multiple optima, the cycler appears in the
            same row so the same affordance scales without an extra switch. */}
        <div
          style={{
            display: "flex",
            alignItems: "center",
            flexWrap: "wrap",
            gap: 14,
            marginBottom: 14,
            padding: "10px 14px",
            background: palette.bgInset,
            borderRadius: 8,
            fontSize: 12,
            color: palette.textSecondary,
          }}
        >
          <SwitchToggle
            label={
              hasAlternatives
                ? `הדגש קליק מקסימלי · ${mis?.n_max_cliques ?? cliques.length} פתרונות`
                : "הדגש קליק מקסימלי"
            }
            hint={
              hasAlternatives
                ? "הפעל כדי לעבור בין פתרונות אופטימליים בצבעים שונים"
                : "כיבוי יציג את הגרף ללא ההדגשה הסגולה"
            }
            checked={showHighlight}
            onChange={setShowHighlight}
          />
          {showHighlight && hasAlternatives && (
            <>
              <div
                style={{
                  height: 22,
                  width: 1,
                  background: palette.queraPurpleSoft,
                  opacity: 0.5,
                }}
              />
              <CliqueCycler
                cliques={cliques}
                activeIdx={activeIdx}
                onChange={setCliqueIndex}
                colors={CLIQUE_PALETTE}
                total={mis?.n_max_cliques ?? cliques.length}
              />
              <span style={{ color: palette.textMuted }} dir="ltr">
                {`{ ${activeClique.join(", ")} }`}
              </span>
            </>
          )}
          {selectedNode !== null && (
            <button
              onClick={() => setSelectedNode(null)}
              style={{
                marginInlineStart: "auto",
                padding: "4px 10px",
                background: "transparent",
                border: `1px solid ${palette.queraPurpleSoft}`,
                borderRadius: 6,
                color: palette.textSecondary,
                fontSize: 11,
                cursor: "pointer",
              }}
            >
              ✕ בטל בחירת קודקוד
            </button>
          )}
        </div>

        {/* Two columns — each column owns its own stats card + graph so the
            labels stay glued to their visual subject (RTL-safe). */}
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "1fr 1fr",
            gap: 16,
          }}
        >
          <div>
            <GraphColumnStats
              label="G"
              labelHint="MANET המקורי"
              accent={palette.queraPurpleGlow}
              stats={gStats}
              extra={[
                ["ω(G)", `${mis?.size ?? "—"}`],
                ["α(G)", alphaText(mis?.alpha_g)],
                ["χ(G)", chiText(mis?.chromatic_lower, mis?.chromatic_upper)],
                ["#max-cliques", `${mis?.n_max_cliques ?? "—"}`],
              ]}
            />
            <div style={{ margin: "10px 0 8px", color: palette.textSecondary, fontSize: 13 }}>
              <strong style={{ color: palette.textPrimary }}>G</strong> — הגרף המקורי (רשת MANET)
              <br />
              <span style={{ fontSize: 11, color: palette.textMuted }}>
                {selectedNode === null
                  ? "קודקודים זוהרים = קליק מקסימלי. קשתות זוהרות = שייכות לקליק."
                  : `קודקוד ${selectedNode} נבחר — קשתות צהובות = השכנים שלו ב-G.`}
              </span>
            </div>
            <GraphView
              graph={manet.graph}
              mode="geometric"
              highlight={cliqueSet}
              highlightColor={activeColor}
              emphasizeHighlightedEdges
              caption="G  (MANET)"
              width={680}
              height={500}
              selectedNode={selectedNode}
              onNodeClick={handleNodeClick}
            />
          </div>

          <div>
            {gbarStats && (
              <GraphColumnStats
                label="Ḡ"
                labelHint="הגרף המשלים"
                accent={palette.queraPurpleSoft}
                stats={gbarStats}
                extra={[
                  ["α(Ḡ)", `${mis?.size ?? "—"}`],
                  ["ω(Ḡ)", alphaText(mis?.alpha_g)],
                  ["embedding", embeddingHint(gbarStats.density)],
                  ["UDG check", "Stage 3 →"],
                ]}
              />
            )}
            <div style={{ margin: "10px 0 8px", color: palette.textSecondary, fontSize: 13 }}>
              <strong style={{ color: palette.textPrimary }}>Ḡ</strong> — הגרף המשלים
              <br />
              <span style={{ fontSize: 11, color: palette.textMuted }}>
                {selectedNode === null
                  ? "אותם מיקומים, רק הקשתות התהפכו. קודקודים זוהרים = MIS מקסימלי — אין אף קשת ביניהם."
                  : `קודקוד ${selectedNode} נבחר — קשתות צהובות = השכנים שלו ב-Ḡ (אלה שלא היו שכנים ב-G).`}
              </span>
            </div>
            {mis && (
              <GraphView
                graph={{
                  ...mis.complement,
                  node_positions: manet.graph.node_positions,
                }}
                mode="geometric"
                highlight={cliqueSet}
                highlightColor={activeColor}
                caption="Ḡ  (complement)"
                width={680}
                height={500}
                selectedNode={selectedNode}
                onNodeClick={handleNodeClick}
              />
            )}
          </div>
        </div>

        {selectedNode !== null && (
          <NodeDetailCard
            nodeId={selectedNode}
            neighborsInG={neighborsInG}
            neighborsInComplement={neighborsInComplement}
            cliqueMemberships={cliqueMemberships}
            showAlternatives={showHighlight && hasAlternatives}
            palette={CLIQUE_PALETTE}
          />
        )}

        {loading && (
          <div style={{ marginTop: 10, color: palette.textMuted, fontSize: 12 }}>מחשב…</div>
        )}
        {err && (
          <div style={{ marginTop: 10, color: palette.err, fontSize: 12 }} dir="ltr">
            {err}
          </div>
        )}
      </Panel>

      <Panel
        title="הסבר מתמטי"
        subtitle="למה ה-MIS על Ḡ הוא הקליק על G"
        collapsible
        collapseGroup="explanations"
      >
        <p style={{ margin: "0 0 12px", color: palette.textSecondary, lineHeight: 1.7 }}>
          הגדרה: בגרף משלים <span dir="ltr" className="mono">Ḡ = (V, V×V \ E)</span> — אותם
          קודקודים, אבל הקשתות הפוכות. תת-קבוצה <span dir="ltr" className="mono">S ⊆ V</span> היא{" "}
          <strong>קליק ב-G</strong> אם כל זוג ב-S מחובר ב-G. שני קודקודים מחוברים ב-G אם ורק אם הם{" "}
          <em>לא</em> מחוברים ב-Ḡ — לכן S קליק ב-G אם ורק אם S{" "}
          <strong>קבוצה בלתי-תלויה</strong> ב-Ḡ. מכאן{" "}
          <span dir="ltr" className="mono">ω(G) = α(Ḡ)</span>. החשיבות החומרית: על Aquila ה-Rydberg
          blockade אוכף בדיוק את אילוץ ה-MIS — שני אטומים שמרחקם קטן מ-R_b אינם יכולים להיות שניהם
          במצב Rydberg. אם נקודד כל קודקוד של Ḡ כאטום, נקבל מימוש פיזיקלי ישיר לבעיה.
        </p>
        {mis && (
          <div
            style={{
              background: palette.bgInset,
              padding: 12,
              borderRadius: 8,
              fontSize: 12,
              fontFamily: "var(--font-mono)",
              color: palette.textSecondary,
            }}
            dir="ltr"
          >
            MaxClique(G) = MIS(Ḡ) = {"{ "}
            {activeClique.join(", ")}
            {" }"} · size = {activeClique.length}
            {mis.n_max_cliques > 1 && (
              <span style={{ color: palette.textMuted }}>
                {"  "}— {mis.n_max_cliques} max-cliques total (solution degeneracy)
              </span>
            )}
          </div>
        )}
      </Panel>
    </motion.div>
  );
}

// --------------------------------------------------------------------------- //
// Stats helpers + comparison strip (section י)
// --------------------------------------------------------------------------- //

interface GraphStats {
  n: number;
  m: number;
  density: number;
  avgDeg: number;
  maxDeg: number;
}

function computeGraphStats(n: number, edges: readonly (readonly [number, number])[]): GraphStats {
  const m = edges.length;
  const maxEdges = n > 1 ? (n * (n - 1)) / 2 : 0;
  const density = maxEdges > 0 ? m / maxEdges : 0;
  const degree = new Array<number>(n).fill(0);
  for (const [u, v] of edges) {
    degree[u]++;
    degree[v]++;
  }
  const avgDeg = n > 0 ? degree.reduce((a, b) => a + b, 0) / n : 0;
  const maxDeg = degree.length > 0 ? Math.max(...degree) : 0;
  return { n, m, density, avgDeg, maxDeg };
}

/**
 * Stats card glued to its graph: lives inside the same grid column as the
 * GraphView, so the label and figures always sit above the right subject —
 * no RTL/LTR mismatch possible. Top row carries the structural stats
 * (n, edges, density, avg deg) and the bottom row carries the four
 * "section א" metrics passed in as `extra`.
 */
function GraphColumnStats({
  label,
  labelHint,
  accent,
  stats,
  extra,
}: {
  label: string;
  labelHint: string;
  accent: string;
  stats: GraphStats;
  extra: [string, string][];
}) {
  return (
    <div
      style={{
        background: palette.bgInset,
        borderRadius: 10,
        padding: "10px 14px",
        border: `1px solid ${accent}33`,
        display: "grid",
        gridTemplateColumns: "auto 1fr",
        gap: 14,
        alignItems: "center",
      }}
    >
      <div style={{ borderInlineEnd: `1px solid ${accent}44`, paddingInlineEnd: 12 }}>
        <div
          style={{
            fontFamily: "var(--font-mono)",
            fontSize: 24,
            fontWeight: 600,
            color: accent,
            lineHeight: 1,
          }}
        >
          {label}
        </div>
        <div style={{ fontSize: 10, color: palette.textMuted, marginTop: 4 }} dir="rtl">
          {labelHint}
        </div>
      </div>
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(4, 1fr)",
          gap: "8px 14px",
        }}
        dir="ltr"
      >
        <StatCell name="n" value={String(stats.n)} />
        <StatCell name="edges" value={String(stats.m)} />
        <StatCell name="density" value={stats.density.toFixed(2)} />
        <StatCell name="avg deg" value={stats.avgDeg.toFixed(1)} />
        {extra.map(([k, v]) => (
          <StatCell key={k} name={k} value={v} />
        ))}
      </div>
    </div>
  );
}

function StatCell({ name, value }: { name: string; value: string }) {
  return (
    <div>
      <div
        style={{
          fontSize: 10,
          color: palette.textMuted,
          textTransform: "uppercase",
          letterSpacing: 0.4,
        }}
      >
        {name}
      </div>
      <div
        style={{
          fontFamily: "var(--font-mono)",
          fontSize: 14,
          color: palette.textPrimary,
          marginTop: 2,
          whiteSpace: "nowrap",
        }}
      >
        {value}
      </div>
    </div>
  );
}

/** Display helpers — keep the JSX uncluttered. */
function alphaText(alpha: number | undefined): string {
  if (alpha === undefined) return "—";
  if (alpha < 0) return "too large";
  return String(alpha);
}

function chiText(lo: number | undefined, hi: number | undefined): string {
  if (lo === undefined || hi === undefined) return "—";
  if (lo === hi) return String(lo);
  return `[${lo}, ${hi}]`;
}

function embeddingHint(density: number): string {
  if (density < 0.3) return "✓ sparse";
  if (density < 0.6) return "~ medium";
  return "⚠ dense";
}

// --------------------------------------------------------------------------- //
// Node detail card (redesign — replaces the plain 3-column layout)
// --------------------------------------------------------------------------- //

function NodeDetailCard({
  nodeId,
  neighborsInG,
  neighborsInComplement,
  cliqueMemberships,
  showAlternatives,
  palette: cliquePalette,
}: {
  nodeId: number;
  neighborsInG: Set<number>;
  neighborsInComplement: Set<number>;
  cliqueMemberships: boolean[];
  showAlternatives: boolean;
  palette: string[];
}) {
  const inCount = cliqueMemberships.filter(Boolean).length;
  const total = cliqueMemberships.length;
  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.18 }}
      style={{
        marginTop: 16,
        background: palette.bgInset,
        borderRadius: 12,
        border: `1px solid ${palette.queraPurpleSoft}66`,
        overflow: "hidden",
      }}
    >
      {/* Header band */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 10,
          padding: "10px 16px",
          background: `linear-gradient(90deg, ${palette.warn}22, transparent)`,
          borderBottom: `1px solid ${palette.queraPurpleSoft}44`,
        }}
        dir="rtl"
      >
        <div
          style={{
            width: 28,
            height: 28,
            borderRadius: "50%",
            background: palette.warn,
            color: "#1a0f00",
            fontWeight: 700,
            fontSize: 13,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            fontFamily: "var(--font-mono)",
            boxShadow: `0 0 12px ${palette.warn}77`,
          }}
        >
          {nodeId}
        </div>
        <div style={{ flex: 1 }}>
          <div style={{ color: palette.textPrimary, fontWeight: 600, fontSize: 13 }}>
            פירוט קודקוד #{nodeId}
          </div>
          <div style={{ color: palette.textMuted, fontSize: 11 }}>
            מבט דו-צדדי על שכנויות ב-G ↔ Ḡ
          </div>
        </div>
        <CliqueMembershipBadge
          inCount={inCount}
          total={total}
          memberships={cliqueMemberships}
          showAlternatives={showAlternatives}
          palette={cliquePalette}
        />
      </div>

      {/* Body */}
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "auto 1fr 1fr",
          gap: 18,
          padding: "14px 16px",
          alignItems: "start",
        }}
        dir="rtl"
      >
        {/* Degree column */}
        <div
          style={{
            display: "grid",
            gap: 10,
            paddingInlineEnd: 14,
            borderInlineEnd: `1px solid ${palette.queraPurpleSoft}33`,
            minWidth: 110,
          }}
        >
          <DegreeStat
            label="דרגה ב-G"
            value={neighborsInG.size}
            color={palette.queraPurpleGlow}
            barTotal={Math.max(neighborsInG.size, neighborsInComplement.size, 1)}
          />
          <DegreeStat
            label="דרגה ב-Ḡ"
            value={neighborsInComplement.size}
            color={palette.queraPurpleSoft}
            barTotal={Math.max(neighborsInG.size, neighborsInComplement.size, 1)}
          />
        </div>

        {/* Neighbours in G */}
        <NeighbourSection
          title="שכנים ב-G"
          hint="זוגות שמתקשרים ישירות ב-MANET"
          accent={palette.queraPurpleGlow}
          neighbours={neighborsInG}
        />

        {/* Neighbours in Ḡ */}
        <NeighbourSection
          title="שכנים ב-Ḡ"
          hint="הזוגות החסרים ב-G — אלה שיש ביניהם blockade באטומים"
          accent={palette.warn}
          neighbours={neighborsInComplement}
        />
      </div>
    </motion.div>
  );
}

function DegreeStat({
  label,
  value,
  color,
  barTotal,
}: {
  label: string;
  value: number;
  color: string;
  barTotal: number;
}) {
  const pct = barTotal > 0 ? (value / barTotal) * 100 : 0;
  return (
    <div>
      <div style={{ fontSize: 10, color: palette.textMuted, marginBottom: 4 }}>{label}</div>
      <div
        style={{
          fontFamily: "var(--font-mono)",
          fontSize: 22,
          color,
          fontWeight: 600,
          lineHeight: 1,
        }}
      >
        {value}
      </div>
      <div
        style={{
          height: 3,
          background: palette.bgPanel,
          borderRadius: 999,
          marginTop: 6,
          overflow: "hidden",
        }}
      >
        <div
          style={{
            width: `${pct}%`,
            height: "100%",
            background: color,
            transition: "width 200ms ease",
          }}
        />
      </div>
    </div>
  );
}

function NeighbourSection({
  title,
  hint,
  accent,
  neighbours,
}: {
  title: string;
  hint: string;
  accent: string;
  neighbours: Set<number>;
}) {
  const sorted = [...neighbours].sort((a, b) => a - b);
  return (
    <div>
      <div style={{ display: "flex", alignItems: "baseline", gap: 8, marginBottom: 6 }}>
        <span style={{ color: accent, fontWeight: 600, fontSize: 12 }}>{title}</span>
        <span
          style={{
            fontFamily: "var(--font-mono)",
            fontSize: 11,
            color: palette.textMuted,
            background: palette.bgPanel,
            padding: "1px 6px",
            borderRadius: 4,
          }}
          dir="ltr"
        >
          {sorted.length}
        </span>
      </div>
      <div style={{ fontSize: 10, color: palette.textMuted, marginBottom: 6 }}>{hint}</div>
      {sorted.length === 0 ? (
        <div style={{ fontFamily: "var(--font-mono)", fontSize: 12, color: palette.textMuted }}>
          ∅
        </div>
      ) : (
        <div
          dir="ltr"
          style={{
            display: "flex",
            flexWrap: "wrap",
            gap: 4,
          }}
        >
          {sorted.map((n) => (
            <span
              key={n}
              style={{
                fontFamily: "var(--font-mono)",
                fontSize: 11,
                padding: "2px 7px",
                borderRadius: 5,
                background: `${accent}22`,
                color: accent,
                border: `1px solid ${accent}55`,
              }}
            >
              {n}
            </span>
          ))}
        </div>
      )}
    </div>
  );
}

function CliqueMembershipBadge({
  inCount,
  total,
  memberships,
  showAlternatives,
  palette: cliquePalette,
}: {
  inCount: number;
  total: number;
  memberships: boolean[];
  showAlternatives: boolean;
  palette: string[];
}) {
  if (total === 0) return null;
  const inAny = inCount > 0;
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        gap: 8,
        background: palette.bgPanel,
        padding: "5px 10px",
        borderRadius: 999,
        border: `1px solid ${inAny ? palette.queraPurpleSoft : palette.bgPanel}`,
      }}
      dir="ltr"
    >
      <span style={{ fontSize: 10, color: palette.textMuted }}>cliques:</span>
      <span style={{ fontFamily: "var(--font-mono)", fontSize: 12, color: palette.textPrimary }}>
        {inCount}/{total}
      </span>
      {showAlternatives && total <= 12 && (
        <div style={{ display: "flex", gap: 3 }}>
          {memberships.map((isMember, i) => (
            <span
              key={i}
              title={`clique #${i + 1}: ${isMember ? "in" : "out"}`}
              style={{
                width: 8,
                height: 8,
                borderRadius: "50%",
                background: isMember ? cliquePalette[i % cliquePalette.length] : "transparent",
                border: `1px solid ${
                  isMember ? cliquePalette[i % cliquePalette.length] : palette.queraPurpleSoft
                }`,
              }}
            />
          ))}
        </div>
      )}
    </div>
  );
}

// --------------------------------------------------------------------------- //
// Toolbar components
// --------------------------------------------------------------------------- //

function SwitchToggle({
  label,
  hint,
  checked,
  onChange,
  disabled = false,
}: {
  label: string;
  hint?: string;
  checked: boolean;
  onChange: (v: boolean) => void;
  disabled?: boolean;
}) {
  return (
    <label
      style={{
        display: "flex",
        alignItems: "center",
        gap: 10,
        cursor: disabled ? "not-allowed" : "pointer",
        opacity: disabled ? 0.55 : 1,
      }}
    >
      <span
        role="switch"
        aria-checked={checked}
        aria-disabled={disabled}
        onClick={() => {
          if (!disabled) onChange(!checked);
        }}
        style={{
          width: 32,
          height: 18,
          background: checked ? palette.queraPurpleGlow : palette.bgPanel,
          border: `1px solid ${checked ? palette.queraPurpleGlow : palette.queraPurpleSoft}`,
          borderRadius: 999,
          position: "relative",
          transition: "background 150ms ease",
          flexShrink: 0,
        }}
      >
        <span
          style={{
            position: "absolute",
            top: 2,
            insetInlineStart: checked ? 16 : 2,
            width: 12,
            height: 12,
            borderRadius: "50%",
            background: "#fff",
            transition: "inset-inline-start 150ms ease",
          }}
        />
      </span>
      <span style={{ display: "flex", flexDirection: "column", gap: 1 }}>
        <span style={{ color: palette.textPrimary, fontWeight: 600, fontSize: 12 }}>{label}</span>
        {hint && <span style={{ color: palette.textMuted, fontSize: 10 }}>{hint}</span>}
      </span>
    </label>
  );
}

function CliqueCycler({
  cliques,
  activeIdx,
  onChange,
  colors,
  total,
}: {
  cliques: number[][];
  activeIdx: number;
  onChange: (i: number) => void;
  colors: string[];
  total: number;
}) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
      <button
        onClick={() => onChange((activeIdx - 1 + cliques.length) % cliques.length)}
        style={cyclerButtonStyle}
        aria-label="previous clique"
      >
        ‹
      </button>
      <div style={{ display: "flex", gap: 4 }}>
        {cliques.map((_, i) => (
          <button
            key={i}
            onClick={() => onChange(i)}
            style={{
              width: 22,
              height: 22,
              border: "none",
              borderRadius: 5,
              background:
                i === activeIdx ? colors[i % colors.length] : palette.bgPanel,
              color: i === activeIdx ? "#fff" : palette.textMuted,
              fontFamily: "var(--font-mono)",
              fontSize: 11,
              fontWeight: 600,
              cursor: "pointer",
            }}
            title={`clique #${i + 1}: { ${cliques[i].join(", ")} }`}
          >
            {i + 1}
          </button>
        ))}
      </div>
      <button
        onClick={() => onChange((activeIdx + 1) % cliques.length)}
        style={cyclerButtonStyle}
        aria-label="next clique"
      >
        ›
      </button>
      {total > cliques.length && (
        <span style={{ color: palette.textMuted, fontSize: 11, marginInlineStart: 6 }} dir="ltr">
          showing {cliques.length} of {total}
        </span>
      )}
    </div>
  );
}

const cyclerButtonStyle: React.CSSProperties = {
  width: 22,
  height: 22,
  border: `1px solid ${palette.queraPurpleSoft}`,
  borderRadius: 5,
  background: "transparent",
  color: palette.textPrimary,
  cursor: "pointer",
  fontSize: 13,
  lineHeight: 1,
};
