"""Tests for scanner integration."""

from config import SYMBOLS, SECTOR_MAP


class TestConfig:
    def test_all_symbols_mapped(self):
        missing = [s for s in SYMBOLS if s not in SECTOR_MAP]
        assert missing == [], f"Missing: {missing}"

    def test_scoring_weights_sum(self):
        from config import SCORING_WEIGHTS
        # Strategy weights (excluding regime) should be reasonable
        strat_weights = {k: v for k, v in SCORING_WEIGHTS.items() if k != "regime"}
        assert abs(sum(strat_weights.values()) + SCORING_WEIGHTS["regime"] - 1.0) < 1e-9

    def test_regime_trust_keys(self):
        from config import REGIME_STRATEGY_TRUST
        for regime, trust in REGIME_STRATEGY_TRUST.items():
            assert "VP" in trust
            assert "VWAP" in trust
            assert "TrendFollowing" in trust
