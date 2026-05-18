"""Tests for core indicators."""

import numpy as np
import pandas as pd
from datetime import datetime
from core.indicators import calc_vp, calc_atr, calc_vwap, calc_delta, calc_vol_ratio, find_swing_points


def make_df(n=100, base_price=100):
    dates = pd.date_range(end=datetime.now(), periods=n, freq="B")
    np.random.seed(42)
    closes = base_price + np.cumsum(np.random.randn(n) * 1.5)
    highs = closes + np.abs(np.random.randn(n)) * 2
    lows = closes - np.abs(np.random.randn(n)) * 2
    opens = closes + np.random.randn(n) * 0.5
    volumes = (1_000_000 * (1 + np.random.rand(n))).astype(int)
    return pd.DataFrame({"Open": opens, "High": highs, "Low": lows, "Close": closes, "Volume": volumes}, index=dates)


class TestCalcVP:
    def test_basic(self):
        r = calc_vp(make_df(60), 60, 0.68)
        assert r is not None
        assert r["val"] < r["poc"] < r["vah"]

    def test_zero_volume(self):
        assert calc_vp(make_df(60).assign(Volume=0), 60, 0.68) is None

    def test_clamped(self):
        df = make_df(60)
        r = calc_vp(df, 60, 0.68)
        assert r["vah"] <= df.tail(60)["High"].max()
        assert r["val"] >= df.tail(60)["Low"].min()


class TestCalcATR:
    def test_basic(self):
        assert calc_atr(make_df(30), 14) > 0

    def test_insufficient(self):
        assert calc_atr(make_df(5), 14) is None


class TestCalcVWAP:
    def test_basic(self):
        v = calc_vwap(make_df(60), 20)
        assert v is not None and v > 0

    def test_zero_volume(self):
        assert calc_vwap(make_df(60).assign(Volume=0), 20) is None


class TestCalcDelta:
    def test_returns_float(self):
        assert isinstance(calc_delta(make_df(20), 10), float)


class TestCalcVolRatio:
    def test_basic(self):
        assert calc_vol_ratio(make_df(30), 21) > 0


class TestFindSwingPoints:
    def test_finds_swings(self):
        df = make_df(100)
        highs, lows = find_swing_points(df, 5)
        assert len(highs) > 0
        assert len(lows) > 0


# ─── New indicator tests ─────────────────────────────────────────────────────

from core.indicators import calc_anchored_vwap, calc_vwap_bands, calc_donchian, calc_ema, is_atr_compressed


class TestCalcAnchoredVWAP:
    def test_basic(self):
        df = make_df(60)
        v = calc_anchored_vwap(df, 0)
        assert v is not None and v > 0

    def test_negative_index(self):
        df = make_df(60)
        v = calc_anchored_vwap(df, -30)
        assert v is not None and v > 0

    def test_out_of_range(self):
        df = make_df(10)
        assert calc_anchored_vwap(df, 100) is None


class TestCalcVWAPBands:
    def test_basic(self):
        r = calc_vwap_bands(make_df(60), 60)
        assert r is not None
        assert r["lower"] < r["vwap"] < r["upper"]
        assert r["std"] > 0

    def test_zero_volume(self):
        assert calc_vwap_bands(make_df(60).assign(Volume=0), 60) is None


class TestCalcDonchian:
    def test_basic(self):
        df = make_df(30)
        r = calc_donchian(df, 20)
        assert r is not None
        assert r["lower"] < r["mid"] < r["upper"]

    def test_insufficient(self):
        assert calc_donchian(make_df(5), 20) is None


class TestCalcEMA:
    def test_basic(self):
        df = make_df(60)
        v = calc_ema(df["Close"], 20)
        assert v is not None and v > 0

    def test_insufficient(self):
        df = make_df(5)
        assert calc_ema(df["Close"], 20) is None


class TestIsATRCompressed:
    def test_not_compressed_normal(self):
        assert is_atr_compressed(make_df(60)) is False

    def test_compressed(self):
        df = make_df(60)
        # Flatten last 20 bars
        for i in range(-20, 0):
            df.iloc[i, df.columns.get_loc("High")] = df.iloc[i]["Close"] + 0.01
            df.iloc[i, df.columns.get_loc("Low")] = df.iloc[i]["Close"] - 0.01
        assert is_atr_compressed(df) is True
