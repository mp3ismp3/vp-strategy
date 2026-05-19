"""Tests for Trend Following Strategy."""

import numpy as np
import pandas as pd
import pytest
from strategies.trend_signals import TrendSignals


def _make_df(n=80, trend=0.0):
    np.random.seed(42)
    dates = pd.date_range("2026-01-01", periods=n, freq="B")
    close = 100.0 + np.cumsum(np.random.randn(n) * 0.5 + trend)
    high = close + np.random.rand(n) * 2
    low = close - np.random.rand(n) * 2
    open_ = close + np.random.randn(n) * 0.3
    volume = np.random.randint(1_000_000, 10_000_000, n)
    df = pd.DataFrame({"Open": open_, "High": high, "Low": low, "Close": close, "Volume": volume}, index=dates)
    df.attrs["symbol"] = "TEST"
    return df


def _cfg():
    return {"vp_lookback": 60, "va_pct": 0.68, "atr_len": 14, "vol_ma_len": 21, "max_sl_atr": 3.0, "long_only": False}


def test_breakout_acceptance():
    """Force a Donchian breakout scenario with strict acceptance."""
    # Use flat data so we fully control the Donchian level
    np.random.seed(99)
    n = 80
    dates = pd.date_range("2026-01-01", periods=n, freq="B")
    # All bars at price ~100, range ~2
    close = np.full(n, 100.0)
    high = np.full(n, 101.0)
    low = np.full(n, 99.0)
    open_ = np.full(n, 100.0)
    volume = np.full(n, 1_000_000)

    df = pd.DataFrame({"Open": open_, "High": high, "Low": low, "Close": close, "Volume": volume}, index=dates)
    df.attrs["symbol"] = "TEST"

    # iloc[-2]: breakout bar — High sets new Donchian upper, Close above it
    df.iloc[-2, df.columns.get_loc("High")] = 105
    df.iloc[-2, df.columns.get_loc("Close")] = 106
    df.iloc[-2, df.columns.get_loc("Low")] = 105      # Low holds above Donchian upper
    df.iloc[-2, df.columns.get_loc("Open")] = 105

    # iloc[-1]: today — continues above, high volume
    df.iloc[-1, df.columns.get_loc("High")] = 108
    df.iloc[-1, df.columns.get_loc("Close")] = 107
    df.iloc[-1, df.columns.get_loc("Open")] = 105
    df.iloc[-1, df.columns.get_loc("Low")] = 105
    df.iloc[-1, df.columns.get_loc("Volume")] = 5_000_000

    strategy = TrendSignals()
    signals = strategy.detect(df, _cfg(), {"vix": 18})
    breakouts = [s for s in signals if s.signal_type == "Breakout Acceptance"]
    assert len(breakouts) >= 1
    assert breakouts[0].holding_type == "long"
    assert breakouts[0].direction == "LONG"


def test_compression_breakout():
    """Force ATR compression then expansion."""
    df = _make_df(80, trend=0.0)
    # Compress bars before last
    for i in range(-15, -1):
        df.iloc[i, df.columns.get_loc("High")] = df.iloc[i]["Close"] + 0.1
        df.iloc[i, df.columns.get_loc("Low")] = df.iloc[i]["Close"] - 0.1
    # Expand last bar
    df.iloc[-1, df.columns.get_loc("High")] = df.iloc[-1]["Close"] + 10
    df.iloc[-1, df.columns.get_loc("Low")] = df.iloc[-1]["Close"] - 1
    df.iloc[-1, df.columns.get_loc("Open")] = df.iloc[-1]["Close"] - 0.5

    strategy = TrendSignals()
    signals = strategy.detect(df, _cfg(), {"vix": 18})
    comp = [s for s in signals if s.signal_type == "Compression Breakout"]
    assert len(comp) >= 1
    assert comp[0].holding_type == "mid"


def test_no_signal_flat_market():
    """Flat market should not trigger trend signals easily."""
    df = _make_df(80, trend=0.0)
    strategy = TrendSignals()
    signals = strategy.detect(df, _cfg(), {"vix": 18})
    # In a random flat market, breakout acceptance should be rare
    breakouts = [s for s in signals if s.signal_type == "Breakout Acceptance"]
    # Not guaranteed to be 0, but should be few
    assert len(breakouts) <= 2


def test_signal_fields():
    df = _make_df(80, trend=0.5)
    strategy = TrendSignals()
    signals = strategy.detect(df, _cfg(), {"vix": 18})
    for sig in signals:
        assert sig.ticker == "TEST"
        assert sig.strategy == "TrendFollowing"
        assert sig.holding_type in ("short", "mid", "long")
        assert len(sig.reasons) > 0
