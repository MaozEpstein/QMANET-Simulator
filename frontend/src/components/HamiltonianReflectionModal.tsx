/**
 * Three-tab modal that "reflects" how the Rydberg Hamiltonian is built up.
 *
 * Lives behind a button in Stage 4's Hamiltonian panel. The three tabs walk
 * the reader from the cheapest level (the raw ingredients) up to how the
 * Hamiltonian actually acts on the quantum state:
 *
 *   1. רכיבי החישוב  — constants and the live V_ij table.
 *   2. הרכבה דינמית   — H is assembled term-by-term (drive → detuning → V).
 *   3. פעולה על המצב — what H does to |ψ⟩, plus the eigenvalue picture.
 *
 * Modal layout mirrors ExamplesButton's dialog (same overlay, sizing, header).
 */

import { useEffect, useMemo, useState } from "react";
import katex from "katex";
import { palette } from "../theme/palette";

const C6_RAD_PER_US_UM6 = 5_420_503;

interface Props {
  /** When true the modal is mounted as a dialog. Parent owns this state. */
  open: boolean;
  onClose: () => void;
  /** Live snapshot of Hamiltonian state at the cursor. */
  omega: number;
  delta: number;
  phi: number;
  nAtoms: number;
  positions: { x: number; y: number }[];
}

type TabId = "ingredients" | "assembly" | "action";

const TABS: { id: TabId; label: string; subtitle: string }[] = [
  {
    id: "ingredients",
    label: "1 · רכיבי החישוב",
    subtitle: "מה נכנס לבניית ה-Hamiltonian — קבועים, מיקומים, V_ij",
  },
  {
    id: "assembly",
    label: "2 · הרכבה דינמית",
    subtitle: "ה-H נבנה רכיב אחרי רכיב: דרייב → דיטיונינג → אינטראקציות",
  },
  {
    id: "action",
    label: "3 · פעולה על המצב",
    subtitle: "מה H עושה ל-|ψ⟩ ולמה הספקטרום שלו קובע את האדיאבטיות",
  },
];

export function HamiltonianReflectionModal({
  open,
  onClose,
  omega,
  delta,
  phi,
  nAtoms,
  positions,
}: Props) {
  const [tab, setTab] = useState<TabId>("ingredients");

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  if (!open) return null;

  const active = TABS.find((t) => t.id === tab)!;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="שיקוף בניית ההמילטוניין"
      onClick={onClose}
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
          maxWidth: "min(1100px, 95vw)",
          width: "100%",
          maxHeight: "90vh",
          overflow: "auto",
          boxShadow: `0 12px 60px ${palette.queraPurple}66`,
        }}
      >
        <header
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            marginBottom: 14,
            gap: 12,
          }}
        >
          <div>
            <h2
              style={{
                margin: 0,
                fontSize: 17,
                fontWeight: 600,
                color: palette.textPrimary,
              }}
            >
              שיקוף בניית ה-Hamiltonian
            </h2>
            <div style={{ fontSize: 12, color: palette.textMuted, marginTop: 4 }}>
              {active.subtitle}
            </div>
          </div>
          <button
            onClick={onClose}
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

        <nav
          style={{
            display: "flex",
            gap: 6,
            marginBottom: 18,
            borderBottom: `1px solid ${palette.queraPurpleSoft}`,
            paddingBottom: 2,
          }}
        >
          {TABS.map((t) => {
            const isActive = t.id === tab;
            return (
              <button
                key={t.id}
                onClick={() => setTab(t.id)}
                style={{
                  padding: "8px 16px",
                  border: "none",
                  borderRadius: "8px 8px 0 0",
                  background: isActive ? palette.queraPurple : "transparent",
                  color: isActive ? "#fff" : palette.textSecondary,
                  fontSize: 12.5,
                  fontWeight: 600,
                  cursor: "pointer",
                  borderBottom: isActive
                    ? `2px solid ${palette.queraPurpleGlow}`
                    : "2px solid transparent",
                  transition: "all 160ms ease",
                }}
              >
                {t.label}
              </button>
            );
          })}
        </nav>

        {tab === "ingredients" && (
          <IngredientsTab
            omega={omega}
            delta={delta}
            phi={phi}
            nAtoms={nAtoms}
            positions={positions}
          />
        )}
        {tab === "assembly" && (
          <AssemblyTab omega={omega} delta={delta} phi={phi} nAtoms={nAtoms} positions={positions} />
        )}
        {tab === "action" && <ActionTab nAtoms={nAtoms} />}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Tab 1 — Ingredients
