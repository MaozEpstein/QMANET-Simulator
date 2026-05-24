"""
End-to-end API integration tests via FastAPI's TestClient.

These catch DTO/Pydantic regressions that pure-unit tests miss:
- Field renames between Python and JSON
- Validation rules (range / required / type)
- HTTP status codes for invalid input
- Round-trip: generate MANET → feed graph to /complement → MIS sizes match
"""

from __future__ import annotations

import math

import pytest
from fastapi.testclient import TestClient

from api.server import app

client = TestClient(app)


# --------------------------------------------------------------------------- #
# Health + aquila spec
# --------------------------------------------------------------------------- #


def test_root_health():
    r = client.get("/")
    assert r.status_code == 200
    body = r.json()
    assert body["status"] == "ok"
    assert body["service"] == "qsimulator-backend"


def test_aquila_endpoint_returns_full_spec():
    r = client.get("/api/aquila")
    assert r.status_code == 200
    body = r.json()
    # Hardware constants must be present and match whitepaper §1.5
    assert body["max_qubits"] == 256
    assert body["max_width_um"] == 75.0
    assert body["max_height_um"] == 76.0
    assert body["min_site_spacing_um"] == 4.0
    assert body["max_rabi_rad_us"] == 15.8
    assert body["detuning_max_rad_us"] == 125.0
    assert body["max_duration_us"] == 4.0
    # Noise block must include critical fields the frontend may display
    noise = body["noise"]
    assert noise["sigma_xy_um"] == 0.2
    assert noise["t2_star_us"] == 5.8
    assert noise["eps_det_ryd_as_gnd"] == 0.08


# --------------------------------------------------------------------------- #
# /api/manet/generate
# --------------------------------------------------------------------------- #


def test_manet_generate_default_shape():
    r = client.post("/api/manet/generate", json={})
    assert r.status_code == 200
    body = r.json()
    assert body["graph"]["n_nodes"] == 12  # default
    assert len(body["graph"]["node_positions"]) == 12
    for n in body["graph"]["node_positions"]:
        assert set(n.keys()) == {"id", "x", "y"}
    for u, v in body["graph"]["edges"]:
        assert 0 <= u < 12 and 0 <= v < 12 and u != v


def test_manet_generate_reproducible_via_seed():
    payload = {"n_nodes": 10, "comm_radius": 30.0, "seed": 12345}
    a = client.post("/api/manet/generate", json=payload).json()
    b = client.post("/api/manet/generate", json=payload).json()
    assert a == b


def test_manet_generate_different_seeds_diverge():
    a = client.post("/api/manet/generate", json={"n_nodes": 10, "seed": 1}).json()
    b = client.post("/api/manet/generate", json={"n_nodes": 10, "seed": 2}).json()
    # Same shape, different content
    assert a["graph"]["n_nodes"] == b["graph"]["n_nodes"]
    assert a["graph"]["node_positions"] != b["graph"]["node_positions"]


@pytest.mark.parametrize(
    "bad,expect_422",
    [
        ({"n_nodes": 1}, True),  # below ge=2
        ({"n_nodes": 100}, True),  # above le=64
        ({"comm_radius": -1.0}, True),  # gt=0 fails
        ({"box_size": 0.0}, True),  # gt=0 fails
        ({"n_nodes": "twelve"}, True),  # wrong type
    ],
)
def test_manet_generate_rejects_bad_input(bad, expect_422):
    r = client.post("/api/manet/generate", json=bad)
    assert (r.status_code == 422) == expect_422


def test_manet_positions_inside_box():
    box = 50.0
    r = client.post(
        "/api/manet/generate",
        json={"n_nodes": 20, "box_size": box, "comm_radius": 15.0, "seed": 7},
    )
    body = r.json()
    for n in body["graph"]["node_positions"]:
        assert 0.0 <= n["x"] <= box
        assert 0.0 <= n["y"] <= box


