"""
Measurement model tests.

Coverage:
  - histogram counts sum to n_shots
  - all bitstrings have length n_atoms
  - sampling matches the underlying probability when noise is off
  - applying noise shifts the histogram toward what whitepaper §1.4 predicts
  - reproducibility under fixed seed
  - top_bitstrings sorts correctly
  - empty SimulationResult → empty MeasurementResult
"""

from __future__ import annotations

import math

import pytest

from pipeline.measurement import MeasurementResult, measure, top_bitstrings
from pipeline.schedule import PiecewiseLinear, Schedule
from pipeline.simulate import simulate


def _two_atom_pi_pulse_result():
    """Same physics as test_simulate_api: 2 atoms, W-state at the end."""
    omega = 6.0
    t_total = math.pi / (math.sqrt(2) * omega)
    s = Schedule(
        omega=PiecewiseLinear.from_lists([0.0, t_total], [omega, omega]),
        delta=PiecewiseLinear.from_lists([0.0, t_total], [0.0, 0.0]),
        phi=PiecewiseLinear.from_lists([0.0, t_total], [0.0, 0.0]),
    )
    return simulate(s, positions=[(0.0, 0.0), (4.0, 0.0)], n_frames=15)


# --------------------------------------------------------------------------- #
# Counting
# --------------------------------------------------------------------------- #


def test_histogram_counts_sum_to_n_shots():
    sim = _two_atom_pi_pulse_result()
    res = measure(sim, n_shots=500, seed=42, apply_noise=False)
    assert sum(res.histogram.values()) == 500
    assert res.n_shots == 500


def test_bitstring_lengths_equal_n_atoms():
    sim = _two_atom_pi_pulse_result()
    res = measure(sim, n_shots=100, seed=1, apply_noise=False)
    assert all(len(b) == sim.n_atoms for b in res.bitstrings)


# --------------------------------------------------------------------------- #
# Distribution matches probabilities (noise off)
# --------------------------------------------------------------------------- #


def test_noiseless_histogram_matches_probabilities():
    """W-state π-pulse: P(01) = P(10) ≈ 0.5 each, others ≈ 0."""
    sim = _two_atom_pi_pulse_result()
    res = measure(sim, n_shots=5000, seed=7, apply_noise=False)
    f01 = res.histogram.get("01", 0) / res.n_shots
    f10 = res.histogram.get("10", 0) / res.n_shots
    # Should each be near 0.5
    assert 0.45 < f01 < 0.55
    assert 0.45 < f10 < 0.55
    # |00> and |11> should be < 5%
    assert res.histogram.get("00", 0) / res.n_shots < 0.05
    assert res.histogram.get("11", 0) / res.n_shots < 0.05


# --------------------------------------------------------------------------- #
# Noise application shifts the histogram
# --------------------------------------------------------------------------- #


def test_noise_increases_zeros_bias():
    """With Rydberg→ground detection error 0.08, '1's should occasionally
    flip to '0', so the all-zero outcome becomes slightly more common."""
    sim = _two_atom_pi_pulse_result()
    noiseless = measure(sim, n_shots=5000, seed=7, apply_noise=False)
    noisy = measure(sim, n_shots=5000, seed=7, apply_noise=True)
    z_noiseless = noiseless.histogram.get("00", 0) / noiseless.n_shots
    z_noisy = noisy.histogram.get("00", 0) / noisy.n_shots
    # Noisy '00' should be higher (extra paths via |01>→|00> or |10>→|00>)
    assert z_noisy > z_noiseless


# --------------------------------------------------------------------------- #
# Reproducibility
# --------------------------------------------------------------------------- #


def test_seed_reproducible_noiseless():
    sim = _two_atom_pi_pulse_result()
    a = measure(sim, n_shots=200, seed=42, apply_noise=False)
    b = measure(sim, n_shots=200, seed=42, apply_noise=False)
    assert a.bitstrings == b.bitstrings


def test_seed_reproducible_with_noise():
    sim = _two_atom_pi_pulse_result()
    a = measure(sim, n_shots=200, seed=42, apply_noise=True)
    b = measure(sim, n_shots=200, seed=42, apply_noise=True)
    assert a.bitstrings == b.bitstrings


def test_different_seeds_diverge():
    sim = _two_atom_pi_pulse_result()
    a = measure(sim, n_shots=200, seed=1, apply_noise=False)
    b = measure(sim, n_shots=200, seed=2, apply_noise=False)
    assert a.bitstrings != b.bitstrings


# --------------------------------------------------------------------------- #
# top_bitstrings
# --------------------------------------------------------------------------- #


def test_top_bitstrings_sorts_descending():
    res = MeasurementResult(
        bitstrings=("00", "01", "01", "10", "10", "10"),
        histogram={"00": 1, "01": 2, "10": 3},
        n_shots=6,
        n_atoms=2,
    )
    top = top_bitstrings(res, k=2)
    assert top[0] == ("10", 3)
    assert top[1] == ("01", 2)


def test_top_bitstrings_k_larger_than_unique():
    res = MeasurementResult(
        bitstrings=("00",) * 5,
        histogram={"00": 5},
        n_shots=5,
        n_atoms=2,
    )
    assert top_bitstrings(res, k=100) == [("00", 5)]


# --------------------------------------------------------------------------- #
# Edge cases
# --------------------------------------------------------------------------- #


def test_empty_sim_result_returns_empty_measurement():
    from pipeline.simulate import SimulationResult

    res = measure(SimulationResult(), n_shots=100)
    assert res.bitstrings == ()
    assert res.histogram == {}
    assert res.n_shots == 0


@pytest.mark.parametrize("n_shots", [1, 10, 1000])
def test_n_shots_respected(n_shots):
    sim = _two_atom_pi_pulse_result()
    res = measure(sim, n_shots=n_shots, seed=0, apply_noise=False)
    assert res.n_shots == n_shots
    assert len(res.bitstrings) == n_shots
