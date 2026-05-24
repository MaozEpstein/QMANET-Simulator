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


# --------------------------------------------------------------------------- #
# /api/embed/atoms -> EmbedResponse  (Phase 2)
# --------------------------------------------------------------------------- #


EMBED_SCHEMA = {
    "positions": list,
    "n_atoms": int,
    "blockade_radius_um": float,
    "induced_edges": list,
    "embedding_fidelity": float,
    "missing_edges": list,
    "spurious_edges": list,
    "violations": list,
}

VIOLATION_SCHEMA = {
    "code": str,
    "message": str,
    "locus": dict,
    "measured": float,
    "limit": float,
}


def test_embed_response_shape():
    body = client.post(
        "/api/embed/atoms",
        json={"target_graph": {"n_nodes": 4, "edges": [[0, 1], [2, 3]], "node_positions": None}},
    ).json()
    _assert_shape(body, EMBED_SCHEMA, "EmbedResponse")
    for p in body["positions"]:
        _assert_shape(p, NODE_POS_SCHEMA, "EmbedResponse.positions")


# --------------------------------------------------------------------------- #
# /api/schedule/build -> ScheduleResponse  (Phase 3)
# --------------------------------------------------------------------------- #


PWL_SCHEMA = {"times": list, "values": list}
SCHEDULE_SCHEMA = {"omega": dict, "delta": dict, "phi": dict, "duration": float}
SCHEDULE_RESP_SCHEMA = {
    "schedule": dict,
    "violations": list,
    "max_omega_slew_rate": float,
}


def test_schedule_response_shape():
    body = client.post("/api/schedule/build", json={"preset": "paper_linear_ramp"}).json()
    _assert_shape(body, SCHEDULE_RESP_SCHEMA, "ScheduleResponse")
    _assert_shape(body["schedule"], SCHEDULE_SCHEMA, "ScheduleResponse.schedule")
    for ch in ("omega", "delta", "phi"):
        _assert_shape(body["schedule"][ch], PWL_SCHEMA, f"ScheduleResponse.schedule.{ch}")
        # Same length on each channel
        assert len(body["schedule"][ch]["times"]) == len(body["schedule"][ch]["values"])
        # Times non-decreasing
        ts = body["schedule"][ch]["times"]
        for i in range(1, len(ts)):
            assert ts[i] >= ts[i - 1]


# --------------------------------------------------------------------------- #
# /api/simulate/run -> SimulateResponse  (Phase 4)
# --------------------------------------------------------------------------- #


FRAME_SCHEMA = {"t_us": float, "rydberg_populations": list, "norm": float}
SIMULATE_RESP_SCHEMA = {
    "frames": list,
    "final_bitstring_probs": dict,
    "n_atoms": int,
    "duration_us": float,
}


def test_simulate_response_shape():
    import math

    omega = 6.0
    t_total = math.pi / (math.sqrt(2) * omega)
    body = client.post(
        "/api/simulate/run",
        json={
            "positions": [
                {"id": 0, "x": 30.0, "y": 30.0},
                {"id": 1, "x": 34.0, "y": 30.0},
            ],
            "schedule": {
                "omega": {"times": [0.0, t_total], "values": [omega, omega]},
                "delta": {"times": [0.0, t_total], "values": [0.0, 0.0]},
                "phi": {"times": [0.0, t_total], "values": [0.0, 0.0]},
                "duration": t_total,
            },
            "n_frames": 10,
        },
    ).json()
    _assert_shape(body, SIMULATE_RESP_SCHEMA, "SimulateResponse")
    for f in body["frames"]:
        _assert_shape(f, FRAME_SCHEMA, "SimulateResponse.frames")
        assert len(f["rydberg_populations"]) == body["n_atoms"]


# --------------------------------------------------------------------------- #
# Phase 5 endpoints
# --------------------------------------------------------------------------- #


MEASURE_RESP_SCHEMA = {
    "bitstrings": list,
    "histogram": dict,
    "n_shots": int,
    "n_atoms": int,
}

POSTPROCESS_RESP_SCHEMA = {
    "raw_bitstring": str,
    "raw_size": int,
    "raw_violations": int,
    "after_fix_bitstring": str,
    "after_fix_size": int,
    "removed": list,
    "final_bitstring": str,
    "final_size": int,
    "added": list,
    "is_valid": bool,
}

SA_RESP_SCHEMA = {
    "best_set": list,
    "best_size": int,
    "best_energy": float,
    "n_iterations": int,
    "energy_trace": list,
}


def test_measure_response_shape():
    body = client.post(
        "/api/measure",
        json={"bitstring_probs": {"00": 0.5, "11": 0.5}, "n_shots": 10, "apply_noise": False},
    ).json()
    _assert_shape(body, MEASURE_RESP_SCHEMA, "MeasureResponse")


def test_postprocess_response_shape():
    body = client.post(
        "/api/postprocess",
        json={
            "bitstring": "10101",
            "target_graph": {"n_nodes": 5, "edges": [[0, 1], [1, 2]], "node_positions": None},
        },
    ).json()
    _assert_shape(body, POSTPROCESS_RESP_SCHEMA, "PostProcessResultDTO")


def test_sa_response_shape():
    body = client.post(
        "/api/classical/sa",
        json={"graph": {"n_nodes": 4, "edges": [], "node_positions": None}},
    ).json()
    _assert_shape(body, SA_RESP_SCHEMA, "SAResponse")


def test_schedule_response_pulse_violation_shape():
    """Pulse violations use the same VIOLATION_SCHEMA as position ones."""
    body = client.post(
        "/api/schedule/build",
        json={
            "omega_breakpoints": [[0.0, 0.0], [1.0, 20.0], [2.0, 0.0]],
            "delta_breakpoints": [[0.0, 0.0], [2.0, 0.0]],
        },
    ).json()
    assert len(body["violations"]) > 0
    for v in body["violations"]:
        _assert_shape(v, VIOLATION_SCHEMA, "ScheduleResponse.violations")


def test_embed_violation_shape_when_present():
    body = client.post(
        "/api/embed/atoms",
        json={"target_graph": {"n_nodes": 300, "edges": [], "node_positions": None}},
    ).json()
    assert len(body["violations"]) > 0
    for v in body["violations"]:
        _assert_shape(v, VIOLATION_SCHEMA, "EmbedResponse.violations")


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
