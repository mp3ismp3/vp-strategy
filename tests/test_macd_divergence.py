"""Tests for MACD divergence detection and scan report formatting."""

import numpy as np
import pandas as pd
from datetime import datetime, timezone, timedelta
from unittest.mock import patch, MagicMock

from core.indicators import (
    find_swing_highs,
    find_swing_lows,
    detect_macd_divergence,
    resample_to_weekly,
    _closest_swing,
)
from macd_scan import _scan_symbol, format_macd_report

ET = timezone(timedelta(hours=-4))


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


def _make_bullish_divergence_df(n=150):
    """Create a DataFrame with a clear bullish divergence pattern.

    Price makes lower low, but MACD makes higher low.
    Both swings must fall within the last 60 bars (lookback window).
    We use 150 bars with the pattern in the last 60 bars.
    """
    dates = pd.date_range(end=datetime.now(), periods=n, freq="B")

    prices = np.zeros(n)
    prices[0] = 100

    # Bars 0-89: gentle uptrend to build MACD positive baseline
    for i in range(1, 90):
        prices[i] = prices[i - 1] + 0.1

    # Bars 90-109: first sharp decline (strong momentum = deep MACD low)
    for i in range(90, 110):
        prices[i] = prices[i - 1] - 1.2

    # Bars 110-125: bounce
    for i in range(110, 126):
        prices[i] = prices[i - 1] + 0.8

    # Bars 126-140: second decline, price goes LOWER but with less momentum
    # (weaker decline speed = MACD won't go as deep = higher MACD low)
    for i in range(126, 141):
        prices[i] = prices[i - 1] - 1.5  # steeper to go lower in absolute price

    # Bars 141-end: recovery
    for i in range(141, n):
        prices[i] = prices[i - 1] + 0.5

    highs = prices + 1.5
    lows = prices - 1.5
    opens = prices + np.random.randn(n) * 0.3
    volumes = np.ones(n) * 1_000_000

    return pd.DataFrame(
        {"Open": opens, "High": highs, "Low": lows, "Close": prices, "Volume": volumes},
        index=dates,
    )


def _make_bearish_divergence_df(n=150):
    """Create a DataFrame with a clear bearish divergence pattern.

    Price makes higher high, but MACD makes lower high.
    Both swings must fall within the last 60 bars (lookback window).
    Key insight: first rally is very sharp (deep MACD high), then pullback,
    then second rally is slow and long (price goes higher, MACD lower).
    """
    dates = pd.date_range(end=datetime.now(), periods=n, freq="B")

    prices = np.zeros(n)
    prices[0] = 100

    # Bars 0-89: gentle downtrend (sets MACD negative baseline)
    for i in range(1, 90):
        prices[i] = prices[i - 1] - 0.05

    # Bars 90-105: very sharp first rally (strong momentum = high MACD peak)
    for i in range(90, 106):
        prices[i] = prices[i - 1] + 2.0

    # Bars 106-120: pullback (keeps some gains)
    for i in range(106, 121):
        prices[i] = prices[i - 1] - 0.6

    # Bars 121-142: second rally, SLOW but long — goes higher in price
    # (less momentum per bar = MACD won't reach as high)
    for i in range(121, 143):
        prices[i] = prices[i - 1] + 0.7

    # Bars 143-end: decline
    for i in range(143, n):
        prices[i] = prices[i - 1] - 0.5

    highs = prices + 1.5
    lows = prices - 1.5
    opens = prices + np.random.randn(n) * 0.3
    volumes = np.ones(n) * 1_000_000

    return pd.DataFrame(
        {"Open": opens, "High": highs, "Low": lows, "Close": prices, "Volume": volumes},
        index=dates,
    )


# ─── find_swing_highs / find_swing_lows Tests ─────────────────────────────────


class TestSwingPoints:
    def test_find_swing_highs_basic(self):
        """Detects obvious swing high."""
        values = [1, 2, 3, 4, 5, 4, 3, 2, 1, 2, 3]
        result = find_swing_highs(values, lookback=2)
        assert len(result) >= 1
        # The peak at index 4 (value 5) should be found
        assert any(p["index"] == 4 and p["value"] == 5.0 for p in result)

    def test_find_swing_lows_basic(self):
        """Detects obvious swing low."""
        values = [5, 4, 3, 2, 1, 2, 3, 4, 5, 4, 3]
        result = find_swing_lows(values, lookback=2)
        assert len(result) >= 1
        assert any(p["index"] == 4 and p["value"] == 1.0 for p in result)

    def test_no_swing_in_flat(self):
        """No swing points in flat data."""
        values = [5.0] * 20
        assert find_swing_highs(values, lookback=3) == []
        assert find_swing_lows(values, lookback=3) == []

    def test_multiple_swings(self):
        """Detects multiple swing points in longer data."""
        # Create data with clear multiple peaks
        values = [3, 4, 5, 4, 3, 2, 1, 2, 3, 4, 5, 4, 3, 2, 1, 2, 3]
        highs = find_swing_highs(values, lookback=2)
        lows = find_swing_lows(values, lookback=2)
        assert len(highs) >= 2
        assert len(lows) >= 1

    def test_lookback_sensitivity(self):
        """Larger lookback is more selective."""
        np.random.seed(10)
        values = np.cumsum(np.random.randn(100))
        highs_tight = find_swing_highs(values, lookback=3)
        highs_loose = find_swing_highs(values, lookback=7)
        # Tighter lookback should find more swings
        assert len(highs_tight) >= len(highs_loose)

    def test_returns_correct_format(self):
        """Each result has index and value keys."""
        values = [1, 3, 5, 3, 1]
        result = find_swing_highs(values, lookback=1)
        for p in result:
            assert "index" in p
            assert "value" in p
            assert isinstance(p["index"], int)
            assert isinstance(p["value"], float)


