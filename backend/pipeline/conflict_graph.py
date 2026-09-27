"""
Build the interference conflict graph F from a MANET connectivity graph C.

Jain, Padhye, Padmanabhan & Qiu, "Impact of Interference on Multi-hop
Wireless Network Performance" (MobiCom 2003): vertices of F are *directed*
links of C — every MANET link (i,j) is really a sender/receiver pair, and
``ConflictMode`` controls how many directed vertices each link contributes:

- ``"unidirectional"``: one vertex per MANET link, direction fixed by
  convention (the lower-numbered device is the sender, the higher-numbered
  one the receiver) — every link is stored undirected in this app, so this
  is an assigned convention, not stored data.
- ``"bidirectional"`` (default): **two** vertices per MANET link — one for
  each direction. This is the model that actually needs both directions
  scheduled independently (e.g. a reply on the same physical link is a
  separate schedulable unit).

Two directed vertices (sender_a, receiver_a) and (sender_b, receiver_b)
conflict — an edge in F — iff they share an endpoint (a device can't be
sender or receiver of two active links at once — this alone means the two
directions of the *same* physical link always conflict with each other in
bidirectional mode, which is physically correct: half-duplex, same two
radios), or one's sender is within the interference radius R' of the
other's receiver: ``dist(sender_a, receiver_b) <= R'`` or
``dist(sender_b, receiver_a) <= R'``.

MIS(F) is then the maximum set of directed links schedulable simultaneously
without interference (Theorem 2 of the paper: a usage vector is schedulable
iff it lies in F's independent-set polytope) — one time slot of a full
multi-commodity routing schedule, not the routing solution itself.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Literal

import numpy as np

import networkx as nx

from .clique_to_mis import Graph, to_networkx
from .clique_to_mis import complement as graph_complement

ConflictMode = Literal["bidirectional", "unidirectional"]

# The exact branch-and-bound MIS solver is worst-case exponential. Measured
# empirically on random graphs (5 seeds each, densest case): ~80ms at 80
# nodes, ~5s worst case at 120, tens of seconds to a few minutes by 150 —
# smooth exponential growth, not a hard wall. SWEEP_MAX_LINKS gates the
# *actual F vertex count* (see graph_conflict_sweep in server.py — that's
# n_links for unidirectional, 2*n_links for bidirectional), not the raw
# MANET link count. Deliberately higher than the app-wide
# EXACT_MIS_MAX_NODES cap (28) — the sweep re-solves MIS once per
# breakpoint, so it needs its own, separately-tuned limit — but the real
# backstop against a pathological instance is SWEEP_POINT_TIMEOUT_S below,
# not this cap alone.
SWEEP_MAX_LINKS = 120

# Per-point wall-clock budget for the sweep endpoint. If solving MIS at one
# breakpoint exceeds this, the sweep stops there and returns whatever points
# it already has, flagged as timed out, rather than hanging the request (and
# the user's browser tab) indefinitely.
SWEEP_POINT_TIMEOUT_S = 20.0


def solve_sweep_point(
    connectivity: Graph,
    interference_radius: float,
    mode: ConflictMode = "bidirectional",
) -> int:
    """|MIS(F)| at one R' value. Module-level (not a closure) so it can be
    submitted to a ProcessPoolExecutor, which pickles the callable — see
    SWEEP_POINT_TIMEOUT_S's doc comment for why the caller runs this out of
    process with a timeout instead of calling it directly.

    Calls networkx directly rather than clique_to_mis.max_clique, which
    enforces the app-wide EXACT_MIS_MAX_NODES=28 cap — the sweep allows up
    to SWEEP_MAX_LINKS F vertices under its own, separately justified cap
    plus the timeout above.
    """
    result = build_conflict_graph(connectivity, interference_radius, mode)
    G = to_networkx(result.conflict_graph_complement)
    clique, _weight = nx.max_weight_clique(G, weight=None)
    return len(clique)


@dataclass
class ConflictGraphResult:
    conflict_graph: Graph
    """F — one vertex per *directed* link (see ConflictMode: one or two
    vertices per MANET link, depending on mode). Node positions are the
    midpoint of the underlying MANET link's two endpoints — both directions
    of the same link share that midpoint."""

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
    """link_endpoints[k] = (sender, receiver) — F's vertex k's direction.
    Order matters here (it *is* the direction), unlike a plain undirected
    edge list. Length equals conflict_graph.n_nodes: n_links for
    unidirectional, 2*n_links for bidirectional."""


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


def _directed_vertices(connectivity: Graph, mode: ConflictMode) -> list[tuple[int, int]]:
    """F's vertex list as (sender, receiver) pairs — one per MANET link for
    "unidirectional" (direction fixed: lower device id sends), two per
    MANET link for "bidirectional" (both directions, one vertex each)."""
    links = list(connectivity.edges)
    if mode == "unidirectional":
        return [(min(i, j), max(i, j)) for i, j in links]
    vertices: list[tuple[int, int]] = []
    for i, j in links:
        vertices.append((i, j))
        vertices.append((j, i))
    return vertices


def _shares_endpoint(sender_a: int, receiver_a: int, sender_b: int, receiver_b: int) -> bool:
    return bool({sender_a, receiver_a} & {sender_b, receiver_b})


def _directed_min_distance(
    pos: dict[int, tuple[float, float]],
    sender_a: int,
    receiver_a: int,
    sender_b: int,
    receiver_b: int,
) -> float:
    """The relevant distance for the conflict check: does either link's
    sender reach the other's receiver? (Not sender-sender or
    receiver-receiver — those aren't meaningful once vertices are directed;
    two vertices that need that check are simply both generated, in
    bidirectional mode, as their own vertex pairs.)"""
    return min(
        _dist(pos, sender_a, receiver_b),
        _dist(pos, sender_b, receiver_a),
    )


def compute_interference_breakpoints(
    connectivity: Graph, mode: ConflictMode = "bidirectional"
) -> list[float]:
    """Every distinct R' at which an edge of F turns on, as R' increases
    from 0 — the exact x-coordinates where |MIS(F)| can change as a step
    function of R' (see the module docstring's conflict rule).

    Vertex pairs sharing an endpoint always conflict regardless of R' (see
    the module docstring) and so never contribute a breakpoint. Every other
    pair's breakpoint is `_directed_min_distance` — identical to the `<=`
    check in build_conflict_graph, just solved for the threshold instead of
    applied against a fixed R'.
    """
    pos = _endpoint_positions(connectivity)
    vertices = _directed_vertices(connectivity, mode)
    m = len(vertices)

    breakpoints: set[float] = set()
    for k in range(m):
        sa, ra = vertices[k]
        for l in range(k + 1, m):
            sb, rb = vertices[l]
            if _shares_endpoint(sa, ra, sb, rb):
                continue
            breakpoints.add(_directed_min_distance(pos, sa, ra, sb, rb))
    return sorted(breakpoints)


def build_conflict_graph(
    connectivity: Graph,
    interference_radius: float,
    mode: ConflictMode = "bidirectional",
) -> ConflictGraphResult:
    """Construct F from C's edge set + node positions.

    Raises ValueError if C has no node positions (interference is a
    geometric notion — undefined without coordinates).
    """
    pos = _endpoint_positions(connectivity)
    vertices = _directed_vertices(connectivity, mode)
    m = len(vertices)

    conflict_edges: list[tuple[int, int]] = []
    for k in range(m):
        sa, ra = vertices[k]
        for l in range(k + 1, m):
            sb, rb = vertices[l]
            if _shares_endpoint(sa, ra, sb, rb):
                # Shared endpoint — a device can't be sender/receiver of two
                # active links at once, so these always conflict. This is
                # also why the two directions of the *same* MANET link
                # always conflict with each other in bidirectional mode.
                conflict_edges.append((k, l))
                continue
            if _directed_min_distance(pos, sa, ra, sb, rb) <= interference_radius:
                conflict_edges.append((k, l))

    # Position each directed vertex a quarter of the way from the link's
    # midpoint toward its own sender — purely cosmetic (the distance checks
    # above always use the real endpoint positions, never this). Without
    # it, bidirectional's two vertices for the same link (opposite senders)
    # would sit on the exact same point and render as one overlapping dot.
    SENDER_BIAS = 0.25
    midpoints = []
    for k, (s, r) in enumerate(vertices):
        mx = (pos[s][0] + pos[r][0]) / 2.0
        my = (pos[s][1] + pos[r][1]) / 2.0
        midpoints.append(
            {
                "id": k,
                "x": mx + SENDER_BIAS * (pos[s][0] - mx),
                "y": my + SENDER_BIAS * (pos[s][1] - my),
            }
        )

    f = Graph(n_nodes=m, edges=conflict_edges, node_positions=midpoints)
    return ConflictGraphResult(
        conflict_graph=f,
        conflict_graph_complement=graph_complement(f),
        link_endpoints=vertices,
    )
