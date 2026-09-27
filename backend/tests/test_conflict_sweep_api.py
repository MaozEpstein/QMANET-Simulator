"""
End-to-end API tests for /api/graph/conflict/sweep.
"""

from __future__ import annotations

import time

import pytest
from fastapi.testclient import TestClient

from api.server import app
from pipeline.conflict_graph import SWEEP_MAX_LINKS

client = TestClient(app)


def _hang_forever(_connectivity, _interference_radius, _mode="bidirectional"):
    """Stand-in for solve_sweep_point that never returns — module-level (not
    a closure) so it's picklable for submission to a real subprocess."""
    time.sleep(30)
    return 0


def _two_disjoint_links_payload() -> dict:
    return {
        "graph": {
            "n_nodes": 4,
            "edges": [[0, 1], [2, 3]],
            "node_positions": [
                {"id": 0, "x": 0.0, "y": 0.0},
                {"id": 1, "x": 10.0, "y": 0.0},
                {"id": 2, "x": 0.0, "y": 5.0},
                {"id": 3, "x": 10.0, "y": 5.0},
            ],
        }
    }


def test_sweep_returns_one_point_for_two_disjoint_links_unidirectional():
    # Unidirectional: 1 vertex per link -> 2 vertices, 1 possible pair, 1
    # breakpoint (the square's diagonal, hypot(10,5)).
    r = client.post(
        "/api/graph/conflict/sweep",
        json={**_two_disjoint_links_payload(), "mode": "unidirectional"},
    )
    assert r.status_code == 200
    body = r.json()
    assert body["n_links"] == 2
    assert body["n_breakpoints_total"] == 1
    assert body["points"] is not None
    assert len(body["points"]) == 1
    point = body["points"][0]
    assert point["interference_radius"] == pytest.approx((10.0**2 + 5.0**2) ** 0.5)
    # At the breakpoint itself the edge is already on (build_conflict_graph's
    # rule is "<="), so F has one edge between the 2 vertices -> only one of
    # them can be scheduled.
    assert point["mis_size"] == 1


def test_sweep_bidirectional_has_more_vertices_and_breakpoints_than_unidirectional():
    # Bidirectional doubles the vertex count (2 per link -> 4 vertices),
    # which surfaces an extra breakpoint (see test_conflict_graph.py's
    # equivalent case).
    payload = _two_disjoint_links_payload()
    uni = client.post("/api/graph/conflict/sweep", json={**payload, "mode": "unidirectional"}).json()
    bidir = client.post("/api/graph/conflict/sweep", json={**payload, "mode": "bidirectional"}).json()
    assert bidir["n_links"] == 2 * uni["n_links"]
    assert bidir["n_breakpoints_total"] > uni["n_breakpoints_total"]


def test_sweep_returns_null_points_above_link_cap_unidirectional():
    # A "star" of SWEEP_MAX_LINKS + 1 links, all sharing node 0 — every pair
    # conflicts (shared endpoint), so it's cheap to build but still exceeds
    # the link cap that gates the exact-MIS sweep. Unidirectional: vertex
    # count equals link count exactly.
    n_links = SWEEP_MAX_LINKS + 1
    positions = [{"id": 0, "x": 0.0, "y": 0.0}]
    edges = []
    for k in range(1, n_links + 1):
        positions.append({"id": k, "x": float(k), "y": 0.0})
        edges.append([0, k])
    payload = {
        "graph": {"n_nodes": n_links + 1, "edges": edges, "node_positions": positions},
        "mode": "unidirectional",
    }
    r = client.post("/api/graph/conflict/sweep", json=payload)
    assert r.status_code == 200
    body = r.json()
    assert body["points"] is None
    assert body["n_links"] == n_links
    assert body["max_links"] == SWEEP_MAX_LINKS


