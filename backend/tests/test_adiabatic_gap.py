"""Sanity tests for the minimum-gap analyzer."""

from __future__ import annotations

import math

import pytest

from pipeline.adiabatic_gap import GAP_MAX_ATOMS, compute_min_gap, compute_spectrum
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


# --------------------------------------------------------------------------- #
# compute_spectrum
# --------------------------------------------------------------------------- #


def test_spectrum_returns_none_for_too_large_system():
    too_many = [(float(i), 0.0) for i in range(GAP_MAX_ATOMS + 1)]
    assert compute_spectrum(too_many, paper_linear_ramp()) is None


def test_spectrum_shape_matches_samples_and_levels():
    """Each sample row has exactly n_levels eigenvalues, ascending."""
    trace = compute_spectrum(
        [(0.0, 0.0), (5.0, 0.0)], paper_linear_ramp(), n_samples=7, n_levels=3
    )
    assert trace is not None
    assert len(trace.times) == 7
    assert len(trace.eigenvalues) == 7
    for row in trace.eigenvalues:
        assert len(row) == 3
        # Ascending order
        assert all(row[i] <= row[i + 1] + 1e-9 for i in range(len(row) - 1))


def test_spectrum_single_atom_matches_analytic_gap():
    """For one atom: gap(t) = √(Ω² + Δ²). At plateau peak the spectrum
    should have e[1] − e[0] ≈ √(Ω² + Δ²) with Ω=10, Δ=0 → gap = 10."""
    sched = paper_linear_ramp(
        omega_max_rad_us=10.0,
        delta_initial_rad_us=-20.0,
        delta_final_rad_us=20.0,
    )
    trace = compute_spectrum([(0.0, 0.0)], sched, n_samples=11, n_levels=2)
    assert trace is not None
    # The smallest gap across samples should approach Ω at Δ=0 crossing.
    min_gap = min(row[1] - row[0] for row in trace.eigenvalues)
    assert min_gap == pytest.approx(10.0, rel=5e-2)


def test_spectrum_n_levels_capped_by_hilbert_dim():
    """Asking for more levels than the Hilbert space has must not crash."""
    trace = compute_spectrum([(0.0, 0.0)], paper_linear_ramp(), n_samples=3, n_levels=99)
    assert trace is not None
    # Hilbert space has dim 2 for one atom — cannot return more than 2 eigvals.
    assert trace.n_levels == 2
    for row in trace.eigenvalues:
        assert len(row) == 2


# --------------------------------------------------------------------------- #
# Sparse vs dense regression — proves the eigsh path returns the same numbers
# as the eigvalsh path it replaced. Run for every N where dense is still
# affordable, so any future change to either solver gets caught here.
# --------------------------------------------------------------------------- #


def _ring_positions(n: int, radius_um: float = 7.0) -> list[tuple[float, float]]:
    import math

    return [
        (radius_um * math.cos(2 * math.pi * i / n), radius_um * math.sin(2 * math.pi * i / n))
        for i in range(n)
    ]


@pytest.mark.parametrize("n", [3, 5, 7, 9, 10])
def test_sparse_path_matches_dense_for_small_systems(n):
    """For every n where eigvalsh is still cheap, the sparse Lanczos path must
    return the same bottom-k eigenvalues to 1e-8 rad/µs. This is the validation
    that justifies trusting eigsh up to N=GAP_MAX_ATOMS=16 where dense becomes
    infeasible."""
    import numpy as np

    from aquila.hamiltonian import rydberg_hamiltonian
    from pipeline.adiabatic_gap import _lowest_eigenvalues

    positions = _ring_positions(n)
    # Pick a "typical" mid-sweep point: drive is on, detuning crosses zero.
    omega, delta, phi = 12.0, 5.0, 0.0
    H_dense = rydberg_hamiltonian(omega, delta, phi, positions)
    e_dense = np.linalg.eigvalsh(H_dense)[:4]
    e_sparse = _lowest_eigenvalues(positions, omega, delta, phi, k=4)
    assert np.allclose(e_dense, e_sparse, atol=1e-8), (
        f"n={n}: dense={e_dense} sparse={e_sparse}"
    )


def test_sparse_path_active_above_threshold():
    """N=8 should route through the sparse path (SPARSE_MIN_ATOMS=6) without
    error. The numerical correctness is covered by the parametric test above;
    this exists so a future regression of SPARSE_MIN_ATOMS or the eigsh call
    breaks loudly even with no parametrisation hitting the boundary."""
    import numpy as np

    from pipeline.adiabatic_gap import SPARSE_MIN_ATOMS, _lowest_eigenvalues

    assert SPARSE_MIN_ATOMS <= 8
    positions = _ring_positions(8)
    e = _lowest_eigenvalues(positions, omega=10.0, delta=5.0, phi=0.0, k=4)
    assert len(e) == 4
    assert all(np.isfinite(e))
    # Eigenvalues must be sorted ascending.
    assert all(e[i] <= e[i + 1] + 1e-9 for i in range(len(e) - 1))


def test_sparse_path_resolves_degenerate_spectrum():
    """A symmetric ring at n=10 has doubly-degenerate eigenvalues; vanilla
    Lanczos misses one copy of each degenerate pair (a single Krylov vector
    locks in one direction in the degenerate subspace and converges before
    finding the other). The oversampling guard in _lowest_eigenvalues exists
    specifically to defeat this — this test pins the guard down so it can't
    silently regress."""
    import numpy as np

    from aquila.hamiltonian import rydberg_hamiltonian
    from pipeline.adiabatic_gap import _lowest_eigenvalues

    positions = _ring_positions(10)
    H_dense = rydberg_hamiltonian(12.0, 5.0, 0.0, positions)
    e_true = np.linalg.eigvalsh(H_dense)[:4]
    # Sanity: the ring really is degenerate at this point in parameter space.
    assert np.any(np.diff(e_true) < 1e-6), "test premise wrong: spectrum not degenerate"
    e_sparse = _lowest_eigenvalues(positions, 12.0, 5.0, 0.0, k=4)
    assert np.allclose(e_true, e_sparse, atol=1e-8), (
        f"degenerate eigenvalues lost: dense={e_true} sparse={e_sparse}"
    )


def test_spectrum_at_new_cap_runs():
    """The whole point of this work: spectrum analysis at N=GAP_MAX_ATOMS=16
    must complete (this previously refused at n>10). We do one sample only —
    25 samples × 5 sec/sample would dominate the test runtime — but this is
    enough to prove the path is wired."""
    n = GAP_MAX_ATOMS
    # 16 atoms in a 4×4 grid at 6.5 µm spacing — inside Aquila's 75×76 region.
    positions = [(6.5 * (i % 4), 6.5 * (i // 4)) for i in range(n)]
    trace = compute_spectrum(positions, paper_linear_ramp(), n_samples=3, n_levels=2)
    assert trace is not None
    assert trace.n_atoms == n
    assert len(trace.eigenvalues) == 3
    for row in trace.eigenvalues:
        assert len(row) == 2
        assert row[0] <= row[1] + 1e-9
