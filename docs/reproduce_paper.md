# רפרודוקציה — Ebadi 2022 §6.1 / Aquila whitepaper §6

מסמך זה מסביר איך להפעיל את הסימולטור כדי לשחזר את המתודולוגיה של *Quantum optimization of maximum independent set using Rydberg atom arrays* (Ebadi et al., Science 376, 1209-1215, 2022), שמופיעה גם ב-Aquila whitepaper §6.

## הפרוטוקול שאנו משחזרים

- **גרף מטרה**: גרף יחידות-דיסק על סריג של King (חיבורי שכן עד אלכסון), עם נשירה אקראית של 30% מהקודקודים.
- **lattice spacing**: 5 µm
- **R_b** (Rydberg blockade radius): מחושב מ-`(C₆/√(Ω²+Δ²))^(1/6)` ≈ 8.7 µm ב-Ω=15
- **פולס אדיאבטי לינארי** (`paper_linear_ramp`):
  - Ω(t): טראפז, מגיע ל-15 rad/µs בפלטו
  - Δ(t): סריקה לינארית מ-30 ל-+40 rad/µs
  - φ(t) ≡ 0
  - משך כולל: 4 µs
- **shots**: 200, עם רעש Aquila (זיהוי + fill)
- **post-processing**: greedy violation fix + greedy mIS extension
- **בנצ׳מרק קלאסי**: simulated annealing

## תוצאות צפויות (paper Fig 6.1)

על גרף King 16×16 עם 30% dropout (183 atoms):
- mean mIS (hybrid quantum + post-processing): **≈ 57.5**
- mean mIS (classical SA): **≈ 58.0**
- best mIS found (כל אחד): **60** (השם המוחלט)

## מגבלת ה-solver שלנו

ה-solver שבחרנו (QuTiP `sesolve` שעוטף את ה-Hamiltonian המפורש שלנו) מסוגל לכ-10 atoms בלבד. אטומים נוספים יצריכו אחד מהבאים:

1. **Bloqade** (אמולטור QuEra עצמו) — חוסך הפעלה על חומרה.
2. **Aquila on Amazon Braket** — חומרה אמיתית; פיתוח של Phase 7 בתוכנית.
3. **MPS / tensor-network solver** — לא ממומש עדיין.

לכן ה-"reproduction mode" שלנו רץ את **המתודולוגיה המלאה** בכל פרמטר זהה ל-§6.1, אבל על גרף קטן (4-8 atoms). זה מספיק כדי לאמת שכל הצינור עובד נכון; ההרצה על גרף מלא תהיה כש-Phase 7 ייפתח אל החומרה.

## הרצה דרך ה-UI

1. הפעל את ה-backend: `cd backend && .\.venv\Scripts\python.exe -m uvicorn api.server:app --port 8000`
2. הפעל את ה-frontend: `cd frontend && npm run dev`
3. פתח <http://localhost:5173>
4. עבור דרך השלבים 1→8. בכל שלב יש כפתור `⤓ Export JSON` שמוריד snapshot של אותו שלב לקובץ עם timestamp — אלה הקבצים שתצרף לדוח.

## הרצה דרך pytest (אוטומטית)

```powershell
cd backend
.\.venv\Scripts\python.exe -m pytest tests/test_e2e_pipeline.py -v
```

חמשת המבחנים הללו מריצים את הצינור המלא עם פרמטרי §6.1:

- `test_full_pipeline_finishes_within_budget` — שמינית-תקציב, < 60 שניות
- `test_reproduce_mode_signatures_match_paper_61_for_small_instance` — מאמת ש-SA וכל ה-postprocessing לכל shot מחזירים IS חוקי, ושהממוצע הקוונטי ≤ α(G)
- `test_pipeline_handles_uncovered_node_gracefully` — בודק שצמתים מבודדים מטופלים נכון
- `test_pipeline_seed_reproducibility_across_stages` — הרצה כפולה עם seed זהה מחזירה תוצאה זהה
- `test_pipeline_quantum_vs_classical_size_correlation` — quantum-best ו-SA-best בטווח ±1 זה מזה

## הרצה תכנותית מ-Python

```python
from fastapi.testclient import TestClient
from api.server import app

c = TestClient(app)

# 1. MANET → 2. Complement (= MIS target)
manet = c.post("/api/manet/generate", json={"n_nodes": 6, "seed": 42}).json()
comp = c.post("/api/graph/complement", json={"graph": manet["graph"]}).json()

# 3. Atom embedding (paper §6.1 settings)
embed = c.post("/api/embed/atoms", json={
    "target_graph": comp["complement"],
    "config": {"lattice_spacing_um": 5.0, "rabi_rad_us": 15.0},
}).json()

# 4. Adiabatic schedule (paper preset)
sched = c.post("/api/schedule/build", json={"preset": "paper_linear_ramp"}).json()

# 5. Simulate (QuTiP backend)
sim = c.post("/api/simulate/run", json={
    "positions": embed["positions"],
    "schedule": sched["schedule"],
    "n_frames": 60,
}).json()

# 6. Measure 200 shots with Aquila noise
meas = c.post("/api/measure", json={
    "bitstring_probs": sim["final_bitstring_probs"],
    "n_shots": 200,
    "apply_noise": True,
    "seed": 1,
}).json()

# 7. Post-process (greedy fix + extension)
pp = c.post("/api/postprocess/batch", json={
    "bitstrings": meas["bitstrings"],
    "target_graph": comp["complement"],
    "seed": 0,
}).json()

# Compare against classical SA + exact MIS
sa = c.post("/api/classical/sa", json={
    "graph": comp["complement"],
    "config": {"n_sweeps": 300, "seed": 1},
}).json()

print(f"exact α(Ḡ)        : {comp['size']}")
print(f"quantum mean mIS  : {pp['summary']['mean_final_size']:.2f}")
print(f"quantum best mIS  : {pp['summary']['best_final_size']}")
print(f"classical SA mIS  : {sa['best_size']}")
```

