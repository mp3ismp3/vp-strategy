"""Institutional Trend indicator.

Combines 4 dimensions to determine institutional directional bias:
1. Market Structure — HH/HL (bullish) vs LH/LL (bearish)
2. Liquidity Sweep — Sweep of prior high/low with reversal
3. Volume Confirmation — Trend-direction bars have higher volume
4. VWAP Bias — Price position relative to rolling VWAP
"""

from strategies import BaseStrategy, Signal
from core.indicators import calc_atr, calc_vwap, find_swing_points, calc_vol_ratio
import numpy as np


def _market_structure(df, lookback=20, swing_len=5):
    """Determine market structure from swing points.
    Includes Break of Structure (BOS) detection for early trend shifts.
    Returns: 'bullish', 'bearish', or 'neutral'."""
    swing_highs, swing_lows = find_swing_points(df.tail(lookback + swing_len * 2), swing_len)
    if len(swing_highs) < 2 or len(swing_lows) < 2:
        # BOS detection: even with insufficient swings, check if price broke prior structure
        if len(swing_highs) >= 1 and len(swing_lows) >= 1:
            last_close = float(df["Close"].iloc[-1])
            # Broke above last swing high = partial bullish
            if last_close > swing_highs[-1][1]:
                return "bullish"
            # Broke below last swing low = partial bearish
            if last_close < swing_lows[-1][1]:
                return "bearish"
        return "neutral"

    hh = swing_highs[-1][1] > swing_highs[-2][1]
    hl = swing_lows[-1][1] > swing_lows[-2][1]
    lh = swing_highs[-1][1] < swing_highs[-2][1]
    ll = swing_lows[-1][1] < swing_lows[-2][1]

    if hh and hl:
        return "bullish"
    if lh and ll:
        return "bearish"

    # BOS: price broke the last Lower High (bullish shift) or Higher Low (bearish shift)
    last_close = float(df["Close"].iloc[-1])
    if lh and last_close > swing_highs[-1][1]:
        return "bullish"
    if hl and last_close < swing_lows[-1][1]:
        return "bearish"

    return "neutral"


def _liquidity_sweep(df, lookback=20):
    """Detect if recent price action swept prior liquidity using swing points.
    Uses swing highs/lows as key liquidity levels (not simple max/min).
    Returns: 'bull_sweep' (swept low then reversed up),
             'bear_sweep' (swept high then reversed down), or None."""
    if len(df) < lookback + 2:
        return None

    # Use swing points as liquidity levels (more meaningful than raw max/min)
    scan_df = df.tail(lookback)
    swing_highs, swing_lows = find_swing_points(scan_df.iloc[:-2], lookback=3)

    last = df.iloc[-1]
    prev = df.iloc[-2]

    # Bull sweep: price swept below a swing low then closed back above it
    if swing_lows:
        key_low = swing_lows[-1][1]  # Most recent swing low
        if (prev["Low"] < key_low or last["Low"] < key_low) and last["Close"] > key_low and last["Close"] > last["Open"]:
            return "bull_sweep"

    # Bear sweep: price swept above a swing high then closed back below it
    if swing_highs:
        key_high = swing_highs[-1][1]  # Most recent swing high
        if (prev["High"] > key_high or last["High"] > key_high) and last["Close"] < key_high and last["Close"] < last["Open"]:
            return "bear_sweep"

    return None


def _volume_confirmation(df, lookback=10):
    """Compare average volume on up-days vs down-days.
    Returns: 'bullish', 'bearish', or 'neutral'."""
    tail = df.tail(lookback)
    up_mask = tail["Close"] > tail["Open"]
    down_mask = tail["Close"] < tail["Open"]
    up_vol = tail.loc[up_mask, "Volume"].mean() if up_mask.any() else 0
    down_vol = tail.loc[down_mask, "Volume"].mean() if down_mask.any() else 0
    if up_vol == 0 and down_vol == 0:
        return "neutral"
    ratio = up_vol / down_vol if down_vol > 0 else 2.0
    if ratio > 1.3:
        return "bullish"
    elif ratio < 0.77:
        return "bearish"
    return "neutral"


def _vwap_bias(df, lookback=20):
    """Price position relative to VWAP.
    Returns: 'bullish', 'bearish', or 'neutral'."""
    vwap = calc_vwap(df, lookback)
    if vwap is None:
        return "neutral"
    close = float(df["Close"].iloc[-1])
    atr = calc_atr(df, 14)
    if atr is None or atr == 0:
        return "neutral"
    diff = (close - vwap) / atr
    if diff > 0.5:
        return "bullish"
    elif diff < -0.5:
        return "bearish"
    return "neutral"


def calc_institutional_trend(df):
    """Calculate institutional trend from 4 dimensions.
    Returns dict with direction, score (-4 to +4), and component details."""
    components = {
        "market_structure": _market_structure(df),
        "liquidity_sweep": _liquidity_sweep(df),
        "volume_confirm": _volume_confirmation(df),
        "vwap_bias": _vwap_bias(df),
    }

    score = 0
    # Market Structure: strongest weight
    if components["market_structure"] == "bullish":
        score += 1
    elif components["market_structure"] == "bearish":
        score -= 1

    # Liquidity Sweep
    if components["liquidity_sweep"] == "bull_sweep":
        score += 1
    elif components["liquidity_sweep"] == "bear_sweep":
        score -= 1

    # Volume Confirmation
    if components["volume_confirm"] == "bullish":
        score += 1
    elif components["volume_confirm"] == "bearish":
        score -= 1

    # VWAP Bias
    if components["vwap_bias"] == "bullish":
        score += 1
    elif components["vwap_bias"] == "bearish":
        score -= 1

    if score >= 2:
        direction = "BULLISH"
    elif score <= -2:
        direction = "BEARISH"
    else:
        direction = "NEUTRAL"

    return {"direction": direction, "score": score, "components": components}


class InstitutionalTrend(BaseStrategy):
    """Institutional trend provides directional bias for scoring.
    BOS detection is used as a scoring bonus, not a standalone signal."""
    name = "InstitutionalTrend"

    def detect(self, df, cfg, market_ctx) -> list:
        return []
