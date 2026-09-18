import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { motion } from "framer-motion";
import { api } from "../api/rest";
import type { ConflictGraphResponse, GraphDTO } from "../api/rest";
import { GraphView } from "../components/GraphView";
import { Panel } from "../components/Panel";
import { selectStaleStages, usePipeline, type MisTrack } from "../store/pipeline";
import { StaleBanner } from "../components/StaleBanner";
import { palette } from "../theme/palette";

// Distinct colors per clique index — picked so cliques with overlapping
// vertices read clearly against the dark panel background.
const CLIQUE_PALETTE = [
  palette.highlight, // mint — primary marking color
  palette.queraPurpleGlow,
  "#f59e0b", // amber
  "#3b82f6", // blue
  "#ef4444", // red
  "#ec4899", // pink
  "#14b8a6", // teal
  "#a855f7", // violet
];

export function Stage2_Complement() {
  const {
    manet,
    mis,
    setMIS,
    track,
    setTrack,
    conflictGraph,
    setConflictGraph,
    interferenceRadius,
    setInterferenceRadius,
  } = usePipeline();
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
  const [showDegrees, setShowDegrees] = useState(false);

  // Whichever graph Stage 2 currently hands to complement+MIS: the MANET
  // graph itself on the direct track, or the interference conflict graph F
  // (built from it) on the conflict track. Both tracks funnel into the exact
  // same complement/MIS backend call — only the input graph differs.
  //
  // On the conflict track we feed the pipeline F̄ (not F): the pipeline
  // always reports clique(input) — which equals MIS(complement(input)) — so
  // feeding F directly would report clique(F), a maximal set of *mutually
  // conflicting* links, the opposite of what we want. Feeding F̄ makes it
  // report clique(F̄) = MIS(F), with `.complement` coming back as F itself
  // for Stage 3 to embed. See backend/pipeline/conflict_graph.py.
  const computeActiveMis = useCallback(async () => {
    if (!manet) return;
    setLoading(true);
    setErr(null);
    try {
      let target: GraphDTO;
      if (track === "direct") {
        target = manet.graph;
      } else {
        const cg = await api.conflictGraph(manet.graph, interferenceRadius);
        setConflictGraph(cg);
        target = cg.conflict_graph_complement;
      }
      const res = await api.complement(target);
      setMIS(res);
      setCliqueIndex(0);
      setSelectedNode(null);
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, [manet, track, interferenceRadius, setMIS, setConflictGraph]);

  const misStale = usePipeline((s) => selectStaleStages(s).mis);

  // Signature of "what should currently be shown" — graph identity + track +
  // (for the conflict track) the interference radius. Used to refetch
  // exactly once per meaningful change rather than chasing every mutation.
  const lastSigRef = useRef<string | null>(null);
  // Whether we already retried due to a stale-cache detection on the *current*
  // signature. Without this guard, an old backend that doesn't return the new
  // metric fields would put us in an infinite refetch loop (each refetch
  // writes the same incomplete payload, which re-triggers the guard).
  const staleRetryAttemptedRef = useRef(false);

  useEffect(() => {
    if (!manet) return;
    const sig = `${manet.graph.n_nodes}:${manet.graph.edges.length}:${track}:${
      track === "conflict" ? interferenceRadius : ""
    }`;

    if (lastSigRef.current !== sig) {
      lastSigRef.current = sig;
      staleRetryAttemptedRef.current = false;
      // A cached, non-stale result already covers this signature (e.g. the
      // user just flipped back to a track they'd already computed) — reuse
      // it instead of recomputing.
      if (mis === null || misStale) computeActiveMis();
      return;
    }

    if (mis === null) {
      computeActiveMis();
      return;
    }

    // Stale-cache detection on the same signature: at most one refetch
    // attempt. If we still don't get the new fields back the user is on an
    // older backend; we surface the banner instead of looping forever.
    if (!staleRetryAttemptedRef.current) {
      const missing =
        mis.alpha_g === undefined ||
        mis.chromatic_lower === undefined ||
        mis.chromatic_upper === undefined ||
        mis.n_max_cliques === undefined ||
        mis.all_max_cliques === undefined;
      if (missing) {
        staleRetryAttemptedRef.current = true;
        computeActiveMis();
      }
    }
  }, [manet, track, interferenceRadius, mis, misStale, computeActiveMis]);

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
    : palette.highlight;
  // When the highlight is off, GraphView receives an empty set so nothing
  // is drawn glowing — revealing the raw graph for structural inspection.
  const cliqueSet = showHighlight ? new Set(activeClique) : new Set<number>();

  // Whichever graph currently plays the role of "G" for the complement/MIS
  // math: the MANET graph itself on the direct track, or F̄ — the complement
  // of the interference conflict graph — on the conflict track (F̄ is what
  // actually gets fed to the complement/MIS pipeline; see computeActiveMis).
  // Falls back to an empty graph while F̄ is still being fetched.
  const activeGraph: GraphDTO =
    track === "conflict" && conflictGraph
      ? conflictGraph.conflict_graph_complement
      : manet?.graph ?? { n_nodes: 0, edges: [], node_positions: null };

  // Conflict-track vertices *are* MANET links — label them "i–j" instead of
  // an arbitrary index so the graph reads as what it actually is.
  const linkLabel = useMemo(() => {
    if (track !== "conflict" || !conflictGraph) return undefined;
    const endpoints = conflictGraph.link_endpoints;
    return (id: number) => {
      const e = endpoints[id];
      return e ? `${e[0]}–${e[1]}` : String(id);
    };
  }, [track, conflictGraph]);

  // Neighbour sets — the dual viewpoint Stage 2 makes concrete: neighbours in
  // G ↔ non-neighbours in Ḡ (or, on the conflict track, links that interfere
  // in F ↔ links that can be scheduled together in F̄).
  const { neighborsInG, neighborsInComplement } = useMemo(() => {
    if (selectedNode === null) {
      return { neighborsInG: new Set<number>(), neighborsInComplement: new Set<number>() };
    }
    const inG = new Set<number>();
    for (const [u, v] of activeGraph.edges) {
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
  }, [selectedNode, activeGraph, mis]);

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

  const gStats = computeGraphStats(activeGraph.n_nodes, activeGraph.edges);
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

  const isConflict = track === "conflict";
  // Which symbol plays the role of "G"/"Ḡ" for the math on screen. Direct
  // track: G = MANET graph, Ḡ = its complement (as always). Conflict track:
  // the pipeline is fed F̄ (see computeActiveMis), so *it* plays "G" — its
  // clique is MIS(F) — and its complement is F itself, which is what Stage 3
  // embeds. So the right-hand ("Ḡ" role) panel is F: the actual conflict
  // graph, with the highlighted independent set showing literally zero
  // conflicts among the chosen links — the intuitive "this is the answer"
  // view. The left ("G" role) panel is F̄, the dual clique view.
  const gLabel = isConflict ? "F̄" : "G";
  const gbarLabel = isConflict ? "F" : "Ḡ";

  return (
    <motion.div
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.4 }}
      style={{ display: "grid", gap: 16 }}
    >
      <TrackToggle track={track} onChange={setTrack} />

      {isConflict && (
        <ConflictGraphIntro
          manetGraph={manet.graph}
          interferenceRadius={interferenceRadius}
          onInterferenceRadiusChange={setInterferenceRadius}
          conflictGraph={conflictGraph}
          linkLabel={linkLabel}
        />
      )}

      {misStale && (
        <StaleBanner
          upstreamLabel={isConflict ? "הגרף ב-MANET או טווח ההפרעה (שלב 1)" : "הגרף ב-MANET (שלב 1)"}
          actionLabel="חשב MIS מחדש"
          onAction={computeActiveMis}
        />
      )}
      <Panel
        title={
          isConflict
            ? "שלב 2 · Conflict Graph → MIS"
            : "שלב 2 · קליק → MIS על הגרף המשלים"
        }
        subtitle={
          isConflict
            ? "MIS(F) = הקבוצה המקסימלית של קישורים שיכולים לשדר בו-זמנית בלי הפרעה הדדית (Theorem 2, Jain et al. MobiCom'03). זהו time-slot אחד — לא פתרון הניתוב המלא. לחץ על קישור כדי לראות עם אילו קישורים אחרים הוא מתנגש."
            : "זהות:  S קליק ב-G  ⇔  S קבוצה בלתי-תלויה ב-Ḡ. לחץ על קודקוד כדי לראות את השכנים שלו בשני הגרפים."
        }
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
                : "כיבוי יציג את הגרף ללא הדגשת הקליק"
            }
            checked={showHighlight}
            onChange={setShowHighlight}
          />
          <SwitchToggle
            label="הצג דרגה (d_i)"
            hint="מציג ליד כל קודקוד את דרגתו בגרף שאותו צד מציג: ב-G לפי קשתות G, ב-Ḡ לפי קשתות Ḡ. ה-d_i של Ḡ הוא זה שמכתיב את LD-AQC כי ה-AQC פותר MIS על Ḡ (Karni 2026, Fig 1a)."
            checked={showDegrees}
            onChange={setShowDegrees}
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
              label={gLabel}
              labelHint={isConflict ? "גרף התאימות (complement of F)" : "MANET המקורי"}
              accent={palette.queraPurpleGlow}
              stats={gStats}
              extra={[
                [`ω(${gLabel})`, `${mis?.size ?? "—"}`],
                [`α(${gLabel})`, alphaText(mis?.alpha_g)],
                [`χ(${gLabel})`, chiText(mis?.chromatic_lower, mis?.chromatic_upper)],
                ["#max-cliques", `${mis?.n_max_cliques ?? "—"}`],
              ]}
            />
            <div style={{ margin: "10px 0 8px", color: palette.textSecondary, fontSize: 13 }}>
              <strong style={{ color: palette.textPrimary }}>{gLabel}</strong>{" "}
              {isConflict
                ? "— גרף התאימות: קשת = שני קישורים שיכולים לפעול יחד בלי קונפליקט (המשלים של F)"
                : "— הגרף המקורי (רשת MANET)"}
              <br />
              <span style={{ fontSize: 11, color: palette.textMuted }}>
                {selectedNode === null
                  ? isConflict
                    ? "קישורים זוהרים = קבוצת קישורים תואמים הדדית (קליק ב-F̄) — בדיוק MIS(F). קשתות זוהרות = תאימות בין קישורים בקבוצה."
                    : "קודקודים זוהרים = קליק מקסימלי. קשתות זוהרות = שייכות לקליק."
                  : isConflict
                    ? `קישור ${linkLabel?.(selectedNode) ?? selectedNode} נבחר — קשתות צהובות = הקישורים התואמים לו (לא מתנגשים) ב-F̄.`
                    : `קודקוד ${selectedNode} נבחר — קשתות צהובות = השכנים שלו ב-G.`}
              </span>
            </div>
            <GraphView
              graph={activeGraph}
              mode="geometric"
              highlight={cliqueSet}
              highlightColor={activeColor}
              emphasizeHighlightedEdges
              caption={isConflict ? "F̄  (compatibility graph)" : "G  (MANET)"}
              width={680}
              height={500}
              selectedNode={selectedNode}
              onNodeClick={handleNodeClick}
              showDegrees={showDegrees}
              nodeLabel={linkLabel}
            />
          </div>

          <div>
            {gbarStats && (
              <GraphColumnStats
                label={gbarLabel}
                labelHint={isConflict ? "גרף הקונפליקטים המקורי (F)" : "הגרף המשלים"}
                accent={palette.queraPurpleSoft}
                stats={gbarStats}
                extra={[
                  [`α(${gbarLabel})`, `${mis?.size ?? "—"}`],
                  [`ω(${gbarLabel})`, alphaText(mis?.alpha_g)],
                  ["embedding", embeddingHint(gbarStats.density)],
                  ["UDG check", "Stage 3 →"],
                ]}
              />
            )}
            <div style={{ margin: "10px 0 8px", color: palette.textSecondary, fontSize: 13 }}>
              <strong style={{ color: palette.textPrimary }}>{gbarLabel}</strong>{" "}
              {isConflict ? "— גרף הקונפליקטים עצמו (זהה לפאנל השני בשלב 'בניית גרף הקונפליקטים')" : "— הגרף המשלים"}
              <br />
              <span style={{ fontSize: 11, color: palette.textMuted }}>
                {selectedNode === null
                  ? isConflict
                    ? "קודקודים זוהרים = MIS(F) — קבוצת הקישורים המקסימלית שיכולה לשדר בו-זמנית. שימו לב: אין אף קשת ביניהם — בדיוק המשמעות של 'ללא הפרעה הדדית'."
                    : "אותם מיקומים, רק הקשתות התהפכו. קודקודים זוהרים = MIS מקסימלי — אין אף קשת ביניהם."
                  : isConflict
                    ? `קישור ${linkLabel?.(selectedNode) ?? selectedNode} נבחר — קשתות צהובות = הקישורים שמתנגשים איתו ב-F.`
                    : `קודקוד ${selectedNode} נבחר — קשתות צהובות = השכנים שלו ב-Ḡ (אלה שלא היו שכנים ב-G).`}
              </span>
            </div>
            {mis && (
              <GraphView
                graph={{
                  ...mis.complement,
                  node_positions: activeGraph.node_positions,
                }}
                mode="geometric"
                highlight={cliqueSet}
                highlightColor={activeColor}
                caption={isConflict ? "F  (conflict graph)" : "Ḡ  (complement)"}
                width={680}
                height={500}
                selectedNode={selectedNode}
                onNodeClick={handleNodeClick}
                showDegrees={showDegrees}
                nodeLabel={linkLabel}
              />
            )}
          </div>
        </div>

        {selectedNode !== null && (
          <NodeDetailCard
            nodeId={selectedNode}
            nodeLabel={linkLabel?.(selectedNode) ?? String(selectedNode)}
            subjectLabel={isConflict ? "קישור" : "קודקוד"}
            leftTitle={isConflict ? `תואמים ב-${gLabel}` : `שכנים ב-${gLabel}`}
            leftHint={isConflict ? "קישורים שיכולים לשדר יחד עם זה בלי קונפליקט" : "זוגות שמתקשרים ישירות ב-MANET"}
            rightTitle={isConflict ? `מתנגשים ב-${gbarLabel}` : `שכנים ב-${gbarLabel}`}
            rightHint={
              isConflict
                ? "קישורים אחרים שלא יכולים לשדר בו-זמנית עם זה"
                : `הזוגות החסרים ב-${gLabel} — אלה שיש ביניהם blockade באטומים`
            }
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
        subtitle={
          isConflict
            ? "למה MIS על F פותר תזמון בו-זמני של קישורים"
            : "למה ה-MIS על Ḡ הוא הקליק על G"
        }
        collapsible
        collapseGroup="explanations"
      >
        {isConflict ? (
          <p style={{ margin: "0 0 12px", color: palette.textSecondary, lineHeight: 1.7 }}>
            הגדרה (Jain, Padhye, Padmanabhan &amp; Qiu, MobiCom'03): גרף הקונפליקטים{" "}
            <span dir="ltr" className="mono">F</span> נבנה על <em>קישורי</em> ה-MANET — כל קודקוד
            ב-F הוא קישור (u,v) ב-MANET, וקשת בין שני קודקודי F קיימת כשהקישורים המתאימים לא יכולים
            לשדר בו-זמנית (חולקים צומת, או שאחד הקצוות שלהם קרוב לשני מטווח ההפרעה R'). המשפט
            המרכזי (Theorem 2): וקטור שימוש הוא בר-תזמון (schedulable, ללא התנגשות) <em>אם ורק אם</em>{" "}
            הוא נמצא בתוך ה-independent-set polytope של F — ולכן{" "}
            <strong>MIS(F) = קבוצת הקישורים המקסימלית שיכולה לשדר בו-זמנית</strong>. זהו time-slot
            אחד בלבד; הפתרון המלא לניתוב משלב כמה MIS-ים כאלה עם LP של multi-commodity flow. באפליקציה:
            כדי לקבל את MIS(F) מאותה מכונת complement/MIS ששלב זה כבר מפעיל, מזינים אותה{" "}
            <span dir="ltr" className="mono">F̄</span> (המשלים של F) — אז ה-clique שהיא מוצאת הוא{" "}
            <span dir="ltr" className="mono">clique(F̄) = MIS(F)</span>, וה-complement שהיא מחזירה הוא F
            עצמו. החשיבות החומרית זהה למסלול הישיר: מקדדים כל קודקוד של F כאטום, וה-Rydberg blockade
            אוכף את אילוץ ה-MIS ישירות בחומרה.
          </p>
        ) : (
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
        )}
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
            {isConflict ? "MaxClique(F̄) = MIS(F)" : "MaxClique(G) = MIS(Ḡ)"} = {"{ "}
            {activeClique.map((v) => linkLabel?.(v) ?? v).join(", ")}
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
// Track toggle — switches Stage 2 between the direct and conflict-graph
// methods. A segmented control matching the app's existing button language
// (palette.queraPurple active state, same radius/weight as StageStepper).
// --------------------------------------------------------------------------- //

function TrackToggle({
  track,
  onChange,
}: {
  track: MisTrack;
  onChange: (t: MisTrack) => void;
}) {
  const options: { id: MisTrack; label: string; hint: string }[] = [
    {
      id: "direct",
      label: "MIS ישיר · Complement",
      hint: "קליק ↔ MIS על הגרף המשלים",
    },
    {
      id: "conflict",
      label: "Conflict Graph · הפרעה",
      hint: "MIS על גרף הקונפליקטים (Jain et al., 2003)",
    },
  ];
  return (
    <div
      style={{
        display: "flex",
        gap: 4,
        padding: 4,
        background: palette.bgInset,
        borderRadius: 10,
        border: `1px solid ${palette.queraPurpleSoft}`,
        width: "fit-content",
      }}
      dir="rtl"
    >
      {options.map((opt) => {
        const active = track === opt.id;
        return (
          <button
            key={opt.id}
            onClick={() => onChange(opt.id)}
            title={opt.hint}
            style={{
              padding: "8px 16px",
              border: "none",
              borderRadius: 7,
              background: active ? palette.queraPurple : "transparent",
              color: active ? "#fff" : palette.textSecondary,
              fontWeight: active ? 600 : 400,
              fontSize: 13,
              cursor: "pointer",
              transition: "all 160ms ease",
            }}
          >
            {opt.label}
          </button>
        );
      })}
    </div>
  );
}

// --------------------------------------------------------------------------- //
// Conflict-graph intro — shown only on the conflict track, before the main
// complement/MIS panel. Builds intuition for F itself: connectivity graph C
// (links) vs. the conflict graph F derived from it, plus the interference
// radius control (Jain et al. §3.1 — R' can exceed the comm radius R).
// --------------------------------------------------------------------------- //

function ConflictGraphIntro({
  manetGraph,
  interferenceRadius,
  onInterferenceRadiusChange,
  conflictGraph,
  linkLabel,
}: {
  manetGraph: GraphDTO;
  interferenceRadius: number;
  onInterferenceRadiusChange: (r: number) => void;
  conflictGraph: ConflictGraphResponse | null;
  linkLabel?: (id: number) => string;
}) {
  const cStats = computeGraphStats(manetGraph.n_nodes, manetGraph.edges);
  const fStats = conflictGraph
    ? computeGraphStats(conflictGraph.conflict_graph.n_nodes, conflictGraph.conflict_graph.edges)
    : null;

  return (
    <Panel
      title="שלב 2 · בניית גרף הקונפליקטים (Interference)"
      subtitle="כל קישור ב-MANET הופך לקודקוד ב-F. שני קישורים מתנגשים (קשת ב-F) אם הם חולקים צומת, או אם קצה של אחד קרוב לקצה של השני מטווח ההפרעה R'."
      collapsible
      collapseGroup="conflict-intro"
    >
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 14,
          marginBottom: 14,
          padding: "10px 14px",
          background: palette.bgInset,
          borderRadius: 8,
          fontSize: 12,
          color: palette.textSecondary,
        }}
      >
        <label style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <span style={{ fontWeight: 600, color: palette.textPrimary }}>
            טווח הפרעה R'
          </span>
          <input
            type="number"
            min={0}
            step={1}
            value={interferenceRadius}
            onChange={(e) => {
              const v = Number(e.target.value);
              if (Number.isFinite(v) && v > 0) onInterferenceRadiusChange(v);
            }}
            style={{
              width: 80,
              padding: "4px 8px",
              borderRadius: 6,
              border: `1px solid ${palette.queraPurpleSoft}`,
              background: palette.bgPanel,
              color: palette.textPrimary,
              fontFamily: "var(--font-mono)",
              fontSize: 12,
            }}
            dir="ltr"
          />
        </label>
        <span style={{ color: palette.textMuted, fontSize: 11 }}>
          ברירת מחדל = טווח התקשורת R של MANET (שלב 1). R' &gt; R מרחיב את טווח ההפרעה מעבר לטווח
          השידור — בדיוק הנקודה של Jain et al. §3.1.
        </span>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16 }}>
        <div>
          <GraphColumnStats
            label="C"
            labelHint="connectivity graph (MANET)"
            accent={palette.queraPurpleGlow}
            stats={cStats}
            extra={[
              ["devices", `${cStats.n}`],
              ["links", `${cStats.m}`],
              ["R'", `${interferenceRadius}`],
              ["", ""],
            ]}
          />
          <div style={{ margin: "10px 0 8px", fontSize: 11, color: palette.textMuted }}>
            כל צומת = מכשיר MANET; כל קשת = קישור (link) — זהו הקלט לבניית F.
          </div>
          <GraphView
            graph={manetGraph}
            mode="geometric"
            caption="C  (connectivity graph)"
            width={680}
            height={420}
          />
        </div>
        <div>
          {fStats ? (
            <GraphColumnStats
              label="F"
              labelHint="conflict graph"
              accent={palette.queraPurpleSoft}
              stats={fStats}
              extra={[
                ["links → vertices", `${fStats.n}`],
                ["conflicts", `${fStats.m}`],
                ["density", fStats.density.toFixed(2)],
                ["", ""],
              ]}
            />
          ) : (
            <div style={{ color: palette.textMuted, fontSize: 12 }}>מחשב את F…</div>
          )}
          <div style={{ margin: "10px 0 8px", fontSize: 11, color: palette.textMuted }}>
            כל קודקוד F = קישור ב-C (מסומן "i–j"), ממוקם באמצע הקישור. קשת = קונפליקט בין שני
            קישורים.
          </div>
          {conflictGraph && (
            <GraphView
              graph={conflictGraph.conflict_graph}
              mode="geometric"
              caption="F  (conflict graph)"
              width={680}
              height={420}
              nodeLabel={linkLabel}
            />
          )}
        </div>
      </div>
    </Panel>
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
  nodeLabel,
  subjectLabel = "קודקוד",
  leftTitle = "שכנים ב-G",
  leftHint = "זוגות שמתקשרים ישירות ב-MANET",
  rightTitle = "שכנים ב-Ḡ",
  rightHint = "הזוגות החסרים ב-G — אלה שיש ביניהם blockade באטומים",
  neighborsInG,
  neighborsInComplement,
  cliqueMemberships,
  showAlternatives,
  palette: cliquePalette,
}: {
  nodeId: number;
  /** Display label for the header badge/title — defaults to the bare id.
   *  On the conflict track this is the "i–j" link label instead. */
  nodeLabel?: string;
  /** "קודקוד" for the direct track, "קישור" for the conflict track. */
  subjectLabel?: string;
  leftTitle?: string;
  leftHint?: string;
  rightTitle?: string;
  rightHint?: string;
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
          {nodeLabel ?? nodeId}
        </div>
        <div style={{ flex: 1 }}>
          <div style={{ color: palette.textPrimary, fontWeight: 600, fontSize: 13 }}>
            פירוט {subjectLabel} #{nodeLabel ?? nodeId}
          </div>
          <div style={{ color: palette.textMuted, fontSize: 11 }}>{leftTitle} ↔ {rightTitle}</div>
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
            label={leftTitle}
            value={neighborsInG.size}
            color={palette.queraPurpleGlow}
            barTotal={Math.max(neighborsInG.size, neighborsInComplement.size, 1)}
          />
          <DegreeStat
            label={rightTitle}
            value={neighborsInComplement.size}
            color={palette.queraPurpleSoft}
            barTotal={Math.max(neighborsInG.size, neighborsInComplement.size, 1)}
          />
        </div>

        <NeighbourSection
          title={leftTitle}
          hint={leftHint}
          accent={palette.queraPurpleGlow}
          neighbours={neighborsInG}
        />

        <NeighbourSection
          title={rightTitle}
          hint={rightHint}
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
