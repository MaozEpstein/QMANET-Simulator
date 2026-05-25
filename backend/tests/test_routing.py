"""
Routing tests.

Contracts:
  - Backbone must be a real clique in G for routing to make sense.
  - For two backbone nodes, route is the direct edge (1 hop).
  - For one in/one out, route is exactly 2 hops.
  - For both out, route is 2 or 3 hops depending on whether the boundary
    nodes coincide.
  - Uncovered nodes produce empty paths.
  - Every emitted path is valid in G (consecutive nodes are edges).
  - Coverage statistics correct on toy graphs.
"""

from __future__ import annotations

import networkx as nx
import pytest

from pipeline.clique_to_mis import Graph, max_clique
from pipeline.manet import MANETConfig, generate
from pipeline.routing import (
    build_routing_table,
    compute_route,
    is_path_valid,
    _adjacency_sets,
)


def _graph_from_nx(G: nx.Graph) -> Graph:
    return Graph(
        n_nodes=G.number_of_nodes(),
        edges=[(int(u), int(v)) for u, v in G.edges() if u < v],
    )


# --------------------------------------------------------------------------- #
# Clique on K_n: backbone = entire graph, every route is 1 hop
# --------------------------------------------------------------------------- #


def test_complete_graph_all_routes_one_hop():
    G = _graph_from_nx(nx.complete_graph(6))
    res = build_routing_table(G, backbone=list(range(6)))
    assert res.is_clique
    assert res.coverage_fraction == 1.0
    for r in res.routes:
        assert r.is_reachable
        assert r.hops == 1


def test_empty_backbone_all_routes_via_direct_or_fallback():
    """Empty backbone → BFS fallback delivers every connected pair, with no
    'backbone' classification possible. Direct edges stay direct."""
    G = _graph_from_nx(nx.path_graph(5))  # 0-1-2-3-4
    res = build_routing_table(G, backbone=[])
    assert res.n_via_backbone == 0
    edge_set = {(u, v) for u, v in G.edges} | {(v, u) for u, v in G.edges}
    for r in res.routes:
        assert r.is_reachable, "path graph is connected; every pair reachable"
        if r.hops == 1:
            assert (r.src, r.dst) in edge_set
            assert r.via == "direct"
        else:
            assert r.via == "fallback"
    # 0→4 in P_5 must take 4 hops via fallback
    r04 = next(r for r in res.routes if r.src == 0 and r.dst == 4)
    assert r04.hops == 4
    assert r04.via == "fallback"


# --------------------------------------------------------------------------- #
# Backbone clique property
# --------------------------------------------------------------------------- #


def test_clique_property_detected():
    G = _graph_from_nx(nx.complete_graph(5))
    res = build_routing_table(G, backbone=[0, 1, 2])
    assert res.is_clique


def test_non_clique_backbone_flagged():
    """Path 0-1-2 — vertices {0,2} are NOT a clique (no edge 0-2)."""
    G = _graph_from_nx(nx.path_graph(3))
    res = build_routing_table(G, backbone=[0, 2])
    assert not res.is_clique


# --------------------------------------------------------------------------- #
# Coverage stats
# --------------------------------------------------------------------------- #


def test_coverage_includes_backbone_and_their_neighbors():
    """Star graph: center=backbone covers all leaves."""
    G = _graph_from_nx(nx.star_graph(5))  # 0 = center, 1..5 leaves
    res = build_routing_table(G, backbone=[0])
    assert res.coverage_fraction == 1.0


