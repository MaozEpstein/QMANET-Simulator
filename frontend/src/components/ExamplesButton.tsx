/**
 * "דוגמות" button + modal that lists curated example graphs.
 *
 * The button lives in the header (next to the project title). Clicking it
 * opens a modal that groups examples by family (size, topology, paper
 * reference). Each example carries a short description and a "טען" button
 * that will eventually hand the dataset to the pipeline store.
 *
 * The example list is intentionally a *data table* (`EXAMPLES`) so adding
 * new graphs is a one-line change. Wiring the actual load behaviour comes
 * after we decide which graphs make the cut.
 */

import { useCallback, useEffect, useState } from "react";
import { api } from "../api/rest";
import { buildPetersenExample } from "../lib/examples";
import { usePipeline } from "../store/pipeline";
import { palette } from "../theme/palette";

type CategoryId = "myGraphs" | "starter" | "topology" | "paper" | "stress";

type LoadingStep = "complement" | "embed" | "schedule" | null;

const STEP_LABEL: Record<Exclude<LoadingStep, null>, string> = {
  complement: "בונה גרף משלים ומוצא MIS",
  embed: "ממקם אטומים על רשת Aquila",
  schedule: "בונה פולס אדיאבטי",
};

const STEP_ORDER: Exclude<LoadingStep, null>[] = ["complement", "embed", "schedule"];

interface Example {
  id: string;
  name: string;            // Hebrew/short name shown on the card
  englishName?: string;    // formal name in LTR
  description: string;     // one-line, what it teaches the user
  n: number;               // size (atoms / nodes)
  category: CategoryId;
  paperRef?: string;       // e.g. "Ebadi 2022 §6.1"
  status?: "available" | "soon";
  build?: () => ReturnType<typeof buildPetersenExample>;
}

const CATEGORIES: { id: CategoryId; title: string; subtitle: string; emptyHint?: string }[] = [
  {
    id: "myGraphs",
    title: "הגרפים שלי",
    subtitle: "גרפים שבניתי ידנית — בהמשך יתווסף עורך אינטראקטיבי",
    emptyHint:
      "עדיין לא נשמרו גרפים. אחרי שנוסיף עורך הגרפים, כל גרף שתבנה ותשמור יופיע פה.",
  },
  {
    id: "starter",
    title: "התחלה",
    subtitle: "גרפים קטנים עם תוצאה ידועה — להבנה ראשונית של הצינור",
  },
  {
    id: "topology",
    title: "טופולוגיות קלאסיות",
    subtitle: "משפחות גרפים שלימוד שלהן מפענח את התנהגות ה-MIS",
  },
  {
    id: "paper",
    title: "רפרודוקציה ממאמרים",
    subtitle: "אותם פרמטרים כמו ב-Ebadi 2022 / Bernien 2017",
  },
  {
    id: "stress",
    title: "מבחני גבולות",
    subtitle: "גרפים שמראים איפה הסימולציה המקומית נשברת ולמה Phase 7 נדרש",
  },
];

const EXAMPLES: Example[] = [
  {
    id: "petersen",
    name: "גרף פטרסן",
    englishName: "Petersen graph",
    description:
      "הגרף הכי מפורסם בתורת הגרפים. 3-regular, חסר משולשים. α(G)=4, MaxClique=2. פריסה סימטרית של מחומש חיצוני + פנטגרם פנימי.",
    n: 10,
    category: "starter",
    build: buildPetersenExample,
  },
];

