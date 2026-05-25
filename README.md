# Qsimulator

> **Quantum Routing for MANETs via Adiabatic Clique Finding on Neutral Atom Arrays**
> Course 83519 · Maoz Epstein · Ori Kessous · Advisor: Adi Pick PhD

סימולטור ויזואלי מקצה-לקצה שמדגים איך **חישוב קוונטי אדיאבטי** על מערכי אטומים ניטרליים (QuEra Aquila) פותר את **בעיית ניתוב ה-MANET** דרך **חיפוש קליק** → **MIS על הגרף המשלים** → **Rydberg blockade**. בנוי כ-Web app אינטראקטיבי עם backend Python (FastAPI + QuTiP + Bloqade) ו-frontend TypeScript (React + D3 + Three.js).

---

## ⚡ הסיפור בשורה אחת

1. בנה רשת MANET (Stage 1) → 2. הצינור מחשב את הגרף המשלים (Stage 2) → 3. ממקם אטומים על Aquila (Stage 3) → 4. מתכנן פולס אדיאבטי (Stage 4) → 5. מריץ סימולציה קוונטית (Stage 5) → 6. דוגם מדידות (Stage 6) → 7. מתקן ומשווה ל-SA קלאסי (Stage 7) → 8. מנתב חבילות דרך ה-backbone (Stage 8).

הכל אינטראקטיבי, הכל ויזואלי, הכל ניתן ל-export.

---

## 🎯 פיצ'רים מרכזיים

### בניית גרף
- 🖱️ **עורך אינטראקטיבי** עם 4 כלים: הוסף קודקוד / הוסף קשת / הזז / מחק. קיצורי מקלדת **E** / **W** / **D**.
- 📐 **8 תבניות מובנות**: טבעת, גלגל, כוכב, שרשרת, K_n, רשת ריבועית, רשת משולשית, פרח משושים.
- 🔲 **5 סוגי רשת רקע**: ללא / ריבועית / עגולה / משולשית / משושית — עם הצמדה (snap) לקווים ולצמתים.
- ↶ **Undo עם Ctrl+Z** (תומך גם בפריסת מקלדת עברית).
- 💾 **שמירה אוטומטית** — רענון הדף לא מוחק את הגרף שלך.
- 📥 **ייבוא/ייצוא JSON** של גרפים שמורים.

### 15 דוגמות שמורות מהספרות
| קטגוריה | דוגמות |
|---|---|
| **התחלה** | C₄, K₃,₃, K₅, Petersen |
| **טופולוגיות קלאסיות** | Q₃ (קוביה), פריזמה משולשית (מגן דוד), Turán T(9,3), Grötzsch, Heawood, Möbius–Kantor |
| **מאמרים** | King's 3×3, King's 4×4 (Ebadi 2022), Bernien 1D chain (Nature 2017), MANET RGG n=12 |
| **מבחני גבולות** | C₇ — מחזור אי-זוגי קשה (HP ≈ 0.67) |

### אנליזה קוונטית מתקדמת
- 📊 **Spectrum plot** — k הע"ע הנמוכים של H(t) לאורך הפולס. ה-avoided crossing מסומן ב-✦.
- 📐 **Phase diagram (Ω, Δ)** — heatmap של ⟨Σn̂⟩ במצב היסוד. רואים את הפאזות (no-Rydberg / Z₂ / MIS / fully excited).
- ⚡ **Min adiabatic gap δ_min** — חישוב הפער המינימלי + T מומלץ לפי `T ≳ 1/δ_min²`.
- 🎯 **Approximation Ratio R** — המטריקה הקנונית של Ebadi 2022 להשוואה quantum ↔ classical SA.
- 🔬 **Smooth Blackman preset** + Linear ramp — שני פרוטוקולי schedule.

### בנצ'מרק וזיהוי
- 🧮 **Classical Simulated Annealing** baseline עם penalty אוטומטי (Lucas 2014 §2.3).
- ✅ **Aquila constraint validator** — Ω/Δ bounds, slew rates, lattice spacing, duration.
- ☁️ **Amazon Braket bridge** — בונה payload AHS אמיתי, מציג עלות (~$1.30 ל-100 shots) ו-runtime, ושולח לחומרת QuEra (dry-run בלי credentials).

---

## 🚶 סיור בצינור — 8 שלבים

