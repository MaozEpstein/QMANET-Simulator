"""
Schedule + pulse-validation tests.

Coverage:
  - PiecewiseLinear: interpolation, slew rate, edge cases
  - Constructor invariants (monotone times)
  - Presets reproduce expected paper protocols
  - Pulse validator: each rule pos/neg/boundary
  - Property: random valid pulses pass validation
"""

from __future__ import annotations

import math

import pytest

from aquila.constants import AQUILA
from aquila.validator import ViolationCode
from pipeline.schedule import (
    PiecewiseLinear,
    PRESETS,
    Schedule,
    bernien_2017_sweep,
    from_breakpoints,
    paper_linear_ramp,
    paper_smooth_blackman,
    validate_schedule,
)


# --------------------------------------------------------------------------- #
# PiecewiseLinear
# --------------------------------------------------------------------------- #


def test_piecewise_linear_basic_interpolation():
    pl = PiecewiseLinear.from_lists([0.0, 1.0, 3.0], [0.0, 10.0, 20.0])
    assert pl.value_at(0.0) == 0.0
    assert pl.value_at(0.5) == 5.0  # midpoint of first segment
    assert pl.value_at(1.0) == 10.0
    assert pl.value_at(2.0) == 15.0  # midpoint of second segment
    assert pl.value_at(3.0) == 20.0


def test_piecewise_linear_clamps_outside_range():
    pl = PiecewiseLinear.from_lists([1.0, 2.0], [5.0, 7.0])
    assert pl.value_at(-100.0) == 5.0
    assert pl.value_at(100.0) == 7.0


def test_piecewise_linear_empty_returns_zero():
    pl = PiecewiseLinear(times=(), values=())
    assert pl.value_at(0.5) == 0.0
    assert pl.duration == 0.0
    assert pl.max_slew_rate() == 0.0


def test_piecewise_linear_single_point():
    pl = PiecewiseLinear.from_lists([0.0], [3.0])
    assert pl.value_at(0.0) == 3.0
    assert pl.value_at(5.0) == 3.0  # clamped


def test_piecewise_linear_rejects_decreasing_times():
    with pytest.raises(ValueError, match="non-decreasing"):
        PiecewiseLinear.from_lists([0.0, 1.0, 0.5], [0.0, 1.0, 2.0])


def test_piecewise_linear_rejects_mismatched_lengths():
    with pytest.raises(ValueError):
        PiecewiseLinear(times=(0.0, 1.0), values=(0.0,))


def test_piecewise_linear_zero_duration_segment_handled():
    """Two breakpoints at the same time with different values would be a jump — slew → infinity."""
    pl = PiecewiseLinear.from_lists([0.0, 1.0, 1.0, 2.0], [0.0, 5.0, 10.0, 10.0])
    assert pl.max_slew_rate() == math.inf


def test_piecewise_linear_max_slew_rate_computation():
    """Slew = |Δv|/Δt; pick the worst segment."""
    pl = PiecewiseLinear.from_lists([0.0, 1.0, 1.5], [0.0, 5.0, 0.0])
    # First segment: 5/1 = 5
    # Second segment: 5/0.5 = 10
    assert pl.max_slew_rate() == pytest.approx(10.0)


def test_piecewise_linear_duration():
    pl = PiecewiseLinear.from_lists([0.5, 1.0, 3.0], [0.0, 1.0, 2.0])
    assert pl.duration == pytest.approx(2.5)


def test_piecewise_linear_to_dict_roundtrip():
    pl = PiecewiseLinear.from_lists([0.0, 1.0, 2.0], [0.0, 5.0, 10.0])
    d = pl.to_dict()
    pl2 = PiecewiseLinear.from_lists(d["times"], d["values"])
    assert pl.times == pl2.times
    assert pl.values == pl2.values


# --------------------------------------------------------------------------- #
# Presets — reproduce paper protocols
# --------------------------------------------------------------------------- #


def test_paper_linear_ramp_reproduces_61_defaults():
    """T=4µs, Ω=15 rad/µs plateau, Δ sweeps -30 → 40."""
    s = paper_linear_ramp()
    assert s.duration == pytest.approx(4.0)
    assert s.omega.value_at(2.0) == pytest.approx(15.0)  # mid-plateau
    assert s.omega.value_at(0.0) == 0.0
    assert s.omega.value_at(4.0) == 0.0
    assert s.delta.value_at(0.0) == pytest.approx(-30.0)
    assert s.delta.value_at(4.0) == pytest.approx(40.0)


def test_paper_linear_ramp_obeys_aquila():
    s = paper_linear_ramp()
    v = validate_schedule(s)
    assert v == [], [x.code for x in v]


def test_bernien_2017_sweep_obeys_aquila():
    s = bernien_2017_sweep()
    v = validate_schedule(s)
    assert v == [], [x.code for x in v]