def test_uncovered_nodes_get_fallback_routes():
    """4-cycle 0-1-2-3-0, backbone={1}: node 3 is not a neighbor of 1, so
    coverage is partial. With BFS fallback, the route still resolves."""
    edges = [(0, 1), (1, 2), (2, 3), (0, 3)]
    G = Graph(n_nodes=4, edges=edges)
    res = build_routing_table(G, backbone=[1])
    # Coverage is unchanged — counts nodes served by backbone in ≤1 hop.
    assert 3 not in res.covered_nodes
    # 2→3 is a direct edge → 1 hop, via direct.
    route_2_to_3 = next(r for r in res.routes if r.src == 2 and r.dst == 3)
    assert route_2_to_3.hops == 1
    assert route_2_to_3.via == "direct"
    # 1→3: not a direct edge; backbone={1} doesn't cover 3. Shortest path
    # is 1→0→3 (2 hops) — intermediate 0 is NOT in backbone, so via="fallback".
    route_1_to_3 = next(r for r in res.routes if r.src == 1 and r.dst == 3)
    assert route_1_to_3.is_reachable
    assert route_1_to_3.hops == 2
    assert route_1_to_3.via == "fallback"


# --------------------------------------------------------------------------- #
# Path validity
# --------------------------------------------------------------------------- #


@pytest.mark.parametrize("seed", range(10))
def test_property_emitted_paths_are_valid_edges(seed):
    """On 15 random graphs, every non-empty route corresponds to consecutive edges in G."""
    G = _graph_from_nx(nx.gnp_random_graph(15, p=0.4, seed=seed))
    backbone = max_clique(G)
    res = build_routing_table(G, backbone=backbone)
    for r in res.routes:
        if r.is_reachable and r.hops > 0:
            assert is_path_valid(G, list(r.path)), f"invalid path {r.path}"


def test_is_path_valid_basic():
    G = Graph(n_nodes=4, edges=[(0, 1), (1, 2), (2, 3)])
    assert is_path_valid(G, [0, 1, 2, 3])
    assert is_path_valid(G, [0, 1])
    assert is_path_valid(G, [3])  # single node OK
    assert not is_path_valid(G, [0, 2])  # no direct edge


# --------------------------------------------------------------------------- #
# 1-hop guarantee between any two backbone nodes
# --------------------------------------------------------------------------- #


@pytest.mark.parametrize("seed", range(15))
def test_property_backbone_pairs_always_one_hop(seed):
    """Any pair of backbone nodes is a 1-hop route (since backbone is a clique)."""
    G = _graph_from_nx(nx.gnp_random_graph(14, p=0.45, seed=seed))
    backbone = max_clique(G)
    if len(backbone) < 2:
        return  # nothing to verify
    res = build_routing_table(G, backbone=backbone)
    assert res.is_clique
    for r in res.routes:
        if r.src in backbone and r.dst in backbone and r.src != r.dst:
            assert r.hops == 1, f"backbone pair {(r.src, r.dst)} took {r.hops} hops"


# --------------------------------------------------------------------------- #
# Single shot compute_route
# --------------------------------------------------------------------------- #


def test_compute_route_same_node_zero_hops():
    G = Graph(n_nodes=3, edges=[(0, 1), (1, 2)])
    adj = _adjacency_sets(G)
    r = compute_route(1, 1, adj, backbone_set={0})
    assert r.hops == 0
    assert r.path == (1,)


def test_compute_route_direct_edge_one_hop():
    G = Graph(n_nodes=3, edges=[(0, 1), (1, 2)])
    adj = _adjacency_sets(G)
    r = compute_route(0, 1, adj, backbone_set=set())
    assert r.hops == 1
    assert r.path == (0, 1)


def test_compute_route_via_two_backbone_nodes():
    """Edges: 0-1, 1-2, 2-3. Backbone {1,2}. Route 0→3 = 0 → 1 → 2 → 3."""
    G = Graph(n_nodes=4, edges=[(0, 1), (1, 2), (2, 3)])
    adj = _adjacency_sets(G)
    r = compute_route(0, 3, adj, backbone_set={1, 2})
    assert r.path == (0, 1, 2, 3)
    assert r.hops == 3
    assert is_path_valid(G, list(r.path))


