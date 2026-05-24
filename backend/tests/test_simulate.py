"""
Simulation tests — verify time evolution against analytic and structural targets.

Coverage:
  - Single-qubit Rabi oscillation: ⟨n̂(t)⟩ = sin²(Ωt/2) at Δ=0
  - Two-atom blockade: when atoms are within blockade, |rr⟩ population stays ≪ 1
  - Two-atom decoupled: when atoms are far apart, each does independent Rabi
  - Probability conservation: ⟨ψ|ψ⟩ ≈ 1 throughout
  - Final bitstring probs sum to 1
  - Live frame callback fires exactly once per requested frame
  - Empty case: no atoms or zero duration → empty result
  - Reproducibility: same schedule + positions → identical frames
  - Multi-shot measurements: distribution matches probs at large N
"""

from __future__ import annotations

import math

import numpy as np
import pytest

from pipeline.schedule import (
    PiecewiseLinear,
    Schedule,
    from_breakpoints,
    paper_linear_ramp,
)
from pipeline.simulate import SimulationFrame, sample_measurements, simulate


def _constant_schedule(t_total: float, omega: float, delta: float) -> Schedule:
    """Helper: build a schedule with constant Ω, Δ, φ=0 across [0, T]."""
    return Schedule(
        omega=PiecewiseLinear.from_lists([0.0, t_total], [omega, omega]),
        delta=PiecewiseLinear.from_lists([0.0, t_total], [delta, delta]),
        phi=PiecewiseLinear.from_lists([0.0, t_total], [0.0, 0.0]),
    )


# --------------------------------------------------------------------------- #
# Single-qubit Rabi oscillation
# --------------------------------------------------------------------------- #


def test_single_qubit_full_rabi_flop():
    """At Δ=0, a single qubit driven for t such that Ωt = π should be in |r⟩ (⟨n̂⟩ ≈ 1)."""
    omega = 6.0  # rad/µs
    # π-pulse: Ωt = π ⇒ t = π/Ω
    t_total = math.pi / omega
    res = simulate(
        _constant_schedule(t_total, omega, 0.0),
        positions=[(0.0, 0.0)],
        n_frames=50,
    )
    # Final population should be ≈ 1 (full inversion)
    assert res.frames[-1].rydberg_populations[0] == pytest.approx(1.0, abs=5e-3)


def test_single_qubit_half_rabi_flop():
    """Ωt = π/2 ⇒ equal superposition ⇒ ⟨n̂⟩ = 1/2."""
    omega = 6.0
    t_total = math.pi / (2 * omega)
    res = simulate(
        _constant_schedule(t_total, omega, 0.0),
        positions=[(0.0, 0.0)],
        n_frames=50,
    )
    assert res.frames[-1].rydberg_populations[0] == pytest.approx(0.5, abs=5e-3)


def test_single_qubit_full_rabi_oscillation_period():
    """Trajectory of ⟨n̂(t)⟩ matches sin²(Ωt/2) at Δ=0."""
    omega = 5.0
    t_total = 2 * math.pi / omega  # 1 full period
    res = simulate(
        _constant_schedule(t_total, omega, 0.0),
        positions=[(0.0, 0.0)],
        n_frames=80,
    )
    for f in res.frames:
        expected = math.sin(omega * f.t_us / 2) ** 2
        assert f.rydberg_populations[0] == pytest.approx(expected, abs=5e-3)


# --------------------------------------------------------------------------- #
# Two-atom dynamics
# --------------------------------------------------------------------------- #


def test_two_atoms_decoupled_independent_rabi():
    """Far apart (V ≈ 0): both atoms oscillate independently."""
    omega = 5.0
    t_total = math.pi / omega  # π-pulse
    res = simulate(
        _constant_schedule(t_total, omega, 0.0),
        positions=[(0.0, 0.0), (60.0, 0.0)],  # 60 µm — far outside blockade
        n_frames=20,
    )
    pops = res.frames[-1].rydberg_populations
    assert pops[0] == pytest.approx(1.0, abs=1e-2)
    assert pops[1] == pytest.approx(1.0, abs=1e-2)


def test_two_atoms_strong_blockade_suppresses_rr():
    """
    With strong blockade (close atoms), |rr⟩ population is suppressed and the
    system shows collective Rabi oscillations between |gg⟩ and the symmetric
    bright state |W⟩ = (|gr⟩+|rg⟩)/√2.
    Effective frequency: Ω_eff = √2 Ω. So at t=π/(√2 Ω), |gg⟩ → bright state,
    with ⟨n̂_total⟩ = ⟨n̂_1⟩ + ⟨n̂_2⟩ ≈ 1 (one excitation shared).
    """
    omega = 6.0
    t_total = math.pi / (math.sqrt(2) * omega)
    res = simulate(
        _constant_schedule(t_total, omega, 0.0),
        positions=[(0.0, 0.0), (4.0, 0.0)],  # 4 µm — well inside blockade
        n_frames=40,
    )
    n1, n2 = res.frames[-1].rydberg_populations
    # By symmetry the two atoms share equally
    assert n1 == pytest.approx(n2, abs=5e-3)
    assert n1 + n2 == pytest.approx(1.0, abs=5e-2)
    # Each individually is around 0.5
    assert 0.4 < n1 < 0.6


# --------------------------------------------------------------------------- #
# Probability conservation
# --------------------------------------------------------------------------- #


