"""
Post-processing of a noisy adiabatic measurement.

A "shot" is a bitstring read from Aquila where bit i = 1 means atom i was in
the Rydberg state. The set S = {i : b_i = 1} is what the adiabatic algorithm
proposes as the maximum independent set. Noise + diabatic error mean S may:

  (1) contain an edge of the target graph G (violates the IS constraint), OR
  (2) be a valid IS but not maximal (could be extended without violation).

The whitepaper §6 prescribes a two-step minimal-classical-post-processing:

  Step A — greedy violation removal:
      While S has any conflict edge in G, remove the vertex with the highest
      number of in-S neighbors. Ties broken by lower id.

  Step B — greedy extension:
      Iterate vertices not in S in random order; add any vertex whose
      neighborhood is disjoint from current S.

After these two steps S is guaranteed to be a *maximal independent set*
(possibly not maximum). We expose both intermediate states so the UI can
animate the cleanup.
"""

from __future__ import annotations

from dataclasses import dataclass

import numpy as np

from .clique_to_mis import (
    EXACT_MIS_MAX_NODES,
    Graph,
    all_independent_sets_of_size,
    all_max_cliques,
    complement,
    compute_target_mis_size,
)
from .schedule import profile_value


def _adjacency_sets(graph: Graph) -> list[set[int]]:
    adj: list[set[int]] = [set() for _ in range(graph.n_nodes)]
    for u, v in graph.edges:
        adj[u].add(v)
        adj[v].add(u)
    return adj


def bitstring_to_set(bits: str) -> set[int]:
    return {i for i, ch in enumerate(bits) if ch == "1"}


def set_to_bitstring(S: set[int], n: int) -> str:
    return "".join("1" if i in S else "0" for i in range(n))


def count_violations(S: set[int], adj: list[set[int]]) -> int:
    """Number of edges with both endpoints in S."""
    seen = 0
    nodes = sorted(S)
    in_s = set(S)
    for u in nodes:
        for v in adj[u]:
            if v in in_s and v > u:
                seen += 1
    return seen


@dataclass(frozen=True)
class PostProcessResult:
    raw_bitstring: str
    raw_size: int
    raw_violations: int

    after_fix_bitstring: str
    after_fix_size: int
    removed: tuple[int, ...]
    """Vertex ids removed in step A, in removal order."""

    final_bitstring: str
    final_size: int
    added: tuple[int, ...]
    """Vertex ids added in step B, in addition order."""

    is_valid: bool

    def to_dict(self) -> dict:
        return {
            "raw_bitstring": self.raw_bitstring,
            "raw_size": self.raw_size,
            "raw_violations": self.raw_violations,
            "after_fix_bitstring": self.after_fix_bitstring,
            "after_fix_size": self.after_fix_size,
            "removed": list(self.removed),
            "final_bitstring": self.final_bitstring,
            "final_size": self.final_size,
            "added": list(self.added),
            "is_valid": self.is_valid,
        }


def greedy_remove_violations(
    S: set[int],
    adj: list[set[int]],
) -> tuple[set[int], list[int]]:
    """Step A — peel vertices with the most in-S neighbors until S is an IS."""
    removed: list[int] = []
    S = set(S)
    while True:
        # For each vertex in S, count how many of its neighbors are also in S.
        worst_v = -1
        worst_cnt = 0
        for v in sorted(S):  # deterministic tie-break by id
            cnt = sum(1 for u in adj[v] if u in S)
            if cnt > worst_cnt:
                worst_cnt = cnt
                worst_v = v
        if worst_cnt == 0:
            break  # no violations
        S.discard(worst_v)
        removed.append(worst_v)
    return S, removed


def greedy_extend_to_mis(
    S: set[int],
    adj: list[set[int]],
    n: int,
    *,
    seed: int | None = 0,
) -> tuple[set[int], list[int]]:
    """Step B — add any independent vertex; randomized order for unbiased extension."""
    rng = np.random.default_rng(seed)
    outside = [v for v in range(n) if v not in S]
    rng.shuffle(outside)
    added: list[int] = []
    S = set(S)
    for v in outside:
        if not (adj[v] & S):
            S.add(v)
            added.append(v)
    return S, added


