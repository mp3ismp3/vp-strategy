"""Tests for detect_fvg and _check_fvg_fill in core/indicators.py."""

import numpy as np
import pandas as pd
from datetime import datetime

from core.indicators import detect_fvg, _check_fvg_fill


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


def _make_bullish_fvg_df():
    """Create a DataFrame with a clear bullish FVG.

    Bullish FVG: candle[i-1].High < candle[i+1].Low
    We create a scenario where there's a strong gap up.
    """
    dates = pd.date_range(end=datetime.now(), periods=30, freq="B")
    # Normal range candles, then a gap up pattern at index 14-16
    np.random.seed(10)
    opens = np.full(30, 100.0)
    highs = np.full(30, 102.0)
    lows = np.full(30, 98.0)
    closes = np.full(30, 101.0)
    volumes = np.full(30, 1_000_000)

    # Create bullish FVG at bars 14,15,16:
    # bar 14: High = 101 (this is the gap_low)
    # bar 15: impulse candle (big move up)
    # bar 16: Low = 105 (this is the gap_high, must be > bar14.High)
    opens[14] = 99.0
    highs[14] = 101.0
    lows[14] = 98.5
    closes[14] = 100.5

    opens[15] = 101.0  # impulse candle
    highs[15] = 108.0
    lows[15] = 100.5
    closes[15] = 107.0

    opens[16] = 107.0
    highs[16] = 109.0
    lows[16] = 105.0  # gap_high = 105 > 101 = gap_low (bar14.High)
    closes[16] = 108.0

    # Subsequent candles stay above the gap (unfilled)
    for i in range(17, 30):
        opens[i] = 107.0 + np.random.randn() * 0.5
        highs[i] = opens[i] + 2.0
        lows[i] = opens[i] - 1.0  # lows stay above 105 (gap_high)
        closes[i] = opens[i] + 1.0

    return pd.DataFrame(
        {"Open": opens, "High": highs, "Low": lows, "Close": closes, "Volume": volumes},
        index=dates,
    )


def _make_bearish_fvg_df():
    """Create a DataFrame with a clear bearish FVG.

    Bearish FVG: candle[i-1].Low > candle[i+1].High
    We create a scenario where there's a strong gap down.
    """
    dates = pd.date_range(end=datetime.now(), periods=30, freq="B")
    opens = np.full(30, 100.0)
    highs = np.full(30, 102.0)
    lows = np.full(30, 98.0)
    closes = np.full(30, 99.0)
    volumes = np.full(30, 1_000_000)

    # Create bearish FVG at bars 14,15,16:
    # bar 14: Low = 99 (this is the gap_high)
    # bar 15: impulse candle (big move down)
    # bar 16: High = 95 (this is the gap_low, must be < bar14.Low)
    opens[14] = 101.0
    highs[14] = 102.0
    lows[14] = 99.0
    closes[14] = 99.5

    opens[15] = 99.0  # impulse candle down
    highs[15] = 99.5
    lows[15] = 92.0
    closes[15] = 93.0

    opens[16] = 93.0
    highs[16] = 95.0  # gap_low = 95 < 99 = gap_high (bar14.Low)
    lows[16] = 91.0
    closes[16] = 92.0

    # Subsequent candles stay below the gap (unfilled)
    for i in range(17, 30):
        opens[i] = 92.0 + np.random.randn() * 0.5
        highs[i] = opens[i] + 1.0  # highs stay below 95 (gap_low)
        lows[i] = opens[i] - 2.0
        closes[i] = opens[i] - 0.5

    return pd.DataFrame(
        {"Open": opens, "High": highs, "Low": lows, "Close": closes, "Volume": volumes},
        index=dates,
    )


