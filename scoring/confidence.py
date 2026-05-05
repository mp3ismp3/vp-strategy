"""Confidence scoring engine for signals.

Regime-aware scoring:
  RANGE: VA Rejection / Failed Auction are primary signals
  TREND: Breakout Retest / VA Rejection as pullback entry
  EXPANSION: VP signals unreliable, cap scores
"""

import pandas as pd
import yfinance as yf
from core.indicators import calc_vp, calc_atr, calc_delta, calc_vol_ratio
from strategies.inst_trend import calc_institutional_trend
from config import SECTOR_MAP


def detect_regime(df, cfg, market_ctx):
    """Detect market regime: 'range', 'trend', or 'expansion'.

    Range: POC flat + price in VA + low VIX
    Trend: POC migrating + HH/HL or LH/LL (inst_trend BULLISH/BEARISH)
    Expansion: VIX high + price outside VA + VA being broken
    """
    vp = calc_vp(df, cfg["vp_lookback"], cfg["va_pct"])
    atr = calc_atr(df, cfg["atr_len"])
    vix = market_ctx.get("vix")

    if not vp or not atr or atr == 0:
        return "range"  # Default fallback

    last_close = float(df["Close"].iloc[-1])
    in_va = vp["val"] < last_close < vp["vah"]
    outside_va = not in_va

    # POC slope
    poc_flat = True
    poc_migrating = False
    if len(df) > cfg["vp_lookback"] + 20:
        vp_old = calc_vp(df.iloc[:-20], cfg["vp_lookback"], cfg["va_pct"])
        if vp_old:
            poc_change = abs(vp["poc"] - vp_old["poc"])
            poc_flat = poc_change < atr * 0.3
            poc_migrating = poc_change > atr * 0.5

    # Expansion: VIX high + outside VA
    if vix is not None and vix >= 25 and outside_va:
        return "expansion"

    # Trend: POC migrating or institutional trend confirmed
    trend = calc_institutional_trend(df)
    if trend["direction"] in ("BULLISH", "BEARISH") and (poc_migrating or outside_va):
        return "trend"

    # Range: POC flat + in VA
    if poc_flat and in_va:
        return "range"

    # Ambiguous → default to range (safer)
    return "range"


def calc_stock_factors(df, symbol, cfg, market_ctx):
    """Calculate per-stock scoring factors including regime."""
    factors = {
        "delta": 0, "va_narrow": False,
        "inst_trend": "NEUTRAL", "inst_trend_score": 0,
        "vol_ratio": 0, "earnings_days": None, "atr": 0,
        "regime": "range",
    }

    factors["delta"] = calc_delta(df, 10)
    factors["vol_ratio"] = calc_vol_ratio(df, cfg["vol_ma_len"])

    vp = calc_vp(df, cfg["vp_lookback"], cfg["va_pct"])
    atr = calc_atr(df, cfg["atr_len"])
    factors["atr"] = atr if atr else 0
    if vp and atr and atr > 0:
        factors["va_narrow"] = (vp["vah"] - vp["val"]) / atr < 1.5

    # Institutional trend
    trend = calc_institutional_trend(df)
    factors["inst_trend"] = trend["direction"]
    factors["inst_trend_score"] = trend["score"]
    factors["inst_trend_components"] = trend["components"]

    # Regime detection
    factors["regime"] = detect_regime(df, cfg, market_ctx)

    # Earnings date
    try:
        tk = yf.Ticker(symbol)
        cal = tk.calendar
        if cal is not None:
            ed = None
            if isinstance(cal, pd.DataFrame) and "Earnings Date" in cal.columns:
                ed = pd.Timestamp(cal["Earnings Date"].iloc[0])
            elif isinstance(cal, dict) and "Earnings Date" in cal:
                dates = cal["Earnings Date"]
                ed = pd.Timestamp(dates[0]) if isinstance(dates, list) else pd.Timestamp(dates)
            if ed is not None:
                factors["earnings_days"] = (ed - pd.Timestamp.now()).days
    except Exception:
        pass

    return factors