### Stage 1 · MANET — בניית גרף
**מה מציגים:** עורך גרף אינטראקטיבי על קנבס 200×100 µm. אטומים = מכשירי MANET, קשתות = זוגות בטווח תקשורת. אפשר לבנות מאפס, לטעון תבנית, או לטעון דוגמה שמורה.

**מה רץ ברקע:** ה-graph state הולך ישירות לצינור Zustand. כל שינוי מעדכן downstream ומאפס שלבים 2–5.

**Stats מוצגים:** N (קודקודים), E (קשתות), דרגה ממוצעת, צפיפות.

### Stage 2 · Complement — קליק ↔ MIS
**הזהות המרכזית:** `S קליק ב-G ⇔ S קבוצה בלתי-תלויה ב-Ḡ`. לכן `ω(G) = α(Ḡ)`. השלב הזה ממיר את בעיית חיפוש הקליק שלנו לבעיית MIS — בדיוק מה ש-Rydberg blockade פותר באופן טבעי.

**מה מציגים:** שני פאנלים זה לצד זה — G המקורי מימין, Ḡ המשלים משמאל. **שניהם באותם מיקומים גיאומטריים** כדי לראות מיד אילו זוגות התהפכו. הקליק המקסימלי מואר בסגול.

**API:** `POST /api/graph/complement` — מחזיר את הגרף המשלים + הקליק/MIS המדויק (networkx Bron-Kerbosch עד 28 קודקודים).

### Stage 3 · Embedding — השמת אטומים על Aquila
**מה רץ:** force-directed layout של ה-graph המשלים, snapping לרשת לפי `lattice_spacing_um = 6.5` (נבחר כדי שאלכסונים יישארו מחוץ ל-R_b ≈ 8.79 µm), ו-rescale ל-region של Aquila (75×76 µm).

**Validation:** כל אטום עובר מבחני max_qubits (256), bounds (75×76), min_site_spacing (4 µm), row alignment. הפרות מוצגות כ-ConstraintBadge.

**Metrics:** embedding_fidelity (Jaccard בין induced edges ל-target edges), missing/spurious edges, R_b שמופיע מסביב לכל אטום.

### Stage 4 · Pulse Schedule — פולס אדיאבטי
**ההמילטוניאן:**
```
H(t) = Σᵢ (ℏΩ(t)/2)·σˣᵢ − Σᵢ ℏΔ(t)·n̂ᵢ + Σᵢ<ⱼ V_ij·n̂ᵢn̂ⱼ
                       (drive)         (detuning)        (Rydberg blockade)
```
עם `V_ij = C₆ / |rᵢ − rⱼ|⁶` ו-`C₆ = 5,420,503 rad/µs·µm⁶` (Bloqade default).

**Schedule presets:**
- `paper_linear_ramp` — Trapezoidal Ω + linear Δ sweep (Ebadi 2022 §6.1).
- `paper_smooth_blackman` — Blackman-window Ω + linear Δ. עומד בדרישת המפרט ל-Ω(0)=Ω(T)=0 עם derivative חלק (Aquila §1.2 דורש).

**אנליזה — שלוש כפתורים:**
- **↻ חשב δ_min** — דוגם את הפער הספקטרלי לאורך הזמן. מציג `δ_min`, `t @ δ_min`, ו-`T מומלץ` (אזהרה אם T קצר מדי).
- **📊 ספקטרום** — מצייר k=4 הע"ע הנמוכים כפונקציות של t. רואים את ה-avoided crossing בעין.
- **↻ חשב מפת פאזות** — heatmap של ⟨Σn̂⟩ ב-(Ω, Δ) space. אזורי הצבע = פאזות (Z₂, MIS, fully excited).

**Validation:** Ω ≤ 15.8, |Δ| ≤ 125, |dΩ/dt| ≤ 250, |dΔ/dt| ≤ 2500, duration ≤ 4 µs.

### Stage 5 · Evolution — סימולציה קוונטית
**מה רץ:** QuTiP `sesolve` על ה-Hamiltonian הזמן-תלוי. 120 frames של אבולוציה זורמים דרך WebSocket בזמן אמת.

**Live plot:** ⟨n̂ᵢ(t)⟩ לכל אטום — רואים את האטומים "נדלקים" אחד-אחד לקראת מצב ה-MIS.

**Frame scrubbing:** הזז את הסמן על ציר הזמן כדי לראות את מצב המערכת ברגע מסוים.

