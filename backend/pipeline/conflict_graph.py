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

from .clique_to_mis import Graph
from .clique_to_mis import complement as graph_complement


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


def build_conflict_graph(connectivity: Graph, interference_radius: float) -> ConflictGraphResult:
    """Construct F from C's edge set + node positions.

    Raises ValueError if C has no node positions (interference is a
    geometric notion — undefined without coordinates).
    """
    if connectivity.node_positions is None:
        raise ValueError(
            "conflict graph construction requires node_positions on the "
            "connectivity graph (interference is geometric)"
        )
    pos = {int(p["id"]): (float(p["x"]), float(p["y"])) for p in connectivity.node_positions}
    links = list(connectivity.edges)
    m = len(links)

    def dist(a: int, b: int) -> float:
        (x1, y1), (x2, y2) = pos[a], pos[b]
        return float(np.hypot(x1 - x2, y1 - y2))

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
