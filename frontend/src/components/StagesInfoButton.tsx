/**
 * Small "i" button + modal that shows the per-stage complexity table.
 * The table mirrors the analysis we did when assessing scaling limits: each
 * stage's work, its growth in N, and the empirical pain point. Stage 5 is
 * highlighted because it's the only one that scales as 2^N.
 */

import { useCallback, useEffect, useState } from "react";
import { palette } from "../theme/palette";

interface Row {
  stage: string;
  purpose: string;
  work: string;
  growth: string;
  load: string;
  danger?: boolean;
}

const ROWS: Row[] = [
  {
    stage: "1 — MANET",
    purpose: "יוצר רשת מכשירים ניידים. קודקודים=מכשירים, קשתות=זוגות בטווח תקשורת.",
    work: "RGG generator",
    growth: "O(N²) edges check",
    load: "רגיל; 100 צמתים = 10K זוגות",
  },
  {
    stage: "2 — Complement + MIS",
    purpose: "בונה את Ḡ. MaxClique(G) = MIS(Ḡ) — הטריק שמאפשר לפתור clique עם אטומי Rydberg.",
    work: "networkx, branch-and-bound",
    growth: "exact MIS מדלג מעל N=28",
    load: "אפס",
  },
  {
    stage: "3 — Embedding",
    purpose: "ממקם אטומים על רשת Aquila כך שקשתות Ḡ הופכות לקשתות blockade בין שכנים.",
    work: "spring layout + snap-to-grid",
    growth: "O(N²)",
    load: "אפס",
  },
  {
    stage: "4 — Schedule",
    purpose: "מגדיר את הפולס Ω(t), Δ(t) שמוביל אדיאבטית מ-|gg…⟩ למצב היסוד של ה-MIS-Hamiltonian.",
    work: "פולס קבוע, לא תלוי ב-N",
    growth: "O(1)",
    load: "אפס",
  },
  {
    stage: "5 — Evolution",
    purpose:
      "פותר sesolve תחת H(t) מפוצל לפיסות זמן-בלתי-תלויות. מדווח לכל frame גם gap, fidelity ל-GS ו-⟨H⟩ לאבחון אדיאבטיות. תוצאות נשמרות ב-cache בזיכרון.",
    work: "sesolve + partial-eigh(k=2) per frame",
    growth: "O(2^(2N)) · n_frames",
    load: "💀 זיכרון מת ב-N≈14; N=10 רץ ב-~30-50s",
    danger: true,
  },
  {
    stage: "6 — Measurement",
    purpose: "דוגם shots מ-|⟨b|ψ(T)⟩|² ומחיל רעש זיהוי של Aquila (Rydberg→ground ≈ 8%).",
    work: "sampling מ-final_bitstring_probs",
    growth: "O(shots × N)",
    load: "אפס — אבל תלוי שיש פלט מ-5",
  },
  {
    stage: "7 — Post-process",
    purpose: "מתקן violations בכל shot (greedy removal) ומרחיב ל-mIS מקסימלי תקף.",
    work: "greedy fix על bitstring + גרף",
    growth: "O(shots × N²)",
    load: "אפס",
  },
  {
    stage: "8 — Routing",
    purpose: "ה-clique שמצאנו = ה-backbone של ה-MANET. בונה טבלת ניתוב 1-hop בין צמתי backbone.",
    work: "networkx shortest-paths",
    growth: "O(N³)",
    load: "רגיל ל-100 צמתים",
  },
];

type TabId = "table" | "diagram";

