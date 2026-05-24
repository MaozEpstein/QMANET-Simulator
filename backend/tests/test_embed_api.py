"""
End-to-end API tests for /api/embed/atoms (Phase 2).

These verify:
  - DTO round-trip (matches frontend rest.ts expectations)
  - Validation rules on EmbedConfigDTO (Pydantic Field constraints)
  - Default config behavior
  - Integration with /api/manet → /api/complement → /api/embed flow
  - Violations surfaced through the response without 4xx (we don't reject;
    we report)
"""

from __future__ import annotations

from fastapi.testclient import TestClient

from api.server import app

client = TestClient(app)


def _triangle_payload() -> dict:
    return {
        "target_graph": {
            "n_nodes": 3,
            "edges": [[0, 1], [0, 2], [1, 2]],
            "node_positions": None,
        }
    }


# --------------------------------------------------------------------------- #
# Happy path
# --------------------------------------------------------------------------- #


def test_embed_atoms_returns_full_response_shape():
    r = client.post("/api/embed/atoms", json=_triangle_payload())
    assert r.status_code == 200
    body = r.json()
    assert {
        "positions",
        "n_atoms",
        "blockade_radius_um",
        "induced_edges",
        "embedding_fidelity",
        "missing_edges",
        "spurious_edges",
        "violations",
    } <= set(body.keys())
    assert body["n_atoms"] == 3
    assert len(body["positions"]) == 3
    for p in body["positions"]:
        assert {"id", "x", "y"} <= set(p.keys())
    # Fidelity is in [0, 1]
    assert 0.0 <= body["embedding_fidelity"] <= 1.0
    # Blockade radius non-negative
    assert body["blockade_radius_um"] > 0


def test_embed_atoms_default_config_used_when_missing():
    """Sending only target_graph (no config) is valid."""
    r = client.post("/api/embed/atoms", json=_triangle_payload())
    assert r.status_code == 200
    # Default rabi=15 → R_b ≈ 8-9 µm
    assert 5.0 < r.json()["blockade_radius_um"] < 12.0


def test_embed_atoms_custom_config_applied():
    payload = _triangle_payload()
    payload["config"] = {
        "lattice_spacing_um": 6.0,
        "rabi_rad_us": 8.0,
        "detuning_rad_us": 0.0,
        "layout_seed": 7,
        "layout_iterations": 100,
        "snap_to_grid": True,
        "rescale_to_region": True,
        "margin_um": 3.0,
    }
    body = client.post("/api/embed/atoms", json=payload).json()
    # Lower Rabi ⇒ larger R_b
    default_body = client.post("/api/embed/atoms", json=_triangle_payload()).json()
    assert body["blockade_radius_um"] > default_body["blockade_radius_um"]


# --------------------------------------------------------------------------- #
# Validation (Pydantic Field constraints)
# --------------------------------------------------------------------------- #


def test_embed_rejects_rabi_above_aquila_limit():
    payload = _triangle_payload()
    payload["config"] = {"rabi_rad_us": 20.0}
    r = client.post("/api/embed/atoms", json=payload)
    assert r.status_code == 422


def test_embed_rejects_negative_lattice_spacing():
    payload = _triangle_payload()
    payload["config"] = {"lattice_spacing_um": -1.0}
    r = client.post("/api/embed/atoms", json=payload)
    assert r.status_code == 422


def test_embed_rejects_detuning_out_of_range():
    payload = _triangle_payload()
    payload["config"] = {"detuning_rad_us": 200.0}
    r = client.post("/api/embed/atoms", json=payload)
    assert r.status_code == 422


def test_embed_rejects_excessive_iterations():
    payload = _triangle_payload()
    payload["config"] = {"layout_iterations": 5000}
    r = client.post("/api/embed/atoms", json=payload)
    assert r.status_code == 422


# --------------------------------------------------------------------------- #
# Violations are surfaced in the body, not as 4xx
# --------------------------------------------------------------------------- #


def test_embed_surfaces_violations_for_oversize_graph():
    """300 atoms → TOO_MANY_ATOMS violation in body; status still 200."""
    payload = {
        "target_graph": {"n_nodes": 300, "edges": [], "node_positions": None},
    }
    r = client.post("/api/embed/atoms", json=payload)
    assert r.status_code == 200
    body = r.json()
    codes = [v["code"] for v in body["violations"]]
    assert "too_many_atoms" in codes


def test_embed_empty_graph_returns_empty_array_no_violations():
    payload = {"target_graph": {"n_nodes": 0, "edges": [], "node_positions": None}}
    body = client.post("/api/embed/atoms", json=payload).json()
    assert body["n_atoms"] == 0
    assert body["positions"] == []
    assert body["violations"] == []
    assert body["embedding_fidelity"] == 1.0


# --------------------------------------------------------------------------- #
# End-to-end: MANET → complement → embed
# --------------------------------------------------------------------------- #


def test_full_pipeline_manet_complement_embed():
    """A user clicking through Stage 1 → Stage 2 → Stage 3 should reach a valid array."""
    m = client.post(
        "/api/manet/generate", json={"n_nodes": 12, "comm_radius": 35.0, "seed": 42}
    ).json()
    c = client.post("/api/graph/complement", json={"graph": m["graph"]}).json()
    e = client.post("/api/embed/atoms", json={"target_graph": c["complement"]}).json()
    assert e["n_atoms"] == 12
    # Atoms must fit inside Aquila's user region
    for p in e["positions"]:
        assert 0.0 <= p["x"] <= 75.0
        assert 0.0 <= p["y"] <= 76.0


# --------------------------------------------------------------------------- #
# Schema contract — embed response matches the TS interface
# --------------------------------------------------------------------------- #


def test_embed_violation_schema():
    """Each violation has {code, message, locus, measured, limit}."""
    payload = {"target_graph": {"n_nodes": 300, "edges": [], "node_positions": None}}
    body = client.post("/api/embed/atoms", json=payload).json()
    assert len(body["violations"]) > 0
    for v in body["violations"]:
        assert set(v.keys()) == {"code", "message", "locus", "measured", "limit"}
        assert isinstance(v["code"], str)
        assert isinstance(v["message"], str)
        assert isinstance(v["locus"], dict)
        assert isinstance(v["measured"], (int, float))
        assert isinstance(v["limit"], (int, float))


def test_embed_edges_are_canonical_pairs_of_ints():
    payload = _triangle_payload()
    body = client.post("/api/embed/atoms", json=payload).json()
    for u, v in body["induced_edges"]:
        assert isinstance(u, int) and isinstance(v, int)
        assert u < v
    for u, v in body["missing_edges"]:
        assert u < v
    for u, v in body["spurious_edges"]:
        assert u < v
