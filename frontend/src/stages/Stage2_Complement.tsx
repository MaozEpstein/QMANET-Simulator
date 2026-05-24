import { useCallback, useEffect, useState } from "react";
import { motion } from "framer-motion";
import { api } from "../api/rest";
import { GraphView } from "../components/GraphView";
import { Panel } from "../components/Panel";
import { usePipeline } from "../store/pipeline";
import { palette } from "../theme/palette";

export function Stage2_Complement() {
  const { manet, mis, setMIS } = usePipeline();
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const computeComplement = useCallback(async () => {
    if (!manet) return;
    setLoading(true);
    setErr(null);
    try {
      const res = await api.complement(manet.graph);
      setMIS(res);
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, [manet, setMIS]);

  useEffect(() => {
    if (manet && (!mis || mis.graph.n_nodes !== manet.graph.n_nodes)) {
      computeComplement();
    }
  }, [manet, mis, computeComplement]);

  if (!manet) {
    return (
      <Panel title="שלב 2 · גרף משלים">
        <div style={{ color: palette.textSecondary }}>
          ראשית ייצר רשת MANET בשלב 1.
        </div>
      </Panel>
    );
  }

  const cliqueSet = mis ? new Set(mis.max_clique_in_G) : undefined;

  return (
    <motion.div
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.4 }}
      style={{ display: "grid", gap: 16 }}
    >
      <Panel
        title="שלב 2 · קליק → MIS על הגרף המשלים"
        subtitle="זהות:  S קליק ב-G  ⇔  S קבוצה בלתי-תלויה ב-Ḡ. נחשב את שניהם בו-זמנית."
        right={
          mis ? (
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
              |MaxClique| = |MIS| = {mis.size}
            </div>
          ) : null
        }
      >
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "1fr 1fr",
            gap: 16,
          }}
        >
          <div>
            <div style={{ marginBottom: 8, color: palette.textSecondary, fontSize: 13 }}>
              <strong style={{ color: palette.textPrimary }}>G</strong> — הגרף המקורי (רשת MANET)
              <br />
              <span style={{ fontSize: 11, color: palette.textMuted }}>
                קודקודים זוהרים = קליק מקסימלי. קשתות זוהרות = שייכות לקליק.
              </span>
            </div>
            <GraphView
              graph={manet.graph}
              mode="geometric"
              highlight={cliqueSet}
              emphasizeHighlightedEdges
              caption="G  (MANET)"
              width={520}
              height={460}
            />
          </div>

          <div>
            <div style={{ marginBottom: 8, color: palette.textSecondary, fontSize: 13 }}>
              <strong style={{ color: palette.textPrimary }}>Ḡ</strong> — הגרף המשלים
              <br />
              <span style={{ fontSize: 11, color: palette.textMuted }}>
                קודקודים זוהרים = MIS מקסימלי. אין אף קשת ביניהם — בדיוק המגדיר.
              </span>
            </div>
            {mis && (
              <GraphView
                graph={mis.complement}
                mode="force"
                highlight={cliqueSet}
                caption="Ḡ  (complement)"
                width={520}
                height={460}
              />
            )}
          </div>
        </div>

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
            {mis.max_clique_in_G.join(", ")}
            {" }"}  · size = {mis.size}
          </div>
        )}
      </Panel>
    </motion.div>
  );
}