export function StagesInfoButton() {
  const [open, setOpen] = useState(false);
  const [tab, setTab] = useState<TabId>("diagram");

  const close = useCallback(() => setOpen(false), []);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") close();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, close]);

  return (
    <>
      <button
        onClick={() => setOpen(true)}
        aria-label="מורכבות לפי שלב"
        title="מורכבות לפי שלב"
        style={{
          marginInlineStart: 8,
          width: 22,
          height: 22,
          borderRadius: "50%",
          border: `1px solid ${palette.queraPurpleSoft}`,
          background: "transparent",
          color: palette.textSecondary,
          fontFamily: "Georgia, 'Times New Roman', serif",
          fontStyle: "italic",
          fontSize: 13,
          fontWeight: 600,
          lineHeight: "20px",
          padding: 0,
          cursor: "pointer",
          transition: "all 120ms ease",
        }}
        onMouseEnter={(e) => {
          e.currentTarget.style.background = palette.queraPurpleSoft;
          e.currentTarget.style.color = palette.queraPurpleGlow;
        }}
        onMouseLeave={(e) => {
          e.currentTarget.style.background = "transparent";
          e.currentTarget.style.color = palette.textSecondary;
        }}
      >
        i
      </button>

      {open && (
        <div
          role="dialog"
          aria-modal="true"
          aria-label="טבלת מורכבות לפי שלב"
          onClick={close}
          style={{
            position: "fixed",
            inset: 0,
            background: "rgba(2, 5, 14, 0.78)",
            backdropFilter: "blur(4px)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            zIndex: 1000,
            padding: 20,
          }}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            style={{
              background: palette.bgPanel,
              border: `1px solid ${palette.queraPurpleSoft}`,
              borderRadius: 14,
              padding: "20px 28px",
              maxWidth: "min(1400px, 95vw)",
              width: "100%",
              maxHeight: "90vh",
              overflow: "auto",
              boxShadow: `0 12px 60px ${palette.queraPurple}66`,
            }}
          >
            <header
              style={{
                display: "flex",
                alignItems: "baseline",
                justifyContent: "space-between",
                marginBottom: 14,
                gap: 12,
              }}
            >
              <div>
                <h2 style={{ margin: 0, fontSize: 16, fontWeight: 600, color: palette.textPrimary }}>
                  {tab === "table" ? "מורכבות לפי שלב" : "תרשים זרימה · שלבי ה-pipeline"}
                </h2>
                <div style={{ fontSize: 12, color: palette.textMuted, marginTop: 3 }}>
                  {tab === "table"
                    ? "מה רץ בכל שלב, איך הוא גדל עם N, ואיפה מגיעים לגבול"
                    : "מה נכנס לכל שלב, מה הוא מבצע, ומה יוצא ממנו"}
                </div>
              </div>
              <button
                onClick={close}
                aria-label="סגור"
                style={{
                  width: 28,
                  height: 28,
                  borderRadius: 6,
                  border: `1px solid ${palette.queraPurpleSoft}`,
                  background: "transparent",
                  color: palette.textSecondary,
                  fontSize: 16,
                  cursor: "pointer",
                  lineHeight: 1,
                }}
              >
                ×
              </button>
            </header>

            <div
              role="tablist"
              style={{
                display: "flex",
                gap: 6,
                marginBottom: 14,
                borderBottom: `1px solid ${palette.queraPurpleSoft}`,
              }}
            >
              <TabBtn active={tab === "table"} onClick={() => setTab("table")}>
                📊 טבלת מורכבות
              </TabBtn>
              <TabBtn active={tab === "diagram"} onClick={() => setTab("diagram")}>
                🔀 תרשים זרימה
              </TabBtn>
            </div>

            {tab === "diagram" && <PipelineDiagram />}
            {tab === "table" && (
              <>


            <table
              style={{
                width: "100%",
                borderCollapse: "collapse",
                fontSize: 12.5,
                color: palette.textPrimary,
                tableLayout: "fixed",
              }}
            >
              <colgroup>
                <col style={{ width: "13%" }} />
                <col style={{ width: "38%" }} />
                <col style={{ width: "22%" }} />
                <col style={{ width: "14%" }} />
                <col style={{ width: "13%" }} />
              </colgroup>
              <thead>
                <tr style={{ background: palette.bgInset }}>
                  <Th>Stage</Th>
                  <Th>מה השלב מבצע</Th>
                  <Th>מה רץ</Th>
                  <Th>תלות ב-N</Th>
                  <Th>מעמיס על…</Th>
                </tr>
              </thead>
              <tbody>
                {ROWS.map((r) => (
                  <tr
                    key={r.stage}
                    style={{
                      background: r.danger ? "rgba(255, 84, 112, 0.08)" : "transparent",
                      borderBottom: `1px solid ${palette.queraPurpleSoft}33`,
                    }}
                  >
                    <Td bold danger={r.danger}>{r.stage}</Td>
                    <Td danger={r.danger}>{r.purpose}</Td>
                    <Td danger={r.danger}>{r.work}</Td>
                    <Td mono danger={r.danger}>{r.growth}</Td>
                    <Td danger={r.danger}>{r.load}</Td>
                  </tr>
                ))}
              </tbody>
            </table>

            <p
              style={{
                marginTop: 16,
                marginBottom: 0,
                color: palette.textMuted,
                fontSize: 11.5,
                lineHeight: 1.7,
              }}
            >
              שלב 5 הוא צוואר הבקבוק היחיד — sesolve פועלת על H מפוצל ל-4 פיסות זמן-בלתי-תלויות (drive_x, drive_y, detuning, VdW) שנבנות
              פעם אחת ב-2^N × 2^N. ב-runtime QuTiP מבצע רק matvec דליל × מקדמים סקלריים, ולכל output frame נוסף partial-eigh (k=2) ל-gap,
              fidelity ו-⟨H⟩. השלבים האחרים פולינומיים ב-N ויודעים לרוץ על 100+ צמתים. Phase 7 (Braket) פותח את התקרה ע"י דחיפת ה-job לחומרת Aquila.
            </p>
              </>
            )}
          </div>
        </div>
      )}
    </>
  );
}

