"""Signal Fusion Engine — combines multi-strategy signals into composite score.

Architecture:
  1. Group signals by strategy
  2. Per-strategy: take highest confidence triggered signal
  3. Score = confidence × normalized_trust × 100
  4. Composite = sum(per-strategy scores), cap 100
  5. Direction conflict: only penalize from active strategies (trust > 0.15)
"""

from dataclasses import dataclass, field
from config import SCORING_WEIGHTS
from regime.engine import RegimeState


@dataclass
class FusionResult:
    score: int                          # 0-100
    direction: str                      # "LONG" / "SHORT" / "NEUTRAL"
    label: str                          # "Strong Long", "Avoid", etc.
    per_strategy: dict = field(default_factory=dict)   # {strategy: score}
    conflicts: list = field(default_factory=list)
    dominant_signal: object = None      # StrategySignal with highest contribution


def _label_from_score(score, direction):
    if direction == "NEUTRAL" or score < 40:
        return "Avoid" if score < 40 else "Neutral"
    d = "Long" if direction == "LONG" else "Short"
    if score >= 80:
        return f"Strong {d}"
    elif score >= 60:
        return f"Moderate {d}"
    elif score >= 50:
        return f"Lean {d}"
    return "Neutral"


def _base_strategy(sig):
    """Extract base strategy name (handles 'VP: VA Rejection' → 'VP')."""
    s = sig.strategy
    return s.split(":")[0].strip() if ":" in s else s


def fuse_signals(signals: list, regime_state: RegimeState) -> FusionResult:
    """Fuse multiple StrategySignal objects into a single composite score.

    Args:
        signals: list of StrategySignal (from all strategies for one ticker)
        regime_state: RegimeState with normalized_trust
    """
    if not signals:
        return FusionResult(score=0, direction="NEUTRAL", label="Neutral")

    # Group by strategy, take highest confidence triggered signal per strategy
    best_per_strategy = {}
    for sig in signals:
        if not sig.triggered:
            continue
        key = _base_strategy(sig)
        if key not in best_per_strategy or sig.confidence > best_per_strategy[key].confidence:
            best_per_strategy[key] = sig

    if not best_per_strategy:
        return FusionResult(score=0, direction="NEUTRAL", label="Neutral")

    trust = regime_state.normalized_trust
    active_threshold = 0.15

    # Calculate per-strategy scores
    per_strategy = {}
    directions = {}  # strategy -> direction (only active)
    dominant = None
    max_contribution = 0

    for strat, sig in best_per_strategy.items():
        strat_trust = trust.get(strat, 0)
        contribution = sig.confidence * strat_trust * 100
        per_strategy[strat] = round(contribution, 1)

        if strat_trust > active_threshold:
            directions[strat] = sig.direction

        if contribution > max_contribution:
            max_contribution = contribution
            dominant = sig

    # Determine direction (majority vote from active strategies)
    long_score = sum(per_strategy.get(s, 0) for s, d in directions.items() if d == "LONG")
    short_score = sum(per_strategy.get(s, 0) for s, d in directions.items() if d == "SHORT")

    if long_score > short_score:
        direction = "LONG"
    elif short_score > long_score:
        direction = "SHORT"
    else:
        direction = "NEUTRAL"

    # Check for conflicts (only among active strategies)
    conflicts = []
    active_dirs = set(d for s, d in directions.items() if d in ("LONG", "SHORT"))
    has_conflict = len(active_dirs) > 1

    composite = sum(per_strategy.values())

    if has_conflict:
        composite -= 15
        for strat, d in directions.items():
            if d != direction:
                conflicts.append(f"{strat} says {d}")

    # Add regime bonus
    regime_bonus = regime_state.confidence * SCORING_WEIGHTS.get("regime", 0.1) * 100
    composite += regime_bonus

    composite = max(0, min(100, int(composite)))
    label = _label_from_score(composite, direction)

    return FusionResult(
        score=composite,
        direction=direction,
        label=label,
        per_strategy=per_strategy,
        conflicts=conflicts,
        dominant_signal=dominant,
    )
