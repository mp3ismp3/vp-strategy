"""Tests for scoring engine."""

from scoring.confidence import score_signal


class TestScoreSignal:
    def setup_method(self):
        self.good_factors = {
            "delta": 50000, "va_narrow": False, "inst_trend": "BULLISH",
            "inst_trend_score": 3, "vol_ratio": 1.8, "earnings_days": 30, "atr": 3.0,
            "inst_trend_components": {},
        }
        self.good_ctx = {"vix": 22.0, "spy_state": "in_va", "sector_momentum": {"SMH": 3.2}}

    def test_max_score(self):
        score, _ = score_signal("LONG", "VP: VA Rejection", self.good_factors, self.good_ctx, "SMH", True)
        assert score == 5

    def test_min_score(self):
        bad = {"delta": -50000, "va_narrow": True, "inst_trend": "BEARISH", "inst_trend_score": -3, "vol_ratio": 1.0, "earnings_days": 2, "atr": 3.0, "inst_trend_components": {}}
        bad_ctx = {"vix": 12.0, "spy_state": "below_va", "sector_momentum": {"SMH": -3.0}}
        score, _ = score_signal("LONG", "VP: VA Rejection", bad, bad_ctx, "SMH", False)
        assert score == 1

    def test_vix_mean_reversion(self):
        _, d = score_signal("LONG", "VP: VA Rejection", self.good_factors, self.good_ctx, "SMH", False)
        assert d["VIX"] == "✅"

    def test_vix_breakout(self):
        ctx = dict(self.good_ctx, vix=15.0)
        _, d = score_signal("LONG", "VP: Breakout Retest", self.good_factors, ctx, "SMH", False)
        assert d["VIX"] == "✅"

    def test_earnings_penalty(self):
        mid = dict(self.good_factors, earnings_days=2, vol_ratio=1.0, delta=-100, inst_trend="NEUTRAL")
        score_with, d = score_signal("LONG", "VP: VA Rejection", mid, self.good_ctx, "SMH", False)
        mid_no = dict(mid, earnings_days=30)
        score_without, _ = score_signal("LONG", "VP: VA Rejection", mid_no, self.good_ctx, "SMH", False)
        assert score_with < score_without
        assert "⚠️" in d["財報"]

    def test_inst_trend_replaces_poc_slope(self):
        # BULLISH trend + LONG = +1
        _, d = score_signal("LONG", "VP: VA Rejection", self.good_factors, self.good_ctx, "SMH", False)
        assert "BULLISH✅" in d["趨勢"]

    def test_short_with_bearish_trend(self):
        factors = dict(self.good_factors, delta=-50000, inst_trend="BEARISH", inst_trend_score=-3)
        ctx = {"vix": 22.0, "spy_state": "below_va", "sector_momentum": {"SMH": -3.0}}
        score, d = score_signal("SHORT", "VP: VA Rejection", factors, ctx, "SMH", True)
        assert score >= 4
        assert "BEARISH✅" in d["趨勢"]

    def test_clamp_range(self):
        worst = {"delta": -99, "va_narrow": True, "inst_trend": "BEARISH", "inst_trend_score": -4, "vol_ratio": 0.5, "earnings_days": 1, "atr": 3.0, "inst_trend_components": {}}
        score, _ = score_signal("LONG", "VP: VA Rejection", worst, {"vix": None, "spy_state": "below_va", "sector_momentum": {}}, "X", False)
        assert 1 <= score <= 5
