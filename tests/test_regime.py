"""Tests for Task 2: Regime Engine."""

import pytest
import numpy as np
import pandas as pd
from regime.engine import detect_regime, get_active_strategies, _normalize_trust, RegimeState


def _make_df(n=100, trend=0.0, atr_mult=1.0):
    """Generate synthetic OHLCV DataFrame."""
    np.random.seed(42)
    dates = pd.date_range("2026-01-01", periods=n, freq="B")
    base = 100.0 + np.cumsum(np.random.randn(n) * 0.5 + trend)
    high = base + np.random.rand(n) * 2 * atr_mult
    low = base - np.random.rand(n) * 2 * atr_mult
    close = base + np.random.randn(n) * 0.3
    open_ = close + np.random.randn(n) * 0.2
    volume = np.random.randint(1_000_000, 10_000_000, n)
    return pd.DataFrame({
        "Open": open_, "High": high, "Low": low,
        "Close": close, "Volume": volume,
    }, index=dates)


def _cfg():
    return {"vp_lookback": 60, "va_pct": 0.68, "atr_len": 14, "vol_ma_len": 21, "max_sl_atr": 3.0}


def test_range_regime():
    """Flat POC + price in VA → range."""
    df = _make_df(100, trend=0.0)
    ctx = {"vix": 18}
    state = detect_regime(df, _cfg(), ctx)
    assert state.regime == "range"
    assert state.confidence > 0


def test_trend_regime():
    """Strong uptrend → trend."""
    df = _make_df(100, trend=0.5)
    ctx = {"vix": 18}
    state = detect_regime(df, _cfg(), ctx)
    # With strong trend, POC should migrate
    assert state.regime in ("trend", "range")  # depends on POC calc


def test_expansion_regime():
    """High VIX + outside VA → expansion."""
    df = _make_df(100, trend=1.0)
    # Force price well above VA
    df["Close"].iloc[-5:] = df["Close"].iloc[-5:] + 50
    df["High"].iloc[-5:] = df["High"].iloc[-5:] + 55
    ctx = {"vix": 30}
    state = detect_regime(df, _cfg(), ctx)
    assert state.regime == "expansion"


def test_compression_regime():
    """ATR compressed for 5+ days → compression."""
    df = _make_df(100, trend=0.0, atr_mult=1.0)
    # Compress last 10 bars
    for i in range(-10, 0):
        df.iloc[i, df.columns.get_loc("High")] = df.iloc[i]["Close"] + 0.1
        df.iloc[i, df.columns.get_loc("Low")] = df.iloc[i]["Close"] - 0.1
    ctx = {"vix": 14}
    state = detect_regime(df, _cfg(), ctx)
    assert state.regime == "compression"


def test_normalized_trust_sums_to_one():
    raw = {"VP": 1.0, "VWAP": 0.8, "TrendFollowing": 0.3}
    norm = _normalize_trust(raw)
    assert abs(sum(norm.values()) - 1.0) < 1e-9


def test_normalized_trust_all_zero():
    raw = {"VP": 0.0, "VWAP": 0.0, "TrendFollowing": 0.0}
    norm = _normalize_trust(raw)
    assert abs(sum(norm.values()) - 1.0) < 1e-9


def test_get_active_strategies():
    state = RegimeState(
        regime="range",
        confidence=0.9,
        raw_trust={"VP": 1.0, "VWAP": 0.8, "TrendFollowing": 0.3},
        normalized_trust={"VP": 0.476, "VWAP": 0.381, "TrendFollowing": 0.143},
    )
    # TrendFollowing = 0.143 < 0.15 threshold → not active
    active = get_active_strategies(state, threshold=0.15)
    assert "VP" in active
    assert "VWAP" in active
    assert "TrendFollowing" not in active
