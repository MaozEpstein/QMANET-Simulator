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
from api.models import (
    ComplementRequest,
    EmbedRequest,
    EmbedResponse,
    GraphDTO,
    MANETRequest,
    MANETResponse,
    MISResponse,
    NodePos,
    ViolationDTO,
)
from pipeline import clique_to_mis as cqm
from pipeline import manet as manet_mod
from pipeline.embedding import EmbedConfig, embed as embed_atoms

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
