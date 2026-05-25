"""
Rydberg Hamiltonian — explicit matrix form.

Implements the analog Hamiltonian from Aquila whitepaper §1.3:

    H(t) = (Ω(t)/2) Σ_i [e^(iφ(t)) |g><r|_i + e^(-iφ(t)) |r><g|_i]
           - Δ(t) Σ_i n̂_i
           + Σ_{i<j} (C6 / |x_i - x_j|^6) n̂_i n̂_j

where |g> = |0>, |r> = |1>, n̂_i = |r><r|_i.

We construct the (2^N × 2^N) matrix via Kronecker products. This is intended
for **verification only** — for N up to ~10 atoms it's cheap and fully
auditable; for larger arrays Phase 4 will defer to Bloqade.

Single-source-of-truth for the formula: future Bloqade/QuTiP cross-checks
compare to *this* matrix.

Units: rad/µs for Ω, Δ; µm for positions; C6 in rad·µs⁻¹·µm⁶.
"""

from __future__ import annotations

import numpy as np
import scipy.sparse as sp

from .constants import AQUILA, C6_RAD_US_UM6, AquilaSpec

# Pauli / projector building blocks  (|g>=|0>, |r>=|1>)
_SIGMA_GR = np.array([[0.0, 1.0], [0.0, 0.0]], dtype=complex)  # |g><r|
_SIGMA_RG = np.array([[0.0, 0.0], [1.0, 0.0]], dtype=complex)  # |r><g|
_N_OP = np.array([[0.0, 0.0], [0.0, 1.0]], dtype=complex)  # n̂ = |r><r|
_I2 = np.eye(2, dtype=complex)


def _local_op(op: np.ndarray, i: int, n: int) -> np.ndarray:
    """Embed a single-qubit operator at site i into the n-qubit Hilbert space."""
    out = np.array([[1.0]], dtype=complex)
    for k in range(n):
        out = np.kron(out, op if k == i else _I2)
    return out


def _two_body_op(op_i: np.ndarray, op_j: np.ndarray, i: int, j: int, n: int) -> np.ndarray:
    """Embed `op_i ⊗ op_j` at sites (i, j) into the n-qubit space."""
    if i == j:
        raise ValueError("i and j must differ")
    out = np.array([[1.0]], dtype=complex)
    for k in range(n):
        if k == i:
            out = np.kron(out, op_i)
        elif k == j:
            out = np.kron(out, op_j)
        else:
            out = np.kron(out, _I2)
    return out


def rydberg_hamiltonian(
    omega: float,
    delta: float,
    phi: float,
    positions: list[tuple[float, float]],
    *,
    c6: float = C6_RAD_US_UM6,
) -> np.ndarray:
    """
    Build H at a single instant given the four control parameters + positions.

    Returns a (2^N, 2^N) complex Hermitian matrix in the computational basis
    where bit i is 1 ⇔ atom i is in |r>.
    """
    n = len(positions)
    if n == 0:
        return np.zeros((1, 1), dtype=complex)

    dim = 1 << n  # 2^n
    H = np.zeros((dim, dim), dtype=complex)

    # Drive term: (Ω/2) Σ_i [e^(iφ) |g><r|_i + e^(-iφ) |r><g|_i]
    e_plus = np.exp(1j * phi)
    e_minus = np.exp(-1j * phi)
    half_omega = omega / 2.0
    for i in range(n):
        H += half_omega * e_plus * _local_op(_SIGMA_GR, i, n)
        H += half_omega * e_minus * _local_op(_SIGMA_RG, i, n)

    # Detuning term: -Δ Σ_i n̂_i
    for i in range(n):
        H -= delta * _local_op(_N_OP, i, n)

    # Van der Waals interaction
    for i in range(n):
        for j in range(i + 1, n):
            xi, yi = positions[i]
            xj, yj = positions[j]
            r = float(np.hypot(xi - xj, yi - yj))
            if r == 0.0:
                # avoid divide-by-zero; physically meaningless config caught elsewhere
                continue
            vij = c6 / r**6
            H += vij * _two_body_op(_N_OP, _N_OP, i, j, n)

    return H


