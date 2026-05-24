"""
Adiabatic pulse scheduler.

A *schedule* is the time-dependent specification of Ω(t), Δ(t), φ(t) that
defines the quantum program. We represent each channel as a *piecewise-linear*
function over [0, T] given by an increasing list of breakpoint times and the
amplitude at each breakpoint. The Hamiltonian at time t is then constructed
from the linearly-interpolated values.

The presets implement the canonical protocols from the literature:
  - paper_linear_ramp:   Ebadi 2022 / Aquila whitepaper §6.1
  - bernien_2017_sweep:  Bernien et al. 2017 (Nature 551)
"""

from __future__ import annotations

import math
from dataclasses import dataclass, field

from aquila.constants import AQUILA, AquilaSpec
from aquila.validator import Violation, ViolationCode


@dataclass(frozen=True)
class PiecewiseLinear:
    """Increasing list of (t, value) breakpoints; linear interpolation between."""

    times: tuple[float, ...]
    values: tuple[float, ...]

    def __post_init__(self) -> None:
        if len(self.times) != len(self.values):
            raise ValueError("times and values must be the same length")
        if len(self.times) >= 1:
            for i in range(1, len(self.times)):
                if self.times[i] < self.times[i - 1]:
                    raise ValueError(
                        f"times must be non-decreasing; got {self.times[i - 1]} > {self.times[i]} at index {i}"
                    )

    @property
    def duration(self) -> float:
        if not self.times:
            return 0.0
        return float(self.times[-1] - self.times[0])

    def value_at(self, t: float) -> float:
        """Linear interpolation. Outside [t0, t_last] → clamps to endpoint."""
        if not self.times:
            return 0.0
        if t <= self.times[0]:
            return float(self.values[0])
        if t >= self.times[-1]:
            return float(self.values[-1])
        # Find segment
        for i in range(1, len(self.times)):
            if t <= self.times[i]:
                t0, t1 = self.times[i - 1], self.times[i]
                v0, v1 = self.values[i - 1], self.values[i]
                if t1 == t0:
                    return float(v1)  # zero-duration step
                frac = (t - t0) / (t1 - t0)
                return float(v0 + frac * (v1 - v0))
        return float(self.values[-1])

    def max_slew_rate(self) -> float:
        """Largest |Δvalue / Δtime| across all segments. Returns ∞ if any zero-duration jump occurs."""
        worst = 0.0
        for i in range(1, len(self.times)):
            dt = self.times[i] - self.times[i - 1]
            dv = self.values[i] - self.values[i - 1]
            if dt == 0:
                if dv != 0:
                    return math.inf
                continue
            rate = abs(dv) / dt
            if rate > worst:
                worst = rate
        return worst

    def to_dict(self) -> dict:
        return {"times": list(self.times), "values": list(self.values)}

    @classmethod
    def from_lists(cls, times: list[float], values: list[float]) -> PiecewiseLinear:
        return cls(tuple(float(t) for t in times), tuple(float(v) for v in values))


@dataclass(frozen=True)
class Schedule:
    omega: PiecewiseLinear
    delta: PiecewiseLinear
    phi: PiecewiseLinear

    @property
    def duration(self) -> float:
        return max(self.omega.duration, self.delta.duration, self.phi.duration)

    def to_dict(self) -> dict:
        return {
            "omega": self.omega.to_dict(),
            "delta": self.delta.to_dict(),
            "phi": self.phi.to_dict(),
            "duration": self.duration,
        }


# --------------------------------------------------------------------------- #
# Pulse-side validation (companion to validator.validate_positions)
# --------------------------------------------------------------------------- #


def validate_schedule(
    schedule: Schedule, *, spec: AquilaSpec = AQUILA
) -> list[Violation]:
    """Pulse counterpart to validate_positions."""
    out: list[Violation] = []

    # Per-channel bounds
    for t, v in zip(schedule.omega.times, schedule.omega.values, strict=False):
        if v < 0:
            out.append(
                Violation(
                    code=ViolationCode.RABI_NEGATIVE,
                    message=f"Ω={v:.3f} rad/µs at t={t:.3f}µs is negative (must be ≥ 0)",
                    locus={"t_us": t, "channel": "Omega"},
                    measured=v,
                    limit=0.0,
                )
            )
        if v > spec.max_rabi_rad_us:
            out.append(
                Violation(
                    code=ViolationCode.RABI_EXCEEDS_MAX,
                    message=f"Ω={v:.3f} rad/µs at t={t:.3f}µs exceeds {spec.max_rabi_rad_us}",
                    locus={"t_us": t, "channel": "Omega"},
                    measured=v,
                    limit=spec.max_rabi_rad_us,
                )
            )
    for t, v in zip(schedule.delta.times, schedule.delta.values, strict=False):
        if abs(v) > spec.detuning_max_rad_us:
            out.append(
                Violation(
                    code=ViolationCode.DETUNING_OUT_OF_RANGE,
                    message=f"Δ={v:.3f} rad/µs at t={t:.3f}µs out of ±{spec.detuning_max_rad_us}",
                    locus={"t_us": t, "channel": "Delta"},
                    measured=v,
                    limit=spec.detuning_max_rad_us,
                )
            )

    # Slew rate (applies to Ω; whitepaper §1.5)
    omega_slew = schedule.omega.max_slew_rate()
    if omega_slew > spec.rabi_slew_rate:
        out.append(
            Violation(
                code=ViolationCode.SLEW_RATE_EXCEEDED,
                message=(
                    f"|dΩ/dt|={omega_slew:.3f} rad/µs² exceeds {spec.rabi_slew_rate} "
                    f"(the AOD modulator can't keep up)"
                ),
                locus={"channel": "Omega"},
                measured=omega_slew if math.isfinite(omega_slew) else 1e12,
                limit=spec.rabi_slew_rate,
            )
        )

    # Duration
    if schedule.duration > spec.max_duration_us:
        out.append(
            Violation(
                code=ViolationCode.DURATION_EXCEEDED,
                message=f"Total duration {schedule.duration:.3f}µs exceeds {spec.max_duration_us}µs",
                locus={"channel": "all"},
                measured=schedule.duration,
                limit=spec.max_duration_us,
            )
        )

    return out


