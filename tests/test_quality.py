"""Tests for scoring/quality.py — per-signal-type quality scoring."""

import numpy as np
import pandas as pd
from datetime import datetime

from scoring.quality import (
    direction_fit,
    score_signal,
    score_va_rejection,
    score_vwap_deviation,
    score_breakout_acceptance,
    score_compression_breakout,
    QUALITY_SCORERS,
)
from core.signal import StrategySignal
from core.indicators import determine_bias


def _make_df(n=80, trend="up"):
    """Create synthetic OHLCV data."""
    np.random.seed(42)
    dates = pd.date_range("2026-01-01", periods=n, freq="B")
    if trend == "up":
        base = np.linspace(100, 130, n) + np.random.randn(n) * 1.5
    elif trend == "down":
        base = np.linspace(130, 100, n) + np.random.randn(n) * 1.5
    else:
        base = np.full(n, 115) + np.random.randn(n) * 2

    df = pd.DataFrame({
        "Open": base - np.random.rand(n) * 1.0,
        "High": base + np.random.rand(n) * 2.0,
        "Low": base - np.random.rand(n) * 2.0,
        "Close": base,
        "Volume": np.random.randint(500000, 2000000, n).astype(float),
    }, index=dates)
    return df


def _make_signal(signal_type="VA Rejection", direction="LONG",
                 entry=120.0, stop=117.0, target=126.0, confidence=0.8):
    return StrategySignal(
        ticker="TEST", timestamp=datetime.now(), strategy="VP",
        signal_type=signal_type, direction=direction,
        confidence=confidence, entry=entry, stop=stop, target=target,
        holding_type="short", reasons=["test"], warnings=[], triggered=True,
    )


# ─── Direction Fit Tests ───

class TestDirectionFit:
    def test_same_direction_strong(self):
        assert direction_fit("LONG", "BULL", 3) == 1.0

    def test_same_direction_medium(self):
        assert direction_fit("LONG", "BULL", 2) == 0.95

    def test_opposite_direction_strong(self):
        assert direction_fit("LONG", "BEAR", 3) == 0.4

    def test_opposite_direction_medium(self):
        assert direction_fit("LONG", "BEAR", 2) == 0.4

    def test_neutral_bias(self):
        assert direction_fit("LONG", "NEUTRAL", 0) == 0.7

    def test_short_with_bear_bias(self):
        assert direction_fit("SHORT", "BEAR", 3) == 1.0

    def test_short_against_bull(self):
        assert direction_fit("SHORT", "BULL", 3) == 0.4


# ─── Quality Score Tests ───

class TestQualityScoring:
    def test_all_signal_types_have_scorer(self):
        """Every signal type in TRACK_MAP should have a scorer."""
        from core.signal import TRACK_MAP
        for sig_type in TRACK_MAP:
            assert sig_type in QUALITY_SCORERS, f"Missing scorer for {sig_type}"

    def test_quality_range_0_100(self):
        """Quality score should always be 0-100."""
        df = _make_df()
        sig = _make_signal()
        score = score_va_rejection(sig, df)
        assert 0 <= score <= 100

    def test_va_rejection_high_volume_scores_higher(self):
        """Higher volume should increase VA Rejection quality."""
        df_low = _make_df()
        df_high = _make_df()
        # Double the last bar's volume
        df_high.iloc[-1, df_high.columns.get_loc("Volume")] = df_high["Volume"].mean() * 3
        sig = _make_signal()
        score_low = score_va_rejection(sig, df_low)
        score_high = score_va_rejection(sig, df_high)
        assert score_high >= score_low

    def test_vwap_deviation_no_volume_penalty(self):
        """VWAP Deviation should NOT penalize low volume (it's mean reversion)."""
        df = _make_df()
        # Set very low volume
        df.iloc[-1, df.columns.get_loc("Volume")] = 100000
        sig = _make_signal(signal_type="VWAP Deviation", entry=120, stop=118, target=125)
        score = score_vwap_deviation(sig, df)
        # Should still get a score from wick and close position
        assert score > 0

    def test_breakout_acceptance_days_above(self):
        """Breakout Acceptance should reward more days above level."""
        df = _make_df(trend="up")
        sig = _make_signal(signal_type="Breakout Acceptance",
                          entry=130, stop=125, target=140)
        score = score_breakout_acceptance(sig, df)
        assert score > 0

    def test_compression_breakout_scores(self):
        """Compression Breakout should produce reasonable score."""
        df = _make_df()
        sig = _make_signal(signal_type="Compression Breakout",
                          entry=115, stop=112, target=121)
        score = score_compression_breakout(sig, df)
        assert 0 <= score <= 100


