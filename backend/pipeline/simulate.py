"""
Time-dependent evolution of the Rydberg Hamiltonian.

Given a Schedule (Ω(t), Δ(t), φ(t)) and a list of atom positions, integrate
the Schrödinger equation:

    i d|ψ>/dt = H(t) |ψ>,    |ψ(0)> = |gg…g>

and report the Rydberg population ⟨n̂_i(t)⟩ at every sampled time. The
output frames are what the WebSocket pushes to the browser.

Implementation: QuTiP's sesolve (Krylov/RK45 under the hood) integrates the
problem with the H(t) we build via `aquila.hamiltonian.rydberg_hamiltonian`,
which is already cross-checked against the analytic single-qubit and
blockaded-pair results in test_hamiltonian.py.

For small N (≤ ~10 atoms) this is fast enough for live streaming — the bottleneck
is HTML rendering of the frames, not the physics. For larger N, Phase 7 will
defer to the QuEra Aquila device through Braket.
"""

from __future__ import annotations

import math
from dataclasses import dataclass, field
from typing import Callable

import numpy as np
import qutip
import scipy.linalg

from aquila.constants import C6_RAD_US_UM6
from aquila.hamiltonian import (
    _local_op,
    _two_body_op,
    _N_OP,
)
from pipeline.schedule import Schedule

# Frame budget: we sample frames at a coarse grid (~30 fps over 4µs ⇒ 120 frames),
# while QuTiP integrates internally with adaptive step size.
DEFAULT_N_FRAMES = 120


@dataclass(frozen=True)
class NoiseConfig:
    """Lindblad noise model. When enabled, `simulate()` switches from
    `sesolve` (pure unitary) to `mesolve` with collapse operators:
      - Rydberg decay |r⟩→|g⟩: rate 1/T1, operator σ⁻_i = |g⟩⟨r|_i
      - Pure dephasing:          rate 1/T_φ with 1/T_φ = 1/T2 - 1/(2 T1),
        operator √(1/T_φ)·n̂_i  (when positive; clamped to 0 otherwise).

    Units: microseconds. `None` for a channel disables it; setting either to
    zero disables it as well. `enabled=False` short-circuits to the unitary
    sesolve path with zero overhead so the noise toggle is free when off.
    """

    enabled: bool = False
    t1_us: float | None = None
    t2_us: float | None = None


@dataclass(frozen=True)
class SimulationFrame:
    t_us: float
    rydberg_populations: tuple[float, ...]  # length N, ⟨n̂_i(t)⟩ at this t
    norm: float  # ⟨ψ|ψ⟩ (pure) or Tr(ρ) (mixed) — should stay ≈ 1
    # Adiabaticity extras (optional — None when extras=False or for N=0):
    gap: float | None = None              # E_1(t) - E_0(t)
    fidelity_gs: float | None = None      # |⟨GS(t)|ψ(t)⟩|² or ⟨GS|ρ|GS⟩
    energy_expect: float | None = None    # ⟨H(t)⟩
    gs_energy: float | None = None        # E_0(t)
    purity: float | None = None           # Tr(ρ²); None for unitary runs


@dataclass(frozen=True)
class SimulationResult:
    frames: tuple[SimulationFrame, ...] = field(default=())
    final_bitstring_probs: dict[str, float] = field(default_factory=dict)
    """Probability of each computational-basis outcome at t=T."""

    tracked_bitstrings: dict[str, tuple[float, ...]] = field(default_factory=dict)
    """For the top-K bitstrings (by final probability), the per-frame
    probability time-series. Empty when bitstring tracking is disabled."""

    n_atoms: int = 0
    duration_us: float = 0.0

    def populations_matrix(self) -> np.ndarray:
        """Return frames as a (T, N) numpy array of populations."""
        if not self.frames:
            return np.zeros((0, 0))
        return np.array([f.rydberg_populations for f in self.frames])

    def times(self) -> np.ndarray:
        return np.array([f.t_us for f in self.frames])