# --------------------------------------------------------------------------- #
# Presets
# --------------------------------------------------------------------------- #


def paper_linear_ramp(
    t_total_us: float = 4.0,
    omega_max_rad_us: float = 15.0,
    delta_initial_rad_us: float = -30.0,
    delta_final_rad_us: float = 40.0,
    ramp_up_fraction: float = 0.1,
    ramp_down_fraction: float = 0.1,
) -> Schedule:
    """
    Ebadi-2022 / Aquila §6.1 protocol:
      Ω: 0 → Ω_max → Ω_max → 0   (trapezoidal)
      Δ: Δ_i        → Δ_i  → Δ_f → Δ_f   (sweep during the plateau)
      φ: constant 0

    Defaults reproduce §6.1 exactly: T=4µs, Ω=15 rad/µs, Δ sweeps -30→40.
    """
    if not 0 < ramp_up_fraction < 0.5 or not 0 < ramp_down_fraction < 0.5:
        raise ValueError("ramp fractions must be in (0, 0.5)")
    t1 = ramp_up_fraction * t_total_us
    t2 = (1.0 - ramp_down_fraction) * t_total_us
    omega = PiecewiseLinear.from_lists(
        [0.0, t1, t2, t_total_us],
        [0.0, omega_max_rad_us, omega_max_rad_us, 0.0],
    )
    delta = PiecewiseLinear.from_lists(
        [0.0, t1, t2, t_total_us],
        [delta_initial_rad_us, delta_initial_rad_us, delta_final_rad_us, delta_final_rad_us],
    )
    phi = PiecewiseLinear.from_lists([0.0, t_total_us], [0.0, 0.0])
    return Schedule(omega=omega, delta=delta, phi=phi)


def bernien_2017_sweep(
    t_total_us: float = 4.0,
    omega_max_rad_us: float = 4.0,
    delta_initial_rad_us: float = -10.0,
    delta_final_rad_us: float = 16.0,
) -> Schedule:
    """
    Bernien-2017 protocol (Nature 551): smooth Ω rise + linear Δ sweep,
    used to prepare the Z₂ ordered phase. We approximate the Gaussian rise
    with three breakpoints (good enough for the visualizer; Phase 4 can
    interpolate finer if needed).
    """
    t1 = 0.25 * t_total_us
    t2 = 0.75 * t_total_us
    omega = PiecewiseLinear.from_lists(
        [0.0, t1, t2, t_total_us],
        [0.0, omega_max_rad_us, omega_max_rad_us, 0.0],
    )
    delta = PiecewiseLinear.from_lists(
        [0.0, t_total_us],
        [delta_initial_rad_us, delta_final_rad_us],
    )
    phi = PiecewiseLinear.from_lists([0.0, t_total_us], [0.0, 0.0])
    return Schedule(omega=omega, delta=delta, phi=phi)


def from_breakpoints(
    omega_breakpoints: list[tuple[float, float]],
    delta_breakpoints: list[tuple[float, float]],
    phi_breakpoints: list[tuple[float, float]] | None = None,
) -> Schedule:
    """Convenience: build a Schedule from raw [(t, value), ...] lists."""
    if phi_breakpoints is None:
        # default φ ≡ 0 across the duration spanned by Ω or Δ
        t_end = max(
            (omega_breakpoints[-1][0] if omega_breakpoints else 0.0),
            (delta_breakpoints[-1][0] if delta_breakpoints else 0.0),
        )
        phi_breakpoints = [(0.0, 0.0), (t_end, 0.0)]

    return Schedule(
        omega=PiecewiseLinear.from_lists(
            [t for t, _ in omega_breakpoints], [v for _, v in omega_breakpoints]
        ),
        delta=PiecewiseLinear.from_lists(
            [t for t, _ in delta_breakpoints], [v for _, v in delta_breakpoints]
        ),
        phi=PiecewiseLinear.from_lists(
            [t for t, _ in phi_breakpoints], [v for _, v in phi_breakpoints]
        ),
    )


PRESETS = {
    "paper_linear_ramp": paper_linear_ramp,
    "bernien_2017_sweep": bernien_2017_sweep,
}
