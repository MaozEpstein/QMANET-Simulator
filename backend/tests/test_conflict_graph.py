"""
Unit tests for pipeline.conflict_graph, focused on
compute_interference_breakpoints — the exact R' values at which |MIS(F)|
can change as a step function.
"""

from __future__ import annotations

import pytest

from pipeline.clique_to_mis import Graph
from pipeline.conflict_graph import build_conflict_graph, compute_interference_breakpoints


def _two_disjoint_links() -> Graph:
    """Two links with no shared endpoint: (0,1) at y=0, (2,3) at y=5, both
    spanning x=0..10. Closest pair of endpoints across the two links is
    (0, 2) and (1, 3), each at distance exactly 5 — the hand-computed
    breakpoint below."""
    positions = [
        {"id": 0, "x": 0.0, "y": 0.0},
        {"id": 1, "x": 10.0, "y": 0.0},
        {"id": 2, "x": 0.0, "y": 5.0},
        {"id": 3, "x": 10.0, "y": 5.0},
    ]
    return Graph(n_nodes=4, edges=[(0, 1), (2, 3)], node_positions=positions)


def test_breakpoint_matches_hand_computed_min_distance():
    bps = compute_interference_breakpoints(_two_disjoint_links())
    assert bps == pytest.approx([5.0])


def test_shared_endpoint_links_contribute_no_breakpoint():
    """(0,1) and (1,2) share node 1 — they always conflict regardless of R',
    so this pair must never produce a breakpoint."""
    positions = [
        {"id": 0, "x": 0.0, "y": 0.0},
        {"id": 1, "x": 10.0, "y": 0.0},
        {"id": 2, "x": 20.0, "y": 0.0},
    ]
    g = Graph(n_nodes=3, edges=[(0, 1), (1, 2)], node_positions=positions)
    assert compute_interference_breakpoints(g) == []


def test_breakpoint_is_exactly_where_the_edge_turns_on():
    g = _two_disjoint_links()
    [bp] = compute_interference_breakpoints(g)
    below = build_conflict_graph(g, bp - 0.01)
    at = build_conflict_graph(g, bp)
    assert below.conflict_graph.edges == []
    assert at.conflict_graph.edges == [(0, 1)]


def test_breakpoints_are_sorted_and_deduplicated():
    # A square of 4 links (a 4-cycle) — several non-adjacent pairs, some
    # sharing the same minimum distance by symmetry.
    positions = [
        {"id": 0, "x": 0.0, "y": 0.0},
        {"id": 1, "x": 10.0, "y": 0.0},
        {"id": 2, "x": 10.0, "y": 10.0},
        {"id": 3, "x": 0.0, "y": 10.0},
    ]
    g = Graph(n_nodes=4, edges=[(0, 1), (1, 2), (2, 3), (3, 0)], node_positions=positions)
    bps = compute_interference_breakpoints(g)
    assert bps == sorted(set(bps))
    assert len(bps) > 0
