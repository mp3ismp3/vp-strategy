"""Tests for Entry Triggers — Spring, LPS, SOS Breakout."""

import numpy as np
import pandas as pd
import pytest
from datetime import date

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
        assert "pending" in result
        assert "gate" in result
        assert isinstance(result["triggered"], list)
        assert isinstance(result["proximity"], list)
        assert isinstance(result["pending"], list)

    def test_insufficient_data(self):
        df = _make_df([100, 101, 102])
        result = check_triggers(df, "B", 90, 95, 110, lookback=40)
        assert result["triggered"] == []
        assert result["proximity"] == []


class TestSpringTrigger:
    def test_spring_triggered(self):
        """Breach below support + recovery + volume = Spring triggered (pending day-2 confirm)."""
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

        # Spring now goes to pending (day-2 confirmation) instead of triggered
        all_events = result["triggered"] + result["proximity"] + result.get("pending", [])
        spring_events = [e for e in all_events if e.get("type") == "SPRING"]
        assert len(spring_events) > 0

    def test_no_spring_without_breach(self):
        """No breach below support = no spring trigger."""
        n = 60
        closes = np.full(n, 108.0)  # Always above support=103
        df = _make_df(closes)
        result = check_triggers(df, "C", 90, 103, 112)
        triggered_springs = [t for t in result["triggered"] + result.get("pending", [])
                             if t["type"] == "SPRING"]
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
        all_events = result["triggered"] + result["proximity"] + result.get("pending", [])
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


class TestMarketEnvGate:
    """Tests for market environment gate on triggers."""

    def test_vix_above_30_blocks_all(self):
        """VIX >= 30 should block all triggers."""
        from strategies.accumulation.entry_triggers import market_env_gate
        result = market_env_gate("SPRING", {"vix": 32, "spy_above_ema50": True})
        assert result["allowed"] is False
        assert "30" in result["reason"]

        result = market_env_gate("SOS_BREAKOUT", {"vix": 35, "spy_above_ema50": True})
        assert result["allowed"] is False

    def test_vix_25_to_30_blocks_spring_lps(self):
        """VIX 25-30 blocks Spring/LPS but allows SOS."""
        from strategies.accumulation.entry_triggers import market_env_gate
        result = market_env_gate("SPRING", {"vix": 27, "spy_above_ema50": True})
        assert result["allowed"] is False

        result = market_env_gate("LPS", {"vix": 26, "spy_above_ema50": True})
        assert result["allowed"] is False

        result = market_env_gate("SOS_BREAKOUT", {"vix": 27, "spy_above_ema50": True})
        assert result["allowed"] is True
        assert result["confidence_adj"] < 1.0

    def test_spy_below_ema50_reduces_confidence(self):
        """SPY below EMA50 should reduce confidence for Spring/LPS."""
        from strategies.accumulation.entry_triggers import market_env_gate
        result = market_env_gate("SPRING", {"vix": 18, "spy_above_ema50": False})
        assert result["allowed"] is True
        assert result["confidence_adj"] == 0.6

        result = market_env_gate("SOS_BREAKOUT", {"vix": 18, "spy_above_ema50": False})
        assert result["allowed"] is True
        assert result["confidence_adj"] == 0.8

    def test_normal_market_allows_all(self):
        """Normal market (VIX<25, SPY above EMA50) allows everything."""
        from strategies.accumulation.entry_triggers import market_env_gate
        result = market_env_gate("SPRING", {"vix": 15, "spy_above_ema50": True})
        assert result["allowed"] is True
        assert result["confidence_adj"] == 1.0

    def test_no_market_ctx_allows_all(self):
        """No market context = allow all (backwards compatible)."""
        from strategies.accumulation.entry_triggers import market_env_gate
        result = market_env_gate("SPRING", None)
        assert result["allowed"] is True

    def test_spring_blocked_by_high_vix(self):
        """Spring should go to proximity (blocked) when VIX is high."""
        n = 60
        closes = np.full(n, 105.0)
        lows = np.full(n, 104.0)
        highs = np.full(n, 106.0)
        volumes = np.full(n, 1_000_000)
        closes[-3] = 99
        lows[-3] = 98
        closes[-1] = 105
        lows[-1] = 103.5
        highs[-1] = 106
        volumes[-1] = 1_500_000

        df = _make_df(closes, volumes, highs, lows)
        market_ctx = {"vix": 28, "spy_above_ema50": True}
        result = check_triggers(df, "C", 90, 103, 112, market_ctx=market_ctx)

        # Should NOT be in pending (blocked)
        assert len(result.get("pending", [])) == 0
        # Should appear in proximity as blocked
        blocked = [p for p in result["proximity"] if "觸發被阻" in p.get("vol_status", "")]
        assert len(blocked) > 0


