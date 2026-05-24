"""
Verify the clique ↔ MIS reduction:
  - Complement is an involution.
  - MaxClique(G) is an independent set in the complement Ḡ.
  - The optimal set is the same on both sides, just renamed.
"""

from __future__ import annotations

import networkx as nx
import pytest

from pipeline import clique_to_mis as cqm
from pipeline import manet


def _nxgraph_to_dto(G: nx.Graph) -> cqm.Graph:
    return cqm.Graph(
        n_nodes=G.number_of_nodes(),
        edges=[(int(u), int(v)) for u, v in G.edges() if u < v],
    )


def test_complement_is_involution_on_random_graphs():
    for seed in range(5):
        G = nx.gnp_random_graph(10, p=0.4, seed=seed)
        g = _nxgraph_to_dto(G)
        g_double_bar = cqm.complement(cqm.complement(g))
        assert set(map(tuple, g.edges)) == {(u, v) for u, v in g_double_bar.edges}


def test_complete_graph_complement_is_empty():
    G = nx.complete_graph(8)
    gbar = cqm.complement(_nxgraph_to_dto(G))
    assert gbar.edges == []


def test_max_clique_equals_mis_in_complement():
    """The set itself should match — by construction these are dual problems."""
    for n, p, seed in [(8, 0.5, 1), (10, 0.6, 2), (12, 0.3, 3), (14, 0.7, 4)]:
        G = nx.gnp_random_graph(n, p=p, seed=seed)
        g = _nxgraph_to_dto(G)
        clique = cqm.max_clique(g)
        mis = cqm.max_independent_set(cqm.complement(g))
        assert clique == mis, f"n={n} p={p} seed={seed}: {clique} != {mis}"


def test_returned_clique_is_a_real_clique():
    G = nx.gnp_random_graph(12, p=0.6, seed=7)
    g = _nxgraph_to_dto(G)
    clique = cqm.max_clique(g)
    assert cqm.is_clique(g, clique)


def test_returned_mis_is_independent():
    G = nx.gnp_random_graph(12, p=0.4, seed=11)
    g = _nxgraph_to_dto(G)
    mis = cqm.max_independent_set(g)
    assert cqm.is_independent_set(g, mis)


def test_known_small_graph():
    """Triangle (K3): max clique = 3 nodes; complement (empty graph): MIS = all 3."""
    g = cqm.Graph(n_nodes=3, edges=[(0, 1), (0, 2), (1, 2)])
    assert cqm.max_clique(g) == [0, 1, 2]
    assert cqm.max_independent_set(cqm.complement(g)) == [0, 1, 2]


def test_path_graph_mis_size():
    """P_n (path on n nodes) has α = ceil(n/2)."""
    for n in [3, 5, 7, 10]:
        G = nx.path_graph(n)
        g = _nxgraph_to_dto(G)
        assert len(cqm.max_independent_set(g)) == (n + 1) // 2


def test_too_large_raises():
    g = cqm.Graph(n_nodes=cqm.EXACT_MIS_MAX_NODES + 1, edges=[])
    with pytest.raises(ValueError):
        cqm.max_independent_set(g)


def test_manet_generation_reproducible():
    cfg = manet.MANETConfig(n_nodes=20, box_size=100.0, comm_radius=40.0, seed=42)
    s1 = manet.generate(cfg)
    s2 = manet.generate(cfg)
    assert [n["id"] for n in s1.nodes] == [n["id"] for n in s2.nodes]
    assert [(n["x"], n["y"]) for n in s1.nodes] == [(n["x"], n["y"]) for n in s2.nodes]
    assert s1.edges == s2.edges


def test_manet_edges_respect_comm_radius():
    cfg = manet.MANETConfig(n_nodes=15, box_size=50.0, comm_radius=20.0, seed=1)
    snap = manet.generate(cfg)
    pos = {n["id"]: (n["x"], n["y"]) for n in snap.nodes}
    for u, v in snap.edges:
        dx = pos[u][0] - pos[v][0]
        dy = pos[u][1] - pos[v][1]
        assert (dx * dx + dy * dy) ** 0.5 <= cfg.comm_radius + 1e-9


def test_manet_zero_radius_has_no_edges():
    snap = manet.generate(manet.MANETConfig(n_nodes=10, comm_radius=0.001, seed=0))
    assert snap.edges == []


def test_manet_large_radius_is_complete():
    snap = manet.generate(manet.MANETConfig(n_nodes=8, box_size=10.0, comm_radius=1000.0, seed=0))
    n = 8
    assert len(snap.edges) == n * (n - 1) // 2
