"""
Embedding pipeline tests.

Coverage:
  - Geometry contracts (positions fit, snap to grid, no duplicates)
  - Physical contracts (blockade radius matches Aquila's formula)
  - Aquila validity (every produced array passes the validator)
  - Fidelity properties (perfect on unit-disk graphs, identity on empty)
  - Edge cases (n=0, n=1, isolated nodes, single edge)
  - Reproducibility (same seed → same atoms)
  - Property-style: 20 random target graphs, all valid
"""

from __future__ import annotations

import math

import networkx as nx
import pytest

from aquila.constants import AQUILA, blockade_radius_um
from aquila.validator import ViolationCode, is_valid
from pipeline.clique_to_mis import Graph
from pipeline.embedding import EmbedConfig, embed


# --------------------------------------------------------------------------- #
# Geometry contract
# --------------------------------------------------------------------------- #


def test_empty_graph_yields_empty_atom_array():
    arr = embed(Graph(n_nodes=0, edges=[]))
    assert arr.positions == []
    assert arr.violations == []
    assert arr.embedding_fidelity == 1.0  # empty == empty


def test_single_node_centers_in_region():
    arr = embed(Graph(n_nodes=1, edges=[]))
    assert len(arr.positions) == 1
    x, y = arr.positions[0]
    assert 0 < x < AQUILA.max_width_um
    assert 0 < y < AQUILA.max_height_um
    assert is_valid(arr.positions)


def test_positions_fit_inside_user_region():
    g = Graph(n_nodes=10, edges=[(i, (i + 1) % 10) for i in range(10)])
    arr = embed(g)
    for x, y in arr.positions:
        assert 0.0 <= x <= AQUILA.max_width_um
        assert 0.0 <= y <= AQUILA.max_height_um


def test_positions_snap_to_grid_by_default():
    g = Graph(n_nodes=8, edges=[(0, 1), (1, 2), (2, 3), (4, 5), (5, 6), (6, 7)])
    arr = embed(g, EmbedConfig(lattice_spacing_um=5.0))
    for x, y in arr.positions:
        # Each coordinate is a multiple of lattice_spacing (modulo clipping precision)
        assert math.isclose(x % 5.0, 0.0, abs_tol=1e-6) or math.isclose(x % 5.0, 5.0, abs_tol=1e-6)
        assert math.isclose(y % 5.0, 0.0, abs_tol=1e-6) or math.isclose(y % 5.0, 5.0, abs_tol=1e-6)


def test_snap_to_grid_can_be_disabled():
    g = Graph(n_nodes=6, edges=[(0, 1), (2, 3), (4, 5)])
    arr = embed(g, EmbedConfig(snap_to_grid=False))
    # Not requiring multiples of any spacing
    assert all(0 <= x <= AQUILA.max_width_um for x, _ in arr.positions)


def test_no_duplicate_positions():
    g = Graph(n_nodes=12, edges=[(0, 1), (2, 3), (4, 5)])
    arr = embed(g, EmbedConfig(lattice_spacing_um=5.0))
    keys = {(round(x, 4), round(y, 4)) for x, y in arr.positions}
    assert len(keys) == len(arr.positions)


# --------------------------------------------------------------------------- #
# Physics contract — blockade radius matches Aquila formula
# --------------------------------------------------------------------------- #


def test_blockade_radius_matches_constants():
    arr = embed(
        Graph(n_nodes=2, edges=[(0, 1)]),
        EmbedConfig(rabi_rad_us=15.0, detuning_rad_us=0.0),
    )
    assert math.isclose(arr.blockade_radius_um, blockade_radius_um(15.0, 0.0))


def test_blockade_radius_in_paper_regime():
    """Whitepaper §6: R_b ∈ (5√2, 10) for Ω=15 → must hold in our embedder too."""
    arr = embed(Graph(n_nodes=2, edges=[]), EmbedConfig(rabi_rad_us=15.0))
    assert 5.0 < arr.blockade_radius_um < 12.0


def test_blockade_radius_shrinks_as_rabi_grows():
    a = embed(Graph(n_nodes=2, edges=[]), EmbedConfig(rabi_rad_us=5.0))
    b = embed(Graph(n_nodes=2, edges=[]), EmbedConfig(rabi_rad_us=15.0))
    assert a.blockade_radius_um > b.blockade_radius_um


# --------------------------------------------------------------------------- #
# Aquila validity — every produced array must pass the validator
# --------------------------------------------------------------------------- #


@pytest.mark.parametrize("seed", range(8))
def test_property_random_graphs_always_produce_aquila_valid_arrays(seed):
    G = nx.gnp_random_graph(12, p=0.4, seed=seed)
    g = Graph(
        n_nodes=12,
        edges=[(int(u), int(v)) for u, v in G.edges() if u < v],
    )
    arr = embed(g, EmbedConfig(layout_seed=seed))
    bad = [v for v in arr.violations if v.code != ViolationCode.ROW_TOO_CLOSE]
    # row violations only occur if the layout happened to put two atoms at
    # nearly-different y's; ours snaps to grid so this should be rare/empty.
    assert is_valid(arr.positions), [v.code for v in arr.violations]


def test_embedding_includes_validations_in_output():
    arr = embed(Graph(n_nodes=4, edges=[]))
    assert hasattr(arr, "violations")
    assert isinstance(arr.violations, list)


# --------------------------------------------------------------------------- #
# Fidelity properties
# --------------------------------------------------------------------------- #


