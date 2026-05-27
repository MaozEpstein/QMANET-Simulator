"""
Aquila hardware constants — sourced verbatim from QuEra's Aquila whitepaper v1.0
(June 2023), sections 1.3 (Rydberg Hamiltonian), 1.4 (error sources), 1.5 (datasheet).

Units throughout: micrometers (um) for position, radians per microsecond (rad/us)
for frequency. This matches the whitepaper convention. Amazon Braket uses
rad/s and meters — multiply this module's values by 1e6 to convert.
"""

from __future__ import annotations

import math
from dataclasses import dataclass
from typing import Final

# =============================================================================
# Geometry constraints  (whitepaper Table §1.5)
# =============================================================================

MAX_QUBITS: Final[int] = 256
"""Maximum number of filled sites (=qubits) on Aquila."""

MAX_WIDTH_UM: Final[float] = 75.0
"""Maximum site-pattern width (x-extent of the user region)."""

MAX_HEIGHT_UM: Final[float] = 76.0
"""Maximum site-pattern height (y-extent of the user region)."""

MIN_SITE_SPACING_UM: Final[float] = 4.0
"""Minimum distance between any two user-defined sites (optical resolution)."""

MIN_ROW_SPACING_UM: Final[float] = 4.0
"""Minimum vertical spacing between rows (reservoir packing geometry)."""

# =============================================================================
# Pulse / control constraints
# =============================================================================

MAX_RABI_RAD_US: Final[float] = 15.8
"""Maximum Rabi drive amplitude Omega(t)."""

RABI_SLEW_RATE: Final[float] = 250.0
"""Maximum |dOmega/dt| in rad/us^2 (AOD response speed)."""

DETUNING_MAX_RAD_US: Final[float] = 125.0
"""Maximum |Delta(t)|."""

DETUNING_SLEW_RATE: Final[float] = 2500.0
"""
Maximum |dDelta/dt| in rad/us^2 (AOM bandwidth on the global detuning line).
Sourced from Amazon Braket's published Aquila device capabilities; the
whitepaper itself does not pin this down explicitly. Detuning has a much
faster modulator than Rabi, so this limit is ten times looser than
``RABI_SLEW_RATE`` — a piecewise-linear Δ sweep that respects the duration
budget will almost never hit it.
"""

MAX_DURATION_US: Final[float] = 4.0
"""Maximum total evolution time (coherent timescale on Aquila baseline)."""

# =============================================================================
# Rydberg interaction
# =============================================================================

C6_RAD_US_UM6: Final[float] = 5_420_503.0
"""
C6 coefficient for the 70S_{1/2} Rydberg state of Rb-87, in (rad/us) * um^6.

This is 2π × 862,690 MHz·µm⁶ — the conversion is mandatory because Omega and
Delta in this module are in rad/us (whitepaper Eq. 1). Bloqade's default is
the same value (see bloqade.analog.constants).  A spec PDF or any source that
quotes "C6 ≈ 862,000 MHz·µm⁶" refers to the *MHz* version of the same number;
do not pass it as-is to the Hamiltonian without the 2π factor.
"""


def blockade_radius_um(omega: float, delta: float = 0.0) -> float:
    """
    Rydberg blockade radius R_b = (C6 / sqrt(Omega^2 + Delta^2))^(1/6).
    Inputs in rad/us, output in um.
    """
    energy_scale = math.sqrt(omega * omega + delta * delta)
    if energy_scale <= 0.0:
        return float("inf")
    return (C6_RAD_US_UM6 / energy_scale) ** (1.0 / 6.0)


# =============================================================================
# Noise / errors  (whitepaper §1.4, §1.5)
# =============================================================================


@dataclass(frozen=True)
class NoiseModel:
    """Statistical noise model for Aquila, defaults from the whitepaper."""

    # Position
    delta_xy_um: float = 0.050
    """Systematic, pattern-dependent error between specified & actual lattice site."""

    sigma_xy_um: float = 0.200
    """Random error in qubit positions during evolution (thermal motion)."""

    # Rabi / detuning inhomogeneity (spatial, across the user region)
    rabi_inhomogeneity_rms_rel: float = 0.02
    """RMS relative Rabi frequency inhomogeneity across user region."""

    detuning_inhomogeneity_rms_rad_us: float = 0.37
    """RMS detuning inhomogeneity across user region."""

    # Shot-to-shot variance
    rabi_shot_rms_rel: float = 0.008
    """RMS relative shot-to-shot variance in Omega."""

    detuning_shot_rms_rad_us: float = 0.18
    """RMS shot-to-shot variance in Delta."""

    delta_detuning_systematic_rad_us: float = 0.63
    """Systematic error in global detuning from specified value."""

    # Filling / detection
    eps_fill: float = 0.007
    """Probability of failing to occupy a user-specified 'filled' site."""

    eps_det_false_neg: float = 0.01
    """P(mis-detect filled site as empty)."""

    eps_det_false_pos: float = 0.01
    """P(mis-detect empty site as filled)."""

    eps_det_gnd_as_ryd: float = 0.01
    """P(mis-detect ground-state atom as Rydberg)."""

    eps_det_ryd_as_gnd: float = 0.08
    """P(mis-detect Rydberg atom as ground)."""

    # Coherence times (microseconds)
    t2_star_us: float = 5.8
    """Qubit dephasing time without drive (Ramsey)."""

    t2_echo_us: float = 11.4
    """Qubit dephasing time without drive (spin-echo)."""

    t2_rabi_us: float = 7.5
    """Driven decoherence under max Rabi for individual qubits."""

    t2_blockaded_rabi_us: float = 8.9
    """Driven decoherence under max Rabi for blockaded pair."""

    t1_rydberg_us: float = 30.0
    """Rydberg-state lifetime (spontaneous decay |r⟩→|g⟩). Representative
    QuEra Aquila value (whitepaper: 70Sr Rydberg ~30–35 µs)."""


AQUILA_NOISE: Final[NoiseModel] = NoiseModel()
"""Default noise model — frozen with whitepaper values."""


# =============================================================================
# Benchmarks (whitepaper §1.5)
# =============================================================================

Z2_CORRELATION_LENGTH_SITES: Final[float] = 3.6
"""1D Z_2 phase correlation length, used by test_aquila_paper_repro."""

CHECKERBOARD_CORRELATION_LENGTH_SITES: Final[float] = 5.7
"""2D checkerboard phase correlation length."""


# =============================================================================
# Convenience accessors
# =============================================================================


@dataclass(frozen=True)
class AquilaSpec:
    """Bundle all hardware constraints for passing to validators."""

    max_qubits: int = MAX_QUBITS
    max_width_um: float = MAX_WIDTH_UM
    max_height_um: float = MAX_HEIGHT_UM
    min_site_spacing_um: float = MIN_SITE_SPACING_UM
    min_row_spacing_um: float = MIN_ROW_SPACING_UM
    max_rabi_rad_us: float = MAX_RABI_RAD_US
    rabi_slew_rate: float = RABI_SLEW_RATE
    detuning_max_rad_us: float = DETUNING_MAX_RAD_US
    detuning_slew_rate: float = DETUNING_SLEW_RATE
    max_duration_us: float = MAX_DURATION_US
    c6_rad_us_um6: float = C6_RAD_US_UM6
    noise: NoiseModel = AQUILA_NOISE


AQUILA: Final[AquilaSpec] = AquilaSpec()
"""The default Aquila spec — import this in validators, schedulers, UI."""