class TestDetectFVG:
    def test_none_input(self):
        """Returns empty list for None input."""
        assert detect_fvg(None) == []

    def test_insufficient_data(self):
        """Returns empty list when not enough bars."""
        df = _make_df(5)
        assert detect_fvg(df, lookback=60) == []

    def test_empty_df(self):
        """Returns empty list for empty DataFrame."""
        df = pd.DataFrame(columns=["Open", "High", "Low", "Close", "Volume"])
        assert detect_fvg(df) == []

    def test_bullish_fvg_detected(self):
        """Detects a clear bullish FVG."""
        df = _make_bullish_fvg_df()
        # Use min_gap_atr_ratio=0 to disable ATR filtering for this controlled test
        fvgs = detect_fvg(df, lookback=30, min_gap_atr_ratio=0)
        bullish = [f for f in fvgs if f["type"] == "bullish"]
        assert len(bullish) >= 1, f"Expected bullish FVG, got: {fvgs}"

        # The FVG we created: gap_low=101 (bar14.High), gap_high=105 (bar16.Low)
        target_fvg = next(
            (f for f in bullish if abs(f["gap_low"] - 101.0) < 0.1 and abs(f["gap_high"] - 105.0) < 0.1),
            None
        )
        assert target_fvg is not None, f"Expected FVG at 101-105, got: {bullish}"
        assert target_fvg["gap_size"] == 4.0
        assert target_fvg["type"] == "bullish"

    def test_bearish_fvg_detected(self):
        """Detects a clear bearish FVG."""
        df = _make_bearish_fvg_df()
        fvgs = detect_fvg(df, lookback=30, min_gap_atr_ratio=0)
        bearish = [f for f in fvgs if f["type"] == "bearish"]
        assert len(bearish) >= 1, f"Expected bearish FVG, got: {fvgs}"

        # The FVG we created: gap_high=99 (bar14.Low), gap_low=95 (bar16.High)
        target_fvg = next(
            (f for f in bearish if abs(f["gap_high"] - 99.0) < 0.1 and abs(f["gap_low"] - 95.0) < 0.1),
            None
        )
        assert target_fvg is not None, f"Expected FVG at 95-99, got: {bearish}"
        assert target_fvg["gap_size"] == 4.0
        assert target_fvg["type"] == "bearish"

    def test_no_fvg_in_tight_range(self):
        """No FVG detected when price range is very tight and ATR filtering is on."""
        dates = pd.date_range(end=datetime.now(), periods=60, freq="B")
        # Very tight range candles with overlapping highs/lows
        opens = np.full(60, 100.0)
        highs = np.full(60, 100.5)
        lows = np.full(60, 99.5)
        closes = np.full(60, 100.0)
        volumes = np.full(60, 1_000_000)
        df = pd.DataFrame(
            {"Open": opens, "High": highs, "Low": lows, "Close": closes, "Volume": volumes},
            index=dates,
        )
        fvgs = detect_fvg(df, lookback=60, min_gap_atr_ratio=0.5)
        # Tight range should have no gaps (highs and lows overlap)
        assert len(fvgs) == 0

    def test_fvg_output_format(self):
        """Each FVG dict has all required fields."""
        df = _make_bullish_fvg_df()
        fvgs = detect_fvg(df, lookback=30, min_gap_atr_ratio=0)
        assert len(fvgs) > 0

        required_keys = {"type", "gap_high", "gap_low", "gap_size", "bar_index", "date", "filled", "fill_pct"}
        for fvg in fvgs:
            assert set(fvg.keys()) == required_keys, f"Missing keys: {required_keys - set(fvg.keys())}"
            assert fvg["type"] in ("bullish", "bearish")
            assert fvg["gap_high"] > fvg["gap_low"]
            assert fvg["gap_size"] > 0
            assert 0.0 <= fvg["fill_pct"] <= 1.0
            assert isinstance(fvg["filled"], bool)

    def test_bullish_fvg_unfilled(self):
        """Bullish FVG that stays unfilled has filled=False, fill_pct=0."""
        df = _make_bullish_fvg_df()
        fvgs = detect_fvg(df, lookback=30, min_gap_atr_ratio=0)
        bullish = [f for f in fvgs if f["type"] == "bullish" and abs(f["gap_low"] - 101.0) < 0.1]
        assert len(bullish) >= 1
        # Our test data keeps lows above 105, so gap (101-105) is unfilled
        target = bullish[0]
        assert target["filled"] is False
        assert target["fill_pct"] == 0.0

    def test_bullish_fvg_filled(self):
        """Bullish FVG that gets filled reports filled=True."""
        df = _make_bullish_fvg_df().copy()
        # Make a subsequent bar dip below gap_low (101) to fill the gap
        df.iloc[20, df.columns.get_loc("Low")] = 99.0
        fvgs = detect_fvg(df, lookback=30, min_gap_atr_ratio=0)
        bullish = [f for f in fvgs if f["type"] == "bullish" and abs(f["gap_low"] - 101.0) < 0.1]
        assert len(bullish) >= 1
        target = bullish[0]
        assert target["filled"] is True
        assert target["fill_pct"] == 1.0

    def test_atr_filtering(self):
        """Small gaps below ATR threshold are filtered out."""
        df = _make_bullish_fvg_df()
        # With a high ATR ratio, the FVG should be filtered out
        fvgs_strict = detect_fvg(df, lookback=30, min_gap_atr_ratio=100.0)
        fvgs_loose = detect_fvg(df, lookback=30, min_gap_atr_ratio=0.0)
        # Strict filtering should find fewer/no FVGs
        assert len(fvgs_strict) <= len(fvgs_loose)

    def test_random_data_no_crash(self):
        """Function handles random data without crashing."""
        df = _make_df(200, seed=123)
        fvgs = detect_fvg(df, lookback=60)
        assert isinstance(fvgs, list)
        for fvg in fvgs:
            assert fvg["type"] in ("bullish", "bearish")