def test_compute_route_in_backbone_to_outside():
    """Backbone {0,1}. Edges 0-1, 1-2. Route 0→2 enters at 1 then hops to 2."""
    G = Graph(n_nodes=3, edges=[(0, 1), (1, 2)])
    adj = _adjacency_sets(G)
    r = compute_route(0, 2, adj, backbone_set={0, 1})
    assert r.path == (0, 1, 2)
    assert r.hops == 2


def test_compute_route_outside_to_outside_via_same_entry():
    """Two non-backbone nodes sharing the same backbone entry → 2 hops."""
    # Edges: 0-1, 0-2 (0 in backbone, 1 and 2 attach to 0)
    G = Graph(n_nodes=3, edges=[(0, 1), (0, 2)])
    adj = _adjacency_sets(G)
    r = compute_route(1, 2, adj, backbone_set={0})
    assert r.path == (1, 0, 2)
    assert r.hops == 2


# --------------------------------------------------------------------------- #
# Integration with MANET
# --------------------------------------------------------------------------- #


@pytest.mark.parametrize("seed", range(5))
def test_integration_with_manet_pipeline(seed):
    """Generate a MANET, find its max-clique backbone, build routing table."""
    snap = generate(MANETConfig(n_nodes=15, comm_radius=40.0, seed=seed))
    G = Graph(
        n_nodes=len(snap.nodes),
        edges=[(int(u), int(v)) for u, v in snap.edges],
    )
    backbone = max_clique(G)
    res = build_routing_table(G, backbone=backbone)
    assert res.is_clique
    # Some pair must be reachable
    assert res.n_reachable_pairs >= 0


# --------------------------------------------------------------------------- #
# RoutingResult statistics
# --------------------------------------------------------------------------- #


def test_routing_result_statistics_consistent():
    G = _graph_from_nx(nx.complete_graph(5))
    res = build_routing_table(G, backbone=list(range(5)))
    assert res.mean_hops == 1.0
    assert res.max_hops == 1


def test_routing_result_to_dict_is_serializable():
    G = _graph_from_nx(nx.complete_graph(4))
    res = build_routing_table(G, backbone=[0, 1, 2, 3])
    d = res.to_dict()
    assert {
        "backbone",
        "is_clique",
        "covered_nodes",
        "coverage_fraction",
        "n_reachable_pairs",
        "mean_hops",
        "max_hops",
        "n_via_direct",
        "n_via_backbone",
        "n_via_fallback",
        "mean_hops_direct",
        "mean_hops_backbone",
        "mean_hops_fallback",
        "routes",
    } <= set(d.keys())
    assert isinstance(d["routes"], list)
    for r in d["routes"]:
        assert "via" in r
        assert r["via"] in {"direct", "backbone", "fallback"}


def test_invalid_backbone_vertex_raises():
    G = _graph_from_nx(nx.complete_graph(3))
    with pytest.raises(ValueError, match="out of range"):
        build_routing_table(G, backbone=[0, 5])


# --------------------------------------------------------------------------- #
# Via classification (direct / backbone / fallback) + Petersen acceptance test
# --------------------------------------------------------------------------- #


def _petersen() -> Graph:
    """Standard Petersen graph: outer pentagon 0..4 + inner pentagram 5..9
    with spokes i ↔ i+5. Triangle-free, MaxClique = 2, α = 4, diameter = 2."""
    edges = [
        # Outer pentagon
        (0, 1), (1, 2), (2, 3), (3, 4), (4, 0),
        # Spokes
        (0, 5), (1, 6), (2, 7), (3, 8), (4, 9),
        # Inner pentagram (i ↔ i+2 on inner ring)
        (5, 7), (6, 8), (7, 9), (8, 5), (9, 6),
    ]
    return Graph(n_nodes=10, edges=edges)


