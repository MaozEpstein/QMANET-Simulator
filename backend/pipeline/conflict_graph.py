"""
Build the interference conflict graph F from a MANET connectivity graph C.

Jain, Padhye, Padmanabhan & Qiu, "Impact of Interference on Multi-hop
Wireless Network Performance" (MobiCom 2003): vertices of F are the *links*
(edges) of C; two links conflict — an edge in F — if they cannot be active
simultaneously. We use the paper's bidirectional-MAC variant (§3.5, the
802.11-style model requiring both sender and receiver free of interference):
links (i,j) and (p,q) conflict iff they share an endpoint, or any pair of
their endpoints lies within the interference radius R'. The bidirectional
form is the right fit here because this app already treats every link as
undirected (there is no sender/receiver distinction elsewhere in the
pipeline).

MIS(F) is then the maximum set of links schedulable simultaneously without
interference (Theorem 2 of the paper: a usage vector is schedulable iff it
lies in F's independent-set polytope) — one time slot of a full multi-commodity
routing schedule, not the routing solution itself.
"""

from __future__ import annotations

from dataclasses import dataclass

import numpy as np

import networkx as nx

from .clique_to_mis import Graph, to_networkx
from .clique_to_mis import complement as graph_complement

# The exact branch-and-bound MIS solver is worst-case exponential. Measured
# empirically on random graphs (5 seeds each, densest case): ~80ms at 80
# nodes, ~5s worst case at 120, tens of seconds to a few minutes by 150 —
# smooth exponential growth, not a hard wall. SWEEP_MAX_LINKS is deliberately
# *higher* than the app-wide EXACT_MIS_MAX_NODES cap (28) — the sweep
# re-solves MIS once per breakpoint, so it needs its own, separately-tuned
# limit — but the real backstop against a pathological instance is
# SWEEP_POINT_TIMEOUT_S below, not this cap alone.
SWEEP_MAX_LINKS = 120

# Per-point wall-clock budget for the sweep endpoint. If solving MIS at one
# breakpoint exceeds this, the sweep stops there and returns whatever points
# it already has, flagged as timed out, rather than hanging the request (and
# the user's browser tab) indefinitely.
SWEEP_POINT_TIMEOUT_S = 20.0


def solve_sweep_point(connectivity: Graph, interference_radius: float) -> int:
    """|MIS(F)| at one R' value. Module-level (not a closure) so it can be
    submitted to a ProcessPoolExecutor, which pickles the callable — see
    SWEEP_POINT_TIMEOUT_S's doc comment for why the caller runs this out of
    process with a timeout instead of calling it directly.

    Calls networkx directly rather than clique_to_mis.max_clique, which
    enforces the app-wide EXACT_MIS_MAX_NODES=28 cap — the sweep allows up
    to SWEEP_MAX_LINKS=40 links (F vertices) under its own, separately
    justified cap plus the timeout above.
    """
    result = build_conflict_graph(connectivity, interference_radius)
    G = to_networkx(result.conflict_graph_complement)
    clique, _weight = nx.max_weight_clique(G, weight=None)
    return len(clique)


@dataclass
class ConflictGraphResult:
    conflict_graph: Graph
    """F — one vertex per link of the connectivity graph C. Node positions are
    the midpoint of each link's two C-endpoints (physically faithful — the
    conflict vertex 'lives' where the link lives)."""

    conflict_graph_complement: Graph
    """F̄ — complement of F. This, not F, is what gets fed into the existing
    complement+MIS pipeline (``/api/graph/complement``): that pipeline always
    reports ``clique(input)`` (which equals MIS(complement(input))), so
    feeding F directly would report ``clique(F)`` — a maximal set of *mutually
    conflicting* links, the opposite of what we want. Feeding F̄ instead makes
    the pipeline report ``clique(F̄) = MIS(F)`` — the maximum set of links
    schedulable simultaneously — while its `.complement` field comes back as
    F itself, which Stage 3 then embeds (so the hardware solves MIS(F))."""

    link_endpoints: list[tuple[int, int]]
    """link_endpoints[k] = (i, j) — the C-edge that F's vertex k represents."""


def _endpoint_positions(connectivity: Graph) -> dict[int, tuple[float, float]]:
    """MANET node id -> (x, y). Raises ValueError if C has no node positions
    (interference is a geometric notion — undefined without coordinates)."""
    if connectivity.node_positions is None:
        raise ValueError(
            "conflict graph construction requires node_positions on the "
            "connectivity graph (interference is geometric)"
        )
    return {int(p["id"]): (float(p["x"]), float(p["y"])) for p in connectivity.node_positions}


def _dist(pos: dict[int, tuple[float, float]], a: int, b: int) -> float:
    (x1, y1), (x2, y2) = pos[a], pos[b]
    return float(np.hypot(x1 - x2, y1 - y2))


def compute_interference_breakpoints(connectivity: Graph) -> list[float]:
    """Every distinct R' at which an edge of F turns on, as R' increases
    from 0 — the exact x-coordinates where |MIS(F)| can change as a step
    function of R' (see the module docstring's conflict rule).

    Links sharing an endpoint always conflict regardless of R' (a node's
    single radio can't serve two links at once) and so never contribute a
    breakpoint. Every other pair's breakpoint is
    min(d(i,p), d(i,q), d(j,p), d(j,q)) — identical to the `<=` check in
    build_conflict_graph, just solved for the threshold instead of applied
    against a fixed R'.
    """
    pos = _endpoint_positions(connectivity)
    links = list(connectivity.edges)
    m = len(links)

    breakpoints: set[float] = set()
    for k in range(m):
        i, j = links[k]
        for l in range(k + 1, m):
            p, q = links[l]
            if {i, j} & {p, q}:
                continue
            breakpoints.add(
                min(_dist(pos, i, p), _dist(pos, i, q), _dist(pos, j, p), _dist(pos, j, q))
            )
    return sorted(breakpoints)


def build_conflict_graph(connectivity: Graph, interference_radius: float) -> ConflictGraphResult:
    """Construct F from C's edge set + node positions.

    Raises ValueError if C has no node positions (interference is a
    geometric notion — undefined without coordinates).
    """
    pos = _endpoint_positions(connectivity)
    links = list(connectivity.edges)
    m = len(links)

    def dist(a: int, b: int) -> float:
        return _dist(pos, a, b)

    conflict_edges: list[tuple[int, int]] = []
    for k in range(m):
        i, j = links[k]
        for l in range(k + 1, m):
            p, q = links[l]
            if {i, j} & {p, q}:
                # Shared endpoint — a node's single radio can't serve two
                # links at once, so these always conflict.
                conflict_edges.append((k, l))
                continue
            if (
                dist(i, p) <= interference_radius
                or dist(i, q) <= interference_radius
                or dist(j, p) <= interference_radius
                or dist(j, q) <= interference_radius
            ):
                conflict_edges.append((k, l))

    midpoints = [
        {"id": k, "x": (pos[i][0] + pos[j][0]) / 2.0, "y": (pos[i][1] + pos[j][1]) / 2.0}
        for k, (i, j) in enumerate(links)
    ]

    f = Graph(n_nodes=m, edges=conflict_edges, node_positions=midpoints)
    return ConflictGraphResult(
        conflict_graph=f,
        conflict_graph_complement=graph_complement(f),
        link_endpoints=links,
    )
