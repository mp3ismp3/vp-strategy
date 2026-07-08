"""Accumulation Tracker — State persistence + decay scoring engine.

Maintains a watchlist of symbols showing accumulation signs.
Tracks phase, decay score, tier (watch/confirmed), and state changes.
"""

import json
from datetime import date
from pathlib import Path
from typing import Optional

from strategies.accumulation.config import (
    CONFIRM_THRESHOLD,
    DECAY_RATE_FAST,
    DECAY_RATE_SLOW,
    DEMOTION_STREAK,
    ENTRY_THRESHOLD,
    EXIT_THRESHOLD,
    MAX_SCORE,
    PROMOTION_STREAK,
    STATE_FILE,
)


def _today_str():
    return date.today().isoformat()


class AccumulationTracker:
    """Manages the accumulation watchlist with decay scoring and state persistence."""

    def __init__(self, state_path: Optional[str] = None):
        self._state_path = Path(state_path or STATE_FILE)
        self._state: dict = {}  # symbol -> state dict
        self._changes: list = []  # events from this run

    # ─── Persistence ───

    def load_state(self):
        """Load state from JSON file. Creates empty state if file missing."""
        if self._state_path.exists():
            try:
                text = self._state_path.read_text()
                data = json.loads(text) if text.strip() else {}
                # Filter out any non-dict entries
                self._state = {k: v for k, v in data.items() if isinstance(v, dict)}
            except (json.JSONDecodeError, IOError):
                self._state = {}
        else:
            self._state = {}
        self._changes = []

    def save_state(self):
        """Persist current state to JSON file (atomic write)."""
        self._state_path.parent.mkdir(parents=True, exist_ok=True)
        tmp_path = self._state_path.with_suffix(".json.tmp")
        tmp_path.write_text(
            json.dumps(self._state, indent=2, ensure_ascii=False)
        )
        tmp_path.replace(self._state_path)

    # ─── Core Update Logic ───

    def update(self, symbol: str, raw_score: int, phase: str,
               support_primary: float, support_dynamic: float,
               resistance: float):
        """Update a symbol's state. Handles entry, decay, promotion, demotion, exit."""
        raw_score = max(0, min(MAX_SCORE, raw_score))

        if symbol in self._state:
            self._update_existing(symbol, raw_score, phase,
                                  support_primary, support_dynamic, resistance)
        else:
            self._try_entry(symbol, raw_score, phase,
                           support_primary, support_dynamic, resistance)

    def _try_entry(self, symbol, raw_score, phase, sp, sd, resistance):
        """Try to add a new symbol to the watchlist."""
        if raw_score < ENTRY_THRESHOLD:
            return

        self._state[symbol] = {
            "phase": phase,
            "tier": "watch",
            "decay_score": float(raw_score),
            "raw_score": raw_score,
            "raw_history": [raw_score],
            "entered_date": _today_str(),
            "last_updated": _today_str(),
            "support_primary": sp,
            "support_dynamic": sd,
            "resistance": resistance,
            "promote_streak": 0,
            "demote_streak": 0,
            "failing": False,
            "fail_days": 0,
            "triggers_fired": [],
            "removed_reason": None,
        }
        self._changes.append({
            "type": "added",
            "symbol": symbol,
            "tier": "watch",
            "score": raw_score,
            "phase": phase,
        })

    def _update_existing(self, symbol, raw_score, phase, sp, sd, resistance):
        """Update an existing symbol's state with decay logic."""
        s = self._state[symbol]
        prev_decay = s["decay_score"]

        # Phase hysteresis: prevent daily oscillation
        phase = self._apply_phase_hysteresis(s, phase)

        # Compute new decay score
        new_decay = self._compute_decay(prev_decay, raw_score, phase)

        # Update state
        s["raw_score"] = raw_score
        s["decay_score"] = new_decay
        s["phase"] = phase
        s["last_updated"] = _today_str()
        s["support_primary"] = sp
        s["support_dynamic"] = sd
        s["resistance"] = resistance

        # Keep last 30 days of history
        history = s.get("raw_history", [])
        history.append(raw_score)
        s["raw_history"] = history[-30:]

        # Reset failure state only if score recovers to confirmation level
        if new_decay >= CONFIRM_THRESHOLD:
            s["failing"] = False
            s["fail_days"] = 0

        # Check promotion / demotion / exit
        self._check_promotion(symbol)
        self._check_demotion(symbol)
        self._check_exit(symbol)

    def _compute_decay(self, prev_score: float, raw_score: int, phase: str) -> float:
        """Calculate decayed score.
        
        Formula: new = max(raw_score_today, prev_score * decay_rate)
        If today's raw score is high, it overrides decay.
        If not, previous score decays toward EXIT_THRESHOLD.
        """
        if phase in ("C", "D", "E"):
            decay_rate = DECAY_RATE_FAST
        else:
            decay_rate = DECAY_RATE_SLOW

        decayed = prev_score * decay_rate
        return round(max(float(raw_score), decayed), 2)

    @staticmethod
    def _apply_phase_hysteresis(state: dict, new_phase: str) -> str:
        """Apply phase hysteresis to prevent daily oscillation.

        Rules:
          - Forward transitions (A→B→C→D→E) apply immediately.
          - Backward transitions require 2 consecutive scans.
          - UNKNOWN is always allowed (resets).
        """
        PHASE_ORDER = {"UNKNOWN": 0, "A": 1, "B": 2, "C": 3, "D": 4, "E": 5}
        prev_phase = state.get("phase", "UNKNOWN")

        prev_rank = PHASE_ORDER.get(prev_phase, 0)
        new_rank = PHASE_ORDER.get(new_phase, 0)

        if new_phase == "UNKNOWN" or new_rank >= prev_rank:
            # Forward or same — apply immediately, reset backward counter
            state["phase_back_count"] = 0
            return new_phase
        else:
            # Backward — require 2 consecutive scans
            back_count = state.get("phase_back_count", 0) + 1
            state["phase_back_count"] = back_count
            if back_count >= 2:
                state["phase_back_count"] = 0
                return new_phase
            else:
                return prev_phase  # Hold previous phase

    def _check_promotion(self, symbol: str):
        """Check if watch → confirmed promotion should happen."""
        s = self._state[symbol]
        if s["tier"] != "watch":
            return

        if s["decay_score"] >= CONFIRM_THRESHOLD:
            s["promote_streak"] = s.get("promote_streak", 0) + 1
        else:
            s["promote_streak"] = 0

        if s["promote_streak"] >= PROMOTION_STREAK:
            s["tier"] = "confirmed"
            s["promote_streak"] = 0
            self._changes.append({
                "type": "promoted",
                "symbol": symbol,
                "score": s["decay_score"],
                "phase": s["phase"],
            })

    def _check_demotion(self, symbol: str):
        """Check if confirmed → watch demotion should happen."""
        s = self._state[symbol]
        if s["tier"] != "confirmed":
            return

        if s["decay_score"] < CONFIRM_THRESHOLD:
            s["demote_streak"] = s.get("demote_streak", 0) + 1
        else:
            s["demote_streak"] = 0

        if s["demote_streak"] >= DEMOTION_STREAK:
            # If score is below exit threshold, skip demotion — exit will handle removal
            if s["decay_score"] < EXIT_THRESHOLD:
                return
            s["tier"] = "watch"
            s["demote_streak"] = 0
            self._changes.append({
                "type": "demoted",
                "symbol": symbol,
                "score": s["decay_score"],
                "phase": s["phase"],
            })

    def _check_exit(self, symbol: str):
        """Remove symbol if decay score falls below EXIT_THRESHOLD."""
        s = self._state[symbol]
        if s["decay_score"] < EXIT_THRESHOLD:
            self._remove(symbol, "分數衰減至下限自動移除")

    # ─── Failure Handling ───

    def mark_failure(self, symbol: str, reason: str, severity: str = "soft"):
        """Mark a symbol as failing or remove it.
        
        severity: "hard" → immediate removal
                  "soft" → increment fail_days, remove after SOFT_FAIL_DAYS
        """
        if symbol not in self._state:
            return

        s = self._state[symbol]

        if severity == "hard":
            self._remove(symbol, reason)
        else:
            s["failing"] = True
            s["fail_days"] = s.get("fail_days", 0) + 1
            from strategies.accumulation.config import SOFT_FAIL_DAYS
            if s["fail_days"] >= SOFT_FAIL_DAYS:
                self._remove(symbol, reason)

    def clear_failure(self, symbol: str):
        """Clear failure state (e.g., Spring recovery)."""
        if symbol in self._state:
            self._state[symbol]["failing"] = False
            self._state[symbol]["fail_days"] = 0

    def _remove(self, symbol: str, reason: str):
        """Remove symbol from tracking."""
        if symbol not in self._state:
            return
        s = self._state[symbol]
        self._changes.append({
            "type": "removed",
            "symbol": symbol,
            "reason": reason,
            "tier": s["tier"],
            "score": s["decay_score"],
            "phase": s["phase"],
            "entered_date": s.get("entered_date", ""),
        })
        del self._state[symbol]

    # ─── Trigger Recording ───

    def record_trigger(self, symbol: str, trigger_type: str):
        """Record that an entry trigger has fired for a symbol."""
        if symbol in self._state:
            fired = self._state[symbol].get("triggers_fired", [])
            fired.append({"type": trigger_type, "date": _today_str()})
            self._state[symbol]["triggers_fired"] = fired[-10:]  # Keep last 10

    # ─── Query Methods ───

    def get_watchlist(self) -> list:
        """Return symbols in watch tier, sorted by decay_score desc."""
        items = [
            {"symbol": k, **v}
            for k, v in self._state.items()
            if v["tier"] == "watch"
        ]
        return sorted(items, key=lambda x: x["decay_score"], reverse=True)

    def get_confirmed(self) -> list:
        """Return symbols in confirmed tier, sorted by decay_score desc."""
        items = [
            {"symbol": k, **v}
            for k, v in self._state.items()
            if v["tier"] == "confirmed"
        ]
        return sorted(items, key=lambda x: x["decay_score"], reverse=True)

    def get_all(self) -> list:
        """Return all tracked symbols."""
        items = [{"symbol": k, **v} for k, v in self._state.items()]
        return sorted(items, key=lambda x: x["decay_score"], reverse=True)

    def get_changes(self) -> list:
        """Return state changes from this run (added/promoted/demoted/removed)."""
        return self._changes

    def get_symbol(self, symbol: str) -> Optional[dict]:
        """Get state for a specific symbol."""
        if symbol in self._state:
            return {"symbol": symbol, **self._state[symbol]}
        return None

    def is_tracked(self, symbol: str) -> bool:
        """Check if a symbol is currently tracked."""
        return symbol in self._state

    @property
    def count(self) -> int:
        return len(self._state)

    @property
    def confirmed_count(self) -> int:
        return sum(1 for v in self._state.values() if v["tier"] == "confirmed")

    @property
    def watch_count(self) -> int:
        return sum(1 for v in self._state.values() if v["tier"] == "watch")
