"""
Minimum-gap analysis for an adiabatic schedule.

The adiabatic theorem (Born–Fock, refined by Ambainis 2004 et al.) bounds the
required total time by  T  ≳  α / δ_min²  where δ_min is the minimum spectral
gap E_1(t) − E_0(t) encountered along the schedule.  In Stage 4 the user picks
a schedule; this module lets us compute δ_min and a "suggested T" so we can
warn when the chosen duration is too short for a given graph.

We diagonalize the instantaneous Hamiltonian H(t) at ``n_samples`` evenly
spaced times in [0, T] using :func:`aquila.hamiltonian.rydberg_hamiltonian`.
Cost is O(n_samples · 8^N) for an N-atom system (eigvalsh on a 2^N matrix);
beyond N≈10 this is too slow for a synchronous request, so we refuse and let
the UI flag "graph too large for gap analysis".
"""

from __future__ import annotations

from dataclasses import dataclass

import numpy as np
import scipy.sparse.linalg as spla

from aquila.hamiltonian import rydberg_hamiltonian, rydberg_hamiltonian_sparse

from .schedule import Schedule

GAP_MAX_ATOMS: int = 16
"""Atoms above this trigger an explicit refusal.

We use scipy's Lanczos solver (eigsh) on a sparse CSR Hamiltonian and only
extract the bottom k eigenvalues — about three orders of magnitude faster than
the dense eigvalsh path that capped the previous cutoff at 10. The new ceiling
covers Heawood (14), King's 4×4 (16), and Möbius-Kantor (16). Above 16, the
2^N Hamiltonian no longer fits comfortably in laptop RAM (~2 GB at N=16,
~8 GB at N=18) so the synchronous request would either OOM or block the UI
for minutes."""

SPARSE_MIN_ATOMS: int = 6
"""Below this the dense eigvalsh path is faster than ARPACK setup overhead, so
we stick to dense. eigsh also requires k < dim, which fails for dim ≤ n_levels."""


def _lowest_eigenvalues(
    positions: list[tuple[float, float]],
    omega: float,
    delta: float,
    phi: float,
    k: int,
) -> np.ndarray:
    """Return the ``k`` lowest eigenvalues of H(Ω, Δ, φ) in ascending order.

    Picks dense eigvalsh for small systems (N < SPARSE_MIN_ATOMS) and sparse
    Lanczos (eigsh) above that, since ARPACK only pays off once dim ≫ k. The
    physics is identical; this is purely a perf swap. Validated against the
    dense path in test_adiabatic_gap.py.

    Degeneracy guard: vanilla Lanczos can miss copies of a degenerate
    eigenvalue (each Krylov vector picks one direction in the degenerate
    subspace and converges before discovering the others). On symmetric graphs
    like rings or hypercubes this happens routinely. We oversample — ask for
    ``2k+4`` eigenvalues and keep the bottom k — so any missed copy still
    leaves enough true bottom-eigenvalues in the returned set."""
    n = len(positions)
    dim = 1 << n

    if n < SPARSE_MIN_ATOMS or k >= dim - 1:
        H_dense = rydberg_hamiltonian(omega, delta, phi, positions)
        return np.linalg.eigvalsh(H_dense)[:k]

    H_sparse = rydberg_hamiltonian_sparse(omega, delta, phi, positions)
    k_request = min(2 * k + 4, dim - 2)
    vals = spla.eigsh(H_sparse, k=k_request, which="SA", return_eigenvectors=False)
    return np.sort(np.real(vals))[:k]

DEFAULT_GAP_SAMPLES: int = 25
"""Number of time samples — chosen so a 4 µs schedule resolves features
~150 ns wide. Increase for finer detail; cost is linear."""


@dataclass(frozen=True)
class GapTrace:
    times: tuple[float, ...]
    """Sample times in µs (always includes 0 and T)."""

    gaps: tuple[float, ...]
    """E_1(t) − E_0(t) in rad/µs at each sample."""

    min_gap: float
    """Minimum gap encountered (rad/µs). Always finite, may be 0."""

    t_at_min_gap: float
    """The sample time where the minimum was attained (µs)."""

    suggested_t_us: float | None
    """Adiabatic estimate of a "safe" duration: 1 / δ_min² (µs).  Returned as
    None when δ_min == 0 (the gap closes — adiabatic limit fails)."""

    n_atoms: int

    def to_dict(self) -> dict:
        return {
            "times": list(self.times),
            "gaps": list(self.gaps),
            "min_gap": self.min_gap,
            "t_at_min_gap": self.t_at_min_gap,
            "suggested_t_us": self.suggested_t_us,
            "n_atoms": self.n_atoms,
        }


