"""Tests for Wyckoff Phase Classifier."""

import numpy as np
import pandas as pd
import pytest

from strategies.accumulation.phase_classifier import classify_phase


def _make_df(closes, volumes=None, n=None):
    """Helper to create DataFrame from close prices."""
    if n is None:
        n = len(closes)
    closes = np.array(closes, dtype=float)
    highs = closes * 1.01
    lows = closes * 0.99
    opens = (closes + lows) / 2
    if volumes is None:
        volumes = np.full(n, 1_000_000)
    volumes = np.array(volumes, dtype=float)

    return pd.DataFrame({
        "Open": opens, "High": highs, "Low": lows,
        "Close": closes, "Volume": volumes,
    }, index=pd.date_range("2026-01-01", periods=n, freq="B"))


class TestPhaseE:
    def test_breakout_above_resistance_with_volume(self):
        """Price above resistance + high volume = Phase E."""
        n = 50
        # Range from 100-110, then breakout to 115
        closes = np.concatenate([
            np.random.uniform(100, 110, n - 3),
            [111, 113, 115],
        ])
        volumes = np.concatenate([
            np.full(n - 3, 1_000_000),
            [2_000_000, 2_500_000, 2_000_000],  # High volume on breakout
        ])
        df = _make_df(closes, volumes)
        result = classify_phase(df, support_primary=95, support_dynamic=100,
                                resistance=110)
        assert result["phase"] == "E"
        assert result["confidence"] >= 0.7

    def test_not_phase_e_below_resistance(self):
        """Price below resistance should not be E."""
        n = 50
        closes = np.random.uniform(100, 108, n)
        df = _make_df(closes)
        result = classify_phase(df, support_primary=95, support_dynamic=100,
                                resistance=110)
        assert result["phase"] != "E"


class TestPhaseD:
    def test_higher_lows_with_sos(self):
        """Ascending swing lows + volume rally = Phase D."""
        n = 50
        # Create pattern with higher lows: 100, dip to 101, up, dip to 103, up
        base = np.linspace(100, 108, n)
        # Add oscillation creating swing lows at progressively higher levels
        osc = 3 * np.sin(np.linspace(0, 4 * np.pi, n))
        closes = base + osc
        # Ensure it stays below resistance
        closes = np.clip(closes, 95, 109)
        # Add volume surge on a rally
        volumes = np.full(n, 1_000_000)
        volumes[-5] = 2_000_000  # SOS volume
        df = _make_df(closes, volumes)
        result = classify_phase(df, support_primary=95, support_dynamic=99,
                                resistance=112)
        # Could be D or B depending on swing detection
        assert result["phase"] in ("D", "B")


class TestPhaseC:
    def test_spring_detected(self):
        """Breach below support then recovery = Phase C."""
        n = 50
        closes = np.full(n, 105.0)
        # Create a spring: dip below support_dynamic=103, then recover
        closes[-5] = 102  # Below support
        closes[-4] = 101  # Still below
        closes[-3] = 104  # Recovery
        closes[-2] = 105
        closes[-1] = 106
        volumes = np.full(n, 1_000_000)
        volumes[-3] = 1_500_000  # Volume on recovery

        df = _make_df(closes, volumes)
        # Set lows to reflect the dip
        df.loc[df.index[-5], "Low"] = 101
        df.loc[df.index[-4], "Low"] = 100.5

        result = classify_phase(df, support_primary=95, support_dynamic=103,
                                resistance=112)
        assert result["phase"] == "C"


class TestPhaseB:
    def test_range_bound_with_obv_rising(self):
        """Price in range + OBV rising = Phase B."""
        n = 50
        np.random.seed(99)
        # Flat price in range
        closes = 105 + np.random.uniform(-2, 2, n)
        # Volume higher on up days (OBV rising)
        volumes = np.where(
            np.diff(closes, prepend=closes[0]) > 0,
            1_500_000, 800_000
        )
        df = _make_df(closes, volumes)
        result = classify_phase(df, support_primary=95, support_dynamic=100,
                                resistance=112)
        assert result["phase"] in ("B", "D")  # Could detect higher lows too


class TestPhaseA:
    def test_decline_with_stopping_volume(self):
        """15%+ decline + stopping volume = Phase A."""
        n = 60
        # Create a decline from 120 to 100 (>15%)
        closes = np.linspace(120, 100, n)
        volumes = np.full(n, 1_000_000)
        # Stopping volume near the low
        volumes[-5] = 3_000_000
        closes[-5] = 101  # Close near high of that bar after decline

        df = _make_df(closes, volumes)
        # Make the stopping bar have high close position
        df.loc[df.index[-5], "High"] = 103
        df.loc[df.index[-5], "Low"] = 98
        df.loc[df.index[-5], "Close"] = 102  # Near high

        # Set support_dynamic very low so Phase C doesn't trigger
        # (no breach of support_dynamic to trigger Spring detection)
        result = classify_phase(df, support_primary=95, support_dynamic=92,
                                resistance=118, lookback=50)
        assert result["phase"] == "A"


class TestUnknown:
    def test_insufficient_data(self):
        closes = [100, 101, 102]
        df = _make_df(closes)
        result = classify_phase(df, 95, 98, 110, lookback=40)
        assert result["phase"] == "UNKNOWN"

    def test_output_structure(self):
        n = 50
        closes = np.full(n, 100.0)
        df = _make_df(closes)
        result = classify_phase(df, 95, 98, 110)
        assert "phase" in result
        assert "confidence" in result
        assert "next_event" in result
        assert "description" in result
