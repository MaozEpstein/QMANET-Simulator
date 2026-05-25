"""
Aquila constraint validation.

Every quantum program submitted to Aquila must obey hard limits (whitepaper §1.5):
position bounds, minimum site spacing, row alignment, Rabi amplitude bounds,
slew rate, detuning range, total duration. Violating any of these is rejected
by the hardware. We catch them here, before submit, with a structured error
schema the frontend can render — including which atom / which time-bin failed,
the measured value, and the allowed limit.

This module is pure-data: the same validator is reused by:
  - the embedding pipeline (Phase 2)
  - the schedule builder (Phase 3)
  - the Braket adapter (Phase 7)
"""

from __future__ import annotations

import math
from dataclasses import dataclass
from enum import Enum

from .constants import AQUILA, AquilaSpec


class ViolationCode(str, Enum):
    """Stable codes used by the frontend to format messages and pick badges."""

    TOO_MANY_ATOMS = "too_many_atoms"
    WIDTH_EXCEEDED = "width_exceeded"
    HEIGHT_EXCEEDED = "height_exceeded"
    SITE_TOO_CLOSE = "site_too_close"
    ROW_TOO_CLOSE = "row_too_close"
    POSITION_NEGATIVE = "position_negative"
    DUPLICATE_POSITION = "duplicate_position"
    # Pulse-related codes (used in Phase 3, defined here so the frontend has one source of truth)
    RABI_EXCEEDS_MAX = "rabi_exceeds_max"
    RABI_NEGATIVE = "rabi_negative"
    SLEW_RATE_EXCEEDED = "slew_rate_exceeded"
    DETUNING_OUT_OF_RANGE = "detuning_out_of_range"
    DETUNING_SLEW_RATE_EXCEEDED = "detuning_slew_rate_exceeded"
    DURATION_EXCEEDED = "duration_exceeded"


@dataclass(frozen=True)
class Violation:
    code: ViolationCode
    message: str
    """Human-readable explanation, English (frontend supplies Hebrew label by code)."""
    locus: dict[str, float | int]
    """Where the violation is — e.g. {"atom_idx": 7} or {"t_us": 1.2, "channel": "Omega"}."""
    measured: float
    """The offending value."""
    limit: float
    """The hardware limit it crossed."""

    def to_dict(self) -> dict:
        return {
            "code": self.code.value,
            "message": self.message,
            "locus": self.locus,
            "measured": self.measured,
            "limit": self.limit,
        }


# --------------------------------------------------------------------------- #
# Atom-position validation
# --------------------------------------------------------------------------- #


def validate_positions(
    positions: list[tuple[float, float]],
    *,
    spec: AquilaSpec = AQUILA,
    row_tolerance_um: float = 1e-3,
) -> list[Violation]:
    """
    Check Aquila position constraints.

    Returns the full list of violations (does not short-circuit on first) so the
    UI can highlight every offending atom at once.

    Args:
        positions: list of (x, y) in micrometers.
        spec: hardware spec; default is the production Aquila constants.
        row_tolerance_um: |y_i - y_j| < tolerance ⇒ atoms considered on same row.
            Whitepaper §1.4 requires rows to be either *exactly* equal or ≥
            min_row_spacing apart; we treat near-equal y as "same row".
    """
    violations: list[Violation] = []
    n = len(positions)

    if n > spec.max_qubits:
        violations.append(
            Violation(
                code=ViolationCode.TOO_MANY_ATOMS,
                message=f"Aquila supports at most {spec.max_qubits} atoms, got {n}",
                locus={"n_atoms": n},
                measured=float(n),
                limit=float(spec.max_qubits),
            )
        )

    # Per-atom: bounds + negativity
    for i, (x, y) in enumerate(positions):
        if x < 0 or y < 0:
            violations.append(
                Violation(
                    code=ViolationCode.POSITION_NEGATIVE,
                    message=f"Atom {i} has negative coordinate ({x:.3f}, {y:.3f}); Aquila uses non-negative µm",
                    locus={"atom_idx": i, "x": x, "y": y},
                    measured=min(x, y),
                    limit=0.0,
                )
            )
        if x > spec.max_width_um:
            violations.append(
                Violation(
                    code=ViolationCode.WIDTH_EXCEEDED,
                    message=f"Atom {i} at x={x:.3f}µm exceeds max width {spec.max_width_um}µm",
                    locus={"atom_idx": i, "x": x},
                    measured=x,
                    limit=spec.max_width_um,
                )
            )
        if y > spec.max_height_um:
            violations.append(
                Violation(
                    code=ViolationCode.HEIGHT_EXCEEDED,
                    message=f"Atom {i} at y={y:.3f}µm exceeds max height {spec.max_height_um}µm",
                    locus={"atom_idx": i, "y": y},
                    measured=y,
                    limit=spec.max_height_um,
                )
            )

    # Pairwise: spacing + row alignment
    for i in range(n):
        for j in range(i + 1, n):
            x1, y1 = positions[i]
            x2, y2 = positions[j]
            d = math.hypot(x1 - x2, y1 - y2)
            if d == 0.0:
                violations.append(
                    Violation(
                        code=ViolationCode.DUPLICATE_POSITION,
                        message=f"Atoms {i} and {j} occupy the same site ({x1:.3f}, {y1:.3f})",
                        locus={"atom_idx": i, "other_idx": j},
                        measured=0.0,
                        limit=spec.min_site_spacing_um,
                    )
                )
                continue
            if d < spec.min_site_spacing_um:
                violations.append(
                    Violation(
                        code=ViolationCode.SITE_TOO_CLOSE,
                        message=f"Atoms {i} and {j} are {d:.3f}µm apart; minimum is {spec.min_site_spacing_um}µm",
                        locus={"atom_idx": i, "other_idx": j, "distance_um": d},
                        measured=d,
                        limit=spec.min_site_spacing_um,
                    )
                )
            # Row constraint: y_i ≈ y_j (same row) OR |y_i - y_j| >= min_row_spacing
            dy = abs(y1 - y2)
            if row_tolerance_um < dy < spec.min_row_spacing_um:
                violations.append(
                    Violation(
                        code=ViolationCode.ROW_TOO_CLOSE,
                        message=(
                            f"Atoms {i} and {j} have Δy={dy:.3f}µm — must be 0 (same row) "
                            f"or ≥ {spec.min_row_spacing_um}µm (different rows)"
                        ),
                        locus={"atom_idx": i, "other_idx": j, "dy_um": dy},
                        measured=dy,
                        limit=spec.min_row_spacing_um,
                    )
                )

    return violations


def is_valid(positions: list[tuple[float, float]], **kwargs) -> bool:
    """Convenience: True iff there are no violations."""
    return len(validate_positions(positions, **kwargs)) == 0