@dataclass(frozen=True)
class _HamiltonianPieces:
    """
    Time-independent pieces of the Rydberg Hamiltonian, decomposed so that
    the full instantaneous H(t) is a sum of constant operators × scalar
    coefficients of t. This lets QuTiP's sesolve do a fast sparse matvec
    per substep instead of rebuilding the full dense matrix from scratch.

    Decomposition:
        H(t) = H_vdw + (Ω(t)/2) cos(φ(t))·H_x
                     + (Ω(t)/2) sin(φ(t))·H_y
                     + (-Δ(t))·H_n
    where H_x = Σ σ_x_i, H_y = Σ σ_y_i, H_n = Σ n̂_i, H_vdw = Σ V_ij n̂_i n̂_j.
    """

    H_vdw: np.ndarray
    H_x: np.ndarray
    H_y: np.ndarray
    H_n: np.ndarray
    has_phi: bool  # if φ ≡ 0 we can skip the H_y term entirely


def _build_hamiltonian_pieces(
    schedule: Schedule,
    positions: list[tuple[float, float]],
    *,
    c6: float = C6_RAD_US_UM6,
) -> _HamiltonianPieces:
    n = len(positions)
    dim = 1 << n
    if n == 0:
        z = np.zeros((1, 1), dtype=complex)
        return _HamiltonianPieces(z, z, z, z, has_phi=False)

    sx = np.array([[0.0, 1.0], [1.0, 0.0]], dtype=complex)
    sy = np.array([[0.0, -1.0j], [1.0j, 0.0]], dtype=complex)

    H_x = np.zeros((dim, dim), dtype=complex)
    H_y = np.zeros((dim, dim), dtype=complex)
    H_n = np.zeros((dim, dim), dtype=complex)
    for i in range(n):
        H_x += _local_op(sx, i, n)
        H_y += _local_op(sy, i, n)
        H_n += _local_op(_N_OP, i, n)

    H_vdw = np.zeros((dim, dim), dtype=complex)
    for i in range(n):
        xi, yi = positions[i]
        for j in range(i + 1, n):
            xj, yj = positions[j]
            r = float(np.hypot(xi - xj, yi - yj))
            if r == 0.0:
                continue
            H_vdw += (c6 / r**6) * _two_body_op(_N_OP, _N_OP, i, j, n)

    # Detect whether φ ever leaves 0 (lets us skip an entire matvec channel).
    has_phi = any(abs(v) > 1e-12 for v in schedule.phi.values)

    return _HamiltonianPieces(H_vdw=H_vdw, H_x=H_x, H_y=H_y, H_n=H_n, has_phi=has_phi)


def _hamiltonian_at(pieces: _HamiltonianPieces, schedule: Schedule, t: float) -> np.ndarray:
    """Reconstruct dense H(t) from the precomputed pieces. Cheap: 3 saxpys."""
    omega = schedule.omega.value_at(t)
    delta = schedule.delta.value_at(t)
    phi = schedule.phi.value_at(t)
    half_om = 0.5 * omega
    H = pieces.H_vdw + (half_om * math.cos(phi)) * pieces.H_x + (-delta) * pieces.H_n
    if pieces.has_phi:
        H = H + (half_om * math.sin(phi)) * pieces.H_y
    return H


def _initial_ground_state(n: int) -> qutip.Qobj:
    """|gg…g⟩ as a Qobj. In our convention atom 0 is the leftmost qubit."""
    if n == 0:
        return qutip.basis(1, 0)  # trivial scalar 1
    psi = qutip.basis(2, 0)  # |g>
    for _ in range(n - 1):
        psi = qutip.tensor(psi, qutip.basis(2, 0))
    return psi


