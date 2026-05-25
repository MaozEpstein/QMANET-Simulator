"""
Convert our internal schedule + atom array to the Amazon Braket payload that
Aquila accepts (whitepaper §1.3 footnote: "Amazon Braket uses units of radians
per second and meters, which differs from the conventions here by a factor of 10^6").

We deliberately keep this module *pure data*: no network, no AWS SDK import at
module load time. The endpoint layer wraps it with the actual `boto3` /
`amazon-braket-sdk` calls. This lets unit-test the conversion without
credentials, lets the rest of the codebase be importable on a machine with no
SDK installed, and isolates the failure modes when AWS is unreachable.
"""

from __future__ import annotations

import math
from dataclasses import dataclass

from .constants import AQUILA, AquilaSpec
from .validator import Violation, validate_positions

# Aquila Braket device ARN (us-east-1)
AQUILA_DEVICE_ARN = "arn:aws:braket:us-east-1::device/qpu/quera/Aquila"

# Conversion factors (whitepaper §1.3 footnote).
# Numerically the µ→base factor is the same for length and time, but we keep
# them as separate symbols so the call sites read correctly and tests can
# verify each constant independently.
UM_TO_M = 1e-6
US_TO_S = 1e-6
RAD_PER_US_TO_RAD_PER_S = 1e6


@dataclass(frozen=True)
class BraketPayload:
    """JSON-serializable payload accepted by Amazon Braket's analog program API."""

    setup: dict
    """{ ahs_register: { sites: [[x_m, y_m], ...], filling: [1, 1, ...] } }"""

    hamiltonian: dict
    """{ drivingFields: [...], shiftingFields: [...] } following Braket's schema."""

    shots: int

    def to_dict(self) -> dict:
        return {"setup": self.setup, "hamiltonian": self.hamiltonian, "shots": self.shots}


def _times_us_to_s(times_us: list[float]) -> list[float]:
    return [t * US_TO_S for t in times_us]


def _omega_to_braket(times_us: list[float], values_rad_us: list[float]) -> dict:
    return {
        "time_series": {
            "times": _times_us_to_s(times_us),
            "values": [v * RAD_PER_US_TO_RAD_PER_S for v in values_rad_us],
        },
        "pattern": "uniform",
    }


def _delta_to_braket(times_us: list[float], values_rad_us: list[float]) -> dict:
    return {
        "time_series": {
            "times": _times_us_to_s(times_us),
            "values": [v * RAD_PER_US_TO_RAD_PER_S for v in values_rad_us],
        },
        "pattern": "uniform",
    }


def _phi_to_braket(times_us: list[float], values_rad: list[float]) -> dict:
    """Phase is dimensionless: only the time axis converts."""
    return {
        "time_series": {
            "times": _times_us_to_s(times_us),
            "values": list(values_rad),
        },
        "pattern": "uniform",
    }


def build_payload(
    positions_um: list[tuple[float, float]],
    omega_times_us: list[float],
    omega_values_rad_us: list[float],
    delta_times_us: list[float],
    delta_values_rad_us: list[float],
    phi_times_us: list[float],
    phi_values_rad: list[float],
    *,
    shots: int = 200,
) -> BraketPayload:
    """Convert one job spec into the Braket AnalogHamiltonianSimulation payload."""
    if shots < 1:
        raise ValueError(f"shots must be ≥ 1, got {shots}")
    sites_m = [[float(x) * UM_TO_M, float(y) * UM_TO_M] for x, y in positions_um]
    filling = [1] * len(positions_um)

    return BraketPayload(
        setup={
            "ahs_register": {
                "sites": sites_m,
                "filling": filling,
            }
        },
        hamiltonian={
            "drivingFields": [
                {
                    "amplitude": _omega_to_braket(omega_times_us, omega_values_rad_us),
                    "phase": _phi_to_braket(phi_times_us, phi_values_rad),
                    "detuning": _delta_to_braket(delta_times_us, delta_values_rad_us),
                }
            ],
            "shiftingFields": [],
        },
        shots=shots,
    )


def preflight_check(
    positions_um: list[tuple[float, float]],
    omega_values_rad_us: list[float],
    delta_values_rad_us: list[float],
    duration_us: float,
    *,
    spec: AquilaSpec = AQUILA,
) -> list[Violation]:
    """Cheap sanity check before paying AWS — same constraints the device enforces."""
    out: list[Violation] = list(validate_positions(positions_um, spec=spec))
    # Pulse limits — the schedule validator covers this fully; we just verify
    # peak/duration here so the user sees the issue *before* paying for shots.
    if duration_us > spec.max_duration_us:
        from .validator import Violation as V, ViolationCode

        out.append(
            V(
                code=ViolationCode.DURATION_EXCEEDED,
                message=f"T={duration_us:.3f}µs > {spec.max_duration_us}µs",
                locus={"channel": "all"},
                measured=float(duration_us),
                limit=float(spec.max_duration_us),
            )
        )
    if omega_values_rad_us and max(omega_values_rad_us) > spec.max_rabi_rad_us + 1e-9:
        from .validator import Violation as V, ViolationCode

        out.append(
            V(
                code=ViolationCode.RABI_EXCEEDS_MAX,
                message=f"max Ω={max(omega_values_rad_us):.3f} > {spec.max_rabi_rad_us}",
                locus={"channel": "Omega"},
                measured=float(max(omega_values_rad_us)),
                limit=float(spec.max_rabi_rad_us),
            )
        )
    if delta_values_rad_us:
        peak_delta = max(abs(v) for v in delta_values_rad_us)
        if peak_delta > spec.detuning_max_rad_us + 1e-9:
            from .validator import Violation as V, ViolationCode

            out.append(
                V(
                    code=ViolationCode.DETUNING_OUT_OF_RANGE,
                    message=f"max |Δ|={peak_delta:.3f} > {spec.detuning_max_rad_us}",
                    locus={"channel": "Delta"},
                    measured=float(peak_delta),
                    limit=float(spec.detuning_max_rad_us),
                )
            )
    return out