function Th({ children }: { children: React.ReactNode }) {
  return (
    <th
      style={{
        textAlign: "start",
        padding: "10px 12px",
        fontWeight: 600,
        fontSize: 12,
        color: palette.queraPurpleGlow,
        borderBottom: `1px solid ${palette.queraPurpleSoft}`,
      }}
    >
      {children}
    </th>
  );
}

function Td({
  children,
  bold,
  mono,
  danger,
}: {
  children: React.ReactNode;
  bold?: boolean;
  mono?: boolean;
  danger?: boolean;
}) {
  return (
    <td
      style={{
        padding: "9px 12px",
        fontWeight: bold ? 600 : 400,
        fontFamily: mono ? "JetBrains Mono, monospace" : undefined,
        color: danger && bold ? palette.err : palette.textPrimary,
        verticalAlign: "top",
      }}
    >
      {children}
    </td>
  );
}

function TabBtn({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      role="tab"
      aria-selected={active}
      style={{
        padding: "8px 16px",
        background: "transparent",
        color: active ? palette.queraPurpleGlow : palette.textSecondary,
        border: "none",
        borderBottom: `2px solid ${active ? palette.queraPurpleGlow : "transparent"}`,
        fontSize: 13,
        fontWeight: active ? 700 : 500,
        cursor: "pointer",
        marginBottom: -1,
        transition: "color 120ms ease, border-color 120ms ease",
      }}
    >
      {children}
    </button>
  );
}

// ─── Pipeline diagram ────────────────────────────────────────────────────────

type Zone = "classical-pre" | "quantum-prep" | "quantum-sim" | "classical-post";

interface FlowNode {
  num: number;
  icon: string;
  title: string;
  /** One Hebrew sentence: plain-language "what we do here" — the
   *  narrative the reader sees first, before the technical details. */
  narrative: string;
  inputArtifact: string;
  action: string;
  outputArtifact: string;
  zone: Zone;
}

const ZONE_STYLES: Record<
  Zone,
  { bg: string; border: string; label: string; labelColor: string }
> = {
  "classical-pre": {
    bg: "rgba(62, 211, 255, 0.06)",
    border: "#3ed3ff66",
    label: "קלאסי · הכנה",
    labelColor: "#3ed3ff",
  },
  "quantum-prep": {
    bg: "rgba(179, 136, 255, 0.06)",
    border: "#b388ff66",
    label: "הכנה לחומרה קוונטית",
    labelColor: "#b388ff",
  },
  "quantum-sim": {
    bg: "rgba(179, 136, 255, 0.14)",
    border: "#b388ff",
    label: "סימולציה / חומרה קוונטית",
    labelColor: "#b388ff",
  },
  "classical-post": {
    bg: "rgba(61, 220, 151, 0.06)",
    border: "#3ddc9766",
    label: "קלאסי · פוסט-עיבוד",
    labelColor: "#3ddc97",
  },
};

