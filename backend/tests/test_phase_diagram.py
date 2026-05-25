"""Sanity tests for the (Ω, Δ) phase-diagram analyzer."""

from __future__ import annotations

import pytest

from pipeline.phase_diagram import (
    PHASE_DIAGRAM_MAX_ATOMS,
    compute_phase_diagram,
)


def test_returns_none_for_zero_atoms():
    assert compute_phase_diagram([]) is None


def test_returns_none_when_above_size_limit():
    too_many = [(float(i), 0.0) for i in range(PHASE_DIAGRAM_MAX_ATOMS + 1)]
    assert compute_phase_diagram(too_many) is None


def test_grid_shape_matches_request():
    diagram = compute_phase_diagram(
        [(0.0, 0.0), (5.0, 0.0)],
        omega_min=1.0,
        omega_max=10.0,
        n_omega=6,
        delta_min=-10.0,
        delta_max=10.0,
        n_delta=4,
    )
    assert diagram is not None
    assert len(diagram.omegas) == 6
    assert len(diagram.deltas) == 4
    assert len(diagram.mean_n) == 4
    for row in diagram.mean_n:
        assert len(row) == 6


def test_single_atom_low_omega_high_negative_delta_gives_zero_occupation():
    """One atom, Ω small, Δ ≪ 0 → ground state is |g⟩ → ⟨n⟩ ≈ 0."""
    diagram = compute_phase_diagram(
        [(0.0, 0.0)],
        omega_min=0.5,
        omega_max=1.0,
        n_omega=2,
        delta_min=-50.0,
        delta_max=-40.0,
        n_delta=2,
    )
    assert diagram is not None
    for row in diagram.mean_n:
        for v in row:
            assert v == pytest.approx(0.0, abs=1e-3)


def test_single_atom_strong_positive_delta_gives_full_occupation():
    """One atom, Δ ≫ Ω → ground state is |r⟩ → ⟨n⟩ ≈ 1."""
    diagram = compute_phase_diagram(
        [(0.0, 0.0)],
        omega_min=0.5,
        omega_max=1.0,
        n_omega=2,
        delta_min=40.0,
        delta_max=50.0,
        n_delta=2,
    )
    assert diagram is not None
    for row in diagram.mean_n:
        for v in row:
            assert v == pytest.approx(1.0, abs=1e-3)


def test_occupation_monotonically_grows_in_delta_for_fixed_omega():
    """At a fixed small Ω, sweeping Δ from negative to positive must
    monotonically increase ⟨n⟩ for a single atom (no interactions)."""
    diagram = compute_phase_diagram(
        [(0.0, 0.0)],
        omega_min=1.0,
        omega_max=1.0001,  # essentially fixed Ω
        n_omega=2,
        delta_min=-15.0,
        delta_max=15.0,
        n_delta=8,
    )
    assert diagram is not None
    # Look at the first omega column across all deltas (in row order)
    col = [diagram.mean_n[d_idx][0] for d_idx in range(len(diagram.deltas))]
    for i in range(len(col) - 1):
        assert col[i] <= col[i + 1] + 1e-9


def test_occupation_bounded_by_n_atoms():
    """⟨Σ n_i⟩ is in [0, N] at every grid point."""
    diagram = compute_phase_diagram(
        [(0.0, 0.0), (5.0, 0.0), (10.0, 0.0)],
        n_omega=4,
        n_delta=4,
    )
    assert diagram is not None
    for row in diagram.mean_n:
        for v in row:
            assert -1e-9 <= v <= 3.0 + 1e-9


def test_dict_serialisation_round_trip():
    diagram = compute_phase_diagram([(0.0, 0.0)], n_omega=3, n_delta=3)
    assert diagram is not None
    d = diagram.to_dict()
    assert set(d) == {"omegas", "deltas", "mean_n", "n_atoms"}
    assert len(d["mean_n"]) == 3
    assert len(d["mean_n"][0]) == 3
