"""
Search for an exact unit-disk realisation of a graph F on Aquila.

``embed_udg`` looks for atom positions whose blockade graph equals F *exactly*
and that satisfy Aquila's placement rules (>= 4 um between atoms, rows with
|dy| = 0 or >= 4 um, inside the 75x76 um region). The existing ``embedding.embed``
is a force layout snapped to a lattice — it rarely reproduces a dense F; this
is a real search, and it can tell "not found" apart from "provably impossible".

Method (what a benchmark of ~15 variants found fastest; see the benchmark notes
in the PR): many independent starts of
  1. a mixed initialisation (MDS of hop distances, BFS-midpoint, clique
     clusters, random),
  2. L-BFGS-B on a squared-hinge loss — edges pulled inside ``R_b - margin``,
     non-edges pushed outside ``R_b + margin``, atoms kept > 4.3 um apart —
     with a row-attraction weight annealed up over four stages,
  3. snap y to rows 4.1 um apart,
  4. L-BFGS-B on x only with the rows frozen,
then an exact check. Pure numpy/scipy — no compiled dependency.

The search stops on the first exact solution, on the time budget, or on a
plateau (``PLATEAU_STARTS`` starts without the best residual improving) — the
benchmark found the unsolved instances hit an identical residual floor after
thousands of starts, so a plateau is strong evidence, not proof, of "no UDG".
"""

from __future__ import annotations

import time
from dataclasses import dataclass, field
from typing import Literal

import networkx as nx
import numpy as np
from scipy.optimize import minimize

from aquila.constants import AQUILA, blockade_radius_um
from aquila.validator import validate_positions

from .clique_to_mis import Graph
from .udg_certificates import CertificateResult, certificate_check

# Atoms closer than this in the loss; the hard limit (4.0) is checked exactly.
DMIN_OPT = 4.3
ROW_UM = 4.1
OPT_MARGIN_UM = 0.25
"""Margin around R_b used while optimising (edges <= R_b - m, non-edges >= R_b + m)."""
FINAL_MARGIN_UM = 0.1
"""A placement only counts as exact if every edge is <= R_b - 0.1 and every
non-edge >= R_b + 0.1 (position-noise safety; also covers rounding to 0.1 um)."""
GRID_UM = 0.1
"""Positions are rounded to this grid (4.1 um rows are on it)."""

PLATEAU_STARTS = 300
MIN_STARTS_BEFORE_PLATEAU = 300
ANNEAL_ROW_WEIGHTS = (0.0, 0.5, 5.0, 50.0)
MAXIT_FREE = 300

Verdict = Literal["found", "not_found", "impossible"]


@dataclass
class UDGResult:
    verdict: Verdict
    reason: str
    positions: list[tuple[float, float]] | None
    """Best placement found (exact when ``verdict == "found"``), else None."""
    wrong_edges: int | None
    """Edge/non-edge disagreements of the best placement at the exact R_b."""
    violations: int | None
    """Aquila placement-rule violations of the best placement."""
    attempts: int
    elapsed_s: float
    certificate: CertificateResult | None = None
    stopped: Literal["found", "budget", "plateau", "certificate"] = "budget"
    notes: list[str] = field(default_factory=list)


def _adjacency(n: int, edges: list[tuple[int, int]]) -> np.ndarray:
    A = np.zeros((n, n), dtype=bool)
    for u, v in edges:
        if u != v:
            A[u, v] = A[v, u] = True
    return A


# --------------------------------------------------------------------------- #
# Loss
# --------------------------------------------------------------------------- #


