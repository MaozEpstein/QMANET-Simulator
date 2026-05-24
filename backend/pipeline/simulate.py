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

from dataclasses import dataclass, field
from typing import Callable

import numpy as np
import qutip

from aquila.constants import C6_RAD_US_UM6
from aquila.hamiltonian import rydberg_hamiltonian
from pipeline.schedule import Schedule

# Frame budget: we sample frames at a coarse grid (~30 fps over 4µs ⇒ 120 frames),
# while QuTiP integrates internally with adaptive step size.
DEFAULT_N_FRAMES = 120


@dataclass(frozen=True)
class SimulationFrame:
    t_us: float
    rydberg_populations: tuple[float, ...]  # length N, ⟨n̂_i(t)⟩ at this t
    norm: float  # ⟨ψ|ψ⟩ — should stay ≈ 1


@dataclass(frozen=True)
class SimulationResult:
    frames: tuple[SimulationFrame, ...] = field(default=())
    final_bitstring_probs: dict[str, float] = field(default_factory=dict)
    """Probability of each computational-basis outcome at t=T."""

    n_atoms: int = 0
    duration_us: float = 0.0

    def populations_matrix(self) -> np.ndarray:
        """Return frames as a (T, N) numpy array of populations."""
        if not self.frames:
            return np.zeros((0, 0))
        return np.array([f.rydberg_populations for f in self.frames])

    def times(self) -> np.ndarray:
        return np.array([f.t_us for f in self.frames])


def _build_qutip_hamiltonian(
    schedule: Schedule,
    positions: list[tuple[float, float]],
    *,
    c6: float = C6_RAD_US_UM6,
) -> Callable[[float, dict | None], qutip.Qobj]:
    """
    Build the time-dependent H(t) as a QuTiP-compatible function.

    QuTiP expects an `H_func(t, args) -> Qobj`. We rebuild the dense matrix
    each call via our `rydberg_hamiltonian` constructor. This is wasteful for
    large schedules (could split into [H0 + f_omega(t)*H_x + f_delta(t)*H_n + ...])
    but is straightforward, exact, and fast enough up to ~10 atoms.
    """
    n = len(positions)
    dim = 1 << n

    def H_func(t: float, _args: dict | None = None) -> qutip.Qobj:
        omega = schedule.omega.value_at(t)
        delta = schedule.delta.value_at(t)
        phi = schedule.phi.value_at(t)
        H = rydberg_hamiltonian(omega, delta, phi, positions, c6=c6)
        return qutip.Qobj(H, dims=[[2] * n, [2] * n]) if n > 0 else qutip.Qobj(np.zeros((1, 1)))

    # `dim` is unused once returned, but the closure captures `n` for sanity.
    _ = dim
    return H_func


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


def simulate(
    schedule: Schedule,
    positions: list[tuple[float, float]],
    *,
    n_frames: int = DEFAULT_N_FRAMES,
    c6: float = C6_RAD_US_UM6,
    on_frame: Callable[[SimulationFrame], None] | None = None,
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
    H_func = _build_qutip_hamiltonian(schedule, positions, c6=c6)

    psi0 = _initial_ground_state(n)
    n_ops = [_n_op_for_qubit(i, n) for i in range(n)]

    # QuTiP's sesolve with a single function-form Hamiltonian
    result = qutip.sesolve(
        H_func,
        psi0,
        t_grid,
        e_ops=n_ops,
        options={"store_states": True, "atol": 1e-9, "rtol": 1e-7, "nsteps": 50_000},
    )

    # result.expect is a list of length n, each an array of length len(t_grid)
    frames: list[SimulationFrame] = []
    for ti, t in enumerate(t_grid):
        populations = tuple(float(result.expect[i][ti]) for i in range(n))
        psi_t = result.states[ti] if result.states else None
        # In QuTiP 5, ψ†ψ for a ket-Qobj is a complex scalar (not a 1×1 Qobj).
        if psi_t is None:
            norm = 1.0
        else:
            inner = (psi_t.dag() * psi_t)
            norm = float(np.real(inner if np.isscalar(inner) else inner.tr()))
        frame = SimulationFrame(
            t_us=float(t),
            rydberg_populations=populations,
            norm=norm,
        )
        frames.append(frame)
        if on_frame is not None:
            on_frame(frame)

    # Final bitstring probabilities: |c_b|^2 for each computational basis state b
    final_state = result.states[-1] if result.states else None
    bitstring_probs: dict[str, float] = {}
    if final_state is not None:
        amplitudes = final_state.full().reshape(-1)
        for b in range(len(amplitudes)):
            prob = float(abs(amplitudes[b]) ** 2)
            if prob > 1e-12:
                bitstring = format(b, f"0{n}b")
                bitstring_probs[bitstring] = prob

    return SimulationResult(
        frames=tuple(frames),
        final_bitstring_probs=bitstring_probs,
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
