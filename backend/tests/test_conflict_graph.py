"""
Unit tests for pipeline.conflict_graph.

Covers both the geometric breakpoint computation and — the actual point of
ConflictMode — that "unidirectional" and "bidirectional" produce a
*different number of F vertices* (one vs two per MANET link), not just a
different edge rule over the same vertex set.
"""

from __future__ import annotations

import pytest

from pipeline.clique_to_mis import Graph
from pipeline.conflict_graph import build_conflict_graph, compute_interference_breakpoints


def _two_disjoint_links() -> Graph:
    """Two links with no shared endpoint: (0,1) at y=0, (2,3) at y=5, both
    spanning x=0..10 — a symmetric square arrangement."""
    positions = [
        {"id": 0, "x": 0.0, "y": 0.0},
        {"id": 1, "x": 10.0, "y": 0.0},
        {"id": 2, "x": 0.0, "y": 5.0},
        {"id": 3, "x": 10.0, "y": 5.0},
    ]
    return Graph(n_nodes=4, edges=[(0, 1), (2, 3)], node_positions=positions)


def test_unidirectional_has_one_breakpoint_per_link_pair():
    # Unidirectional: vertices are (0,1) and (2,3) (already min->max). The
    # only relevant distances are sender<->receiver across the two links:
    # dist(0,3)=dist(2,1)=hypot(10,5) — both diagonals of the square.
    bps = compute_interference_breakpoints(_two_disjoint_links(), mode="unidirectional")
    assert bps == pytest.approx([(10.0**2 + 5.0**2) ** 0.5])


def test_bidirectional_has_more_breakpoints_than_unidirectional():
    # Bidirectional generates 4 vertices (both directions of each link),
    # producing additional sender<->receiver pairs (e.g. (0,1)-vertex's
    # reverse against (2,3)-vertex's reverse) at a different distance (5,
    # the square's side) than the unidirectional diagonal (~11.18).
    g = _two_disjoint_links()
    uni_bps = compute_interference_breakpoints(g, mode="unidirectional")
    bidir_bps = compute_interference_breakpoints(g, mode="bidirectional")
    assert len(bidir_bps) > len(uni_bps)
    assert bidir_bps == pytest.approx([5.0, (10.0**2 + 5.0**2) ** 0.5])


def test_shared_endpoint_links_contribute_no_breakpoint():
    """(0,1) and (1,2) share node 1 — they always conflict regardless of R',
    so this pair must never produce a breakpoint, in either mode."""
    positions = [
        {"id": 0, "x": 0.0, "y": 0.0},
        {"id": 1, "x": 10.0, "y": 0.0},
        {"id": 2, "x": 20.0, "y": 0.0},
    ]
    g = Graph(n_nodes=3, edges=[(0, 1), (1, 2)], node_positions=positions)
    assert compute_interference_breakpoints(g, mode="unidirectional") == []
    assert compute_interference_breakpoints(g, mode="bidirectional") == []


def test_breakpoint_is_exactly_where_the_edge_turns_on():
    g = _two_disjoint_links()
    [bp] = compute_interference_breakpoints(g, mode="unidirectional")
    below = build_conflict_graph(g, bp - 0.01, mode="unidirectional")
    at = build_conflict_graph(g, bp, mode="unidirectional")
    assert below.conflict_graph.edges == []
    assert at.conflict_graph.edges == [(0, 1)]


def _asymmetric_geometry() -> Graph:
    """Link A=(0,1) spans a long way (0,0)-(100,0); link B=(2,3) has one
    endpoint (node 2) sitting right next to A's sender (node 0), the other
    (node 3) far away. This produces a case where the *reverse* direction
    of each link is what's actually close to the other link — exactly the
    situation bidirectional's extra vertices are meant to catch."""
    positions = [
        {"id": 0, "x": 0.0, "y": 0.0},
        {"id": 1, "x": 100.0, "y": 0.0},
        {"id": 2, "x": 1.0, "y": 0.0},
        {"id": 3, "x": 200.0, "y": 0.0},
    ]
    return Graph(n_nodes=4, edges=[(0, 1), (2, 3)], node_positions=positions)


def test_unidirectional_has_n_links_vertices_bidirectional_has_2n():
    g = _asymmetric_geometry()
    uni = build_conflict_graph(g, 1.0, mode="unidirectional")
    bidir = build_conflict_graph(g, 1.0, mode="bidirectional")
    n_links = len(g.edges)
    assert uni.conflict_graph.n_nodes == n_links
    assert bidir.conflict_graph.n_nodes == 2 * n_links
    assert len(uni.link_endpoints) == n_links
    assert len(bidir.link_endpoints) == 2 * n_links


def test_same_link_directions_always_conflict_in_bidirectional_mode():
    """The two directed vertices from the *same* MANET link (i->j and j->i)
    must always conflict with each other (shared endpoints — half-duplex,
    same two radios) — regardless of R'."""
    g = _asymmetric_geometry()
    result = build_conflict_graph(g, interference_radius=0.001, mode="bidirectional")
    # Vertices 0,1 are link (0,1)'s two directions; 2,3 are link (2,3)'s.
    assert (0, 1) in result.conflict_graph.edges
    assert (2, 3) in result.conflict_graph.edges


def test_bidirectional_catches_a_conflict_unidirectional_misses():
    """At R'=50: the *forward* direction of each link is far from the
    other link (distance ~99-200), so unidirectional (one vertex per link,
    fixed direction) sees no conflict at all. But each link's *reverse*
    direction is close to the other link's forward direction (distance 1),
    so bidirectional's extra vertices do conflict."""
    g = _asymmetric_geometry()
    r = 50.0
    uni = build_conflict_graph(g, r, mode="unidirectional")
    assert uni.conflict_graph.edges == []

    bidir = build_conflict_graph(g, r, mode="bidirectional")
    # (0,1) and (2,3) always conflict with themselves (shared endpoints);
    # beyond that, at least one cross-link pair must conflict too.
    cross_edges = [
        e for e in bidir.conflict_graph.edges if e not in [(0, 1), (2, 3)]
    ]
    assert len(cross_edges) > 0
