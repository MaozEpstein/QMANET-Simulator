"""
Validator unit tests — every Aquila constraint, positive + negative + boundary.

For each constraint we test:
  - a clean case → no violations
  - a clear violation → exactly one violation of the right code
  - the boundary value → no violation (whitepaper limits are inclusive on the
    "allowed" side: spacing ≥ 4 µm, x ≤ 75 µm, etc.)

These tests are the contract: future refactoring of validator.py must not
change observable behavior without updating the tests deliberately.
"""

from __future__ import annotations

import pytest

from aquila.constants import AQUILA, MAX_QUBITS
from aquila.validator import ViolationCode, is_valid, validate_positions


# --------------------------------------------------------------------------- #
# Clean inputs
# --------------------------------------------------------------------------- #


def test_empty_array_is_valid():
    assert validate_positions([]) == []
    assert is_valid([])


def test_single_atom_is_valid():
    assert is_valid([(10.0, 10.0)])


def test_two_atoms_well_spaced_same_row_is_valid():
    """Two atoms on the same row (Δy=0) with Δx ≥ 4µm → valid."""
    assert is_valid([(10.0, 20.0), (15.0, 20.0)])


def test_two_atoms_well_spaced_different_rows():
    """Δy > 4µm so they're "different rows" with adequate spacing."""
    assert is_valid([(10.0, 10.0), (10.0, 15.0)])


def test_filled_grid_4_by_4_at_5um_spacing_is_valid():
    """4×4 grid at 5µm spacing — a typical Aquila workload."""
    pts = [(5.0 * i, 5.0 * j) for i in range(4) for j in range(4)]
    assert is_valid(pts), validate_positions(pts)


# --------------------------------------------------------------------------- #
# Site spacing — minimum 4µm
# --------------------------------------------------------------------------- #


def test_site_too_close_emits_violation():
    """3µm apart on the same row → SITE_TOO_CLOSE."""
    v = validate_positions([(0.0, 0.0), (3.0, 0.0)])
    assert len(v) == 1
    assert v[0].code == ViolationCode.SITE_TOO_CLOSE
    assert v[0].measured == pytest.approx(3.0)
    assert v[0].limit == 4.0


def test_site_at_exactly_4um_boundary_is_valid():
    """4.0 µm is the inclusive limit — must pass."""
    assert is_valid([(0.0, 0.0), (4.0, 0.0)])


def test_site_just_below_4um_fails():
    v = validate_positions([(0.0, 0.0), (3.999, 0.0)])
    assert any(x.code == ViolationCode.SITE_TOO_CLOSE for x in v)


def test_duplicate_positions_emit_duplicate_code_not_spacing():
    """Distance exactly 0 → DUPLICATE_POSITION (a distinct code from SITE_TOO_CLOSE)."""
    v = validate_positions([(10.0, 10.0), (10.0, 10.0)])
    codes = [x.code for x in v]
    assert ViolationCode.DUPLICATE_POSITION in codes
    assert ViolationCode.SITE_TOO_CLOSE not in codes


# --------------------------------------------------------------------------- #
# Row constraint — Δy must be 0 or ≥ 4µm
# --------------------------------------------------------------------------- #


def test_rows_too_close_emits_violation():
    """Two atoms with Δy = 2µm (rows neither equal nor ≥4µm apart) → ROW_TOO_CLOSE."""
    v = validate_positions([(0.0, 0.0), (10.0, 2.0)])
    assert any(x.code == ViolationCode.ROW_TOO_CLOSE for x in v)


def test_rows_exactly_aligned_are_valid():
    """Δy = 0 exactly: same row, no row violation."""
    v = validate_positions([(0.0, 5.0), (10.0, 5.0)])
    assert all(x.code != ViolationCode.ROW_TOO_CLOSE for x in v)


def test_rows_at_4um_apart_are_valid():
    """Boundary: rows exactly 4µm apart are allowed."""
    v = validate_positions([(0.0, 0.0), (10.0, 4.0)])
    assert all(x.code != ViolationCode.ROW_TOO_CLOSE for x in v)


def test_rows_with_floating_point_drift_are_treated_as_same():
    """Atoms placed by a force layout often have y differing by 1e-9 — must NOT trigger ROW_TOO_CLOSE."""
    v = validate_positions([(0.0, 5.0), (10.0, 5.0 + 1e-9)])
    assert all(x.code != ViolationCode.ROW_TOO_CLOSE for x in v)


# --------------------------------------------------------------------------- #
# Region bounds
# --------------------------------------------------------------------------- #


def test_x_at_boundary_75um_is_valid():
    assert is_valid([(75.0, 10.0)])


def test_y_at_boundary_76um_is_valid():
    assert is_valid([(10.0, 76.0)])


def test_x_above_75um_fails():
    v = validate_positions([(75.001, 10.0)])
    assert any(x.code == ViolationCode.WIDTH_EXCEEDED for x in v)


def test_y_above_76um_fails():
    v = validate_positions([(10.0, 76.001)])
    assert any(x.code == ViolationCode.HEIGHT_EXCEEDED for x in v)


def test_negative_position_fails():
    v = validate_positions([(-1.0, 10.0)])
    assert any(x.code == ViolationCode.POSITION_NEGATIVE for x in v)


# --------------------------------------------------------------------------- #
# Too many atoms
# --------------------------------------------------------------------------- #


def test_max_qubits_boundary_at_256_is_valid_alone():
    """256 atoms at adequate spacing → no TOO_MANY_ATOMS violation.
    (Other geometric violations might exist; we filter for the count code.)"""
    n = MAX_QUBITS
    pts = [(float(i % 16) * 4.5, float(i // 16) * 4.5) for i in range(n)]
    v = validate_positions(pts)
    assert all(x.code != ViolationCode.TOO_MANY_ATOMS for x in v)


def test_257_atoms_emits_too_many():
    pts = [(float(i), 0.0) for i in range(257)]
    v = validate_positions(pts)
    assert any(x.code == ViolationCode.TOO_MANY_ATOMS for x in v)


# --------------------------------------------------------------------------- #
# Multiple violations reported together (not short-circuited)
# --------------------------------------------------------------------------- #


def test_validator_does_not_short_circuit():
    """Two distinct problems → two violations returned (not just the first)."""
    pts = [(-5.0, 10.0), (-5.0, 11.0)]  # both negative x, plus row-too-close
    v = validate_positions(pts)
    codes = [x.code for x in v]
    assert ViolationCode.POSITION_NEGATIVE in codes
    assert ViolationCode.ROW_TOO_CLOSE in codes


def test_violation_to_dict_is_json_safe():
    v = validate_positions([(0.0, 0.0), (3.0, 0.0)])[0]
    d = v.to_dict()
    assert d["code"] == "site_too_close"  # string, JSON-safe
    assert isinstance(d["locus"], dict)
    assert isinstance(d["measured"], float)
    assert isinstance(d["limit"], float)


# --------------------------------------------------------------------------- #
# Property-style: any 4µm-spaced lattice fits Aquila constraints
# --------------------------------------------------------------------------- #


@pytest.mark.parametrize("spacing,size", [(4.0, 4), (5.0, 8), (6.0, 10), (4.5, 16)])
def test_property_uniform_lattice_is_always_valid(spacing, size):
    pts = [(spacing * i, spacing * j) for i in range(size) for j in range(size)]
    pts = [p for p in pts if p[0] <= AQUILA.max_width_um and p[1] <= AQUILA.max_height_um]
    assert is_valid(pts), validate_positions(pts)
