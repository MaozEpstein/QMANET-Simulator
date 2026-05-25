"""
FastAPI entrypoint for Qsimulator.

Run:
    uvicorn api.server:app --reload --port 8000

Endpoints will be filled in over phases 1-7. This stub exposes:
    GET /            health
    GET /api/aquila  hardware spec (so the frontend can render limits)
"""

from __future__ import annotations

from dataclasses import asdict

from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware

from aquila.constants import AQUILA
import asyncio
import json
from contextlib import suppress

from fastapi import WebSocket, WebSocketDisconnect

from api.models import (
    BraketPayloadRequest,
    BraketPayloadResponse,
    BraketSubmitRequest,
    BraketSubmitResponse,
    ComplementRequest,
    CostEstimateDTO,
    EmbedRequest,
    EmbedResponse,
    GapTraceDTO,
    GraphDTO,
    PhaseDiagramDTO,
    PhaseDiagramRequest,
    PhaseDiagramResponse,
    MANETRequest,
    MANETResponse,
    MISResponse,
    MeasureRequest,
    MeasureResponse,
    NodePos,
    PiecewiseLinearDTO,
    PostProcessBatchRequest,
    PostProcessBatchResponse,
    PostProcessRequest,
    PostProcessResultDTO,
    RouteDTO,
    RoutingRequest,
    RoutingResponse,
    SAConfigDTO,
    SARequest,
    SAResponse,
    ScheduleDTO,
    ScheduleGapRequest,
    ScheduleGapResponse,
    ScheduleRequest,
    ScheduleResponse,
    ScheduleSpectrumRequest,
    ScheduleSpectrumResponse,
    SpectrumTraceDTO,
    SimulateRequest,
    SimulateResponse,
    SimulationFrameDTO,
    ViolationDTO,
)
from pipeline import clique_to_mis as cqm
from pipeline import manet as manet_mod
from pipeline.adiabatic_gap import GAP_MAX_ATOMS, compute_min_gap, compute_spectrum
from pipeline.phase_diagram import PHASE_DIAGRAM_MAX_ATOMS, compute_phase_diagram
from pipeline.classical_sa import SAConfig, simulated_annealing
from pipeline.embedding import EmbedConfig, embed as embed_atoms
from pipeline.measurement import measure
from pipeline.postprocess import postprocess, postprocess_many, summarize_postprocess
from aquila.braket_adapter import (
    AQUILA_DEVICE_ARN,
    BraketUnavailable,
    build_payload,
    estimate_cost,
    estimate_runtime,
    preflight_check,
    submit_to_braket,
)
from pipeline.routing import build_routing_table
from pipeline.schedule import (
    PRESETS,
    PiecewiseLinear,
    Schedule,
    from_breakpoints,
    validate_schedule,
)
from pipeline.simulate import SimulationFrame, SimulationResult, simulate

app = FastAPI(
    title="Qsimulator",
    description="Neutral-atom MANET routing simulator backend",
    version="0.1.0",
)

# Vite dev server origin; tighten in production.
app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:5173", "http://127.0.0.1:5173"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.get("/")
def health() -> dict[str, str]:
    return {"status": "ok", "service": "qsimulator-backend", "version": "0.1.0"}


@app.get("/api/aquila")
def aquila_spec() -> dict:
    """Expose Aquila hardware constants — the frontend renders constraints from this."""
    spec = asdict(AQUILA)
    return spec


# =============================================================================
# Phase 1 — MANET generation + complement + MIS
# =============================================================================


def _snapshot_to_dto(snap: manet_mod.MANETSnapshot) -> GraphDTO:
    return GraphDTO(
        n_nodes=len(snap.nodes),
        edges=[(int(u), int(v)) for u, v in snap.edges],
        node_positions=[NodePos(**n) for n in snap.nodes],
    )


def _dto_to_graph(dto: GraphDTO) -> cqm.Graph:
    positions = (
        [{"id": p.id, "x": p.x, "y": p.y} for p in dto.node_positions]
        if dto.node_positions is not None
        else None
    )
    return cqm.Graph(
        n_nodes=dto.n_nodes,
        edges=[(int(u), int(v)) for u, v in dto.edges],
        node_positions=positions,
    )


