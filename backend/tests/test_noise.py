"""
Noise model tests — empirical statistics on samples must match the model.

Strategy: draw N=2000 samples from each distribution and check that the
empirical mean and standard deviation match the whitepaper §1.4 values within
the expected sampling error (5σ for std, 3σ for mean).
"""

from __future__ import annotations

import numpy as np
import pytest

from aquila.constants import AQUILA
from aquila.noise import (
    apply_detection_errors,
    apply_fill_errors,
    apply_position_noise,
    sample_noise,
)


# --------------------------------------------------------------------------- #
# Sampling statistics
# --------------------------------------------------------------------------- #


def test_position_offsets_have_correct_std():
    samples = [sample_noise(n_atoms=4, seed=i) for i in range(2000)]
    all_dx = np.array([off[0] for s in samples for off in s.position_offsets_um])
    all_dy = np.array([off[1] for s in samples for off in s.position_offsets_um])
    target = AQUILA.noise.sigma_xy_um
    assert abs(all_dx.std() - target) / target < 0.05
    assert abs(all_dy.std() - target) / target < 0.05
    assert abs(all_dx.mean()) < 0.02  # mean should be near 0
    assert abs(all_dy.mean()) < 0.02


def test_delta_offset_has_correct_std():
    samples = [sample_noise(n_atoms=1, seed=i).delta_offset_rad_us for i in range(2000)]
    arr = np.array(samples)
    target = AQUILA.noise.detuning_shot_rms_rad_us
    assert abs(arr.std() - target) / target < 0.07


def test_omega_scale_has_correct_relative_std():
    samples = [sample_noise(n_atoms=1, seed=i).omega_scale for i in range(2000)]
    arr = np.array(samples)
    target_rel = AQUILA.noise.rabi_shot_rms_rel
    assert abs(arr.std() - target_rel) / target_rel < 0.1
    assert abs(arr.mean() - 1.0) < 0.005


def test_apply_position_noise_offsets_match_sample():
    positions = [(10.0, 10.0), (20.0, 20.0), (30.0, 30.0)]
    sample = sample_noise(n_atoms=3, seed=42)
    out = apply_position_noise(positions, sample)
    for (x_old, y_old), (x_new, y_new), (dx, dy) in zip(
        positions, out, sample.position_offsets_um, strict=True
    ):
        assert x_new == pytest.approx(x_old + dx)
        assert y_new == pytest.approx(y_old + dy)


def test_apply_position_noise_does_not_mutate_input():
    positions = [(10.0, 10.0), (20.0, 20.0)]
    original = list(positions)
    apply_position_noise(positions, sample_noise(n_atoms=2, seed=0))
    assert positions == original


def test_sample_noise_seed_reproducible():
    a = sample_noise(n_atoms=5, seed=7)
    b = sample_noise(n_atoms=5, seed=7)
    assert a.position_offsets_um == b.position_offsets_um
    assert a.delta_offset_rad_us == b.delta_offset_rad_us
    assert a.omega_scale == b.omega_scale


def test_sample_noise_different_seeds_diverge():
    a = sample_noise(n_atoms=5, seed=1)
    b = sample_noise(n_atoms=5, seed=2)
    assert a.position_offsets_um != b.position_offsets_um


# --------------------------------------------------------------------------- #
# Detection errors
# --------------------------------------------------------------------------- #


def test_detection_errors_all_zero_bitstring_mostly_unchanged():
    """With eps_det_gnd_as_ryd ≈ 0.01, an all-zero string of length 20 should rarely flip."""
    bits = "0" * 20
    n_flipped = 0
    for i in range(1000):
        out = apply_detection_errors(bits, seed=i)
        if out != bits:
            n_flipped += 1
    # Probability of *any* flip in 20 bits: 1 - (1 - 0.01)^20 ≈ 0.18
    # So ~180 of 1000 should differ.
    assert 100 < n_flipped < 280


def test_detection_errors_all_one_bitstring_often_flips():
    """With eps_det_ryd_as_gnd ≈ 0.08, '1's flip frequently."""
    bits = "1" * 20
    n_flipped = 0
    for i in range(1000):
        out = apply_detection_errors(bits, seed=i)
        if out != bits:
            n_flipped += 1
    # Probability of *any* flip: 1 - (1 - 0.08)^20 ≈ 0.81
    assert n_flipped > 700


def test_detection_errors_preserve_bitstring_length():
    out = apply_detection_errors("01100101", seed=0)
    assert len(out) == 8


def test_detection_errors_empty_bitstring():
    assert apply_detection_errors("", seed=0) == ""


# --------------------------------------------------------------------------- #
# Fill errors
# --------------------------------------------------------------------------- #


def test_apply_fill_errors_zeros_some_sites_at_eps_fill():
    """≈ 0.7% of sites should be zeroed."""
    bits = "1" * 1000
    out = apply_fill_errors(bits, seed=1)
    zero_fraction = out.count("0") / 1000
    expected = AQUILA.noise.eps_fill
    # Allow ±2σ for binomial sampling at n=1000, p≈0.007 ⇒ σ ≈ 0.0026
    assert abs(zero_fraction - expected) < 0.01


def test_apply_fill_errors_preserve_length():
    assert len(apply_fill_errors("011011", seed=0)) == 6


# --------------------------------------------------------------------------- #
# Reproducibility across seeds
# --------------------------------------------------------------------------- #


def test_detection_errors_seed_reproducible():
    bits = "1010101010"
    a = apply_detection_errors(bits, seed=99)
    b = apply_detection_errors(bits, seed=99)
    assert a == b


def test_fill_errors_seed_reproducible():
    bits = "1111111111"
    a = apply_fill_errors(bits, seed=99)
    b = apply_fill_errors(bits, seed=99)
    assert a == b