// ---------------------------------------------------------------------------

function IngredientsTab({
  omega,
  delta,
  phi,
  nAtoms,
  positions,
}: {
  omega: number;
  delta: number;
  phi: number;
  nAtoms: number;
  positions: { x: number; y: number }[];
}) {
  const pairs = useMemo(() => {
    const out: { i: number; j: number; r: number; v: number }[] = [];
    for (let i = 0; i < positions.length; i++) {
      for (let j = i + 1; j < positions.length; j++) {
        const dx = positions[i].x - positions[j].x;
        const dy = positions[i].y - positions[j].y;
        const r = Math.hypot(dx, dy);
        if (r <= 0) continue;
        out.push({ i, j, r, v: C6_RAD_PER_US_UM6 / Math.pow(r, 6) });
      }
    }
    out.sort((a, b) => b.v - a.v);
    return out;
  }, [positions]);

  const sumV = pairs.reduce((a, p) => a + p.v, 0);
  const topPairs = pairs.slice(0, 12);

  return (
    <div style={{ display: "grid", gap: 18 }}>
      <Card title="קבועי החומרה (Aquila)">
        <CodeRow label="C₆" value={`${C6_RAD_PER_US_UM6.toLocaleString()} rad/µs · µm⁶`} />
        <CodeRow label="Ω_max" value="15.8 rad/µs" />
        <CodeRow label="Δ_max" value="±125 rad/µs" />
        <CodeRow label="V_ij" value="C₆ / r_ij⁶" />
      </Card>

      <Card title="הקלט הרגעי (cursor t)">
        <CodeRow label="N atoms" value={String(nAtoms)} />
        <CodeRow label="Ω(t)" value={`${omega.toFixed(3)} rad/µs`} color={palette.channelOmega} />
        <CodeRow label="Δ(t)" value={`${delta.toFixed(3)} rad/µs`} color={palette.channelDelta} />
        <CodeRow label="φ(t)" value={`${phi.toFixed(3)} rad`} color={palette.channelPhi} />
      </Card>

      <Card
        title={`טבלת V_ij — ${pairs.length} צמדים, סכום ${sumV.toFixed(1)} rad/µs`}
        subtitle="12 הצמדים הדומיננטיים. V גדול מ-Ω/2 = blockade pair (פר Ebadi 2022)."
      >
        <div style={{ display: "grid", gridTemplateColumns: "auto auto auto auto", gap: "4px 18px", fontSize: 11.5, fontFamily: "JetBrains Mono, monospace" }} dir="ltr">
          <div style={{ color: palette.textMuted }}>i ↔ j</div>
          <div style={{ color: palette.textMuted }}>r (µm)</div>
          <div style={{ color: palette.textMuted }}>V_ij (rad/µs)</div>
          <div style={{ color: palette.textMuted }}>relative</div>
          {topPairs.map((p) => {
            const isBlockade = p.v > Math.abs(omega) / 2;
            const widthPct = Math.min(100, (p.v / (topPairs[0]?.v ?? 1)) * 100);
            return (
              <div key={`${p.i}-${p.j}`} style={{ display: "contents" }}>
                <div style={{ color: palette.textSecondary }}>
                  {p.i} ↔ {p.j}
                </div>
                <div style={{ color: palette.textSecondary }}>{p.r.toFixed(2)}</div>
                <div style={{ color: isBlockade ? palette.warn : palette.textSecondary, fontWeight: isBlockade ? 700 : 400 }}>
                  {p.v.toFixed(2)}
                  {isBlockade && " ★"}
                </div>
                <div
                  style={{
                    height: 6,
                    background: palette.bgPanel,
                    borderRadius: 999,
                    overflow: "hidden",
                    border: `1px solid ${palette.queraPurpleSoft}`,
                    alignSelf: "center",
                  }}
                >
                  <div
                    style={{
                      width: `${widthPct}%`,
                      height: "100%",
                      background: isBlockade ? palette.warn : palette.queraPurpleGlow,
                    }}
                  />
                </div>
              </div>
            );
          })}
        </div>
        {pairs.length > 12 && (
          <div style={{ marginTop: 8, fontSize: 10.5, color: palette.textMuted }}>
            ועוד {pairs.length - 12} צמדים נוספים בעלי V_ij קטן יותר…
          </div>
        )}
      </Card>
    </div>
  );
}

