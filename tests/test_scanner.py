"""Tests for scanner integration."""

from config import BINANCE_EQUITY_ADDITIONS, BINANCE_EQUITY_SYMBOLS, SYMBOLS, SYMBOL_CATEGORIES, SECTOR_MAP


class TestConfig:
    def test_all_symbols_mapped(self):
        missing = [s for s in SYMBOLS if s not in SECTOR_MAP]
        assert missing == [], f"Missing: {missing}"

    def test_binance_equity_universe_uses_underlying_tickers(self):
        assert len(BINANCE_EQUITY_SYMBOLS) == 137
        assert len(BINANCE_EQUITY_SYMBOLS) == len(set(BINANCE_EQUITY_SYMBOLS))
        assert all(not symbol.endswith(("USDT", "USD1")) for symbol in BINANCE_EQUITY_SYMBOLS)
        assert {"AAPL", "BRK-B", "SPCX", "SPY", "QQQ"} <= set(BINANCE_EQUITY_SYMBOLS)
        assert set(BINANCE_EQUITY_SYMBOLS) <= set(SYMBOLS)

    def test_binance_additions_have_exactly_one_industry(self):
        category_counts = {
            symbol: sum(symbol in symbols for symbols in SYMBOL_CATEGORIES.values())
            for symbol in BINANCE_EQUITY_ADDITIONS
        }
        assert len(BINANCE_EQUITY_ADDITIONS) == 92
        assert set(category_counts.values()) == {1}
        assert "Binance 美股合約" not in SYMBOL_CATEGORIES

    def test_binance_industries_use_sector_benchmarks(self):
        expected = {
            "CRDO": "SMH",
            "PAYP": "XLF",
            "ZM": "IGV",
            "FLEX": "XLI",
            "IREN": "SPY",
            "HOOD": "XLF",
            "WMT": "XLY",
            "LLY": "XLV",
            "RKLB": "XLI",
            "BE": "XLE",
            "SQQQ": "SQQQ",
            "SOXS": "SOXS",
            "TZA": "TZA",
            "UVXY": "UVXY",
        }
        assert {symbol: SECTOR_MAP[symbol] for symbol in expected} == expected

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
