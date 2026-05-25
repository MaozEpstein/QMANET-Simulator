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


# --------------------------------------------------------------------------- #
# all_max_cliques — degeneracy enumeration powering Stage 2's "cycle through
# alternative optima" UI.
# --------------------------------------------------------------------------- #


def test_all_max_cliques_returns_one_for_unique_optimum():
    """A path P_4 has many maximal cliques (all edges) but they are all of
    size 2 — so there are exactly C(3,1)=3 max cliques tied at size 2."""
    g = cqm.Graph(n_nodes=4, edges=[(0, 1), (1, 2), (2, 3)])
    cliques, total = cqm.all_max_cliques(g)
    assert total == 3
    assert len(cliques) == 3
    for c in cliques:
        assert len(c) == 2 and cqm.is_clique(g, c)


def test_all_max_cliques_handles_complete_graph():
    """K_n has a single max clique (the whole vertex set)."""
    g = cqm.Graph(n_nodes=5, edges=[(i, j) for i in range(5) for j in range(i + 1, 5)])
    cliques, total = cqm.all_max_cliques(g)
    assert total == 1
    assert cliques == [[0, 1, 2, 3, 4]]


def test_all_max_cliques_first_matches_legacy_max_clique():
    """Stage 3 still reads `max_clique_in_G` (= cliques[0]). Pinning this so
    the listing path and the legacy single-clique path agree on the optimum
    size for every random seed."""
    for n, p, seed in [(8, 0.5, 1), (10, 0.6, 2), (12, 0.3, 3)]:
        G = nx.gnp_random_graph(n, p=p, seed=seed)
        g = _nxgraph_to_dto(G)
        legacy = cqm.max_clique(g)
        listing, total = cqm.all_max_cliques(g)
        assert total >= 1
        assert len(listing[0]) == len(legacy)
        # Every listed clique is a real clique of the optimum size.
        for c in listing:
            assert cqm.is_clique(g, c)
            assert len(c) == len(legacy)


def test_all_max_cliques_caps_at_limit():
    """K_{4,4} (complete bipartite) has every edge as a max clique = 16 of
    them. We expect the response to be capped at MAX_CLIQUE_ENUM_LIMIT (12)
    while still reporting the true total."""
    edges = [(i, j) for i in range(4) for j in range(4, 8)]
    g = cqm.Graph(n_nodes=8, edges=edges)
    listing, total = cqm.all_max_cliques(g)
    assert total == 16
    assert len(listing) == cqm.MAX_CLIQUE_ENUM_LIMIT


def test_all_max_cliques_empty_graph_returns_nothing():
    g = cqm.Graph(n_nodes=0, edges=[])
    cliques, total = cqm.all_max_cliques(g)
    assert cliques == [] and total == 0


# --------------------------------------------------------------------------- #
# alpha + chromatic bounds — the section-א metrics Stage 2 reads.
# --------------------------------------------------------------------------- #


def test_alpha_equals_mis_size_for_random_graphs():
    """α(G) = |max_independent_set(G)|. Tied via the dedicated helper so any
    drift between them is caught immediately."""
    for n, p, seed in [(8, 0.4, 1), (12, 0.5, 2), (16, 0.3, 3)]:
        G = nx.gnp_random_graph(n, p=p, seed=seed)
        g = _nxgraph_to_dto(G)
        assert cqm.alpha(g) == len(cqm.max_independent_set(g))


def test_alpha_handles_edge_cases():
    assert cqm.alpha(cqm.Graph(n_nodes=0, edges=[])) == 0
    # K_5 — any IS is a single vertex
    k5 = cqm.Graph(n_nodes=5, edges=[(i, j) for i in range(5) for j in range(i + 1, 5)])
    assert cqm.alpha(k5) == 1
    # Empty graph on 5 nodes — every vertex is independent
    e5 = cqm.Graph(n_nodes=5, edges=[])
    assert cqm.alpha(e5) == 5


def test_chromatic_bounds_for_complete_and_empty_graphs():
    # K_n needs exactly n colors — exact bound from both sides.
    k4 = cqm.Graph(n_nodes=4, edges=[(i, j) for i in range(4) for j in range(i + 1, 4)])
    assert cqm.chromatic_bounds(k4) == (4, 4)
    # Empty graph: one color suffices.
    e5 = cqm.Graph(n_nodes=5, edges=[])
    assert cqm.chromatic_bounds(e5) == (1, 1)


def test_chromatic_bounds_for_bipartite_is_two():
    """Even-cycle C_4 and K_{3,3} are bipartite → χ = 2. Both bounds equal 2."""
    c4 = cqm.Graph(n_nodes=4, edges=[(0, 1), (1, 2), (2, 3), (3, 0)])
    lo, hi = cqm.chromatic_bounds(c4)
    assert lo == 2 and hi == 2

    k33 = cqm.Graph(n_nodes=6, edges=[(i, j) for i in range(3) for j in range(3, 6)])
    lo, hi = cqm.chromatic_bounds(k33)
    assert lo == 2 and hi == 2


def test_chromatic_bounds_monotonic_lower_le_upper():
    """The lower bound (= ω) must never exceed the upper bound (= greedy)."""
    for seed in range(8):
        G = nx.gnp_random_graph(10, p=0.5, seed=seed)
        g = _nxgraph_to_dto(G)
        lo, hi = cqm.chromatic_bounds(g)
        assert lo <= hi


def test_chromatic_lower_equals_clique_number():
    """The lower bound is ω(G). Spot-check this is the actual contract,
    not just a coincidence."""
    g = cqm.Graph(n_nodes=5, edges=[(0, 1), (1, 2), (0, 2), (3, 4)])
    lo, _ = cqm.chromatic_bounds(g)
    # Triangle (0,1,2) → ω = 3
    assert lo == 3


def test_manet_large_radius_is_complete():
    snap = manet.generate(manet.MANETConfig(n_nodes=8, box_size=10.0, comm_radius=1000.0, seed=0))
    n = 8
    assert len(snap.edges) == n * (n - 1) // 2
