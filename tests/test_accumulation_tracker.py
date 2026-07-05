"""Tests for AccumulationTracker — state persistence + decay scoring."""

import json
import tempfile
from pathlib import Path

import pytest

from strategies.accumulation.tracker import AccumulationTracker
from strategies.accumulation.config import (
    CONFIRM_THRESHOLD,
    DECAY_RATE_FAST,
    DECAY_RATE_SLOW,
    ENTRY_THRESHOLD,
    EXIT_THRESHOLD,
    PROMOTION_STREAK,
    DEMOTION_STREAK,
)


@pytest.fixture
def tmp_state(tmp_path):
    """Provide a temporary state file path."""
    return str(tmp_path / "test_state.json")


@pytest.fixture
def tracker(tmp_state):
    """Provide a fresh tracker with temp state."""
    t = AccumulationTracker(state_path=tmp_state)
    t.load_state()
    return t


class TestStateManagement:
    def test_load_empty(self, tracker):
        assert tracker.count == 0
        assert tracker.get_watchlist() == []
        assert tracker.get_confirmed() == []

    def test_save_and_reload(self, tmp_state):
        t = AccumulationTracker(state_path=tmp_state)
        t.load_state()
        t.update("NVDA", 8, "B", 128.5, 134.2, 142.3)
        t.save_state()

        t2 = AccumulationTracker(state_path=tmp_state)
        t2.load_state()
        assert t2.count == 1
        assert t2.is_tracked("NVDA")

    def test_load_corrupt_json(self, tmp_state):
        Path(tmp_state).write_text("not valid json{{{")
        t = AccumulationTracker(state_path=tmp_state)
        t.load_state()
        assert t.count == 0

    def test_load_missing_file(self, tmp_path):
        t = AccumulationTracker(state_path=str(tmp_path / "nonexist.json"))
        t.load_state()
        assert t.count == 0


class TestEntryLogic:
    def test_below_threshold_not_added(self, tracker):
        tracker.update("WEAK", ENTRY_THRESHOLD - 1, "B", 100, 105, 120)
        assert not tracker.is_tracked("WEAK")

    def test_at_threshold_added(self, tracker):
        tracker.update("OK", ENTRY_THRESHOLD, "B", 100, 105, 120)
        assert tracker.is_tracked("OK")
        assert tracker.get_symbol("OK")["tier"] == "watch"

    def test_above_threshold_added(self, tracker):
        tracker.update("STRONG", 12, "B", 100, 105, 120)
        assert tracker.is_tracked("STRONG")

    def test_added_to_changes(self, tracker):
        tracker.update("NEW", 7, "B", 100, 105, 120)
        changes = tracker.get_changes()
        assert len(changes) == 1
        assert changes[0]["type"] == "added"
        assert changes[0]["symbol"] == "NEW"


class TestDecayScoring:
    def test_decay_slow_phase_b(self, tracker):
        tracker.update("X", 10, "B", 100, 105, 120)
        # Simulate no new evidence (raw=0), should decay
        tracker.update("X", 0, "B", 100, 105, 120)
        state = tracker.get_symbol("X")
        expected = 10 * DECAY_RATE_SLOW
        assert abs(state["decay_score"] - expected) < 0.01

    def test_decay_fast_phase_d(self, tracker):
        tracker.update("X", 10, "D", 100, 105, 120)
        tracker.update("X", 0, "D", 100, 105, 120)
        state = tracker.get_symbol("X")
        expected = 10 * DECAY_RATE_FAST
        assert abs(state["decay_score"] - expected) < 0.01

    def test_raw_score_overrides_decay(self, tracker):
        tracker.update("X", 10, "B", 100, 105, 120)
        # New raw score higher than decayed value
        tracker.update("X", 12, "B", 100, 105, 120)
        state = tracker.get_symbol("X")
        assert state["decay_score"] == 12.0

    def test_decay_over_many_days(self, tracker):
        """Verify score decays toward EXIT over ~10-15 days for Phase B."""
        tracker.update("X", CONFIRM_THRESHOLD, "B", 100, 105, 120)
        for _ in range(20):
            tracker.update("X", 0, "B", 100, 105, 120)
        # After 20 days of zero raw, should be well below exit
        if tracker.is_tracked("X"):
            state = tracker.get_symbol("X")
            assert state["decay_score"] < EXIT_THRESHOLD

    def test_fast_decay_exits_sooner(self, tracker):
        """Phase C/D decays faster than A/B."""
        tracker.update("SLOW", 10, "B", 100, 105, 120)
        tracker.update("FAST", 10, "D", 100, 105, 120)

        for _ in range(5):
            tracker.update("SLOW", 0, "B", 100, 105, 120)
            tracker.update("FAST", 0, "D", 100, 105, 120)

        slow = tracker.get_symbol("SLOW")
        fast = tracker.get_symbol("FAST")
        # Fast should have lower score
        if fast:
            assert fast["decay_score"] < slow["decay_score"]


