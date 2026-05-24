"""
Aquila noise sampling — converts the whitepaper §1.4 noise model into a per-shot
perturbation that can be applied before running the simulator.

Each shot can have:
  - random position offsets (thermal motion, σ ≈ 0.2 µm per axis)
  - shot-to-shot Δ shift (≈ 0.18 rad/µs std)
  - shot-to-shot Ω scaling (≈ 0.8% relative)
  - measurement errors applied to the sampled bitstrings:
        * a Rydberg state is mis-read as ground with probability eps_det_ryd_as_gnd ≈ 0.08
        * a ground state is mis-read as Rydberg with probability eps_det_gnd_as_ryd ≈ 0.01

Multi-shot statistics from a *noisy* simulator therefore look like real Aquila
output. These transformations are isolated here so we can A/B with the noiseless
simulator easily.
"""

from __future__ import annotations

from dataclasses import dataclass

import numpy as np

from .constants import AQUILA, AquilaSpec, NoiseModel


@dataclass(frozen=True)
class NoiseSample:
    """One shot's worth of noise perturbations."""

    position_offsets_um: list[tuple[float, float]]
    delta_offset_rad_us: float
    omega_scale: float
    """Multiplicative factor for Ω (≈ 1.0 ± rabi_shot_rms)."""


def sample_noise(
    n_atoms: int,
    *,
    model: NoiseModel | None = None,
    seed: int | None = None,
) -> NoiseSample:
    """Draw one shot's worth of perturbations from the Aquila noise model."""
    m = model or AQUILA.noise
    rng = np.random.default_rng(seed)
    pos_offsets = [
        (
            float(rng.normal(0.0, m.sigma_xy_um)),
            float(rng.normal(0.0, m.sigma_xy_um)),
        )
        for _ in range(n_atoms)
    ]
    return NoiseSample(
        position_offsets_um=pos_offsets,
        delta_offset_rad_us=float(rng.normal(0.0, m.detuning_shot_rms_rad_us)),
        omega_scale=float(1.0 + rng.normal(0.0, m.rabi_shot_rms_rel)),
    )


def apply_position_noise(
    positions: list[tuple[float, float]],
    noise: NoiseSample,
) -> list[tuple[float, float]]:
    """positions[i] + noise.position_offsets_um[i]."""
    out: list[tuple[float, float]] = []
    for (x, y), (dx, dy) in zip(positions, noise.position_offsets_um, strict=True):
        out.append((x + dx, y + dy))
    return out


def apply_detection_errors(
    bitstring: str,
    *,
    spec: AquilaSpec = AQUILA,
    seed: int | None = None,
) -> str:
    """
    Flip each bit according to the asymmetric detection error model:
        '0' → '1' with prob eps_det_gnd_as_ryd
        '1' → '0' with prob eps_det_ryd_as_gnd
    """
    m = spec.noise
    rng = np.random.default_rng(seed)
    out: list[str] = []
    for ch in bitstring:
        if ch == "1":
            if rng.random() < m.eps_det_ryd_as_gnd:
                out.append("0")
            else:
                out.append("1")
        else:
            if rng.random() < m.eps_det_gnd_as_ryd:
                out.append("1")
            else:
                out.append("0")
    return "".join(out)


def apply_fill_errors(
    bitstring: str,
    *,
    spec: AquilaSpec = AQUILA,
    seed: int | None = None,
) -> str:
    """Drop sites that fail to load (set to '0' regardless of true state).

    In real Aquila, fill failures cause whole sites to be missing from the
    image; for our simplified model we treat them as forced-ground readout
    so post-selection happens naturally downstream.
    """
    m = spec.noise
    rng = np.random.default_rng(seed)
    return "".join("0" if rng.random() < m.eps_fill else ch for ch in bitstring)
