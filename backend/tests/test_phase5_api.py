"""
End-to-end API tests for Phase 5 endpoints:
  /api/measure
  /api/postprocess
  /api/postprocess/batch
  /api/classical/sa
"""

from __future__ import annotations

from fastapi.testclient import TestClient

from api.server import app

client = TestClient(app)


# --------------------------------------------------------------------------- #
# /api/measure
# --------------------------------------------------------------------------- #


def test_measure_returns_full_shape():
    r = client.post(
        "/api/measure",
        json={
            "bitstring_probs": {"01": 0.5, "10": 0.5},
            "n_shots": 500,
            "apply_noise": False,
            "seed": 1,
        },
    )
    assert r.status_code == 200
    body = r.json()
    assert {"bitstrings", "histogram", "n_shots", "n_atoms"} <= set(body.keys())
    assert body["n_atoms"] == 2
    assert body["n_shots"] == 500
    assert len(body["bitstrings"]) == 500
    assert sum(body["histogram"].values()) == 500


def test_measure_empty_probs_returns_empty():
    r = client.post(
        "/api/measure",
        json={"bitstring_probs": {}, "n_shots": 100, "apply_noise": False},
    ).json()
    assert r["bitstrings"] == []
    assert r["n_shots"] == 0


def test_measure_rejects_invalid_n_shots():
    r = client.post(
        "/api/measure",
        json={"bitstring_probs": {"0": 1.0}, "n_shots": 0},
    )
    assert r.status_code == 422
    r2 = client.post(
        "/api/measure",
        json={"bitstring_probs": {"0": 1.0}, "n_shots": 100000},
    )
    assert r2.status_code == 422


# --------------------------------------------------------------------------- #
# /api/postprocess (single)
# --------------------------------------------------------------------------- #


def test_postprocess_single_recovers_is_from_all_ones_on_k5():
    r = client.post(
        "/api/postprocess",
        json={
            "bitstring": "11111",
            "target_graph": {
                "n_nodes": 5,
                "edges": [[i, j] for i in range(5) for j in range(i + 1, 5)],
                "node_positions": None,
            },
            "seed": 0,
        },
    )
    assert r.status_code == 200
    body = r.json()
    assert body["raw_violations"] == 10
    assert body["after_fix_size"] == 1
    assert body["final_size"] == 1
    assert body["is_valid"] is True


def test_postprocess_rejects_length_mismatch():
    r = client.post(
        "/api/postprocess",
        json={
            "bitstring": "11",
            "target_graph": {"n_nodes": 5, "edges": [], "node_positions": None},
        },
    )
    assert r.status_code == 422


def test_postprocess_returns_change_traces():
    """The 'removed' and 'added' lists allow the UI to animate the fix."""
    r = client.post(
        "/api/postprocess",
        json={
            "bitstring": "00000",
            "target_graph": {
                "n_nodes": 5,
                "edges": [[0, 1], [1, 2], [2, 3], [3, 4]],  # P_5
                "node_positions": None,
            },
            "seed": 0,
        },
    ).json()
    # Starting empty → step A removes nothing
    assert r["removed"] == []
    # Step B adds some vertices to reach α(P_5)=3
    assert len(r["added"]) == 3


# --------------------------------------------------------------------------- #
# /api/postprocess/batch
# --------------------------------------------------------------------------- #


def test_postprocess_batch_returns_per_shot_and_summary():
    r = client.post(
        "/api/postprocess/batch",
        json={
            "bitstrings": ["00000", "11111", "10101"],
            "target_graph": {
                "n_nodes": 5,
                "edges": [[0, 1], [1, 2], [2, 3], [3, 4]],  # P_5
                "node_positions": None,
            },
            "seed": 0,
        },
    )
    assert r.status_code == 200
    body = r.json()
    assert len(body["results"]) == 3
    assert all(res["is_valid"] for res in body["results"])
    s = body["summary"]
    assert s["n_shots"] == 3
    assert s["best_final_size"] >= 3  # any valid IS on P_5 maxes at 3


def test_postprocess_batch_rejects_inconsistent_lengths():
    r = client.post(
        "/api/postprocess/batch",
        json={
            "bitstrings": ["11", "111"],
            "target_graph": {"n_nodes": 3, "edges": [], "node_positions": None},
        },
    )
    assert r.status_code == 422


# --------------------------------------------------------------------------- #
# /api/classical/sa
# --------------------------------------------------------------------------- #


def test_sa_finds_alpha_for_complete_graph():
    r = client.post(
        "/api/classical/sa",
        json={
            "graph": {
                "n_nodes": 6,
                "edges": [[i, j] for i in range(6) for j in range(i + 1, 6)],
                "node_positions": None,
            },
        },
    )
    assert r.status_code == 200
    body = r.json()
    assert body["best_size"] == 1
    assert len(body["best_set"]) == 1


def test_sa_finds_alpha_for_cycle():
    r = client.post(
        "/api/classical/sa",
        json={
            "graph": {
                "n_nodes": 8,
                "edges": [[i, (i + 1) % 8] for i in range(8)],
                "node_positions": None,
            },
            "config": {"seed": 1, "n_sweeps": 300},
        },
    ).json()
    assert r["best_size"] == 4  # α(C_8) = 4


def test_sa_config_validation_rejects_bad_n_sweeps():
    r = client.post(
        "/api/classical/sa",
        json={
            "graph": {"n_nodes": 4, "edges": [], "node_positions": None},
            "config": {"n_sweeps": 0},
        },
    )
    assert r.status_code == 422


def test_sa_with_default_config():
    r = client.post(
        "/api/classical/sa",
        json={"graph": {"n_nodes": 4, "edges": [], "node_positions": None}},
    ).json()
    assert r["best_size"] == 4
    assert r["n_iterations"] > 0


# --------------------------------------------------------------------------- #
# End-to-end pipeline through Phase 5
# --------------------------------------------------------------------------- #


def test_full_pipeline_manet_to_sa_classical():
    """MANET → complement → SA — confirms the classical baseline on a real
    instance produced by the pipeline."""
    m = client.post("/api/manet/generate", json={"n_nodes": 6, "seed": 11}).json()
    c = client.post("/api/graph/complement", json={"graph": m["graph"]}).json()
    sa = client.post(
        "/api/classical/sa",
        json={"graph": c["complement"], "config": {"n_sweeps": 300, "seed": 7}},
    ).json()
    # SA must match the exact MIS size from the complement endpoint
    assert sa["best_size"] == c["size"]
