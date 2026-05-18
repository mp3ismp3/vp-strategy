"""Abstract base class for all strategies."""

from abc import ABC, abstractmethod
from core.signal import StrategySignal


class BaseStrategy(ABC):
    name: str = "base"

    @abstractmethod
    def detect(self, df, cfg: dict, market_ctx: dict) -> list:
        """Detect signals. Returns list[StrategySignal]."""
        raise NotImplementedError