def _graph_to_dto(g: cqm.Graph) -> GraphDTO:
    positions = (
        [NodePos(**p) for p in g.node_positions]
        if g.node_positions is not None
        else None
    )
    return GraphDTO(
        n_nodes=g.n_nodes,
        edges=[(int(u), int(v)) for u, v in g.edges],
        node_positions=positions,
    )


@app.post("/api/manet/generate", response_model=MANETResponse)
def generate_manet(req: MANETRequest) -> MANETResponse:
    """Generate a Random Geometric Graph that models a MANET snapshot."""
    cfg = manet_mod.MANETConfig(
        n_nodes=req.n_nodes,
        box_size=req.box_size,
        comm_radius=req.comm_radius,
        seed=req.seed,
    )
    snap = manet_mod.generate(cfg)
    return MANETResponse(graph=_snapshot_to_dto(snap), config=req)


@app.post("/api/graph/complement", response_model=MISResponse)
def graph_complement(req: ComplementRequest) -> MISResponse:
    """
    Build Ḡ and (for small instances) compute MaxClique(G) = MIS(Ḡ).

    Above EXACT_MIS_MAX_NODES we still return Ḡ but leave the optimal set empty
    — the quantum pipeline will fill it in later stages.
    """
    g = _dto_to_graph(req.graph)
    gbar = cqm.complement(g)

    max_clique: list[int] = []
    all_cliques: list[list[int]] = []
    n_max_cliques = 0
    alpha_g = 0
    chrom_lo = 0
    chrom_hi = 0
    if g.n_nodes <= cqm.EXACT_MIS_MAX_NODES:
        try:
            all_cliques, n_max_cliques = cqm.all_max_cliques(g)
            alpha_g = cqm.alpha(g)
            chrom_lo, chrom_hi = cqm.chromatic_bounds(g)
        except ValueError as e:
            raise HTTPException(status_code=422, detail=str(e)) from e
        if all_cliques:
            # Keep `max_clique_in_G` populated for backwards compatibility with
            # downstream stages (3, 8) that read it directly.
            max_clique = all_cliques[0]

    return MISResponse(
        graph=_graph_to_dto(g),
        complement=_graph_to_dto(gbar),
        max_clique_in_G=max_clique,
        mis_in_complement=max_clique,
        size=len(max_clique),
        all_max_cliques=all_cliques,
        n_max_cliques=n_max_cliques,
        alpha_g=alpha_g,
        chromatic_lower=chrom_lo,
        chromatic_upper=chrom_hi,
    )


# =============================================================================
# Phase 2 — Embedding (MIS-graph → atom array)
# =============================================================================


@app.post("/api/embed/atoms", response_model=EmbedResponse)
def embed_atoms_endpoint(req: EmbedRequest) -> EmbedResponse:
    """
    Place atoms on the Aquila lattice approximating ``target_graph`` as a
    unit-disk graph under the Rydberg blockade. Always returns a valid
    response — geometric/constraint violations are listed in `violations`.
    """
    g = _dto_to_graph(req.target_graph)
    cfg = EmbedConfig(**req.config.model_dump()) if req.config is not None else EmbedConfig()
    arr = embed_atoms(g, cfg)
    return EmbedResponse(
        positions=[NodePos(id=i, x=x, y=y) for i, (x, y) in enumerate(arr.positions)],
        n_atoms=len(arr.positions),
        blockade_radius_um=arr.blockade_radius_um,
        induced_edges=arr.induced_edges,
        embedding_fidelity=arr.embedding_fidelity,
        missing_edges=arr.missing_edges,
        spurious_edges=arr.spurious_edges,
        violations=[ViolationDTO(**v.to_dict()) for v in arr.violations],
    )


# =============================================================================
# Phase 3 — Pulse schedule builder
# =============================================================================


def _schedule_to_dto(s: Schedule) -> ScheduleDTO:
    return ScheduleDTO(
        omega=PiecewiseLinearDTO(**s.omega.to_dict()),
        delta=PiecewiseLinearDTO(**s.delta.to_dict()),
        phi=PiecewiseLinearDTO(**s.phi.to_dict()),
        duration=s.duration,
    )


