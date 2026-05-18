"""Tests for Task 6: Signal Fusion Engine + Holding Period."""

import pytest
from datetime import datetime, timezone, timedelta

from core.signal import StrategySignal
from regime.engine import RegimeState
from scoring.fusion import fuse_signals, FusionResult
from scoring.holding import estimate_holding, HoldingEstimate


ET = timezone(timedelta(hours=-4))


def _sig(strategy="VP", direction="LONG", confidence=0.8, holding_type="short", triggered=True):
    return StrategySignal(
        ticker="NVDA", timestamp=datetime(2026, 5, 18, 16, 0, tzinfo=ET),
        strategy=strategy, signal_type="Test", direction=direction,
        confidence=confidence, entry=125.0, stop=122.0, target=131.0,
        holding_type=holding_type, reasons=["test"], warnings=[],
        triggered=triggered,
    )


def _regime(regime="range"):
    trust_map = {
        "range": {"VP": 0.476, "VWAP": 0.381, "TrendFollowing": 0.143},
        "trend": {"VP": 0.208, "VWAP": 0.375, "TrendFollowing": 0.417},
        "expansion": {"VP": 0.125, "VWAP": 0.375, "TrendFollowing": 0.500},
    }
    return RegimeState(regime=regime, confidence=0.8,
                       raw_trust={}, normalized_trust=trust_map[regime])


# --- Fusion Tests ---

def test_fusion_all_long():
    signals = [_sig("VP", "LONG", 0.8), _sig("VWAP", "LONG", 0.7), _sig("TrendFollowing", "LONG", 0.6)]
    result = fuse_signals(signals, _regime("range"))
    assert result.direction == "LONG"
    assert result.score > 50
    assert "Strong" in result.label or "Moderate" in result.label
    assert result.conflicts == []


def test_fusion_conflict_active_only():
    """Conflict penalty only applies to active strategies (trust > 0.15)."""
    # In range regime, TrendFollowing trust = 0.143 < 0.15 → not active
    signals = [_sig("VP", "LONG", 0.8), _sig("TrendFollowing", "SHORT", 0.9)]
    result = fuse_signals(signals, _regime("range"))
    # TrendFollowing is not active in range, so no conflict penalty
    assert result.direction == "LONG"
    assert result.conflicts == []


def test_fusion_conflict_both_active():
    """Conflict penalty when both strategies are active."""
    # In trend regime, VP trust=0.208 and VWAP trust=0.375 → both active
    signals = [_sig("VP", "LONG", 0.8), _sig("VWAP", "SHORT", 0.9)]
    result = fuse_signals(signals, _regime("trend"))
    assert len(result.conflicts) > 0
    assert result.score < 70  # penalty applied


def test_fusion_empty():
    result = fuse_signals([], _regime("range"))
    assert result.score == 0
    assert result.direction == "NEUTRAL"


def test_fusion_untriggered_ignored():
    signals = [_sig("VP", "LONG", 0.8, triggered=False)]
    result = fuse_signals(signals, _regime("range"))
    assert result.score == 0


def test_fusion_score_capped_100():
    signals = [_sig("VP", "LONG", 1.0), _sig("VWAP", "LONG", 1.0), _sig("TrendFollowing", "LONG", 1.0)]
    result = fuse_signals(signals, _regime("range"))
    assert result.score <= 100


# --- Holding Tests ---

def test_holding_short_normal():
    sig = _sig(holding_type="short")
    h = estimate_holding(sig, atr_current=2.0, atr_avg=2.0, vix=18)
    assert h.timeframe == "short"
    assert 1 <= h.days <= 5


def test_holding_high_vol_shortens():
    sig = _sig(holding_type="mid")
    normal = estimate_holding(sig, atr_current=2.0, atr_avg=2.0, vix=18)
    high_vol = estimate_holding(sig, atr_current=4.0, atr_avg=2.0, vix=30)
    assert high_vol.days < normal.days


def test_holding_low_vol_extends():
    sig = _sig(holding_type="mid")
    normal = estimate_holding(sig, atr_current=2.0, atr_avg=2.0, vix=18)
    low_vol = estimate_holding(sig, atr_current=1.0, atr_avg=2.0, vix=12)
    assert low_vol.days > normal.days


def test_holding_long_base():
    sig = _sig(holding_type="long")
    h = estimate_holding(sig, atr_current=2.0, atr_avg=2.0, vix=18)
    assert h.timeframe == "long"
    assert h.days >= 30