class TestPromotionDemotion:
    def test_promotion_requires_streak(self, tracker):
        # First update adds to watch (promote_streak goes to 1 on this update)
        tracker.update("X", CONFIRM_THRESHOLD, "B", 100, 105, 120)
        assert tracker.get_symbol("X")["tier"] == "watch"
        # Second update: promote_streak becomes 2 on existing symbol
        tracker.update("X", CONFIRM_THRESHOLD, "B", 100, 105, 120)
        # Third update: streak = 3, should definitely be promoted
        tracker.update("X", CONFIRM_THRESHOLD, "B", 100, 105, 120)
        assert tracker.get_symbol("X")["tier"] == "confirmed"

    def test_promotion_resets_on_drop(self, tracker):
        tracker.update("X", CONFIRM_THRESHOLD, "B", 100, 105, 120)
        # Score drops below threshold
        tracker.update("X", CONFIRM_THRESHOLD - 2, "B", 100, 105, 120)
        assert tracker.get_symbol("X")["tier"] == "watch"
        # Needs to restart streak
        tracker.update("X", CONFIRM_THRESHOLD, "B", 100, 105, 120)
        assert tracker.get_symbol("X")["tier"] == "watch"

    def test_demotion_from_confirmed(self, tracker):
        # Force to confirmed by multiple updates above threshold
        tracker.update("X", CONFIRM_THRESHOLD + 2, "B", 100, 105, 120)
        for _ in range(PROMOTION_STREAK + 1):
            tracker.update("X", CONFIRM_THRESHOLD + 2, "B", 100, 105, 120)

        assert tracker.get_symbol("X")["tier"] == "confirmed"

        # Now score drops — need enough iterations for demotion streak
        for _ in range(DEMOTION_STREAK + 2):
            tracker.update("X", CONFIRM_THRESHOLD - 3, "B", 100, 105, 120)

        assert tracker.get_symbol("X")["tier"] == "watch"


class TestFailureHandling:
    def test_hard_failure_removes(self, tracker):
        tracker.update("X", 10, "B", 100, 105, 120)
        tracker.mark_failure("X", "跌破主支撐", severity="hard")
        assert not tracker.is_tracked("X")

    def test_soft_failure_increments(self, tracker):
        tracker.update("X", 10, "B", 100, 105, 120)
        tracker.mark_failure("X", "跌破動態支撐", severity="soft")
        assert tracker.is_tracked("X")
        assert tracker.get_symbol("X")["failing"] is True
        assert tracker.get_symbol("X")["fail_days"] == 1

    def test_soft_failure_removes_after_days(self, tracker):
        tracker.update("X", 10, "B", 100, 105, 120)
        from strategies.accumulation.config import SOFT_FAIL_DAYS
        for _ in range(SOFT_FAIL_DAYS):
            tracker.mark_failure("X", "跌破動態支撐", severity="soft")
        assert not tracker.is_tracked("X")

    def test_clear_failure_resets(self, tracker):
        tracker.update("X", 10, "B", 100, 105, 120)
        tracker.mark_failure("X", "test", severity="soft")
        tracker.clear_failure("X")
        assert tracker.get_symbol("X")["failing"] is False
        assert tracker.get_symbol("X")["fail_days"] == 0

    def test_removed_in_changes(self, tracker):
        tracker.update("X", 10, "B", 100, 105, 120)
        tracker.mark_failure("X", "breakdown", severity="hard")
        changes = tracker.get_changes()
        removed = [c for c in changes if c["type"] == "removed"]
        assert len(removed) == 1
        assert removed[0]["symbol"] == "X"


class TestExitOnDecay:
    def test_auto_exit_below_threshold(self, tracker):
        tracker.update("X", EXIT_THRESHOLD - 1, "B", 100, 105, 120)
        # Score below ENTRY so won't be added, but let's force it
        tracker._state["X"] = {
            "phase": "B", "tier": "watch", "decay_score": EXIT_THRESHOLD - 0.5,
            "raw_score": 2, "raw_history": [2], "entered_date": "2026-01-01",
            "last_updated": "2026-01-01", "support_primary": 100,
            "support_dynamic": 105, "resistance": 120,
            "promote_streak": 0, "demote_streak": 0,
            "failing": False, "fail_days": 0, "triggers_fired": [],
            "removed_reason": None,
        }
        # Update with low score triggers exit check
        tracker.update("X", 0, "B", 100, 105, 120)
        # Score decays below EXIT
        assert not tracker.is_tracked("X")
