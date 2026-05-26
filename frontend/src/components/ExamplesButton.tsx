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

import { useCallback, useEffect, useMemo, useState } from "react";
import { api } from "../api/rest";
import {
  buildBarabasiAlbertExample,
  buildBernienChain9Example,
  buildC4Example,
  buildC7HardExample,
  buildDenseManetExample,
  buildErdosRenyiExample,
  buildGrotzschExample,
  buildHeawoodExample,
  buildK33Example,
  buildK5Example,
  buildKings3x3Example,
  buildKings4x4Example,
  buildManetRGG12Example,
  buildMobiusKantorExample,
  buildPathP8Example,
  buildPetersenExample,
  buildQ3Example,
  buildRandomMessyExample,
  buildSparseDisconnectedManetExample,
  buildTriangularPrismExample,
  buildTuran93Example,
  buildTwoTrianglesExample,
  buildUrbanClustersExample,
} from "../lib/examples";
import {
  deleteSaved,
  exportJSON,
  listSaved,
  type SavedGraph,
} from "../lib/savedGraphs";
import { usePipeline } from "../store/pipeline";
import { palette } from "../theme/palette";

type CategoryId = "myGraphs" | "starter" | "topology" | "paper" | "chaotic" | "stress";

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
  saved?: SavedGraph;      // present only for entries loaded from localStorage
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
    id: "chaotic",
    title: "לא סימטרי",
    subtitle: "גרפים אקראיים — בנצ'מרק הוגן ללא סימטריה",
  },
  {
    id: "stress",
    title: "מבחני גבולות",
    subtitle: "גרפים שמראים איפה הסימולציה המקומית נשברת ולמה Phase 7 נדרש",
  },
];