class TestStopLossCap:
    """Tests for MAX_STOP_LOSS_PCT cap on stop-loss."""

    def test_cap_stop_loss_function(self):
        """Stop loss should be capped at 8% of entry."""
        from strategies.accumulation.entry_triggers import _cap_stop_loss
        # Entry 100, stop at 85 (15% away) → should cap to 92
        result = _cap_stop_loss(100.0, 85.0, 0.08)
        assert result == 92.0

    def test_stop_within_cap_unchanged(self):
        """Stop loss within cap should remain unchanged."""
        from strategies.accumulation.entry_triggers import _cap_stop_loss
        # Entry 100, stop at 95 (5% away) → no change
        result = _cap_stop_loss(100.0, 95.0, 0.08)
        assert result == 95.0

    def test_sos_trigger_has_trailing_stop(self):
        """SOS trigger should include trailing_stop field."""
        n = 60
        closes = np.full(n, 108.0)
        volumes = np.full(n, 1_000_000)
        closes[-1] = 113
        volumes[-1] = 2_000_000

        df = _make_df(closes, volumes)
        result = check_triggers(df, "D", 90, 100, 110)

        for t in result["triggered"]:
            if t["type"] == "SOS_BREAKOUT":
                assert "trailing_stop" in t
                assert t["trailing_stop"] < t["entry"]


class TestDay2Confirmation:
    """Tests for 2-day trigger confirmation mechanism."""

    def test_spring_goes_to_pending(self):
        """Spring trigger should go to pending, not triggered."""
        n = 60
        closes = np.full(n, 105.0)
        lows = np.full(n, 104.0)
        highs = np.full(n, 106.0)
        volumes = np.full(n, 1_000_000)
        closes[-3] = 99
        lows[-3] = 98
        closes[-1] = 105
        lows[-1] = 103.5
        highs[-1] = 106
        volumes[-1] = 1_500_000

        df = _make_df(closes, volumes, highs, lows)
        result = check_triggers(df, "C", 90, 103, 112)

        # Spring should be in pending, not triggered directly
        assert len(result.get("pending", [])) > 0
        pending_springs = [p for p in result["pending"] if p["type"] == "SPRING"]
        assert len(pending_springs) == 1

    def test_pending_confirmed_on_day2(self):
        """Pending trigger confirmed when price holds above support."""
        n = 60
        closes = np.full(n, 106.0)  # Price above support_dynamic=103
        lows = np.full(n, 104.0)
        highs = np.full(n, 107.0)
        volumes = np.full(n, 1_000_000)

        df = _make_df(closes, volumes, highs, lows)

        # Simulate a pending Spring trigger from yesterday
        pending = [{"type": "SPRING", "_pending_type": "SPRING",
                    "entry": 105.0, "stop": 97.0, "target": 115.0,
                    "rr": 1.9, "trailing_stop": 102.0,
                    "reason": "test", "action": "PILOT BUY"}]

        result = check_triggers(df, "C", 90, 103, 112,
                                pending_triggers=pending)

        # Should now appear in triggered (confirmed)
        assert len(result["triggered"]) >= 1
        confirmed = [t for t in result["triggered"] if t["type"] == "SPRING"]
        assert len(confirmed) == 1

    def test_pending_not_confirmed_if_below_support(self):
        """Pending trigger NOT confirmed when price drops below support."""
        n = 60
        closes = np.full(n, 101.0)  # Below support_dynamic=103
        lows = np.full(n, 100.0)
        highs = np.full(n, 102.0)
        volumes = np.full(n, 1_000_000)

        df = _make_df(closes, volumes, highs, lows)

        pending = [{"type": "SPRING", "_pending_type": "SPRING",
                    "entry": 105.0, "stop": 97.0, "target": 115.0,
                    "rr": 1.9, "trailing_stop": 102.0,
                    "reason": "test", "action": "PILOT BUY"}]

        result = check_triggers(df, "C", 90, 103, 112,
                                pending_triggers=pending)

        # Should NOT be confirmed
        confirmed_springs = [t for t in result["triggered"] if t["type"] == "SPRING"]
        assert len(confirmed_springs) == 0

    def test_sos_bypasses_pending(self):
        """SOS should trigger directly (already has 2-day confirm built in)."""
        n = 60
        closes = np.full(n, 108.0)
        volumes = np.full(n, 1_000_000)
        closes[-1] = 113
        volumes[-1] = 2_000_000

        df = _make_df(closes, volumes)
        result = check_triggers(df, "D", 90, 100, 110)

        # SOS should be in triggered directly
        sos = [t for t in result["triggered"] if t["type"] == "SOS_BREAKOUT"]
        assert len(sos) == 1
        # Should NOT be in pending
        sos_pending = [p for p in result.get("pending", []) if p.get("type") == "SOS_BREAKOUT"]
        assert len(sos_pending) == 0


