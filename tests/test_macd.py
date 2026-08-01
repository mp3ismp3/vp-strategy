"""Tests for calc_macd in core/indicators.py."""

import numpy as np
import pandas as pd
from datetime import datetime

from core.indicators import calc_macd


def _make_df(n=100, base_price=100, seed=42):
    """Create a synthetic OHLCV DataFrame."""
    dates = pd.date_range(end=datetime.now(), periods=n, freq="B")
    np.random.seed(seed)
    closes = base_price + np.cumsum(np.random.randn(n) * 1.5)
    highs = closes + np.abs(np.random.randn(n)) * 2
    lows = closes - np.abs(np.random.randn(n)) * 2
    opens = closes + np.random.randn(n) * 0.5
    volumes = (1_000_000 * (1 + np.random.rand(n))).astype(int)
    return pd.DataFrame(
        {"Open": opens, "High": highs, "Low": lows, "Close": closes, "Volume": volumes},
        index=dates,
    )


class TestCalcMACD:
    def test_basic_output(self):
        """calc_macd returns DataFrame with correct columns."""
        df = _make_df(100)
        result = calc_macd(df)
        assert result is not None
        assert list(result.columns) == ["macd", "signal", "histogram"]
        assert len(result) == len(df)

    def test_histogram_equals_macd_minus_signal(self):
        """Histogram should be MACD - Signal."""
        df = _make_df(100)
        result = calc_macd(df)
        diff = result["macd"] - result["signal"] - result["histogram"]
        assert np.allclose(diff.values, 0, atol=1e-10)

    def test_insufficient_data(self):
        """Returns None when not enough data."""
        df = _make_df(30)  # needs 26+9=35 bars minimum
        assert calc_macd(df) is None

    def test_none_input(self):
        """Returns None for None input."""
        assert calc_macd(None) is None

    def test_exact_minimum_data(self):
        """Works with exactly slow+signal bars."""
        df = _make_df(35)  # 26+9=35
        result = calc_macd(df)
        assert result is not None
        assert len(result) == 35

    def test_custom_parameters(self):
        """Works with non-default parameters."""
        df = _make_df(100)
        result = calc_macd(df, fast=8, slow=21, signal=5)
        assert result is not None
        assert len(result) == 100

    def test_index_preserved(self):
        """Result index matches input DataFrame index."""
        df = _make_df(100)
        result = calc_macd(df)
        assert result.index.equals(df.index)

    def test_trending_up_macd_positive(self):
        """In a strong uptrend, MACD should be mostly positive at the end."""
        dates = pd.date_range(end=datetime.now(), periods=80, freq="B")
        # Strong uptrend
        closes = 100 + np.arange(80) * 2.0
        df = pd.DataFrame({
            "Open": closes - 0.5,
            "High": closes + 1,
            "Low": closes - 1,
            "Close": closes,
            "Volume": np.ones(80) * 1_000_000,
        }, index=dates)
        result = calc_macd(df)
        # Last 10 MACD values should all be positive
        assert all(result["macd"].iloc[-10:] > 0)

    def test_trending_down_macd_negative(self):
        """In a strong downtrend, MACD should be mostly negative at the end."""
        dates = pd.date_range(end=datetime.now(), periods=80, freq="B")
        closes = 200 - np.arange(80) * 2.0
        df = pd.DataFrame({
            "Open": closes + 0.5,
            "High": closes + 1,
            "Low": closes - 1,
            "Close": closes,
            "Volume": np.ones(80) * 1_000_000,
        }, index=dates)
        result = calc_macd(df)
        assert all(result["macd"].iloc[-10:] < 0)

    def test_flat_market_macd_near_zero(self):
        """In a flat market, MACD should be near zero."""
        dates = pd.date_range(end=datetime.now(), periods=80, freq="B")
        np.random.seed(99)
        # Flat with tiny noise
        closes = 100 + np.random.randn(80) * 0.01
        df = pd.DataFrame({
            "Open": closes,
            "High": closes + 0.01,
            "Low": closes - 0.01,
            "Close": closes,
            "Volume": np.ones(80) * 1_000_000,
        }, index=dates)
        result = calc_macd(df)
        assert all(abs(result["macd"].iloc[-10:]) < 0.1)

    def test_no_nan_in_output(self):
        """Output should not contain NaN values."""
        df = _make_df(100)
        result = calc_macd(df)
        assert not result.isna().any().any()
