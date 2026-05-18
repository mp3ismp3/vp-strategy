"""Tests for Task 1: Signal schema, BaseStrategy, DataProvider."""

import pytest
from datetime import datetime, timezone, timedelta
from core.signal import StrategySignal
from core.base_strategy import BaseStrategy


def _make_signal(**kwargs):
    defaults = {
        "ticker": "NVDA",
        "timestamp": datetime(2026, 5, 18, 16, 0, tzinfo=timezone(timedelta(hours=-4))),
        "strategy": "VP",
        "signal_type": "VA Rejection",
        "direction": "LONG",
        "confidence": 0.8,
        "entry": 125.0,
        "stop": 122.0,
        "target": 131.0,
        "holding_type": "short",
        "reasons": ["Bull rejection at VAL"],
        "warnings": [],
        "triggered": True,
    }
    defaults.update(kwargs)
    return StrategySignal(**defaults)


def test_signal_creation():
    sig = _make_signal()
    assert sig.ticker == "NVDA"
    assert sig.direction == "LONG"
    assert sig.triggered is True


def test_signal_rr_ratio():
    sig = _make_signal(entry=125.0, stop=122.0, target=131.0)
    assert sig.rr_ratio == 2.0


def test_signal_rr_zero_risk():
    sig = _make_signal(entry=125.0, stop=125.0, target=130.0)
    assert sig.rr_ratio == 0.0


def test_signal_to_dict_timezone():
    eastern = timezone(timedelta(hours=-4))
    ts = datetime(2026, 5, 18, 16, 0, tzinfo=eastern)
    sig = _make_signal(timestamp=ts)
    d = sig.to_dict()
    assert d["timestamp"] == "2026-05-18T16:00:00-04:00"
    assert d["ticker"] == "NVDA"
    assert d["triggered"] is True


def test_signal_to_dict_fields():
    sig = _make_signal()
    d = sig.to_dict()
    required = ["ticker", "timestamp", "strategy", "signal_type", "direction",
                "confidence", "entry", "stop", "target", "holding_type",
                "reasons", "warnings", "triggered"]
    for key in required:
        assert key in d


def test_base_strategy_is_abstract():
    with pytest.raises(TypeError):
        BaseStrategy()