def test_norm_preserved_during_evolution():
    """Unitary evolution: ⟨ψ|ψ⟩ stays at 1 (within tolerance) for the entire schedule."""
    res = simulate(
        paper_linear_ramp(omega_max_rad_us=10.0),
        positions=[(0.0, 0.0), (5.0, 0.0), (10.0, 0.0)],
        n_frames=20,
    )
    for f in res.frames:
        assert abs(f.norm - 1.0) < 1e-4


def test_final_bitstring_probabilities_sum_to_one():
    res = simulate(
        paper_linear_ramp(omega_max_rad_us=12.0),
        positions=[(0.0, 0.0), (5.0, 0.0)],
        n_frames=20,
    )
    total = sum(res.final_bitstring_probs.values())
    assert total == pytest.approx(1.0, abs=1e-4)


# --------------------------------------------------------------------------- #
# Frame callback
# --------------------------------------------------------------------------- #


def test_on_frame_callback_fires_once_per_frame():
    received: list[SimulationFrame] = []
    n_frames = 25
    simulate(
        _constant_schedule(1.0, 5.0, 0.0),
        positions=[(0.0, 0.0), (5.0, 0.0)],
        n_frames=n_frames,
        on_frame=received.append,
    )
    assert len(received) == n_frames
    # Times are monotonically increasing and span [0, T]
    times = [f.t_us for f in received]
    assert times == sorted(times)
    assert times[0] == 0.0
    assert times[-1] == pytest.approx(1.0)


# --------------------------------------------------------------------------- #
# Edge cases
# --------------------------------------------------------------------------- #


def test_empty_atom_list_returns_empty_result():
    res = simulate(paper_linear_ramp(), positions=[], n_frames=10)
    assert res.frames == ()
    assert res.n_atoms == 0


def test_zero_duration_schedule_returns_empty():
    s = Schedule(
        omega=PiecewiseLinear.from_lists([0.0, 0.0], [0.0, 0.0]),
        delta=PiecewiseLinear.from_lists([0.0, 0.0], [0.0, 0.0]),
        phi=PiecewiseLinear.from_lists([0.0, 0.0], [0.0, 0.0]),
    )
    res = simulate(s, positions=[(0.0, 0.0)], n_frames=10)
    assert res.frames == ()


def test_initial_frame_has_zero_population():
    """At t=0, |ψ⟩ = |gg…g⟩ ⇒ all ⟨n̂_i⟩ = 0."""
    res = simulate(
        _constant_schedule(1.0, 5.0, 0.0),
        positions=[(0.0, 0.0), (4.0, 0.0), (8.0, 0.0)],
        n_frames=10,
    )
    pops = res.frames[0].rydberg_populations
    assert all(p == pytest.approx(0.0, abs=1e-9) for p in pops)


# --------------------------------------------------------------------------- #
# Reproducibility
# --------------------------------------------------------------------------- #


def test_same_inputs_give_same_frames():
    """Deterministic solver: identical inputs ⇒ identical outputs."""
    args = dict(
        schedule=paper_linear_ramp(omega_max_rad_us=8.0),
        positions=[(0.0, 0.0), (5.0, 0.0)],
        n_frames=15,
    )
    a = simulate(**args)
    b = simulate(**args)
    np.testing.assert_allclose(a.populations_matrix(), b.populations_matrix(), atol=1e-12)


# --------------------------------------------------------------------------- #
# Sampling
# --------------------------------------------------------------------------- #


def test_sample_measurements_distribution_matches_probs():
    res = simulate(
        _constant_schedule(math.pi / 6.0, 6.0, 0.0),  # π-pulse on a single qubit
        positions=[(0.0, 0.0)],
        n_frames=5,
    )
    samples = sample_measurements(res, n_shots=5000, seed=42)
    counts = {"0": samples.count("0"), "1": samples.count("1")}
    # |1> probability should be ~1; allow for solver error
    assert counts["1"] / 5000 > 0.95


def test_sample_measurements_seed_reproducible():
    res = simulate(
        _constant_schedule(0.5, 5.0, 0.0),
        positions=[(0.0, 0.0), (5.0, 0.0)],
        n_frames=10,
    )
    a = sample_measurements(res, n_shots=200, seed=1)
    b = sample_measurements(res, n_shots=200, seed=1)
    assert a == b


def test_sample_measurements_empty_result_returns_empty():
    from pipeline.simulate import SimulationResult

    assert sample_measurements(SimulationResult(), n_shots=100) == []


# --------------------------------------------------------------------------- #
# Smoke test on the full paper_linear_ramp schedule
# --------------------------------------------------------------------------- #


def test_paper_ramp_on_3_atom_chain_finishes_within_budget():
    """Realistic Phase 4 workload: 3 atoms × paper_linear_ramp × 60 frames."""
    res = simulate(
        paper_linear_ramp(),
        positions=[(0.0, 0.0), (5.0, 0.0), (10.0, 0.0)],
        n_frames=60,
    )
    assert len(res.frames) == 60
    assert all(0.0 <= p <= 1.0 + 1e-6 for f in res.frames for p in f.rydberg_populations)


@pytest.mark.parametrize("n_atoms", [1, 2, 3, 4])
def test_property_evolution_keeps_populations_in_unit_interval(n_atoms):
    positions = [(5.0 * i, 0.0) for i in range(n_atoms)]
    res = simulate(
        _constant_schedule(1.0, 8.0, 2.0),
        positions=positions,
        n_frames=20,
    )
    for f in res.frames:
        for p in f.rydberg_populations:
            assert -1e-6 <= p <= 1.0 + 1e-6
