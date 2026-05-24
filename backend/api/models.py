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
