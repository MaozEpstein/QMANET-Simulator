"""
Edge cases and degenerate inputs across all current backend modules.
These are the cases real users hit when sliders go to extremes.
"""

from __future__ import annotations

import math

import networkx as nx
import pytest

from aquila.constants import blockade_radius_um, MAX_RABI_RAD_US, C6_RAD_US_UM6
from pipeline import clique_to_mis as cqm
from pipeline import manet


# --------------------------------------------------------------------------- #
# blockade_radius_um — physical correctness
# --------------------------------------------------------------------------- #


def test_blockade_negative_omega_treated_as_magnitude():
    """Omega is an amplitude; magnitude enters energy scale via Omega^2."""
    r_pos = blockade_radius_um(omega=10.0)
    r_neg = blockade_radius_um(omega=-10.0)
    assert math.isclose(r_pos, r_neg)


def test_blockade_increases_when_field_weakens():
    """As (Ω,Δ) shrink, the blockade radius grows — weaker drive = more blockade reach."""
    r_strong = blockade_radius_um(omega=15.0, delta=0.0)
    r_weak = blockade_radius_um(omega=1.0, delta=0.0)
    assert r_weak > r_strong


def test_blockade_units_consistent_with_aquila_paper():
    """
    At Ω = 15 rad/μs (Ebadi2022's value), R_b should be in the few-μm range
    that Aquila's whitepaper §6 uses (5–9 μm for the unit-disk graphs).
    """
    r = blockade_radius_um(omega=15.0)
    assert 5.0 < r < 12.0, f"R_b={r} μm is outside the realistic Aquila regime"


def test_blockade_formula_with_detuning():
    """Sanity check the formula r = (C6 / sqrt(Ω²+Δ²))^(1/6)."""
    omega, delta = 10.0, 3.0
    energy = math.sqrt(omega**2 + delta**2)
    expected = (C6_RAD_US_UM6 / energy) ** (1.0 / 6.0)
    assert math.isclose(blockade_radius_um(omega, delta), expected)


def test_blockade_at_max_rabi_below_min_spacing_does_not_panic():
    """Even at the largest Rabi the hardware allows, the function returns a finite positive value."""
    r = blockade_radius_um(omega=MAX_RABI_RAD_US, delta=0.0)
    assert 0 < r < 1000


# --------------------------------------------------------------------------- #
# MANET — geometric edge cases
# --------------------------------------------------------------------------- #


def test_manet_minimum_size_n2():
    snap = manet.generate(manet.MANETConfig(n_nodes=2, box_size=10.0, comm_radius=100.0, seed=0))
    assert len(snap.nodes) == 2
    assert snap.edges == [(0, 1)]  # always connected when R is huge


def test_manet_zero_comm_radius_no_edges():
    snap = manet.generate(manet.MANETConfig(n_nodes=20, comm_radius=1e-6, seed=0))
    assert snap.edges == []


def test_manet_huge_comm_radius_is_complete():
    n = 12
    snap = manet.generate(manet.MANETConfig(n_nodes=n, box_size=10.0, comm_radius=1e6, seed=0))
    assert len(snap.edges) == n * (n - 1) // 2


def test_manet_edges_are_undirected_unique():
    """Each edge appears at most once, with u<v."""
    snap = manet.generate(manet.MANETConfig(n_nodes=24, comm_radius=40.0, seed=99))
    seen = set()
    for u, v in snap.edges:
        assert u < v, f"edge ({u},{v}) not in canonical form"
        assert (u, v) not in seen
        seen.add((u, v))


def test_manet_no_self_loops():
    snap = manet.generate(manet.MANETConfig(n_nodes=30, comm_radius=50.0, seed=7))
    for u, v in snap.edges:
        assert u != v


@pytest.mark.parametrize("seed", range(8))
def test_manet_adjacency_matrix_symmetric(seed):
    snap = manet.generate(manet.MANETConfig(n_nodes=15, comm_radius=30.0, seed=seed))
    A = snap.adjacency()
    assert (A == A.T).all()
    assert (A.diagonal() == 0).all()