@app.get("/api/schedule/presets")
def list_schedule_presets() -> dict:
    """List available preset names so the frontend can populate a dropdown."""
    return {"presets": list(PRESETS.keys())}


@app.post("/api/schedule/build", response_model=ScheduleResponse)
def build_schedule(req: ScheduleRequest) -> ScheduleResponse:
    """
    Build a Schedule from either a preset name (with optional params) or
    explicit breakpoint lists. Always returns 200 with violations in body.
    """
    if req.preset is not None:
        if req.preset not in PRESETS:
            raise HTTPException(status_code=422, detail=f"unknown preset '{req.preset}'")
        try:
            schedule = PRESETS[req.preset](**req.preset_params)
        except (TypeError, ValueError) as e:
            raise HTTPException(status_code=422, detail=str(e)) from e
    else:
        if req.omega_breakpoints is None or req.delta_breakpoints is None:
            raise HTTPException(
                status_code=422,
                detail="either preset or omega_breakpoints+delta_breakpoints must be provided",
            )
        try:
            schedule = from_breakpoints(
                omega_breakpoints=req.omega_breakpoints,
                delta_breakpoints=req.delta_breakpoints,
                phi_breakpoints=req.phi_breakpoints,
            )
        except ValueError as e:
            raise HTTPException(status_code=422, detail=str(e)) from e

    violations = validate_schedule(schedule)
    return ScheduleResponse(
        schedule=_schedule_to_dto(schedule),
        violations=[ViolationDTO(**v.to_dict()) for v in violations],
        max_omega_slew_rate=schedule.omega.max_slew_rate(),
    )


@app.post("/api/schedule/gap", response_model=ScheduleGapResponse)
def schedule_gap(req: ScheduleGapRequest) -> ScheduleGapResponse:
    """
    Compute the instantaneous spectral gap E_1(t) − E_0(t) along the schedule.

    Used by Stage 4 to warn the user when T is too short for the chosen graph
    (adiabatic theorem requires T ≳ 1 / δ_min²). For large systems (>10 atoms)
    we refuse explicitly so the UI can display a friendlier message instead of
    spinning a CPU.
    """
    positions = [(p.x, p.y) for p in req.positions]
    n = len(positions)
    schedule = _schedule_from_dto(req.schedule)
    trace = compute_min_gap(positions, schedule, n_samples=req.n_samples)
    return ScheduleGapResponse(
        trace=GapTraceDTO(**trace.to_dict()) if trace is not None else None,
        n_atoms=n,
        max_atoms=GAP_MAX_ATOMS,
    )


@app.post("/api/schedule/spectrum", response_model=ScheduleSpectrumResponse)
def schedule_spectrum(req: ScheduleSpectrumRequest) -> ScheduleSpectrumResponse:
    """
    Sample the k lowest eigenvalues of H(t) along the schedule.

    Same shape as :func:`schedule_gap` but returns every low-lying energy
    level — the UI plots them as separate curves so the avoided crossing
    becomes visible. Refuses for systems >10 atoms (2^N matrix grows fast).
    """
    positions = [(p.x, p.y) for p in req.positions]
    n = len(positions)
    schedule = _schedule_from_dto(req.schedule)
    trace = compute_spectrum(
        positions, schedule, n_samples=req.n_samples, n_levels=req.n_levels
    )
    return ScheduleSpectrumResponse(
        trace=SpectrumTraceDTO(**trace.to_dict()) if trace is not None else None,
        n_atoms=n,
        max_atoms=GAP_MAX_ATOMS,
    )


@app.post("/api/spectrum/phase_diagram", response_model=PhaseDiagramResponse)
def spectrum_phase_diagram(req: PhaseDiagramRequest) -> PhaseDiagramResponse:
    """
    Sweep the (Ω, Δ) plane and return ⟨Σ n̂⟩ on the ground state at each
    grid point. Stage 4 renders the result as a heatmap — distinct phases
    (no-Rydberg, Z₂, MIS, fully excited) appear as colored regions.
    """
    if req.omega_min >= req.omega_max:
        raise HTTPException(status_code=422, detail="omega_min must be < omega_max")
    if req.delta_min >= req.delta_max:
        raise HTTPException(status_code=422, detail="delta_min must be < delta_max")
    positions = [(p.x, p.y) for p in req.positions]
    n = len(positions)
    diagram = compute_phase_diagram(
        positions,
        omega_min=req.omega_min,
        omega_max=req.omega_max,
        n_omega=req.n_omega,
        delta_min=req.delta_min,
        delta_max=req.delta_max,
        n_delta=req.n_delta,
    )
    return PhaseDiagramResponse(
        diagram=PhaseDiagramDTO(**diagram.to_dict()) if diagram is not None else None,
        n_atoms=n,
        max_atoms=PHASE_DIAGRAM_MAX_ATOMS,
    )


