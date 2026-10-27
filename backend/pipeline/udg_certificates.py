"""
Fast NECESSARY conditions for "F is realisable as an atom array on Aquila".

Each certificate is a proof (or, for the packing constants, a measured bound)
that no placement exists under Aquila's rules — blockade graph = F exactly,
atoms >= 4 um apart, rows |dy| = 0 or >= 4 um, at most 256 atoms. They run in
milliseconds, so the UI can say "provably not embeddable" *before* (or instead
of) a placement search. They never claim a graph IS realisable.

Geometric constants (packing searches with R_b = 8.79 um, min spacing 4 um;
numerical except where noted). Smaller R_b only tightens them, so they stay
valid for any R_b <= ``GEO_RB_MAX_UM``; for a larger R_b (low Rabi frequency)
the R_b-dependent ones are skipped and only the universal tests run:

- ``D_GEO``  = 20  max atoms within R_b of one atom (21 not found; rigorous
  Oler bound is 24). Used as a max-degree test.
- ``D_HALF`` = 11  max neighbours in a half-plane — the leftmost atom of any
  UDG has all its neighbours there, so degeneracy(F) <= 11.
- ``W_GEO``  = 7   max clique with pairwise distance in [4, R_b] (8 not found).
- ``ALPHA_N``= 5   pairwise non-adjacent neighbours of one atom (classic UDG
  fact — independent of R_b and spacing).
- induced K_{2,3}: forbidden for R_b / spacing near 2.2 (numerical; holds up
  to a tolerance of ~1e-4 um in the touching limit).
- Row rule: all clique members lie within R_b of each other, so with 4 um
  spacing a row holds at most 3 atoms and at most 3 rows fit (3 rows need
  2 * 4 = 8 um, 4 rows need 12 um) while R_b < 12 um — hence clique <= 9.
  Rigorous.
"""

from __future__ import annotations

import heapq
from dataclasses import dataclass
from typing import Literal

MAX_ATOMS = 256
GEO_RB_MAX_UM = 8.79
ROW_RULE_RB_MAX_UM = 12.0
D_GEO = 20
D_HALF = 11
W_GEO = 7
W_ROWS = 9
ALPHA_N = 5

Verdict = Literal["impossible", "unknown"]


@dataclass
class CertificateResult:
    verdict: Verdict
    reason: str
    """Human-readable (Hebrew) reason when impossible, else why unknown."""
    code: str
    """Machine-readable id: too_many_atoms | max_degree | degeneracy | clique |
    clique_rows | induced_k16 | induced_k23 | none."""


def _adj_masks(n: int, edges: list[tuple[int, int]]) -> list[int]:
    adj = [0] * n
    for u, v in edges:
        if u != v:
            adj[u] |= 1 << v
            adj[v] |= 1 << u
    return adj


def _popcount(x: int) -> int:
    return x.bit_count()


def _degeneracy(n: int, adj: list[int]) -> int:
    deg = [_popcount(a) for a in adj]
    removed = [False] * n
    heap = [(deg[v], v) for v in range(n)]
    heapq.heapify(heap)
    best = 0
    while heap:
        d, v = heapq.heappop(heap)
        if removed[v] or d != deg[v]:
            continue
        removed[v] = True
        best = max(best, d)
        a = adj[v]
        while a:
            low = a & -a
            u = low.bit_length() - 1
            a ^= low
            if not removed[u]:
                deg[u] -= 1
                heapq.heappush(heap, (deg[u], u))
    return best


def _has_clique(adj: list[int], cand: int, k: int, size: int = 0) -> bool:
    """Is there a clique of k vertices extending ``size`` already-chosen ones
    inside bitmask ``cand``?"""
    if size >= k:
        return True
    if _popcount(cand) < k - size:
        return False
    c = cand
    while c:
        low = c & -c
        v = low.bit_length() - 1
        c ^= low
        if _popcount(c) + 1 < k - size:
            return False
        if _has_clique(adj, c & adj[v], k, size + 1):
            return True
    return False


