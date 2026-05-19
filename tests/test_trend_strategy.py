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
    df = _make_df(80, trend=0.3)
    from core.indicators import calc_donchian

    # First, get the Donchian upper from bars [:-1] BEFORE any modification
    # The strategy will recalculate using df.iloc[:-1] which includes iloc[-2]
    # So we need to set iloc[-2] high FIRST, then compute what the strategy sees
    
    # Set iloc[-2] to a high value (this will be included in strategy's Donchian calc)
    df.iloc[-2, df.columns.get_loc("Close")] = 200
    df.iloc[-2, df.columns.get_loc("High")] = 205
    df.iloc[-2, df.columns.get_loc("Low")] = 198
    df.iloc[-2, df.columns.get_loc("Open")] = 199

    # Now calc what strategy will see as Donchian upper (includes our modified iloc[-2])
    don = calc_donchian(df.iloc[:-1], 20)
    assert don is not None
    upper = don["upper"]  # This will be 205 (our modified High)

    # Today (iloc[-1]): close above upper + bullish + high volume
    df.iloc[-1, df.columns.get_loc("Close")] = upper + 3
    df.iloc[-1, df.columns.get_loc("Open")] = upper + 1
    df.iloc[-1, df.columns.get_loc("High")] = upper + 5
    df.iloc[-1, df.columns.get_loc("Low")] = upper + 0.5
    df.iloc[-1, df.columns.get_loc("Volume")] = 20_000_000

    # prev1_low (iloc[-2] Low=198) must be > upper - atr*0.1
    # upper=205, so 198 > 205 - atr*0.1? No! That fails.
    # Fix: set iloc[-2] Low above upper
    df.iloc[-2, df.columns.get_loc("Low")] = upper + 0.1

    # Recalc to verify (High didn't change so Donchian stays same)
    don2 = calc_donchian(df.iloc[:-1], 20)
    assert don2["upper"] == upper  # Confirm unchanged

    strategy = TrendSignals()
    signals = strategy.detect(df, _cfg(), {"vix": 18})
    breakouts = [s for s in signals if s.signal_type == "Breakout Acceptance"]
    assert len(breakouts) >= 1
    assert breakouts[0].holding_type == "long"


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
