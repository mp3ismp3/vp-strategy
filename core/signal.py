"""Unified signal schema for all strategies."""

from dataclasses import dataclass, field
from datetime import datetime
from typing import List


# Fixed track assignment — signal_type → timeframe track
TRACK_MAP = {
    "VA Rejection": "short",
    "Failed Auction": "short",
    "VWAP Deviation": "short",
    "Breakout Retest": "mid",
    "VWAP Reclaim": "mid",
    "AVWAP Pullback": "mid",
    "Compression Breakout": "mid",
    "Breakout Acceptance": "long",
    "EMA Cross": "long",
}


@dataclass
class StrategySignal:
    ticker: str
    timestamp: datetime
    strategy: str          # "VP", "VWAP", "TrendFollowing"
    signal_type: str       # "VA Rejection", "VWAP Reclaim", etc.
    direction: str         # "LONG" / "SHORT" / "NEUTRAL"
    confidence: float      # 0.0 - 1.0
    entry: float
    stop: float
    target: float
    holding_type: str      # "short" / "mid" / "long"
    reasons: List[str] = field(default_factory=list)
    warnings: List[str] = field(default_factory=list)
    triggered: bool = False
    narrative: str = ""
    evidence: List[str] = field(default_factory=list)

    def to_dict(self) -> dict:
        return {
            "ticker": self.ticker,
            "timestamp": self.timestamp.isoformat() if self.timestamp else None,
            "strategy": self.strategy,
            "signal_type": self.signal_type,
            "direction": self.direction,
            "confidence": self.confidence,
            "entry": self.entry,
            "stop": self.stop,
            "target": self.target,
            "holding_type": self.holding_type,
            "reasons": self.reasons,
            "warnings": self.warnings,
            "triggered": self.triggered,
            "narrative": self.narrative,
            "evidence": self.evidence,
        }

    @property
    def rr_ratio(self) -> float:
        risk = abs(self.entry - self.stop)
        reward = abs(self.target - self.entry)
        return round(reward / risk, 1) if risk > 0 else 0.0

    @property
    def symbol(self) -> str:
        """Backward compatibility alias for ticker."""
        return self.ticker

    @property
    def tp(self) -> float:
        """Backward compatibility alias for target."""
        return self.target

    @property
    def sl(self) -> float:
        """Backward compatibility alias for stop."""
        return self.stop

    @property
    def full_strategy_name(self) -> str:
        """Combined strategy:signal_type for display."""
        return f"{self.strategy}: {self.signal_type}"
