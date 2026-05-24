"""
Hamiltonian construction tests.

These are the cross-check ground truth for Phase 4 (Bloqade emulation):
if Bloqade ever disagrees with what's tested here, *one of them is wrong*,
and these tests pin down the meaning we expect.

Strategy:
  - Single-qubit: analytic eigenvalues
  - Two-qubit blockaded pair: analytic eigenvalues vs whitepaper §1.3
  - Three-qubit chain: structural properties (Hermitian, sparsity)
  - Edge cases: empty array, single atom at φ=0, phase symmetry
"""

from __future__ import annotations

import math

import numpy as np
import pytest

from aquila.constants import C6_RAD_US_UM6
from aquila.hamiltonian import (
    blockade_pair_eigenvalues,
    is_hermitian,
    rydberg_hamiltonian,
)

# --------------------------------------------------------------------------- #
# Structural properties
# --------------------------------------------------------------------------- #


def test_empty_array_returns_1x1_zero():
    H = rydberg_hamiltonian(omega=5.0, delta=2.0, phi=0.0, positions=[])
    assert H.shape == (1, 1)
    assert H[0, 0] == 0.0


@pytest.mark.parametrize("n,omega,delta,phi", [
    (1, 5.0, 1.0, 0.0),
    (2, 10.0, -3.0, 0.7),
    (3, 15.0, 5.0, 1.2),
    (4, 8.0, 0.0, 0.0),
])
def test_hamiltonian_is_hermitian_for_various_configs(n, omega, delta, phi):
    positions = [(5.0 * i, 0.0) for i in range(n)]
    H = rydberg_hamiltonian(omega, delta, phi, positions)
    assert H.shape == (1 << n, 1 << n)
    assert is_hermitian(H), f"H is not Hermitian for n={n}"


# --------------------------------------------------------------------------- #
# Single qubit — analytic eigenvalues
# --------------------------------------------------------------------------- #


def test_single_qubit_eigenvalues_match_analytic_formula():
    """
    Single-qubit Rabi+detuning Hamiltonian (in our convention H = (Ω/2)σ_x - Δ n̂)
    has eigenvalues:
        E± = -Δ/2 ± (1/2) √(Ω² + Δ²)
    (the energy origin is shifted by -Δ/2 due to the n̂ projector).
    """
    omega, delta = 8.0, 3.0
    H = rydberg_hamiltonian(omega, delta, phi=0.0, positions=[(0.0, 0.0)])
    eigs = np.sort(np.linalg.eigvalsh(H))
    expected_low = -delta / 2 - 0.5 * math.sqrt(omega**2 + delta**2)
    expected_high = -delta / 2 + 0.5 * math.sqrt(omega**2 + delta**2)
    assert eigs[0] == pytest.approx(expected_low, abs=1e-9)
    assert eigs[1] == pytest.approx(expected_high, abs=1e-9)


def test_single_qubit_zero_omega_diagonal():
    """At Ω=0, H = -Δ n̂ ⇒ eigenvalues are {0, -Δ}."""
    H = rydberg_hamiltonian(omega=0.0, delta=4.5, phi=0.0, positions=[(0.0, 0.0)])
    eigs = np.sort(np.linalg.eigvalsh(H))
    assert eigs[0] == pytest.approx(-4.5)
    assert eigs[1] == pytest.approx(0.0)


def test_single_qubit_zero_delta_gives_rabi_only():
    """At Δ=0, eigenvalues are ±Ω/2."""
    H = rydberg_hamiltonian(omega=8.0, delta=0.0, phi=0.0, positions=[(0.0, 0.0)])
    eigs = np.sort(np.linalg.eigvalsh(H))
    assert eigs[0] == pytest.approx(-4.0)
    assert eigs[1] == pytest.approx(4.0)


# --------------------------------------------------------------------------- #
# Two-qubit blockaded pair
# --------------------------------------------------------------------------- #