## הרצה דרך Amazon Braket (Phase 7)

Phase 7 מוסיף שני endpoints שמדמים את הצעדים הנדרשים לשליחת אותה תוכנית לחומרת Aquila דרך AWS Braket — בלי לדרוש חיבור ל-AWS לצורכי הסימולציה.

```powershell
cd backend
pip install -e .[braket]                                    # amazon-braket-sdk + boto3
.\.venv\Scripts\python.exe -m pytest tests/test_braket_dry_run.py -v
```

`test_braket_dry_run.py` בונה את ה-payload דרך `aquila/braket_adapter.py`, מאמת אותו מול pydantic IR של Braket (`braket.ir.ahs.program_v1.Program`), מריץ אותו ב-`LocalSimulator("braket_ahs")` של Braket, ומשווה את התפלגות ה-bitstrings ל-`simulate()` המקומי שלנו ב-KL-divergence < 0.05 — זה ה-DoD של ה-Phase.

מ-Python:

```python
from fastapi.testclient import TestClient
from api.server import app

c = TestClient(app)
body = {
    "positions": embed["positions"],
    "schedule": sched["schedule"],
    "shots": 200,
}

# Dry-run: בונה payload, מחשב עלות + זמן, מריץ preflight check
preview = c.post("/api/braket/payload", json=body).json()
print("payload:", preview["payload"])               # JSON שמתקבל ע"י Braket
print("cost  :", preview["cost_estimate"]["total_usd"])
print("device:", preview["device_arn"])

# הגשה אמיתית (דורש credentials של AWS); ללא SDK/credentials מחזיר submitted=False
submit = c.post("/api/braket/submit", json={**body, "region": "us-east-1"}).json()
print(submit["submitted"], submit["message"])
```

מה-UI: ב-Stage 5 (Evolution) מופיע פאנל **"Run on Aquila"** שמראה את ה-payload עם דגשה אדומה על כל הפרה (ConstraintBadge), הערכת עלות (`$0.30 task + $0.01/shot`) וזמן ריצה משוער. כשאין SDK/credentials, ה-submit מחזיר `submitted=false` עם הסבר ידידותי במקום לקרוס.

## איך לקרוא את התוצאות

- **`mean_final_size`** — הגודל הממוצע של ה-IS שיצא מ-post-processing על כל ה-shots. ב-Ebadi2022 זה ~57.5; אצלנו (על גרף קטן) זה יהיה קרוב ל-α(G) המדויק.
- **`best_final_size`** — ה-IS הכי גדול שראינו ב-200 shots.
- **`coverage_fraction`** — בשלב 8 (Routing): שבר המכשירים שהם או בה-backbone או שכנים שלו. ב-MANET דליל זה < 100% וצריך פרוטוקול fallback.
- **`is_clique` ב-RoutingResponse** — חייב להיות `true`. אם לא, יש באג ב-pipeline (ה-MIS על Ḡ לא תאם לקליק ב-G).

## הקבצים הקריטיים

| תפקיד | קובץ |
|---|---|
| קבועי Aquila | [backend/aquila/constants.py](../backend/aquila/constants.py) |
| Validator | [backend/aquila/validator.py](../backend/aquila/validator.py) |
| Hamiltonian | [backend/aquila/hamiltonian.py](../backend/aquila/hamiltonian.py) |
| Noise model | [backend/aquila/noise.py](../backend/aquila/noise.py) |
| MANET generator | [backend/pipeline/manet.py](../backend/pipeline/manet.py) |
| MIS reduction | [backend/pipeline/clique_to_mis.py](../backend/pipeline/clique_to_mis.py) |
| Atom embedding | [backend/pipeline/embedding.py](../backend/pipeline/embedding.py) |
| Pulse scheduler | [backend/pipeline/schedule.py](../backend/pipeline/schedule.py) |
| Time evolution | [backend/pipeline/simulate.py](../backend/pipeline/simulate.py) |
| Measurement | [backend/pipeline/measurement.py](../backend/pipeline/measurement.py) |
| Post-processing | [backend/pipeline/postprocess.py](../backend/pipeline/postprocess.py) |
| Classical SA | [backend/pipeline/classical_sa.py](../backend/pipeline/classical_sa.py) |
| Routing | [backend/pipeline/routing.py](../backend/pipeline/routing.py) |
| Braket adapter (Phase 7) | [backend/aquila/braket_adapter.py](../backend/aquila/braket_adapter.py) |
| Braket dry-run test | [backend/tests/test_braket_dry_run.py](../backend/tests/test_braket_dry_run.py) |
| E2E test | [backend/tests/test_e2e_pipeline.py](../backend/tests/test_e2e_pipeline.py) |

## מקורות

- Aquila whitepaper v1.0 (June 2023) — `Aquila.pdf` בשורש הריפו
- Ebadi et al., *Quantum optimization of maximum independent set using Rydberg atom arrays*, Science 376, 1209-1215 (2022)
- Bernien et al., *Probing many-body dynamics on a 51-atom quantum simulator*, Nature 551, 579-584 (2017)
- QuTiP: <https://qutip.org/>
- Bloqade: <https://bloqade.quera.com/>
