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
    purpose: "פותר את משוואת שרדינגר תחת H(t). |ψ(T)⟩ מקודד את ה-MIS כמצב בהסתברות גבוהה.",
    work: "QuTiP sesolve על H של 2^N × 2^N",
    growth: "O(2^(2N))",
    load: "💀 פה זה מת ב-N≈14",
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

export function StagesInfoButton() {
  const [open, setOpen] = useState(false);

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
              padding: "22px 26px",
              maxWidth: 920,
              width: "100%",
              maxHeight: "85vh",
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
                  מורכבות לפי שלב
                </h2>
                <div style={{ fontSize: 12, color: palette.textMuted, marginTop: 3 }}>
                  מה רץ בכל שלב, איך הוא גדל עם N, ואיפה מגיעים לגבול
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

            <table
              style={{
                width: "100%",
                borderCollapse: "collapse",
                fontSize: 12.5,
                color: palette.textPrimary,
              }}
            >
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
              שלב 5 הוא צוואר הבקבוק היחיד — QuTiP בונה מטריצה צפופה של 2^N × 2^N לכל timestep. כל שאר השלבים פולינומיים ב-N
              ויודעים לרוץ על 100+ צמתים בלי בעיה. Phase 7 (Braket) פותח את התקרה של שלב 5 על-ידי דחיפת ה-job לחומרת Aquila.
            </p>
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
