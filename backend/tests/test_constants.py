"""Sanity tests on the Aquila constants module."""

from __future__ import annotations

import math

import pytest

from aquila.constants import (
    AQUILA,
    AQUILA_NOISE,
    C6_RAD_US_UM6,
    MAX_RABI_RAD_US,
    blockade_radius_um,
)


def test_aquila_spec_matches_whitepaper_datasheet():
    assert AQUILA.max_qubits == 256
    assert AQUILA.max_width_um == 75.0
    assert AQUILA.max_height_um == 76.0
    assert AQUILA.min_site_spacing_um == 4.0
    assert AQUILA.max_rabi_rad_us == 15.8
    assert AQUILA.rabi_slew_rate == 250.0
    assert AQUILA.detuning_max_rad_us == 125.0
    assert AQUILA.max_duration_us == 4.0


def test_noise_model_matches_whitepaper():
    n = AQUILA_NOISE
    assert n.sigma_xy_um == 0.200
    assert n.eps_fill == 0.007
    assert n.eps_det_ryd_as_gnd == 0.08
    assert n.t2_star_us == 5.8
    assert n.t2_echo_us == 11.4


def test_blockade_radius_monotone_in_omega():
    r_low = blockade_radius_um(omega=1.0)
    r_high = blockade_radius_um(omega=15.8)
    assert r_low > r_high > 0


def test_blockade_radius_formula_at_max_rabi():
    # R_b = (C6 / Omega)^(1/6) when Delta=0
    expected = (C6_RAD_US_UM6 / MAX_RABI_RAD_US) ** (1.0 / 6.0)
    assert math.isclose(blockade_radius_um(omega=MAX_RABI_RAD_US), expected)


def test_blockade_radius_zero_omega_is_infinite():
    assert blockade_radius_um(omega=0.0, delta=0.0) == float("inf")


@pytest.mark.parametrize("omega,delta", [(15.0, 0.0), (10.0, 5.0), (5.0, 10.0)])
def test_blockade_radius_is_positive(omega, delta):
    r = blockade_radius_um(omega=omega, delta=delta)
    assert r > 0 and math.isfinite(r)