def _n_op_for_qubit(i: int, n: int) -> qutip.Qobj:
    """n̂_i = |r⟩⟨r| acting on qubit i, identity elsewhere."""
    ops = []
    for k in range(n):
        if k == i:
            ops.append(qutip.basis(2, 1) * qutip.basis(2, 1).dag())  # |1><1|
        else:
            ops.append(qutip.qeye(2))
    return qutip.tensor(ops) if n > 1 else ops[0]


def _build_collapse_operators(
    noise: NoiseConfig, n: int
) -> list[qutip.Qobj]:
    """Construct per-atom Lindblad collapse operators for `mesolve`.

    Decay channel: σ⁻_i with rate 1/T1 → op = √(1/T1)·|g⟩⟨r|_i.
    Pure dephasing: 1/T_φ = max(0, 1/T2 − 1/(2·T1)) → op = √(1/T_φ)·n̂_i.

    Setting T1 or T2 to None / zero disables that channel.
    """
    if n == 0:
        return []
    ops: list[qutip.Qobj] = []
    gamma_decay = 1.0 / noise.t1_us if (noise.t1_us and noise.t1_us > 0) else 0.0
    gamma_t2 = 1.0 / noise.t2_us if (noise.t2_us and noise.t2_us > 0) else 0.0
    # 1/T_φ = 1/T2 − 1/(2 T1)  (clamped non-negative)
    gamma_dephase = max(0.0, gamma_t2 - 0.5 * gamma_decay)

    # σ⁻ = |g⟩⟨r| in our convention (|g⟩ = |0⟩, |r⟩ = |1⟩).
    sigma_minus_local = np.array([[0.0, 1.0], [0.0, 0.0]], dtype=complex)
    n_op_local = np.array([[0.0, 0.0], [0.0, 1.0]], dtype=complex)
    dims = [[2] * n, [2] * n]

    if gamma_decay > 0.0:
        sqrt_g = math.sqrt(gamma_decay)
        for i in range(n):
            local = _local_op(sigma_minus_local, i, n)
            ops.append(qutip.Qobj(sqrt_g * local, dims=dims))
    if gamma_dephase > 0.0:
        sqrt_g = math.sqrt(gamma_dephase)
        for i in range(n):
            local = _local_op(n_op_local, i, n)
            ops.append(qutip.Qobj(sqrt_g * local, dims=dims))
    return ops


