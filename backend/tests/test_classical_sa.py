"""
Simulated annealing tests.

Contracts:
  - K_n: α = 1
  - empty G: α = n
  - C_n: α = floor(n/2)
  - P_n: α = ceil(n/2)
  - returned set is always a valid IS
  - matches exact MIS on small random graphs (within a tolerance)
  - reproducibility under fixed seed
"""

from __future__ import annotations

import networkx as nx
import pytest

from pipeline.classical_sa import SAConfig, simulated_annealing
from pipeline.clique_to_mis import Graph, is_independent_set, max_independent_set


def _graph_from_nx(G: nx.Graph) -> Graph:
    return Graph(
        n_nodes=G.number_of_nodes(),
        edges=[(int(u), int(v)) for u, v in G.edges() if u < v],
    )


def test_empty_graph_returns_empty_result():
    res = simulated_annealing(Graph(n_nodes=0, edges=[]))
    assert res.best_set == ()
    assert res.best_size == 0
    assert res.n_iterations == 0


def test_complete_graph_yields_singleton_is():
    """K_n has α=1; SA must return a single-vertex IS."""
    for n in [4, 6, 10]:
        res = simulated_annealing(_graph_from_nx(nx.complete_graph(n)), SAConfig(seed=1))
        assert res.best_size == 1


def test_edgeless_graph_yields_all_vertices():
    """No edges ⇒ MIS = all vertices."""
    res = simulated_annealing(_graph_from_nx(nx.empty_graph(8)), SAConfig(seed=1))
    assert res.best_size == 8


def test_cycle_graph_alpha_equals_floor_half():
    """α(C_n) = floor(n/2)."""
    for n in [4, 6, 8, 10]:
        res = simulated_annealing(_graph_from_nx(nx.cycle_graph(n)), SAConfig(seed=2))
        assert res.best_size == n // 2


def test_path_graph_alpha_equals_ceil_half():
    """α(P_n) = ceil(n/2)."""
    for n in [3, 5, 7, 9]:
        res = simulated_annealing(_graph_from_nx(nx.path_graph(n)), SAConfig(seed=3))
        assert res.best_size == (n + 1) // 2


def test_returned_set_is_always_independent():
    G = _graph_from_nx(nx.gnp_random_graph(20, p=0.4, seed=7))
    res = simulated_annealing(G, SAConfig(seed=11, n_sweeps=300))
    assert is_independent_set(G, list(res.best_set))


@pytest.mark.parametrize("seed", range(5))
def test_property_matches_exact_mis_on_small_graphs(seed):
    """For n=12 random graphs, SA should find the true α within ±1."""
    G = _graph_from_nx(nx.gnp_random_graph(12, p=0.5, seed=seed))
    exact = len(max_independent_set(G))
    res = simulated_annealing(G, SAConfig(seed=seed, n_sweeps=500))
    # On 12 nodes with enough sweeps, SA should be tight.
    assert res.best_size >= exact - 1, (
        f"SA only found {res.best_size} on graph with α={exact}"
    )


def test_seed_reproducibility():
    G = _graph_from_nx(nx.gnp_random_graph(15, p=0.4, seed=4))
    a = simulated_annealing(G, SAConfig(seed=99))
    b = simulated_annealing(G, SAConfig(seed=99))
    assert a.best_set == b.best_set
    assert a.energy_trace == b.energy_trace


def test_different_seeds_diverge_eventually():
    G = _graph_from_nx(nx.gnp_random_graph(15, p=0.5, seed=4))
    a = simulated_annealing(G, SAConfig(seed=1))
    b = simulated_annealing(G, SAConfig(seed=2))
    # Different runs typically have different traces (not necessarily different best_size)
    assert a.energy_trace != b.energy_trace


def test_energy_trace_length_matches_sweeps_plus_one():
    """One initial sample + one per sweep."""
    G = _graph_from_nx(nx.gnp_random_graph(10, p=0.3, seed=0))
    cfg = SAConfig(n_sweeps=50, seed=0)
    res = simulated_annealing(G, cfg)
    assert len(res.energy_trace) == cfg.n_sweeps + 1


def test_bitstring_property_consistent_with_best_set():
    G = _graph_from_nx(nx.cycle_graph(6))
    res = simulated_annealing(G, SAConfig(seed=1))
    bs = res.bitstring
    set_from_bits = {i for i, ch in enumerate(bs) if ch == "1"}
    assert set_from_bits == set(res.best_set)


def test_to_dict_roundtrip_friendly():
    G = _graph_from_nx(nx.complete_graph(4))
    res = simulated_annealing(G, SAConfig(seed=1))
    d = res.to_dict()
    assert {"best_set", "best_size", "best_energy", "n_iterations", "energy_trace"} <= set(d.keys())
    assert isinstance(d["best_set"], list)
