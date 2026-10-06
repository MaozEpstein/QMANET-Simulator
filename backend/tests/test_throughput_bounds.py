"""
Tests for pipeline.throughput_bounds and /api/graph/conflict/bounds.
"""

from __future__ import annotations

import math

import networkx as nx
import pytest
from fastapi.testclient import TestClient

from api.server import app
from pipeline.clique_to_mis import Graph, from_networkx, is_clique, is_independent_set
from pipeline.conflict_graph import build_conflict_graph
from pipeline.throughput_bounds import BOUNDS_MAX_VERTICES, compute_throughput_bounds

client = TestClient(app)


def _g(G: nx.Graph) -> Graph:
    return from_networkx(nx.convert_node_labels_to_integers(G))


@pytest.mark.parametrize(
    "G, omega, chi_f, chi",
    [
        (nx.cycle_graph(5), 2, 2.5, 3),
        (nx.cycle_graph(7), 2, 7 / 3, 3),
        (nx.petersen_graph(), 2, 2.5, 3),
        (nx.mycielski_graph(4), 2, 2.9, 4),  # Grötzsch graph
        (nx.complete_graph(5), 5, 5.0, 5),
        (nx.path_graph(6), 2, 2.0, 2),
        (nx.empty_graph(4), 1, 1.0, 1),
    ],
)
def test_known_fractional_chromatic_numbers(G, omega, chi_f, chi):
    b = compute_throughput_bounds(_g(G))
    assert b.omega == omega
    assert b.chi == chi
    assert b.chi_f == pytest.approx(chi_f, abs=1e-6)
    assert b.chi_f_exact


def test_bounds_are_ordered_and_certificates_are_valid():
    G = nx.mycielski_graph(4)
    f = _g(G)
    b = compute_throughput_bounds(f)
    assert b.lower_bound <= b.lp_bound + 1e-12 <= b.upper_bound + 1e-12
    assert is_clique(f, b.max_clique)
    for u, v in f.edges:
        assert b.coloring[u] != b.coloring[v]
    assert sum(s.fraction for s in b.lp_schedule) == pytest.approx(1.0)
    # The LP schedule must give every vertex at least lp_bound of the frame.
    share = [0.0] * f.n_nodes
    for slot in b.lp_schedule:
        assert is_independent_set(f, slot.links)
        for v in slot.links:
            share[v] += slot.fraction
    assert min(share) >= b.lp_bound - 1e-9


def test_perfect_case_skips_column_generation():
    b = compute_throughput_bounds(_g(nx.complete_graph(4)))
    assert b.chi == b.omega == 4
    assert b.lp_iterations == 0
    assert len(b.lp_schedule) == 4


def test_empty_graph():
    b = compute_throughput_bounds(Graph(n_nodes=0, edges=[]))
    assert b.omega == 0 and b.chi == 0


def test_pentagon_conflict_graph_has_a_gap():
    """Frontend's 'Pentagon' example geometry: unidirectional F = C5."""
    rho, delta = 40.0, math.radians(15)
    positions, edges = [], []
    for k in range(5):
        theta = -math.pi / 2 + 2 * math.pi * k / 5
        positions.append({"id": 2 * k, "x": rho * math.cos(theta - delta), "y": rho * math.sin(theta - delta)})
        positions.append({"id": 2 * k + 1, "x": rho * math.cos(theta + delta), "y": rho * math.sin(theta + delta)})
        edges.append((2 * k, 2 * k + 1))
    c = Graph(n_nodes=10, edges=edges, node_positions=positions)
    f = build_conflict_graph(c, 45.0, "unidirectional").conflict_graph
    b = compute_throughput_bounds(f)
    assert (b.lower_bound, b.lp_bound, b.upper_bound) == pytest.approx((1 / 3, 0.4, 0.5))


def test_api_returns_bounds():
    G = nx.cycle_graph(5)
    r = client.post(
        "/api/graph/conflict/bounds",
        json={"graph": {"n_nodes": 5, "edges": [list(e) for e in G.edges]}},
    )
    assert r.status_code == 200
    body = r.json()
    assert body["n_vertices"] == 5
    b = body["bounds"]
    assert b["omega"] == 2 and b["chi"] == 3
    assert b["upper_bound"] == pytest.approx(0.5)
    assert b["lp_bound"] == pytest.approx(0.4)
    assert b["lower_bound"] == pytest.approx(1 / 3)
    assert b["chi_f_exact"] is True


def test_api_returns_null_above_cap():
    n = BOUNDS_MAX_VERTICES + 1
    r = client.post("/api/graph/conflict/bounds", json={"graph": {"n_nodes": n, "edges": []}})
    assert r.status_code == 200
    body = r.json()
    assert body["bounds"] is None
    assert body["max_vertices"] == BOUNDS_MAX_VERTICES