# =============================================================================
# Phase 4 — Adiabatic evolution
# =============================================================================


def _schedule_from_dto(s: ScheduleDTO) -> Schedule:
    return Schedule(
        omega=PiecewiseLinear.from_lists(s.omega.times, s.omega.values),
        delta=PiecewiseLinear.from_lists(s.delta.times, s.delta.values),
        phi=PiecewiseLinear.from_lists(s.phi.times, s.phi.values),
    )


def _frame_to_dto(f: SimulationFrame) -> SimulationFrameDTO:
    return SimulationFrameDTO(
        t_us=f.t_us,
        rydberg_populations=list(f.rydberg_populations),
        norm=f.norm,
    )


def _run_simulation(req: SimulateRequest) -> list[SimulationFrame]:
    positions = [(p.x, p.y) for p in req.positions]
    schedule = _schedule_from_dto(req.schedule)
    result = simulate(schedule, positions, n_frames=req.n_frames)
    return list(result.frames), result


@app.post("/api/simulate/run", response_model=SimulateResponse)
def simulate_run(req: SimulateRequest) -> SimulateResponse:
    """Run the full evolution synchronously and return all frames at once."""
    positions = [(p.x, p.y) for p in req.positions]
    schedule = _schedule_from_dto(req.schedule)
    result = simulate(schedule, positions, n_frames=req.n_frames)
    return SimulateResponse(
        frames=[_frame_to_dto(f) for f in result.frames],
        final_bitstring_probs=result.final_bitstring_probs,
        n_atoms=result.n_atoms,
        duration_us=result.duration_us,
    )


# =============================================================================
# Phase 5 — Measurement, post-processing, classical SA
# =============================================================================


@app.post("/api/measure", response_model=MeasureResponse)
def measure_shots(req: MeasureRequest) -> MeasureResponse:
    """Sample shots from a probability distribution + apply Aquila noise."""
    if not req.bitstring_probs:
        return MeasureResponse(bitstrings=[], histogram={}, n_shots=0, n_atoms=0)
    n_atoms = len(next(iter(req.bitstring_probs.keys())))
    sim = SimulationResult(
        frames=(),
        final_bitstring_probs=req.bitstring_probs,
        n_atoms=n_atoms,
        duration_us=0.0,
    )
    m = measure(sim, n_shots=req.n_shots, seed=req.seed, apply_noise=req.apply_noise)
    return MeasureResponse(
        bitstrings=list(m.bitstrings),
        histogram=m.histogram,
        n_shots=m.n_shots,
        n_atoms=m.n_atoms,
    )


def _graph_to_internal(dto: GraphDTO) -> cqm.Graph:
    return cqm.Graph(
        n_nodes=dto.n_nodes,
        edges=[(int(u), int(v)) for u, v in dto.edges],
        node_positions=(
            [{"id": p.id, "x": p.x, "y": p.y} for p in dto.node_positions]
            if dto.node_positions is not None
            else None
        ),
    )


@app.post("/api/postprocess", response_model=PostProcessResultDTO)
def postprocess_one(req: PostProcessRequest) -> PostProcessResultDTO:
    """Greedy violation fix + greedy mIS extension on a single shot."""
    g = _graph_to_internal(req.target_graph)
    if len(req.bitstring) != g.n_nodes:
        raise HTTPException(
            status_code=422,
            detail=f"bitstring length {len(req.bitstring)} != n_nodes {g.n_nodes}",
        )
    res = postprocess(req.bitstring, g, seed=req.seed)
    return PostProcessResultDTO(**res.to_dict())


