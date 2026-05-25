"""
Braket adapter tests — verify unit conversions and payload structure without
any actual AWS calls. The DoD requires:
  - unit conversions rad/µs → rad/s × 10⁶ (specific test)
  - µm → m × 10⁻⁶
  - mocked Braket: payload exactly matches Braket spec

We use no boto3, no mocking framework — the adapter is pure data.
"""

from __future__ import annotations

import json
import math

import pytest

from aquila.braket_adapter import (
    AQUILA_DEVICE_ARN,
    BraketUnavailable,
    PRICE_PER_SHOT_USD,
    PRICE_PER_TASK_USD,
    RAD_PER_US_TO_RAD_PER_S,
    UM_TO_M,
    US_TO_S,
    build_payload,
    estimate_cost,
    estimate_runtime,
    from_payload,
    preflight_check,
    submit_to_braket,
    _payload_size_bytes,
)
from aquila.validator import ViolationCode


# --------------------------------------------------------------------------- #
# Unit conversion constants
# --------------------------------------------------------------------------- #


def test_um_to_m_constant():
    assert UM_TO_M == 1e-6


def test_us_to_s_constant():
    assert US_TO_S == 1e-6


def test_rad_per_us_to_rad_per_s_constant():
    """rad/µs ÷ µs/s = rad/s × 10⁶ — whitepaper §1.3 footnote."""
    assert RAD_PER_US_TO_RAD_PER_S == 1e6


# --------------------------------------------------------------------------- #
# Position conversion µm → m
# --------------------------------------------------------------------------- #


def test_positions_converted_to_meters():
    payload = build_payload(
        positions_um=[(5.0, 10.0), (50.0, 20.0)],
        omega_times_us=[0.0, 4.0],
        omega_values_rad_us=[0.0, 15.0],
        delta_times_us=[0.0, 4.0],
        delta_values_rad_us=[-30.0, 40.0],
        phi_times_us=[0.0, 4.0],
        phi_values_rad=[0.0, 0.0],
    )
    sites = payload.setup["ahs_register"]["sites"]
    # 5 µm = 5e-6 m, 10 µm = 1e-5 m (allow ULP-level FP rounding)
    assert sites[0][0] == pytest.approx(5e-6, rel=1e-12)
    assert sites[0][1] == pytest.approx(1e-5, rel=1e-12)
    assert sites[1][0] == pytest.approx(5e-5, rel=1e-12)
    assert sites[1][1] == pytest.approx(2e-5, rel=1e-12)


def test_filling_always_ones_for_user_specified_sites():
    payload = build_payload(
        positions_um=[(0.0, 0.0), (5.0, 0.0), (10.0, 0.0)],
        omega_times_us=[0.0, 1.0],
        omega_values_rad_us=[0.0, 0.0],
        delta_times_us=[0.0, 1.0],
        delta_values_rad_us=[0.0, 0.0],
        phi_times_us=[0.0, 1.0],
        phi_values_rad=[0.0, 0.0],
    )
    assert payload.setup["ahs_register"]["filling"] == [1, 1, 1]


# --------------------------------------------------------------------------- #
# Time conversion µs → s
# --------------------------------------------------------------------------- #


def test_time_axis_converted_to_seconds():
    payload = build_payload(
        positions_um=[(0.0, 0.0)],
        omega_times_us=[0.0, 0.4, 3.6, 4.0],
        omega_values_rad_us=[0.0, 15.0, 15.0, 0.0],
        delta_times_us=[0.0, 4.0],
        delta_values_rad_us=[-30.0, 40.0],
        phi_times_us=[0.0, 4.0],
        phi_values_rad=[0.0, 0.0],
    )
    drive = payload.hamiltonian["drivingFields"][0]
    amp_times = drive["amplitude"]["time_series"]["times"]
    # 4.0 µs → 4e-6 s
    expected = [0.0, 4e-7, 3.6e-6, 4e-6]
    for got, want in zip(amp_times, expected, strict=True):
        assert got == pytest.approx(want, rel=1e-12, abs=1e-15)


# --------------------------------------------------------------------------- #
# Frequency conversion rad/µs → rad/s
# --------------------------------------------------------------------------- #


def test_omega_converted_to_rad_per_s():
    payload = build_payload(
        positions_um=[(0.0, 0.0)],
        omega_times_us=[0.0, 4.0],
        omega_values_rad_us=[0.0, 15.0],
        delta_times_us=[0.0, 4.0],
        delta_values_rad_us=[0.0, 0.0],
        phi_times_us=[0.0, 4.0],
        phi_values_rad=[0.0, 0.0],
    )
    amp_values = payload.hamiltonian["drivingFields"][0]["amplitude"]["time_series"]["values"]
    # 15 rad/µs → 1.5e7 rad/s
    assert amp_values[0] == pytest.approx(0.0)
    assert amp_values[1] == pytest.approx(1.5e7, rel=1e-12)