const FLOW: FlowNode[] = [
  {
    num: 1,
    icon: "📡",
    title: "MANET — רשת ניידת",
    narrative:
      "מייצרים רשת תקשורת אקראית של מכשירים — כמו צבא או חיישנים שפזורים בשטח. הקודקודים הם המכשירים, והקשתות מחברות זוגות שיכולים לתקשר ישירות.",
    inputArtifact: "פרמטרים: N, radius, seed",
    action: "RGG generator. צמתים=מכשירים; קשתות=זוגות בטווח תקשורת.",
    outputArtifact: "Graph G(V, E)",
    zone: "classical-pre",
  },
  {
    num: 2,
    icon: "🔁",
    title: "Complement + MIS",
    narrative:
      "כדי למצוא את ה-backbone האופטימלי לניתוב צריך לפתור Maximum Clique. הופכים את הגרף לגרף המשלים, שם אותה בעיה הופכת ל-MIS — את זה אטומי Rydberg יודעים לפתור.",
    inputArtifact: "Graph G",
    action: "בונה Ḡ ומחשב MaxClique(G) = MIS(Ḡ). הטריק שמתרגם את הבעיה לפיזיקת Rydberg.",
    outputArtifact: "Ḡ, max clique S* ⊆ V",
    zone: "classical-pre",
  },
  {
    num: 3,
    icon: "⚛",
    title: "Embedding — השמת אטומים",
    narrative:
      "ממקמים אטומים פיזיים על שבב Aquila כך שהגיאומטריה שלהם מקודדת את הגרף — כל זוג אטומים קרוב מספיק לרדיוס הבליעה מייצג קשת בגרף.",
    inputArtifact: "Ḡ + פרמטרי לייזר (Ω, Δ)",
    action: "spring layout + snap-to-grid. ממקם אטומים כך שרדיוס הבליעה משחזר את קשתות Ḡ.",
    outputArtifact: "Positions (x,y) ∈ µm, R_b, induced edges",
    zone: "quantum-prep",
  },
  {
    num: 4,
    icon: "〰",
    title: "Schedule — pulse אדיאבטי",
    narrative:
      "מתכננים פולס לייזר איטי מספיק (אדיאבטי) שיגלוש את המערכת ממצב בסיס טריוויאלי למצב היסוד של בעיית MIS — שזה בדיוק הפתרון שאנחנו רוצים.",
    inputArtifact: "Positions + duration T",
    action: "בונה Ω(t), Δ(t), φ(t) כך ש-|gg…g⟩ → MIS adiabatically (Ebadi 2022).",
    outputArtifact: "Schedule (T, Ω(t), Δ(t), φ(t))",
    zone: "quantum-prep",
  },
  {
    num: 5,
    icon: "🌀",
    title: "Evolution — סימולציה קוונטית",
    narrative:
      "פותרים את משוואת שרדינגר תחת ה-Hamiltonian שתכננו — זו הסימולציה הקוונטית עצמה. המצב הסופי ‎|ψ(T)⟩ מקודד את ההסתברות של כל פתרון אפשרי.",
    inputArtifact: "Positions + Schedule",
    action: "פותר שרדינגר תחת H מפוצל. אופציונלית mesolve עם רעש Lindblad. מודד gap, fidelity, ⟨H⟩.",
    outputArtifact: "|ψ(T)⟩, final_bitstring_probs |c_b|²",
    zone: "quantum-sim",
  },
  {
    num: 6,
    icon: "📏",
    title: "Measurement — דגימת shots",
    narrative:
      "מדמים את מה שהחומרה האמיתית הייתה מחזירה: דוגמים shots בודדים מההתפלגות הקוונטית ומחילים עליהם את שגיאות הזיהוי של Aquila.",
    inputArtifact: "|c_b|²",
    action: "דוגם N shots מההתפלגות + מחיל רעש SPAM של Aquila (g↔r ≈ 1%↔8%).",
    outputArtifact: "Shots: list of bitstrings (length N)",
    zone: "classical-post",
  },
  {
    num: 7,
    icon: "🛠",
    title: "Post-process — תיקון",
    narrative:
      "מתקנים shots שהפרו את כללי הפיזיקה (שני אטומים שכנים שניהם נדלקו), ומרחיבים כל shot ל-Independent Set מקסימלי תקף.",
    inputArtifact: "Shots + Ḡ",
    action: "Greedy removal של violations + הרחבה greedy ל-mIS מקסימלי תקף.",
    outputArtifact: "Validated MIS: V_MIS ⊆ V",
    zone: "classical-post",
  },
  {
    num: 8,
    icon: "🛰",
    title: "Routing — טבלת ניתוב",
    narrative:
      "הקבוצה הסופית של הצמתים היא backbone הניתוב. בונים מהם טבלת shortest-paths ל-1-hop, כך שכל הודעה ב-MANET תעבור דרך הגב היעיל ביותר.",
    inputArtifact: "V_MIS (backbone) + G",
    action: "מחשב shortest-paths ל-1-hop בין צמתי backbone. בונה טבלת forwarding.",
    outputArtifact: "Routing table per source",
    zone: "classical-post",
  },
];

