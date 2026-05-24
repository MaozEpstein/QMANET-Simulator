"""
MANET (Mobile Ad-Hoc Network) topology generator.

Models a wireless ad-hoc network as a Random Geometric Graph (RGG): nodes are
placed uniformly in a 2D box, and an edge exists between two nodes iff their
Euclidean distance is at most ``comm_radius``.

This is the standard model for MANETs in the routing-protocols literature
(Penrose, Random Geometric Graphs, 2003).
"""

from __future__ import annotations

from dataclasses import dataclass, field

import numpy as np


@dataclass
class MANETConfig:
    n_nodes: int = 12
    """Number of mobile nodes."""

    box_size: float = 100.0
    """Edge of the square area the nodes live in (arbitrary units, e.g. meters)."""

    comm_radius: float = 35.0
    """Communication radius — two nodes are neighbors iff |x_i - x_j| <= this."""

    seed: int | None = 42
    """RNG seed for reproducibility (None = nondeterministic)."""


@dataclass
class MANETSnapshot:
    """One frame of a MANET — node positions + the induced communication graph."""

    nodes: list[dict] = field(default_factory=list)
    """[{id, x, y}, ...]"""

    edges: list[tuple[int, int]] = field(default_factory=list)
    """(u, v) pairs with u < v."""

    config: MANETConfig = field(default_factory=MANETConfig)

    def adjacency(self) -> np.ndarray:
        """Boolean N×N adjacency matrix (symmetric, zero diagonal)."""
        n = len(self.nodes)
        a = np.zeros((n, n), dtype=bool)
        for u, v in self.edges:
            a[u, v] = a[v, u] = True
        return a


def generate(config: MANETConfig | None = None) -> MANETSnapshot:
    """Generate a single random MANET snapshot per ``config``."""
    cfg = config or MANETConfig()
    rng = np.random.default_rng(cfg.seed)
    pos = rng.uniform(0.0, cfg.box_size, size=(cfg.n_nodes, 2))

    nodes = [
        {"id": i, "x": float(pos[i, 0]), "y": float(pos[i, 1])}
        for i in range(cfg.n_nodes)
    ]

    # Vectorized pairwise distance: faster + cleaner than a Python loop.
    diff = pos[:, None, :] - pos[None, :, :]
    dist = np.linalg.norm(diff, axis=-1)
    np.fill_diagonal(dist, np.inf)
    upper = np.triu(dist <= cfg.comm_radius, k=1)
    edge_indices = np.argwhere(upper)
    edges = [(int(u), int(v)) for u, v in edge_indices]

    return MANETSnapshot(nodes=nodes, edges=edges, config=cfg)