def test_petersen_routing_7_to_8_via_fallback():
    """The crucial acceptance test: Petersen's MaxClique = 2 (e.g. {7,9}) only
    serves ~60% of pairs through the backbone, but the graph has diameter 2,
    so the BFS fallback must deliver 7→8 in 2 hops via node 5 (a non-backbone
    intermediate). Previously this route was reported as unreachable."""
    G = _petersen()
    res = build_routing_table(G, backbone=[7, 9])
    r = next(r for r in res.routes if r.src == 7 and r.dst == 8)
    assert r.is_reachable, "7→8 must be reachable; Petersen has diameter 2"
    assert r.hops == 2
    assert r.via == "fallback"
    # The intermediate (node 5) is a shared neighbour of 7 and 8 but NOT in backbone.
    assert 5 in r.path
    assert 5 not in res.backbone


def test_petersen_every_pair_reachable_via_fallback_or_better():
    """Petersen is connected (diameter 2), so with BFS fallback every pair
    resolves. n_reachable_pairs must equal N(N-1) = 90."""
    G = _petersen()
    res = build_routing_table(G, backbone=[7, 9])
    assert res.n_reachable_pairs == 90
    assert res.max_hops == 2


def test_via_classification_distinguishes_three_cases():
    """A graph that exercises all three via types simultaneously:
       0-1 (direct edge), 0-2-3 (via backbone {2}), 0-4-5 (fallback, 4 ∉ bb)."""
    G = Graph(
        n_nodes=6,
        edges=[(0, 1), (0, 2), (2, 3), (0, 4), (4, 5)],
    )
    res = build_routing_table(G, backbone=[2])
    r01 = next(r for r in res.routes if r.src == 0 and r.dst == 1)
    r03 = next(r for r in res.routes if r.src == 0 and r.dst == 3)
    r05 = next(r for r in res.routes if r.src == 0 and r.dst == 5)
    assert (r01.via, r01.hops) == ("direct", 1)
    assert (r03.via, r03.hops) == ("backbone", 2)  # 0 → 2 → 3, intermediate=2 ∈ bb
    assert (r05.via, r05.hops) == ("fallback", 2)  # 0 → 4 → 5, intermediate=4 ∉ bb


def test_via_counts_sum_to_reachable_pairs():
    """The three via buckets must partition the reachable pairs exactly."""
    G = _petersen()
    res = build_routing_table(G, backbone=[7, 9])
    assert res.n_via_direct + res.n_via_backbone + res.n_via_fallback == res.n_reachable_pairs


def test_mean_hops_per_via_within_bounds():
    """direct must average exactly 1 hop; backbone+fallback must be ≥ 2."""
    G = _petersen()
    res = build_routing_table(G, backbone=[7, 9])
    if res.n_via_direct > 0:
        assert res.mean_hops_direct == 1.0
    if res.n_via_backbone > 0:
        assert res.mean_hops_backbone >= 2.0
    if res.n_via_fallback > 0:
        assert res.mean_hops_fallback >= 2.0


def test_backbone_path_classification_endpoint_is_backbone():
    """When the route enters/exits the backbone (e.g. src ∈ bb → dst ∉ bb), the
    intermediate (the backbone-side hop) must be in the backbone set so the
    route classifies as 'backbone'."""
    # Edges: 0-1, 1-2. Backbone {1}. Route 0→2 = 0→1→2. Intermediate=1 ∈ bb.
    G = Graph(n_nodes=3, edges=[(0, 1), (1, 2)])
    res = build_routing_table(G, backbone=[1])
    r = next(r for r in res.routes if r.src == 0 and r.dst == 2)
    assert r.via == "backbone"
    assert r.hops == 2


def test_disconnected_graph_reports_unreachable():
    """If G is disconnected, BFS legitimately fails. Hops=0, via=direct
    (the sentinel for the unreachable case)."""
    G = Graph(n_nodes=4, edges=[(0, 1), (2, 3)])  # two components
    res = build_routing_table(G, backbone=[0])
    r02 = next(r for r in res.routes if r.src == 0 and r.dst == 2)
    assert not r02.is_reachable
    assert r02.hops == 0
    assert r02.path == ()
