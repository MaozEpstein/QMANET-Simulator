"""
Post-process tests.

Contracts:
  - After step A, S is always an independent set.
  - After step B, S is always a *maximal* IS (can't add any more).
  - Size never decreases between step A → step B.
  - For a valid IS input, step A leaves it unchanged.
  - For K_n input with one vertex set, step A removes nothing.
  - For an empty bitstring input, step B finds *some* MIS.
  - Postprocess is reproducible with a fixed seed.
"""

from __future__ import annotations

import networkx as nx
import pytest

from pipeline.clique_to_mis import Graph
from pipeline.postprocess import (
    bitstring_to_set,
    count_violations,
    greedy_extend_to_mis,
    greedy_remove_violations,
    postprocess,
    postprocess_many,
    set_to_bitstring,
    summarize_postprocess,
    _adjacency_sets,
)


def _graph_from_nx(G: nx.Graph) -> Graph:
    return Graph(
        n_nodes=G.number_of_nodes(),
        edges=[(int(u), int(v)) for u, v in G.edges() if u < v],
    )


# --------------------------------------------------------------------------- #
# Bitstring helpers
# --------------------------------------------------------------------------- #


def test_bitstring_to_set_roundtrip():
    s = bitstring_to_set("10110")
    assert s == {0, 2, 3}
    assert set_to_bitstring(s, 5) == "10110"


def test_set_to_bitstring_respects_length():
    assert set_to_bitstring({1, 3}, 5) == "01010"


# --------------------------------------------------------------------------- #
# Violation counting
# --------------------------------------------------------------------------- #


def test_count_violations_zero_on_empty_set():
    G = _graph_from_nx(nx.complete_graph(5))
    assert count_violations(set(), _adjacency_sets(G)) == 0


def test_count_violations_on_complete_graph():
    G = _graph_from_nx(nx.complete_graph(5))
    adj = _adjacency_sets(G)
    # All 5 in S → C(5,2) = 10 violations
    assert count_violations(set(range(5)), adj) == 10


def test_count_violations_path():
    G = _graph_from_nx(nx.path_graph(4))  # 0-1-2-3
    adj = _adjacency_sets(G)
    # S = {0, 1, 3} → edges (0,1) and not (1,3); only one violation
    assert count_violations({0, 1, 3}, adj) == 1


# --------------------------------------------------------------------------- #
# Greedy remove
# --------------------------------------------------------------------------- #


def test_remove_violations_makes_independent_set():
    G = _graph_from_nx(nx.gnp_random_graph(15, p=0.4, seed=11))
    adj = _adjacency_sets(G)
    # Start with the full vertex set — guaranteed many violations
    S, removed = greedy_remove_violations(set(range(15)), adj)
    assert count_violations(S, adj) == 0
    assert all(v in range(15) for v in removed)
    assert len(removed) + len(S) == 15  # nothing duplicated


def test_remove_violations_on_already_independent_set_is_noop():
    G = _graph_from_nx(nx.path_graph(6))  # 0-1-2-3-4-5
    adj = _adjacency_sets(G)
    S = {0, 2, 4}  # already an IS
    out, removed = greedy_remove_violations(S, adj)
    assert out == S
    assert removed == []


def test_remove_violations_on_complete_graph_keeps_one_vertex():
    """K_n: any IS has size 1, so the greedy must remove n-1 vertices."""
    G = _graph_from_nx(nx.complete_graph(6))
    adj = _adjacency_sets(G)
    S, removed = greedy_remove_violations(set(range(6)), adj)
    assert len(S) == 1
    assert len(removed) == 5


@pytest.mark.parametrize("seed", range(8))
def test_property_remove_violations_always_clean(seed):
    G = _graph_from_nx(nx.gnp_random_graph(20, p=0.5, seed=seed))
    adj = _adjacency_sets(G)
    S, _ = greedy_remove_violations(set(range(20)), adj)
    assert count_violations(S, adj) == 0


# --------------------------------------------------------------------------- #
# Greedy extend
# --------------------------------------------------------------------------- #


def test_extend_empty_finds_mis_on_empty_graph():
    """For an edge-free graph on n=10, max IS = all vertices."""
    G = _graph_from_nx(nx.empty_graph(10))
    adj = _adjacency_sets(G)
    S, added = greedy_extend_to_mis(set(), adj, n=10, seed=42)
    assert S == set(range(10))
    assert sorted(added) == list(range(10))