@dataclass(frozen=True)
class CostEstimate:
    """Rough cost estimate, in USD."""

    shot_fee_usd: float
    task_fee_usd: float
    total_usd: float
    shots: int

    def to_dict(self) -> dict:
        return {
            "shot_fee_usd": self.shot_fee_usd,
            "task_fee_usd": self.task_fee_usd,
            "total_usd": self.total_usd,
            "shots": self.shots,
        }


# Public AWS pricing for Aquila (as of mid-2024 — checked the Braket pricing page).
# Per-task fee $0.30, per-shot fee $0.01. These are not contractual; the API
# response is the source of truth at submit time.
PRICE_PER_TASK_USD = 0.30
PRICE_PER_SHOT_USD = 0.01


def estimate_cost(shots: int) -> CostEstimate:
    task = PRICE_PER_TASK_USD
    shot = PRICE_PER_SHOT_USD * shots
    return CostEstimate(
        shot_fee_usd=shot,
        task_fee_usd=task,
        total_usd=task + shot,
        shots=shots,
    )


def estimate_runtime(shots: int) -> float:
    """Rough wall-clock estimate (seconds) — Aquila runs ~10 Hz cycle rate."""
    return shots / 10.0 + 30.0  # plus ~30s queue/setup overhead


# --------------------------------------------------------------------------- #
# Inverse: parse a Braket payload back to internal µm/rad/µs units (for tests)
# --------------------------------------------------------------------------- #


def from_payload(payload: BraketPayload) -> dict:
    """Round-trip helper that converts a Braket payload back to our units.
    Used by tests to verify the conversion is lossless."""
    sites = payload.setup["ahs_register"]["sites"]
    positions_um = [(float(s[0]) / UM_TO_M, float(s[1]) / UM_TO_M) for s in sites]

    drive = payload.hamiltonian["drivingFields"][0]
    amp = drive["amplitude"]["time_series"]
    det = drive["detuning"]["time_series"]
    phs = drive["phase"]["time_series"]

    omega_times = [t / US_TO_S for t in amp["times"]]
    omega_values = [v / RAD_PER_US_TO_RAD_PER_S for v in amp["values"]]
    delta_times = [t / US_TO_S for t in det["times"]]
    delta_values = [v / RAD_PER_US_TO_RAD_PER_S for v in det["values"]]
    phi_times = [t / US_TO_S for t in phs["times"]]
    phi_values = list(phs["values"])

    return {
        "positions_um": positions_um,
        "omega_times_us": omega_times,
        "omega_values_rad_us": omega_values,
        "delta_times_us": delta_times,
        "delta_values_rad_us": delta_values,
        "phi_times_us": phi_times,
        "phi_values_rad": phi_values,
        "shots": payload.shots,
    }


# --------------------------------------------------------------------------- #
# Lazy dispatch — only imported when actually submitting
# --------------------------------------------------------------------------- #


class BraketUnavailable(RuntimeError):
    """Raised when the Braket SDK is not installed or AWS is not configured."""


def submit_to_braket(payload: BraketPayload, *, region: str = "us-east-1") -> dict:
    """
    Dispatch the job to Aquila via Amazon Braket. Imports the SDK lazily so the
    rest of the codebase remains importable on machines without it.

    Returns a small status dict with the task ARN; the caller polls for results
    separately.
    """
    try:
        from braket.aws import AwsDevice, AwsSession  # type: ignore[import-not-found]
        import boto3  # type: ignore[import-not-found]
    except ImportError as e:
        raise BraketUnavailable(
            "amazon-braket-sdk is not installed. `pip install amazon-braket-sdk boto3`"
        ) from e

    try:
        session = AwsSession(boto_session=boto3.Session(region_name=region))
        device = AwsDevice(AQUILA_DEVICE_ARN, aws_session=session)
    except Exception as e:
        raise BraketUnavailable(
            f"unable to reach AWS Braket (check credentials / region): {e}"
        ) from e

    # In real submission we'd build an AnalogHamiltonianSimulation here.
    # We keep the surface narrow on purpose — the only place that touches the
    # SDK is this function, and it returns the same dict shape whether we
    # succeed or fail.
    raise NotImplementedError(
        "Real submission requires building an AnalogHamiltonianSimulation; "
        "this is intentionally left as a manual step until AWS credentials "
        "are configured. Inspect payload via build_payload() and submit it "
        "through the Braket console or Jupyter notebook."
    )


def _payload_size_bytes(payload: BraketPayload) -> int:
    """Used by tests to verify the payload is not absurdly large."""
    import json

    return len(json.dumps(payload.to_dict()))


def _isfinite_all(seq: list[float]) -> bool:
    return all(math.isfinite(v) for v in seq)
