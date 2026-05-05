"""Tests for vp_scanner.py — run with: python3 -m pytest test_vp_scanner.py -v"""

import numpy as np
import pandas as pd
from unittest.mock import patch, MagicMock
from datetime import datetime

import vp_scanner as vs


# ─── Helpers ─────────────────────────────────────────────────────────────────

def make_df(n=100, base_price=100, trend=0.0, vol_base=1_000_000):
    """Generate synthetic OHLCV DataFrame."""
    dates = pd.date_range(end=datetime.now(), periods=n, freq="B")
    np.random.seed(42)
    closes = base_price + np.cumsum(np.random.randn(n) * 1.5 + trend)
    highs = closes + np.abs(np.random.randn(n)) * 2
    lows = closes - np.abs(np.random.randn(n)) * 2
    opens = closes + np.random.randn(n) * 0.5
    volumes = (vol_base * (1 + np.random.rand(n))).astype(int)
    return pd.DataFrame({"Open": opens, "High": highs, "Low": lows, "Close": closes, "Volume": volumes}, index=dates)


# ─── calc_vp ─────────────────────────────────────────────────────────────────

class TestCalcVP:
    def test_basic(self):
        df = make_df(60)
        result = vs.calc_vp(df, 60, 0.68)
        assert result is not None
        assert result["val"] < result["poc"] < result["vah"]

    def test_zero_volume(self):
        df = make_df(60)
        df["Volume"] = 0
        assert vs.calc_vp(df, 60, 0.68) is None

    def test_vah_val_clamped(self):
        df = make_df(60)
        result = vs.calc_vp(df, 60, 0.68)
        assert result["vah"] <= df.tail(60)["High"].max()
        assert result["val"] >= df.tail(60)["Low"].min()


# ─── calc_atr ────────────────────────────────────────────────────────────────

class TestCalcATR:
    def test_basic(self):
        df = make_df(30)
        atr = vs.calc_atr(df, 14)
        assert atr is not None and atr > 0

    def test_insufficient_data(self):
        df = make_df(5)
        assert vs.calc_atr(df, 14) is None


# ─── calc_stock_factors ──────────────────────────────────────────────────────

class TestCalcStockFactors:
    @patch("vp_scanner.yf.Ticker")
    def test_basic(self, mock_ticker):
        mock_ticker.return_value.calendar = None
        df = make_df(100)
        cfg = {"vp_lookback": 60, "va_pct": 0.68, "atr_len": 14, "vol_ma_len": 21}
        factors = vs.calc_stock_factors(df, "TEST", cfg)
        assert "delta" in factors
        assert "va_narrow" in factors
        assert "poc_slope" in factors
        assert "vol_ratio" in factors
        assert factors["vol_ratio"] > 0

    @patch("vp_scanner.yf.Ticker")
    def test_earnings_parsing(self, mock_ticker):
        future_date = pd.Timestamp.now() + pd.Timedelta(days=2)
        mock_ticker.return_value.calendar = {"Earnings Date": [future_date]}
        df = make_df(100)
        cfg = {"vp_lookback": 60, "va_pct": 0.68, "atr_len": 14, "vol_ma_len": 21}
        factors = vs.calc_stock_factors(df, "TEST", cfg)
        assert factors["earnings_days"] is not None
        assert 1 <= factors["earnings_days"] <= 3


# ─── score_signal ────────────────────────────────────────────────────────────