class TestCheckFVGFill:
    def test_no_subsequent_prices(self):
        """Empty subsequent prices → unfilled."""
        filled, pct = _check_fvg_fill(np.array([]), 100.0, 105.0, "bullish")
        assert filled is False
        assert pct == 0.0

    def test_bullish_unfilled(self):
        """Bullish FVG with lows above gap_high → unfilled."""
        subsequent_lows = np.array([106.0, 107.0, 108.0])
        filled, pct = _check_fvg_fill(subsequent_lows, 100.0, 105.0, "bullish")
        assert filled is False
        assert pct == 0.0

    def test_bullish_partially_filled(self):
        """Bullish FVG with lows penetrating into gap → partial fill."""
        # gap: 100 to 105 (size=5). Low of 103 penetrates 2 of 5 = 40%
        subsequent_lows = np.array([106.0, 103.0, 107.0])
        filled, pct = _check_fvg_fill(subsequent_lows, 100.0, 105.0, "bullish")
        assert filled is False
        assert abs(pct - 0.4) < 0.01

    def test_bullish_fully_filled(self):
        """Bullish FVG with low reaching gap_low → fully filled."""
        subsequent_lows = np.array([106.0, 99.0, 107.0])
        filled, pct = _check_fvg_fill(subsequent_lows, 100.0, 105.0, "bullish")
        assert filled is True
        assert pct == 1.0

    def test_bearish_unfilled(self):
        """Bearish FVG with highs below gap_low → unfilled."""
        subsequent_highs = np.array([94.0, 93.0, 92.0])
        filled, pct = _check_fvg_fill(subsequent_highs, 95.0, 99.0, "bearish")
        assert filled is False
        assert pct == 0.0

    def test_bearish_partially_filled(self):
        """Bearish FVG with highs penetrating into gap → partial fill."""
        # gap: 95 to 99 (size=4). High of 97 penetrates 2 of 4 = 50%
        subsequent_highs = np.array([94.0, 97.0, 93.0])
        filled, pct = _check_fvg_fill(subsequent_highs, 95.0, 99.0, "bearish")
        assert filled is False
        assert abs(pct - 0.5) < 0.01

    def test_bearish_fully_filled(self):
        """Bearish FVG with high reaching gap_high → fully filled."""
        subsequent_highs = np.array([94.0, 100.0, 93.0])
        filled, pct = _check_fvg_fill(subsequent_highs, 95.0, 99.0, "bearish")
        assert filled is True
        assert pct == 1.0

    def test_zero_gap_size(self):
        """Zero gap size returns filled=True."""
        filled, pct = _check_fvg_fill(np.array([100.0]), 100.0, 100.0, "bullish")
        assert filled is True
        assert pct == 1.0