def test_extend_is_maximal_after_step():
    """After step B, no vertex can still be added."""
    G = _graph_from_nx(nx.gnp_random_graph(15, p=0.3, seed=3))
    adj = _adjacency_sets(G)
    S, _ = greedy_extend_to_mis(set(), adj, n=15, seed=0)
    # For every vertex not in S, at least one neighbor must be in S
    for v in range(15):
        if v not in S:
            assert adj[v] & S, f"vertex {v} could still be added"


def test_extend_never_creates_violation():
    G = _graph_from_nx(nx.gnp_random_graph(12, p=0.5, seed=9))
    adj = _adjacency_sets(G)
    S, _ = greedy_extend_to_mis(set(), adj, n=12, seed=1)
    assert count_violations(S, adj) == 0


# --------------------------------------------------------------------------- #
# Top-level postprocess
# --------------------------------------------------------------------------- #


def test_postprocess_full_pipeline_valid_output():
    G = _graph_from_nx(nx.gnp_random_graph(12, p=0.45, seed=7))
    # Some noisy bitstring with violations
    raw = "111100110010"
    res = postprocess(raw, G, seed=0)
    assert res.is_valid
    assert res.raw_size == raw.count("1")
    assert res.after_fix_size <= res.raw_size
    assert res.final_size >= res.after_fix_size
    # final bitstring is consistent
    final_set = bitstring_to_set(res.final_bitstring)
    assert len(final_set) == res.final_size


def test_postprocess_rejects_wrong_length_bitstring():
    G = _graph_from_nx(nx.complete_graph(4))
    with pytest.raises(ValueError, match="length"):
        postprocess("11", G)


def test_postprocess_on_all_zero_input_extends_to_some_mis():
    """All-zero input → empty IS → step B fills it to an MIS."""
    G = _graph_from_nx(nx.cycle_graph(6))
    res = postprocess("000000", G, seed=0)
    assert res.raw_size == 0
    assert res.raw_violations == 0
    # C_6 has α = 3
    assert res.final_size == 3
    assert res.is_valid


def test_postprocess_on_all_ones_input_recovers():
    """All-one input on K_5 → step A removes 4, step B can't add any."""
    G = _graph_from_nx(nx.complete_graph(5))
    res = postprocess("11111", G, seed=0)
    assert res.raw_violations == 10
    assert res.after_fix_size == 1
    assert res.final_size == 1
    assert res.is_valid


def test_postprocess_seed_reproducible():
    G = _graph_from_nx(nx.gnp_random_graph(14, p=0.5, seed=2))
    raw = "11000110100101"
    a = postprocess(raw, G, seed=42)
    b = postprocess(raw, G, seed=42)
    assert a.final_bitstring == b.final_bitstring


def test_postprocess_size_invariants():
    """raw_size − removed + added = final_size."""
    G = _graph_from_nx(nx.gnp_random_graph(20, p=0.4, seed=5))
    raw = "11" * 10
    res = postprocess(raw, G, seed=1)
    assert res.raw_size - len(res.removed) + len(res.added) == res.final_size


# --------------------------------------------------------------------------- #
# Property-style on random graphs / random bitstrings
# --------------------------------------------------------------------------- #


@pytest.mark.parametrize("seed", range(10))
def test_property_postprocess_always_returns_valid_is(seed):
    import numpy as np

    G = _graph_from_nx(nx.gnp_random_graph(16, p=0.4, seed=seed))
    rng = np.random.default_rng(seed)
    raw = "".join("1" if rng.random() < 0.5 else "0" for _ in range(16))
    res = postprocess(raw, G, seed=seed)
    assert res.is_valid


# --------------------------------------------------------------------------- #
# Many-shots wrapper
# --------------------------------------------------------------------------- #


def test_postprocess_many_returns_one_result_per_shot():
    G = _graph_from_nx(nx.gnp_random_graph(8, p=0.4, seed=1))
    shots = ["10101010", "11111111", "00000000", "01010101"]
    out = postprocess_many(shots, G, seed=0)
    assert len(out) == 4
    assert all(r.is_valid for r in out)


def test_summarize_returns_means_and_best():
    G = _graph_from_nx(nx.empty_graph(5))  # everything is an IS
    shots = ["00000", "10000", "11100"]
    out = postprocess_many(shots, G, seed=0)
    summary = summarize_postprocess(out)
    assert summary["n_shots"] == 3
    # mean final_size = 5 (every shot extends to all 5 vertices on empty G)
    assert summary["mean_final_size"] == 5.0
    assert summary["best_final_size"] == 5


def test_summarize_empty_list():
    summary = summarize_postprocess([])
    assert summary["n_shots"] == 0