class _Problem:
    """Pairwise-loss evaluator for one graph at one R_b (vectorised, O(n^2))."""

    def __init__(self, A: np.ndarray, r_b: float, width: float, height: float):
        self.A = A
        self.n = len(A)
        self.r_in = r_b - OPT_MARGIN_UM
        self.r_out = r_b + OPT_MARGIN_UM
        self.r_b = r_b
        self.off = ~np.eye(self.n, dtype=bool)
        self.nonedge = (~A) & self.off
        self.eye = np.eye(self.n)
        self.lo = np.array([0.25, 0.25])
        self.hi = np.array([width - 0.25, height - 0.25])

    def loss_grad(self, P: np.ndarray, lam_row: float, fixy: bool) -> tuple[float, np.ndarray]:
        D = P[:, None, :] - P[None, :, :]
        d = np.sqrt((D * D).sum(-1) + self.eye)
        pe = np.where(self.A, np.maximum(0.0, d - self.r_in), 0.0)
        pn = np.where(self.nonedge, np.maximum(0.0, self.r_out - d), 0.0)
        pm = np.where(self.A, np.maximum(0.0, DMIN_OPT - d), 0.0)
        L = float((pe**2).sum() + (pn**2).sum() + (pm**2).sum()) / 2.0
        # L is the unordered-pair sum, so dL/dP_i = sum_j 2 * pen_ij * dd_ij/dP_i.
        coef = 2.0 * (pe - pn - pm)
        G = ((coef / d)[:, :, None] * D).sum(1)
        ex = P - np.clip(P, self.lo, self.hi)
        L += float((ex**2).sum())
        G = G + 2.0 * ex
        if lam_row > 0.0:
            r = P[:, 1] - np.round(P[:, 1] / ROW_UM) * ROW_UM
            L += lam_row * float((r**2).sum())
            G[:, 1] += 2.0 * lam_row * r
        if fixy:
            G[:, 1] = 0.0
        return L, G

    def exact(self, P: np.ndarray) -> tuple[int, int]:
        """(wrong edges, violations) of ``P`` — wrong counts edges within
        R_b - FINAL_MARGIN that are missing and non-edges within R_b +
        FINAL_MARGIN; violations are spacing/row/box breaches."""
        n = self.n
        D = np.linalg.norm(P[:, None] - P[None], axis=-1)
        edge_ok = D <= self.r_b - FINAL_MARGIN_UM
        non_ok = D >= self.r_b + FINAL_MARGIN_UM
        wrong = int(((self.A & ~edge_ok) & self.off).sum() // 2) + int(
            ((self.nonedge & ~non_ok)).sum() // 2
        )
        dy = np.abs(P[:, None, 1] - P[None, :, 1])
        viol = int(((D < AQUILA.min_site_spacing_um) & self.off).sum() // 2)
        viol += int(((dy > 1e-6) & (dy < AQUILA.min_row_spacing_um) & self.off).sum() // 2)
        viol += int(
            ((P[:, 0] < 0) | (P[:, 0] > AQUILA.max_width_um) | (P[:, 1] < 0) | (P[:, 1] > AQUILA.max_height_um)).sum()
        )
        return wrong, viol


def _optimise(prob: _Problem, P0: np.ndarray) -> np.ndarray:
    """Annealed-row L-BFGS-B, snap to rows, x-only refine. Returns positions."""
    n = prob.n
    P = P0.copy()
    for lam in ANNEAL_ROW_WEIGHTS:
        def f(x: np.ndarray, lam: float = lam) -> tuple[float, np.ndarray]:
            L, G = prob.loss_grad(x.reshape(n, 2), lam, False)
            return L, G.ravel()

        P = minimize(f, P.ravel(), jac=True, method="L-BFGS-B", options={"maxiter": MAXIT_FREE}).x.reshape(n, 2)
    ymax = int((prob.hi[1]) // ROW_UM)
    y = np.clip(np.round(P[:, 1] / ROW_UM), 0, ymax) * ROW_UM

    def g(x: np.ndarray) -> tuple[float, np.ndarray]:
        Q = np.stack([x, y], axis=1)
        L, G = prob.loss_grad(Q, 0.0, True)
        return L, G[:, 0]

    x = minimize(g, P[:, 0], jac=True, method="L-BFGS-B", options={"maxiter": MAXIT_FREE}).x
    x = np.round(x / GRID_UM) * GRID_UM
    return np.stack([x, y], axis=1)


# --------------------------------------------------------------------------- #
# Initialisations
# --------------------------------------------------------------------------- #

_CENTER = np.array([AQUILA.max_width_um / 2.0, AQUILA.max_height_um / 2.0])


def _hops(A: np.ndarray) -> np.ndarray:
    G = nx.from_numpy_array(A.astype(int))
    n = len(A)
    h = np.full((n, n), np.inf)
    for s, dist in nx.all_pairs_shortest_path_length(G):
        for t, k in dist.items():
            h[s, t] = k
    fin = h[np.isfinite(h)]
    h[~np.isfinite(h)] = (fin.max() if fin.size else 1.0) + 2.0
    return h


def _init_mds(hops: np.ndarray, rng: np.random.Generator, noise: float) -> np.ndarray:
    n = len(hops)
    D = np.where(hops <= 1, 6.0, 10.0 + 6.0 * (hops - 2))
    np.fill_diagonal(D, 0.0)
    J = np.eye(n) - 1.0 / n
    w, V = np.linalg.eigh(-0.5 * J @ (D**2) @ J)
    idx = np.argsort(w)[::-1][:2]
    X = V[:, idx] * np.sqrt(np.maximum(w[idx], 0.0))
    return X + rng.normal(0.0, noise, (n, 2)) + _CENTER


def _bfs_order(A: np.ndarray, rng: np.random.Generator) -> list[int]:
    n = len(A)
    order: list[int] = []
    seen = np.zeros(n, dtype=bool)
    for s in rng.permutation(n):
        if seen[s]:
            continue
        queue = [int(s)]
        seen[s] = True
        while queue:
            u = queue.pop(0)
            order.append(u)
            nb = [int(v) for v in np.flatnonzero(A[u]) if not seen[v]]
            rng.shuffle(nb)
            for v in nb:
                seen[v] = True
                queue.append(v)
    return order


def _init_midpoint(A: np.ndarray, rng: np.random.Generator) -> np.ndarray:
    n = len(A)
    P = np.full((n, 2), np.nan)
    for u in _bfs_order(A, rng):
        placed = [v for v in np.flatnonzero(A[u]) if not np.isnan(P[v, 0])]
        if placed:
            P[u] = P[placed].mean(0) + rng.normal(0.0, 4.0, 2)
        else:
            P[u] = _CENTER + rng.uniform(-25.0, 25.0, 2)
    return P


def _init_clique(A: np.ndarray, rng: np.random.Generator, cliques: list[list[int]]) -> np.ndarray:
    n = len(A)
    P = np.full((n, 2), np.nan)
    first = True
    for i in sorted(range(len(cliques)), key=lambda i: -len(cliques[i]) + rng.uniform(0.0, 2.5)):
        c = cliques[i]
        placed = [v for v in c if not np.isnan(P[v, 0])]
        new = [v for v in c if np.isnan(P[v, 0])]
        if not new:
            continue
        if placed:
            centre = P[placed].mean(0) + rng.normal(0.0, 3.0, 2)
        else:
            centre = _CENTER + (0.0 if first else rng.uniform(-25.0, 25.0, 2))
        first = False
        ang = rng.uniform(0.0, 2.0 * np.pi) + 2.0 * np.pi * np.arange(len(new)) / len(new)
        r = 3.0 * (1.0 + 0.3 * rng.random()) * (1.4 if len(c) >= 7 else 1.0)
        P[new] = centre + r * np.stack([np.cos(ang), np.sin(ang)], axis=1)
    return P


def _init_random(n: int, rng: np.random.Generator) -> np.ndarray:
    if rng.random() < 0.5:
        s = min(60.0, 6.0 * np.sqrt(n))
        return rng.uniform(-s / 2, s / 2, (n, 2)) + _CENTER
    return rng.normal(0.0, 3.0 * np.sqrt(n), (n, 2)) + _CENTER


def _maximal_cliques(A: np.ndarray) -> list[list[int]]:
    G = nx.from_numpy_array(A.astype(int))
    return [sorted(c) for c in nx.find_cliques(G)]


# --------------------------------------------------------------------------- #
# Driver
# --------------------------------------------------------------------------- #


def embed_udg(
    target: Graph,
    rabi_rad_us: float = 15.0,
    detuning_rad_us: float = 0.0,
    time_budget_s: float = 5.0,
    seed: int = 0,
) -> UDGResult:
    """Search for an exact unit-disk placement of ``target`` (see module doc).

    ``time_budget_s`` is a hard wall-clock cap; the search also stops on the
    first exact placement and on a plateau. Certificates run first, so a
    provably impossible graph returns in milliseconds.
    """
    t0 = time.perf_counter()
    n = target.n_nodes
    r_b = blockade_radius_um(rabi_rad_us, detuning_rad_us)
    edges = [(int(u), int(v)) for u, v in target.edges]

    cert = certificate_check(n, edges, r_b)
    if cert.verdict == "impossible":
        return UDGResult(
            verdict="impossible",
            reason=cert.reason,
            positions=None,
            wrong_edges=None,
            violations=None,
            attempts=0,
            elapsed_s=time.perf_counter() - t0,
            certificate=cert,
            stopped="certificate",
        )

    A = _adjacency(n, edges)
    if n == 0:
        return UDGResult("found", "גרף ריק", [], 0, 0, 0, time.perf_counter() - t0, cert, "found")

    prob = _Problem(A, r_b, AQUILA.max_width_um, AQUILA.max_height_um)
    rng = np.random.default_rng(seed)
    hops = _hops(A)
    cliques = _maximal_cliques(A) if n <= 80 else []

    best_res = 10**9
    best_P: np.ndarray | None = None
    best_wv = (None, None)
    last_improve = 0
    attempts = 0
    stopped: Literal["found", "budget", "plateau", "certificate"] = "budget"
    deadline = t0 + time_budget_s

    while time.perf_counter() < deadline:
        kind = attempts % 5
        if kind == 0:
            P0 = _init_mds(hops, rng, 1.5 + 0.5 * (attempts // 5))
        elif kind == 1:
            P0 = _init_midpoint(A, rng)
        elif kind == 2 and cliques:
            P0 = _init_clique(A, rng, cliques)
        else:
            P0 = _init_random(n, rng)
        attempts += 1
        P = _optimise(prob, P0)
        wrong, viol = prob.exact(P)
        res = wrong + viol
        if res < best_res:
            best_res, best_P, best_wv = res, P, (wrong, viol)
            last_improve = attempts
            if res == 0:
                stopped = "found"
                break
        if attempts >= MIN_STARTS_BEFORE_PLATEAU and attempts - last_improve >= PLATEAU_STARTS:
            stopped = "plateau"
            break

    elapsed = time.perf_counter() - t0
    positions = [(float(x), float(y)) for x, y in best_P] if best_P is not None else None
    if stopped == "found" and positions is not None:
        # Authoritative hardware check — never report "found" on a placement
        # the validator would reject.
        hard = validate_positions(positions)
        if hard:
            stopped = "budget"
            best_wv = (0, len(hard))
        else:
            return UDGResult("found", f"נמצאה הטמעה מדויקת אחרי {attempts} ניסיונות", positions, 0, 0, attempts, elapsed, cert, "found")
    why = (
        f"החיפוש התייצב: {attempts} ניסיונות בלי שיפור (נותרו {best_wv[0]} קשתות שגויות, {best_wv[1]} הפרות)"
        if stopped == "plateau"
        else f"נגמר תקציב הזמן אחרי {attempts} ניסיונות (נותרו {best_wv[0]} קשתות שגויות, {best_wv[1]} הפרות)"
    )
    return UDGResult(
        verdict="not_found",
        reason=why,
        positions=positions,
        wrong_edges=best_wv[0],
        violations=best_wv[1],
        attempts=attempts,
        elapsed_s=elapsed,
        certificate=cert,
        stopped=stopped,
    )