const EXAMPLES: Example[] = [
  {
    id: "c4",
    name: "ריבוע (C₄)",
    englishName: "4-cycle",
    description:
      "4 קודקודים מסודרים על ריבוע, מחוברים סביב הרים בלבד. המשלים: שני האלכסונים בלבד (זיווג מושלם). α(G)=2, MaxClique=2 — הדוגמה הפשוטה ביותר לראות בה את הקשר MIS↔קליק.",
    n: 4,
    category: "starter",
    build: buildC4Example,
  },
  {
    id: "k33",
    name: "דו-צדדי מלא (K₃,₃)",
    englishName: "Complete bipartite K3,3",
    description:
      "שתי שורות של 3 קודקודים, כל קודקוד מחובר לכל הקודקודים בשורה הנגדית (9 קשתות, אפס בתוך השורה). המשלים: שני משולשים נפרדים — אחד לכל שורה. α(G)=3, MaxClique=2. Embedding מתבטא בשני אשכולות אטומים מובחנים.",
    n: 6,
    category: "starter",
    build: buildK33Example,
  },
  {
    id: "tri-prism",
    name: "פריזמה משולשית (מגן דוד)",
    englishName: "Triangular prism · K₃ □ K₂",
    description:
      "6 קודקודים על משושה. הקשתות יוצרות מגן דוד: שני משולשים שזורים + 3 קוטרים. המשלים = מחזור הקסגוני C₆. α(G)=2, MaxClique=3 — הראשון ברשימה עם קליק לא טריוויאלי.",
    n: 6,
    category: "topology",
    build: buildTriangularPrismExample,
  },
  {
    id: "q3",
    name: "קוביה (Q₃)",
    englishName: "3-cube hypercube",
    description:
      "8 קודקודים על קוביה (ריבוע חיצוני + ריבוע פנימי + 4 חיבורים). 3-regular, דו-צדדי. α(G)=4 — לא טריוויאלי לראות בעין: 4 קודקודים בצבע אחד של החלוקה הבי-פרטיסטית הופכים ל-K₄ בולט בגרף המשלים.",
    n: 8,
    category: "topology",
    build: buildQ3Example,
  },
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
  {
    id: "k5",
    name: "K₅ — קליק שלם",
    englishName: "Complete graph K₅",
    description:
      "5 קודקודים, כל הצמדים מחוברים (10 קשתות). ω(G)=5, α(G)=1, המשלים ריק. בדיקת sanity קלאסית: הצינור צריך למצוא קליק בגודל 5.",
    n: 5,
    category: "starter",
    build: buildK5Example,
  },
  {
    id: "path-p8",
    name: "שרשרת P₈",
    englishName: "Path graph P₈",
    description:
      "8 אטומים בשורה ישרה, קשתות בין שכנים בלבד. α=4 (כל קודקוד שני), ω=2. הן SA והן הקוונטי פותרים תוך מילישנייה — baseline 'איך נראית הצלחה' להשוואה מול גרפים קשים יותר.",
    n: 8,
    category: "starter",
    build: buildPathP8Example,
  },
  {
    id: "kings3x3",
    name: "King's 3×3 (Ebadi 2022)",
    englishName: "King's graph 3×3",
    description:
      "הבנצ'מרק הקנוני של Ebadi 2022 §6 ל-MIS על Rydberg array. 9 קודקודים על רשת 3×3, קשתות בין כל זוג שכנים במהלך מלך (8 כיוונים). α(G)=4 (פינות), ω(G)=4 (ריבוע 2×2).",
    n: 9,
    category: "paper",
    paperRef: "Ebadi 2022 §6",
    build: buildKings3x3Example,
  },
  {
    id: "kings4x4",
    name: "King's 4×4 (Ebadi 2022, Fig 4)",
    englishName: "King's graph 4×4",
    description:
      "הרחבת ה-benchmark של Ebadi לרשת 4×4: 16 קודקודים, 42 קשתות, α(G)=4 (פינות), ω(G)=4 (כל 2×2). ⚠ 16 אטומים → Stage 5 (sesolve מלא) ו-Stage 4 spectrum/פאזות לא יעבדו. שאר הצינור כן.",
    n: 16,
    category: "paper",
    paperRef: "Ebadi 2022 §6 (Fig 4)",
    build: buildKings4x4Example,
  },
  {
    id: "bernien-chain-9",
    name: "Bernien 1D chain (N=9)",
    englishName: "Bernien 2017 chain",
    description:
      "הניסוי שפתח את כל תחום ה-Rydberg array dynamics. שרשרת של 9 אטומים, blockade בין שכנים בלבד. עם preset bernien_2017_sweep ב-Stage 4, רואים את התפתחות הפאזה האנטי-פרומגנטית Z₂. α=5, ω=2.",
    n: 9,
    category: "paper",
    paperRef: "Bernien 2017 · Nature 551",
    build: buildBernienChain9Example,
  },
  {
    id: "manet-rgg-12",
    name: "MANET RGG (n=12, R=30)",
    englishName: "Random Geometric Graph",
    description:
      "ההגדרה המוצהרת באבסטרקט הפרויקט: 12 קודקודים פזורים, קשתות = כל זוג במרחק ≤ 30µm. דמוי 'רשת מכשירים אורבנית' עם אזורים צפופים וקודקודים בודדים. α, ω בלתי-טריוויאליים — מחושבים ע״י הצינור.",
    n: 12,
    category: "paper",
    paperRef: "MANET RGG · אבסטרקט הפרויקט",
    build: buildManetRGG12Example,
  },
  {
    id: "manet-urban-clusters",
    name: "MANET עירוני — אשכולות",
    englishName: "Urban-cluster MANET (3 cliques + bridges)",
    description:
      "16 אטומים מחולקים ל-3 אשכולות צפופים (K₅, K₅, K₆) עם 3 גשרים בין-אשכוליים. הטופולוגיה האופיינית של 'רכבים סביב צמתים' או 'חיילים סביב מפקדים'. ω(G)=6, ובדיקה אמיתית האם backbone-קליק עוזר בניתוב יותר מ-CDS קלאסי (Stage 8).",
    n: 16,
    category: "paper",
    paperRef: "MANET — clustered topology",
    build: buildUrbanClustersExample,
  },
  {
    id: "manet-sparse-disconnected",
    name: "MANET דליל ומנותק",
    englishName: "Sparse disconnected MANET",
    description:
      "15 אטומים בפיזור אקראי עם R=22 (קטן) → ה-RGG מתפצל ל-2-3 רכיבים. מבחן ייחודי ל-fallback של Stage 8: יש זוגות (src, dst) שלא ניתן להגיע ביניהם בכלל. צופים `n_via_fallback > 0` או `n_reachable_pairs < n(n-1)`.",
    n: 15,
    category: "paper",
    paperRef: "MANET — connectivity edge case",
    build: buildSparseDisconnectedManetExample,
  },
  {
    id: "manet-dense",
    name: "MANET צפוף",
    englishName: "Dense MANET",
    description:
      "14 אטומים, R=60 (גדול) → ~70% מהזוגות בטווח. ω(G) גבוה, n_max_cliques יוצא ענק, ו-embedding fidelity יורד דרמטית. ה-stress test שמראה איפה החומרה ה-UDG נכשלת מול logical graph דחוס.",
    n: 14,
    category: "paper",
    paperRef: "MANET — high-density edge case",
    build: buildDenseManetExample,
  },
  {
    id: "turan-9-3",
    name: "Turán T(9,3)",
    englishName: "Turán T(9,3) · K_{3,3,3}",
    description:
      "ה-extremal graph של תורת Turán: 3 חלוקות של 3 קודקודים, 27 קשתות בין-חלוקתיות בלבד. ω(G)=3 (אחד מכל חלוקה), α(G)=3 (חלוקה שלמה). המשלים = 3K₃ — שלושה משולשים נפרדים.",
    n: 9,
    category: "topology",
    build: buildTuran93Example,
  },
  {
    id: "grotzsch",
    name: "Grötzsch (Mycielski(4))",
    englishName: "Grötzsch graph",
    description:
      "11 קודקודים, triangle-free, אך χ(G)=4 — ההפרדה הקלאסית בין MaxClique לחציצה. ω(G)=2, α(G)=5. בנוי כ-C₅ פנימי + 5 twins + apex.",
    n: 11,
    category: "topology",
    build: buildGrotzschExample,
  },
  {
    id: "heawood",
    name: "Heawood (cage 3,6)",
    englishName: "Heawood graph",
    description:
      "14 קודקודים, 3-regular, ביפרטיט, ה-cage(3,6) הקטן ביותר. ה-incidence graph של מישור Fano. ω(G)=2, α(G)=7. ⚠ Stage 5 איטי בגלל גודל הגרף.",
    n: 14,
    category: "topology",
    build: buildHeawoodExample,
  },
  {
    id: "c7-hard",
    name: "C₇ — מחזור אי-זוגי קשה",
    englishName: "7-cycle (odd, hardness demo)",
    description:
      "7 קודקודים על מחומש (heptagon). אי-זוגי → אין כיסוי דו-צבעי מושלם. α=3, ω=2. HP ≈ 0.67 (14 IS בגודל 2 לעומת 7 בגודל 3) → מקרה אופייני שבו R הקוונטי יורד מתחת ל-1.0. מומלץ ל-benchmarking הוגן.",
    n: 7,
    category: "stress",
    paperRef: "Ebadi 2022 §5 · hardness",
    build: buildC7HardExample,
  },
  {
    id: "mobius-kantor",
    name: "Möbius-Kantor GP(8,3)",
    englishName: "Möbius–Kantor graph",
    description:
      "16 קודקודים, 3-regular, ביפרטיט, vertex-transitive. שני אוקטוגונים קונצנטריים עם spokes; הפנימי עם chord(+3). מ-Foster census. ω(G)=2, α(G)=8. ⚠ גדול לסימולציה מלאה — Stage 5 לא יסיים בזמן סביר.",
    n: 16,
    category: "topology",
    build: buildMobiusKantorExample,
  },
  {
    id: "erdos-renyi-11",
    name: "Erdős–Rényi G(11, 0.4)",
    englishName: "Erdős–Rényi random graph",
    description:
      "גרף אקראי קלאסי: 11 קודקודים, כל זוג מקבל קשת בהסתברות 0.4 (seed=2026). הסטנדרט בכל מאמר באופטימיזציה — אין סימטריה, אין מבנה. השוואה הוגנת R(quantum) מול R(SA) על משפחת G(n, p) היא הגרף המרכזי בדוח הסיום.",
    n: 11,
    category: "chaotic",
    paperRef: "Erdős–Rényi G(n, p)",
    build: buildErdosRenyiExample,
  },
  {
    id: "random-messy-12",
    name: "פיזור אקראי במישור (n=12)",
    englishName: "Random scatter MANET",
    description:
      "12 אטומים בפיזור אקראי על 200×100, קשתות לפי כלל RGG עם R=40 (seed=7). 'בלגן אמיתי' שדומה ל-MANET-snapshot חי — אבל reproducible בזכות seed קבוע.",
    n: 12,
    category: "chaotic",
    build: buildRandomMessyExample,
  },
  {
    id: "barabasi-albert-12",
    name: "Barabási–Albert (n=12, m=2)",
    englishName: "Preferential attachment",
    description:
      "רשת scale-free עם hubs: מתחילים מ-K₃, כל קודקוד חדש מתחבר ל-2 קודקודים בסבירות יחסית לדרגה (seed=99). מודלים MANET של hub-and-spoke — חיילים סביב מפקדים, רכבים סביב צמתים. תפלגות דרגות עם זנב כבד.",
    n: 12,
    category: "chaotic",
    paperRef: "Barabási & Albert, Science 286 (1999)",
    build: buildBarabasiAlbertExample,
  },
  {
    id: "two-triangles",
    name: "שני משולשים מנותקים",
    englishName: "Two disjoint K₃",
    description:
      "6 קודקודים, שני K₃ ללא קשרים ביניהם. regression test לקצה non-connectivity: Stage 8 חייב לדווח שזוגות בין הרכיבים אינם נגישים (hops=0), ושאר הצינור חייב להמשיך לעבוד.",
    n: 6,
    category: "stress",
    build: buildTwoTrianglesExample,
  },
];

