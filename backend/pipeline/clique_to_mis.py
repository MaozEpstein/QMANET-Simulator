"""
Map the clique-finding problem on G to the Maximum Independent Set (MIS) on
the complement graph Ḡ.

Identity used:  S is a clique in G  iff  S is an independent set in Ḡ.
Therefore:      MaxClique(G) = MIS(Ḡ)   and   |MaxClique(G)| = α(Ḡ).

This is the classical reduction; on Aquila we then encode MIS via the Rydberg
blockade (whitepaper §6).
"""

from __future__ import annotations

from dataclasses import dataclass

import networkx as nx

# Hard cap on exact MIS — NetworkX uses Bron-Kerbosch (O(3^(n/3))) under the hood
# via `max_weight_clique`. Past ~28 vertices we'd block the event loop too long.
EXACT_MIS_MAX_NODES = 28


@dataclass
class Graph:
    """Plain graph carrier (matches what the frontend consumes)."""

    n_nodes: int
    edges: list[tuple[int, int]]
    node_positions: list[dict] | None = None
    """Optional [{id, x, y}, ...] when geometry is meaningful (e.g. MANET)."""


def to_networkx(g: Graph) -> nx.Graph:
    G = nx.Graph()
    G.add_nodes_from(range(g.n_nodes))
    G.add_edges_from(g.edges)
    return G


def from_networkx(G: nx.Graph, positions: list[dict] | None = None) -> Graph:
    return Graph(
        n_nodes=G.number_of_nodes(),
        edges=[(int(u), int(v)) for u, v in G.edges() if u < v],
        node_positions=positions,
    )


def complement(g: Graph) -> Graph:
    """Return the graph complement Ḡ — same nodes, complementary edge set."""
    G = to_networkx(g)
    Gbar = nx.complement(G)
    return from_networkx(Gbar, positions=g.node_positions)


def max_independent_set(g: Graph) -> list[int]:
    """
    Return one maximum independent set of G as a sorted list of node IDs.

    Uses NetworkX's exact max-weight-clique on the complement (MIS = clique in
    complement). Raises ValueError above EXACT_MIS_MAX_NODES — for larger
    instances, use the adiabatic quantum approach instead.
    """
    if g.n_nodes > EXACT_MIS_MAX_NODES:
        raise ValueError(
            f"Exact MIS supported only up to {EXACT_MIS_MAX_NODES} nodes "
            f"(got {g.n_nodes}). Use the quantum pipeline for larger instances."
        )
    G = to_networkx(g)
    Gbar = nx.complement(G)
    clique, _weight = nx.max_weight_clique(Gbar, weight=None)
    return sorted(int(v) for v in clique)


def compute_target_mis_size(g: Graph) -> int | None:
    """
    Return |MIS(G)| exactly when feasible, else None.

    Wraps :func:`max_independent_set` and *suppresses* the ValueError raised
    above ``EXACT_MIS_MAX_NODES`` — callers (post-process, SA) use the result
    to compute Ebadi's approximation ratio R, and a missing value should leave
    R undefined rather than crash the response.
    """
    if g.n_nodes > EXACT_MIS_MAX_NODES:
        return None
    if g.n_nodes == 0:
        return 0
    return len(max_independent_set(g))


def max_clique(g: Graph) -> list[int]:
    """Return one maximum clique of G — symmetric helper to max_independent_set."""
    if g.n_nodes > EXACT_MIS_MAX_NODES:
        raise ValueError(
            f"Exact MaxClique supported only up to {EXACT_MIS_MAX_NODES} nodes "
            f"(got {g.n_nodes})."
        )
    G = to_networkx(g)
    clique, _weight = nx.max_weight_clique(G, weight=None)
    return sorted(int(v) for v in clique)


# Cap on how many max cliques we enumerate even when the graph is small enough
# to enumerate them all in principle. Highly symmetric graphs (Turán T(9,3),
# Petersen, K_{n,n}) have many cliques of the same maximum size; returning all
# of them would balloon the JSON response and the UI cycle button without
# adding insight past the first ~10. The user can still see the count from
# `n_max_cliques`.
MAX_CLIQUE_ENUM_LIMIT: int = 12