def test_delta_converted_to_rad_per_s():
    payload = build_payload(
        positions_um=[(0.0, 0.0)],
        omega_times_us=[0.0, 4.0],
        omega_values_rad_us=[0.0, 0.0],
        delta_times_us=[0.0, 4.0],
        delta_values_rad_us=[-30.0, 40.0],
        phi_times_us=[0.0, 4.0],
        phi_values_rad=[0.0, 0.0],
    )
    det_values = payload.hamiltonian["drivingFields"][0]["detuning"]["time_series"]["values"]
    assert det_values[0] == pytest.approx(-3.0e7, rel=1e-12)
    assert det_values[1] == pytest.approx(4.0e7, rel=1e-12)


def test_phi_is_dimensionless_and_not_scaled():
    """Phase is in radians (dimensionless); only the time axis converts."""
    payload = build_payload(
        positions_um=[(0.0, 0.0)],
        omega_times_us=[0.0, 1.0],
        omega_values_rad_us=[0.0, 0.0],
        delta_times_us=[0.0, 1.0],
        delta_values_rad_us=[0.0, 0.0],
        phi_times_us=[0.0, 1.0],
        phi_values_rad=[0.5, -math.pi],
    )
    phs_values = payload.hamiltonian["drivingFields"][0]["phase"]["time_series"]["values"]
    assert phs_values == [0.5, -math.pi]


# --------------------------------------------------------------------------- #
# Round-trip
# --------------------------------------------------------------------------- #


def test_payload_roundtrip_preserves_values():
    """Building a payload and parsing it back must return the original inputs."""
    inputs = dict(
        positions_um=[(0.0, 0.0), (5.5, 7.2), (12.3, 4.1)],
        omega_times_us=[0.0, 0.4, 3.6, 4.0],
        omega_values_rad_us=[0.0, 15.0, 15.0, 0.0],
        delta_times_us=[0.0, 0.4, 3.6, 4.0],
        delta_values_rad_us=[-30.0, -30.0, 40.0, 40.0],
        phi_times_us=[0.0, 4.0],
        phi_values_rad=[0.0, 0.0],
        shots=200,
    )
    payload = build_payload(**inputs)
    parsed = from_payload(payload)
    for k, v in inputs.items():
        assert parsed[k] == v, f"mismatch on {k}: {parsed[k]} != {v}"


# --------------------------------------------------------------------------- #
# Payload structure / spec conformance
# --------------------------------------------------------------------------- #


def test_payload_top_level_keys_match_braket_spec():
    payload = build_payload(
        positions_um=[(0.0, 0.0)],
        omega_times_us=[0.0, 1.0],
        omega_values_rad_us=[0.0, 0.0],
        delta_times_us=[0.0, 1.0],
        delta_values_rad_us=[0.0, 0.0],
        phi_times_us=[0.0, 1.0],
        phi_values_rad=[0.0, 0.0],
        shots=10,
    )
    d = payload.to_dict()
    assert {"setup", "hamiltonian", "shots"} <= set(d.keys())
    assert "ahs_register" in d["setup"]
    assert {"sites", "filling"} <= set(d["setup"]["ahs_register"].keys())
    assert "drivingFields" in d["hamiltonian"]
    assert "shiftingFields" in d["hamiltonian"]


def test_payload_driving_fields_shape():
    """Each drivingField has {amplitude, phase, detuning}; each of those has
    {time_series: {times, values}, pattern}."""
    payload = build_payload(
        positions_um=[(0.0, 0.0)],
        omega_times_us=[0.0, 1.0],
        omega_values_rad_us=[0.0, 0.0],
        delta_times_us=[0.0, 1.0],
        delta_values_rad_us=[0.0, 0.0],
        phi_times_us=[0.0, 1.0],
        phi_values_rad=[0.0, 0.0],
    )
    drive = payload.hamiltonian["drivingFields"][0]
    for channel in ("amplitude", "phase", "detuning"):
        assert channel in drive
        assert {"time_series", "pattern"} <= set(drive[channel].keys())
        ts = drive[channel]["time_series"]
        assert {"times", "values"} <= set(ts.keys())
        assert len(ts["times"]) == len(ts["values"])


def test_payload_is_json_serializable():
    payload = build_payload(
        positions_um=[(0.0, 0.0), (5.0, 0.0)],
        omega_times_us=[0.0, 4.0],
        omega_values_rad_us=[0.0, 15.0],
        delta_times_us=[0.0, 4.0],
        delta_values_rad_us=[-30.0, 40.0],
        phi_times_us=[0.0, 4.0],
        phi_values_rad=[0.0, 0.0],
        shots=200,
    )
    # If this raises, the payload contains a non-serializable value.
    s = json.dumps(payload.to_dict())
    assert "drivingFields" in s
    # Reasonable size (< 100 KB for small jobs)
    assert _payload_size_bytes(payload) < 100_000


