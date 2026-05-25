# Qsimulator

סימולטור Web לפרויקט **Quantum Routing for MANETs via Adiabatic Clique Finding on Neutral Atom Arrays**. צוות: Maoz Epstein, Ori Kessous · מנחה: Adi Pick PhD · קורס 83519.

תוכנית הבנייה המלאה (8 שלבים): `~/.claude/plans/declarative-dancing-brook.md`.

## הסטטוס הנוכחי — Phase 7 (Amazon Braket bridge)

- ✅ Phase 0 — Bootstrap (`aquila/constants.py`, FastAPI, React+TS+Vite)
- ✅ Phase 1 — MANET → גרף → complement → MIS (`/api/manet/generate`, `/api/graph/complement`)
- ✅ Phase 2 — Atom embedding + validator (`/api/embed/atoms`)
- ✅ Phase 3 — Pulse scheduler + Hamiltonian + Stage 4
- ✅ Phase 4 — Time evolution (QuTiP) + WebSocket streaming + Stage 5
- ✅ Phase 5 — Measurement + greedy post-processing + classical SA + Stages 6-7
- ✅ Phase 6 — MANET routing דרך ה-backbone clique + Stage 8
- ✅ Phase 7 — Amazon Braket bridge (`/api/braket/payload`, `/api/braket/submit`, `BraketPanel`) — payload עובר IR-validation, dry-run מול `LocalSimulator("braket_ahs")` עם KL < 0.05
- ✅ Phase 8 — Polish (E2E, error boundaries, JSON export, reproduce_paper)

## הרצה

### Backend

```powershell
cd backend
python -m venv .venv
.\.venv\Scripts\Activate.ps1
pip install -e .[dev]
pip install -e .[braket]                  # אופציונלי — Phase 7 (amazon-braket-sdk + boto3)
pytest                                    # מריץ את כל ה-suite
uvicorn api.server:app --reload --port 8000
```

פתח: <http://localhost:8000/api/aquila> → אמור להחזיר JSON עם פרמטרים של Aquila.

### Frontend

```powershell
cd frontend
npm install
npm run dev
```

פתח: <http://localhost:5173> → אמור להציג את ה-stage stepper של 8 השלבים ולוח hardware spec.

## מבנה

```
Qsimulator/
├─ backend/        FastAPI + Bloqade-python + QuTiP
│  ├─ aquila/      Hardware constants, validator, Hamiltonian, noise (constants.py קיים)
│  ├─ pipeline/    MANET, complement, embedding, schedule, simulate, postprocess
│  ├─ api/         FastAPI server + WebSocket
│  └─ tests/       cross-checks מול QuTiP ו-rep' של Ebadi2022
├─ frontend/       React + TS + Three.js + D3 + KaTeX
│  └─ src/
│     ├─ stages/   8 השלבים של ה-pipeline (סקאפולד קיים, מימוש מלא ב-Phase 1+)
│     ├─ components/  AtomArray3D, GraphView, PulsePlot, HamiltonianTeX, ...
│     ├─ store/    Zustand state
│     └─ theme/    publication-quality palette
├─ shared/         JSON schemas (Pydantic → TS types)
└─ docs/           reproduce_paper.md (Phase 8)
```

## Roadmap — Phase 9: per-example smart tuning

הברירות מחדל הנוכחיות (`paper_linear_ramp`, `Ω=15`, `Δ∈[-30,+40]`, spacing 5µm) נכונות עבור ה-King-graph של Ebadi 2022 §6.1, אבל **לא מתאימות לכל גרף**. עבור פטרסן, למשל, `|Δ_max| = 40 << V ≈ 347 rad/µs` במרחק 5µm — אנחנו פשוט לא מגיעים למשטר שבו ה-MIS-Hamiltonian באמת מועדף אנרגטית. זה לא באג; זה ברירת מחדל שגויה לפיזיקה.

המהלך הבא הוא **tuning per-example בשלוש שכבות**:

### שכבה 1 — invariants ידועים מראש

לכל דוגמה נחבר ערכים אנליטיים:
```ts
interface ExampleInvariants {
  alpha: number;            // α(G)
  omega: number;            // ω(G) = MaxClique
  family: "chain" | "cycle" | "complete" | "bipartite" | "star" | "regular" | "rgg" | "frustrated";
  is_unit_disk: boolean;
}
```

### שכבה 2 — preset לפי family

