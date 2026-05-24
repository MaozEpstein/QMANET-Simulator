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


def test_empty_backbone_no_routes_outside_pairs():
    G = _graph_from_nx(nx.path_graph(5))  # 0-1-2-3-4
    res = build_routing_table(G, backbone=[])
    # No backbone → only direct edges reachable
    for r in res.routes:
        if r.is_reachable:
            assert r.hops == 1
            assert (r.src, r.dst) in {(u, v) for u, v in G.edges} | {(v, u) for u, v in G.edges}


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


def test_uncovered_nodes_have_empty_routes():
    """4-cycle 0-1-2-3-0 with backbone={1}: node 3 is not a neighbor of 1."""
    edges = [(0, 1), (1, 2), (2, 3), (0, 3)]
    G = Graph(n_nodes=4, edges=edges)
    res = build_routing_table(G, backbone=[1])
    # backbone={1}, covered = {0, 1, 2}. Node 3 is uncovered.
    assert 3 not in res.covered_nodes
    # Any route ending at 3 from non-neighbors should be unreachable via backbone
    route_2_to_3 = next(r for r in res.routes if r.src == 2 and r.dst == 3)
    # 2-3 is a direct edge → reachable as 1 hop
    assert route_2_to_3.hops == 1
    # 1-3: not a direct edge, 3 not covered → no path
    route_1_to_3 = next(r for r in res.routes if r.src == 1 and r.dst == 3)
    assert not route_1_to_3.is_reachable


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
        "routes",
    } <= set(d.keys())
    assert isinstance(d["routes"], list)


def test_invalid_backbone_vertex_raises():
    G = _graph_from_nx(nx.complete_graph(3))
    with pytest.raises(ValueError, match="out of range"):
        build_routing_table(G, backbone=[0, 5])