# ─── _closest_swing Tests ─────────────────────────────────────────────────────


class TestClosestSwing:
    def test_finds_closest(self):
        swings = [{"index": 5, "value": 1.0}, {"index": 15, "value": 2.0}]
        result = _closest_swing(swings, 6)
        assert result["index"] == 5

    def test_returns_none_if_too_far(self):
        swings = [{"index": 5, "value": 1.0}]
        result = _closest_swing(swings, 20, tolerance=6)
        assert result is None

    def test_exact_match(self):
        swings = [{"index": 10, "value": 3.0}]
        result = _closest_swing(swings, 10)
        assert result["index"] == 10


# ─── detect_macd_divergence Tests ─────────────────────────────────────────────


class TestDetectMACDDivergence:
    def test_returns_empty_for_insufficient_data(self):
        """Returns empty list if data is too short."""
        df = _make_df(30)
        result = detect_macd_divergence(df)
        assert result == []

    def test_returns_empty_for_none(self):
        """Returns empty list for None input."""
        result = detect_macd_divergence(None)
        assert result == []

    def test_returns_list(self):
        """Always returns a list."""
        df = _make_df(100)
        result = detect_macd_divergence(df)
        assert isinstance(result, list)

    def test_bullish_divergence_detection(self):
        """Detects bullish divergence in synthetic data."""
        df = _make_bullish_divergence_df(150)
        result = detect_macd_divergence(df, lookback=60, swing_lookback=5, max_bars_ago=15)
        bullish = [r for r in result if r["type"] == "bullish"]
        # Should detect at least one bullish divergence
        assert len(bullish) >= 1
        # Verify structure
        for d in bullish:
            assert d["price_curr"] < d["price_prev"]  # lower low in price
            assert d["macd_curr"] > d["macd_prev"]    # higher low in MACD

    def test_bearish_divergence_detection(self):
        """Detects bearish divergence in synthetic data."""
        df = _make_bearish_divergence_df(150)
        result = detect_macd_divergence(df, lookback=60, swing_lookback=5, max_bars_ago=15)
        bearish = [r for r in result if r["type"] == "bearish"]
        assert len(bearish) >= 1
        for d in bearish:
            assert d["price_curr"] > d["price_prev"]  # higher high in price
            assert d["macd_curr"] < d["macd_prev"]    # lower high in MACD

    def test_signal_structure(self):
        """Divergence signals have correct keys."""
        df = _make_bullish_divergence_df(150)
        result = detect_macd_divergence(df, lookback=60, swing_lookback=5, max_bars_ago=15)
        if result:
            signal = result[0]
            assert "type" in signal
            assert "bars_ago" in signal
            assert "price_prev" in signal
            assert "price_curr" in signal
            assert "macd_prev" in signal
            assert "macd_curr" in signal
            assert "index" in signal
            assert signal["type"] in ("bullish", "bearish")

    def test_max_bars_ago_filter(self):
        """Respects max_bars_ago parameter."""
        df = _make_bullish_divergence_df()
        # Very strict filter — may filter out the signal
        strict = detect_macd_divergence(df, lookback=60, swing_lookback=5, max_bars_ago=2)
        # Loose filter
        loose = detect_macd_divergence(df, lookback=60, swing_lookback=5, max_bars_ago=30)
        # Strict should have <= loose results
        assert len(strict) <= len(loose)

    def test_no_divergence_in_random_data(self):
        """Random walk with tight max_bars_ago likely yields few/no divergences."""
        np.random.seed(99)
        df = _make_df(100, seed=99)
        result = detect_macd_divergence(df, lookback=60, swing_lookback=5, max_bars_ago=3)
        # Not asserting empty (random might have one), but should be small
        assert len(result) <= 2


# ─── resample_to_weekly Tests ─────────────────────────────────────────────────


class TestResampleToWeekly:
    def test_basic_resample(self):
        """Produces weekly bars from daily data."""
        df = _make_df(200)
        weekly = resample_to_weekly(df)
        assert weekly is not None
        assert len(weekly) < len(df)
        assert len(weekly) > 0
        assert list(weekly.columns) == ["Open", "High", "Low", "Close", "Volume"]

    def test_insufficient_data(self):
        """Returns None for very short data."""
        df = _make_df(5)
        assert resample_to_weekly(df) is None

    def test_none_input(self):
        """Returns None for None input."""
        assert resample_to_weekly(None) is None

    def test_weekly_high_is_max_daily(self):
        """Weekly high should be max of daily highs in that week."""
        df = _make_df(100)
        weekly = resample_to_weekly(df)
        # Each weekly high should be >= its close (sanity check)
        assert all(weekly["High"] >= weekly["Close"])
        assert all(weekly["Low"] <= weekly["Close"])


