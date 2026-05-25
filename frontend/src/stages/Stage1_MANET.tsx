import { useCallback } from "react";
import { motion } from "framer-motion";
import type { MANETResponse } from "../api/rest";
import { ExportButton } from "../components/ExportButton";
import { GraphEditor } from "../components/GraphEditor";
import { ImportButton } from "../components/ImportButton";
import { Panel } from "../components/Panel";
import { saveGraph } from "../lib/savedGraphs";
import { usePipeline } from "../store/pipeline";
import { palette } from "../theme/palette";

export function Stage1_MANET() {
  const {
    manet,
    setManet,
    setMIS,
    setEmbed,
    setSchedule,
    resetSimulation,
  } = usePipeline();

  const handleCommit = useCallback(
    (payload: MANETResponse) => {
      setManet(payload);
      setMIS(null);
      setEmbed(null);
      setSchedule(null);
      resetSimulation();
    },
    [setManet, setMIS, setEmbed, setSchedule, resetSimulation],
  );

  const handleSaveToLibrary = useCallback(
    (payload: MANETResponse, name: string, description: string) => {
      saveGraph(name, description, payload);
    },
    [],
  );

  const edgeCount = manet?.graph.edges.length ?? 0;
  const nNodes = manet?.graph.n_nodes ?? 0;
  const avgDegree = nNodes > 0 ? (2 * edgeCount) / nNodes : 0;

  return (
    <motion.div
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.4 }}
      style={{ display: "grid", gap: 16 }}
    >
      <Panel
        title="שלב 1 · בניית גרף MANET"
        subtitle="בנה את הגרף ידנית, טען תבנית מוכנה, או חבר אוטומטית לפי טווח תקשורת. כל שינוי מתעדכן מיידית לצינור."
        right={
          <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
            <ImportButton
              onImported={(saved) => handleCommit(saved.payload)}
            />
            <ExportButton filename="manet" data={manet} />
          </div>
        }
      >
        <GraphEditor
          externalValue={manet}
          onCommit={handleCommit}
          onSave={handleSaveToLibrary}
        />
      </Panel>

      <Panel title="מאפייני הגרף">
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(4, 1fr)",
            gap: 14,
          }}
        >
          <Stat label="N (צמתים)" value={String(nNodes)} />
          <Stat label="E (קשתות)" value={String(edgeCount)} />
          <Stat label="דרגה ממוצעת" value={avgDegree.toFixed(2)} />
          <Stat label="צפיפות" value={density(nNodes, edgeCount).toFixed(3)} />
        </div>
      </Panel>

      <Panel title="הסבר" subtitle="הקשר בין רשת ניידת למודל הגרף" collapsible collapseGroup="explanations">
        <p style={{ margin: 0, color: palette.textSecondary, lineHeight: 1.7 }}>
          ברשת MANET שני מכשירים יכולים לתקשר ישירות אם המרחק הפיזי ביניהם קטן מטווח
          השידור של האנטנה. המודל המתמטי הסטנדרטי לכך הוא <em>Random Geometric Graph</em>:
          צמתים נדגמים אקראית במישור, וקשת קיימת כאשר{" "}
          <span dir="ltr" className="mono">|x_i − x_j| ≤ R_comm</span>. בעורך אפשר לבנות
          גרף מאפס, להטעין תבנית (טבעת, רשת, פרח משושים…), או להניח קודקודים ולהפעיל
          &quot;חבר אוטומטית&quot; שמייצר קשתות לפי הרדיוס. בשלב הבא נחפש{" "}
          <strong>קליק מקסימלי</strong> בגרף — קבוצה גדולה ככל הניתן של מכשירים שכולם
          רואים זה את זה — בתור backbone לניתוב. הקושי החישובי הוא NP-קשה, ולכן נתרגם
          אותו בשלב 2 לבעיית <strong>MIS על הגרף המשלים</strong>, שאותה ניתן לפתור
          אדיאבטית על מערך אטומים.
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
          fontSize: 18,
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