def postprocess(
    bitstring: str,
    graph: Graph,
    *,
    seed: int | None = 0,
) -> PostProcessResult:
    """Run both greedy steps and return all intermediate states."""
    if len(bitstring) != graph.n_nodes:
        raise ValueError(
            f"bitstring length {len(bitstring)} != n_nodes {graph.n_nodes}"
        )
    adj = _adjacency_sets(graph)
    raw_set = bitstring_to_set(bitstring)
    raw_viol = count_violations(raw_set, adj)

    fixed_set, removed = greedy_remove_violations(raw_set, adj)
    extended_set, added = greedy_extend_to_mis(fixed_set, adj, graph.n_nodes, seed=seed)
    final_viol = count_violations(extended_set, adj)

    return PostProcessResult(
        raw_bitstring=bitstring,
        raw_size=len(raw_set),
        raw_violations=raw_viol,
        after_fix_bitstring=set_to_bitstring(fixed_set, graph.n_nodes),
        after_fix_size=len(fixed_set),
        removed=tuple(removed),
        final_bitstring=set_to_bitstring(extended_set, graph.n_nodes),
        final_size=len(extended_set),
        added=tuple(added),
        is_valid=final_viol == 0,
    )


def postprocess_many(
    bitstrings: list[str],
    graph: Graph,
    *,
    seed: int | None = 0,
) -> list[PostProcessResult]:
    """Apply postprocess() to every shot. Each shot uses a derived seed for
    independent randomization in the extension step."""
    return [
        postprocess(b, graph, seed=None if seed is None else seed + i)
        for i, b in enumerate(bitstrings)
    ]


def compute_hp_ld(
    graph: Graph,
    *,
    mode: str = "global",
    profile: str = "power",
    a: float = 0.4,
    atom_degrees: list[int] | None = None,
) -> dict | None:
    """Generalised Hardness Parameter from Karni 2026, eq. 8.

    HP_LD = Σ_j w_j / Σ_j w_j · c_j

    where the sum runs over independent sets of size |MIS|-1, c_j counts the
    distinct extensions to a MIS by adding one vertex, and the weights w_j =
    1/|E_j - E_MIS| measure how close each (|MIS|-1)-IS sits to the MIS
    manifold in energy. Under the LD-AQC schedule the per-IS energy uses the
    profile-weighted detuning E_j = -Σ_{i ∈ IS_j} f_i(d_i, a); for global
    mode every f_i = 1 and HP_LD collapses to the traditional Karni HP
    (eq. 7) — equality is proven in Karni SM A.iii.

    Returns ``None`` when the graph is too big to enumerate exactly (the
    same EXACT_MIS_MAX_NODES cap that applies to MIS), or when |MIS| ≤ 1
    (no non-trivial (|MIS|-1) manifold to weight).

    The return dict carries 4 fields:
      hp_trad — degeneracy-based hardness (Karni eq. 7)
      hp_ld   — generalised, energy-weighted (Karni eq. 8)
      n_connected_is — # ISs of size |MIS|-1 contained in some MIS
      n_disconnected_is — # ISs not contained in any MIS (trap states)
    """
    if graph.n_nodes == 0 or graph.n_nodes > EXACT_MIS_MAX_NODES:
        return None
    # MIS group: maximum cliques in complement = MIS of G.
    cbar = complement(graph)
    miss, _ = all_max_cliques(cbar)
    if not miss:
        return None
    mis_size = len(miss[0])
    if mis_size <= 1:
        return None
    km1 = mis_size - 1
    is_km1 = all_independent_sets_of_size(graph, km1)
    if not is_km1:
        return None

    mis_sets = [frozenset(m) for m in miss]
    # c_j: number of MISs that contain IS_j as a subset.
    cjs = [sum(1 for m in mis_sets if is_j <= m) for is_j in is_km1]

    # Energies for the LD-AQC weighting. We work in units where δ_0 = 1
    # because the weights w_j ∝ 1/|E_j − E_MIS| are scale-invariant in δ_0.
    if mode == "ld_aqc" and atom_degrees is not None and len(atom_degrees) == graph.n_nodes:
        f_per_atom = [profile_value(profile, d, a) for d in atom_degrees]
    else:
        f_per_atom = [1.0] * graph.n_nodes

    def is_energy(s: set[int] | frozenset[int]) -> float:
        return -float(sum(f_per_atom[i] for i in s))

    e_mis = max(is_energy(m) for m in mis_sets)  # least-negative MIS energy
    energies = [is_energy(s) for s in is_km1]
    # Avoid divide-by-zero on a degenerate manifold (mode=global, f=1):
    # every |E_j − E_MIS| equals |f_added| = 1, so we can short-circuit to
    # the traditional definition rather than divide by epsilon.
    diffs = [abs(e_j - e_mis) for e_j in energies]
    if mode != "ld_aqc" or all(d == 0.0 for d in diffs):
        weights = [1.0] * len(is_km1)
    else:
        weights = [1.0 / d if d > 1e-12 else 0.0 for d in diffs]

    num = sum(weights)
    den = sum(w * c for w, c in zip(weights, cjs))
    hp_ld = (num / den) if den > 0 else float("inf")

    # Traditional HP_trad (Karni eq. 7): |IS_{|MIS|-1}| / (|MIS| · |MIS-group|).
    hp_trad = len(is_km1) / (mis_size * len(mis_sets)) if mis_sets else float("inf")

    n_connected = sum(1 for c in cjs if c > 0)
    n_disconnected = sum(1 for c in cjs if c == 0)

    return {
        "hp_trad": hp_trad,
        "hp_ld": hp_ld,
        "n_connected_is": n_connected,
        "n_disconnected_is": n_disconnected,
        "n_mis": len(mis_sets),
        "mis_size": mis_size,
    }