@app.post("/api/postprocess/batch", response_model=PostProcessBatchResponse)
def postprocess_batch(req: PostProcessBatchRequest) -> PostProcessBatchResponse:
    """Run postprocess on many shots, return per-shot results + summary."""
    g = _graph_to_internal(req.target_graph)
    for b in req.bitstrings:
        if len(b) != g.n_nodes:
            raise HTTPException(
                status_code=422,
                detail=f"bitstring length {len(b)} != n_nodes {g.n_nodes}",
            )
    results = postprocess_many(req.bitstrings, g, seed=req.seed)
    summary = summarize_postprocess(results, graph=g)
    target_size = summary["target_mis_size"]

    def _result_dto(r) -> PostProcessResultDTO:
        d = r.to_dict()
        d["r_ratio"] = (
            None if target_size is None or target_size == 0 else r.final_size / target_size
        )
        return PostProcessResultDTO(**d)

    return PostProcessBatchResponse(
        results=[_result_dto(r) for r in results],
        summary=summary,
    )


@app.post("/api/classical/sa", response_model=SAResponse)
def classical_sa(req: SARequest) -> SAResponse:
    """Run classical simulated annealing as the benchmark."""
    g = _graph_to_internal(req.graph)
    cfg = SAConfig(**req.config.model_dump()) if req.config is not None else SAConfig()
    res = simulated_annealing(g, cfg)
    return SAResponse(**res.to_dict())


# =============================================================================
# Phase 6 — MANET routing via the backbone clique
# =============================================================================


# =============================================================================
# Phase 7 — Amazon Braket bridge (dispatch to real Aquila hardware)
# =============================================================================


def _build_braket_payload_from_request(req: BraketPayloadRequest):
    positions = [(p.x, p.y) for p in req.positions]
    sched = req.schedule
    return build_payload(
        positions_um=positions,
        omega_times_us=list(sched.omega.times),
        omega_values_rad_us=list(sched.omega.values),
        delta_times_us=list(sched.delta.times),
        delta_values_rad_us=list(sched.delta.values),
        phi_times_us=list(sched.phi.times),
        phi_values_rad=list(sched.phi.values),
        shots=req.shots,
    )


@app.post("/api/braket/payload", response_model=BraketPayloadResponse)
def braket_payload(req: BraketPayloadRequest) -> BraketPayloadResponse:
    """
    Dry-run: build the Braket payload + cost + runtime estimate + preflight
    constraint check. Doesn't touch AWS; safe to call always.
    """
    try:
        payload = _build_braket_payload_from_request(req)
    except ValueError as e:
        raise HTTPException(status_code=422, detail=str(e)) from e

    positions = [(p.x, p.y) for p in req.positions]
    violations = preflight_check(
        positions_um=positions,
        omega_values_rad_us=list(req.schedule.omega.values),
        delta_values_rad_us=list(req.schedule.delta.values),
        duration_us=req.schedule.duration,
    )
    cost = estimate_cost(req.shots)
    runtime_s = estimate_runtime(req.shots)
    return BraketPayloadResponse(
        payload=payload.to_dict(),
        cost_estimate=CostEstimateDTO(**cost.to_dict()),
        runtime_estimate_seconds=runtime_s,
        device_arn=AQUILA_DEVICE_ARN,
        preflight_violations=[ViolationDTO(**v.to_dict()) for v in violations],
    )


@app.post("/api/braket/submit", response_model=BraketSubmitResponse)
def braket_submit(req: BraketSubmitRequest) -> BraketSubmitResponse:
    """
    Real submission to Aquila via Braket. Fails gracefully (200 + submitted=False)
    when the SDK isn't installed or AWS credentials are missing — so the UI
    can keep functioning as a sandbox even without an AWS account.
    """
    try:
        payload = _build_braket_payload_from_request(req)
    except ValueError as e:
        raise HTTPException(status_code=422, detail=str(e)) from e

    try:
        result = submit_to_braket(payload, region=req.region)
        return BraketSubmitResponse(
            submitted=True,
            message=f"submitted: {result}",
        )
    except BraketUnavailable as e:
        return BraketSubmitResponse(submitted=False, message=str(e))
    except NotImplementedError as e:
        # Until we wire the real AnalogHamiltonianSimulation call, payload is
        # ready but the dispatcher refuses on purpose.
        return BraketSubmitResponse(submitted=False, message=str(e))