def test_manet_edges_respect_comm_radius_via_api():
    """Each emitted edge must connect two nodes within comm_radius (this is the geometric contract)."""
    R = 20.0
    body = client.post(
        "/api/manet/generate",
        json={"n_nodes": 16, "box_size": 60.0, "comm_radius": R, "seed": 3},
    ).json()
    pos = {n["id"]: (n["x"], n["y"]) for n in body["graph"]["node_positions"]}
    for u, v in body["graph"]["edges"]:
        d = math.hypot(pos[u][0] - pos[v][0], pos[u][1] - pos[v][1])
        assert d <= R + 1e-9, f"edge ({u},{v}) has distance {d} > R={R}"


# --------------------------------------------------------------------------- #
# /api/graph/complement
# --------------------------------------------------------------------------- #


def test_complement_round_trip_with_manet():
    """generate MANET → POST graph back to /complement → both sides agree."""
    manet = client.post(
        "/api/manet/generate", json={"n_nodes": 10, "comm_radius": 40.0, "seed": 5}
    ).json()
    r = client.post("/api/graph/complement", json={"graph": manet["graph"]})
    assert r.status_code == 200
    body = r.json()
    assert body["graph"]["n_nodes"] == 10
    assert body["complement"]["n_nodes"] == 10
    assert body["size"] == len(body["max_clique_in_G"])
    assert body["max_clique_in_G"] == body["mis_in_complement"]
    # Total edges G + Ḡ = n*(n-1)/2 (modulo self-loops, which we forbid)
    n = body["graph"]["n_nodes"]
    assert len(body["graph"]["edges"]) + len(body["complement"]["edges"]) == n * (n - 1) // 2


def test_complement_of_triangle():
    """K_3 (triangle): max clique = {0,1,2}, complement is empty."""
    payload = {"graph": {"n_nodes": 3, "edges": [[0, 1], [0, 2], [1, 2]], "node_positions": None}}
    r = client.post("/api/graph/complement", json=payload)
    body = r.json()
    assert body["complement"]["edges"] == []
    assert body["max_clique_in_G"] == [0, 1, 2]
    assert body["size"] == 3


def test_complement_of_empty_graph():
    """An empty graph on n nodes — every singleton is a maximal clique, size = 1."""
    payload = {"graph": {"n_nodes": 5, "edges": [], "node_positions": None}}
    body = client.post("/api/graph/complement", json=payload).json()
    assert body["size"] == 1
    assert len(body["max_clique_in_G"]) == 1
    # complement of empty is K_n, which has n*(n-1)/2 edges
    assert len(body["complement"]["edges"]) == 5 * 4 // 2


def test_complement_of_complete_graph():
    """K_5: max clique = all 5; complement is empty (no edges)."""
    edges = [[u, v] for u in range(5) for v in range(u + 1, 5)]
    payload = {"graph": {"n_nodes": 5, "edges": edges, "node_positions": None}}
    body = client.post("/api/graph/complement", json=payload).json()
    assert body["size"] == 5
    assert body["complement"]["edges"] == []


def test_complement_of_path_p5():
    """P_5 (path 0-1-2-3-4): α(P_5) = 3.  MaxClique(P_5) = 2 (any single edge)."""
    payload = {
        "graph": {"n_nodes": 5, "edges": [[0, 1], [1, 2], [2, 3], [3, 4]], "node_positions": None}
    }
    body = client.post("/api/graph/complement", json=payload).json()
    # Max clique in a path of length >0 is 2 (an edge).
    assert body["size"] == 2


def test_complement_handles_disconnected_graph():
    """Disconnected: K_3 + isolated K_3 → max clique = 3 (within either triangle)."""
    payload = {
        "graph": {
            "n_nodes": 6,
            "edges": [[0, 1], [0, 2], [1, 2], [3, 4], [3, 5], [4, 5]],
            "node_positions": None,
        }
    }
    body = client.post("/api/graph/complement", json=payload).json()
    assert body["size"] == 3


def test_complement_rejects_too_large():
    """Above EXACT_MIS_MAX_NODES we still return Ḡ but max_clique stays empty (no 422)."""
    n = 64
    payload = {"graph": {"n_nodes": n, "edges": [], "node_positions": None}}
    r = client.post("/api/graph/complement", json=payload)
    # Should NOT crash; returns 200 with empty clique
    assert r.status_code == 200
    body = r.json()
    assert body["graph"]["n_nodes"] == n
    assert body["max_clique_in_G"] == []
    assert body["size"] == 0