def rydberg_hamiltonian_sparse(
    omega: float,
    delta: float,
    phi: float,
    positions: list[tuple[float, float]],
    *,
    c6: float = C6_RAD_US_UM6,
) -> sp.csr_matrix:
    """
    Sparse CSR form of :func:`rydberg_hamiltonian` — same physics, same units.

    The Rydberg Hamiltonian has exactly two kinds of nonzeros:
      - Diagonal: detuning −Δ·Σn̂ + interaction Σ V_ij·n̂n̂  (one entry per basis state)
      - Off-diagonal: (Ω/2)·single-bit-flip drive  (N entries per basis state)
    Total nonzeros ≈ (N+1)·2^N — sparsity ≈ N/2^N. For N=16 that's ~0.025%,
    which makes scipy's Lanczos solver (eigsh) two-to-three orders of magnitude
    faster than dense eigvalsh for the bottom-k eigenvalues.

    Used by :mod:`pipeline.adiabatic_gap` to push the spectrum/gap analysis
    from N≤10 (dense) to N≤16 (sparse). Validated against `rydberg_hamiltonian`
    in test_hamiltonian.py.
    """
    n = len(positions)
    dim = 1 << n
    if n == 0:
        return sp.csr_matrix((1, 1), dtype=complex)

    b_arr = np.arange(dim, dtype=np.int64)

    # Bit i of basis index b ∈ {0,1} — shape (n, dim).
    # Use MSB-first convention to match the Kronecker-product ordering of
    # :func:`rydberg_hamiltonian`: atom 0 occupies the leftmost bit position
    # (state index (b >> (n−1−0)) & 1), which is `np.kron(op_0, …)` semantics.
    bits = np.array([(b_arr >> (n - 1 - i)) & 1 for i in range(n)], dtype=np.int64)

    # Diagonal: detuning + Rydberg-Rydberg interaction
    diag = np.zeros(dim, dtype=complex)
    diag -= delta * bits.sum(axis=0)
    for i in range(n):
        xi, yi = positions[i]
        for j in range(i + 1, n):
            xj, yj = positions[j]
            r = float(np.hypot(xi - xj, yi - yj))
            if r == 0.0:
                continue
            both_excited = bits[i] & bits[j]
            diag += (c6 / r**6) * both_excited

    # Off-diagonal: drive term flips one bit per matrix element.
    # <b ⊕ 2^i | H_drive | b> = (Ω/2) · e^(iφ)   if bit i of b is 1   (σ_GR lowers it)
    #                        = (Ω/2) · e^(−iφ)  if bit i of b is 0   (σ_RG raises it)
    e_plus = np.exp(1j * phi)
    e_minus = np.exp(-1j * phi)
    half_omega = omega / 2.0

    rows_all: list[np.ndarray] = []
    cols_all: list[np.ndarray] = []
    data_all: list[np.ndarray] = []
    if half_omega != 0.0:
        for i in range(n):
            flipped = b_arr ^ (np.int64(1) << (n - 1 - i))
            bit_i = bits[i]
            coeff = np.where(bit_i == 1, half_omega * e_plus, half_omega * e_minus)
            rows_all.append(flipped)
            cols_all.append(b_arr)
            data_all.append(coeff.astype(complex))

    if rows_all:
        rows = np.concatenate(rows_all)
        cols = np.concatenate(cols_all)
        data = np.concatenate(data_all)
        off = sp.csr_matrix((data, (rows, cols)), shape=(dim, dim), dtype=complex)
    else:
        off = sp.csr_matrix((dim, dim), dtype=complex)

    H = off + sp.diags(diag, format="csr")
    return H.tocsr()


def blockade_pair_eigenvalues(
    omega: float,
    delta: float,
    distance_um: float,
    *,
    c6: float = C6_RAD_US_UM6,
) -> np.ndarray:
    """
    Closed-form helper: eigenvalues of the 2-atom Hamiltonian (no phase).
    Useful as a regression target — the test suite checks the full matrix
    against these analytic eigenvalues.
    """
    H = rydberg_hamiltonian(
        omega=omega,
        delta=delta,
        phi=0.0,
        positions=[(0.0, 0.0), (distance_um, 0.0)],
        c6=c6,
    )
    return np.sort(np.linalg.eigvalsh(H))


def is_hermitian(matrix: np.ndarray, tol: float = 1e-10) -> bool:
    return np.allclose(matrix, matrix.conj().T, atol=tol)


def _check_aquila_compatible(
    omega: float, delta: float, spec: AquilaSpec = AQUILA
) -> None:
    """Optional pre-flight assertion against hardware limits."""
    if not (0 <= omega <= spec.max_rabi_rad_us):
        raise ValueError(
            f"Ω={omega} rad/µs out of [0, {spec.max_rabi_rad_us}] supported by Aquila"
        )
    if not (-spec.detuning_max_rad_us <= delta <= spec.detuning_max_rad_us):
        raise ValueError(
            f"Δ={delta} rad/µs out of [±{spec.detuning_max_rad_us}] supported by Aquila"
        )
