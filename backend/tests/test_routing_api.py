"""
End-to-end API tests for /api/routing/build.

Verifies:
  - Happy path on K_n returns is_clique + 100% coverage + 1-hop everywhere
  - 422 on out-of-range backbone vertex
  - Schema includes all expected fields
  - Full MANET → max-clique → routing pipeline works
"""

from __future__ import annotations

from fastapi.testclient import TestClient

from api.server import app

client = TestClient(app)


def _k_n_payload(n: int) -> dict:
    return {
        "graph": {
            "n_nodes": n,
            "edges": [[i, j] for i in range(n) for j in range(i + 1, n)],
            "node_positions": None,
        },
        "backbone": list(range(n)),
    }


def test_routing_kn_full_coverage_one_hop():
    r = client.post("/api/routing/build", json=_k_n_payload(5))
    assert r.status_code == 200
    body = r.json()
    assert body["is_clique"] is True
    assert body["coverage_fraction"] == 1.0
    assert body["max_hops"] == 1
    assert body["mean_hops"] == 1.0
    # Every directed pair is reachable on K_n: n*(n-1)
    assert body["n_reachable_pairs"] == 5 * 4


def test_routing_response_shape():
    body = client.post("/api/routing/build", json=_k_n_payload(4)).json()
    expected = {
        "backbone",
        "is_clique",
        "covered_nodes",
        "coverage_fraction",
        "n_reachable_pairs",
        "mean_hops",
        "max_hops",
        "routes",
    }
    assert expected <= set(body.keys())
    for r in body["routes"]:
        assert {"src", "dst", "path", "hops"} <= set(r.keys())


def test_routing_rejects_out_of_range_backbone():
    r = client.post(
        "/api/routing/build",
        json={
            "graph": {"n_nodes": 3, "edges": [[0, 1], [1, 2]], "node_positions": None},
            "backbone": [0, 5],
        },
    )
    assert r.status_code == 422


def test_routing_empty_backbone_only_direct_edges():
    body = client.post(
        "/api/routing/build",
        json={
            "graph": {
                "n_nodes": 3,
                "edges": [[0, 1], [1, 2]],
                "node_positions": None,
            },
            "backbone": [],
        },
    ).json()
    # Backbone empty → only direct edges reachable
    for r in body["routes"]:
        if r["hops"] > 0:
            assert r["hops"] == 1


def test_routing_non_clique_backbone_flagged_but_not_rejected():
    """Path 0-1-2: backbone={0,2} is not a clique but the endpoint must still respond 200."""
    body = client.post(
        "/api/routing/build",
        json={
            "graph": {
                "n_nodes": 3,
                "edges": [[0, 1], [1, 2]],
                "node_positions": None,
            },
            "backbone": [0, 2],
        },
    ).json()
    assert body["is_clique"] is False


def test_full_pipeline_manet_to_routing():
    """MANET → complement → exact MIS = max-clique-in-G → routing table."""
    m = client.post("/api/manet/generate", json={"n_nodes": 8, "seed": 3}).json()
    c = client.post("/api/graph/complement", json={"graph": m["graph"]}).json()
    # max_clique_in_G is the same vertex set as the MIS in the complement
    backbone = c["max_clique_in_G"]
    rt = client.post(
        "/api/routing/build",
        json={"graph": m["graph"], "backbone": backbone},
    ).json()
    assert rt["is_clique"] is True
    # All backbone pairs should be 1 hop
    backbone_set = set(backbone)
    for r in rt["routes"]:
        if r["src"] in backbone_set and r["dst"] in backbone_set:
            assert r["hops"] == 1


def test_routing_route_paths_are_consecutive_edges():
    """Every emitted path must traverse actual edges of the graph."""
    payload = {
        "graph": {
            "n_nodes": 4,
            "edges": [[0, 1], [0, 2], [1, 2], [2, 3]],  # 0,1,2 form K3; 3 attached via 2
            "node_positions": None,
        },
        "backbone": [0, 1, 2],
    }
    body = client.post("/api/routing/build", json=payload).json()
    edge_set = {(min(u, v), max(u, v)) for u, v in payload["graph"]["edges"]}
    for r in body["routes"]:
        for i in range(len(r["path"]) - 1):
            u, v = r["path"][i], r["path"][i + 1]
            assert (min(u, v), max(u, v)) in edge_set
