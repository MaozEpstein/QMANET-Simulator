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
    lattice_spacing_um: float = Field(default=6.5, gt=0.0, le=75.0)
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


class ScheduleGapRequest(BaseModel):
    positions: list[NodePos]
    schedule: ScheduleDTO
    n_samples: int = Field(default=25, ge=3, le=200)


class GapTraceDTO(BaseModel):
    times: list[float]
    """Sample times in µs."""
    gaps: list[float]
    """Spectral gap E_1(t) − E_0(t) at each sample, rad/µs."""
    min_gap: float
    """δ_min — minimum encountered (rad/µs)."""
    t_at_min_gap: float
    """The time at which δ_min was attained (µs)."""
    suggested_t_us: float | None = None
    """Adiabatic-bound estimate ≈ 1/δ_min² (µs). null when δ_min == 0."""
    n_atoms: int


class ScheduleGapResponse(BaseModel):
    trace: GapTraceDTO | None
    """null when the system is too large (>GAP_MAX_ATOMS) to diagonalise."""
    n_atoms: int
    max_atoms: int


class ScheduleSpectrumRequest(BaseModel):
    positions: list[NodePos]
    schedule: ScheduleDTO
    n_samples: int = Field(default=25, ge=3, le=200)
    n_levels: int = Field(default=4, ge=1, le=16)


class SpectrumTraceDTO(BaseModel):
    times: list[float]
    """Sample times in µs."""
    eigenvalues: list[list[float]]
    """eigenvalues[i] = k lowest eigenvalues at times[i], ascending."""
    n_levels: int
    n_atoms: int


class ScheduleSpectrumResponse(BaseModel):
    trace: SpectrumTraceDTO | None
    """null when system is too large (>GAP_MAX_ATOMS) to diagonalise."""
    n_atoms: int
    max_atoms: int


class PhaseDiagramRequest(BaseModel):
    positions: list[NodePos]
    omega_min: float = Field(default=0.5, ge=0.0, le=15.8)
    omega_max: float = Field(default=15.0, gt=0.0, le=15.8)
    n_omega: int = Field(default=25, ge=2, le=64)
    delta_min: float = Field(default=-30.0, ge=-125.0, le=125.0)
    delta_max: float = Field(default=30.0, ge=-125.0, le=125.0)
    n_delta: int = Field(default=25, ge=2, le=64)


class PhaseDiagramDTO(BaseModel):
    omegas: list[float]
    deltas: list[float]
    mean_n: list[list[float]]
    """mean_n[d_idx][o_idx] = ⟨Σ n̂_i⟩ on the ground state."""
    n_atoms: int


class PhaseDiagramResponse(BaseModel):
    diagram: PhaseDiagramDTO | None
    """null when system is too large (>PHASE_DIAGRAM_MAX_ATOMS)."""
    n_atoms: int
    max_atoms: int


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


# --------------------------------------------------------------------------- #
# Phase 5 — Measurement / Post-process / Classical SA
# --------------------------------------------------------------------------- #


class MeasureRequest(BaseModel):
    """Sample bitstrings from a probability distribution (typically from
    a previous simulate run)."""

    bitstring_probs: dict[str, float]
    n_shots: int = Field(default=200, ge=1, le=10000)
    apply_noise: bool = True
    seed: int | None = None


class MeasureResponse(BaseModel):
    bitstrings: list[str]
    histogram: dict[str, int]
    n_shots: int
    n_atoms: int


class PostProcessRequest(BaseModel):
    bitstring: str
    target_graph: GraphDTO
    seed: int | None = 0


class PostProcessResultDTO(BaseModel):
    raw_bitstring: str
    raw_size: int
    raw_violations: int
    after_fix_bitstring: str
    after_fix_size: int
    removed: list[int]
    final_bitstring: str
    final_size: int
    added: list[int]
    is_valid: bool
    r_ratio: float | None = None
    """Approximation ratio R = final_size / |MIS*| per Ebadi 2022. Null when |MIS*| unknown."""


class PostProcessBatchRequest(BaseModel):
    bitstrings: list[str]
    target_graph: GraphDTO
    seed: int | None = 0


class PostProcessBatchResponse(BaseModel):
    results: list[PostProcessResultDTO]
    summary: dict


class SAConfigDTO(BaseModel):
    n_sweeps: int = Field(default=200, ge=1, le=10000)
    t_initial: float = Field(default=2.0, gt=0.0)
    t_final: float = Field(default=0.01, gt=0.0)
    penalty: float | None = Field(default=None, ge=1.0)
    """None ⇒ auto: max(2, max_graph_degree) per Lucas 2014 §2.3."""
    seed: int | None = 0


class SARequest(BaseModel):
    graph: GraphDTO
    config: SAConfigDTO | None = None


class SAResponse(BaseModel):
    best_set: list[int]
    best_size: int
    best_energy: float
    n_iterations: int
    energy_trace: list[float]
    penalty_used: float = 0.0
    """The actual penalty multiplier the SA used (post auto-resolution)."""
    target_mis_size: int | None = None
    """Exact |MIS*| for graphs ≤ 28 nodes, else null."""
    r_ratio: float | None = None
    """Approximation ratio R = best_size / |MIS*| (Ebadi 2022). Null when unknown."""


# --------------------------------------------------------------------------- #
# Phase 6 — MANET routing
# --------------------------------------------------------------------------- #


class RoutingRequest(BaseModel):
    graph: GraphDTO
    backbone: list[int]


class RouteDTO(BaseModel):
    src: int
    dst: int
    path: list[int]
    hops: int
    via: str
    """How the path was found: "direct" (1 edge), "backbone" (≥1 intermediate
    in the clique), or "fallback" (intermediates outside the backbone)."""


class RoutingResponse(BaseModel):
    backbone: list[int]
    is_clique: bool
    covered_nodes: list[int]
    coverage_fraction: float
    n_reachable_pairs: int
    mean_hops: float
    max_hops: int
    # Per-via breakdown — quantifies what the backbone contributed.
    n_via_direct: int
    n_via_backbone: int
    n_via_fallback: int
    mean_hops_direct: float
    mean_hops_backbone: float
    mean_hops_fallback: float
    routes: list[RouteDTO]


# --------------------------------------------------------------------------- #
# Phase 7 — Amazon Braket bridge
# --------------------------------------------------------------------------- #


class BraketPayloadRequest(BaseModel):
    """Build a Braket payload from atoms + schedule."""

    positions: list[NodePos]
    schedule: ScheduleDTO
    shots: int = Field(default=200, ge=1, le=1000)


class CostEstimateDTO(BaseModel):
    shot_fee_usd: float
    task_fee_usd: float
    total_usd: float
    shots: int


class BraketPayloadResponse(BaseModel):
    payload: dict
    """JSON-serializable Braket AnalogHamiltonianSimulation spec."""

    cost_estimate: CostEstimateDTO
    runtime_estimate_seconds: float
    device_arn: str
    preflight_violations: list[ViolationDTO]


class BraketSubmitRequest(BraketPayloadRequest):
    region: str = "us-east-1"


class BraketSubmitResponse(BaseModel):
    submitted: bool
    message: str
    """Human-readable status. If `submitted=false`, explains why
    (e.g. SDK missing, credentials missing, dry-run mode)."""
