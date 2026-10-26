"""
API tests for /api/graph/mis — MIS solved directly on the conflict graph F
(no complement graph on the conflict track's path).
"""

from __future__ import annotations

from fastapi.testclient import TestClient

from api.server import app

client = TestClient(app)


def _graph(n: int, edges: list[tuple[int, int]]) -> dict:
    return {"n_nodes": n, "edges": edges, "node_positions": None}


def test_mis_of_path_is_solved_on_the_graph_itself():
    # P4: 0-1-2-3 → α = 2, e.g. {0,2} / {0,3} / {1,3}
    body = client.post("/api/graph/mis", json={"graph": _graph(4, [(0, 1), (1, 2), (2, 3)])}).json()
    assert body["size"] == 2
    assert body["alpha_g"] == 2
    assert body["n_max_cliques"] == 3
    # The target graph Stage 3 embeds is F itself, not a complement.
    assert body["complement"]["edges"] == [[0, 1], [1, 2], [2, 3]]
    assert body["graph"]["edges"] == body["complement"]["edges"]
    mis = body["mis_in_complement"]
    assert mis == body["max_clique_in_G"]
    edge_set = {(0, 1), (1, 2), (2, 3)}
    assert all((a, b) not in edge_set for a in mis for b in mis if a < b)


def test_mis_of_complete_graph_is_a_single_vertex():
    k4 = [(i, j) for i in range(4) for j in range(i + 1, 4)]
    body = client.post("/api/graph/mis", json={"graph": _graph(4, k4)}).json()
    assert body["size"] == 1
    assert body["n_max_cliques"] == 4
    assert body["chromatic_lower"] == 4  # ω(K4)


def test_mis_of_edgeless_graph_is_every_vertex():
    body = client.post("/api/graph/mis", json={"graph": _graph(3, [])}).json()
    assert body["size"] == 3
    assert body["mis_in_complement"] == [0, 1, 2]


def test_mis_of_conflict_graph_matches_conflict_endpoint_complement_route():
    """Solving MIS(F) directly must agree with the old clique(F̄) route."""
    c = {
        "n_nodes": 4,
        "edges": [(0, 1), (1, 2), (2, 3)],
        "node_positions": [
            {"id": 0, "x": 0.0, "y": 0.0},
            {"id": 1, "x": 10.0, "y": 0.0},
            {"id": 2, "x": 20.0, "y": 0.0},
            {"id": 3, "x": 30.0, "y": 0.0},
        ],
    }
    cg = client.post(
        "/api/graph/conflict", json={"graph": c, "interference_radius": 12.0}
    ).json()
    direct = client.post("/api/graph/mis", json={"graph": cg["conflict_graph"]}).json()
    legacy = client.post(
        "/api/graph/complement", json={"graph": cg["conflict_graph_complement"]}
    ).json()
    assert direct["size"] == legacy["size"]
    assert direct["n_max_cliques"] == legacy["n_max_cliques"]
    assert direct["complement"]["edges"] == legacy["complement"]["edges"]
