"""
End-to-end tests for /api/simulate/run and /ws/simulate.

REST is straightforward: we POST a small (2-atom) job and verify the response
shape + physics (final populations make sense for a π-pulse).

WebSocket uses FastAPI's TestClient.websocket_connect. We send a single
SimulateRequest, then read frame messages until we get a "done" terminator.
We verify:
  - the protocol envelope (type field + payloads)
  - the frame count matches request.n_frames
  - times are monotone
  - we get a terminating "done" message
"""

from __future__ import annotations

import math

from fastapi.testclient import TestClient

from api.server import app

client = TestClient(app)


def _two_atom_pi_pulse_request(n_frames: int = 30) -> dict:
    """
    A constant Ω=6 rad/µs for π/(√2 Ω) µs on two atoms 4 µm apart.
    Expected end-state (per test_simulate.py): each atom at ⟨n̂⟩ ≈ 0.5 (W state).
    """
    omega = 6.0
    t_total = math.pi / (math.sqrt(2) * omega)
    return {
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
        "n_frames": n_frames,
    }


# --------------------------------------------------------------------------- #
# REST endpoint
# --------------------------------------------------------------------------- #


def test_simulate_run_returns_full_response_shape():
    r = client.post("/api/simulate/run", json=_two_atom_pi_pulse_request(n_frames=20))
    assert r.status_code == 200
    body = r.json()
    assert {"frames", "final_bitstring_probs", "n_atoms", "duration_us"} <= set(body.keys())
    assert body["n_atoms"] == 2
    assert len(body["frames"]) == 20
    for f in body["frames"]:
        assert {"t_us", "rydberg_populations", "norm"} <= set(f.keys())
        assert len(f["rydberg_populations"]) == 2


def test_simulate_run_initial_frame_is_ground_state():
    body = client.post("/api/simulate/run", json=_two_atom_pi_pulse_request(15)).json()
    pops0 = body["frames"][0]["rydberg_populations"]
    assert pops0[0] < 1e-6
    assert pops0[1] < 1e-6


def test_simulate_run_norm_stays_unity():
    body = client.post("/api/simulate/run", json=_two_atom_pi_pulse_request(15)).json()
    for f in body["frames"]:
        assert abs(f["norm"] - 1.0) < 1e-3


def test_simulate_run_final_w_state_for_blockaded_pair():
    body = client.post("/api/simulate/run", json=_two_atom_pi_pulse_request(15)).json()
    n1, n2 = body["frames"][-1]["rydberg_populations"]
    assert abs(n1 - n2) < 5e-3
    assert 0.4 < n1 < 0.6


def test_simulate_run_bitstring_probs_sum_to_one():
    body = client.post("/api/simulate/run", json=_two_atom_pi_pulse_request(15)).json()
    total = sum(body["final_bitstring_probs"].values())
    assert abs(total - 1.0) < 1e-3


def test_simulate_run_rejects_n_frames_below_2():
    payload = _two_atom_pi_pulse_request(15)
    payload["n_frames"] = 1
    r = client.post("/api/simulate/run", json=payload)
    assert r.status_code == 422


def test_simulate_run_rejects_n_frames_above_600():
    payload = _two_atom_pi_pulse_request(15)
    payload["n_frames"] = 1000
    r = client.post("/api/simulate/run", json=payload)
    assert r.status_code == 422


def test_simulate_run_zero_atoms_returns_empty_frames():
    payload = _two_atom_pi_pulse_request(15)
    payload["positions"] = []
    body = client.post("/api/simulate/run", json=payload).json()
    assert body["frames"] == []
    assert body["n_atoms"] == 0


# --------------------------------------------------------------------------- #
# WebSocket
# --------------------------------------------------------------------------- #


def test_ws_streams_frames_and_terminates_with_done():
    with client.websocket_connect("/ws/simulate") as ws:
        ws.send_json(_two_atom_pi_pulse_request(n_frames=10))

        frame_count = 0
        last_t = -1.0
        terminator = None
        for _ in range(50):  # safety upper bound
            msg = ws.receive_json()
            if msg["type"] == "frame":
                frame_count += 1
                t = msg["frame"]["t_us"]
                assert t >= last_t, "frame times must be non-decreasing"
                last_t = t
            elif msg["type"] == "done":
                terminator = msg
                break
            elif msg["type"] == "error":
                raise AssertionError(f"unexpected error: {msg}")
        assert frame_count == 10
        assert terminator is not None
        assert terminator["n_atoms"] == 2


def test_ws_returns_error_for_invalid_payload():
    with client.websocket_connect("/ws/simulate") as ws:
        ws.send_text('{"this":"is not a SimulateRequest"}')
        msg = ws.receive_json()
        assert msg["type"] == "error"


# --------------------------------------------------------------------------- #
# End-to-end pipeline including simulation
# --------------------------------------------------------------------------- #


def test_pipeline_through_simulation():
    """MANET → complement → embed → schedule → simulate end-to-end."""
    m = client.post("/api/manet/generate", json={"n_nodes": 4, "seed": 7}).json()
    c = client.post("/api/graph/complement", json={"graph": m["graph"]}).json()
    e = client.post(
        "/api/embed/atoms",
        json={
            "target_graph": c["complement"],
            "config": {"rabi_rad_us": 12.0, "lattice_spacing_um": 5.0},
        },
    ).json()
    s = client.post("/api/schedule/build", json={"preset": "paper_linear_ramp"}).json()
    sim = client.post(
        "/api/simulate/run",
        json={
            "positions": e["positions"],
            "schedule": s["schedule"],
            "n_frames": 20,
        },
    ).json()
    assert sim["n_atoms"] == 4
    assert len(sim["frames"]) == 20
    # Each atom population must be in [0, 1] at every frame
    for f in sim["frames"]:
        for p in f["rydberg_populations"]:
            assert -1e-6 <= p <= 1.0 + 1e-3
