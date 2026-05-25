"""
Ground-state phase diagram in the (Ω, Δ) parameter plane.

For a fixed atom layout, sweep a 2D grid of (Ω, Δ). At each grid point we
build the time-independent Rydberg Hamiltonian H(Ω, Δ), diagonalise it, and
record the ground-state expectation value ⟨Σ n̂_i⟩ — the mean number of atoms
in |r⟩. Distinct phases (no-Rydberg, Z₂ checkerboard, fully-excited, etc.)
appear as plateaus in the resulting heatmap.

This is a *parameter-space* analysis — orthogonal to :mod:`adiabatic_gap`,
which traces the spectrum along a *time-dependent* schedule.

Computational cost: full diagonalisation per grid point. For N atoms and a
P×Q grid the work is O(P·Q·8^N). At N=6 a 30×30 grid takes ~1 s; at N=8
about 8 s. We therefore refuse for N > PHASE_DIAGRAM_MAX_ATOMS so the API
remains synchronous.
"""

from __future__ import annotations

from dataclasses import dataclass

import numpy as np

from aquila.hamiltonian import rydberg_hamiltonian

PHASE_DIAGRAM_MAX_ATOMS: int = 8
"""Above this the API refuses synchronously — diagonalising 2^9 = 512-state
matrices over a 30×30 grid is ~30 s on a typical laptop."""

DEFAULT_GRID: int = 25
"""Default resolution per axis. 25×25 = 625 points → ~1–8 s depending on N."""


@dataclass(frozen=True)
class PhaseDiagram:
    omegas: tuple[float, ...]
    """The Ω-axis sample values (rad/µs), ascending."""

    deltas: tuple[float, ...]
    """The Δ-axis sample values (rad/µs), ascending."""

    mean_n: tuple[tuple[float, ...], ...]
    """``mean_n[d_idx][o_idx]`` = ⟨Σ n̂_i⟩ on the ground state at that point."""

    n_atoms: int

    def to_dict(self) -> dict:
        return {
            "omegas": list(self.omegas),
            "deltas": list(self.deltas),
            "mean_n": [list(row) for row in self.mean_n],
            "n_atoms": self.n_atoms,
        }


def _sum_n_operator(n: int) -> np.ndarray:
    """Diagonal operator Σ_i n̂_i in the computational basis — bit i = 1 ⇔ |r⟩."""
    dim = 1 << n
    diag = np.empty(dim, dtype=float)
    for state in range(dim):
        # Popcount over n bits
        diag[state] = float(bin(state).count("1"))
    return diag  # Stored as a 1-D vector; ⟨ψ|Σn|ψ⟩ = Σ_s diag[s] |ψ_s|².


def compute_phase_diagram(
    positions: list[tuple[float, float]],
    omega_min: float = 0.5,
    omega_max: float = 15.0,
    n_omega: int = DEFAULT_GRID,
    delta_min: float = -30.0,
    delta_max: float = 30.0,
    n_delta: int = DEFAULT_GRID,
) -> PhaseDiagram | None:
    """
    Sweep (Ω, Δ) and return the ground-state ⟨Σ n̂⟩ at each grid point.

    Returns ``None`` when the system is larger than
    :data:`PHASE_DIAGRAM_MAX_ATOMS`; the caller should surface a "too large"
    message in the UI.
    """
    n = len(positions)
    if n == 0 or n > PHASE_DIAGRAM_MAX_ATOMS:
        return None
    n_omega = max(2, n_omega)
    n_delta = max(2, n_delta)

    omegas = [omega_min + i * (omega_max - omega_min) / (n_omega - 1) for i in range(n_omega)]
    deltas = [delta_min + i * (delta_max - delta_min) / (n_delta - 1) for i in range(n_delta)]
    sum_n_diag = _sum_n_operator(n)  # diagonal in computational basis

    grid: list[tuple[float, ...]] = []
    for d in deltas:
        row: list[float] = []
        for o in omegas:
            H = rydberg_hamiltonian(o, d, 0.0, positions)
            # eigh returns (eigvals ascending, eigvecs as columns); take ground.
            _evals, evecs = np.linalg.eigh(H)
            ground = evecs[:, 0]
            # ⟨ψ|diag|ψ⟩ = Σ_s diag[s] · |ψ_s|²
            probs = (ground.conj() * ground).real
            val = float(np.dot(sum_n_diag, probs))
            row.append(val)
        grid.append(tuple(row))

    return PhaseDiagram(
        omegas=tuple(omegas),
        deltas=tuple(deltas),
        mean_n=tuple(grid),
        n_atoms=n,
    )


__all__ = ["PhaseDiagram", "compute_phase_diagram", "PHASE_DIAGRAM_MAX_ATOMS", "DEFAULT_GRID"]
