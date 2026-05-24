/** Typed fetch wrappers around the FastAPI backend. */

export interface AquilaSpec {
  max_qubits: number;
  max_width_um: number;
  max_height_um: number;
  min_site_spacing_um: number;
  min_row_spacing_um: number;
  max_rabi_rad_us: number;
  rabi_slew_rate: number;
  detuning_max_rad_us: number;
  max_duration_us: number;
  c6_rad_us_um6: number;
  noise: Record<string, number>;
}

const API_BASE = "";

async function getJSON<T>(path: string): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`);
  if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
  return (await res.json()) as T;
}

async function postJSON<TReq, TRes>(path: string, body: TReq): Promise<TRes> {
  const res = await fetch(`${API_BASE}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
  return (await res.json()) as TRes;
}

export interface NodePos {
  id: number;
  x: number;
  y: number;
}

export interface GraphDTO {
  n_nodes: number;
  edges: [number, number][];
  node_positions: NodePos[] | null;
}

export interface MANETRequest {
  n_nodes: number;
  box_size: number;
  comm_radius: number;
  seed: number | null;
}

export interface MANETResponse {
  graph: GraphDTO;
  config: MANETRequest;
}

export interface MISResponse {
  graph: GraphDTO;
  complement: GraphDTO;
  max_clique_in_G: number[];
  mis_in_complement: number[];
  size: number;
}

export const api = {
  health: () => getJSON<{ status: string; service: string; version: string }>("/"),
  aquila: () => getJSON<AquilaSpec>("/api/aquila"),
  generateMANET: (req: MANETRequest) =>
    postJSON<MANETRequest, MANETResponse>("/api/manet/generate", req),
  complement: (graph: GraphDTO) =>
    postJSON<{ graph: GraphDTO }, MISResponse>("/api/graph/complement", { graph }),
};