function PipelineDiagram() {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 0 }}>
      <PipelineStepper />
      <div
        style={{
          padding: "10px 14px",
          marginBottom: 10,
          background: palette.bgInset,
          borderRadius: 8,
          fontSize: 12,
          color: palette.textSecondary,
          lineHeight: 1.6,
        }}
      >
        📖 קוראים מלמעלה למטה. כל שלב מקבל <strong>input</strong>, מבצע{" "}
        <strong>action</strong>, ומעביר <strong>output</strong> לשלב הבא.
        הצבעים מסמלים אם השלב קלאסי-טהור, הכנה לחומרה קוונטית, או הלב הקוונטי
        עצמו.
      </div>
      <div
        style={{
          marginBottom: 16,
          padding: "12px 14px",
          background: palette.bgInset,
          borderRadius: 8,
          fontSize: 12,
          color: palette.textSecondary,
          lineHeight: 1.7,
          border: `1px solid ${palette.queraPurpleSoft}`,
        }}
      >
        💡 <strong>למה זה עובד:</strong> שלבים 1-2 מתרגמים MANET ל-MIS. שלבים 3-4
        מתרגמים את MIS למערך אטומי Rydberg + פולס אדיאבטי. שלב 5 — הלב — מריץ את
        האבולוציה הקוונטית; שלבים 6-8 ממירים את היציאה הקוונטית חזרה לטבלת ניתוב.
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: 0 }}>
        {FLOW.map((node, i) => (
          <div key={node.num}>
            <StageCard node={node} />
            {i < FLOW.length - 1 && (
              <RailConnector
                artifact={node.outputArtifact}
                fromZone={node.zone}
                toZone={FLOW[i + 1].zone}
              />
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

function PipelineStepper() {
  return (
    <div
      dir="ltr"
      style={{
        display: "flex",
        alignItems: "center",
        gap: 0,
        marginBottom: 14,
        padding: "10px 8px",
        background: palette.bgInset,
        borderRadius: 10,
        border: `1px solid ${palette.queraPurpleSoft}`,
      }}
    >
      {FLOW.map((node, i) => {
        const s = ZONE_STYLES[node.zone];
        const isLast = i === FLOW.length - 1;
        const nextColor = isLast ? s.labelColor : ZONE_STYLES[FLOW[i + 1].zone].labelColor;
        return (
          <div
            key={node.num}
            style={{ display: "flex", alignItems: "center", flex: isLast ? "0 0 auto" : 1 }}
          >
            <div
              title={node.title}
              style={{
                width: 38,
                height: 38,
                borderRadius: "50%",
                background: palette.bgPanel,
                border: `2px solid ${s.labelColor}`,
                color: s.labelColor,
                fontFamily: "JetBrains Mono",
                fontSize: 16,
                fontWeight: 800,
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                flexShrink: 0,
                boxShadow: node.zone === "quantum-sim" ? `0 0 12px ${s.labelColor}55` : "none",
              }}
            >
              {node.num}
            </div>
            {!isLast && (
              <div
                style={{
                  flex: 1,
                  height: 2,
                  background: `linear-gradient(to right, ${s.labelColor}, ${nextColor})`,
                  opacity: 0.6,
                }}
              />
            )}
          </div>
        );
      })}
    </div>
  );
}

function StageCard({ node }: { node: FlowNode }) {
  const s = ZONE_STYLES[node.zone];
  const isHeart = node.zone === "quantum-sim";
  return (
    <div
      style={{
        background: s.bg,
        border: `1px solid ${s.border}`,
        borderRadius: 12,
        padding: "14px 16px",
        boxShadow: isHeart ? `0 0 0 1px ${s.labelColor}66, 0 4px 24px ${s.labelColor}22` : "none",
      }}
    >
      {/* Top tier — medallion + title + narrative + zone chip */}
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "auto 1fr auto",
          gap: 14,
          alignItems: "flex-start",
        }}
      >
        {/* Medallion */}
        <div
          style={{
            width: 80,
            height: 80,
            borderRadius: "50%",
            background: palette.bgPanel,
            border: `2.5px solid ${s.labelColor}`,
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            justifyContent: "center",
            flexShrink: 0,
            boxShadow: isHeart ? `0 0 16px ${s.labelColor}66` : "none",
          }}
        >
          <div style={{ fontSize: 24, lineHeight: 1 }}>{node.icon}</div>
          <div
            style={{
              fontSize: 20,
              color: s.labelColor,
              fontWeight: 800,
              marginTop: 4,
              fontFamily: "JetBrains Mono",
              lineHeight: 1,
            }}
          >
            {node.num}
          </div>
        </div>

        {/* Headline */}
        <div style={{ display: "flex", flexDirection: "column", gap: 6, paddingTop: 4 }}>
          <div
            style={{
              fontSize: 17,
              fontWeight: 700,
              color: s.labelColor,
            }}
          >
            {node.title}
          </div>
          <div
            style={{
              fontSize: 14,
              color: palette.textPrimary,
              lineHeight: 1.65,
            }}
          >
            {node.narrative}
          </div>
        </div>

        {/* Zone chip */}
        <div
          style={{
            flexShrink: 0,
            padding: "3px 11px",
            border: `1px solid ${s.border}`,
            background: palette.bgPanel,
            borderRadius: 999,
            color: s.labelColor,
            fontSize: 12,
            fontWeight: 600,
            whiteSpace: "nowrap",
            alignSelf: "flex-start",
          }}
        >
          {s.label}
        </div>
      </div>

      {/* Soft divider */}
      <div
        style={{
          height: 1,
          background: `linear-gradient(to ${"right"}, transparent, ${s.labelColor}44, transparent)`,
          margin: "12px 0 10px",
        }}
      />

      {/* Bottom tier — input / action / output. Use flex rows (not a grid)
          so that mono-LTR values stay packed against their RTL label
          instead of drifting to the opposite edge of the card. */}
      <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
        <DetailRow
          icon="📥"
          label="Input"
          value={node.inputArtifact}
          valueMono
          valueColor={palette.textPrimary}
        />
        <DetailRow
          icon="⚙"
          label="Action"
          value={node.action}
          valueColor={palette.textSecondary}
        />
        <DetailRow
          icon="📤"
          label="Output"
          value={node.outputArtifact}
          valueMono
          valueColor={s.labelColor}
          valueBold
        />
      </div>
    </div>
  );
}

function DetailRow({
  icon,
  label,
  value,
  valueMono,
  valueColor,
  valueBold,
}: {
  icon: string;
  label: string;
  value: string;
  valueMono?: boolean;
  valueColor: string;
  valueBold?: boolean;
}) {
  return (
    <div
      style={{
        display: "flex",
        alignItems: "baseline",
        gap: 14,
        fontSize: 14.5,
        lineHeight: 1.55,
      }}
    >
      <span
        style={{
          flex: "0 0 auto",
          minWidth: 100,
          color: palette.textMuted,
          fontFamily: "JetBrains Mono",
          fontSize: 14.5,
          whiteSpace: "nowrap",
          display: "inline-flex",
          alignItems: "center",
          gap: 6,
        }}
      >
        <span style={{ fontSize: 16 }}>{icon}</span> {label}
      </span>
      {/* Value sizes to its content (flex: 0 1 auto) so it stays packed
       *  next to its label in the RTL flow instead of stretching across
       *  the row. unicode-bidi: plaintext lets mono expressions like
       *  "G(V,E)" render left-to-right internally without affecting the
       *  cell's position. */}
      <span
        style={{
          flex: "0 1 auto",
          fontFamily: valueMono ? "JetBrains Mono" : undefined,
          color: valueColor,
          fontWeight: valueBold ? 600 : 400,
          unicodeBidi: "plaintext",
        }}
      >
        {value}
      </span>
    </div>
  );
}

function RailConnector({
  artifact,
  fromZone,
  toZone,
}: {
  artifact: string;
  fromZone: Zone;
  toZone: Zone;
}) {
  const cFrom = ZONE_STYLES[fromZone].labelColor;
  const cTo = ZONE_STYLES[toZone].labelColor;
  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        gap: 0,
        padding: "2px 0",
      }}
    >
      <div
        style={{
          width: 2,
          height: 12,
          background: `linear-gradient(to bottom, ${cFrom}, ${cTo})`,
          opacity: 0.7,
        }}
      />
      <div
        dir="ltr"
        style={{
          fontFamily: "JetBrains Mono",
          fontSize: 12.5,
          color: cTo,
          background: palette.bgInset,
          border: `1px solid ${cTo}66`,
          borderRadius: 999,
          padding: "3px 12px",
          margin: "2px 0",
        }}
      >
        {artifact}
      </div>
      <div
        style={{
          width: 2,
          height: 12,
          background: `linear-gradient(to bottom, ${cTo}, ${cTo})`,
          opacity: 0.7,
        }}
      />
    </div>
  );
}
