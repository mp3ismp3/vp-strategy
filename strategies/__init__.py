"""Strategy base class and Signal dataclass."""

from dataclasses import dataclass, field


@dataclass
class Signal:
    """Unified signal output from any strategy."""
    symbol: str
    direction: str          # LONG / SHORT / WARNING
    strategy: str           # e.g. "VP: VA Rejection", "Trend: BULLISH"
    entry: float
    tp: float
    sl: float
    metadata: dict = field(default_factory=dict)


class BaseStrategy:
    """Abstract base class for all strategies.

    Subclass and implement `detect()` to create a new strategy.
    The scanner will auto-discover and run all registered strategies.
    """
    name: str = "base"

    def detect(self, df, cfg, market_ctx) -> list:
        """Detect signals for a single symbol's DataFrame.
        Returns list of Signal objects."""
        raise NotImplementedError