def score_signal(direction, sig_name, factors, market_ctx, sector_etf, has_same_dir_other_lb):
    """Score a signal 1-5 using regime-aware institutional logic.

    Gate (must-have) depends on regime + signal type:
      RANGE + mean-reversion: volume + regime=range
      TREND + breakout: volume + trend direction
      EXPANSION: all VP signals capped (VP unreliable)

    Returns (score, details_dict).
    """
    score = 0
    details = {}
    is_long = direction == "LONG"
    gate_count = 0
    regime = factors.get("regime", "range")

    # ═══ REGIME DISPLAY ═══
    regime_label = {"range": "📦Range", "trend": "📈Trend", "expansion": "🔥Expansion"}
    details["Regime"] = regime_label.get(regime, regime)

    # ═══ MUST-HAVE (Gate conditions) ═══

    # 1. Volume strength > 1.5x (always required)
    vr = factors["vol_ratio"]
    if vr > 1.5:
        score += 1
        gate_count += 1
        details["量能"] = f"{vr:.1f}x✅"
    else:
        details["量能"] = f"{vr:.1f}x❌"

    # 2. Regime-specific gate
    trend = factors["inst_trend"]
    if sig_name == "VP: Breakout Retest":
        # Breakout needs trend confirmation
        if (is_long and trend == "BULLISH") or (not is_long and trend == "BEARISH"):
            score += 1
            gate_count += 1
            details["趨勢"] = f"{trend}✅"
        else:
            details["趨勢"] = f"{trend}❌"
    elif sig_name in ("VP: VA Rejection", "VP: Failed Auction"):
        # Mean-reversion needs range regime
        if regime == "range":
            score += 1
            gate_count += 1
        elif regime == "trend":
            pass  # Not ideal but not blocked (VA as pullback)
        # Trend alignment bonus for mean-reversion signals
        if (is_long and trend == "BULLISH") or (not is_long and trend == "BEARISH"):
            details["趨勢"] = f"{trend}✅"
        else:
            details["趨勢"] = f"{trend}❌"

    # ═══ NICE-TO-HAVE (Bonus conditions) ═══

    # 3. VIX environment (signal-type aware)
    vix = market_ctx.get("vix")
    if vix is not None:
        is_mean_reversion = sig_name in ("VP: VA Rejection", "VP: Failed Auction")
        vix_good = (is_mean_reversion and vix >= 20) or (not is_mean_reversion and vix < 20)
        if vix_good:
            score += 1
            details["VIX"] = "✅"
        else:
            details["VIX"] = "❌"
    else:
        details["VIX"] = "—"

    # 4. Market (SPY) alignment
    spy = market_ctx["spy_state"]
    if (is_long and spy in ("above_va", "in_va")) or (not is_long and spy in ("below_va", "in_va")):
        score += 1
        details["大盤"] = "✅"
    else:
        details["大盤"] = "❌"

    # 5. Sector momentum
    mom = market_ctx["sector_momentum"].get(sector_etf)
    if mom is not None:
        if (is_long and mom > 0) or (not is_long and mom < 0):
            score += 1
            details["板塊"] = "✅"
        else:
            details["板塊"] = "❌"
    else:
        details["板塊"] = "—"

    # 6. 60D/120D same direction
    if has_same_dir_other_lb:
        score += 1
        details["雙LB"] = "✅"
    else:
        details["雙LB"] = "❌"

    # 7. Delta alignment
    delta = factors["delta"]
    if (is_long and delta > 0) or (not is_long and delta < 0):
        score += 1
        details["Delta"] = f"{'偏多' if delta > 0 else '偏空'}✅"
    else:
        details["Delta"] = f"{'偏多' if delta > 0 else '偏空'}❌"

    # ═══ GATE: cap score (before penalties) ═══
    if regime == "expansion":
        score = min(score, 2)
    elif gate_count == 0:
        score = min(score, 2)
    elif gate_count == 1:
        score = min(score, 3)

    # ═══ PENALTY (applied after cap so they always bite) ═══

    # -1: Earnings within 3 days
    ed = factors["earnings_days"]
    if ed is not None and 0 <= ed <= 3:
        score -= 1
        details["財報"] = f"⚠️{ed}天後"
    elif ed is not None and 0 <= ed <= 7:
        details["財報"] = f"{ed}天後"

    # -1: VA too narrow
    if factors["va_narrow"]:
        score -= 1
        details["VA窄"] = "⚠️"

    score = max(1, min(5, score))
    return score, details
