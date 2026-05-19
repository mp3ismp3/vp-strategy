"""Signal Fusion Engine v2 — Track-based (short/mid/long independent).

Design:
  - Three independent tracks, never mixed
  - Within track: primary signal + confirmation/veto
  - Track assignment is fixed (TRACK_MAP in core/signal.py)
  - Score = primary confidence × 100 + confirm bonus - veto penalty + regime fit
  - best_score = max(triggered tracks) for scanner sorting
"""

from dataclasses import dataclass, field
from typing import Optional

from core.signal import TRACK_MAP
from regime.engine import RegimeState


@dataclass
class TrackResult:
    score: int                      # 0-100
    direction: str                  # "LONG" / "SHORT"
    main_signal: str                # e.g. "Breakout Acceptance"
    main_strategy: str              # e.g. "TrendFollowing"
    main_confidence: float
    confirmations: list = field(default_factory=list)   # strategy names
    vetoes: list = field(default_factory=list)          # strategy names
    holding: str = ""               # "2-4 days"
    regime_fit: bool = False

    def to_dict(self):
        return {
            "score": self.score, "direction": self.direction,
            "main_signal": self.main_signal, "main_strategy": self.main_strategy,
            "confirmations": self.confirmations, "vetoes": self.vetoes,
            "holding": self.holding, "regime_fit": self.regime_fit,
        }


@dataclass
class FusionResult:
    tracks: dict = field(default_factory=dict)
    best_score: int = 0
    best_track: str = "—"
    best_setup: str = "—"
    cross_track_conflict: bool = False
    conflict_note: str = ""
    # Backward compat aliases
    score: int = 0
    direction: str = "NEUTRAL"
    label: str = "Neutral"
    dominant_signal: object = None
    per_strategy: dict = field(default_factory=dict)
    conflicts: list = field(default_factory=list)


def _base_strategy(sig):
    """Extract base strategy name (handles 'VP: VA Rejection' → 'VP')."""
    s = sig.strategy
    return s.split(":")[0].strip() if ":" in s else s


def _label(score, direction):
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


def _calc_holding(track_name, atr_ratio, vix):
    """Calculate holding period string."""
    base = {"short": 3, "mid": 12, "long": 45}[track_name]
    mult = 1.0
    if atr_ratio > 1.5:
        mult *= 0.8
    elif atr_ratio < 0.7:
        mult *= 1.2
    if vix >= 25:
        mult *= 0.8
    elif vix < 15:
        mult *= 1.2
    days = max(1, round(base * mult))
    if days <= 7:
        return f"{max(1,days-1)}-{days+2} days"
    elif days <= 21:
        return f"{days//7}-{(days+4)//7} weeks"
    else:
        return f"{days//30+1}-{(days+14)//30+1} months"


def _score_track(track_name, signals, regime_state):
    """Score a single track.

    1. Pick primary = highest confidence among active strategies
    2. Confirmations = other active strategies, same direction → +10 each (max +15)
    3. Vetoes = other active strategies, opposite direction → -20 each
    4. Regime fit = primary strategy is most trusted → +10
    """
    triggered = [s for s in signals if s.triggered and s.direction in ("LONG", "SHORT")]
    if not triggered:
        return None

    trust = regime_state.normalized_trust
    active_threshold = 0.15

    # Filter to active strategies only
    active = [s for s in triggered if trust.get(_base_strategy(s), 0) > active_threshold]
    if not active:
        # Fallback: use highest confidence regardless
        active = triggered

    # Primary = highest confidence
    primary = max(active, key=lambda s: s.confidence)
    primary_strat = _base_strategy(primary)
    base_score = int(primary.confidence * 100)

    # Confirmations / vetoes from other strategies (deduplicated)
    seen = {primary_strat}
    confirmations = []
    vetoes = []
    for s in active:
        strat = _base_strategy(s)
        if strat in seen:
            continue
        seen.add(strat)
        if s.direction == primary.direction:
            confirmations.append(strat)
        elif s.direction in ("LONG", "SHORT"):
            vetoes.append(strat)

    confirm_bonus = min(len(confirmations) * 10, 15)
    veto_penalty = len(vetoes) * 20

    # Regime fit
    most_trusted = max(trust, key=trust.get)
    regime_fit = (primary_strat == most_trusted)
    regime_bonus = 10 if regime_fit else 0

    score = max(0, min(100, base_score + confirm_bonus + regime_bonus - veto_penalty))

    holding = _calc_holding(track_name, regime_state.atr_ratio, regime_state.vix)

    return TrackResult(
        score=score,
        direction=primary.direction,
        main_signal=primary.signal_type,
        main_strategy=primary_strat,
        main_confidence=primary.confidence,
        confirmations=confirmations,
        vetoes=vetoes,
        holding=holding,
        regime_fit=regime_fit,
    )


def fuse_signals(signals: list, regime_state: RegimeState) -> FusionResult:
    """Fuse signals into independent track scores."""
    if not signals:
        return FusionResult()

    # Group by track
    by_track = {"short": [], "mid": [], "long": []}
    for sig in signals:
        track = TRACK_MAP.get(sig.signal_type, sig.holding_type)
        if track in by_track:
            by_track[track].append(sig)

    # Score each track
    tracks = {}
    for name, sigs in by_track.items():
        result = _score_track(name, sigs, regime_state)
        if result:
            tracks[name] = result

    if not tracks:
        return FusionResult()

    # Best track
    best_name = max(tracks, key=lambda k: tracks[k].score)
    best = tracks[best_name]

    # Cross-track conflict detection
    directions = {k: v.direction for k, v in tracks.items()}
    unique_dirs = {d for d in directions.values() if d in ("LONG", "SHORT")}
    cross_conflict = len(unique_dirs) > 1
    conflict_note = ""
    if cross_conflict:
        conflict_note = " vs ".join(f"{k.capitalize()}={v}" for k, v in directions.items())

    return FusionResult(
        tracks=tracks,
        best_score=best.score,
        best_track=best_name,
        best_setup=best.main_signal,
        cross_track_conflict=cross_conflict,
        conflict_note=conflict_note,
        # Backward compat
        score=best.score,
        direction=best.direction,
        label=_label(best.score, best.direction),
        dominant_signal=best,
        per_strategy={k: v.score for k, v in tracks.items()},
        conflicts=[f"{s} opposes" for s in best.vetoes],
    )