def test_sweep_bidirectional_cap_uses_doubled_vertex_count():
    # N links where N <= SWEEP_MAX_LINKS but 2*N > SWEEP_MAX_LINKS — must
    # still be rejected in (default) bidirectional mode, since the cap
    # gates the actual F vertex count (2*N here), not the raw link count.
    n_manet_links = SWEEP_MAX_LINKS // 2 + 1
    assert n_manet_links <= SWEEP_MAX_LINKS < 2 * n_manet_links
    positions = [{"id": 0, "x": 0.0, "y": 0.0}]
    edges = []
    for k in range(1, n_manet_links + 1):
        positions.append({"id": k, "x": float(k), "y": 0.0})
        edges.append([0, k])
    payload = {
        "graph": {
            "n_nodes": n_manet_links + 1,
            "edges": edges,
            "node_positions": positions,
        }
    }
    r = client.post("/api/graph/conflict/sweep", json=payload)
    assert r.status_code == 200
    body = r.json()
    assert body["points"] is None
    assert body["n_links"] == 2 * n_manet_links


def test_sweep_subsamples_when_breakpoints_exceed_max_points():
    # 8 disjoint links scattered in 2D (not collinear, so no two link-pairs
    # share the same minimum distance by symmetry) -> C(8,2) = 28 distinct
    # breakpoints, capped to 5.
    import random

    rng = random.Random(42)
    positions = []
    edges = []
    for k in range(8):
        ax, ay = rng.uniform(0, 1000), rng.uniform(0, 1000)
        bx, by = ax + rng.uniform(5, 15), ay + rng.uniform(5, 15)
        positions.append({"id": 2 * k, "x": ax, "y": ay})
        positions.append({"id": 2 * k + 1, "x": bx, "y": by})
        edges.append([2 * k, 2 * k + 1])
    payload = {
        "graph": {"n_nodes": 16, "edges": edges, "node_positions": positions},
        "max_points": 5,
    }
    r = client.post("/api/graph/conflict/sweep", json=payload)
    assert r.status_code == 200
    body = r.json()
    assert body["points"] is not None
    assert len(body["points"]) <= 5
    assert body["n_breakpoints_total"] > len(body["points"])


def test_sweep_reports_timeout_and_keeps_partial_points(monkeypatch):
    """A per-point solve that never returns must not hang the request —
    the endpoint should give up after SWEEP_POINT_TIMEOUT_S and report
    whatever points it already collected."""
    import api.server as server_module

    monkeypatch.setattr(server_module, "SWEEP_POINT_TIMEOUT_S", 0.5)
    monkeypatch.setattr(server_module, "solve_sweep_point", _hang_forever)

    r = client.post("/api/graph/conflict/sweep", json=_two_disjoint_links_payload())
    assert r.status_code == 200
    body = r.json()
    assert body["timed_out"] is True
    assert body["points"] == []


def test_sweep_mode_changes_breakpoints():
    """Same asymmetric geometry as test_conflict_graph.py's
    _asymmetric_geometry: bidirectional's extra (reverse-direction)
    vertices surface a much smaller breakpoint (1.0, node 2 sitting right
    next to node 0) that unidirectional's single-direction vertices never
    see (its only breakpoint is 99.0)."""
    payload = {
        "graph": {
            "n_nodes": 4,
            "edges": [[0, 1], [2, 3]],
            "node_positions": [
                {"id": 0, "x": 0.0, "y": 0.0},
                {"id": 1, "x": 100.0, "y": 0.0},
                {"id": 2, "x": 1.0, "y": 0.0},
                {"id": 3, "x": 200.0, "y": 0.0},
            ],
        }
    }
    bidir = client.post(
        "/api/graph/conflict/sweep", json={**payload, "mode": "bidirectional"}
    ).json()
    unidir = client.post(
        "/api/graph/conflict/sweep", json={**payload, "mode": "unidirectional"}
    ).json()
    assert unidir["n_links"] == 2
    assert bidir["n_links"] == 4
    assert [p["interference_radius"] for p in unidir["points"]] == pytest.approx([99.0])
    assert [p["interference_radius"] for p in bidir["points"]] == pytest.approx([1.0, 99.0])


def test_sweep_rejects_graph_without_positions():
    r = client.post(
        "/api/graph/conflict/sweep",
        json={"graph": {"n_nodes": 3, "edges": [[0, 1], [1, 2]], "node_positions": None}},
    )
    assert r.status_code == 422
