"""
End-to-end API tests for /api/schedule/build and /api/schedule/presets.

Verifies:
  - Preset endpoint enumerates registered presets
  - Build endpoint accepts a preset name and returns the proper schedule
  - Build endpoint accepts custom breakpoints
  - Validation errors produce 422
  - Violations are returned in body (200, not 4xx) for runtime issues like
    Ω > 15.8 or slew > 250 — so the UI can render ConstraintBadges
"""

from __future__ import annotations

from fastapi.testclient import TestClient

from api.server import app

client = TestClient(app)


# --------------------------------------------------------------------------- #
# Presets enumeration
# --------------------------------------------------------------------------- #


def test_presets_endpoint_lists_known_presets():
    r = client.get("/api/schedule/presets")
    assert r.status_code == 200
    names = r.json()["presets"]
    assert "paper_linear_ramp" in names
    assert "bernien_2017_sweep" in names


# --------------------------------------------------------------------------- #
# Build with preset
# --------------------------------------------------------------------------- #


def test_build_with_paper_preset_returns_full_schedule_shape():
    r = client.post("/api/schedule/build", json={"preset": "paper_linear_ramp"})
    assert r.status_code == 200
    body = r.json()
    assert set(body.keys()) == {"schedule", "violations", "max_omega_slew_rate"}
    s = body["schedule"]
    assert set(s.keys()) == {"omega", "delta", "phi", "duration"}
    assert s["duration"] == 4.0
    # Ω plateaus at 15
    assert max(s["omega"]["values"]) == 15.0
    # Δ sweeps from -30 to 40
    assert min(s["delta"]["values"]) == -30.0
    assert max(s["delta"]["values"]) == 40.0
    # Clean: no violations on the default preset
    assert body["violations"] == []


def test_build_paper_preset_with_custom_params():
    r = client.post(
        "/api/schedule/build",
        json={
            "preset": "paper_linear_ramp",
            "preset_params": {
                "t_total_us": 3.0,
                "omega_max_rad_us": 10.0,
                "delta_initial_rad_us": -20.0,
                "delta_final_rad_us": 20.0,
            },
        },
    )
    assert r.status_code == 200
    body = r.json()
    assert body["schedule"]["duration"] == 3.0
    assert max(body["schedule"]["omega"]["values"]) == 10.0


def test_build_unknown_preset_returns_422():
    r = client.post("/api/schedule/build", json={"preset": "no_such_preset"})
    assert r.status_code == 422


def test_build_invalid_preset_params_returns_422():
    r = client.post(
        "/api/schedule/build",
        json={"preset": "paper_linear_ramp", "preset_params": {"ramp_up_fraction": 0.9}},
    )
    assert r.status_code == 422


# --------------------------------------------------------------------------- #
# Build with explicit breakpoints
# --------------------------------------------------------------------------- #


def test_build_with_explicit_breakpoints():
    r = client.post(
        "/api/schedule/build",
        json={
            "omega_breakpoints": [[0.0, 0.0], [1.0, 10.0], [2.0, 0.0]],
            "delta_breakpoints": [[0.0, -10.0], [2.0, 10.0]],
        },
    )
    assert r.status_code == 200
    body = r.json()
    assert body["schedule"]["omega"]["values"] == [0.0, 10.0, 0.0]
    assert body["schedule"]["delta"]["values"] == [-10.0, 10.0]


def test_build_missing_required_payload_returns_422():
    r = client.post("/api/schedule/build", json={})
    assert r.status_code == 422


def test_build_with_invalid_breakpoint_order_returns_422():
    r = client.post(
        "/api/schedule/build",
        json={
            "omega_breakpoints": [[0.0, 0.0], [2.0, 10.0], [1.0, 0.0]],  # times go backwards
            "delta_breakpoints": [[0.0, 0.0], [2.0, 0.0]],
        },
    )
    assert r.status_code == 422


# --------------------------------------------------------------------------- #
# Violations surfaced in 200 response (not 4xx)
# --------------------------------------------------------------------------- #


def test_violations_surfaced_when_omega_exceeds_max():
    r = client.post(
        "/api/schedule/build",
        json={
            "omega_breakpoints": [[0.0, 0.0], [1.0, 20.0], [2.0, 0.0]],
            "delta_breakpoints": [[0.0, 0.0], [2.0, 0.0]],
        },
    )
    assert r.status_code == 200
    codes = [v["code"] for v in r.json()["violations"]]
    assert "rabi_exceeds_max" in codes


def test_violations_surfaced_when_slew_too_steep():
    r = client.post(
        "/api/schedule/build",
        json={
            "omega_breakpoints": [[0.0, 0.0], [0.01, 15.0], [1.0, 0.0]],
            "delta_breakpoints": [[0.0, 0.0], [1.0, 0.0]],
        },
    )
    body = r.json()
    codes = [v["code"] for v in body["violations"]]
    assert "slew_rate_exceeded" in codes
    assert body["max_omega_slew_rate"] > 250.0


def test_violations_surfaced_when_duration_too_long():
    r = client.post(
        "/api/schedule/build",
        json={
            "omega_breakpoints": [[0.0, 0.0], [5.0, 0.0]],
            "delta_breakpoints": [[0.0, 0.0], [5.0, 0.0]],
        },
    )
    codes = [v["code"] for v in r.json()["violations"]]
    assert "duration_exceeded" in codes


# --------------------------------------------------------------------------- #
# Round-trip with embed flow (smoke test of full pipeline so far)
# --------------------------------------------------------------------------- #


def test_full_pipeline_through_schedule():
    """MANET → complement → embed → schedule must all succeed in sequence."""
    m = client.post("/api/manet/generate", json={"n_nodes": 6, "seed": 1}).json()
    c = client.post("/api/graph/complement", json={"graph": m["graph"]}).json()
    e = client.post("/api/embed/atoms", json={"target_graph": c["complement"]}).json()
    assert e["n_atoms"] == 6
    s = client.post("/api/schedule/build", json={"preset": "paper_linear_ramp"}).json()
    assert s["schedule"]["duration"] == 4.0
    assert s["violations"] == []