**גודל:** עד ~12 אטומים בזמן סביר. גרפים גדולים יותר (Heawood 14, King's 4×4 16, Möbius-Kantor 16) דורשים חומרה אמיתית.

### Stage 6 · Measurement — דגימה
**מה רץ:** דוגם 200 bitstrings מההתפלגות הסופית `p(b) = |⟨b|ψ(T)⟩|²`. עם רעש (Aquila noise model), אטום ב-|r⟩ יכול להימדד כ-|g⟩ (8% false negative) ולהפך.

**Histogram:** bitstrings מודרגים לפי תדירות, עם הצללה לפי משקל הסיבית (גודל ה-IS).

### Stage 7 · Post-process + השוואה ל-SA
**Hero panel — Approximation Ratio:**
```
┌─────────────────┐ ┌─────────────────┐ ┌─────────────────┐ ┌─────────────────┐
│ Quantum best R  │ │ Quantum mean R  │ │ Classical SA R  │ │ Target |MIS*|   │
│      1.000      │ │      0.952      │ │      1.000      │ │       3         │
│  best size = 3  │ │ ⟨size⟩ = 2.85  │ │ size=3 · pen=4 │ │ exact (networkx)│
└─────────────────┘ └─────────────────┘ └─────────────────┘ └─────────────────┘
"הקוונטי השיג 100.0% מהאופטימום (best), ממוצע 95.2%; ה-SA הקלסי השיג 100.0%."
```

מסגרת ירוקה ≥0.95, צהובה ≥0.8, אדומה <0.8.

**Post-processing pipeline:** raw bitstring → greedy fix (להסיר violations) → extension (להוסיף קודקודים שלא יוצרים violations) → mIS תקין.

**Animation:** raw → fixed → final, מתחלף אוטומטית כל 1.5s.

**SA baseline:** Simulated Annealing קלאסי עם `penalty = max(2, max_degree)` (Lucas 2014). שני האלגוריתמים פותרים אותו exact problem על אותו הגרף.

### Stage 8 · Routing — חזרה ל-MANET
**הרעיון:** הקליק שמצאנו הוא ה-backbone של הרשת. ניתוב בין כל זוג מקורות/יעדים מתבצע דרך ה-backbone.

**מה מציגים:** טבלת routes (src → dst, path, hops, via). היסטוגרמה של hops לפי הסוג (direct / backbone / fallback).

**Metrics:** coverage_fraction (איזה אחוז מהרשת ה-backbone משרת), mean_hops, comparison של "via backbone" vs "via fallback (BFS)".

---

## 🚀 הרצה

### Backend (Python 3.10–3.12)
```powershell
cd backend
python -m venv .venv
.\.venv\Scripts\Activate.ps1
pip install -e .[dev]
pip install -e .[braket]                  # אופציונלי — Phase 7 (amazon-braket-sdk + boto3)
pytest                                     # 551 טסטים
uvicorn api.server:app --reload --port 8000
```
פתח [http://localhost:8000/api/aquila](http://localhost:8000/api/aquila) → JSON עם פרמטרי Aquila.

### Frontend (Node 18+)
```powershell
cd frontend
npm install
npm test                                   # 181 טסטים
npm run dev
```
פתח [http://localhost:5173](http://localhost:5173) → ה-stage stepper של 8 השלבים.

---

## 🏗️ מבנה הפרויקט

```
Qsimulator/
├─ backend/                          FastAPI + QuTiP + Bloqade
│  ├─ aquila/
│  │  ├─ constants.py                Hardware constants (C₆ = 5,420,503, Ω≤15.8, ...)
│  │  ├─ hamiltonian.py              Time-independent Rydberg H builder
│  │  ├─ validator.py                Position/pulse constraint checker
│  │  └─ braket_adapter.py           AHS payload + cost estimate + submit
│  ├─ pipeline/
│  │  ├─ manet.py                    RGG generator
│  │  ├─ clique_to_mis.py            MaxClique ↔ MIS(complement) reduction
│  │  ├─ embedding.py                Force-layout + Aquila snap
│  │  ├─ schedule.py                 paper_linear_ramp + paper_smooth_blackman
│  │  ├─ simulate.py                 QuTiP sesolve wrapper
│  │  ├─ measurement.py              Noisy sampling
│  │  ├─ postprocess.py              Greedy fix + extension + R-ratio
│  │  ├─ classical_sa.py             SA baseline with degree-aware penalty
│  │  ├─ adiabatic_gap.py            Min-gap + spectrum analyzers
│  │  ├─ phase_diagram.py            (Ω, Δ) ground-state heatmap
│  │  └─ routing.py                  Backbone routing + BFS fallback
│  ├─ api/server.py                  20 endpoints
│  └─ tests/                         551 pytest cases, incl. Ebadi/Bernien reproduction
├─ frontend/
│  └─ src/
│     ├─ stages/                     Stage1_MANET, ... Stage8_Routing
│     ├─ components/                 GraphEditor (4 tools), GraphView, AtomArray2D,
│     │                              PulsePlot, SpectrumPlot, PhaseDiagram2D,
│     │                              EvolutionPlot, BitstringHistogram, BraketPanel
│     ├─ lib/                        examples.ts (15 graphs), savedGraphs, gridGeometry
│     ├─ store/pipeline.ts           Zustand store with persist middleware
│     └─ theme/palette.ts            QuEra-anchored color tokens
├─ shared/                           (Pydantic ↔ TS type drift checks)
├─ docs/reproduce_paper.md           Ebadi 2022 §6.1 step-by-step reproduction
└─ חומרי רקע/                       PDFs של מאמרי המקור
```

---

## ✅ סטטוס — Phase 8 (completed) → "תפעולי מקצה לקצה"

| Phase | תוכן |
|---|---|
| 0 | Bootstrap — constants, FastAPI, React+TS+Vite |
| 1 | MANET → גרף → complement → MIS |
| 2 | Atom embedding + Aquila validator |
| 3 | Pulse scheduler + Hamiltonian + Stage 4 UI |
| 4 | Time evolution (QuTiP) + WebSocket + Stage 5 UI |
| 5 | Measurement + post-processing + SA + Stages 6–7 UI |
| 6 | MANET routing via backbone clique + Stage 8 UI |
| 7 | Amazon Braket bridge + BraketPanel |
| 8 | E2E tests, error boundaries, JSON export, reproduce_paper.md |
| **+** | **Round 3** — spectrum plot, phase diagram, 15 paper-anchored examples, Stage 7 hero redesign, persistence, smooth Blackman, Δ-slew validation, undo |

---

## 📚 מקורות

| מקור | רלוונטיות |
|---|---|
| **Aquila whitepaper v1.0** (QuEra, June 2023) | מקור כל הקבועים החומריים. ב-`חומרי רקע/Aquila.pdf`. |
| **Ebadi 2022** — *Quantum Optimization of MIS Using Rydberg Atom Arrays*, Science 376 | יעד הרפרודוקציה. King's graph benchmark, R-ratio metric, hardness parameter. |
| **Bernien 2017** — *Probing Many-Body Dynamics on a 51-Atom Quantum Simulator*, Nature 551 | הניסוי המכונן של Rydberg array dynamics. Z₂ phase preparation. |
| **Pichler 2018** — *Quantum Optimization for MIS using Rydberg Atom Arrays*, arXiv:1808.10816 | הבסיס התיאורטי לפרוטוקול האדיאבטי. |
| **Lucas 2014** — *Ising Formulations of Many NP Problems*, Front. Phys. | פרמטר ה-penalty ל-SA + הזיהוי MaxClique ↔ MIS. |
| **Nguyen 2023** — *Quantum Optimization with Arbitrary Connectivity*, PRX Quantum 4 | גדגטי encoding לגרפים שאינם UDG (חוץ מסקופ). |
| **Bloqade** — [bloqade.quera.com](https://bloqade.quera.com/latest/) | תיעוד QuEra ל-AHS וקבועי C₆. |

---

## 📐 קונבנציות יחידות

| במערכת | יחידה | המרה ל-Braket |
|---|---|---|
| מיקום | µm | × 10⁻⁶ (m) |
| תדירות / Ω / Δ | rad/µs | × 10⁶ (rad/s) |
| זמן | µs | × 10⁻⁶ (s) |
| C₆ | rad/µs·µm⁶ | 2π × (MHz·µm⁶) |

---

## ✨ Credits

צוות: **Maoz Epstein**, **Ori Kessous** · מנחה: **Adi Pick PhD** · קורס 83519, האוניברסיטה העברית.
ארכיטקטורה, מימוש, וכתיבת קוד: Maoz + Ori, בליווי Claude (Anthropic) כ-pair programmer.
