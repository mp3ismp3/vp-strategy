"""Tests for core/vp_multitf.py — VP Multi-Timeframe Analysis."""

import numpy as np
import pandas as pd
import pytest

from core.vp_multitf import (
    compute_vp_multitf,
    resample_to_weekly,
    resample_to_monthly,
    _price_position,
    _price_position_pct,
)


def _make_daily_df(n=252, base_price=100.0, seed=42):
    """Create synthetic daily OHLCV DataFrame."""
    rng = np.random.default_rng(seed)
    dates = pd.date_range("2025-01-01", periods=n, freq="B")
    prices = base_price + np.cumsum(rng.normal(0, 1, n))
    prices = np.maximum(prices, 10)  # keep positive

    df = pd.DataFrame({
        "Open": prices + rng.uniform(-1, 1, n),
        "High": prices + rng.uniform(0.5, 3, n),
        "Low": prices - rng.uniform(0.5, 3, n),
        "Close": prices,
        "Volume": rng.integers(1_000_000, 10_000_000, n),
    }, index=dates)
    return df


class TestResample:
    def test_resample_to_weekly(self):
        df = _make_daily_df(100)
        weekly = resample_to_weekly(df)
        assert len(weekly) > 0
        assert len(weekly) < len(df)
        assert "Open" in weekly.columns
        assert "Volume" in weekly.columns
        # Weekly high should be >= any daily high in that week
        assert weekly["High"].max() <= df["High"].max() + 0.01

    def test_resample_to_monthly(self):
        df = _make_daily_df(252)
        monthly = resample_to_monthly(df)
        assert len(monthly) > 0
        assert len(monthly) <= 13  # ~12 months in a year
        assert "Close" in monthly.columns


class TestPricePosition:
    def test_above_va(self):
        assert _price_position(110, 90, 100) == "above_va"

    def test_below_va(self):
        assert _price_position(80, 90, 100) == "below_va"

    def test_inside_va(self):
        assert _price_position(95, 90, 100) == "inside_va"

    def test_at_boundary_vah(self):
        assert _price_position(100, 90, 100) == "inside_va"

    def test_at_boundary_val(self):
        assert _price_position(90, 90, 100) == "inside_va"

    def test_position_pct_middle(self):
        assert _price_position_pct(95, 90, 100) == 50.0

    def test_position_pct_at_val(self):
        assert _price_position_pct(90, 90, 100) == 0.0

    def test_position_pct_at_vah(self):
        assert _price_position_pct(100, 90, 100) == 100.0

    def test_position_pct_above(self):
        assert _price_position_pct(110, 90, 100) == 200.0

    def test_position_pct_below(self):
        assert _price_position_pct(80, 90, 100) == -100.0

    def test_position_pct_equal_val_vah(self):
        # Edge case: VAL == VAH
        assert _price_position_pct(100, 100, 100) == 50.0


class TestComputeVpMultitf:
    def test_returns_none_for_short_data(self):
        df = _make_daily_df(30)
        result = compute_vp_multitf(df)
        assert result is None

    def test_returns_dict_with_required_keys(self):
        df = _make_daily_df(252)
        result = compute_vp_multitf(df)
        assert result is not None
        assert "price" in result
        assert "daily" in result
        assert "weekly" in result
        assert "monthly" in result

    def test_daily_has_vp_fields(self):
        df = _make_daily_df(252)
        result = compute_vp_multitf(df)
        daily = result["daily"]
        assert "poc" in daily
        assert "vah" in daily
        assert "val" in daily
        assert "position" in daily
        assert "position_pct" in daily
        assert "histogram" in daily

    def test_vah_greater_than_val(self):
        df = _make_daily_df(252)
        result = compute_vp_multitf(df)
        for tf in ["daily", "weekly", "monthly"]:
            if result[tf]:
                assert result[tf]["vah"] >= result[tf]["val"]

    def test_poc_between_val_and_vah(self):
        df = _make_daily_df(252)
        result = compute_vp_multitf(df)
        for tf in ["daily", "weekly", "monthly"]:
            if result[tf]:
                assert result[tf]["val"] <= result[tf]["poc"] <= result[tf]["vah"]

    def test_position_valid_values(self):
        df = _make_daily_df(252)
        result = compute_vp_multitf(df)
        valid = {"above_va", "inside_va", "below_va"}
        for tf in ["daily", "weekly", "monthly"]:
            if result[tf]:
                assert result[tf]["position"] in valid

    def test_histogram_has_100_bins(self):
        df = _make_daily_df(252)
        result = compute_vp_multitf(df)
        hist = result["daily"]["histogram"]
        assert len(hist["prices"]) == 100
        assert len(hist["volumes"]) == 100

    def test_histogram_volumes_non_negative(self):
        df = _make_daily_df(252)
        result = compute_vp_multitf(df)
        hist = result["daily"]["histogram"]
        assert all(v >= 0 for v in hist["volumes"])

    def test_price_matches_last_close(self):
        df = _make_daily_df(252)
        result = compute_vp_multitf(df)
        assert result["price"] == round(float(df["Close"].iloc[-1]), 2)

    def test_none_input(self):
        result = compute_vp_multitf(None)
        assert result is None

    def test_custom_va_pct(self):
        df = _make_daily_df(252)
        result_68 = compute_vp_multitf(df, va_pct=0.68)
        result_80 = compute_vp_multitf(df, va_pct=0.80)
        # Wider VA pct should produce wider VA
        va_width_68 = result_68["daily"]["vah"] - result_68["daily"]["val"]
        va_width_80 = result_80["daily"]["vah"] - result_80["daily"]["val"]
        assert va_width_80 >= va_width_68