def test_payload_rejects_zero_shots():
    with pytest.raises(ValueError, match="shots"):
        build_payload(
            positions_um=[(0.0, 0.0)],
            omega_times_us=[0.0, 1.0],
            omega_values_rad_us=[0.0, 0.0],
            delta_times_us=[0.0, 1.0],
            delta_values_rad_us=[0.0, 0.0],
            phi_times_us=[0.0, 1.0],
            phi_values_rad=[0.0, 0.0],
            shots=0,
        )


# --------------------------------------------------------------------------- #
# Preflight check
# --------------------------------------------------------------------------- #


def test_preflight_passes_on_clean_job():
    out = preflight_check(
        positions_um=[(0.0, 0.0), (5.0, 0.0)],
        omega_values_rad_us=[0.0, 15.0, 0.0],
        delta_values_rad_us=[-30.0, 40.0],
        duration_us=4.0,
    )
    assert out == []


def test_preflight_flags_duration_overshoot():
    out = preflight_check(
        positions_um=[(0.0, 0.0)],
        omega_values_rad_us=[0.0],
        delta_values_rad_us=[0.0],
        duration_us=5.0,
    )
    assert any(v.code == ViolationCode.DURATION_EXCEEDED for v in out)


def test_preflight_flags_rabi_overshoot():
    out = preflight_check(
        positions_um=[(0.0, 0.0)],
        omega_values_rad_us=[0.0, 20.0, 0.0],
        delta_values_rad_us=[0.0],
        duration_us=1.0,
    )
    assert any(v.code == ViolationCode.RABI_EXCEEDS_MAX for v in out)


def test_preflight_flags_detuning_overshoot():
    out = preflight_check(
        positions_um=[(0.0, 0.0)],
        omega_values_rad_us=[0.0],
        delta_values_rad_us=[-150.0],
        duration_us=1.0,
    )
    assert any(v.code == ViolationCode.DETUNING_OUT_OF_RANGE for v in out)


def test_preflight_flags_position_issues():
    """Positions too close → SITE_TOO_CLOSE via validate_positions."""
    out = preflight_check(
        positions_um=[(0.0, 0.0), (3.0, 0.0)],  # 3 µm < 4 µm minimum
        omega_values_rad_us=[0.0],
        delta_values_rad_us=[0.0],
        duration_us=1.0,
    )
    assert any(v.code == ViolationCode.SITE_TOO_CLOSE for v in out)


# --------------------------------------------------------------------------- #
# Cost + runtime
# --------------------------------------------------------------------------- #


def test_cost_formula():
    est = estimate_cost(shots=100)
    assert est.task_fee_usd == PRICE_PER_TASK_USD
    assert est.shot_fee_usd == 100 * PRICE_PER_SHOT_USD
    assert est.total_usd == est.task_fee_usd + est.shot_fee_usd


def test_cost_zero_shots():
    est = estimate_cost(shots=0)
    assert est.shot_fee_usd == 0.0
    assert est.total_usd == est.task_fee_usd


def test_runtime_grows_with_shots():
    a = estimate_runtime(50)
    b = estimate_runtime(500)
    assert b > a


def test_cost_to_dict():
    est = estimate_cost(200)
    d = est.to_dict()
    assert {"shot_fee_usd", "task_fee_usd", "total_usd", "shots"} <= set(d.keys())


# --------------------------------------------------------------------------- #
# Device ARN
# --------------------------------------------------------------------------- #


def test_device_arn_format():
    assert AQUILA_DEVICE_ARN == "arn:aws:braket:us-east-1::device/qpu/quera/Aquila"


# --------------------------------------------------------------------------- #
# submit_to_braket — must fail clean when SDK / credentials missing
# --------------------------------------------------------------------------- #


def test_submit_raises_braket_unavailable_when_sdk_missing(monkeypatch):
    """If `import braket` fails, we get a typed BraketUnavailable, not a generic ImportError."""
    import sys

    # Force the import to fail by inserting an empty module that has no submodules
    monkeypatch.setitem(sys.modules, "braket", None)
    monkeypatch.setitem(sys.modules, "braket.aws", None)

    payload = build_payload(
        positions_um=[(0.0, 0.0)],
        omega_times_us=[0.0, 1.0],
        omega_values_rad_us=[0.0, 0.0],
        delta_times_us=[0.0, 1.0],
        delta_values_rad_us=[0.0, 0.0],
        phi_times_us=[0.0, 1.0],
        phi_values_rad=[0.0, 0.0],
    )
    with pytest.raises(BraketUnavailable):
        submit_to_braket(payload)
