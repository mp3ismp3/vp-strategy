"""Tests for strategies."""

import numpy as np
import pandas as pd
from datetime import datetime
from strategies.vp_signals import VPSignals
from strategies.inst_trend import calc_institutional_trend, _market_structure, _liquidity_sweep, _volume_confirmation, _vwap_bias


def make_df(n=100, base_price=100):
    dates = pd.date_range(end=datetime.now(), periods=n, freq="B")
    np.random.seed(42)
    closes = base_price + np.cumsum(np.random.randn(n) * 1.5)
    highs = closes + np.abs(np.random.randn(n)) * 2
    lows = closes - np.abs(np.random.randn(n)) * 2
    opens = closes + np.random.randn(n) * 0.5
    volumes = (1_000_000 * (1 + np.random.rand(n))).astype(int)
    return pd.DataFrame({"Open": opens, "High": highs, "Low": lows, "Close": closes, "Volume": volumes}, index=dates)


def make_trending_df(n=100, direction="up"):
    """Create a clearly trending DataFrame."""
    dates = pd.date_range(end=datetime.now(), periods=n, freq="B")
    np.random.seed(42)
    trend = 0.5 if direction == "up" else -0.5
    closes = 100 + np.cumsum(np.random.randn(n) * 0.5 + trend)
    highs = closes + np.abs(np.random.randn(n)) * 1
    lows = closes - np.abs(np.random.randn(n)) * 1
    opens = closes - trend * 0.3
    volumes = (1_000_000 * (1 + np.random.rand(n))).astype(int)
    return pd.DataFrame({"Open": opens, "High": highs, "Low": lows, "Close": closes, "Volume": volumes}, index=dates)


class TestVPSignals:
    def test_insufficient_data(self):
        s = VPSignals()
        df = make_df(10)
        df.attrs["symbol"] = "TEST"
        assert s.detect(df, {"vp_lookback": 60, "va_pct": 0.68, "atr_len": 14, "vol_ma_len": 21, "max_sl_atr": 3.0, "long_only": False}, {}) == []

    def test_returns_signals(self):
        """VP strategy should detect signals when conditions are met (Failed Auction scenario)."""
        s = VPSignals()
        df = make_df(200)
        df.attrs["symbol"] = "TEST"
        cfg = {"vp_lookback": 60, "va_pct": 0.68, "atr_len": 14, "vol_ma_len": 21, "max_sl_atr": 3.0, "long_only": False}

        # Create a Failed Auction LONG: prev close below VAL, today reclaim above VAL
        from core.indicators import calc_vp, calc_atr
        vp = calc_vp(df, cfg["vp_lookback"], cfg["va_pct"])
        if vp:
            val = vp["val"]
            # Set prev bar: close below VAL
            df.iloc[-2, df.columns.get_loc("Close")] = val - 2
            df.iloc[-2, df.columns.get_loc("Low")] = val - 3
            df.iloc[-2, df.columns.get_loc("High")] = val - 0.5
            # Set today: bullish close above VAL with high volume
            df.iloc[-1, df.columns.get_loc("Open")] = val - 1
            df.iloc[-1, df.columns.get_loc("Close")] = val + 2
            df.iloc[-1, df.columns.get_loc("Low")] = val - 1.5
            df.iloc[-1, df.columns.get_loc("High")] = val + 3
            df.iloc[-1, df.columns.get_loc("Volume")] = int(df["Volume"].mean() * 2)

        result = s.detect(df, cfg, {})
        assert len(result) > 0
        assert result[0].ticker == "TEST"
        assert result[0].strategy.startswith("VP:")
        assert result[0].signal_type in ("VA Rejection", "Failed Auction", "Breakout Retest")


class TestInstitutionalTrend:
    def test_bullish_trend(self):
        df = make_trending_df(100, "up")
        result = calc_institutional_trend(df)
        assert result["direction"] in ("BULLISH", "NEUTRAL")
        assert result["score"] >= 0

    def test_bearish_trend(self):
        df = make_trending_df(100, "down")
        result = calc_institutional_trend(df)
        assert result["direction"] in ("BEARISH", "NEUTRAL")
        assert result["score"] <= 0

    def test_returns_all_components(self):
        df = make_df(100)
        result = calc_institutional_trend(df)
        assert "direction" in result
        assert "score" in result
        assert "components" in result
        assert "market_structure" in result["components"]
        assert "liquidity_sweep" in result["components"]
        assert "volume_confirm" in result["components"]
        assert "vwap_bias" in result["components"]

    def test_market_structure(self):
        assert _market_structure(make_df(50)) in ("bullish", "bearish", "neutral")

    def test_volume_confirmation(self):
        assert _volume_confirmation(make_df(20)) in ("bullish", "bearish", "neutral")

    def test_vwap_bias(self):
        assert _vwap_bias(make_df(60)) in ("bullish", "bearish", "neutral")
