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

from .clique_to_mis import Graph, compute_target_mis_size


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


def summarize_postprocess(
    results: list[PostProcessResult],
    graph: Graph | None = None,
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
    return {
        "n_shots": len(results),
        "mean_raw_size": float(raw_sizes.mean()),
        "mean_fixed_size": float(fixed_sizes.mean()),
        "mean_final_size": float(final_sizes.mean()),
        "best_final_size": int(final_sizes.max()),
        "target_mis_size": target_size,
        "mean_r_ratio": mean_r,
        "best_r_ratio": best_r,
    }
