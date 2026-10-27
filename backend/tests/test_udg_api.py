"""
Tests for the UDG realisability pieces: structural certificates, the placement
search, and the /api/embed/udg{,/check} endpoints.
"""

from __future__ import annotations

from itertools import combinations

from fastapi.testclient import TestClient

from api.server import app
from aquila.validator import validate_positions
from pipeline.clique_to_mis import Graph
from pipeline.udg_certificates import certificate_check
from pipeline.udg_embed import embed_udg

client = TestClient(app)


def _complete(k: int) -> list[tuple[int, int]]:
    return list(combinations(range(k), 2))


def _graph(n: int, edges: list[tuple[int, int]]) -> dict:
    return {"n_nodes": n, "edges": edges, "node_positions": None}


# ---- certificates ----------------------------------------------------------


def test_certificate_flags_clique_too_big_for_the_blockade_disk():
    r = certificate_check(8, _complete(8))
    assert r.verdict == "impossible" and r.code == "clique"


def test_certificate_flags_induced_k16():
    star = [(0, i) for i in range(1, 7)]
    r = certificate_check(7, star)
    assert r.verdict == "impossible" and r.code == "induced_k16"


def test_certificate_flags_too_many_atoms():
    r = certificate_check(257, [(0, 1)])
    assert r.verdict == "impossible" and r.code == "too_many_atoms"


def test_certificate_never_claims_a_small_udg_is_impossible():
    path = [(i, i + 1) for i in range(7)]
    assert certificate_check(8, path).verdict == "unknown"
    assert certificate_check(6, _complete(6)).verdict == "unknown"  # K6 fits


def test_geometric_certificates_are_skipped_for_a_larger_blockade_radius():
    # Low Rabi frequency -> large R_b: the R_b-dependent packing constants no
    # longer apply, but the rows bound (clique <= 9) and K_{1,6} still do.
    assert certificate_check(8, _complete(8), blockade_radius_um=10.0).verdict == "unknown"
    assert certificate_check(10, _complete(10), blockade_radius_um=10.0).code == "clique_rows"
    star = [(0, i) for i in range(1, 7)]
    assert certificate_check(7, star, blockade_radius_um=10.0).code == "induced_k16"


# ---- placement search ------------------------------------------------------


def test_search_realises_a_path_exactly_and_the_result_is_valid():
    n = 6
    g = Graph(n_nodes=n, edges=[(i, i + 1) for i in range(n - 1)], node_positions=None)
    res = embed_udg(g, time_budget_s=10.0)
    assert res.verdict == "found" and res.positions is not None
    assert res.wrong_edges == 0 and res.violations == 0
    assert validate_positions(res.positions) == []


def test_search_short_circuits_on_a_certified_impossible_graph():
    g = Graph(n_nodes=8, edges=_complete(8), node_positions=None)
    res = embed_udg(g, time_budget_s=30.0)
    assert res.verdict == "impossible" and res.stopped == "certificate"
    assert res.positions is None and res.attempts == 0
    assert res.elapsed_s < 1.0


# ---- API -------------------------------------------------------------------


def test_check_endpoint_reports_impossible_with_a_reason():
    body = client.post("/api/embed/udg/check", json={"graph": _graph(8, _complete(8))}).json()
    assert body["verdict"] == "impossible"
    assert body["code"] == "clique"
    assert body["reason"]
    assert 8.0 < body["blockade_radius_um"] < 9.0


def test_check_endpoint_unknown_for_a_small_graph():
    body = client.post(
        "/api/embed/udg/check", json={"graph": _graph(4, [(0, 1), (1, 2), (2, 3)])}
    ).json()
    assert body["verdict"] == "unknown" and body["code"] == "none"


def test_embed_endpoint_found_returns_a_valid_exact_embedding():
    edges = [(0, 1), (1, 2), (2, 3)]
    body = client.post(
        "/api/embed/udg",
        json={"target_graph": _graph(4, edges), "time_budget_s": 10.0},
    ).json()
    assert body["verdict"] == "found"
    assert body["wrong_edges"] == 0 and body["violations"] == 0
    emb = body["embed"]
    assert emb["embedding_fidelity"] == 1.0
    assert emb["violations"] == []
    assert sorted(map(tuple, emb["induced_edges"])) == edges


def test_embed_endpoint_impossible_has_no_embedding():
    body = client.post(
        "/api/embed/udg", json={"target_graph": _graph(8, _complete(8))}
    ).json()
    assert body["verdict"] == "impossible"
    assert body["embed"] is None
    assert body["certificate_code"] == "clique"
