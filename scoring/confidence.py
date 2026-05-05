"""Confidence scoring engine for signals."""

import pandas as pd
import yfinance as yf
from core.indicators import calc_vp, calc_atr, calc_delta, calc_vol_ratio
from strategies.inst_trend import calc_institutional_trend
from config import SECTOR_MAP


def calc_stock_factors(df, symbol, cfg):
    """Calculate per-stock scoring factors."""
    factors = {"delta": 0, "va_narrow": False, "inst_trend": "NEUTRAL", "inst_trend_score": 0, "vol_ratio": 0, "earnings_days": None, "atr": 0}

    factors["delta"] = calc_delta(df, 10)
    factors["vol_ratio"] = calc_vol_ratio(df, cfg["vol_ma_len"])

    vp = calc_vp(df, cfg["vp_lookback"], cfg["va_pct"])
    atr = calc_atr(df, cfg["atr_len"])
    factors["atr"] = atr if atr else 0
    if vp and atr and atr > 0:
        factors["va_narrow"] = (vp["vah"] - vp["val"]) / atr < 1.5

    # Institutional trend (replaces simple POC slope)
    trend = calc_institutional_trend(df)
    factors["inst_trend"] = trend["direction"]
    factors["inst_trend_score"] = trend["score"]
    factors["inst_trend_components"] = trend["components"]

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
    """Score a signal 1-5 based on institutional factors.
    Returns (score, details_dict)."""
    score = 0
    details = {}
    is_long = direction == "LONG"

    # 1. Market (SPY) alignment
    spy = market_ctx["spy_state"]
    if (is_long and spy in ("above_va", "in_va")) or (not is_long and spy in ("below_va", "in_va")):
        score += 1
        details["大盤"] = "✅"
    else:
        details["大盤"] = "❌"

    # 2. VIX environment
    vix = market_ctx.get("vix")
    if vix is not None:
        if sig_name in ("VP: VA Rejection", "VP: Failed Auction") and vix >= 20:
            score += 1
            details["VIX"] = "✅"
        elif sig_name == "VP: Breakout Retest" and vix < 20:
            score += 1
            details["VIX"] = "✅"
        else:
            details["VIX"] = "❌"
    else:
        details["VIX"] = "—"

    # 3. Volume strength > 1.5x
    vr = factors["vol_ratio"]
    if vr > 1.5:
        score += 1
        details["量能"] = f"{vr:.1f}x✅"
    else:
        details["量能"] = f"{vr:.1f}x❌"

    # 4. Institutional Trend alignment (replaces simple POC slope)
    trend = factors["inst_trend"]
    if (is_long and trend == "BULLISH") or (not is_long and trend == "BEARISH"):
        score += 1
        details["趨勢"] = f"{trend}✅"
    else:
        details["趨勢"] = f"{trend}❌"

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
