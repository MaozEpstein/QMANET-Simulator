import { useCallback, useEffect, useState } from "react";
import { motion } from "framer-motion";
import { api } from "../api/rest";
import { GraphView } from "../components/GraphView";
import { Panel } from "../components/Panel";
import { Slider } from "../components/Slider";
import { usePipeline } from "../store/pipeline";
import { palette } from "../theme/palette";

export function Stage1_MANET() {
  const { manet, setManet } = usePipeline();
  const [nNodes, setNNodes] = useState(12);
  const [commRadius, setCommRadius] = useState(35);
  const [boxSize, setBoxSize] = useState(100);
  const [seed, setSeed] = useState(42);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const regenerate = useCallback(async () => {
    setLoading(true);
    setErr(null);
    try {
      const res = await api.generateMANET({
        n_nodes: nNodes,
        comm_radius: commRadius,
        box_size: boxSize,
        seed,
      });
      setManet(res);
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, [nNodes, commRadius, boxSize, seed, setManet]);

  useEffect(() => {
    regenerate();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const edgeCount = manet?.graph.edges.length ?? 0;
  const avgDegree = manet ? (2 * edgeCount) / manet.graph.n_nodes : 0;

  return (
    <motion.div
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.4 }}
      style={{ display: "grid", gap: 16 }}
    >
      <Panel
        title="שלב 1 · רשת MANET"
        subtitle="כל צומת = מכשיר נייד; קשת בין שני צמתים שבטווח התקשורת זה מזה (Random Geometric Graph)"
      >
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "minmax(300px, 1fr) auto",
            gap: 20,
            alignItems: "start",
          }}
        >
          <div
            style={{
              display: "flex",
              flexDirection: "column",
              gap: 14,
            }}
          >
            <Slider
              label="מספר צמתים (N)"
              value={nNodes}
              onChange={setNNodes}
              min={4}
              max={28}
              step={1}
            />
            <Slider
              label="טווח תקשורת"
              value={commRadius}
              onChange={setCommRadius}
              min={5}
              max={100}
              step={1}
              unit="m"
            />
            <Slider
              label="גודל אזור"
              value={boxSize}
              onChange={setBoxSize}
              min={20}
              max={200}
              step={5}
              unit="m"
            />
            <Slider label="זרע (seed)" value={seed} onChange={setSeed} min={0} max={999} step={1} />
            <button
              onClick={regenerate}
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
              {loading ? "מייצר…" : "↻ ייצר מחדש"}
            </button>
            {err && (
              <div style={{ color: palette.err, fontSize: 12 }} dir="ltr">
                {err}
              </div>
            )}

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
              <Stat label="N (צמתים)" value={String(manet?.graph.n_nodes ?? "—")} />
              <Stat label="E (קשתות)" value={String(edgeCount)} />
              <Stat label="דרגה ממוצעת" value={avgDegree.toFixed(2)} />
              <Stat label="צפיפות" value={density(manet?.graph.n_nodes ?? 0, edgeCount).toFixed(3)} />
            </div>
          </div>

          <div>
            {manet && (
              <GraphView
                graph={manet.graph}
                mode="geometric"
                commRadius={commRadius}
                caption="MANET snapshot (geometric · 2D)"
                width={560}
                height={500}
              />
            )}
          </div>
        </div>
      </Panel>

      <Panel title="הסבר" subtitle="הקשר בין רשת ניידת למודל הגרף">
        <p style={{ margin: 0, color: palette.textSecondary, lineHeight: 1.7 }}>
          ברשת MANET שני מכשירים יכולים לתקשר ישירות אם המרחק הפיזי ביניהם קטן מטווח
          השידור של האנטנה. המודל המתמטי הסטנדרטי לכך הוא <em>Random Geometric Graph</em>:
          צמתים נדגמים אקראית במישור, וקשת קיימת כאשר{" "}
          <span dir="ltr" className="mono">|x_i − x_j| ≤ R_comm</span>. בשלב הבא נחפש{" "}
          <strong>קליק מקסימלי</strong> בגרף — קבוצה גדולה ככל הניתן של מכשירים שכולם רואים זה את
          זה — בתור backbone לניתוב. הקושי החישובי הוא NP-קשה, ולכן נתרגם אותו בשלב 2 לבעיית{" "}
          <strong>MIS על הגרף המשלים</strong>, שאותה ניתן לפתור אדיאבטית על מערך אטומים.
        </p>
      </Panel>
    </motion.div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div style={{ color: palette.textMuted, fontSize: 11 }}>{label}</div>
      <div
        style={{
          fontFamily: "var(--font-mono)",
          color: palette.queraPurpleGlow,
          fontSize: 16,
        }}
        dir="ltr"
      >
        {value}
      </div>
    </div>
  );
}

function density(n: number, e: number): number {
  if (n < 2) return 0;
  return (2 * e) / (n * (n - 1));
}
