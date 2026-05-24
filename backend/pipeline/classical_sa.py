"""
Classical Simulated Annealing for MIS — the benchmark we compare the
adiabatic quantum approach against (Ebadi 2022 §4 baseline).

Energy function:
    E(S) = -|S| + penalty * (# of in-S edges)

Penalty ≥ 1.5 guarantees that any IS dominates any non-IS in energy, so the
ground state of E is the maximum independent set.

The annealing schedule is geometric: T_k = T_0 * cooling^k. At each step we
flip one random vertex's membership in S and accept by Metropolis. Final
result is the best (lowest-E) S ever encountered, projected to an IS by the
greedy fix (so the returned set is always a valid IS).
"""

from __future__ import annotations

import math
from dataclasses import dataclass

import numpy as np

from .clique_to_mis import Graph
from .postprocess import _adjacency_sets, count_violations, greedy_remove_violations


@dataclass(frozen=True)
class SAConfig:
    n_sweeps: int = 200
    """Number of full vertex-sweeps. Total iterations = n_sweeps * n_nodes."""

    t_initial: float = 2.0
    t_final: float = 0.01
    penalty: float = 2.0
    """Multiplier on # violating edges in the energy. >1 guarantees IS optimum."""

    seed: int | None = 0


@dataclass(frozen=True)
class SAResult:
    best_set: tuple[int, ...]
    best_size: int
    best_energy: float
    n_iterations: int
    energy_trace: tuple[float, ...]
    """One sample per sweep — for the UI to plot annealing progress."""

    @property
    def bitstring(self) -> str:
        if not self.best_set:
            return ""
        n = max(self.best_set) + 1
        return "".join("1" if i in self.best_set else "0" for i in range(n))

    def to_dict(self) -> dict:
        return {
            "best_set": list(self.best_set),
            "best_size": self.best_size,
            "best_energy": self.best_energy,
            "n_iterations": self.n_iterations,
            "energy_trace": list(self.energy_trace),
        }


def _energy(S: set[int], adj: list[set[int]], penalty: float) -> float:
    return -float(len(S)) + penalty * count_violations(S, adj)


def simulated_annealing(graph: Graph, config: SAConfig | None = None) -> SAResult:
    """Run SA and return the best IS found."""
    cfg = config or SAConfig()
    n = graph.n_nodes
    if n == 0:
        return SAResult(
            best_set=(),
            best_size=0,
            best_energy=0.0,
            n_iterations=0,
            energy_trace=(),
        )
    rng = np.random.default_rng(cfg.seed)
    adj = _adjacency_sets(graph)
    S: set[int] = set()
    E = _energy(S, adj, cfg.penalty)

    best_set = set(S)
    best_E = E
    trace: list[float] = [E]

    total_iters = max(cfg.n_sweeps * n, 1)
    # Geometric cooling: ratio per *iteration*, not per sweep
    if total_iters > 1:
        cooling = (cfg.t_final / cfg.t_initial) ** (1.0 / (total_iters - 1))
    else:
        cooling = 1.0
    T = cfg.t_initial

    for it in range(total_iters):
        v = int(rng.integers(0, n))
        # Compute ΔE of flipping vertex v
        if v in S:
            # Remove v: |S| decreases by 1, violations decrease by # in-S neighbors
            delta_size = -1
            delta_viol = -sum(1 for u in adj[v] if u in S)
        else:
            delta_size = 1
            delta_viol = sum(1 for u in adj[v] if u in S)
        dE = -delta_size + cfg.penalty * delta_viol

        if dE <= 0 or rng.random() < math.exp(-dE / max(T, 1e-12)):
            if v in S:
                S.remove(v)
            else:
                S.add(v)
            E += dE
            if E < best_E:
                best_E = E
                best_set = set(S)
        T *= cooling

        # Record one trace sample per sweep
        if (it + 1) % n == 0:
            trace.append(E)

    # Project to a valid IS
    best_clean, _ = greedy_remove_violations(best_set, adj)
    final_E = _energy(best_clean, adj, cfg.penalty)
    return SAResult(
        best_set=tuple(sorted(best_clean)),
        best_size=len(best_clean),
        best_energy=final_E,
        n_iterations=total_iters,
        energy_trace=tuple(trace),
    )