def test_two_qubit_zero_drive_diagonal_interaction():
    """
    Ω=0, Δ=0, two atoms at distance d → H is diagonal with entries
    {0, 0, 0, C6/d^6} for the basis {|gg>, |gr>, |rg>, |rr>}.
    """
    d = 5.0
    H = rydberg_hamiltonian(
        omega=0.0, delta=0.0, phi=0.0, positions=[(0.0, 0.0), (d, 0.0)]
    )
    assert is_hermitian(H)
    expected = np.diag([0.0, 0.0, 0.0, C6_RAD_US_UM6 / d**6])
    np.testing.assert_allclose(H.real, expected, atol=1e-9)
    np.testing.assert_allclose(H.imag, np.zeros_like(H.real), atol=1e-9)


def test_blockaded_pair_close_distance_shifts_rr_state_up():
    """For d small enough, the |rr> state is pushed far above the others."""
    eigs_close = blockade_pair_eigenvalues(omega=0.0, delta=0.0, distance_um=4.0)
    # |rr> at C6/4^6 = 862690 / 4096 ≈ 210 rad/µs is huge
    assert eigs_close[-1] > 100.0
    assert eigs_close[0] == pytest.approx(0.0, abs=1e-9)


def test_blockaded_pair_far_distance_decouples():
    """At very large distance, V_ij ≈ 0 and eigenvalues are nearly free."""
    eigs_far = blockade_pair_eigenvalues(omega=0.0, delta=2.0, distance_um=50.0)
    # All four eigenvalues should be in {-2Δ, -Δ, -Δ, 0} = {-4, -2, -2, 0}
    expected = np.sort([-4.0, -2.0, -2.0, 0.0])
    np.testing.assert_allclose(eigs_far, expected, atol=1e-3)


# --------------------------------------------------------------------------- #
# Phase invariance — eigenvalues don't depend on φ (only states do)
# --------------------------------------------------------------------------- #


@pytest.mark.parametrize("phi", [0.0, 0.5, 1.0, 2.0, math.pi, -math.pi / 3])
def test_eigenvalues_invariant_under_phase(phi):
    pos = [(0.0, 0.0), (5.0, 0.0)]
    eigs_zero = np.sort(np.linalg.eigvalsh(rydberg_hamiltonian(10.0, 2.0, 0.0, pos)))
    eigs_phi = np.sort(np.linalg.eigvalsh(rydberg_hamiltonian(10.0, 2.0, phi, pos)))
    np.testing.assert_allclose(eigs_zero, eigs_phi, atol=1e-9)


# --------------------------------------------------------------------------- #
# Three-qubit chain — structural sanity
# --------------------------------------------------------------------------- #


def test_three_qubit_chain_dim_and_hermiticity():
    H = rydberg_hamiltonian(
        omega=8.0, delta=1.0, phi=0.4,
        positions=[(0.0, 0.0), (5.0, 0.0), (10.0, 0.0)],
    )
    assert H.shape == (8, 8)
    assert is_hermitian(H)


def test_three_qubit_diagonal_entries_have_correct_detuning():
    """
    Diagonal entries are -Δ * (#Rydberg atoms in basis state) + interactions.
    For the |rrr> state at uniform 5µm spacing:
        diag = -3Δ + C6/5^6 (1-2) + C6/5^6 (2-3) + C6/10^6 (1-3)
    """
    omega, delta = 0.0, 2.0
    d = 5.0
    pos = [(0.0, 0.0), (d, 0.0), (2 * d, 0.0)]
    H = rydberg_hamiltonian(omega, delta, 0.0, pos)
    # |rrr> = bit pattern 111 = decimal 7 (numpy kron convention puts atom 0
    # as the most significant qubit). Either way, the |rrr> state is unique.
    # Find the diagonal entry that equals -3Δ + V_12 + V_23 + V_13.
    expected = -3 * delta + 2 * (C6_RAD_US_UM6 / d**6) + C6_RAD_US_UM6 / (2 * d) ** 6
    assert any(math.isclose(H[i, i].real, expected, abs_tol=1e-9) for i in range(8))


# --------------------------------------------------------------------------- #
# Validation
# --------------------------------------------------------------------------- #


def test_check_aquila_compatible_raises_on_overshoot():
    from aquila.hamiltonian import _check_aquila_compatible

    with pytest.raises(ValueError):
        _check_aquila_compatible(omega=20.0, delta=0.0)
    with pytest.raises(ValueError):
        _check_aquila_compatible(omega=0.0, delta=200.0)
    # In-range: no raise
    _check_aquila_compatible(omega=10.0, delta=5.0)
