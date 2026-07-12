"""Tests for Accumulation Detector — daily scoring engine."""

import numpy as np
import pandas as pd
import pytest

from strategies.accumulation.detector import compute_daily_score, _compute_levels


def _make_df(n=60, base_price=100, trend=0.0, volatility=0.02,
             volume_base=1_000_000, volume_trend=0.0):
    """Generate synthetic OHLCV DataFrame."""
    np.random.seed(42)
    dates = pd.date_range("2026-01-01", periods=n, freq="B")
    closes = [base_price]
    for i in range(1, n):
        change = trend + np.random.normal(0, volatility)
        closes.append(closes[-1] * (1 + change))
    closes = np.array(closes)
    highs = closes * (1 + np.abs(np.random.normal(0, volatility / 2, n)))
    lows = closes * (1 - np.abs(np.random.normal(0, volatility / 2, n)))
    opens = (closes + lows) / 2 + np.random.normal(0, 0.5, n)
    volumes = (volume_base * (1 + np.random.normal(0, 0.3, n) + 
               np.linspace(0, volume_trend, n))).clip(100)

    return pd.DataFrame({
        "Open": opens, "High": highs, "Low": lows,
        "Close": closes, "Volume": volumes.astype(int),
    }, index=dates)


class TestComputeDailyScore:
    def test_returns_none_insufficient_data(self):
        df = _make_df(n=20)
        result = compute_daily_score(df, lookback=40)
        assert result is None

    def test_returns_dict_with_correct_keys(self):
        df = _make_df(n=60)
        result = compute_daily_score(df, lookback=40)
        assert result is not None
        assert "raw_score" in result
        assert "components" in result
        assert "support_primary" in result
        assert "support_dynamic" in result
        assert "resistance" in result

    def test_score_range(self):
        df = _make_df(n=60)
        result = compute_daily_score(df, lookback=40)
        assert 0 <= result["raw_score"] <= 21

    def test_all_components_present(self):
        df = _make_df(n=60)
        result = compute_daily_score(df, lookback=40)
        expected_keys = {"obv", "close_position", "volume_asymmetry",
                         "tightening", "buying_streak", "relative_strength", "vsa",
                         "divergence"}
        assert set(result["components"].keys()) == expected_keys

    def test_each_component_has_score_and_signal(self):
        df = _make_df(n=60)
        result = compute_daily_score(df, lookback=40)
        for name, comp in result["components"].items():
            assert "score" in comp, f"{name} missing score"
            assert "signal" in comp, f"{name} missing signal"
            if name == "divergence":
                assert -3 <= comp["score"] <= 0, f"{name} score out of range"
            else:
                assert 0 <= comp["score"] <= 3, f"{name} score out of range"

    def test_accumulation_pattern_scores_higher(self):
        """Stock with OBV rising + tight range should score higher than random."""
        # Accumulation: flat price, rising volume on up days
        np.random.seed(123)
        n = 60
        # Flat price with slight upward bias in closes
        closes = 100 + np.cumsum(np.random.choice([0.1, -0.05], n, p=[0.65, 0.35]))
        highs = closes + np.random.uniform(0.5, 1.5, n)
        lows = closes - np.random.uniform(0.5, 1.5, n)
        opens = closes - np.random.uniform(-0.5, 0.5, n)
        # Volume higher on up days
        volumes = np.where(
            np.diff(closes, prepend=closes[0]) > 0,
            1_500_000 + np.random.normal(0, 100_000, n),
            800_000 + np.random.normal(0, 100_000, n),
        ).clip(100)

        df_accum = pd.DataFrame({
            "Open": opens, "High": highs, "Low": lows,
            "Close": closes, "Volume": volumes.astype(int),
        }, index=pd.date_range("2026-01-01", periods=n, freq="B"))

        # Random stock
        df_random = _make_df(n=60)

        score_accum = compute_daily_score(df_accum, lookback=40)
        score_random = compute_daily_score(df_random, lookback=40)

        assert score_accum["raw_score"] > score_random["raw_score"]

    def test_with_spy_data(self):
        """Relative strength calculation with SPY data."""
        df = _make_df(n=60, trend=0.002)
        spy_df = _make_df(n=60, trend=0.001)
        result = compute_daily_score(df, spy_df=spy_df, lookback=40)
        assert result is not None
        assert result["components"]["relative_strength"]["score"] >= 0

    def test_zero_volume_handling(self):
        """Should not crash on zero volume."""
        df = _make_df(n=60, volume_base=0)
        df["Volume"] = 0
        result = compute_daily_score(df, lookback=40)
        # Should still return a result (scores may be 0)
        assert result is not None


class TestComputeLevels:
    def test_support_below_resistance(self):
        df = _make_df(n=60)
        sp, sd, res = _compute_levels(df, lookback=40)
        assert sp <= sd
        assert sd <= res

    def test_support_primary_is_minimum(self):
        df = _make_df(n=60)
        sp, _, _ = _compute_levels(df, lookback=40)
        assert sp <= float(df["Low"].min()) * 1.01  # Approximately the min
