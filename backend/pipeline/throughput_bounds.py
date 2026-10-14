"""
Classical throughput bounds on the conflict graph F (Jain, Padhye,
Padmanabhan & Qiu, MobiCom 2003, §4).

Question answered: if every link (vertex of F) must receive the same rate x,
with unit link capacity, what is the largest achievable x?

    1/χ(F)  ≤  x* = 1/χ_f(F)  ≤  1/ω(F)

- Upper bound (clique constraint, a *necessary* condition): the links of any
  clique pairwise conflict, so they time-share the medium — |C|·x ≤ 1. Any
  clique gives a valid bound; the maximum clique gives the tightest one.
- Lower bound (independent-set schedule, a *sufficient* condition): a proper
  k-coloring is a TDMA frame of k slots (each color class is an independent
  set), so every link gets x = 1/k. Any coloring gives a valid bound.
- Exact value: the optimal time-sharing over *all* independent sets is the
  fractional chromatic number, LP:  min Σ_I y_I  s.t.  Σ_{I∋v} y_I ≥ 1.
  We solve it by column generation, where the pricing subproblem is
  maximum-*weight* independent set with the LP duals as weights — the same
  problem a Rydberg array solves natively, which is why this LP is the
  natural classical baseline for the quantum pipeline.
"""

from __future__ import annotations

import time
from dataclasses import dataclass, field

import networkx as nx
import numpy as np
from scipy.optimize import linprog

from .clique_to_mis import Graph, to_networkx

# Exact ω on F and the coloring heuristics are cheap on the sparse-ish
# conflict graphs this app produces; past this size the endpoint declines.
BOUNDS_MAX_VERTICES = 260

# Exact MWIS pricing (branch-and-bound clique search on F̄) is the only
# exponential step. Above this size column generation runs on the greedy
# pricer alone and the LP value is reported as a bound, not certified exact.
EXACT_PRICING_MAX_VERTICES = 60

CG_TIME_BUDGET_S = 4.0
CG_MAX_ITERATIONS = 400
_PRICE_EPS = 1e-7
_WEIGHT_SCALE = 1_000_000

_COLORING_STRATEGIES = (
    "saturation_largest_first",
    "largest_first",
    "smallest_last",
    "independent_set",
    "connected_sequential_bfs",
)


@dataclass
class TimeShareSlot:
    links: list[int]
    fraction: float
    """Share of the TDMA frame this independent set is active (sums to 1)."""


@dataclass
class ThroughputBounds:
    n_vertices: int
    omega: int
    max_clique: list[int]
    chi: int
    """Colors used by the best coloring found — an upper bound on χ(F)."""
    chi_exact: bool
    """True when the coloring provably uses χ(F) colors (it matches ω)."""
    coloring: list[int]
    coloring_strategy: str
    chi_f: float
    """Σy of the best LP time-share schedule found — an upper bound on χ_f."""
    chi_f_lower: float
    """Certified lower bound on χ_f (max of ω and the Lagrangian bound)."""
    chi_f_exact: bool
    lp_schedule: list[TimeShareSlot] = field(default_factory=list)
    lp_iterations: int = 0
    lp_columns: int = 0
    exact_pricing: bool = False

    @property
    def lower_bound(self) -> float:
        return 1.0 / self.chi if self.chi else 1.0

    @property
    def lp_bound(self) -> float:
        return 1.0 / self.chi_f if self.chi_f else 1.0

    @property
    def upper_bound(self) -> float:
        return 1.0 / self.omega if self.omega else 1.0


def max_clique_exact(G: nx.Graph) -> list[int]:
    if G.number_of_nodes() == 0:
        return []
    clique, _ = nx.max_weight_clique(G, weight=None)
    return sorted(int(v) for v in clique)


def best_coloring(G: nx.Graph) -> tuple[list[int], str]:
    """Fewest-colors proper coloring over several greedy strategies.
    Returns (color per vertex, winning strategy name)."""
    n = G.number_of_nodes()
    if n == 0:
        return [], "none"
    best: dict[int, int] | None = None
    best_name = ""
    for strategy in _COLORING_STRATEGIES:
        c = nx.coloring.greedy_color(G, strategy=strategy)
        if best is None or max(c.values()) < max(best.values()):
            best, best_name = c, strategy
    assert best is not None
    return [int(best[v]) for v in range(n)], best_name


def _extend_to_maximal(adj: list[set[int]], members: set[int], order: list[int]) -> set[int]:
    s = set(members)
    blocked = set().union(*(adj[v] for v in s)) if s else set()
    for v in order:
        if v not in s and v not in blocked:
            s.add(v)
            blocked |= adj[v]
    return s


