"""Pydantic schemas — shared contract between backend & frontend."""

from __future__ import annotations

from pydantic import BaseModel, Field


class NodePos(BaseModel):
    id: int
    x: float
    y: float


class GraphDTO(BaseModel):
    n_nodes: int
    edges: list[tuple[int, int]]
    node_positions: list[NodePos] | None = None


class MANETRequest(BaseModel):
    n_nodes: int = Field(default=12, ge=2, le=64)
    box_size: float = Field(default=100.0, gt=0.0)
    comm_radius: float = Field(default=35.0, gt=0.0)
    seed: int | None = 42


class MANETResponse(BaseModel):
    graph: GraphDTO
    config: MANETRequest


class ComplementRequest(BaseModel):
    graph: GraphDTO


class MISResponse(BaseModel):
    graph: GraphDTO
    complement: GraphDTO
    max_clique_in_G: list[int]
    """Vertices forming a maximum clique in the original graph."""
    mis_in_complement: list[int]
    """Same set — viewed as a maximum independent set in the complement."""
    size: int


# --------------------------------------------------------------------------- #
# Phase 2 — Embedding
# --------------------------------------------------------------------------- #


class EmbedConfigDTO(BaseModel):
    lattice_spacing_um: float = Field(default=5.0, gt=0.0, le=75.0)
    rabi_rad_us: float = Field(default=15.0, ge=0.0, le=15.8)
    detuning_rad_us: float = Field(default=0.0, ge=-125.0, le=125.0)
    layout_seed: int = 0
    layout_iterations: int = Field(default=200, ge=0, le=2000)
    snap_to_grid: bool = True
    rescale_to_region: bool = True
    margin_um: float = Field(default=2.0, ge=0.0, le=10.0)


class EmbedRequest(BaseModel):
    target_graph: GraphDTO
    config: EmbedConfigDTO | None = None


class ViolationDTO(BaseModel):
    code: str
    message: str
    locus: dict
    measured: float
    limit: float


class EmbedResponse(BaseModel):
    positions: list[NodePos]
    n_atoms: int
    blockade_radius_um: float
    induced_edges: list[tuple[int, int]]
    embedding_fidelity: float
    """Jaccard similarity between induced and target edge sets, in [0,1]."""
    missing_edges: list[tuple[int, int]]
    spurious_edges: list[tuple[int, int]]
    violations: list[ViolationDTO]


# --------------------------------------------------------------------------- #
# Phase 3 — Pulse schedule
# --------------------------------------------------------------------------- #


class PiecewiseLinearDTO(BaseModel):
    times: list[float]
    values: list[float]


class ScheduleDTO(BaseModel):
    omega: PiecewiseLinearDTO
    delta: PiecewiseLinearDTO
    phi: PiecewiseLinearDTO
    duration: float


class ScheduleRequest(BaseModel):
    """Either preset+params, or explicit breakpoints. Preset wins if both given."""

    preset: str | None = None
    """Name of a registered preset (paper_linear_ramp, bernien_2017_sweep)."""

    preset_params: dict = Field(default_factory=dict)
    """Optional keyword arguments forwarded to the preset constructor."""

    omega_breakpoints: list[tuple[float, float]] | None = None
    delta_breakpoints: list[tuple[float, float]] | None = None
    phi_breakpoints: list[tuple[float, float]] | None = None


class ScheduleResponse(BaseModel):
    schedule: ScheduleDTO
    violations: list[ViolationDTO]
    max_omega_slew_rate: float
    """Largest |dΩ/dt| seen in any segment (rad/µs²)."""


# --------------------------------------------------------------------------- #
# Phase 4 — Evolution
# --------------------------------------------------------------------------- #


class SimulateRequest(BaseModel):
    positions: list[NodePos]
    schedule: ScheduleDTO
    n_frames: int = Field(default=120, ge=2, le=600)


class SimulationFrameDTO(BaseModel):
    t_us: float
    rydberg_populations: list[float]
    norm: float


class SimulateResponse(BaseModel):
    frames: list[SimulationFrameDTO]
    final_bitstring_probs: dict[str, float]
    n_atoms: int
    duration_us: float
