"""
Schema contract tests.

These fail loudly the moment a backend field is renamed/removed/retyped without
the corresponding update on the frontend (frontend/src/api/rest.ts). They're
the cheapest way to catch a class of bugs that would otherwise only appear at
runtime in the browser.

The contract is expressed as the set of required keys + their JSON types.
"""

from __future__ import annotations

from typing import Any

from fastapi.testclient import TestClient

from api.server import app

client = TestClient(app)


def _types_match(value: Any, expected: type | tuple[type, ...]) -> bool:
    """Allow JSON int/float interchange for `float` expectations."""
    if expected is float:
        return isinstance(value, (int, float))
    if isinstance(expected, tuple):
        return any(_types_match(value, t) for t in expected)
    return isinstance(value, expected)


def _assert_shape(obj: dict, schema: dict[str, type | tuple[type, ...]], where: str = "root"):
    for key, expected in schema.items():
        assert key in obj, f"{where}: missing key '{key}' (have: {list(obj.keys())})"
        assert _types_match(obj[key], expected), (
            f"{where}.{key}: expected {expected}, got {type(obj[key]).__name__}={obj[key]!r}"
        )


# --------------------------------------------------------------------------- #
# /api/aquila must match frontend/src/api/rest.ts:AquilaSpec
# --------------------------------------------------------------------------- #


AQUILA_SCHEMA = {
    "max_qubits": int,
    "max_width_um": float,
    "max_height_um": float,
    "min_site_spacing_um": float,
    "min_row_spacing_um": float,
    "max_rabi_rad_us": float,
    "rabi_slew_rate": float,
    "detuning_max_rad_us": float,
    "max_duration_us": float,
    "c6_rad_us_um6": float,
    "noise": dict,
}


def test_aquila_spec_shape_matches_frontend_contract():
    body = client.get("/api/aquila").json()
    _assert_shape(body, AQUILA_SCHEMA, "AquilaSpec")
    # noise sub-object: the frontend treats it as Record<string, number>
    for k, v in body["noise"].items():
        assert isinstance(k, str)
        assert _types_match(v, float), f"noise.{k} must be numeric, got {type(v).__name__}"


# --------------------------------------------------------------------------- #
# /api/manet/generate -> MANETResponse
# --------------------------------------------------------------------------- #


GRAPH_SCHEMA = {
    "n_nodes": int,
    "edges": list,
    "node_positions": (list, type(None)),
}

NODE_POS_SCHEMA = {"id": int, "x": float, "y": float}

MANET_CONFIG_SCHEMA = {
    "n_nodes": int,
    "box_size": float,
    "comm_radius": float,
    "seed": (int, type(None)),
}


def test_manet_response_shape():
    body = client.post("/api/manet/generate", json={"n_nodes": 6, "seed": 1}).json()
    _assert_shape(body, {"graph": dict, "config": dict}, "MANETResponse")
    _assert_shape(body["graph"], GRAPH_SCHEMA, "MANETResponse.graph")
    _assert_shape(body["config"], MANET_CONFIG_SCHEMA, "MANETResponse.config")
    # Edges are pairs of ints
    for e in body["graph"]["edges"]:
        assert isinstance(e, list) and len(e) == 2
        assert all(isinstance(x, int) for x in e)
    # Node positions match NodePos
    assert body["graph"]["node_positions"] is not None
    for p in body["graph"]["node_positions"]:
        _assert_shape(p, NODE_POS_SCHEMA, "NodePos")


# --------------------------------------------------------------------------- #
# /api/graph/complement -> MISResponse
# --------------------------------------------------------------------------- #


MIS_SCHEMA = {
    "graph": dict,
    "complement": dict,
    "max_clique_in_G": list,
    "mis_in_complement": list,
    "size": int,
}


def test_mis_response_shape():
    body = client.post(
        "/api/graph/complement",
        json={
            "graph": {"n_nodes": 3, "edges": [[0, 1], [1, 2]], "node_positions": None}
        },
    ).json()
    _assert_shape(body, MIS_SCHEMA, "MISResponse")
    _assert_shape(body["graph"], GRAPH_SCHEMA, "MISResponse.graph")
    _assert_shape(body["complement"], GRAPH_SCHEMA, "MISResponse.complement")
    # The vertex lists contain ints
    for v in body["max_clique_in_G"]:
        assert isinstance(v, int)
    for v in body["mis_in_complement"]:
        assert isinstance(v, int)


def test_mis_response_max_clique_and_mis_consistent():
    """The 'max_clique_in_G' and 'mis_in_complement' lists are two names for the same set."""
    body = client.post(
        "/api/graph/complement",
        json={
            "graph": {
                "n_nodes": 4,
                "edges": [[0, 1], [0, 2], [1, 2]],
                "node_positions": None,
            }
        },
    ).json()
    assert set(body["max_clique_in_G"]) == set(body["mis_in_complement"])
    assert len(body["max_clique_in_G"]) == body["size"]
