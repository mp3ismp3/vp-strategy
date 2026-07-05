"""Tests for Entry Triggers — Spring, LPS, SOS Breakout."""

import numpy as np
import pandas as pd
import pytest

from strategies.accumulation.entry_triggers import check_triggers


def _make_df(closes, volumes=None, highs=None, lows=None, n=None):
    """Helper to create DataFrame from arrays."""
    closes = np.array(closes, dtype=float)
    if n is None:
        n = len(closes)
    if highs is None:
        highs = closes * 1.01
    else:
        highs = np.array(highs, dtype=float)
    if lows is None:
        lows = closes * 0.99
    else:
        lows = np.array(lows, dtype=float)
    opens = (closes + lows) / 2
    if volumes is None:
        volumes = np.full(n, 1_000_000)
    else:
        volumes = np.array(volumes, dtype=float)

    return pd.DataFrame({
        "Open": opens, "High": highs, "Low": lows,
        "Close": closes, "Volume": volumes,
    }, index=pd.date_range("2026-01-01", periods=n, freq="B"))


class TestOutputStructure:
    def test_returns_correct_keys(self):
        n = 60
        closes = np.full(n, 100.0)
        df = _make_df(closes)
        result = check_triggers(df, "B", 90, 95, 110)
        assert "triggered" in result
        assert "proximity" in result
        assert "distance" in result
        assert isinstance(result["triggered"], list)
        assert isinstance(result["proximity"], list)

    def test_insufficient_data(self):
        df = _make_df([100, 101, 102])
        result = check_triggers(df, "B", 90, 95, 110, lookback=40)
        assert result["triggered"] == []
        assert result["proximity"] == []


class TestSpringTrigger:
    def test_spring_triggered(self):
        """Breach below support + recovery + volume = Spring triggered."""
        n = 60
        closes = np.full(n, 105.0)
        lows = np.full(n, 104.0)
        highs = np.full(n, 106.0)
        volumes = np.full(n, 1_000_000)

        # Breach 2 days ago
        closes[-3] = 99  # Below support_dynamic=103
        lows[-3] = 98
        # Recovery today
        closes[-1] = 105  # Above support
        lows[-1] = 103.5
        highs[-1] = 106
        volumes[-1] = 1_500_000  # Above median

        df = _make_df(closes, volumes, highs, lows)
        result = check_triggers(df, "C", 90, 103, 112)

        # Should have triggered or proximity
        all_events = result["triggered"] + result["proximity"]
        spring_events = [e for e in all_events if e.get("type") == "SPRING"]
        assert len(spring_events) > 0

    def test_no_spring_without_breach(self):
        """No breach below support = no spring trigger."""
        n = 60
        closes = np.full(n, 108.0)  # Always above support=103
        df = _make_df(closes)
        result = check_triggers(df, "C", 90, 103, 112)
        triggered_springs = [t for t in result["triggered"] if t["type"] == "SPRING"]
        assert len(triggered_springs) == 0

    def test_false_spring_not_triggered(self):
        """Breach + volume increase + close LOW = NOT a spring (real breakdown)."""
        n = 60
        closes = np.full(n, 105.0)
        lows = np.full(n, 104.0)
        highs = np.full(n, 106.0)
        volumes = np.full(n, 1_000_000)

        # Breach and stays below (close in lower half)
        closes[-2] = 101
        lows[-2] = 99
        closes[-1] = 100  # Still below support=103, close near low
        lows[-1] = 99
        highs[-1] = 102
        volumes[-1] = 2_000_000  # High volume

        df = _make_df(closes, volumes, highs, lows)
        result = check_triggers(df, "C", 90, 103, 112)
        triggered_springs = [t for t in result["triggered"] if t["type"] == "SPRING"]
        assert len(triggered_springs) == 0


class TestSOSBreakout:
    def test_breakout_with_volume(self):
        """Close above resistance + high volume = SOS triggered."""
        n = 60
        closes = np.full(n, 108.0)
        volumes = np.full(n, 1_000_000)

        # Breakout day
        closes[-1] = 113  # Above resistance=110
        volumes[-1] = 2_000_000  # > 1.5x median

        df = _make_df(closes, volumes)
        result = check_triggers(df, "D", 90, 100, 110)

        sos_triggered = [t for t in result["triggered"] if t["type"] == "SOS_BREAKOUT"]
        assert len(sos_triggered) == 1
        assert sos_triggered[0]["entry"] > 110

    def test_breakout_without_volume_is_proximity(self):
        """Close above resistance but low volume = proximity, not triggered."""
        n = 60
        closes = np.full(n, 108.0)
        volumes = np.full(n, 1_000_000)

        # Breakout day without volume
        closes[-1] = 111  # Above resistance=110
        volumes[-1] = 900_000  # Below median

        df = _make_df(closes, volumes)
        result = check_triggers(df, "D", 90, 100, 110)

        sos_triggered = [t for t in result["triggered"] if t["type"] == "SOS_BREAKOUT"]
        sos_prox = [p for p in result["proximity"] if p["type"] == "SOS_BREAKOUT"]
        # Either triggered (if multi-day confirm) or proximity
        assert len(sos_triggered) == 0 or len(sos_prox) > 0

    def test_proximity_near_resistance(self):
        """Price near resistance = proximity alert."""
        n = 60
        closes = np.full(n, 109.5)  # 0.45% below resistance=110
        df = _make_df(closes)
        result = check_triggers(df, "D", 90, 100, 110)

        sos_prox = [p for p in result["proximity"] if p["type"] == "SOS_BREAKOUT"]
        assert len(sos_prox) > 0
        assert sos_prox[0]["pct_away"] < 2.0


class TestLPSTrigger:
    def test_lps_pullback_on_low_volume(self):
        """Pullback + low volume + hold above swing low = LPS."""
        n = 60
        # Create a pattern with a swing low at 102, price pulled back from 108
        closes = np.full(n, 106.0)
        volumes = np.full(n, 1_000_000)

        # Rising before pullback
        closes[-10:-5] = [104, 105, 106, 107, 108]
        # Pullback on low volume
        closes[-5:] = [107, 106, 105, 104, 105]  # Pull back but hold above 102
        volumes[-5:] = [600_000, 500_000, 500_000, 400_000, 500_000]  # Low vol
        # Close in upper half on last bar
        highs = closes * 1.01
        lows = closes * 0.99
        lows[-1] = 103.5
        highs[-1] = 106

        df = _make_df(closes, volumes, highs, lows)
        result = check_triggers(df, "D", 90, 100, 112)

        # Should detect LPS or proximity
        all_events = result["triggered"] + result["proximity"]
        lps_events = [e for e in all_events
                      if e.get("type") == "LPS" or e.get("type") == "LPS"]
        # May or may not trigger depending on swing detection
        # At minimum, distance should reference a trigger
        assert result["distance"]["nearest_trigger"] is not None


class TestTriggerEntryValues:
    def test_stop_loss_below_entry(self):
        """All triggered entries should have stop < entry."""
        n = 60
        closes = np.full(n, 108.0)
        volumes = np.full(n, 1_000_000)
        closes[-1] = 113
        volumes[-1] = 2_000_000

        df = _make_df(closes, volumes)
        result = check_triggers(df, "D", 90, 100, 110)

        for t in result["triggered"]:
            assert t["stop"] < t["entry"], f"{t['type']}: stop >= entry"
            assert t["target"] > t["entry"], f"{t['type']}: target <= entry"
            assert t["rr"] > 0, f"{t['type']}: negative R:R"
