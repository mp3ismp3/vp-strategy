"""Holding Period Engine — determines suggested hold time.

Logic:
  Base holding determined by signal type (strategy decides):
    short = 3 days, mid = 12 days, long = 45 days
  Adjusted by ATR and VIX.
"""

from dataclasses import dataclass

from config import REGIME_THRESHOLDS


@dataclass
class HoldingEstimate:
    days: int
    range_str: str          # "2-4 days", "1-2 weeks", etc.
    timeframe: str          # "short" / "mid" / "long"
    reasoning: str


BASE_DAYS = {"short": 3, "mid": 12, "long": 45}

RANGE_LABELS = {
    "short": lambda d: f"{max(1,d-1)}-{d+2} days",
    "mid": lambda d: f"{max(1,d//7)}-{d//7+2} weeks",
    "long": lambda d: f"{max(1,d//7)}-{d//7+3} weeks",
}


def estimate_holding(signal, atr_current: float, atr_avg: float, vix: float = None) -> HoldingEstimate:
    """Estimate holding period for a signal.

    Args:
        signal: StrategySignal (needs .holding_type)
        atr_current: current ATR value
        atr_avg: 20-day average ATR
        vix: current VIX (optional)
    """
    ht = signal.holding_type if signal else "mid"
    base = BASE_DAYS.get(ht, 12)
    multiplier = 1.0
    reasons = []

    # ATR adjustment
    if atr_avg > 0:
        atr_ratio = atr_current / atr_avg
        if atr_ratio > REGIME_THRESHOLDS["atr_expansion"]:
            multiplier *= 0.8
            reasons.append(f"High volatility (ATR {atr_ratio:.1f}x) → shorter hold")
        elif atr_ratio < REGIME_THRESHOLDS["atr_compression"]:
            multiplier *= 1.2
            reasons.append(f"Low volatility (ATR {atr_ratio:.1f}x) → longer hold")

    # VIX adjustment
    if vix is not None:
        if vix >= REGIME_THRESHOLDS["vix_high"]:
            multiplier *= 0.8
            reasons.append(f"High VIX ({vix:.0f}) → shorter hold")
        elif vix <= REGIME_THRESHOLDS["vix_low"]:
            multiplier *= 1.2
            reasons.append(f"Low VIX ({vix:.0f}) → longer hold")

    days = max(1, int(base * multiplier))

    if not reasons:
        reasons.append("Normal conditions")

    range_fn = RANGE_LABELS.get(ht, RANGE_LABELS["mid"])
    range_str = range_fn(days)

    return HoldingEstimate(
        days=days,
        range_str=range_str,
        timeframe=ht,
        reasoning="; ".join(reasons),
    )