function CodeRow({ label, value, color }: { label: string; value: string; color?: string }) {
  return (
    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", fontFamily: "JetBrains Mono, monospace", fontSize: 12 }} dir="ltr">
      <span style={{ color: palette.textSecondary }}>{label}</span>
      <span style={{ color: color ?? palette.queraPurpleGlow, fontWeight: 600 }}>{value}</span>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Tab 2 — Step-by-step assembly
// ---------------------------------------------------------------------------

function AssemblyTab({
  omega,
  delta,
  phi,
  nAtoms,
  positions,
}: {
  omega: number;
  delta: number;
  phi: number;
  nAtoms: number;
  positions: { x: number; y: number }[];
}) {
  const sumV = useMemo(() => {
    let s = 0;
    for (let i = 0; i < positions.length; i++) {
      for (let j = i + 1; j < positions.length; j++) {
        const dx = positions[i].x - positions[j].x;
        const dy = positions[i].y - positions[j].y;
        const r2 = dx * dx + dy * dy;
        if (r2 > 0) s += C6_RAD_PER_US_UM6 / Math.pow(r2, 3);
      }
    }
    return s;
  }, [positions]);

  const driveMag = (Math.abs(omega) / 2) * nAtoms;
  const detMag = Math.abs(delta) * nAtoms;
  const intMag = sumV;
  const scale = Math.max(driveMag, detMag, intMag, 1e-6);

  return (
    <div style={{ display: "grid", gap: 18 }}>
      <AssemblyStep
        step={1}
        title="התחלה — H = 0"
        latex={String.raw`H_0 = 0`}
        magnitude={0}
        scale={scale}
        explain="התחלנו ממילטוניאן ריק. כל המידע על המערכת עוד לא נכנס."
        color={palette.textMuted}
      />
      <AssemblyStep
        step={2}
        title="הוספת הדרייב (Rabi coupling)"
        latex={String.raw`H_1 = H_0 + \frac{\textcolor{${palette.channelOmega}}{${omega.toFixed(2)}}}{2}\sum_{i=1}^{${nAtoms}}\sigma^x_i`}
        magnitude={driveMag}
        scale={scale}
        explain={`כל אטום מקבל off-diagonal coupling. גודל כולל ≈ N·Ω/2 = ${driveMag.toFixed(1)} rad/µs. זה מערבב את |g⟩ ו-|r⟩.`}
        color={palette.channelOmega}
      />
      <AssemblyStep
        step={3}
        title="הוספת ה-detuning (site energy)"
        latex={String.raw`H_2 = H_1 - (\textcolor{${palette.channelDelta}}{${delta.toFixed(2)}})\sum_{i=1}^{${nAtoms}}\hat n_i`}
        magnitude={detMag}
        scale={scale}
        explain={`כל אטום ב-|r⟩ מקבל אנרגיה −Δ. גודל ≈ N·|Δ| = ${detMag.toFixed(1)} rad/µs. ${delta < 0 ? "Δ < 0 ⇒ מצב |g⟩ מועדף." : "Δ > 0 ⇒ |r⟩ מועדף."}`}
        color={palette.channelDelta}
      />
      <AssemblyStep
        step={4}
        title="הוספת אינטראקציות Rydberg"
        latex={String.raw`H(t) = H_2 + \sum_{i<j}\frac{C_6}{|\vec x_i - \vec x_j|^6}\hat n_i\hat n_j`}
        magnitude={intMag}
        scale={scale}
        explain={`כל זוג ב-|r⟩|r⟩ משלם V_ij. סכום ≈ ${intMag.toFixed(1)} rad/µs. זה ה-Rydberg blockade — מה שמכריח אטומים שכנים לא להתעורר ביחד.`}
        color={palette.warn}
      />
      <div style={{ fontSize: 11, color: palette.textMuted, padding: 12, background: palette.bgInset, borderRadius: 8, lineHeight: 1.6 }}>
        בכל זמן t, שלושת הרכיבים האלה משולבים. הציר ה-X של הפסים = גודל יחסי של כל רכיב.
        בתחילת הפולס (Δ ≪ 0) רכיב ה-detuning הוא דומיננטי ⇒ מצב היסוד הוא |gg…g⟩.
        בסוף הפולס (Δ ≫ 0) הוא עדיין משמעותי אבל המתחרה האמיתי הוא רכיב האינטראקציה — וזה מה שכופה
        על המצב להיות MIS ולא "כולם ב-|r⟩".  φ = {phi.toFixed(2)} משפיע על phase של ה-Rabi coupling.
      </div>
    </div>
  );
}

function AssemblyStep({
  step,
  title,
  latex,
  magnitude,
  scale,
  explain,
  color,
}: {
  step: number;
  title: string;
  latex: string;
  magnitude: number;
  scale: number;
  explain: string;
  color: string;
}) {
  const ref = useStableKatex(latex);
  const widthPct = (magnitude / scale) * 100;
  return (
    <div
      style={{
        padding: 14,
        background: palette.bgInset,
        border: `1px solid ${palette.queraPurpleSoft}`,
        borderRadius: 10,
        display: "flex",
        flexDirection: "column",
        gap: 10,
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
        <div
          style={{
            width: 26,
            height: 26,
            borderRadius: 999,
            background: color,
            color: "#000",
            fontWeight: 800,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            fontSize: 13,
          }}
        >
          {step}
        </div>
        <div style={{ fontWeight: 700, fontSize: 13, color: palette.textPrimary }}>
          {title}
        </div>
      </div>
      <div ref={ref} dir="ltr" style={{ color: palette.textPrimary }} />
      {magnitude > 0 && (
        <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
          <div style={{ display: "flex", justifyContent: "space-between", fontSize: 10.5, color: palette.textMuted }} dir="ltr">
            <span>‖term‖ (rad/µs)</span>
            <span style={{ color }}>{magnitude.toFixed(1)}</span>
          </div>
          <div
            style={{
              height: 6,
              background: palette.bgPanel,
              borderRadius: 999,
              border: `1px solid ${palette.queraPurpleSoft}`,
              overflow: "hidden",
            }}
          >
            <div
              style={{
                width: `${widthPct}%`,
                height: "100%",
                background: `linear-gradient(90deg, ${color}, ${color}aa)`,
                boxShadow: `0 0 8px ${color}80`,
                transition: "width 280ms ease",
              }}
            />
          </div>
        </div>
      )}
      <div style={{ fontSize: 11.5, color: palette.textSecondary, lineHeight: 1.6 }}>
        {explain}
      </div>
    </div>
  );
}

function useStableKatex(latex: string) {
  const ref = useMemo(() => ({ current: null as HTMLDivElement | null }), []);
  useEffect(() => {
    if (ref.current) {
      katex.render(latex, ref.current, { throwOnError: false, displayMode: true });
    }
  }, [latex, ref]);
  return (el: HTMLDivElement | null) => {
    ref.current = el;
    if (el) katex.render(latex, el, { throwOnError: false, displayMode: true });
  };
}

// ---------------------------------------------------------------------------
// Tab 3 — How H acts on |ψ⟩
// ---------------------------------------------------------------------------

function ActionTab({ nAtoms }: { nAtoms: number }) {
  const dim = Math.pow(2, nAtoms);
  return (
    <div style={{ display: "grid", gap: 18 }}>
      <Card title="מה ה-Hamiltonian עושה ל-|ψ⟩">
        <p style={{ margin: 0, fontSize: 12, lineHeight: 1.7, color: palette.textSecondary }}>
          ה-Hamiltonian H(t) הוא אופרטור הרמיטי שפועל על מרחב Hilbert של 2^N מצבים. עבור N = {nAtoms},
          המרחב הוא בגודל <span dir="ltr" style={{ fontFamily: "var(--font-mono)", color: palette.queraPurpleGlow }}>{dim.toLocaleString()}</span> מצבים.
        </p>
      </Card>

      <Card title="משוואת שרדינגר ופירוק ספקטרלי">
        <KatexBlock
          latex={String.raw`i\hbar \frac{\partial |\psi(t)\rangle}{\partial t} = H(t)\,|\psi(t)\rangle`}
        />
        <p style={{ marginTop: 14, fontSize: 12, lineHeight: 1.7, color: palette.textSecondary }}>
          בכל רגע אפשר לפרק את H(t) לבסיס של ערכים עצמיים:
        </p>
        <KatexBlock
          latex={String.raw`H(t)\,|n(t)\rangle = E_n(t)\,|n(t)\rangle, \quad n = 0, 1, 2, \dots`}
        />
        <p style={{ marginTop: 12, fontSize: 12, lineHeight: 1.7, color: palette.textSecondary }}>
          המצב |0(t)⟩ הוא <strong>מצב היסוד</strong> — המצב עם האנרגיה הנמוכה ביותר. בסוף הפולס |0(T)⟩
          קודד את ה-MIS של הגרף.
        </p>
      </Card>

      <Card title="המשפט האדיאבטי בקצרה">
        <p style={{ margin: 0, fontSize: 12, lineHeight: 1.7, color: palette.textSecondary }}>
          אם H(t) משתנה <strong>לאט מספיק</strong> ביחס לפער האנרגטי
          <span dir="ltr" style={{ fontFamily: "var(--font-mono)", color: palette.queraPurpleGlow }}>{" "}δ(t) = E_1(t) − E_0(t){" "}</span>,
          המערכת נשארת ב-|0(t)⟩ לאורך הזמן. הקריטריון:
        </p>
        <KatexBlock
          latex={String.raw`\left\| \frac{dH}{dt} \right\| \ll \delta_{\min}^2`}
        />
        <p style={{ fontSize: 12, lineHeight: 1.7, color: palette.textSecondary }}>
          זה בדיוק מה ש-Adiabaticity Score בעמוד הראשי בודק: היחס בין T בפועל ל-1/δ_min². ה-Spectrum
          tab מראה את E_0..E_3 לאורך זמן — ה-avoided crossing במינימום δ הוא צוואר הבקבוק.
        </p>
      </Card>

      <Card title="חיפוש MIS דרך מצב היסוד">
        <p style={{ margin: 0, fontSize: 12, lineHeight: 1.7, color: palette.textSecondary }}>
          ב-Δ ≪ 0 (התחלה): מצב היסוד = |gg…g⟩ (כולם בקרקע).<br />
          ב-Δ ≫ 0 (סוף): מצב היסוד = מצב ה-MIS — אסופת האטומים הגדולה ביותר ב-|r⟩ שאף זוג שלהם לא ב-blockade.<br />
          הפולס האדיאבטי <strong>מחבר ביניהם רציפות</strong>. אם משפט האדיאבטיות מתקיים, המערכת
          "גולשת" בין שני המצבים והפלט הוא ה-MIS המבוקש.
        </p>
      </Card>
    </div>
  );
}

function KatexBlock({ latex }: { latex: string }) {
  const setRef = useStableKatex(latex);
  return <div ref={setRef} dir="ltr" style={{ color: palette.textPrimary, margin: "10px 0" }} />;
}

// ---------------------------------------------------------------------------
// Shared card wrapper
// ---------------------------------------------------------------------------

function Card({
  title,
  subtitle,
  children,
}: {
  title: string;
  subtitle?: string;
  children: React.ReactNode;
}) {
  return (
    <section
      style={{
        padding: 16,
        background: palette.bgInset,
        border: `1px solid ${palette.queraPurpleSoft}`,
        borderRadius: 10,
        display: "flex",
        flexDirection: "column",
        gap: 10,
      }}
    >
      <header style={{ display: "flex", flexDirection: "column", gap: 2 }}>
        <div style={{ fontWeight: 700, fontSize: 13, color: palette.textPrimary }}>{title}</div>
        {subtitle && <div style={{ fontSize: 11, color: palette.textMuted }}>{subtitle}</div>}
      </header>
      {children}
    </section>
  );
}
