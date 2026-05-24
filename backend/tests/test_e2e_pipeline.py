"""
End-to-end pipeline test.

Exercises the full chain MANET → complement → embed → schedule →
simulate → measure → postprocess → SA → routing via the real HTTP API.

Catches integration bugs that the per-module suites miss:
  - DTO incompatibilities between stages
  - Edge cases when a downstream stage receives empty data
  - Performance regressions (must finish < 60s on a small instance)

Also acts as the "reproduction mode" smoke test from the project plan
(Phase 8 DoD).  We can't reproduce Ebadi 2022 §6.1 at full hardware scale
(183 atoms) because QuTiP can't handle >~10 atoms — but we *can* run the
same protocol end-to-end at small scale and verify every stage agrees.
"""

from __future__ import annotations

import math
import time

from fastapi.testclient import TestClient

from api.server import app

client = TestClient(app)


def test_full_pipeline_finishes_within_budget():
    """The whole MANET → routing chain must finish in under 60 seconds at
    n=4 atoms with default params.  This is the budget cited in DoD."""
    start = time.perf_counter()

    # Stage 1: MANET
    manet = client.post(
        "/api/manet/generate",
        json={"n_nodes": 4, "box_size": 60.0, "comm_radius": 30.0, "seed": 17},
    ).json()
    assert manet["graph"]["n_nodes"] == 4

    # Stage 2: complement → MIS = max clique in G
    comp = client.post("/api/graph/complement", json={"graph": manet["graph"]}).json()
    assert comp["size"] >= 0

    # Stage 3: embed atoms
    embed = client.post(
        "/api/embed/atoms",
        json={
            "target_graph": comp["complement"],
            "config": {"lattice_spacing_um": 5.0, "rabi_rad_us": 12.0},
        },
    ).json()
    assert embed["n_atoms"] == 4

    # Stage 4: build schedule
    sched = client.post(
        "/api/schedule/build",
        json={
            "preset": "paper_linear_ramp",
            "preset_params": {
                "t_total_us": 4.0,
                "omega_max_rad_us": 12.0,
                "delta_initial_rad_us": -30.0,
                "delta_final_rad_us": 40.0,
            },
        },
    ).json()
    assert sched["schedule"]["duration"] == 4.0

    # Stage 5: simulate
    sim = client.post(
        "/api/simulate/run",
        json={
            "positions": embed["positions"],
            "schedule": sched["schedule"],
            "n_frames": 20,
        },
    ).json()
    assert sim["n_atoms"] == 4
    assert len(sim["frames"]) == 20

    # Stage 6: sample shots
    meas = client.post(
        "/api/measure",
        json={
            "bitstring_probs": sim["final_bitstring_probs"],
            "n_shots": 100,
            "apply_noise": True,
            "seed": 42,
        },
    ).json()
    assert meas["n_shots"] == 100

    # Stage 7: postprocess each shot
    pp = client.post(
        "/api/postprocess/batch",
        json={
            "bitstrings": meas["bitstrings"],
            "target_graph": comp["complement"],
            "seed": 0,
        },
    ).json()
    assert pp["summary"]["n_shots"] == 100
    assert all(r["is_valid"] for r in pp["results"])

    # Classical SA benchmark
    sa = client.post(
        "/api/classical/sa",
        json={"graph": comp["complement"], "config": {"n_sweeps": 100, "seed": 1}},
    ).json()
    assert sa["best_size"] >= 0

    # Stage 8: routing (use max-clique-in-G as backbone)
    rt = client.post(
        "/api/routing/build",
        json={"graph": manet["graph"], "backbone": comp["max_clique_in_G"]},
    ).json()
    assert rt["is_clique"] is True

    elapsed = time.perf_counter() - start
    assert elapsed < 60.0, f"E2E pipeline took {elapsed:.2f}s (budget 60s)"


def test_reproduce_mode_signatures_match_paper_61_for_small_instance():
    """
    Aquila §6.1 protocol at small scale (4-atom King's-like graph).

    Verifies the methodology aligns with the paper:
      - lattice spacing = 5 µm
      - linear ramp Δ: -30 → 40 rad/µs
      - Ω plateau = 15 rad/µs
      - 200 shots, post-processed
    We check that the resulting mean mIS size is at most the exact MIS
    (sanity), and that the classical SA matches the exact value.
    """
    # 4-node graph with 2 disjoint edges → MIS = 2
    graph = {
        "n_nodes": 4,
        "edges": [[0, 1], [2, 3]],
        "node_positions": None,
    }

    embed = client.post(
        "/api/embed/atoms",
        json={
            "target_graph": graph,
            "config": {"lattice_spacing_um": 5.0, "rabi_rad_us": 15.0},
        },
    ).json()

    sched = client.post(
        "/api/schedule/build",
        json={
            "preset": "paper_linear_ramp",
            "preset_params": {
                "t_total_us": 4.0,
                "omega_max_rad_us": 15.0,
                "delta_initial_rad_us": -30.0,
                "delta_final_rad_us": 40.0,
            },
        },
    ).json()

    sim = client.post(
        "/api/simulate/run",
        json={
            "positions": embed["positions"],
            "schedule": sched["schedule"],
            "n_frames": 30,
        },
    ).json()

    meas = client.post(
        "/api/measure",
        json={
            "bitstring_probs": sim["final_bitstring_probs"],
            "n_shots": 200,
            "apply_noise": True,
            "seed": 1,
        },
    ).json()

    pp = client.post(
        "/api/postprocess/batch",
        json={"bitstrings": meas["bitstrings"], "target_graph": graph, "seed": 0},
    ).json()

    sa = client.post(
        "/api/classical/sa",
        json={"graph": graph, "config": {"n_sweeps": 200, "seed": 0}},
    ).json()

    # On this graph α(G) = 2; classical SA must hit it.
    assert sa["best_size"] == 2
    # Quantum mean must be ≤ exact MIS (it's an approximation)
    assert pp["summary"]["mean_final_size"] <= 2.0 + 1e-9
    # All quantum post-processed shots must be valid IS
    assert all(r["is_valid"] for r in pp["results"])