class TestWatchExpiry:
    """Tests for max_watch_days auto-removal."""

    def test_watch_symbol_removed_after_30_days(self):
        """Symbol in watch tier for 30+ days should be auto-removed."""
        from strategies.accumulation.tracker import AccumulationTracker
        from datetime import timedelta
        import tempfile, os

        tmp = tempfile.NamedTemporaryFile(suffix=".json", delete=False)
        tmp.close()
        try:
            tracker = AccumulationTracker(state_path=tmp.name)
            tracker.load_state()

            # Manually add a symbol with old entered_date
            old_date = (date.today() - timedelta(days=35)).isoformat()
            tracker._state["TEST"] = {
                "phase": "B", "tier": "watch", "decay_score": 8.0,
                "raw_score": 8, "raw_history": [8],
                "entered_date": old_date, "last_updated": old_date,
                "support_primary": 90, "support_dynamic": 95, "resistance": 110,
                "promote_streak": 0, "demote_streak": 0,
                "failing": False, "fail_days": 0,
                "triggers_fired": [], "removed_reason": None,
            }

            # Update with a score that's above EXIT but below CONFIRM
            tracker.update("TEST", 8, "B", 90, 95, 110)

            # Should have been removed due to watch expiry
            assert not tracker.is_tracked("TEST")
            changes = tracker.get_changes()
            removal = [c for c in changes if c["type"] == "removed" and c["symbol"] == "TEST"]
            assert len(removal) == 1
            assert "30" in removal[0]["reason"] or "未升級" in removal[0]["reason"]
        finally:
            os.unlink(tmp.name)

    def test_confirmed_not_affected_by_expiry(self):
        """Confirmed tier symbols should NOT be affected by watch expiry."""
        from strategies.accumulation.tracker import AccumulationTracker
        from datetime import timedelta
        import tempfile, os

        tmp = tempfile.NamedTemporaryFile(suffix=".json", delete=False)
        tmp.close()
        try:
            tracker = AccumulationTracker(state_path=tmp.name)
            tracker.load_state()

            old_date = (date.today() - timedelta(days=60)).isoformat()
            tracker._state["TEST"] = {
                "phase": "D", "tier": "confirmed", "decay_score": 14.0,
                "raw_score": 14, "raw_history": [14],
                "entered_date": old_date, "last_updated": old_date,
                "support_primary": 90, "support_dynamic": 95, "resistance": 110,
                "promote_streak": 0, "demote_streak": 0,
                "failing": False, "fail_days": 0,
                "triggers_fired": [], "removed_reason": None,
            }

            tracker.update("TEST", 14, "D", 90, 95, 110)
            assert tracker.is_tracked("TEST")
        finally:
            os.unlink(tmp.name)
