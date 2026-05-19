"""Signal Fusion Engine v2 — Track-based (short/mid/long independent).

Key design changes from v1:
  1. Three independent tracks (short/mid/long), never mixed
  2. Within each track: primary signal + confirmation/veto (not additive)
  3. Correlated signals don't inflate scores
  4. Regime only affects its own track's trust

Architecture:
  Track = {primary signal (highest trust in regime) + confirmations}
  Score = primary_confidence × 100
        + confirmation_bonus (max +15 per confirming strategy)
        - veto_penalty (-20 per opposing active strategy)
        + regime_fit_bonus (0-10)
"""

from dataclasses import dataclass, field
from config import SCORING_WEIGHTS
from regime.engine import RegimeState


@dataclass
class TrackResult:
    timeframe: str              # "short" / "mid" / "long"
    score: int                  # 0-100
    direction: str              # "LONG" / "SHORT" / "NEUTRAL"
    label: str
    primary_signal: object      # StrategySignal
    confirmations: list = field(default_factory=list)
    vetoes: list = field(default_factory=list)
    holding_type: str = ""


@dataclass
class FusionResult:
    tracks: dict = field(default_factory=dict)   # {"short": TrackResult, "mid": ..., "long": ...}
    best_track: object = None                     # TrackResult with highest score
    # Backward compat
    score: int = 0
    direction: str = "NEUTRAL"
    label: str = "Neutral"
    per_strategy: dict = field(default_factory=dict)
    conflicts: list = field(default_factory=list)
    dominant_signal: object = None


# ─── Track definitions ───────────────────────────────────────────────────────

TRACK_SIGNALS = {
    "short": {"VA Rejection", "Failed Auction", "VWAP Deviation"},
    "mid": {"Breakout Retest", "VWAP Reclaim", "AVWAP Pullback", "Compression Breakout"},
    "long": {"Breakout Acceptance", "EMA Cross"},
}


def _signal_track(sig):
    """Determine which track a signal belongs to."""
    st = sig.signal_type
    for track, types in TRACK_SIGNALS.items():
        if st in types:
            return track
    # Fallback to holding_type
    return sig.holding_type if sig.holding_type in ("short", "mid", "long") else "mid"


def _base_strategy(sig):
    """Extract base strategy name."""
    s = sig.strategy
    return s.split(":")[0].strip() if ":" in s else s


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


# ─── Track Scoring ───────────────────────────────────────────────────────────

def _score_track(track_signals, regime_state):
    """Score a single track using primary + confirmation/veto logic.

    1. Pick primary signal = highest confidence from most trusted strategy
    2. Other signals in same direction = confirmation (+10 each, max +15 total)
    3. Other signals in opposite direction = veto (-20 each)
    4. Regime fit bonus: +10 if track matches regime well
    """
    if not track_signals:
        return None

    trust = regime_state.normalized_trust
    active_threshold = 0.15

    # Pick primary: highest (confidence × trust) among triggered signals
    triggered = [s for s in track_signals if s.triggered and s.direction in ("LONG", "SHORT")]
    if not triggered:
        return None

    def _score_key(sig):
        strat = _base_strategy(sig)
        return sig.confidence * trust.get(strat, 0.1)

    triggered.sort(key=_score_key, reverse=True)
    primary = triggered[0]
    primary_strat = _base_strategy(primary)

    # Base score from primary
    base_score = int(primary.confidence * 100)

    # Confirmations and vetoes from other strategies
    confirmations = []
    vetoes = []
    seen_strategies = {primary_strat}

    for sig in triggered[1:]:
        strat = _base_strategy(sig)
        if strat in seen_strategies:
            continue  # Skip duplicate strategy (correlated)
        seen_strategies.add(strat)

        strat_trust = trust.get(strat, 0)
        if strat_trust < active_threshold:
            continue  # Inactive strategy, ignore

        if sig.direction == primary.direction:
            confirmations.append(sig)
        else:
            vetoes.append(sig)

    # Apply bonuses/penalties
    confirm_bonus = min(len(confirmations) * 10, 15)  # Max +15
    veto_penalty = len(vetoes) * 20                    # -20 each

    # Regime fit bonus
    regime_bonus = 0
    primary_trust = trust.get(primary_strat, 0)
    if primary_trust > 0.35:  # Primary is the most trusted in this regime
        regime_bonus = 10
    elif primary_trust > 0.25:
        regime_bonus = 5

    score = base_score + confirm_bonus - veto_penalty + regime_bonus
    score = max(0, min(100, score))

    direction = primary.direction
    label = _label_from_score(score, direction)

    return TrackResult(
        timeframe=_signal_track(primary),
        score=score,
        direction=direction,
        label=label,
        primary_signal=primary,
        confirmations=confirmations,
        vetoes=vetoes,
        holding_type=primary.holding_type,
    )


# ─── Main Fusion ─────────────────────────────────────────────────────────────

def fuse_signals(signals: list, regime_state: RegimeState) -> FusionResult:
    """Fuse signals into independent track scores.

    Returns FusionResult with per-track scores.
    best_track = highest scoring track (for backward compat).
    """
    if not signals:
        return FusionResult()

    # Group signals by track
    by_track = {"short": [], "mid": [], "long": []}
    for sig in signals:
        track = _signal_track(sig)
        if track in by_track:
            by_track[track].append(sig)

    # Score each track independently
    tracks = {}
    for track_name, track_sigs in by_track.items():
        result = _score_track(track_sigs, regime_state)
        if result:
            tracks[track_name] = result

    if not tracks:
        return FusionResult()

    # Best track = highest score
    best = max(tracks.values(), key=lambda t: t.score)

    # Build per_strategy for backward compat
    per_strategy = {}
    for t in tracks.values():
        strat = _base_strategy(t.primary_signal)
        per_strategy[strat] = t.score

    # Conflicts = vetoes from best track
    conflicts = [f"{_base_strategy(v)} says {v.direction}" for v in best.vetoes]

    return FusionResult(
        tracks=tracks,
        best_track=best,
        score=best.score,
        direction=best.direction,
        label=best.label,
        per_strategy=per_strategy,
        conflicts=conflicts,
        dominant_signal=best.primary_signal,
    )
