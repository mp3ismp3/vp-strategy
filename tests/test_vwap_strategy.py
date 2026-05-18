"""Tests for VWAP Strategy."""

import numpy as np
import pandas as pd
import pytest
from strategies.vwap_signals import VWAPSignals


def _make_df(n=80, base=100.0):
    np.random.seed(42)
    dates = pd.date_range("2026-01-01", periods=n, freq="B")
    close = base + np.cumsum(np.random.randn(n) * 0.5)
    high = close + np.random.rand(n) * 2
    low = close - np.random.rand(n) * 2
    open_ = close + np.random.randn(n) * 0.3
    volume = np.random.randint(1_000_000, 10_000_000, n)
    df = pd.DataFrame({"Open": open_, "High": high, "Low": low, "Close": close, "Volume": volume}, index=dates)
    df.attrs["symbol"] = "TEST"
    return df


def _cfg():
    return {"vp_lookback": 60, "va_pct": 0.68, "atr_len": 14, "vol_ma_len": 21, "max_sl_atr": 3.0, "long_only": False}


def test_vwap_reclaim_long():
    """Force a VWAP reclaim scenario."""
    df = _make_df(80)
    from core.indicators import calc_vwap_bands
    bands = calc_vwap_bands(df, 60)
    if bands:
        # Force prev close below VWAP, current above
        df.iloc[-2, df.columns.get_loc("Close")] = bands["vwap"] - 1
        df.iloc[-1, df.columns.get_loc("Close")] = bands["vwap"] + 0.5
        df.iloc[-1, df.columns.get_loc("Open")] = bands["vwap"] - 0.2
        df.iloc[-1, df.columns.get_loc("Volume")] = 15_000_000  # high volume

    strategy = VWAPSignals()
    signals = strategy.detect(df, _cfg(), {"vix": 18})
    reclaims = [s for s in signals if s.signal_type == "VWAP Reclaim" and s.direction == "LONG"]
    assert len(reclaims) >= 1
    assert reclaims[0].holding_type == "mid"
    assert reclaims[0].triggered is True


def test_vwap_no_signal_low_volume():
    """No signal when volume is low."""
    df = _make_df(80)
    df["Volume"] = 100  # very low volume
    strategy = VWAPSignals()
    signals = strategy.detect(df, _cfg(), {"vix": 18})
    # Should not trigger reclaim (vol_ratio will be ~1.0)
    reclaims = [s for s in signals if s.signal_type == "VWAP Reclaim"]
    # With uniform low volume, vol_ratio = 1.0 < 1.2, so no reclaim
    assert len(reclaims) == 0


def test_vwap_signal_has_reasons():
    df = _make_df(80)
    strategy = VWAPSignals()
    signals = strategy.detect(df, _cfg(), {"vix": 18})
    for sig in signals:
        assert len(sig.reasons) > 0
        assert sig.ticker == "TEST"
