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
    ComplementRequest,
    EmbedRequest,
    EmbedResponse,
    GraphDTO,
    MANETRequest,
    MANETResponse,
    MISResponse,
    NodePos,
    PiecewiseLinearDTO,
    ScheduleDTO,
    ScheduleRequest,
    ScheduleResponse,
    SimulateRequest,
    SimulateResponse,
    SimulationFrameDTO,
    ViolationDTO,
)
from pipeline import clique_to_mis as cqm
from pipeline import manet as manet_mod
from pipeline.embedding import EmbedConfig, embed as embed_atoms
from pipeline.schedule import (
    PRESETS,
    PiecewiseLinear,
    Schedule,
    from_breakpoints,
    validate_schedule,
)
from pipeline.simulate import SimulationFrame, simulate

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
    if g.n_nodes <= cqm.EXACT_MIS_MAX_NODES:
        try:
            max_clique = cqm.max_clique(g)
        except ValueError as e:
            raise HTTPException(status_code=422, detail=str(e)) from e

    return MISResponse(
        graph=_graph_to_dto(g),
        complement=_graph_to_dto(gbar),
        max_clique_in_G=max_clique,
        mis_in_complement=max_clique,
        size=len(max_clique),
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

    def on_frame(frame: SimulationFrame) -> None:
        # Called from the simulator's worker thread. Schedule put() on the loop.
        asyncio.run_coroutine_threadsafe(queue.put(frame), loop)

    def run_simulator() -> None:
        try:
            schedule = _schedule_from_dto(req.schedule)
            positions = [(p.x, p.y) for p in req.positions]
            simulate(schedule, positions, n_frames=req.n_frames, on_frame=on_frame)
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
        await websocket.send_json(
            {
                "type": "done",
                "n_atoms": n_atoms,
                "duration_us": duration,
                "final_t_us": final_state_frame.t_us if final_state_frame else 0.0,
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