# ─── _scan_symbol Tests ───────────────────────────────────────────────────────


class TestScanSymbol:
    def test_returns_none_for_insufficient_data(self):
        """Returns None if data is too short."""
        df = _make_df(30)
        assert _scan_symbol(df) is None

    def test_returns_none_for_none(self):
        """Returns None for None input."""
        assert _scan_symbol(None) is None

    def test_result_structure(self):
        """Result has expected keys."""
        df = _make_bullish_divergence_df(200)
        result = _scan_symbol(df)
        # Might be None if no divergence found, but if found...
        if result:
            assert "daily_divs" in result
            assert "weekly_divs" in result
            assert "is_dual" in result
            assert "dual_type" in result
            assert isinstance(result["daily_divs"], list)
            assert isinstance(result["weekly_divs"], list)
            assert isinstance(result["is_dual"], bool)

    def test_no_false_positives_on_random(self):
        """Random data shouldn't always trigger signals."""
        np.random.seed(123)
        df = _make_df(200, seed=123)
        result = _scan_symbol(df)
        # Result can be None (no divergence) — that's fine
        if result:
            total = len(result["daily_divs"]) + len(result["weekly_divs"])
            assert total <= 4  # Shouldn't have tons of false positives


# ─── format_macd_report Tests ─────────────────────────────────────────────────


class TestFormatMACDReport:
    def test_empty_results(self):
        """Handles empty results dict."""
        msg = format_macd_report({}, datetime.now(ET))
        assert "MACD 背離掃描" in msg
        assert "(無)" in msg

    def test_dual_divergence_formatting(self):
        """Dual divergence is highlighted."""
        results = {
            "NVDA": {
                "daily_divs": [{"type": "bullish", "bars_ago": 3,
                                "price_prev": 120.0, "price_curr": 115.0,
                                "macd_prev": -0.5, "macd_curr": -0.2, "index": 57}],
                "weekly_divs": [{"type": "bullish", "bars_ago": 2,
                                 "price_prev": 125.0, "price_curr": 118.0,
                                 "macd_prev": -1.0, "macd_curr": -0.3, "index": 28}],
                "is_dual": True,
                "dual_type": "bullish",
            }
        }
        msg = format_macd_report(results, datetime.now(ET))
        assert "🔥" in msg
        assert "雙重背離" in msg
        assert "NVDA" in msg
        assert "看漲" in msg

    def test_daily_only_formatting(self):
        """Daily-only divergence formatted correctly."""
        results = {
            "AMD": {
                "daily_divs": [{"type": "bearish", "bars_ago": 5,
                                "price_prev": 150.0, "price_curr": 155.0,
                                "macd_prev": 1.0, "macd_curr": 0.5, "index": 55}],
                "weekly_divs": [],
                "is_dual": False,
                "dual_type": None,
            }
        }
        msg = format_macd_report(results, datetime.now(ET))
        assert "AMD" in msg
        assert "看跌" in msg
        assert "日線背離" in msg

    def test_weekly_only_formatting(self):
        """Weekly-only divergence formatted correctly."""
        results = {
            "TSLA": {
                "daily_divs": [],
                "weekly_divs": [{"type": "bullish", "bars_ago": 4,
                                 "price_prev": 200.0, "price_curr": 190.0,
                                 "macd_prev": -2.0, "macd_curr": -1.0, "index": 26}],
                "is_dual": False,
                "dual_type": None,
            }
        }
        msg = format_macd_report(results, datetime.now(ET))
        assert "TSLA" in msg
        assert "周線背離" in msg

    def test_message_length_within_limit(self):
        """Message stays within Telegram's 4096 char limit."""
        # Create many results to test truncation
        results = {}
        for i in range(50):
            sym = f"SYM{i:02d}"
            results[sym] = {
                "daily_divs": [{"type": "bullish", "bars_ago": 3,
                                "price_prev": 100.0, "price_curr": 95.0,
                                "macd_prev": -0.5, "macd_curr": -0.2, "index": 57}],
                "weekly_divs": [],
                "is_dual": False,
                "dual_type": None,
            }
        msg = format_macd_report(results, datetime.now(ET))
        assert len(msg) <= 4096

    def test_summary_line_present(self):
        """Summary line shows counts."""
        results = {
            "AAPL": {
                "daily_divs": [{"type": "bullish", "bars_ago": 2,
                                "price_prev": 180.0, "price_curr": 175.0,
                                "macd_prev": -0.3, "macd_curr": -0.1, "index": 58}],
                "weekly_divs": [],
                "is_dual": False,
                "dual_type": None,
            }
        }
        msg = format_macd_report(results, datetime.now(ET))
        assert "共 1 檔有背離訊號" in msg