export function ExamplesButton() {
  const [open, setOpen] = useState(false);
  const [loadingStep, setLoadingStep] = useState<LoadingStep>(null);
  const [loadingId, setLoadingId] = useState<string | null>(null);
  const [loadErr, setLoadErr] = useState<string | null>(null);
  const [savedTick, setSavedTick] = useState(0);
  const refreshSaved = useCallback(() => setSavedTick((t) => t + 1), []);
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

  const savedGraphs = useMemo<SavedGraph[]>(() => {
    if (!open) return [];
    // savedTick is referenced so the list re-reads when we mutate localStorage.
    void savedTick;
    return listSaved();
  }, [open, savedTick]);

  const savedAsExamples = useMemo<Example[]>(
    () =>
      savedGraphs.map((g) => ({
        id: `saved:${g.id}`,
        name: g.name,
        description: g.description || "גרף שיצרת בעורך.",
        n: g.payload.graph.n_nodes,
        category: "myGraphs",
        build: () => g.payload,
        saved: g,
      })),
    [savedGraphs],
  );

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

  const handleDeleteSaved = useCallback(
    (saved: SavedGraph) => {
      if (!window.confirm(`למחוק את "${saved.name}"?`)) return;
      deleteSaved(saved.id);
      refreshSaved();
    },
    [refreshSaved],
  );

  const handleExportSaved = useCallback((saved: SavedGraph) => {
    const text = exportJSON(saved.id);
    const slug =
      saved.name.replace(/[^\w֐-׿.-]+/g, "_").slice(0, 40) || "graph";
    const blob = new Blob([text], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${slug}.qsim.json`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }, []);

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
                alignItems: "center",
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
                  בחירה מהירה של דאטהסט קלאסי כדי לראות את הצינור בפעולה. ליצירה ידנית — חזרה לשלב 1.
                </div>
              </div>
              <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
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
              </div>
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
                  const items =
                    cat.id === "myGraphs"
                      ? savedAsExamples
                      : EXAMPLES.filter((e) => e.category === cat.id);
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
                              onDelete={ex.saved ? () => handleDeleteSaved(ex.saved!) : undefined}
                              onExport={ex.saved ? () => handleExportSaved(ex.saved!) : undefined}
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
  onDelete,
  onExport,
  loading,
  disabled,
}: {
  example: Example;
  onLoad: (ex: Example) => void;
  onDelete?: () => void;
  onExport?: () => void;
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
      <div style={{ display: "flex", gap: 6, marginTop: 4, flexWrap: "wrap" }}>
        <button
          disabled={soon || disabled || isLoading}
          onClick={() => onLoad(example)}
          style={{
            padding: "6px 12px",
            background: soon || disabled ? "transparent" : palette.queraPurple,
            color: soon || disabled ? palette.textMuted : "#fff",
            border: soon || disabled ? `1px dashed ${palette.queraPurpleSoft}` : "none",
            borderRadius: 6,
            fontSize: 12,
            fontWeight: 600,
            cursor: soon || disabled || isLoading ? "not-allowed" : "pointer",
            opacity: disabled ? 0.5 : 1,
          }}
        >
          {soon ? "תיכף" : isLoading ? "טוען…" : "טען"}
        </button>
        {onExport && (
          <button
            onClick={onExport}
            disabled={isLoading}
            title="ייצא קובץ JSON"
            style={cardSecondaryBtn(isLoading)}
          >
            ⤓ ייצא
          </button>
        )}
        {onDelete && (
          <button
            onClick={onDelete}
            disabled={isLoading}
            title="מחק את הגרף הזה"
            style={{ ...cardSecondaryBtn(isLoading), color: palette.err, borderColor: palette.err }}
          >
            🗑 מחק
          </button>
        )}
      </div>
    </div>
  );
}

function cardSecondaryBtn(isLoading: boolean): React.CSSProperties {
  return {
    padding: "6px 10px",
    background: "transparent",
    color: palette.textSecondary,
    border: `1px solid ${palette.queraPurpleSoft}`,
    borderRadius: 6,
    fontSize: 11.5,
    fontWeight: 600,
    cursor: isLoading ? "not-allowed" : "pointer",
    opacity: isLoading ? 0.5 : 1,
  };
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