def test_pipeline_handles_uncovered_node_gracefully():
    """An isolated node in MANET → backbone can't cover it → routing reports
    it as uncovered without crashing."""
    # Triangle + isolated node 3
    graph = {
        "n_nodes": 4,
        "edges": [[0, 1], [0, 2], [1, 2]],
        "node_positions": [
            {"id": i, "x": float(i * 10), "y": 0.0} for i in range(4)
        ],
    }
    comp = client.post("/api/graph/complement", json={"graph": graph}).json()
    rt = client.post(
        "/api/routing/build",
        json={"graph": graph, "backbone": comp["max_clique_in_G"]},
    ).json()
    # Backbone is a triangle of nodes {0,1,2}; node 3 has no neighbors at all
    # in `graph` → uncovered. Other 3 nodes are covered.
    assert 3 not in rt["covered_nodes"]
    assert rt["coverage_fraction"] == 0.75


def test_pipeline_seed_reproducibility_across_stages():
    """Same seeds at every stage → identical final post-processed bitstrings."""
    def run_once() -> list[str]:
        manet = client.post(
            "/api/manet/generate", json={"n_nodes": 3, "seed": 7}
        ).json()
        comp = client.post("/api/graph/complement", json={"graph": manet["graph"]}).json()
        embed = client.post(
            "/api/embed/atoms",
            json={"target_graph": comp["complement"], "config": {"layout_seed": 5}},
        ).json()
        sched = client.post(
            "/api/schedule/build", json={"preset": "paper_linear_ramp"}
        ).json()
        sim = client.post(
            "/api/simulate/run",
            json={
                "positions": embed["positions"],
                "schedule": sched["schedule"],
                "n_frames": 10,
            },
        ).json()
        meas = client.post(
            "/api/measure",
            json={
                "bitstring_probs": sim["final_bitstring_probs"],
                "n_shots": 50,
                "apply_noise": True,
                "seed": 42,
            },
        ).json()
        pp = client.post(
            "/api/postprocess/batch",
            json={"bitstrings": meas["bitstrings"], "target_graph": comp["complement"], "seed": 0},
        ).json()
        return [r["final_bitstring"] for r in pp["results"]]

    a = run_once()
    b = run_once()
    assert a == b


def test_pipeline_quantum_vs_classical_size_correlation():
    """On a random small graph, quantum-best should be within ±1 of classical-SA-best."""
    manet = client.post(
        "/api/manet/generate", json={"n_nodes": 5, "seed": 3, "comm_radius": 25.0}
    ).json()
    comp = client.post("/api/graph/complement", json={"graph": manet["graph"]}).json()
    embed = client.post(
        "/api/embed/atoms",
        json={"target_graph": comp["complement"], "config": {"rabi_rad_us": 12.0}},
    ).json()
    sched = client.post("/api/schedule/build", json={"preset": "paper_linear_ramp"}).json()
    sim = client.post(
        "/api/simulate/run",
        json={
            "positions": embed["positions"],
            "schedule": sched["schedule"],
            "n_frames": 20,
        },
    ).json()
    meas = client.post(
        "/api/measure",
        json={
            "bitstring_probs": sim["final_bitstring_probs"],
            "n_shots": 100,
            "apply_noise": True,
            "seed": 7,
        },
    ).json()
    pp = client.post(
        "/api/postprocess/batch",
        json={"bitstrings": meas["bitstrings"], "target_graph": comp["complement"], "seed": 0},
    ).json()
    sa = client.post(
        "/api/classical/sa",
        json={"graph": comp["complement"], "config": {"n_sweeps": 200, "seed": 0}},
    ).json()
    # Both methods should be close to each other and to exact α(Ḡ) = comp["size"]
    assert abs(pp["summary"]["best_final_size"] - sa["best_size"]) <= 1
    assert abs(sa["best_size"] - comp["size"]) <= 1
    # No NaN or inf escaping anywhere
    assert math.isfinite(pp["summary"]["mean_final_size"])
    assert math.isfinite(sa["best_energy"])