export function ExamplesButton() {
  const [open, setOpen] = useState(false);
  const [loadingStep, setLoadingStep] = useState<LoadingStep>(null);
  const [loadingId, setLoadingId] = useState<string | null>(null);
  const [loadErr, setLoadErr] = useState<string | null>(null);
  const close = useCallback(() => {
    if (loadingStep) return; // don't dismiss mid-load
    setOpen(false);
    setLoadErr(null);
  }, [loadingStep]);
  const {
    setManet,
    setMIS,
    setEmbed,
    setSchedule,
    resetSimulation,
    setStage,
  } = usePipeline();

  // Pre-load the *cheap* deterministic stages (Complement → Embedding →
  // Schedule). Stage 5 (Evolution) is the stiff one and we deliberately
  // never auto-run it — the user clicks "↻ הרץ אבולוציה" when ready.
  // Stages 6-8 read from the store and either auto-run (8) or wait for
  // Stage 5 (6, 7).
  const loadExample = useCallback(
    async (ex: Example) => {
      if (!ex.build || loadingStep) return;
      setLoadErr(null);
      setLoadingId(ex.id);

      setMIS(null);
      setEmbed(null);
      setSchedule(null);
      resetSimulation();
      const manet = ex.build();
      setManet(manet);

      try {
        setLoadingStep("complement");
        const mis = await api.complement(manet.graph);
        setMIS(mis);

        setLoadingStep("embed");
        const embed = await api.embed({ target_graph: mis.complement });
        setEmbed(embed);

        setLoadingStep("schedule");
        const schedule = await api.schedule({ preset: "paper_linear_ramp" });
        setSchedule(schedule);

        setStage("manet");
        setOpen(false);
      } catch (e) {
        setLoadErr((e as Error).message);
      } finally {
        setLoadingStep(null);
        setLoadingId(null);
      }
    },
    [loadingStep, setManet, setMIS, setEmbed, setSchedule, resetSimulation, setStage],
  );

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
        aria-label="טען גרף לדוגמה"
        title="טען גרף לדוגמה"
        style={buttonStyle}
        onMouseEnter={(e) => {
          e.currentTarget.style.background = palette.queraPurple;
          e.currentTarget.style.color = "#fff";
          e.currentTarget.style.borderColor = palette.queraPurpleGlow;
        }}
        onMouseLeave={(e) => {
          e.currentTarget.style.background = "transparent";
          e.currentTarget.style.color = palette.textPrimary;
          e.currentTarget.style.borderColor = palette.queraPurpleSoft;
        }}
      >
        <GraphIcon />
        <span style={{ marginInlineStart: 8 }}>דוגמות</span>
      </button>

      {open && (
        <div
          role="dialog"
          aria-modal="true"
          aria-label="בחר דוגמה"
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
                marginBottom: 18,
                gap: 12,
              }}
            >
              <div>
                <h2 style={{ margin: 0, fontSize: 17, fontWeight: 600, color: palette.textPrimary }}>
                  גרפים לדוגמה
                </h2>
                <div style={{ fontSize: 12, color: palette.textMuted, marginTop: 4 }}>
                  בחירה מהירה של דאטהסט קלאסי כדי לראות את הצינור בפעולה
                </div>
              </div>
              <button
                onClick={close}
                aria-label="סגור"
                disabled={loadingStep !== null}
                style={{
                  width: 28,
                  height: 28,
                  borderRadius: 6,
                  border: `1px solid ${palette.queraPurpleSoft}`,
                  background: "transparent",
                  color: palette.textSecondary,
                  fontSize: 16,
                  cursor: loadingStep ? "not-allowed" : "pointer",
                  opacity: loadingStep ? 0.4 : 1,
                  lineHeight: 1,
                }}
              >
                ×
              </button>
            </header>

            {loadErr && (
              <div
                role="alert"
                style={{
                  marginBottom: 14,
                  padding: "10px 12px",
                  borderRadius: 8,
                  background: "rgba(255, 84, 112, 0.1)",
                  border: `1px solid ${palette.err}`,
                  color: palette.err,
                  fontSize: 12,
                }}
                dir="ltr"
              >
                ⚠ {loadErr}
              </div>
            )}

            <div style={{ display: "flex", flexDirection: "column", gap: 22 }}>
              {CATEGORIES.map((cat) => {
                const items = EXAMPLES.filter((e) => e.category === cat.id);
                return (
                  <section key={cat.id}>
                    <div style={{ marginBottom: 10 }}>
                      <h3
                        style={{
                          margin: 0,
                          fontSize: 13,
                          fontWeight: 600,
                          color: palette.queraPurpleGlow,
                          textTransform: "uppercase",
                          letterSpacing: 0.6,
                        }}
                      >
                        {cat.title}
                      </h3>
                      <div style={{ fontSize: 11.5, color: palette.textMuted, marginTop: 2 }}>
                        {cat.subtitle}
                      </div>
                    </div>
                    {items.length === 0 ? (
                      <EmptySlot hint={cat.emptyHint} />
                    ) : (
                      <div
                        style={{
                          display: "grid",
                          gridTemplateColumns: "repeat(auto-fill, minmax(260px, 1fr))",
                          gap: 10,
                        }}
                      >
                        {items.map((ex) => (
                          <ExampleCard
                            key={ex.id}
                            example={ex}
                            onLoad={loadExample}
                            loading={loadingId === ex.id ? loadingStep : null}
                            disabled={loadingStep !== null && loadingId !== ex.id}
                          />
                        ))}
                      </div>
                    )}
                  </section>
                );
              })}
            </div>
          </div>
        </div>
      )}
    </>
  );
}