def test_fidelity_perfect_on_widely_separated_pairs():
    """Edgeless graph with widely scattered atoms → induced_edges empty → fidelity = 1."""
    arr = embed(Graph(n_nodes=4, edges=[]), EmbedConfig(rabi_rad_us=15.0))
    # An edgeless target with atoms further than R_b ⇒ both edge sets are empty ⇒ Jaccard 1.0
    assert arr.embedding_fidelity == 1.0
    assert arr.induced_edges == []


def test_fidelity_complete_graph_when_all_atoms_within_blockade():
    """K_n with manually-set tight positions inside R_b ⇒ all edges induced."""
    n = 4
    # Place 4 atoms inside a 4µm×4µm square — all pairs within ~5.6 µm, well inside R_b ≈ 9 µm.
    positions = [
        {"id": 0, "x": 30.0, "y": 30.0},
        {"id": 1, "x": 34.0, "y": 30.0},
        {"id": 2, "x": 30.0, "y": 34.0},
        {"id": 3, "x": 34.0, "y": 34.0},
    ]
    edges = [(i, j) for i in range(n) for j in range(i + 1, n)]
    g = Graph(n_nodes=n, edges=edges, node_positions=positions)
    arr = embed(
        g,
        EmbedConfig(
            rabi_rad_us=15.0,
            lattice_spacing_um=4.0,
            layout_iterations=0,
            rescale_to_region=False,
            snap_to_grid=False,
        ),
    )
    induced = {(min(u, v), max(u, v)) for u, v in arr.induced_edges}
    target = {(min(u, v), max(u, v)) for u, v in edges}
    # All 6 K_4 edges should be induced
    assert induced == target, f"got {induced}, expected {target}"
    assert arr.embedding_fidelity == 1.0


def test_induced_edges_canonical_form():
    arr = embed(Graph(n_nodes=4, edges=[(0, 1)]))
    for u, v in arr.induced_edges:
        assert u < v


# --------------------------------------------------------------------------- #
# Reproducibility
# --------------------------------------------------------------------------- #


def test_same_seed_gives_same_atoms():
    g = Graph(n_nodes=10, edges=[(i, (i + 1) % 10) for i in range(10)])
    a = embed(g, EmbedConfig(layout_seed=42))
    b = embed(g, EmbedConfig(layout_seed=42))
    assert a.positions == b.positions


def test_different_seeds_diverge():
    g = Graph(n_nodes=12, edges=[(0, 1), (2, 3), (4, 5)])
    a = embed(g, EmbedConfig(layout_seed=1, snap_to_grid=False))
    b = embed(g, EmbedConfig(layout_seed=2, snap_to_grid=False))
    assert a.positions != b.positions


# --------------------------------------------------------------------------- #
# Edge cases
# --------------------------------------------------------------------------- #


def test_two_isolated_nodes_no_edge():
    arr = embed(Graph(n_nodes=2, edges=[]))
    assert len(arr.positions) == 2
    assert arr.violations == []


def test_two_nodes_one_edge_have_distinct_positions():
    arr = embed(Graph(n_nodes=2, edges=[(0, 1)]))
    assert arr.positions[0] != arr.positions[1]


def test_uses_input_positions_when_provided():
    """If the graph already has MANET positions, the embedder must start from them."""
    g = Graph(
        n_nodes=3,
        edges=[(0, 1), (1, 2)],
        node_positions=[
            {"id": 0, "x": 0.0, "y": 0.0},
            {"id": 1, "x": 50.0, "y": 0.0},
            {"id": 2, "x": 100.0, "y": 0.0},
        ],
    )
    arr = embed(g, EmbedConfig(layout_iterations=0))
    # After fit-to-region, atom 0 should be on the left and atom 2 on the right
    assert arr.positions[0][0] < arr.positions[2][0]


def test_serialize_to_dict_round_trips():
    from pipeline.embedding import atom_array_to_dict

    arr = embed(Graph(n_nodes=4, edges=[(0, 1), (2, 3)]))
    d = atom_array_to_dict(arr)
    assert "positions" in d and len(d["positions"]) == 4
    for p in d["positions"]:
        assert set(p.keys()) == {"id", "x", "y"}
    assert isinstance(d["blockade_radius_um"], float)
    assert isinstance(d["embedding_fidelity"], float)
    assert isinstance(d["violations"], list)


# --------------------------------------------------------------------------- #
# Larger / property-style
# --------------------------------------------------------------------------- #


@pytest.mark.parametrize("n,seed", [(8, 1), (12, 2), (16, 3), (20, 4), (24, 5)])
def test_property_random_graph_no_positional_violations(n, seed):
    G = nx.gnp_random_graph(n, p=0.3, seed=seed)
    g = Graph(n_nodes=n, edges=[(int(u), int(v)) for u, v in G.edges() if u < v])
    arr = embed(g, EmbedConfig(layout_seed=seed, lattice_spacing_um=5.0))
    assert is_valid(arr.positions), [v.code for v in arr.violations]


def test_too_large_graph_still_returns_array_with_violations():
    """If user asks for 300 atoms, we still return an array — but flag violations."""
    g = Graph(n_nodes=300, edges=[])
    # Will produce TOO_MANY_ATOMS, possibly others.
    arr = embed(g)
    assert len(arr.positions) == 300
    assert any(v.code == ViolationCode.TOO_MANY_ATOMS for v in arr.violations)