class TestScoreSignal:
    def setup_method(self):
        self.good_factors = {"delta": 50000, "va_narrow": False, "poc_slope": 2.5, "vol_ratio": 1.8, "earnings_days": 30, "atr": 3.0}
        self.good_ctx = {"vix": 22.0, "spy_state": "in_va", "sector_momentum": {"SMH": 3.2}}

    def test_max_score(self):
        score, details = vs.score_signal("LONG", "VA Rejection", self.good_factors, self.good_ctx, "SMH", True)
        assert score == 5  # clamped

    def test_min_score(self):
        bad_factors = {"delta": -50000, "va_narrow": True, "poc_slope": -2.0, "vol_ratio": 1.0, "earnings_days": 2, "atr": 3.0}
        bad_ctx = {"vix": 12.0, "spy_state": "below_va", "sector_momentum": {"SMH": -3.0}}
        score, _ = vs.score_signal("LONG", "VA Rejection", bad_factors, bad_ctx, "SMH", False)
        assert score == 1  # clamped to minimum

    def test_vix_mean_reversion(self):
        # VA Rejection + VIX >= 20 → +1
        _, details = vs.score_signal("LONG", "VA Rejection", self.good_factors, self.good_ctx, "SMH", False)
        assert details["VIX"] == "✅"

    def test_vix_breakout(self):
        # Breakout Retest + VIX < 20 → +1
        ctx = dict(self.good_ctx, vix=15.0)
        _, details = vs.score_signal("LONG", "Breakout Retest", self.good_factors, ctx, "SMH", False)
        assert details["VIX"] == "✅"

    def test_earnings_penalty(self):
        # Use factors that don't max out, so penalty is visible
        mid_factors = dict(self.good_factors, earnings_days=2, vol_ratio=1.0, delta=-100)
        score_with, details = vs.score_signal("LONG", "VA Rejection", mid_factors, self.good_ctx, "SMH", False)
        mid_factors_no_earn = dict(mid_factors, earnings_days=30)
        score_without, _ = vs.score_signal("LONG", "VA Rejection", mid_factors_no_earn, self.good_ctx, "SMH", False)
        assert score_with < score_without
        assert "⚠️" in details["財報"]

    def test_va_narrow_penalty(self):
        factors = dict(self.good_factors, va_narrow=True)
        score_narrow, details = vs.score_signal("LONG", "VA Rejection", factors, self.good_ctx, "SMH", True)
        assert "⚠️" in details["VA窄"]

    def test_clamp_range(self):
        # Even with all negatives, minimum is 1
        worst = {"delta": -99999, "va_narrow": True, "poc_slope": -10, "vol_ratio": 0.5, "earnings_days": 1, "atr": 3.0}
        worst_ctx = {"vix": None, "spy_state": "below_va", "sector_momentum": {}}
        score, _ = vs.score_signal("LONG", "VA Rejection", worst, worst_ctx, "NONE", False)
        assert 1 <= score <= 5

    def test_short_direction(self):
        factors = {"delta": -50000, "va_narrow": False, "poc_slope": -2.5, "vol_ratio": 1.8, "earnings_days": None, "atr": 3.0}
        ctx = {"vix": 22.0, "spy_state": "below_va", "sector_momentum": {"SMH": -3.0}}
        score, details = vs.score_signal("SHORT", "VA Rejection", factors, ctx, "SMH", True)
        assert score >= 4
        assert details["Delta"] == "偏空✅"


# ─── detect_signals ──────────────────────────────────────────────────────────

class TestDetectSignals:
    def test_insufficient_data(self):
        df = make_df(10)
        assert vs.detect_signals(df, {"vp_lookback": 60, "va_pct": 0.68, "atr_len": 14, "vol_ma_len": 21, "max_sl_atr": 3.0, "long_only": False}) == []

    def test_returns_list(self):
        df = make_df(100)
        result = vs.detect_signals(df, {"vp_lookback": 60, "va_pct": 0.68, "atr_len": 14, "vol_ma_len": 21, "max_sl_atr": 3.0, "long_only": False})
        assert isinstance(result, list)

    def test_signal_tuple_format(self):
        """If any signal is generated, it should be a 5-tuple."""
        df = make_df(200)
        # Force a climax volume on last bar
        df.iloc[-1, df.columns.get_loc("Volume")] = int(df["Volume"].mean() * 3)
        result = vs.detect_signals(df, {"vp_lookback": 60, "va_pct": 0.68, "atr_len": 14, "vol_ma_len": 21, "max_sl_atr": 3.0, "long_only": False})
        for sig in result:
            assert len(sig) == 5