def _greedy_mwis(adj: list[set[int]], weights: np.ndarray) -> tuple[set[int], float]:
    """Best of a few greedy weighted-IS passes — fast pricing heuristic."""
    n = len(adj)
    deg = np.array([len(a) for a in adj], dtype=float)
    keys = (weights, weights / (deg + 1.0))
    best_set: set[int] = set()
    best_val = -1.0
    for key in keys:
        order = sorted(range(n), key=lambda v: -key[v])
        s: set[int] = set()
        blocked: set[int] = set()
        for v in order:
            if weights[v] <= 0 or v in s or v in blocked:
                continue
            s.add(v)
            blocked |= adj[v]
        val = float(sum(weights[v] for v in s))
        if val > best_val:
            best_set, best_val = s, val
    return best_set, best_val


def _exact_mwis(Fbar: nx.Graph, weights: np.ndarray) -> tuple[set[int], float]:
    for v in Fbar.nodes:
        Fbar.nodes[v]["w"] = int(round(max(0.0, weights[v]) * _WEIGHT_SCALE))
    clique, _ = nx.max_weight_clique(Fbar, weight="w")
    s = {int(v) for v in clique}
    return s, float(sum(weights[v] for v in s))


def _solve_master(columns: list[frozenset[int]], n: int):
    A = np.zeros((n, len(columns)))
    for j, col in enumerate(columns):
        for v in col:
            A[v, j] = 1.0
    res = linprog(
        c=np.ones(len(columns)),
        A_ub=-A,
        b_ub=-np.ones(n),
        bounds=(0, None),
        method="highs",
    )
    if res.status != 0:
        raise RuntimeError(f"LP master problem failed: {res.message}")
    duals = -np.asarray(res.ineqlin.marginals, dtype=float)
    return float(res.fun), np.asarray(res.x, dtype=float), np.clip(duals, 0.0, None)


@dataclass
class ConvergencePoint:
    calls: int
    """MWIS oracle calls (pricing rounds) made so far — the Effort axis."""
    time_ms: float
    """Cumulative wall-clock time including master LP solves."""
    lp_value: float
    """Σy of the restricted master LP — an upper bound on χ_f."""
    lower: float
    """Throughput lower bound 1/lp_value: the current schedule is feasible."""
    upper: float
    """Best certified throughput upper bound: min(1/ω, Lagrangian bound)."""
    added: list[int] | None
    """Independent set added after this call; None for the start and final points."""
    pricer: str
    """'start', 'greedy' or 'exact' — which oracle answered this call."""


@dataclass
class ColumnGenerationResult:
    value: float
    certified_lower: float
    exact: bool
    schedule: list[TimeShareSlot]
    iterations: int
    n_columns: int
    exact_pricing: bool
    history: list[ConvergencePoint]
    stop_reason: str
    """'optimal' | 'no_improving_column' | 'time_budget' | 'iteration_cap'."""


def fractional_chromatic(
    G: nx.Graph,
    initial_sets: list[set[int]],
    omega: int,
    *,
    extend_initial: bool = True,
    time_budget_s: float = CG_TIME_BUDGET_S,
    exact_pricing_max: int = EXACT_PRICING_MAX_VERTICES,
) -> ColumnGenerationResult:
    """Column generation for χ_f(G), recording one convergence point per
    MWIS oracle call. ``extend_initial=False`` keeps the initial sets as
    given (e.g. singletons, to start the curve near zero like Jain et al.
    Fig 5) instead of growing them to maximal independent sets."""
    t0 = time.perf_counter()
    elapsed_ms = lambda: (time.perf_counter() - t0) * 1000.0  # noqa: E731
    n = G.number_of_nodes()
    adj = [set(int(u) for u in G.neighbors(v)) for v in range(n)]
    natural = list(range(n))
    columns: list[frozenset[int]] = []
    seen: set[frozenset[int]] = set()
    for s in initial_sets:
        col = frozenset(_extend_to_maximal(adj, s, natural) if extend_initial else s)
        if col not in seen:
            seen.add(col)
            columns.append(col)

    use_exact = n <= exact_pricing_max
    Fbar = nx.complement(G) if use_exact else None
    deadline = time.monotonic() + time_budget_s
    lower = float(omega)
    exact = False
    calls = 0

    value, y, duals = _solve_master(columns, n)
    history = [
        ConvergencePoint(0, elapsed_ms(), value, 1.0 / value, 1.0 / omega, None, "start")
    ]
    stop_reason = "iteration_cap"

    while calls < CG_MAX_ITERATIONS:
        if time.monotonic() >= deadline:
            stop_reason = "time_budget"
            break
        calls += 1
        cand, price = _greedy_mwis(adj, duals)
        pricer = "greedy"
        if price <= 1.0 + _PRICE_EPS and use_exact:
            assert Fbar is not None
            cand, price = _exact_mwis(Fbar, duals)
            pricer = "exact"
            # Weak duality: duals/price is dual-feasible, so χ_f ≥ value/price.
            lower = max(lower, value / max(price, 1.0))
        if price <= 1.0 + _PRICE_EPS:
            if pricer == "exact":
                exact = True
                lower = value
                stop_reason = "optimal"
            else:
                stop_reason = "no_improving_column"
            history.append(
                ConvergencePoint(calls, elapsed_ms(), value, 1.0 / value, 1.0 / lower, None, pricer)
            )
            break
        col = frozenset(_extend_to_maximal(adj, cand, sorted(natural, key=lambda v: -duals[v])))
        if col in seen:
            stop_reason = "no_improving_column"
            break
        seen.add(col)
        columns.append(col)
        value, y, duals = _solve_master(columns, n)
        history.append(
            ConvergencePoint(
                calls, elapsed_ms(), value, 1.0 / value, 1.0 / lower, sorted(col), pricer
            )
        )

    total = float(y.sum()) or 1.0
    schedule = [
        TimeShareSlot(links=sorted(columns[j]), fraction=float(y[j] / total))
        for j in np.argsort(-y)
        if y[j] > 1e-9
    ]
    return ColumnGenerationResult(
        value=value,
        certified_lower=min(lower, value),
        exact=exact,
        schedule=schedule,
        iterations=calls,
        n_columns=len(columns),
        exact_pricing=use_exact,
        history=history,
        stop_reason=stop_reason,
    )