def simulate(
    schedule: Schedule,
    positions: list[tuple[float, float]],
    *,
    n_frames: int = DEFAULT_N_FRAMES,
    c6: float = C6_RAD_US_UM6,
    on_frame: Callable[[SimulationFrame], None] | None = None,
    extras: bool = True,
    noise: NoiseConfig | None = None,
    track_bitstrings: bool = True,
    top_k: int = 8,
) -> SimulationResult:
    """
    Integrate the Schrödinger equation under H(t) and report ⟨n̂_i(t)⟩.

    Args:
        schedule: Ω(t), Δ(t), φ(t).
        positions: list of (x, y) in µm.
        n_frames: number of evenly-spaced output frames over [0, T].
        c6: Rydberg interaction strength.
        on_frame: optional callback for live streaming (each frame as
            soon as it's available). Useful for WS push.

    Returns:
        SimulationResult with the full population history and the final
        bitstring distribution.
    """
    n = len(positions)
    if n == 0 or schedule.duration <= 0:
        return SimulationResult(frames=(), n_atoms=n, duration_us=schedule.duration)

    t_grid = np.linspace(0.0, schedule.duration, max(n_frames, 2))
    pieces = _build_hamiltonian_pieces(schedule, positions, c6=c6)

    psi0 = _initial_ground_state(n)
    n_ops = [_n_op_for_qubit(i, n) for i in range(n)]

    # Split-Hamiltonian form. QuTiP evaluates each scalar coefficient at every
    # internal substep and re-uses the precomputed dense Qobjs — no Python loop
    # rebuilding the full 2^N matrix per call, which was the dominant cost
    # before this refactor (≈ 5–10× speedup for N=8–10).
    dims = [[2] * n, [2] * n]
    H_x_q = qutip.Qobj(pieces.H_x, dims=dims)
    H_y_q = qutip.Qobj(pieces.H_y, dims=dims)
    H_n_q = qutip.Qobj(pieces.H_n, dims=dims)
    H_vdw_q = qutip.Qobj(pieces.H_vdw, dims=dims)

    sched_omega = schedule.omega
    sched_delta = schedule.delta
    sched_phi = schedule.phi

    def c_x(t: float, _args: dict | None = None) -> float:
        return 0.5 * sched_omega.value_at(t) * math.cos(sched_phi.value_at(t))

    def c_y(t: float, _args: dict | None = None) -> float:
        return 0.5 * sched_omega.value_at(t) * math.sin(sched_phi.value_at(t))

    def c_n(t: float, _args: dict | None = None) -> float:
        return -sched_delta.value_at(t)

    H_list: list = [H_vdw_q, [H_x_q, c_x], [H_n_q, c_n]]
    if pieces.has_phi:
        H_list.append([H_y_q, c_y])

    # Decide unitary vs Lindblad. We short-circuit to `sesolve` when there's
    # no noise so the toggle is free — `mesolve` of dim² density matrices is
    # 2–3× slower even with no collapse operators.
    use_noise = (
        noise is not None
        and noise.enabled
        and (
            (noise.t1_us is not None and noise.t1_us > 0)
            or (noise.t2_us is not None and noise.t2_us > 0)
        )
    )

    common_opts = {"store_states": True, "atol": 1e-9, "rtol": 1e-7, "nsteps": 50_000}
    if use_noise:
        c_ops = _build_collapse_operators(noise, n)  # type: ignore[arg-type]
        result = qutip.mesolve(H_list, psi0, t_grid, c_ops=c_ops, e_ops=n_ops, options=common_opts)
    else:
        result = qutip.sesolve(H_list, psi0, t_grid, e_ops=n_ops, options=common_opts)

    # result.expect is a list of length n, each an array of length len(t_grid)
    frames: list[SimulationFrame] = []
    # Pre-compute |GS(t)⟩ vectors per frame? No — we already do it inside the
    # extras block, so reuse that path.
    state_vecs: list[np.ndarray | None] = []  # for bitstring tracking
    for ti, t in enumerate(t_grid):
        populations = tuple(float(result.expect[i][ti]) for i in range(n))
        state_t = result.states[ti] if result.states else None

        if state_t is None:
            norm = 1.0
            psi_vec = None
            rho_dense: np.ndarray | None = None
        elif use_noise:
            # state_t is a density matrix Qobj.
            rho_dense = state_t.full()
            norm = float(np.real(np.trace(rho_dense)))
            psi_vec = None
        else:
            # state_t is a ket Qobj.
            inner = (state_t.dag() * state_t)
            norm = float(np.real(inner if np.isscalar(inner) else inner.tr()))
            psi_vec = state_t.full().reshape(-1)
            rho_dense = None

        gap_val: float | None = None
        fidelity_val: float | None = None
        energy_val: float | None = None
        gs_energy_val: float | None = None
        purity_val: float | None = None

        if extras and state_t is not None and n > 0:
            H_dense = _hamiltonian_at(pieces, schedule, float(t))
            try:
                k = 2 if H_dense.shape[0] >= 2 else 1
                eigvals, eigvecs = scipy.linalg.eigh(
                    H_dense, subset_by_index=[0, k - 1]
                )
                gs_energy_val = float(eigvals[0])
                if eigvals.shape[0] > 1:
                    gap_val = float(eigvals[1] - eigvals[0])
                gs_vec = eigvecs[:, 0]
                if rho_dense is not None:
                    # Mixed state: F = ⟨GS|ρ|GS⟩, ⟨H⟩ = Tr(H·ρ), purity = Tr(ρ²).
                    fidelity_val = float(
                        np.real(np.vdot(gs_vec, rho_dense @ gs_vec))
                    )
                    energy_val = float(np.real(np.trace(H_dense @ rho_dense)))
                    purity_val = float(np.real(np.trace(rho_dense @ rho_dense)))
                elif psi_vec is not None:
                    overlap = np.vdot(gs_vec, psi_vec)
                    fidelity_val = float(abs(overlap) ** 2)
                    energy_val = float(np.real(np.vdot(psi_vec, H_dense @ psi_vec)))
                    # Pure-state purity is identically 1; leave None to keep the
                    # KPI hidden when there's nothing interesting to show.
            except (np.linalg.LinAlgError, scipy.linalg.LinAlgError):
                pass

        # Capture per-frame computational-basis populations for bitstring
        # tracking. Cheap: diag of ρ (mixed) or |ψ|² (pure).
        if track_bitstrings and n > 0 and state_t is not None:
            if rho_dense is not None:
                state_vecs.append(np.real(np.diag(rho_dense)).astype(float))
            elif psi_vec is not None:
                state_vecs.append((np.abs(psi_vec) ** 2).astype(float))
            else:
                state_vecs.append(None)
        else:
            state_vecs.append(None)

        frame = SimulationFrame(
            t_us=float(t),
            rydberg_populations=populations,
            norm=norm,
            gap=gap_val,
            fidelity_gs=fidelity_val,
            energy_expect=energy_val,
            gs_energy=gs_energy_val,
            purity=purity_val,
        )
        frames.append(frame)
        if on_frame is not None:
            on_frame(frame)

    # Final bitstring probabilities: |c_b|^2 (pure) or diag(ρ) (mixed).
    final_state = result.states[-1] if result.states else None
    bitstring_probs: dict[str, float] = {}
    final_probs_arr: np.ndarray | None = None
    if final_state is not None and n > 0:
        if use_noise:
            final_probs_arr = np.real(np.diag(final_state.full())).astype(float)
        else:
            amps = final_state.full().reshape(-1)
            final_probs_arr = (np.abs(amps) ** 2).astype(float)
        for b in range(final_probs_arr.shape[0]):
            p = float(final_probs_arr[b])
            if p > 1e-12:
                bitstring_probs[format(b, f"0{n}b")] = p

    # Top-K bitstring time-series.
    tracked: dict[str, tuple[float, ...]] = {}
    if track_bitstrings and final_probs_arr is not None and n > 0:
        k = min(max(1, top_k), final_probs_arr.shape[0])
        # argpartition gives unsorted top-k indices; sort them by probability
        # so the heatmap rows are pre-ordered for the frontend.
        top_idx_unsorted = np.argpartition(final_probs_arr, -k)[-k:]
        top_idx = top_idx_unsorted[
            np.argsort(-final_probs_arr[top_idx_unsorted])
        ]
        for b in top_idx:
            label = format(int(b), f"0{n}b")
            series = []
            for vec in state_vecs:
                series.append(float(vec[b]) if vec is not None else 0.0)
            tracked[label] = tuple(series)

    return SimulationResult(
        frames=tuple(frames),
        final_bitstring_probs=bitstring_probs,
        tracked_bitstrings=tracked,
        n_atoms=n,
        duration_us=float(schedule.duration),
    )


def sample_measurements(
    result: SimulationResult,
    n_shots: int,
    *,
    seed: int | None = None,
) -> list[str]:
    """Draw measurement bitstrings from the final Rydberg-basis probability."""
    if not result.final_bitstring_probs:
        return []
    rng = np.random.default_rng(seed)
    strings = list(result.final_bitstring_probs.keys())
    probs = np.array([result.final_bitstring_probs[s] for s in strings])
    probs = probs / probs.sum()  # renormalize against numerical loss
    idx = rng.choice(len(strings), size=n_shots, p=probs)
    return [strings[i] for i in idx]
