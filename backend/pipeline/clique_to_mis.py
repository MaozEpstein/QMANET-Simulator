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
