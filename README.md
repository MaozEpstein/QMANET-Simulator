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