def test_paper_smooth_blackman_obeys_aquila():
    s = paper_smooth_blackman()
    v = validate_schedule(s)
    assert v == [], [x.code for x in v]


def test_paper_smooth_blackman_zero_at_boundaries():
    """Blackman envelope must drive Ω cleanly to 0 at both endpoints."""
    s = paper_smooth_blackman()
    assert s.omega.value_at(0.0) == pytest.approx(0.0, abs=1e-9)
    assert s.omega.value_at(s.duration) == pytest.approx(0.0, abs=1e-9)


def test_paper_smooth_blackman_peak_matches_omega_max():
    """The window peak ≈ 1.0 → Ω peak ≈ omega_max."""
    s = paper_smooth_blackman(omega_max_rad_us=12.0)
    peak = max(s.omega.values)
    # Blackman peak value is exactly 1 at t = T/2.
    assert peak == pytest.approx(12.0, rel=1e-3)


def test_preset_registry_includes_blackman():
    """The /api/schedule/presets endpoint should expose the new preset."""
    assert "paper_smooth_blackman" in PRESETS


def test_paper_linear_ramp_rejects_invalid_fraction():
    with pytest.raises(ValueError):
        paper_linear_ramp(ramp_up_fraction=0.6)


# --------------------------------------------------------------------------- #
# Pulse validation — each rule pos/neg/boundary
# --------------------------------------------------------------------------- #


def test_validate_passes_clean_schedule():
    s = paper_linear_ramp(omega_max_rad_us=10.0, delta_initial_rad_us=-20.0, delta_final_rad_us=20.0)
    assert validate_schedule(s) == []


def test_omega_above_aquila_max_fails():
    s = from_breakpoints(
        omega_breakpoints=[(0.0, 0.0), (1.0, 20.0), (2.0, 0.0)],
        delta_breakpoints=[(0.0, 0.0), (2.0, 0.0)],
    )
    v = validate_schedule(s)
    assert any(x.code == ViolationCode.RABI_EXCEEDS_MAX for x in v)


def test_omega_at_158_boundary_is_valid():
    """Exactly the inclusive limit must pass."""
    s = from_breakpoints(
        omega_breakpoints=[(0.0, 0.0), (1.0, 15.8), (2.0, 0.0)],
        delta_breakpoints=[(0.0, 0.0), (2.0, 0.0)],
    )
    assert all(x.code != ViolationCode.RABI_EXCEEDS_MAX for x in validate_schedule(s))


def test_omega_negative_fails():
    s = from_breakpoints(
        omega_breakpoints=[(0.0, 0.0), (1.0, -0.5), (2.0, 0.0)],
        delta_breakpoints=[(0.0, 0.0), (2.0, 0.0)],
    )
    v = validate_schedule(s)
    assert any(x.code == ViolationCode.RABI_NEGATIVE for x in v)


def test_detuning_above_max_fails():
    s = from_breakpoints(
        omega_breakpoints=[(0.0, 0.0), (1.0, 5.0), (2.0, 0.0)],
        delta_breakpoints=[(0.0, 0.0), (1.0, 130.0), (2.0, 0.0)],
    )
    v = validate_schedule(s)
    assert any(x.code == ViolationCode.DETUNING_OUT_OF_RANGE for x in v)


def test_detuning_at_125_boundary_is_valid():
    s = from_breakpoints(
        omega_breakpoints=[(0.0, 0.0), (1.0, 5.0), (2.0, 0.0)],
        delta_breakpoints=[(0.0, -125.0), (2.0, 125.0)],
    )
    assert all(x.code != ViolationCode.DETUNING_OUT_OF_RANGE for x in validate_schedule(s))


def test_slew_rate_exceeded_fails():
    """Ramp Ω from 0 to 15 in 0.01 µs → slew = 1500 >> 250."""
    s = from_breakpoints(
        omega_breakpoints=[(0.0, 0.0), (0.01, 15.0), (1.0, 0.0)],
        delta_breakpoints=[(0.0, 0.0), (1.0, 0.0)],
    )
    v = validate_schedule(s)
    assert any(x.code == ViolationCode.SLEW_RATE_EXCEEDED for x in v)


def test_slew_rate_at_250_boundary_is_valid():
    """Ramp at exactly 250 rad/µs² → no violation."""
    s = from_breakpoints(
        omega_breakpoints=[(0.0, 0.0), (1.0, 250.0)],  # would violate Ω_max but isolate slew test
        delta_breakpoints=[(0.0, 0.0), (1.0, 0.0)],
    )
    # Filter — slew test only; Ω will be flagged separately
    v = [x for x in validate_schedule(s) if x.code == ViolationCode.SLEW_RATE_EXCEEDED]
    assert v == []