def _has_independent(adj: list[int], cand: int, k: int, size: int = 0) -> bool:
    if size >= k:
        return True
    if _popcount(cand) < k - size:
        return False
    c = cand
    while c:
        low = c & -c
        v = low.bit_length() - 1
        c ^= low
        if _popcount(c) + 1 < k - size:
            return False
        if _has_independent(adj, c & ~adj[v], k, size + 1):
            return True
    return False


def certificate_check(
    n: int,
    edges: list[tuple[int, int]],
    blockade_radius_um: float = GEO_RB_MAX_UM,
) -> CertificateResult:
    """Run the certificates in cost order. ``impossible`` is a proof (modulo
    the numerical packing constants above); ``unknown`` means none fired."""
    unknown = CertificateResult("unknown", "אף תנאי הכרחי לא נפסל — ייתכן שניתן להטמעה", "none")
    if n > MAX_ATOMS:
        return CertificateResult(
            "impossible", f"{n} קודקודים — יותר מ-{MAX_ATOMS} האטומים ש-Aquila תומכת בהם", "too_many_atoms"
        )
    if not edges:
        return unknown
    adj = _adj_masks(n, edges)
    maxdeg = max(_popcount(a) for a in adj)
    geo = blockade_radius_um <= GEO_RB_MAX_UM
    rows = blockade_radius_um < ROW_RULE_RB_MAX_UM

    if geo and maxdeg > D_GEO:
        return CertificateResult(
            "impossible",
            f"דרגה מקסימלית {maxdeg} > {D_GEO}: אין מקום ליותר מ-{D_GEO} אטומים (במרחק ≥ 4 µm) בתוך רדיוס ה-blockade",
            "max_degree",
        )
    if geo:
        dg = _degeneracy(n, adj)
        if dg > D_HALF:
            return CertificateResult(
                "impossible",
                f"degeneracy {dg} > {D_HALF}: לאטום השמאלי ביותר יש שכנים רק בחצי-מישור, ושם נכנסים לכל היותר {D_HALF}",
                "degeneracy",
            )
        if _has_clique(adj, (1 << n) - 1, W_GEO + 1):
            return CertificateResult(
                "impossible",
                f"קליק בגודל {W_GEO + 1}+ ב-F: לכל היותר {W_GEO} אטומים נכנסים בו-זמנית ברדיוס ה-blockade במרחק ≥ 4 µm",
                "clique",
            )
    elif rows and _has_clique(adj, (1 << n) - 1, W_ROWS + 1):
        return CertificateResult(
            "impossible",
            f"קליק בגודל {W_ROWS + 1}+ ב-F: מגבלת השורות מאפשרת לכל היותר 3 אטומים בשורה ו-3 שורות ברדיוס ה-blockade",
            "clique_rows",
        )
    for v in range(n):
        if _popcount(adj[v]) > ALPHA_N and _has_independent(adj, adj[v], ALPHA_N + 1):
            return CertificateResult(
                "impossible",
                f"לקודקוד {v} יש {ALPHA_N + 1} שכנים שאינם שכנים זה של זה (induced K₁,{ALPHA_N + 1}) — בלתי אפשרי בגרף unit-disk",
                "induced_k16",
            )
    if geo:
        for u in range(n):
            au = adj[u]
            for v in range(u + 1, n):
                if (au >> v) & 1:
                    continue
                common = au & adj[v]
                if _popcount(common) >= 3 and _has_independent(adj, common, 3):
                    return CertificateResult(
                        "impossible",
                        f"induced K₂,₃ סביב הקודקודים {u} ו-{v}: שני קודקודים לא-שכנים עם 3 שכנים משותפים בלתי-תלויים אינם ניתנים להצבה במרחק ≥ 4 µm",
                        "induced_k23",
                    )
    return unknown