def test_complement_preserves_node_positions():
    """When G carries positions (from MANET), Ḡ must keep them — the embedding stage needs them."""
    positions = [{"id": i, "x": float(i * 10), "y": float(i * 5)} for i in range(4)]
    payload = {
        "graph": {
            "n_nodes": 4,
            "edges": [[0, 1], [2, 3]],
            "node_positions": positions,
        }
    }
    body = client.post("/api/graph/complement", json=payload).json()
    assert body["graph"]["node_positions"] == positions
    # Complement may discard or keep positions — current impl keeps them, test that contract.
    assert body["complement"]["node_positions"] == positions


# --------------------------------------------------------------------------- #
# Property-style invariants on many random instances
# --------------------------------------------------------------------------- #


@pytest.mark.parametrize("seed", range(15))
def test_property_clique_equals_mis_within_response(seed):
    """For 15 different random MANETs, the response's two views of the optimal set must match."""
    manet = client.post(
        "/api/manet/generate",
        json={"n_nodes": 14, "comm_radius": 38.0, "seed": seed},
    ).json()
    res = client.post("/api/graph/complement", json={"graph": manet["graph"]}).json()
    # max_clique_in_G and mis_in_complement are two names for the same set of vertices
    assert set(res["max_clique_in_G"]) == set(res["mis_in_complement"])
    assert len(res["max_clique_in_G"]) == res["size"]


@pytest.mark.parametrize("seed", range(10))
def test_property_complement_is_involution_via_api(seed):
    """complement(complement(G)) returns the original edge set (same nodes, same edges as multisets)."""
    manet = client.post(
        "/api/manet/generate",
        json={"n_nodes": 12, "comm_radius": 38.0, "seed": seed},
    ).json()
    res1 = client.post("/api/graph/complement", json={"graph": manet["graph"]}).json()
    res2 = client.post("/api/graph/complement", json={"graph": res1["complement"]}).json()
    # Edges may come back in canonical (u<v) form but possibly different order — compare as sets.
    g_edges = {tuple(sorted(e)) for e in manet["graph"]["edges"]}
    gdd_edges = {tuple(sorted(e)) for e in res2["complement"]["edges"]}
    assert g_edges == gdd_edges
    assert manet["graph"]["n_nodes"] == res2["complement"]["n_nodes"]


@pytest.mark.parametrize("seed", range(10))
def test_property_sum_of_edges_is_complete_graph(seed):
    """|E(G)| + |E(Ḡ)| = n(n-1)/2 for every graph."""
    manet = client.post(
        "/api/manet/generate",
        json={"n_nodes": 16, "comm_radius": 35.0, "seed": seed},
    ).json()
    res = client.post("/api/graph/complement", json={"graph": manet["graph"]}).json()
    n = res["graph"]["n_nodes"]
    assert len(res["graph"]["edges"]) + len(res["complement"]["edges"]) == n * (n - 1) // 2


@pytest.mark.parametrize("seed", range(10))
def test_property_omega_g_equals_alpha_gbar(seed):
    """ω(G) = α(Ḡ): the maximum clique in G and the maximum IS in Ḡ have the same size."""
    manet = client.post(
        "/api/manet/generate",
        json={"n_nodes": 14, "comm_radius": 38.0, "seed": seed},
    ).json()
    # ω(G) = size from first call
    res_on_G = client.post("/api/graph/complement", json={"graph": manet["graph"]}).json()
    omega_G = res_on_G["size"]
    # α(Ḡ) = ω(Ḡ̄) = ω(G) — but the API returns max-clique-in-input. So feed Ḡ and read its "mis_in_complement" → that's α(Ḡ).
    # Easier: ω(Ḡ) = α(G), so we cannot directly read α(Ḡ) from /complement(Ḡ).
    # But α(Ḡ) is exactly what we asked for on G — it lives in res_on_G.mis_in_complement.
    alpha_Gbar = len(res_on_G["mis_in_complement"])
    assert omega_G == alpha_Gbar
