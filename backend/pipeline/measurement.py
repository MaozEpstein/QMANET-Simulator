"""
Measurement model — turn a SimulationResult into a list of noisy "shots".

In the real Aquila experiment, each shot ends with a destructive image: each
site is independently read out as filled (ground) or empty (Rydberg). The
mapping is:
    image filled  → bitstring '0'  (atom remained in |g>)
    image empty   → bitstring '1'  (atom was in |r>, fled the trap)

Detection imperfections (whitepaper §1.4):
  eps_det_ryd_as_gnd ≈ 0.08   — Rydberg atom recaptured before image → "filled"
  eps_det_gnd_as_ryd ≈ 0.01   — ground atom lost between evolution and image → "empty"

Plus fill failures: a site requested by the user but never filled at all
(eps_fill ≈ 0.007). We model these as forced "filled" (= bitstring '0').
"""

from __future__ import annotations

from collections import Counter
from dataclasses import dataclass

from aquila.constants import AQUILA, AquilaSpec
from aquila.noise import apply_detection_errors, apply_fill_errors
from pipeline.simulate import SimulationResult, sample_measurements


@dataclass(frozen=True)
class MeasurementResult:
    bitstrings: tuple[str, ...]
    """One per shot, length = n_atoms."""

    histogram: dict[str, int]
    """How many shots produced each unique bitstring."""

    n_shots: int
    n_atoms: int

    def to_dict(self) -> dict:
        return {
            "bitstrings": list(self.bitstrings),
            "histogram": dict(self.histogram),
            "n_shots": self.n_shots,
            "n_atoms": self.n_atoms,
        }


def measure(
    sim: SimulationResult,
    *,
    n_shots: int = 200,
    seed: int | None = None,
    apply_noise: bool = True,
    spec: AquilaSpec = AQUILA,
) -> MeasurementResult:
    """
    Sample bitstrings from the final state and optionally apply detection /
    fill noise. This is the shot-level output a Braket user would see.
    """
    raw = sample_measurements(sim, n_shots=n_shots, seed=seed)
    if apply_noise:
        shots: list[str] = []
        for i, b in enumerate(raw):
            # Vary the per-shot seed by mixing in i so independent shots are
            # independent in the noise channel as well.
            shot_seed = None if seed is None else seed * 1_000_003 + i
            after_fill = apply_fill_errors(b, spec=spec, seed=shot_seed)
            after_det = apply_detection_errors(
                after_fill, spec=spec, seed=None if shot_seed is None else shot_seed + 1
            )
            shots.append(after_det)
    else:
        shots = list(raw)

    hist = dict(Counter(shots))
    return MeasurementResult(
        bitstrings=tuple(shots),
        histogram=hist,
        n_shots=len(shots),
        n_atoms=sim.n_atoms,
    )


def top_bitstrings(result: MeasurementResult, k: int = 10) -> list[tuple[str, int]]:
    """Sort the histogram and return the top-k (bitstring, count) pairs."""
    return sorted(result.histogram.items(), key=lambda kv: -kv[1])[:k]