def convergence_trace(
    f: Graph, start: str = "singletons"
) -> tuple[int, ColumnGenerationResult]:
    """Effort curve for F (Jain et al. Fig 5 style). ``start='singletons'``
    begins with one set per link (lower bound 1/n, near zero);
    ``start='coloring'`` begins from the best greedy coloring (1/χ).
    Returns (ω, result). Raises ValueError above BOUNDS_MAX_VERTICES."""
    n = f.n_nodes
    if n == 0:
        raise ValueError("Conflict graph is empty.")
    if n > BOUNDS_MAX_VERTICES:
        raise ValueError(
            f"Convergence trace supported up to {BOUNDS_MAX_VERTICES} conflict-graph "
            f"vertices (got {n})."
        )
    G = to_networkx(f)
    omega = len(max_clique_exact(G))
    if start == "coloring":
        coloring, _ = best_coloring(G)
        classes: dict[int, set[int]] = {}
        for v, c in enumerate(coloring):
            classes.setdefault(c, set()).add(v)
        initial, extend = list(classes.values()), True
    else:
        initial, extend = [{v} for v in range(n)], False
    return omega, fractional_chromatic(G, initial, omega, extend_initial=extend)


def compute_throughput_bounds(f: Graph) -> ThroughputBounds:
    """All three bounds for conflict graph F. Raises ValueError above
    BOUNDS_MAX_VERTICES."""
    n = f.n_nodes
    if n > BOUNDS_MAX_VERTICES:
        raise ValueError(
            f"Throughput bounds supported up to {BOUNDS_MAX_VERTICES} conflict-graph "
            f"vertices (got {n})."
        )
    if n == 0:
        return ThroughputBounds(
            n_vertices=0, omega=0, max_clique=[], chi=0, chi_exact=True, coloring=[],
            coloring_strategy="none", chi_f=0.0, chi_f_lower=0.0, chi_f_exact=True,
        )

    G = to_networkx(f)
    clique = max_clique_exact(G)
    omega = len(clique)
    coloring, strategy = best_coloring(G)
    chi = max(coloring) + 1

    classes: dict[int, set[int]] = {}
    for v, c in enumerate(coloring):
        classes.setdefault(c, set()).add(v)
    if chi == omega:
        # The coloring already meets the clique bound, so all three coincide
        # and the coloring itself is an optimal time-share schedule.
        chi_f = chi_f_lower = float(omega)
        chi_f_exact, iters, n_cols, exact_pricing = True, 0, chi, False
        schedule = [
            TimeShareSlot(links=sorted(classes[c]), fraction=1.0 / chi) for c in sorted(classes)
        ]
    else:
        cg = fractional_chromatic(G, list(classes.values()), omega)
        chi_f, chi_f_lower, chi_f_exact = cg.value, cg.certified_lower, cg.exact
        schedule, iters, n_cols, exact_pricing = (
            cg.schedule, cg.iterations, cg.n_columns, cg.exact_pricing
        )

    return ThroughputBounds(
        n_vertices=n,
        omega=omega,
        max_clique=clique,
        chi=chi,
        chi_exact=chi == omega,
        coloring=coloring,
        coloring_strategy=strategy,
        chi_f=chi_f,
        chi_f_lower=chi_f_lower,
        chi_f_exact=chi_f_exact,
        lp_schedule=schedule,
        lp_iterations=iters,
        lp_columns=n_cols,
        exact_pricing=exact_pricing,
    )
