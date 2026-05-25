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

// --------------------------------------------------------------------------- //
// Phase 2 — Embedding
// --------------------------------------------------------------------------- //

export interface EmbedConfigDTO {
  lattice_spacing_um: number;
  rabi_rad_us: number;
  detuning_rad_us: number;
  layout_seed: number;
  layout_iterations: number;
  snap_to_grid: boolean;
  rescale_to_region: boolean;
  margin_um: number;
}

export interface ViolationDTO {
  code: string;
  message: string;
  locus: Record<string, number | string>;
  measured: number;
  limit: number;
}

export interface EmbedResponse {
  positions: NodePos[];
  n_atoms: number;
  blockade_radius_um: number;
  induced_edges: [number, number][];
  embedding_fidelity: number;
  missing_edges: [number, number][];
  spurious_edges: [number, number][];
  violations: ViolationDTO[];
}

export interface EmbedRequest {
  target_graph: GraphDTO;
  config?: Partial<EmbedConfigDTO>;
}

// --------------------------------------------------------------------------- //
// Phase 3 — Schedule
// --------------------------------------------------------------------------- //

export interface PiecewiseLinearDTO {
  times: number[];
  values: number[];
}

export interface ScheduleDTO {
  omega: PiecewiseLinearDTO;
  delta: PiecewiseLinearDTO;
  phi: PiecewiseLinearDTO;
  duration: number;
}

export interface ScheduleRequest {
  preset?: string;
  preset_params?: Record<string, number>;
  omega_breakpoints?: [number, number][];
  delta_breakpoints?: [number, number][];
  phi_breakpoints?: [number, number][];
}

export interface ScheduleResponse {
  schedule: ScheduleDTO;
  violations: ViolationDTO[];
  max_omega_slew_rate: number;
}

// --------------------------------------------------------------------------- //
// Phase 4 — Simulation
// --------------------------------------------------------------------------- //

export interface SimulationFrameDTO {
  t_us: number;
  rydberg_populations: number[];
  norm: number;
}

export interface SimulateRequest {
  positions: NodePos[];
  schedule: ScheduleDTO;
  n_frames: number;
}

export interface SimulateResponse {
  frames: SimulationFrameDTO[];
  final_bitstring_probs: Record<string, number>;
  n_atoms: number;
  duration_us: number;
}

// --------------------------------------------------------------------------- //
// Phase 5 — Measurement / Post-process / SA
// --------------------------------------------------------------------------- //

export interface MeasureRequest {
  bitstring_probs: Record<string, number>;
  n_shots: number;
  apply_noise: boolean;
  seed?: number | null;
}

export interface MeasureResponse {
  bitstrings: string[];
  histogram: Record<string, number>;
  n_shots: number;
  n_atoms: number;
}

export interface PostProcessResultDTO {
  raw_bitstring: string;
  raw_size: number;
  raw_violations: number;
  after_fix_bitstring: string;
  after_fix_size: number;
  removed: number[];
  final_bitstring: string;
  final_size: number;
  added: number[];
  is_valid: boolean;
}

export interface PostProcessBatchResponse {
  results: PostProcessResultDTO[];
  summary: {
    n_shots: number;
    mean_raw_size: number;
    mean_fixed_size: number;
    mean_final_size: number;
    best_final_size: number;
  };
}

export interface SAConfigDTO {
  n_sweeps: number;
  t_initial: number;
  t_final: number;
  penalty: number;
  seed?: number | null;
}

export interface SAResponse {
  best_set: number[];
  best_size: number;
  best_energy: number;
  n_iterations: number;
  energy_trace: number[];
}

// --------------------------------------------------------------------------- //
// Phase 6 — MANET routing
// --------------------------------------------------------------------------- //

export interface RouteDTO {
  src: number;
  dst: number;
  path: number[];
  hops: number;
}

export interface RoutingResponse {
  backbone: number[];
  is_clique: boolean;
  covered_nodes: number[];
  coverage_fraction: number;
  n_reachable_pairs: number;
  mean_hops: number;
  max_hops: number;
  routes: RouteDTO[];
}

// --------------------------------------------------------------------------- //
// Phase 7 — Amazon Braket bridge
// --------------------------------------------------------------------------- //

export interface CostEstimateDTO {
  shot_fee_usd: number;
  task_fee_usd: number;
  total_usd: number;
  shots: number;
}

export interface BraketPayloadRequest {
  positions: NodePos[];
  schedule: ScheduleDTO;
  shots: number;
}

export interface BraketPayloadResponse {
  payload: Record<string, unknown>;
  cost_estimate: CostEstimateDTO;
  runtime_estimate_seconds: number;
  device_arn: string;
  preflight_violations: ViolationDTO[];
}

export interface BraketSubmitResponse {
  submitted: boolean;
  message: string;
}

export const api = {
  health: () => getJSON<{ status: string; service: string; version: string }>("/"),
  aquila: () => getJSON<AquilaSpec>("/api/aquila"),
  generateMANET: (req: MANETRequest) =>
    postJSON<MANETRequest, MANETResponse>("/api/manet/generate", req),
  complement: (graph: GraphDTO) =>
    postJSON<{ graph: GraphDTO }, MISResponse>("/api/graph/complement", { graph }),
  embed: (req: EmbedRequest) => postJSON<EmbedRequest, EmbedResponse>("/api/embed/atoms", req),
  presets: () => getJSON<{ presets: string[] }>("/api/schedule/presets"),
  schedule: (req: ScheduleRequest) =>
    postJSON<ScheduleRequest, ScheduleResponse>("/api/schedule/build", req),
  simulate: (req: SimulateRequest) =>
    postJSON<SimulateRequest, SimulateResponse>("/api/simulate/run", req),
  measure: (req: MeasureRequest) =>
    postJSON<MeasureRequest, MeasureResponse>("/api/measure", req),
  postprocess: (bitstring: string, target_graph: GraphDTO, seed?: number) =>
    postJSON<
      { bitstring: string; target_graph: GraphDTO; seed?: number },
      PostProcessResultDTO
    >("/api/postprocess", { bitstring, target_graph, seed }),
  postprocessBatch: (bitstrings: string[], target_graph: GraphDTO, seed?: number) =>
    postJSON<
      { bitstrings: string[]; target_graph: GraphDTO; seed?: number },
      PostProcessBatchResponse
    >("/api/postprocess/batch", { bitstrings, target_graph, seed }),
  classicalSA: (graph: GraphDTO, config?: Partial<SAConfigDTO>) =>
    postJSON<{ graph: GraphDTO; config?: Partial<SAConfigDTO> }, SAResponse>(
      "/api/classical/sa",
      { graph, config },
    ),
  routing: (graph: GraphDTO, backbone: number[]) =>
    postJSON<{ graph: GraphDTO; backbone: number[] }, RoutingResponse>(
      "/api/routing/build",
      { graph, backbone },
    ),
  braketPayload: (req: BraketPayloadRequest) =>
    postJSON<BraketPayloadRequest, BraketPayloadResponse>("/api/braket/payload", req),
  braketSubmit: (req: BraketPayloadRequest & { region?: string }) =>
    postJSON<BraketPayloadRequest & { region?: string }, BraketSubmitResponse>(
      "/api/braket/submit",
      req,
    ),
};
