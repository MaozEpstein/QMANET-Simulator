"""
Embedding: project a logical MIS-target graph onto Aquila's atom array.

This is the bridge from abstract graph (Ḡ, computed in Phase 1) to physical
positions in µm that obey Aquila's hardware constraints. The strategy:

  1) If the input graph already carries 2D coordinates (e.g., from MANET),
     start from those.
  2) Otherwise, run a force-directed layout that pulls connected vertices
     close and pushes disconnected vertices apart — exactly the structure the
     Rydberg blockade encodes (|x_i - x_j| ≤ R_b ↔ atoms i,j share an edge).
  3) Scale the layout so the inter-vertex distances bracket the user-chosen
     blockade radius R_b.
  4) Snap to a (lattice_spacing_um × lattice_spacing_um) grid and center inside
     the 75×76 µm user region.
  5) Compute the "blockade graph" induced by these positions and the chosen
     R_b, then compare it to the target graph — embedding_fidelity is the
     Jaccard similarity of the edge sets. 1.0 means a perfect unit-disk
     realization.

The geometry only needs to match locally — Aquila accepts any positions that
satisfy the constraints. Imperfect fidelity is fine; the adiabatic ramp
will still find a good approximate MIS (Ebadi2022).
"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any

import networkx as nx
import numpy as np

from aquila.constants import AQUILA, AquilaSpec, blockade_radius_um
from aquila.validator import Violation, validate_positions

from .clique_to_mis import Graph


@dataclass
class EmbedConfig:
    lattice_spacing_um: float = 6.5
    """Logical lattice step in µm.

    Picked so that the diagonal distance a√2 ≈ 9.19 µm sits *outside* the
    blockade radius R_b ≈ 8.79 µm (at the default Ω=15 rad/µs and the canonical
    C₆ = 5,420,503 rad/µs·µm⁶). With a smaller spacing such as Ebadi's 5 µm,
    diagonal neighbours fall *inside* R_b → spurious blockade edges that the
    UDG encoding cannot honour. Bump the spacing here if you raise Ω."""

    rabi_rad_us: float = 15.0
    """Rabi amplitude used to *compute the blockade radius for embedding*. Whitepaper §6.1 uses 15 rad/µs."""

    detuning_rad_us: float = 0.0
    """Detuning at the moment of comparison (R_b depends on Ω² + Δ²)."""

    layout_seed: int = 0
    """Seed for the force layout (reproducibility)."""

    layout_iterations: int = 200
    """Force-layout iterations."""

    snap_to_grid: bool = True
    """When True, atoms snap to the nearest lattice point."""

    rescale_to_region: bool = True
    """
    When True, the layout is scaled to fill the Aquila user region (75×76µm).
    Set to False if you want the supplied positions used verbatim (still
    subject to snap_to_grid and validation).
    """

    margin_um: float = 2.0
    """Leave this much padding inside the user region."""


@dataclass
class AtomArray:
    positions: list[tuple[float, float]]
    """Final µm coordinates in Aquila frame (x in [0,75], y in [0,76])."""

    target_graph: Graph
    """The MIS-target graph that the embedding tries to realize."""

    blockade_radius_um: float
    """R_b used to compute the induced edges."""

    induced_edges: list[tuple[int, int]]
    """Pairs (i<j) with |x_i - x_j| ≤ R_b given the final positions."""

    embedding_fidelity: float
    """Jaccard similarity between `induced_edges` and `target_graph.edges` (0..1)."""

    missing_edges: list[tuple[int, int]] = field(default_factory=list)
    """Target edges not realized in the geometry (atoms too far apart)."""

    spurious_edges: list[tuple[int, int]] = field(default_factory=list)
    """Geometric edges that aren't in the target graph (atoms accidentally close)."""

    violations: list[Violation] = field(default_factory=list)
    """Aquila constraint violations (empty when ready for hardware)."""

    def is_valid(self) -> bool:
        return len(self.violations) == 0


# --------------------------------------------------------------------------- #
# Helpers
# --------------------------------------------------------------------------- #


def _canonical_edge(u: int, v: int) -> tuple[int, int]:
    return (u, v) if u < v else (v, u)


def _edge_set(edges: list[tuple[int, int]]) -> set[tuple[int, int]]:
    return {_canonical_edge(u, v) for u, v in edges}


def _induced_blockade_edges(
    positions: list[tuple[float, float]], r_b_um: float
) -> list[tuple[int, int]]:
    n = len(positions)
    if n == 0:
        return []
    arr = np.asarray(positions)
    diff = arr[:, None, :] - arr[None, :, :]
    dist = np.linalg.norm(diff, axis=-1)
    upper = np.triu(dist <= r_b_um, k=1)
    upper[np.eye(n, dtype=bool)] = False
    return [(int(u), int(v)) for u, v in np.argwhere(upper)]


def _jaccard(a: set, b: set) -> float:
    if not a and not b:
        return 1.0
    return len(a & b) / len(a | b)


# --------------------------------------------------------------------------- #
# Layout step
# --------------------------------------------------------------------------- #