function ExampleCard({
  example,
  onLoad,
  loading,
  disabled,
}: {
  example: Example;
  onLoad: (ex: Example) => void;
  loading: LoadingStep;
  disabled: boolean;
}) {
  const soon = example.status === "soon" || !example.build;
  const isLoading = loading !== null;
  const stepIdx = loading ? STEP_ORDER.indexOf(loading) : -1;
  return (
    <div
      style={{
        background: palette.bgInset,
        border: `1px solid ${palette.queraPurpleSoft}`,
        borderRadius: 10,
        padding: "12px 14px",
        opacity: soon ? 0.55 : 1,
        display: "flex",
        flexDirection: "column",
        gap: 6,
      }}
    >
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8 }}>
        <div style={{ fontWeight: 600, fontSize: 13, color: palette.textPrimary }}>{example.name}</div>
        <div
          style={{
            fontFamily: "JetBrains Mono, monospace",
            fontSize: 11,
            color: palette.queraPurpleGlow,
            background: palette.bgPanel,
            padding: "2px 8px",
            borderRadius: 999,
          }}
          dir="ltr"
        >
          N={example.n}
        </div>
      </div>
      {example.englishName && (
        <div style={{ fontSize: 11, color: palette.textMuted }} dir="ltr">
          {example.englishName}
        </div>
      )}
      <div style={{ fontSize: 12, color: palette.textSecondary, lineHeight: 1.5 }}>
        {example.description}
      </div>
      {example.paperRef && (
        <div style={{ fontSize: 11, color: palette.textMuted }} dir="ltr">
          ref: {example.paperRef}
        </div>
      )}
      {isLoading && loading && (
        <div style={{ marginTop: 2 }}>
          <div
            style={{
              fontSize: 11,
              color: palette.queraPurpleGlow,
              marginBottom: 4,
              display: "flex",
              justifyContent: "space-between",
              gap: 6,
            }}
          >
            <span>{STEP_LABEL[loading]}</span>
            <span dir="ltr">
              {stepIdx + 1}/{STEP_ORDER.length}
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
                width: `${((stepIdx + 1) / STEP_ORDER.length) * 100}%`,
                height: "100%",
                background: palette.queraPurpleGlow,
                transition: "width 200ms ease",
              }}
            />
          </div>
        </div>
      )}
      <button
        disabled={soon || disabled || isLoading}
        onClick={() => onLoad(example)}
        style={{
          marginTop: 4,
          padding: "6px 12px",
          background: soon || disabled ? "transparent" : palette.queraPurple,
          color: soon || disabled ? palette.textMuted : "#fff",
          border: soon || disabled ? `1px dashed ${palette.queraPurpleSoft}` : "none",
          borderRadius: 6,
          fontSize: 12,
          fontWeight: 600,
          cursor: soon || disabled || isLoading ? "not-allowed" : "pointer",
          alignSelf: "flex-start",
          opacity: disabled ? 0.5 : 1,
        }}
      >
        {soon ? "תיכף" : isLoading ? "טוען…" : "טען"}
      </button>
    </div>
  );
}

function EmptySlot({ hint }: { hint?: string }) {
  return (
    <div
      style={{
        border: `1px dashed ${palette.queraPurpleSoft}`,
        borderRadius: 10,
        padding: "14px 16px",
        color: palette.textMuted,
        fontSize: 12,
        background: palette.bgInset,
      }}
    >
      {hint ?? "תוכן בשלב בחירה — תיכף נחליט אילו גרפים נכנסים פה."}
    </div>
  );
}

function GraphIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <circle cx="3" cy="3" r="2" fill={palette.queraPurpleGlow} />
      <circle cx="13" cy="3" r="2" fill={palette.queraPurpleGlow} />
      <circle cx="8" cy="13" r="2" fill={palette.queraPurpleGlow} />
      <line x1="3" y1="3" x2="13" y2="3" stroke={palette.queraPurpleGlow} strokeWidth="1.2" />
      <line x1="3" y1="3" x2="8" y2="13" stroke={palette.queraPurpleGlow} strokeWidth="1.2" />
      <line x1="13" y1="3" x2="8" y2="13" stroke={palette.queraPurpleGlow} strokeWidth="1.2" />
    </svg>
  );
}

const buttonStyle: React.CSSProperties = {
  display: "inline-flex",
  alignItems: "center",
  padding: "7px 14px",
  borderRadius: 8,
  border: `1px solid ${palette.queraPurpleSoft}`,
  background: "transparent",
  color: palette.textPrimary,
  fontSize: 12.5,
  fontWeight: 600,
  cursor: "pointer",
  transition: "all 140ms ease",
};
