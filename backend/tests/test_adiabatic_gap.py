"""Sanity tests for the minimum-gap analyzer."""

from __future__ import annotations

import math

import pytest

from pipeline.adiabatic_gap import GAP_MAX_ATOMS, compute_min_gap
from pipeline.schedule import paper_linear_ramp, paper_smooth_blackman


def test_returns_none_for_zero_atoms():
    trace = compute_min_gap([], paper_linear_ramp())
    assert trace is None


def test_returns_none_when_above_size_limit():
    too_many = [(float(i), 0.0) for i in range(GAP_MAX_ATOMS + 1)]
    trace = compute_min_gap(too_many, paper_linear_ramp())
    assert trace is None


def test_single_atom_gap_equals_sqrt_omega2_plus_delta2():
    """
    For one atom: H = (Ω/2) σ_x − Δ n̂. Eigenvalues are
    (−Δ ± √(Ω² + Δ²)) / 2 → gap = √(Ω² + Δ²).
    At the trapezoid peak (t = T/2) Ω = Ω_max, Δ = (Δ_i+Δ_f)/2.
    """
    sched = paper_linear_ramp(
        omega_max_rad_us=12.0,
        delta_initial_rad_us=-20.0,
        delta_final_rad_us=20.0,
    )
    trace = compute_min_gap([(0.0, 0.0)], sched, n_samples=5)
    assert trace is not None
    # Minimum gap occurs where Δ crosses 0 → gap = Ω at the plateau peak.
    assert trace.min_gap == pytest.approx(12.0, rel=5e-2)


def test_min_gap_monotonically_consistent_for_more_samples():
    """More samples should never INCREASE the minimum gap (Lipschitz argument)."""
    sched = paper_smooth_blackman()
    coarse = compute_min_gap([(0.0, 0.0)], sched, n_samples=5)
    fine = compute_min_gap([(0.0, 0.0)], sched, n_samples=80)
    assert coarse is not None and fine is not None
    assert fine.min_gap <= coarse.min_gap + 1e-9


def test_suggested_t_is_inverse_square_of_gap():
    sched = paper_linear_ramp(
        omega_max_rad_us=4.0,
        delta_initial_rad_us=-5.0,
        delta_final_rad_us=5.0,
    )
    trace = compute_min_gap([(0.0, 0.0)], sched, n_samples=5)
    assert trace is not None and trace.suggested_t_us is not None
    expected = 1.0 / (trace.min_gap * trace.min_gap)
    assert trace.suggested_t_us == pytest.approx(expected, rel=1e-9)


def test_dict_serialisation_round_trip():
    trace = compute_min_gap([(0.0, 0.0)], paper_linear_ramp(), n_samples=4)
    assert trace is not None
    d = trace.to_dict()
    assert set(d) == {
        "times",
        "gaps",
        "min_gap",
        "t_at_min_gap",
        "suggested_t_us",
        "n_atoms",
    }
    assert len(d["times"]) == len(d["gaps"])
    assert math.isclose(d["min_gap"], trace.min_gap)