# --------------------------------------------------------------------------- #
# Complement / MIS — degenerate graphs
# --------------------------------------------------------------------------- #


def test_complement_n0_returns_empty():
    g = cqm.Graph(n_nodes=0, edges=[])
    gbar = cqm.complement(g)
    assert gbar.n_nodes == 0
    assert gbar.edges == []


def test_complement_n1_returns_single_node_no_edges():
    g = cqm.Graph(n_nodes=1, edges=[])
    gbar = cqm.complement(g)
    assert gbar.n_nodes == 1
    assert gbar.edges == []


def test_max_clique_on_singleton_is_1():
    g = cqm.Graph(n_nodes=1, edges=[])
    assert cqm.max_clique(g) == [0]


def test_max_clique_on_two_isolated_nodes_is_1():
    g = cqm.Graph(n_nodes=2, edges=[])
    assert len(cqm.max_clique(g)) == 1


def test_max_clique_on_single_edge_is_2():
    g = cqm.Graph(n_nodes=2, edges=[(0, 1)])
    assert cqm.max_clique(g) == [0, 1]


def test_star_graph_max_clique_is_2():
    """K_{1,n} (star): largest clique = an edge = 2 vertices."""
    G = nx.star_graph(7)  # 1 center + 7 leaves = 8 nodes
    g = cqm.Graph(
        n_nodes=G.number_of_nodes(),
        edges=[(int(u), int(v)) for u, v in G.edges() if u < v],
    )
    assert len(cqm.max_clique(g)) == 2
    # And α(K_{1,n}) = n (the leaves form an MIS)
    assert len(cqm.max_independent_set(g)) == 7


def test_cycle_c6_alpha_equals_3():
    """C_6: α = 3 (every other vertex)."""
    G = nx.cycle_graph(6)
    g = cqm.Graph(
        n_nodes=6,
        edges=[(int(u), int(v)) for u, v in G.edges() if u < v],
    )
    assert len(cqm.max_independent_set(g)) == 3


@pytest.mark.parametrize("n,p,seed", [(8, 0.3, i) for i in range(10)] + [(15, 0.6, i) for i in range(5)])
def test_property_complement_double_involution(n, p, seed):
    """Ḡ̄ = G as multisets of edges."""
    G = nx.gnp_random_graph(n, p=p, seed=seed)
    g = cqm.Graph(n_nodes=n, edges=[(int(u), int(v)) for u, v in G.edges() if u < v])
    g_dd = cqm.complement(cqm.complement(g))
    assert set(map(tuple, g.edges)) == {(u, v) for u, v in g_dd.edges}


@pytest.mark.parametrize("seed", range(10))
def test_property_clique_size_plus_complement_independence_invariant(seed):
    """For any graph: ω(G) = α(Ḡ)."""
    G = nx.gnp_random_graph(15, p=0.5, seed=seed)
    g = cqm.Graph(n_nodes=15, edges=[(int(u), int(v)) for u, v in G.edges() if u < v])
    assert len(cqm.max_clique(g)) == len(cqm.max_independent_set(cqm.complement(g)))


# --------------------------------------------------------------------------- #
# is_clique / is_independent_set — validators must be honest
# --------------------------------------------------------------------------- #


def test_is_clique_detects_missing_edge():
    g = cqm.Graph(n_nodes=3, edges=[(0, 1), (0, 2)])  # missing (1,2)
    assert not cqm.is_clique(g, [0, 1, 2])
    assert cqm.is_clique(g, [0, 1])
    assert cqm.is_clique(g, [0, 2])


def test_is_independent_set_detects_edge():
    g = cqm.Graph(n_nodes=3, edges=[(0, 1)])
    assert not cqm.is_independent_set(g, [0, 1])
    assert cqm.is_independent_set(g, [0, 2])
    assert cqm.is_independent_set(g, [1, 2])


def test_singleton_subsets_are_trivially_both():
    g = cqm.Graph(n_nodes=5, edges=[(0, 1), (1, 2)])
    for v in range(5):
        assert cqm.is_clique(g, [v])
        assert cqm.is_independent_set(g, [v])