def compute_min_gap(
    positions: list[tuple[float, float]],
    schedule: Schedule,
    n_samples: int = DEFAULT_GAP_SAMPLES,
) -> GapTrace | None:
    """
    Sample the instantaneous spectral gap E_1 − E_0 of H(t) along the schedule.

    Returns ``None`` when ``len(positions) > GAP_MAX_ATOMS`` so the caller can
    surface a clear "too large" error rather than spin a CPU for minutes.
    Returns a GapTrace otherwise — its ``min_gap`` and ``suggested_t_us`` are
    the headline numbers Stage 4 should display.
    """
    n = len(positions)
    if n == 0 or n > GAP_MAX_ATOMS:
        return None
    if n_samples < 3:
        n_samples = 3

    t_total = schedule.duration
    if t_total <= 0:
        return GapTrace(
            times=(0.0,),
            gaps=(0.0,),
            min_gap=0.0,
            t_at_min_gap=0.0,
            suggested_t_us=None,
            n_atoms=n,
        )

    times = [i * t_total / (n_samples - 1) for i in range(n_samples)]
    gaps: list[float] = []
    for t in times:
        omega = schedule.omega.value_at(t)
        delta = schedule.delta.value_at(t)
        phi = schedule.phi.value_at(t)
        e = _lowest_eigenvalues(positions, omega, delta, phi, k=2)
        gap = float(e[1] - e[0]) if e.size >= 2 else 0.0
        gaps.append(max(0.0, gap))  # numerical noise can give tiny negatives

    i_min = int(np.argmin(gaps))
    min_gap = gaps[i_min]
    suggested = None if min_gap <= 0.0 else 1.0 / (min_gap * min_gap)
    return GapTrace(
        times=tuple(times),
        gaps=tuple(gaps),
        min_gap=min_gap,
        t_at_min_gap=times[i_min],
        suggested_t_us=suggested,
        n_atoms=n,
    )


@dataclass(frozen=True)
class SpectrumTrace:
    """Lowest k eigenvalues of H(t) at evenly spaced sample times."""

    times: tuple[float, ...]
    """Sample times in µs."""

    eigenvalues: tuple[tuple[float, ...], ...]
    """``eigenvalues[i]`` = ascending k lowest eigenvalues at ``times[i]``."""

    n_levels: int
    """Number of low-lying levels returned per sample (k)."""

    n_atoms: int

    def to_dict(self) -> dict:
        return {
            "times": list(self.times),
            "eigenvalues": [list(row) for row in self.eigenvalues],
            "n_levels": self.n_levels,
            "n_atoms": self.n_atoms,
        }


def compute_spectrum(
    positions: list[tuple[float, float]],
    schedule: Schedule,
    n_samples: int = DEFAULT_GAP_SAMPLES,
    n_levels: int = 4,
) -> SpectrumTrace | None:
    """
    Sample the k lowest eigenvalues of H(t) along the schedule.

    Same plumbing as :func:`compute_min_gap` — diagonalise the dense 2^N
    Hamiltonian at ``n_samples`` evenly spaced times — but keep the first
    ``n_levels`` eigenvalues rather than only the gap. Used by Stage 4 to
    plot E_0(t), E_1(t), … so the user can see the avoided crossing where
    δ_min occurs.

    Returns ``None`` when ``len(positions) > GAP_MAX_ATOMS`` so the caller
    can surface a "too large" message instead of stalling for minutes.
    """
    n = len(positions)
    if n == 0 or n > GAP_MAX_ATOMS:
        return None
    if n_samples < 3:
        n_samples = 3
    dim = 1 << n
    k = max(1, min(n_levels, dim))

    t_total = schedule.duration
    if t_total <= 0:
        return SpectrumTrace(
            times=(0.0,),
            eigenvalues=((0.0,) * k,),
            n_levels=k,
            n_atoms=n,
        )

    times = [i * t_total / (n_samples - 1) for i in range(n_samples)]
    rows: list[tuple[float, ...]] = []
    for t in times:
        omega = schedule.omega.value_at(t)
        delta = schedule.delta.value_at(t)
        phi = schedule.phi.value_at(t)
        e = _lowest_eigenvalues(positions, omega, delta, phi, k=k)
        rows.append(tuple(float(v) for v in e[:k]))
    return SpectrumTrace(
        times=tuple(times),
        eigenvalues=tuple(rows),
        n_levels=k,
        n_atoms=n,
    )


__all__ = [
    "GapTrace",
    "SpectrumTrace",
    "compute_min_gap",
    "compute_spectrum",
    "GAP_MAX_ATOMS",
    "DEFAULT_GAP_SAMPLES",
]
