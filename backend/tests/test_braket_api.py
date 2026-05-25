"""
API integration tests for /api/braket/payload and /api/braket/submit.

These verify the HTTP layer and the graceful-fallback behavior when the
Braket SDK or AWS credentials aren't available.  Schema contract is
covered separately in test_schema_contract.
"""

from __future__ import annotations

import math

import pytest
from fastapi.testclient import TestClient

from api.server import app

client = TestClient(app)


def _request_body(shots: int = 200) -> dict:
    return {
        "positions": [
            {"id": 0, "x": 10.0, "y": 10.0},
            {"id": 1, "x": 15.0, "y": 10.0},
        ],
        "schedule": {
            "omega": {"times": [0.0, 0.4, 3.6, 4.0], "values": [0.0, 15.0, 15.0, 0.0]},
            "delta": {
                "times": [0.0, 0.4, 3.6, 4.0],
                "values": [-30.0, -30.0, 40.0, 40.0],
            },
            "phi": {"times": [0.0, 4.0], "values": [0.0, 0.0]},
            "duration": 4.0,
        },
        "shots": shots,
    }


# --------------------------------------------------------------------------- #
# /api/braket/payload (always works, no AWS)
# --------------------------------------------------------------------------- #


def test_payload_endpoint_returns_full_shape():
    r = client.post("/api/braket/payload", json=_request_body())
    assert r.status_code == 200
    body = r.json()
    assert {
        "payload",
        "cost_estimate",
        "runtime_estimate_seconds",
        "device_arn",
        "preflight_violations",
    } <= set(body.keys())
    assert body["device_arn"].endswith("Aquila")


def test_payload_units_converted_via_endpoint():
    body = client.post("/api/braket/payload", json=_request_body()).json()
    # Sites in meters
    sites = body["payload"]["setup"]["ahs_register"]["sites"]
    assert sites[0][0] == pytest.approx(1e-5, rel=1e-12)  # 10 µm
    # Times in seconds, values in rad/s
    drive = body["payload"]["hamiltonian"]["drivingFields"][0]
    times = drive["amplitude"]["time_series"]["times"]
    assert times[-1] == pytest.approx(4e-6, rel=1e-12)  # 4 µs → 4e-6 s
    omega_max = max(drive["amplitude"]["time_series"]["values"])
    assert omega_max == pytest.approx(1.5e7, rel=1e-12)  # 15 rad/µs → 1.5e7 rad/s


def test_payload_cost_estimate_consistent():
    body = client.post("/api/braket/payload", json=_request_body(shots=300)).json()
    c = body["cost_estimate"]
    assert c["shots"] == 300
    # task + shot fees
    assert c["total_usd"] == pytest.approx(c["task_fee_usd"] + c["shot_fee_usd"])
    # 300 shots at $0.01 each = $3.00 shot fee
    assert c["shot_fee_usd"] == pytest.approx(3.0)


def test_payload_runtime_estimate_grows_with_shots():
    small = client.post("/api/braket/payload", json=_request_body(shots=10)).json()
    big = client.post("/api/braket/payload", json=_request_body(shots=1000)).json()
    assert big["runtime_estimate_seconds"] > small["runtime_estimate_seconds"]


def test_payload_preflight_clean_on_valid_input():
    body = client.post("/api/braket/payload", json=_request_body()).json()
    assert body["preflight_violations"] == []


def test_payload_preflight_flags_too_close_atoms():
    bad = _request_body()
    bad["positions"] = [
        {"id": 0, "x": 10.0, "y": 10.0},
        {"id": 1, "x": 12.0, "y": 10.0},  # 2 µm < 4 µm
    ]
    body = client.post("/api/braket/payload", json=bad).json()
    codes = [v["code"] for v in body["preflight_violations"]]
    assert "site_too_close" in codes


def test_payload_preflight_flags_rabi_overshoot():
    bad = _request_body()
    bad["schedule"]["omega"]["values"] = [0.0, 20.0, 20.0, 0.0]
    body = client.post("/api/braket/payload", json=bad).json()
    codes = [v["code"] for v in body["preflight_violations"]]
    assert "rabi_exceeds_max" in codes


def test_payload_rejects_invalid_shots():
    bad = _request_body()
    bad["shots"] = 0
    r = client.post("/api/braket/payload", json=bad)
    assert r.status_code == 422
    bad["shots"] = 5000
    r = client.post("/api/braket/payload", json=bad)
    assert r.status_code == 422


# --------------------------------------------------------------------------- #
# /api/braket/submit — graceful fallback
# --------------------------------------------------------------------------- #


def test_submit_returns_200_with_submitted_false_when_sdk_or_aws_missing(monkeypatch):
    """When braket SDK is missing, /submit must return 200 with submitted=False
    so the UI can show a friendly explanation instead of crashing."""
    import sys

    # Force the SDK import inside submit_to_braket to fail
    monkeypatch.setitem(sys.modules, "braket", None)
    monkeypatch.setitem(sys.modules, "braket.aws", None)

    body = _request_body()
    body["region"] = "us-east-1"
    r = client.post("/api/braket/submit", json=body)
    assert r.status_code == 200
    payload = r.json()
    assert payload["submitted"] is False
    assert "braket" in payload["message"].lower() or "aws" in payload["message"].lower()


def test_submit_validates_request_body():
    """Bad shots → 422 even before we try to dispatch."""
    bad = _request_body()
    bad["shots"] = -1
    r = client.post("/api/braket/submit", json=bad)
    assert r.status_code == 422


# --------------------------------------------------------------------------- #
# Schema contract
# --------------------------------------------------------------------------- #


def test_payload_json_is_serializable():
    body = client.post("/api/braket/payload", json=_request_body()).json()
    p = body["payload"]
    # Walk the structure once to catch unexpected None / NaN values
    def walk(node):
        if isinstance(node, dict):
            for v in node.values():
                walk(v)
        elif isinstance(node, list):
            for v in node:
                walk(v)
        elif isinstance(node, float):
            assert math.isfinite(node), f"non-finite value in payload: {node}"

    walk(p)
