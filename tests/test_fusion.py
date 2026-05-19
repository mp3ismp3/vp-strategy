"""Tests for Task 6: Signal Fusion Engine v2 + Holding Period."""

import pytest
from datetime import datetime, timezone, timedelta

from core.signal import StrategySignal, TRACK_MAP
from regime.engine import RegimeState
from scoring.fusion import fuse_signals, FusionResult, TrackResult
from scoring.holding import estimate_holding, HoldingEstimate


ET = timezone(timedelta(hours=-4))


def _sig(strategy="VP", direction="LONG", confidence=0.8, holding_type="short",
         signal_type="VA Rejection", triggered=True):
    return StrategySignal(
        ticker="NVDA", timestamp=datetime(2026, 5, 18, 16, 0, tzinfo=ET),
        strategy=strategy, signal_type=signal_type, direction=direction,
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
                       raw_trust={}, normalized_trust=trust_map[regime],
                       atr_ratio=1.0, vix=18.0)


# --- Fusion Tests ---

def test_fusion_all_long():
    signals = [
        _sig("VP", "LONG", 0.8, "short", "VA Rejection"),
        _sig("VWAP", "LONG", 0.7, "mid", "VWAP Reclaim"),
        _sig("TrendFollowing", "LONG", 0.6, "long", "Breakout Acceptance"),
    ]
    result = fuse_signals(signals, _regime("range"))
    # Each goes to its own track
    assert "short" in result.tracks
    assert result.tracks["short"].direction == "LONG"
    assert result.best_score > 0


def test_fusion_conflict_active_only():
    """Veto only from active strategies within same track."""
    # In range regime, TrendFollowing trust = 0.143 < 0.15 → not active
    # These are in different tracks anyway, so no veto
    signals = [
        _sig("VP", "LONG", 0.8, "short", "VA Rejection"),
        _sig("TrendFollowing", "SHORT", 0.9, "long", "Breakout Acceptance"),
    ]
    result = fuse_signals(signals, _regime("range"))
    assert result.tracks["short"].direction == "LONG"
    # No veto within short track (TrendFollowing is in long track)
    assert result.tracks["short"].vetoes == []


def test_fusion_veto_from_active():
    """Veto when active strategies oppose within same track."""
    # Both VP and VWAP can produce short signals
    signals = [
        _sig("VP", "LONG", 0.8, "short", "VA Rejection"),
        _sig("VWAP", "SHORT", 0.7, "short", "VWAP Deviation"),
    ]
    result = fuse_signals(signals, _regime("range"))
    # VP has higher trust×confidence in range, so it's primary
    # VWAP opposes → veto
    assert "short" in result.tracks
    assert len(result.tracks["short"].vetoes) > 0


def test_fusion_empty():
    result = fuse_signals([], _regime("range"))
    assert result.score == 0
    assert result.direction == "NEUTRAL"


def test_fusion_untriggered_ignored():
    signals = [_sig("VP", "LONG", 0.8, "short", "VA Rejection", triggered=False)]
    result = fuse_signals(signals, _regime("range"))
    assert result.score == 0


def test_fusion_score_capped_100():
    signals = [
        _sig("VP", "LONG", 1.0, "short", "VA Rejection"),
        _sig("VWAP", "LONG", 1.0, "short", "VWAP Deviation"),
    ]
    result = fuse_signals(signals, _regime("range"))
    assert result.best_score <= 100


def test_fusion_tracks_independent():
    """Different tracks don't interfere."""
    sig_short = _sig("VP", "LONG", 0.8, "short", "VA Rejection")
    sig_long = _sig("TrendFollowing", "SHORT", 0.9, "long", "Breakout Acceptance")
    result = fuse_signals([sig_short, sig_long], _regime("trend"))
    # Different tracks, no veto between them
    assert "short" in result.tracks
    assert "long" in result.tracks
    assert result.tracks["short"].direction == "LONG"
    assert result.tracks["long"].direction == "SHORT"
    assert result.cross_track_conflict is True


def test_fusion_confirmation_bonus():
    """Same-direction signals in same track give confirmation bonus."""
    sig1 = _sig("VP", "LONG", 0.8, "short", "VA Rejection")
    result_single = fuse_signals([sig1], _regime("range"))

    sig2 = _sig("VWAP", "LONG", 0.6, "short", "VWAP Deviation")
    result_confirmed = fuse_signals([sig1, sig2], _regime("range"))
    assert result_confirmed.best_score >= result_single.best_score


def test_fusion_best_track_is_highest():
    """best_track = track with highest score."""
    signals = [
        _sig("VP", "LONG", 0.5, "short", "VA Rejection"),
        _sig("TrendFollowing", "LONG", 0.9, "long", "Breakout Acceptance"),
    ]
    result = fuse_signals(signals, _regime("trend"))
    assert result.best_track == "long"
    assert result.best_setup == "Breakout Acceptance"


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
