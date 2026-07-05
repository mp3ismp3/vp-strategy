"""Tests for Accumulation Notifications formatting."""

import pytest

from strategies.accumulation.notifications import (
    format_daily_report,
    format_proximity_alert,
    format_trigger_alert,
)
from strategies.accumulation.tracker import AccumulationTracker


@pytest.fixture
def tracker(tmp_path):
    t = AccumulationTracker(state_path=str(tmp_path / "test.json"))
    t.load_state()
    return t


class TestDailyReport:
    def test_empty_report(self, tracker):
        """Empty tracker produces valid report."""
        msg = format_daily_report(tracker, {}, market_ctx={"vix": 16.5, "spy_state": "上漲趨勢"})
        assert "吸籌追蹤報告" in msg
        assert "VIX" in msg
        assert len(msg) <= 4096

    def test_report_with_symbols(self, tracker):
        """Report shows tracked symbols."""
        tracker.update("NVDA", 12, "D", 128.5, 134.2, 142.3)
        tracker.update("AVGO", 7, "B", 150.0, 160.0, 180.0)

        trigger_results = {
            "NVDA": {
                "triggered": [],
                "proximity": [{"type": "SOS_BREAKOUT", "trigger_price": 142.3,
                              "current": 141.5, "pct_away": 0.56, "vol_status": "80%"}],
                "distance": {"nearest_trigger": "SOS_BREAKOUT", "price_away_pct": 0.56, "volume_ready": False},
            },
            "AVGO": {
                "triggered": [],
                "proximity": [],
                "distance": {"nearest_trigger": None, "price_away_pct": None, "volume_ready": False},
            },
        }

        msg = format_daily_report(tracker, trigger_results)
        assert "NVDA" in msg
        assert "AVGO" in msg
        assert len(msg) <= 4096

    def test_report_with_triggered(self, tracker):
        """Report shows triggered entries."""
        tracker.update("NVDA", 12, "D", 128.5, 134.2, 142.3)
        trigger_results = {
            "NVDA": {
                "triggered": [{"type": "SOS_BREAKOUT", "entry": 143.5, "stop": 134.0,
                              "target": 156.0, "rr": 1.3, "reason": "突破", "action": "FULL"}],
                "proximity": [],
                "distance": {},
            },
        }
        msg = format_daily_report(tracker, trigger_results)
        assert "⚡" in msg
        assert "SOS_BREAKOUT" in msg
        assert "$143.5" in msg

    def test_report_with_changes(self, tracker):
        """Report shows state changes."""
        tracker.update("NEW", 8, "B", 100, 105, 120)
        msg = format_daily_report(tracker, {})
        assert "🆕" in msg
        assert "NEW" in msg

    def test_truncation_large_list(self, tracker):
        """Large watchlist gets truncated."""
        for i in range(25):
            tracker.update(f"SYM{i:02d}", 6, "B", 90, 95, 110)
        msg = format_daily_report(tracker, {})
        assert len(msg) <= 4096

    def test_no_market_ctx(self, tracker):
        """Report works without market context."""
        msg = format_daily_report(tracker, {}, market_ctx=None)
        assert "吸籌追蹤報告" in msg


class TestTriggerAlert:
    def test_format_spring(self):
        trigger = {
            "type": "SPRING",
            "entry": 135.5,
            "stop": 131.0,
            "target": 142.3,
            "rr": 1.5,
            "reason": "跌破後收回 + 量確認",
            "action": "PILOT BUY 10-25%",
        }
        msg = format_trigger_alert("NVDA", trigger)
        assert "NVDA" in msg
        assert "⚡" in msg
        assert "Spring" in msg
        assert "$135.5" in msg
        assert "1:1.5" in msg

    def test_format_sos(self):
        trigger = {
            "type": "SOS_BREAKOUT",
            "entry": 143.0,
            "stop": 134.0,
            "target": 158.0,
            "rr": 1.7,
            "reason": "突破 $142.3 + 量 1.8x",
            "action": "FULL POSITION",
        }
        msg = format_trigger_alert("NVDA", trigger)
        assert "突破" in msg
        assert "FULL POSITION" in msg

    def test_with_phase_info(self):
        trigger = {"type": "LPS", "entry": 137.0, "stop": 133.0,
                   "target": 148.0, "rr": 2.8, "reason": "回踩量縮",
                   "action": "ADD 25-40%"}
        phase_info = {"phase": "D", "next_event": "等待突破"}
        msg = format_trigger_alert("AVGO", trigger, phase_info)
        assert "Phase D" in msg

    def test_message_length(self):
        trigger = {"type": "SPRING", "entry": 100.0, "stop": 95.0,
                   "target": 115.0, "rr": 3.0,
                   "reason": "a" * 200, "action": "BUY"}
        msg = format_trigger_alert("TEST", trigger)
        assert len(msg) <= 4096


class TestProximityAlert:
    def test_format_sos_proximity(self):
        proximity = {
            "type": "SOS_BREAKOUT",
            "trigger_price": 142.3,
            "current": 141.5,
            "pct_away": 0.56,
            "vol_status": "量能 85% (需 1.5x median)",
        }
        msg = format_proximity_alert("NVDA", proximity)
        assert "⚠️" in msg
        assert "NVDA" in msg
        assert "$142.3" in msg
        assert "0.6%" in msg or "0.56" in msg

    def test_with_phase_info(self):
        proximity = {"type": "SPRING", "trigger_price": 103.0,
                     "current": 104.5, "pct_away": 1.4, "vol_status": "等待"}
        phase_info = {"phase": "C", "description": "接近 Spring 區域"}
        msg = format_proximity_alert("AMD", proximity, phase_info)
        assert "Spring" in msg or "SPRING" in msg
