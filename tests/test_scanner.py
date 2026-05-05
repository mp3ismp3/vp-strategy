"""Tests for scanner integration."""

from unittest.mock import patch
from config import SYMBOLS, SECTOR_MAP


class TestConfig:
    def test_all_symbols_mapped(self):
        missing = [s for s in SYMBOLS if s not in SECTOR_MAP]
        assert missing == [], f"Missing: {missing}"


class TestFormatSignals:
    def test_no_signals(self):
        from scanner import format_signals
        assert "No signals" in format_signals([], 60)

    def test_with_signal(self):
        from scanner import format_signals
        from strategies import Signal
        sig = Signal("NVDA", "LONG", "VP: VA Rejection", 125.3, 132.5, 121.8)
        result = format_signals([(sig, 4, {"大盤": "✅", "VIX": "✅"})], 60)
        assert "NVDA" in result
        assert "⭐⭐⭐⭐" in result
        assert "(4/5)" in result