# ─── apply_scores ────────────────────────────────────────────────────────────

class TestApplyScores:
    def test_cross_lb_alignment(self):
        factors = {"delta": 50000, "va_narrow": False, "poc_slope": 2.0, "vol_ratio": 1.8, "earnings_days": None, "atr": 3.0}
        ctx = {"vix": 22.0, "spy_state": "in_va", "sector_momentum": {"SMH": 2.0}}
        all_signals = {
            60: [("NVDA", "LONG", "VA Rejection", 125, 132, 121, factors)],
            120: [("NVDA", "LONG", "Failed Auction", 125, 133, 120, factors)],
        }
        scored = vs.apply_scores(all_signals, ctx)
        # Both should get 雙LB ✅
        _, _, _, _, _, _, score_60, details_60 = scored[60][0]
        _, _, _, _, _, _, score_120, details_120 = scored[120][0]
        assert details_60["雙LB"] == "✅"
        assert details_120["雙LB"] == "✅"

    def test_warning_not_scored(self):
        all_signals = {
            60: [("NVDA", "WARNING", "Climax Volume", 125, 0, 2.8, {"delta": 0, "va_narrow": False, "poc_slope": 0, "vol_ratio": 2.8, "earnings_days": None, "atr": 3.0})],
            120: [],
        }
        ctx = {"vix": 18.0, "spy_state": "in_va", "sector_momentum": {}}
        scored = vs.apply_scores(all_signals, ctx)
        _, _, _, _, _, _, score, details = scored[60][0]
        assert score == 0
        assert details == {}


# ─── format_signals ──────────────────────────────────────────────────────────

class TestFormatSignals:
    def test_no_signals(self):
        result = vs.format_signals([], 60)
        assert "No signals" in result

    def test_with_signal(self):
        signals = [("NVDA", "LONG", "VA Rejection", 125.30, 132.50, 121.80, 4, {"大盤": "✅", "VIX": "✅"})]
        result = vs.format_signals(signals, 60)
        assert "NVDA" in result
        assert "⭐⭐⭐⭐" in result
        assert "(4/5)" in result
        assert "125.30" in result
        assert "大盤✅" in result

    def test_warning_format(self):
        signals = [("TSLA", "WARNING", "Climax Volume", 250.0, 0, 2.8, 0, {})]
        result = vs.format_signals(signals, 60)
        assert "⚠️" in result
        assert "2.8x" in result


# ─── send_telegram ───────────────────────────────────────────────────────────

class TestSendTelegram:
    @patch("vp_scanner.DRY_RUN", True)
    def test_dry_run_no_request(self):
        with patch("vp_scanner.requests.post") as mock_post:
            vs.send_telegram("test message")
            mock_post.assert_not_called()


# ─── SECTOR_MAP coverage ────────────────────────────────────────────────────

class TestSectorMap:
    def test_all_symbols_mapped(self):
        missing = [s for s in vs.CONFIG["symbols"] if s not in vs.SECTOR_MAP]
        assert missing == [], f"Symbols missing from SECTOR_MAP: {missing}"


# ─── Integration ─────────────────────────────────────────────────────────────

class TestIntegration:
    @patch("vp_scanner.yf.Ticker")
    def test_scan_symbol_full_flow(self, mock_ticker):
        mock_ticker.return_value.calendar = None
        df = make_df(200)
        # Force climax volume to guarantee at least one signal
        df.iloc[-1, df.columns.get_loc("Volume")] = int(df["Volume"].mean() * 3)
        cfg = dict(vs.CONFIG)
        state = {}
        ctx = {"vix": 18.0, "spy_state": "in_va", "sector_momentum": {"SMH": 1.5}}
        results = vs.scan_symbol("NVDA", df, cfg, [60, 120], state, "2026-05-05", ctx)
        # Should have at least climax volume warning
        all_sigs = results[60] + results[120]
        assert len(all_sigs) > 0