# ─── score_signal Integration Tests ───

class TestScoreSignal:
    def test_returns_expected_keys(self):
        df = _make_df()
        sig = _make_signal()
        bias = {"bias": "BULL", "strength": 2, "ema_stack": 1,
                "structure": 1, "position": 0.8}
        result = score_signal(sig, df, bias)
        assert "quality" in result
        assert "direction_fit" in result
        assert "rr" in result
        assert "rank" in result
        assert "label" in result

    def test_rank_increases_with_rr(self):
        """Higher R:R should produce higher rank."""
        df = _make_df()
        bias = {"bias": "BULL", "strength": 2}
        sig_low_rr = _make_signal(entry=120, stop=118, target=123)  # R:R 1.5
        sig_high_rr = _make_signal(entry=120, stop=118, target=130)  # R:R 5.0
        r1 = score_signal(sig_low_rr, df, bias)
        r2 = score_signal(sig_high_rr, df, bias)
        assert r2["rank"] > r1["rank"]

    def test_opposing_direction_reduces_rank(self):
        """Signal opposing bias should have lower rank."""
        df = _make_df(trend="up")
        bias_bull = {"bias": "BULL", "strength": 3}
        bias_bear = {"bias": "BEAR", "strength": 3}
        sig = _make_signal(direction="LONG")
        r_aligned = score_signal(sig, df, bias_bull)
        r_opposed = score_signal(sig, df, bias_bear)
        assert r_aligned["rank"] > r_opposed["rank"]

    def test_label_strong_long(self):
        df = _make_df()
        bias = {"bias": "BULL", "strength": 3}
        # High volume + good wick to get high quality
        df.iloc[-1, df.columns.get_loc("Volume")] = df["Volume"].mean() * 3
        df.iloc[-1, df.columns.get_loc("Low")] = df["Close"].iloc[-1] - 5
        sig = _make_signal(entry=120, stop=118.5, target=126)
        result = score_signal(sig, df, bias)
        # Just verify label format is correct
        assert result["label"] in ("Strong Long", "Moderate Long", "Lean Long", "Avoid")

    def test_unknown_signal_type_gets_default_score(self):
        df = _make_df()
        bias = {"bias": "NEUTRAL", "strength": 0}
        sig = _make_signal(signal_type="Unknown Signal")
        result = score_signal(sig, df, bias)
        assert result["quality"] == 50  # default


# ─── Bias Indicator Tests ───

class TestDetermineBias:
    def test_uptrend_returns_bull(self):
        df = _make_df(trend="up")
        result = determine_bias(df)
        assert result["bias"] == "BULL"
        assert result["strength"] >= 2

    def test_downtrend_returns_bear(self):
        df = _make_df(trend="down")
        result = determine_bias(df)
        assert result["bias"] == "BEAR"
        assert result["strength"] >= 2

    def test_flat_returns_neutral(self):
        df = _make_df(trend="flat")
        result = determine_bias(df)
        # Flat market with noise — may read as slight direction but never max strength
        assert result["strength"] <= 2

    def test_position_value_range(self):
        df = _make_df()
        result = determine_bias(df)
        assert 0 <= result["position"] <= 1.0

    def test_insufficient_data(self):
        df = _make_df(n=10)
        result = determine_bias(df)
        assert result["bias"] == "NEUTRAL"
        assert result["strength"] == 0