| Family | spacing | preset | T (µs) | Δ range | היגיון |
|---|---:|---|---:|---|---|
| chain / cycle | 6 µm | `bernien_2017_sweep` | 3 | ±25 | Bernien 2017 מותאם ל-1D, Z₂ phase transition נצפה ב-T~3µs |
| complete K_n | 4 µm | `paper_linear_ramp` | 2 | ±50 | רוצים את כל האטומים ב-blockade. spacing מינימלי + T קצר |
| bipartite K_m,n | 5 µm | `paper_linear_ramp` | 4 | ±50 | spacing סטנדרטי, gap מספיק לקפיצה לצד הגדול |
| star | custom | `paper_linear_ramp` | 3 | ±60 | מרכז + leaves על מעגל; geometry לא lattice |
| 3-regular (Petersen) | 5 µm | `paper_linear_ramp` | **6** | **±100** | gap בינוני, T ארוך יותר ו-Δ range רחב יותר |
| rgg / dense | 5 µm | `paper_linear_ramp` | 6-10 | ±150 | תלוי density |
| frustrated (MIS-hard) | 5 µm | `paper_linear_ramp` | **15** | **±200** | gap קטן ⇒ adiabatic theorem דורש T גדול |

הכלל החשוב: `|Δ_max|` חייב להיות **גדול מ-V** (interaction בין שכנים, ~C₆/R⁶). אחרת ה-Hamiltonian לא נכנס למשטר ה-MIS-favorable.

### שכבה 3 — self-diagnostic ב-UI

ב-Stage 7 יוצג alarm כאשר `quantum_best_mIS < expected_alpha`:

```
expected α(G)        : 4   (אנליטי)
quantum best mIS    : 3   ← לא מצא את האופטימום
classical SA       : 4   ← מצא
embedding fidelity : 0.78 ← זה החשוד! המבנה לא שוחזר טוב
```

זה הופך כל דוגמה ל-**טסט אינטגרציה פיזיקלי** — לא רק "הצינור רץ" אלא "הצינור מצא את התשובה הנכונה". זה גם מאפשר לכל backend עתידי (Bloqade-MPS, Aquila דרך Braket) לעבור את אותו set של דוגמות ולוודא שהוא משחזר את התוצאות הצפויות.

### יישום מדורג

1. **מינימלי (יום)**: שדה `tuning` ב-`Example`. ערכים ספציפיים לכל דוגמה הקיימת (התחל מ-Petersen: `T=6, Δ_max=100`).
2. **המלצה (יומיים)**: הרחב את `paper_linear_ramp` ב-[backend/pipeline/schedule.py](backend/pipeline/schedule.py) לקבל `duration` ו-`delta_max` כפרמטרים. אם `bernien_2017_sweep` לא קיים — להוסיף.
3. **self-diagnostic (יום)**: banner ב-[Stage7_PostProcess.tsx](frontend/src/stages/Stage7_PostProcess.tsx) שמשווה `expected_alpha` ל-`batch.summary.best_final_size`.
4. **auto-tune (שבוע, אופציונלי)**: היוריסטיקה שבוחרת preset לפי `max_degree`, `density`, ו-`gap estimate` עבור גרפים שהמשתמש בונה ידנית.

### למה זה קריטי

- בלי tuning חכם, הסימולטור הוא demo כללי שלא מאמת את הפיזיקה.
- עם self-diagnostic, **כל דוגמה הופכת ל-טסט יחידה** שעובד או נכשל לפי קריטריון פיזיקלי ברור.
- בדוח האקדמי תוכל לכתוב: *"פתרנו את MIS עבור 14 גרפים classical, 12 מהם תואמים לערך α(G) האנליטי"*. זה משפט נמדד.

## מקורות

- **Aquila whitepaper** (QuEra, v1.0 June 2023) — `Aquila.pdf` שורש הרפו. כל מספר במערכת ניתן להצדיק מהמסמך הזה.
- **Ebadi2022** *Quantum optimization of maximum independent set using Rydberg atom arrays*, Science 376, 1209–1215. יעד הרפרודוקציה ב-Phase 8.
- **Bernien2017** *Probing many-body dynamics on a 51-atom quantum simulator*, Nature 551, 579–584. יעד reproduce ל-Z₂ correlation length ב-Phase 4.
- **Bloqade**: <https://bloqade.quera.com/latest/>

## קונבנציות יחידות

| במערכת | יחידה |
|---|---|
| מיקום | µm |
| תדירות / Rabi / detuning | rad/µs |
| זמן | µs |
| המרה ל-Braket | × 10⁶ (rad/s, m) |
