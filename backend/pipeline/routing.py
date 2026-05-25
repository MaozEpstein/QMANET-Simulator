"""
MANET routing via the maximum-clique backbone, with a BFS fallback for pairs
the backbone alone cannot serve.

Three classes of route are emitted (field `via` on Route):

  - ``direct``    : src and dst share an edge (1 hop). The backbone is irrelevant.
  - ``backbone``  : the shortest path passes through at least one backbone node.
                    These are the routes the quantum algorithm pays off on —
                    short and stable through the clique core.
  - ``fallback``  : the shortest path exists but uses *no* backbone intermediate.
                    These are pairs the backbone failed to serve; we still
                    deliver because a real MANET protocol would.

This split lets us *quantify* how much the backbone contributes:

  - n_via_backbone / total          → fraction of routes the backbone served
  - mean_hops_fallback / mean_hops_backbone
                                   → how many more hops a backbone-less network
                                     would have taken for the same network

A pair is unreachable only if the underlying graph is disconnected between
src and dst — i.e. when no protocol could deliver the packet.
"""

from __future__ import annotations

from collections import deque
from dataclasses import dataclass
from typing import Literal

from .clique_to_mis import Graph, is_clique


Via = Literal["direct", "backbone", "fallback"]


@dataclass(frozen=True)
class Route:
    src: int
    dst: int
    path: tuple[int, ...]
    """Ordered list of nodes; empty if no route exists."""

    hops: int
    via: Via
    """How the path was found:
      - "direct"   : single edge, backbone irrelevant
      - "backbone" : at least one intermediate node is in the backbone
      - "fallback" : intermediate nodes are all outside the backbone
    """

    @property
    def is_reachable(self) -> bool:
        return self.hops > 0 or self.src == self.dst

    def to_dict(self) -> dict:
        return {
            "src": self.src,
            "dst": self.dst,
            "path": list(self.path),
            "hops": self.hops,
            "via": self.via,
        }


@dataclass(frozen=True)
class RoutingResult:
    backbone: tuple[int, ...]
    is_clique: bool
    covered_nodes: tuple[int, ...]
    """Nodes that can be reached via the backbone in ≤1 hop (backbone ∪ N(backbone))."""

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

    # Per-via breakdown — quantifies what the backbone contributed.

    @property
    def n_via_direct(self) -> int:
        return sum(1 for r in self.routes if r.is_reachable and r.via == "direct")

    @property
    def n_via_backbone(self) -> int:
        return sum(1 for r in self.routes if r.is_reachable and r.via == "backbone")

    @property
    def n_via_fallback(self) -> int:
        return sum(1 for r in self.routes if r.is_reachable and r.via == "fallback")

    def _mean_hops_for(self, via: Via) -> float:
        good = [r.hops for r in self.routes if r.is_reachable and r.via == via and r.hops > 0]
        return sum(good) / len(good) if good else 0.0

    @property
    def mean_hops_direct(self) -> float:
        return self._mean_hops_for("direct")

    @property
    def mean_hops_backbone(self) -> float:
        return self._mean_hops_for("backbone")

    @property
    def mean_hops_fallback(self) -> float:
        return self._mean_hops_for("fallback")

    def to_dict(self) -> dict:
        return {
            "backbone": list(self.backbone),
            "is_clique": self.is_clique,
            "covered_nodes": list(self.covered_nodes),
            "coverage_fraction": self.coverage_fraction,
            "n_reachable_pairs": self.n_reachable_pairs,
            "mean_hops": self.mean_hops,
            "max_hops": self.max_hops,
            "n_via_direct": self.n_via_direct,
            "n_via_backbone": self.n_via_backbone,
            "n_via_fallback": self.n_via_fallback,
            "mean_hops_direct": self.mean_hops_direct,
            "mean_hops_backbone": self.mean_hops_backbone,
            "mean_hops_fallback": self.mean_hops_fallback,
            "routes": [r.to_dict() for r in self.routes],
        }


def _adjacency_sets(graph: Graph) -> list[set[int]]:
    adj: list[set[int]] = [set() for _ in range(graph.n_nodes)]
    for u, v in graph.edges:
        adj[u].add(v)
        adj[v].add(u)
    return adj


def _bfs_shortest_path(
    src: int, dst: int, adj: list[set[int]]
) -> tuple[int, ...]:
    """Return the shortest path from src to dst as a tuple of nodes, or
    () if no path exists. Assumes 0 ≤ src,dst < len(adj)."""
    if src == dst:
        return (src,)
    parent: dict[int, int] = {src: src}
    queue: deque[int] = deque([src])
    while queue:
        u = queue.popleft()
        if u == dst:
            break
        for v in adj[u]:
            if v not in parent:
                parent[v] = u
                queue.append(v)
    if dst not in parent:
        return ()
    # Reconstruct path src → … → dst.
    rev = [dst]
    while rev[-1] != src:
        rev.append(parent[rev[-1]])
    rev.reverse()
    return tuple(rev)


def _classify(path: tuple[int, ...], backbone_set: set[int]) -> Via:
    """Decide how a BFS-shortest path used (or didn't use) the backbone."""
    if len(path) <= 2:
        # 0 hops (src==dst) or 1 hop (direct edge) — backbone irrelevant.
        return "direct"
    intermediates = path[1:-1]
    if any(node in backbone_set for node in intermediates):
        return "backbone"
    return "fallback"


def compute_route(
    src: int,
    dst: int,
    adj: list[set[int]],
    backbone_set: set[int],
) -> Route:
    """Return the shortest src→dst route (BFS), classified by how the
    backbone was (or wasn't) used. Returns hops=0 and via="direct" only
    when src==dst or no path exists in G."""
    if src == dst:
        return Route(src=src, dst=dst, path=(src,), hops=0, via="direct")

    path = _bfs_shortest_path(src, dst, adj)
    if not path:
        return Route(src=src, dst=dst, path=(), hops=0, via="direct")

    return Route(
        src=src,
        dst=dst,
        path=path,
        hops=len(path) - 1,
        via=_classify(path, backbone_set),
    )


def build_routing_table(graph: Graph, backbone: list[int]) -> RoutingResult:
    """Compute every ordered route and aggregate coverage + via stats."""
    n = graph.n_nodes
    backbone_sorted = tuple(sorted(set(backbone)))
    backbone_set = set(backbone_sorted)

    for b in backbone_set:
        if not (0 <= b < n):
            raise ValueError(f"backbone vertex {b} out of range [0, {n})")

    adj = _adjacency_sets(graph)
    is_back_clique = is_clique(graph, list(backbone_sorted)) if len(backbone_set) > 1 else True

    # Coverage stays "served by backbone in ≤1 hop" — the unchanged metric of
    # what the clique alone reaches. Fallback routes don't expand coverage;
    # they just demonstrate the network is otherwise functional.
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