def _initial_positions(g: Graph, config: EmbedConfig) -> np.ndarray:
    """Either reuse the graph's positions or run a force-directed layout."""
    if g.node_positions is not None and len(g.node_positions) == g.n_nodes:
        return np.array([[p["x"], p["y"]] for p in g.node_positions], dtype=float)

    if g.n_nodes == 0:
        return np.zeros((0, 2))
    if g.n_nodes == 1:
        return np.array([[0.0, 0.0]])

    G = nx.Graph()
    G.add_nodes_from(range(g.n_nodes))
    G.add_edges_from(g.edges)
    # spring_layout: attracted along edges, repelled otherwise — matches blockade semantics.
    pos_dict = nx.spring_layout(
        G,
        seed=config.layout_seed,
        iterations=config.layout_iterations,
        dim=2,
    )
    return np.array([pos_dict[i] for i in range(g.n_nodes)])


def _fit_to_region(
    pts: np.ndarray, config: EmbedConfig, spec: AquilaSpec
) -> np.ndarray:
    """Scale + translate so the cloud fits inside (margin, region-margin)."""
    if pts.shape[0] == 0:
        return pts
    if pts.shape[0] == 1:
        return np.array([[spec.max_width_um / 2.0, spec.max_height_um / 2.0]])

    mn = pts.min(axis=0)
    mx = pts.max(axis=0)
    span = mx - mn
    span = np.where(span == 0, 1.0, span)  # avoid /0 for collinear points

    usable_w = spec.max_width_um - 2 * config.margin_um
    usable_h = spec.max_height_um - 2 * config.margin_um
    scale = min(usable_w / span[0], usable_h / span[1])

    scaled = (pts - mn) * scale
    # Center
    bbox_w = scaled[:, 0].max() - scaled[:, 0].min()
    bbox_h = scaled[:, 1].max() - scaled[:, 1].min()
    offset_x = config.margin_um + (usable_w - bbox_w) / 2.0
    offset_y = config.margin_um + (usable_h - bbox_h) / 2.0
    scaled[:, 0] += offset_x
    scaled[:, 1] += offset_y
    return scaled


def _snap_to_grid(pts: np.ndarray, spacing: float, spec: AquilaSpec) -> np.ndarray:
    """
    Snap each point to the nearest lattice site, then nudge to avoid duplicates.
    Lattice origin sits at (0, 0); valid sites are (k*spacing, m*spacing).
    """
    if pts.shape[0] == 0:
        return pts
    snapped = np.round(pts / spacing) * spacing
    # Clamp to inside the region (after rounding could fall outside by < spacing/2)
    snapped[:, 0] = np.clip(snapped[:, 0], 0.0, spec.max_width_um)
    snapped[:, 1] = np.clip(snapped[:, 1], 0.0, spec.max_height_um)

    # Greedily resolve collisions: if two atoms land on the same site, push the
    # second one to an adjacent free site. Real implementations would use a
    # min-cost assignment; we keep it simple for visualization purposes.
    used: set[tuple[float, float]] = set()
    for i in range(snapped.shape[0]):
        candidate = (round(float(snapped[i, 0]), 6), round(float(snapped[i, 1]), 6))
        if candidate not in used:
            used.add(candidate)
            continue
        # Search nearby grid points
        for dx in range(-10, 11):
            for dy in range(-10, 11):
                if dx == 0 and dy == 0:
                    continue
                nx_ = candidate[0] + dx * spacing
                ny_ = candidate[1] + dy * spacing
                if 0 <= nx_ <= spec.max_width_um and 0 <= ny_ <= spec.max_height_um:
                    key = (round(nx_, 6), round(ny_, 6))
                    if key not in used:
                        snapped[i] = (nx_, ny_)
                        used.add(key)
                        break
            else:
                continue
            break
    return snapped


# --------------------------------------------------------------------------- #
# Top-level embed
# --------------------------------------------------------------------------- #


def embed(
    target_graph: Graph,
    config: EmbedConfig | None = None,
    *,
    spec: AquilaSpec = AQUILA,
) -> AtomArray:
    """Build an AtomArray that approximately realizes ``target_graph`` on Aquila."""
    cfg = config or EmbedConfig()
    r_b = blockade_radius_um(cfg.rabi_rad_us, cfg.detuning_rad_us)

    raw = _initial_positions(target_graph, cfg)
    fitted = _fit_to_region(raw, cfg, spec) if cfg.rescale_to_region else raw
    final = _snap_to_grid(fitted, cfg.lattice_spacing_um, spec) if cfg.snap_to_grid else fitted

    positions = [(float(p[0]), float(p[1])) for p in final]

    induced = _induced_blockade_edges(positions, r_b)
    induced_set = _edge_set(induced)
    target_set = _edge_set(target_graph.edges)
    fidelity = _jaccard(induced_set, target_set)

    missing = sorted(target_set - induced_set)
    spurious = sorted(induced_set - target_set)
    violations = validate_positions(positions, spec=spec)

    return AtomArray(
        positions=positions,
        target_graph=target_graph,
        blockade_radius_um=r_b,
        induced_edges=induced,
        embedding_fidelity=fidelity,
        missing_edges=missing,
        spurious_edges=spurious,
        violations=violations,
    )


def atom_array_to_dict(arr: AtomArray) -> dict[str, Any]:
    """Serialize an AtomArray for JSON / FastAPI response models."""
    return {
        "positions": [{"id": i, "x": x, "y": y} for i, (x, y) in enumerate(arr.positions)],
        "blockade_radius_um": arr.blockade_radius_um,
        "induced_edges": [list(e) for e in arr.induced_edges],
        "embedding_fidelity": arr.embedding_fidelity,
        "missing_edges": [list(e) for e in arr.missing_edges],
        "spurious_edges": [list(e) for e in arr.spurious_edges],
        "violations": [v.to_dict() for v in arr.violations],
        "n_atoms": len(arr.positions),
    }