def test_detuning_slew_rate_exceeded_fails():
    """Ramp Δ from 0 to 125 in 0.001 µs → slew = 125,000 >> 2500."""
    s = from_breakpoints(
        omega_breakpoints=[(0.0, 0.0), (1.0, 0.0)],
        delta_breakpoints=[(0.0, 0.0), (0.001, 125.0), (1.0, 125.0)],
    )
    v = validate_schedule(s)
    assert any(x.code == ViolationCode.DETUNING_SLEW_RATE_EXCEEDED for x in v)


def test_detuning_slew_rate_at_2500_boundary_is_valid():
    """Δ slew of exactly 2500 rad/µs² should not be flagged."""
    s = from_breakpoints(
        omega_breakpoints=[(0.0, 0.0), (1.0, 0.0)],
        delta_breakpoints=[(0.0, 0.0), (1.0, 2500.0)],  # may violate Δ_max but isolate slew test
    )
    v = [x for x in validate_schedule(s) if x.code == ViolationCode.DETUNING_SLEW_RATE_EXCEEDED]
    assert v == []


def test_detuning_slew_negative_direction_also_flagged():
    """A steep *downward* Δ sweep must trigger the same code."""
    s = from_breakpoints(
        omega_breakpoints=[(0.0, 0.0), (1.0, 0.0)],
        delta_breakpoints=[(0.0, 100.0), (0.001, -100.0), (1.0, -100.0)],
    )
    v = validate_schedule(s)
    assert any(x.code == ViolationCode.DETUNING_SLEW_RATE_EXCEEDED for x in v)


def test_duration_above_4us_fails():
    s = from_breakpoints(
        omega_breakpoints=[(0.0, 0.0), (5.0, 0.0)],
        delta_breakpoints=[(0.0, 0.0), (5.0, 0.0)],
    )
    v = validate_schedule(s)
    assert any(x.code == ViolationCode.DURATION_EXCEEDED for x in v)


def test_duration_at_4us_boundary_is_valid():
    s = paper_linear_ramp(t_total_us=4.0)
    assert all(x.code != ViolationCode.DURATION_EXCEEDED for x in validate_schedule(s))


# --------------------------------------------------------------------------- #
# Property-style: many random valid schedules
# --------------------------------------------------------------------------- #


@pytest.mark.parametrize("seed", range(15))
def test_property_random_paper_ramps_pass_validation(seed):
    """Vary preset parameters within Aquila limits → all schedules validate clean."""
    import numpy as np

    rng = np.random.default_rng(seed)
    omega_max = float(rng.uniform(1.0, 15.0))
    delta_i = float(rng.uniform(-100.0, 100.0))
    delta_f = float(rng.uniform(-100.0, 100.0))
    t_total = float(rng.uniform(1.5, 3.9))

    # Avoid extreme ramp fractions that produce zero-duration ramp segments
    s = paper_linear_ramp(
        t_total_us=t_total,
        omega_max_rad_us=omega_max,
        delta_initial_rad_us=delta_i,
        delta_final_rad_us=delta_f,
        ramp_up_fraction=0.1,
        ramp_down_fraction=0.1,
    )
    v = validate_schedule(s)
    assert v == [], f"seed={seed}: {[x.code for x in v]}"


# --------------------------------------------------------------------------- #
# Round-trip: schedule → dict → schedule preserves equality
# --------------------------------------------------------------------------- #


def test_schedule_serialization_roundtrip():
    s = paper_linear_ramp()
    d = s.to_dict()
    s2 = Schedule(
        omega=PiecewiseLinear.from_lists(d["omega"]["times"], d["omega"]["values"]),
        delta=PiecewiseLinear.from_lists(d["delta"]["times"], d["delta"]["values"]),
        phi=PiecewiseLinear.from_lists(d["phi"]["times"], d["phi"]["values"]),
    )
    assert s2.omega.times == s.omega.times
    assert s2.omega.values == s.omega.values
    assert s2.delta.values == s.delta.values
    assert s2.duration == pytest.approx(s.duration)


# --------------------------------------------------------------------------- #
# Edge: integration with Hamiltonian builder
# --------------------------------------------------------------------------- #


def test_schedule_at_midpoint_produces_valid_hamiltonian():
    """Pull values at t=midpoint from the schedule, plug into rydberg_hamiltonian → must be Hermitian."""
    from aquila.hamiltonian import is_hermitian, rydberg_hamiltonian

    s = paper_linear_ramp()
    t_mid = s.duration / 2
    omega = s.omega.value_at(t_mid)
    delta = s.delta.value_at(t_mid)
    phi = s.phi.value_at(t_mid)
    H = rydberg_hamiltonian(omega, delta, phi, [(0.0, 0.0), (5.0, 0.0)])
    assert is_hermitian(H)