def chromatic_bounds(g: Graph) -> tuple[int, int]:
    """
    Return ``(lower, upper)`` bounds on the chromatic number χ(G).

    χ(G) is NP-hard to compute exactly, so we report a pair:
      - lower bound: ω(G), the clique number. Each clique needs |C| distinct
        colors, so χ(G) ≥ ω(G).
      - upper bound: the size of a greedy coloring under the saturation-largest-
        first heuristic (DSATUR). DSATUR is optimal on bipartite, cycles and
        most "easy" graphs, and within a small factor of optimal otherwise.

    For perfect graphs (interval, comparability, chordal, …) the bounds coincide
    and report χ exactly. For random graphs they are usually within 1–2 of each
    other in this size range.
    """
    if g.n_nodes == 0:
        return 0, 0
    if g.n_nodes > EXACT_MIS_MAX_NODES:
        return 0, g.n_nodes
    G = to_networkx(g)
    if G.number_of_edges() == 0:
        # All-isolated → one color suffices, ω = 1 (any singleton).
        return 1, 1
    lower = len(max_clique(g))
    coloring = nx.coloring.greedy_color(G, strategy="saturation_largest_first")
    upper = (max(coloring.values()) + 1) if coloring else 1
    # Keep bounds consistent in the unusual case where the greedy beats ω
    # (cannot happen mathematically, but rounding guards against weird inputs).
    if upper < lower:
        upper = lower
    return int(lower), int(upper)


def alpha(g: Graph) -> int:
    """Independence number α(G) = |MIS(G)|.

    Note this is the MIS of G *itself* — different from the existing pipeline,
    which solves MIS on Ḡ (the complement) because that is the clique problem
    on G. Stage 2 reports both side by side so the reader sees the full graph
    profile, not just the dual quantity."""
    if g.n_nodes == 0:
        return 0
    if g.n_nodes > EXACT_MIS_MAX_NODES:
        return -1  # sentinel: "too large to compute"
    return len(max_independent_set(g))


def all_max_cliques(g: Graph) -> tuple[list[list[int]], int]:
    """
    Enumerate maximum-size cliques of G.

    Returns ``(cliques, total_count)`` where ``cliques`` is at most
    ``MAX_CLIQUE_ENUM_LIMIT`` distinct maximum cliques (sorted, deduplicated)
    and ``total_count`` is the true number found — so the UI can show
    "showing 12 of 47 max cliques" when there are more than the cap.

    Used by Stage 2 to cycle through alternative optima so the user can see
    the solution degeneracy: a quantum sampler returns a superposition over
    *all* of these, which directly explains the bitstring histogram in Stage 6.
    """
    if g.n_nodes == 0:
        return [], 0
    if g.n_nodes > EXACT_MIS_MAX_NODES:
        raise ValueError(
            f"Exact MaxClique enumeration supported only up to "
            f"{EXACT_MIS_MAX_NODES} nodes (got {g.n_nodes})."
        )
    G = to_networkx(g)
    # find_cliques yields every *maximal* clique (Bron-Kerbosch). Filter to
    # the largest size — those are the *maximum* cliques.
    all_maximal = list(nx.find_cliques(G))
    if not all_maximal:
        return [], 0
    omega = max(len(c) for c in all_maximal)
    max_size_cliques = [
        sorted(int(v) for v in c) for c in all_maximal if len(c) == omega
    ]
    # Deduplicate (find_cliques can list the same set in different orders).
    seen: set[tuple[int, ...]] = set()
    unique: list[list[int]] = []
    for c in max_size_cliques:
        key = tuple(c)
        if key in seen:
            continue
        seen.add(key)
        unique.append(c)
    total = len(unique)
    return unique[:MAX_CLIQUE_ENUM_LIMIT], total


def is_independent_set(g: Graph, subset: list[int]) -> bool:
    edge_set = {tuple(sorted(e)) for e in g.edges}
    s = set(subset)
    for u in s:
        for v in s:
            if u < v and (u, v) in edge_set:
                return False
    return True


def is_clique(g: Graph, subset: list[int]) -> bool:
    edge_set = {tuple(sorted(e)) for e in g.edges}
    nodes = sorted(set(subset))
    for i, u in enumerate(nodes):
        for v in nodes[i + 1 :]:
            if (u, v) not in edge_set:
                return False
    return True