def summarize_postprocess(
    results: list[PostProcessResult],
    graph: Graph | None = None,
    *,
    schedule_mode: str = "global",
    profile: str = "power",
    ld_aqc_strength_a: float = 0.4,
    atom_degrees: list[int] | None = None,
) -> dict:
    """Aggregate stats across many shots.

    When ``graph`` is provided and small enough (≤ EXACT_MIS_MAX_NODES), the
    summary also includes ``target_mis_size`` and ``mean_r_ratio`` /
    ``best_r_ratio`` — Ebadi 2022's approximation ratio metric — so the UI
    can compare the quantum result head-to-head with the classical SA and
    with the true optimum.
    """
    if not results:
        return {
            "n_shots": 0,
            "mean_raw_size": 0.0,
            "mean_fixed_size": 0.0,
            "mean_final_size": 0.0,
            "best_final_size": 0,
            "target_mis_size": None,
            "mean_r_ratio": None,
            "best_r_ratio": None,
            "hp_trad": None,
            "hp_ld": None,
            "hp_n_connected_is": None,
            "hp_n_disconnected_is": None,
        }
    raw_sizes = np.array([r.raw_size for r in results])
    fixed_sizes = np.array([r.after_fix_size for r in results])
    final_sizes = np.array([r.final_size for r in results])
    target_size = compute_target_mis_size(graph) if graph is not None else None
    if target_size is None or target_size == 0:
        mean_r = None
        best_r = None
    else:
        mean_r = float(final_sizes.mean()) / target_size
        best_r = float(final_sizes.max()) / target_size
    hp_info = (
        compute_hp_ld(
            graph,
            mode=schedule_mode,
            profile=profile,
            a=ld_aqc_strength_a,
            atom_degrees=atom_degrees,
        )
        if graph is not None
        else None
    )
    return {
        "n_shots": len(results),
        "mean_raw_size": float(raw_sizes.mean()),
        "mean_fixed_size": float(fixed_sizes.mean()),
        "mean_final_size": float(final_sizes.mean()),
        "best_final_size": int(final_sizes.max()),
        "target_mis_size": target_size,
        "mean_r_ratio": mean_r,
        "best_r_ratio": best_r,
        "hp_trad": hp_info["hp_trad"] if hp_info else None,
        "hp_ld": hp_info["hp_ld"] if hp_info else None,
        "hp_n_connected_is": hp_info["n_connected_is"] if hp_info else None,
        "hp_n_disconnected_is": hp_info["n_disconnected_is"] if hp_info else None,
    }