@app.post("/api/routing/build", response_model=RoutingResponse)
def routing_build(req: RoutingRequest) -> RoutingResponse:
    """Compute the routing table for a MANET given the backbone clique."""
    g = _graph_to_internal(req.graph)
    try:
        res = build_routing_table(g, req.backbone)
    except ValueError as e:
        raise HTTPException(status_code=422, detail=str(e)) from e
    return RoutingResponse(
        backbone=list(res.backbone),
        is_clique=res.is_clique,
        covered_nodes=list(res.covered_nodes),
        coverage_fraction=res.coverage_fraction,
        n_reachable_pairs=res.n_reachable_pairs,
        mean_hops=res.mean_hops,
        max_hops=res.max_hops,
        n_via_direct=res.n_via_direct,
        n_via_backbone=res.n_via_backbone,
        n_via_fallback=res.n_via_fallback,
        mean_hops_direct=res.mean_hops_direct,
        mean_hops_backbone=res.mean_hops_backbone,
        mean_hops_fallback=res.mean_hops_fallback,
        routes=[RouteDTO(**r.to_dict()) for r in res.routes],
    )


@app.websocket("/ws/simulate")
async def simulate_ws(websocket: WebSocket) -> None:
    """
    Live-stream simulation frames.

    Protocol (text JSON, both directions):
      Client → server: a single SimulateRequest JSON message to start a job.
      Server → client: a stream of frame messages
                       {"type":"frame","frame":SimulationFrameDTO}
                       terminated by
                       {"type":"done","final_bitstring_probs":...,"n_atoms":N,"duration_us":T}
                       on error:
                       {"type":"error","message":...}

    Backpressure: frames are produced by a worker thread; the WS coroutine
    reads from a bounded queue and skips frames if the client is slow, so the
    network never falls more than N frames behind real time.
    """
    await websocket.accept()
    try:
        text = await websocket.receive_text()
        payload = json.loads(text)
        req = SimulateRequest(**payload)
    except Exception as e:
        await websocket.send_json({"type": "error", "message": f"invalid request: {e}"})
        await websocket.close()
        return

    queue: asyncio.Queue[SimulationFrame | None] = asyncio.Queue(maxsize=8)
    loop = asyncio.get_running_loop()
    # The full SimulationResult is captured by the worker so we can stream
    # `final_bitstring_probs` in the "done" message — that lets Stages 6 & 7
    # sample without re-running sesolve.
    sim_result_holder: dict[str, SimulationResult | None] = {"result": None}

    def on_frame(frame: SimulationFrame) -> None:
        # Called from the simulator's worker thread. Schedule put() on the loop.
        asyncio.run_coroutine_threadsafe(queue.put(frame), loop)

    def run_simulator() -> None:
        try:
            schedule = _schedule_from_dto(req.schedule)
            positions = [(p.x, p.y) for p in req.positions]
            sim_result_holder["result"] = simulate(
                schedule, positions, n_frames=req.n_frames, on_frame=on_frame
            )
        finally:
            asyncio.run_coroutine_threadsafe(queue.put(None), loop)

    worker = loop.run_in_executor(None, run_simulator)

    try:
        n_atoms = len(req.positions)
        duration = req.schedule.duration
        final_state_frame: SimulationFrame | None = None
        while True:
            frame = await queue.get()
            if frame is None:
                break
            final_state_frame = frame
            await websocket.send_json(
                {"type": "frame", "frame": _frame_to_dto(frame).model_dump()}
            )
        final_probs: dict[str, float] = {}
        if sim_result_holder["result"] is not None:
            final_probs = dict(sim_result_holder["result"].final_bitstring_probs)
        await websocket.send_json(
            {
                "type": "done",
                "n_atoms": n_atoms,
                "duration_us": duration,
                "final_t_us": final_state_frame.t_us if final_state_frame else 0.0,
                "final_bitstring_probs": final_probs,
            }
        )
    except WebSocketDisconnect:
        pass
    except Exception as e:
        with suppress(Exception):
            await websocket.send_json({"type": "error", "message": str(e)})
    finally:
        with suppress(Exception):
            await websocket.close()
        with suppress(Exception):
            await worker
