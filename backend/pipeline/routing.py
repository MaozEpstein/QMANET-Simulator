"""
MANET routing via the maximum-clique backbone.

The nodes selected by the adiabatic algorithm form a clique in G (the
communication graph), which means every pair in the backbone is in direct
range. Routing therefore reduces to:

  - If both endpoints are in the backbone:        direct 1-hop edge
  - If one endpoint is in the backbone:           1 edge from non-backbone
                                                  to its nearest backbone
                                                  neighbor, then 1 backbone hop
  - If both endpoints are outside the backbone:   2 boundary edges plus 1
                                                  backbone hop between them

A node is *covered* iff it is either in the backbone or has at least one
backbone node as neighbor. Uncovered nodes cannot be routed through the
backbone and need a fallback (multi-hop) protocol.

This module computes the routing table for all (src, dst) pairs and reports
coverage statistics.
"""

from __future__ import annotations

from dataclasses import dataclass

from .clique_to_mis import Graph, is_clique


@dataclass(frozen=True)
class Route:
    src: int
    dst: int
    path: tuple[int, ...]
    """Ordered list of nodes; empty if no route exists."""

    hops: int

    @property
    def is_reachable(self) -> bool:
        return self.hops > 0 or self.src == self.dst

    def to_dict(self) -> dict:
        return {
            "src": self.src,
            "dst": self.dst,
            "path": list(self.path),
            "hops": self.hops,
        }


@dataclass(frozen=True)
class RoutingResult:
    backbone: tuple[int, ...]
    is_clique: bool
    covered_nodes: tuple[int, ...]
    """Nodes that can be reached via the backbone (including backbone itself)."""

    coverage_fraction: float
    routes: tuple[Route, ...]
    """All n*(n-1) ordered (src, dst) routes."""

    @property
    def n_reachable_pairs(self) -> int:
        return sum(1 for r in self.routes if r.is_reachable)

    @property
    def mean_hops(self) -> float:
        good = [r.hops for r in self.routes if r.is_reachable and r.hops > 0]
        return sum(good) / len(good) if good else 0.0

    @property
    def max_hops(self) -> int:
        good = [r.hops for r in self.routes if r.is_reachable]
        return max(good) if good else 0

    def to_dict(self) -> dict:
        return {
            "backbone": list(self.backbone),
            "is_clique": self.is_clique,
            "covered_nodes": list(self.covered_nodes),
            "coverage_fraction": self.coverage_fraction,
            "n_reachable_pairs": self.n_reachable_pairs,
            "mean_hops": self.mean_hops,
            "max_hops": self.max_hops,
            "routes": [r.to_dict() for r in self.routes],
        }


def _adjacency_sets(graph: Graph) -> list[set[int]]:
    adj: list[set[int]] = [set() for _ in range(graph.n_nodes)]
    for u, v in graph.edges:
        adj[u].add(v)
        adj[v].add(u)
    return adj


def _nearest_backbone_neighbor(
    node: int, adj: list[set[int]], backbone_set: set[int]
) -> int | None:
    """Return any backbone node directly adjacent to `node`, or None."""
    common = adj[node] & backbone_set
    if not common:
        return None
    return min(common)  # deterministic tie-break by id


def compute_route(
    src: int,
    dst: int,
    adj: list[set[int]],
    backbone_set: set[int],
) -> Route:
    """Return the (src, dst) route through the backbone, or empty if unreachable."""
    if src == dst:
        return Route(src=src, dst=dst, path=(src,), hops=0)

    # Direct edge (no backbone needed)
    if dst in adj[src]:
        return Route(src=src, dst=dst, path=(src, dst), hops=1)

    src_entry: int | None
    dst_exit: int | None

    if src in backbone_set:
        src_entry = src
    else:
        src_entry = _nearest_backbone_neighbor(src, adj, backbone_set)

    if dst in backbone_set:
        dst_exit = dst
    else:
        dst_exit = _nearest_backbone_neighbor(dst, adj, backbone_set)

    if src_entry is None or dst_exit is None:
        # Either endpoint not covered → cannot route via this backbone
        return Route(src=src, dst=dst, path=(), hops=0)

    # Build the path: [src?] -> src_entry -> [backbone hop -> dst_exit?] -> [dst?]
    path: list[int] = []
    if src != src_entry:
        path.append(src)
    path.append(src_entry)
    if dst_exit != src_entry:
        path.append(dst_exit)
    if dst not in (src_entry, dst_exit):
        path.append(dst)

    return Route(src=src, dst=dst, path=tuple(path), hops=len(path) - 1)


def build_routing_table(graph: Graph, backbone: list[int]) -> RoutingResult:
    """Compute every ordered route and aggregate coverage stats."""
    n = graph.n_nodes
    backbone_sorted = tuple(sorted(set(backbone)))
    backbone_set = set(backbone_sorted)

    # Reject anything out of range
    for b in backbone_set:
        if not (0 <= b < n):
            raise ValueError(f"backbone vertex {b} out of range [0, {n})")

    adj = _adjacency_sets(graph)
    is_back_clique = is_clique(graph, list(backbone_sorted)) if len(backbone_set) > 1 else True

    covered: set[int] = set(backbone_set)
    for v in range(n):
        if v in covered:
            continue
        if adj[v] & backbone_set:
            covered.add(v)

    coverage = len(covered) / n if n > 0 else 0.0

    routes: list[Route] = []
    for s in range(n):
        for d in range(n):
            if s == d:
                continue
            routes.append(compute_route(s, d, adj, backbone_set))

    return RoutingResult(
        backbone=backbone_sorted,
        is_clique=is_back_clique,
        covered_nodes=tuple(sorted(covered)),
        coverage_fraction=coverage,
        routes=tuple(routes),
    )


def is_path_valid(graph: Graph, path: list[int]) -> bool:
    """Every consecutive pair in `path` must be an edge in `graph`."""
    if len(path) <= 1:
        return True
    edge_set = {tuple(sorted(e)) for e in graph.edges}
    for i in range(len(path) - 1):
        u, v = path[i], path[i + 1]
        if (min(u, v), max(u, v)) not in edge_set:
            return False
    return True
