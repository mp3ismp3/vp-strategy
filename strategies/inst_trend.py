"""Institutional Trend indicator.

Hierarchical logic (mirrors institutional decision process):
  Gate (required): Structure Breakout + Volume Confirmation
  Bonus: VWAP Bias + Pullback Holds + Liquidity Sweep

Bullish: close > swing high + volume > 1.5x avg + (VWAP/pullback/sweep)
Bearish: close < swing low + volume > 1.5x avg + (VWAP/pullback/sweep)
Neutral: no confirmed breakout
"""

from core.base_strategy import BaseStrategy
from core.signal import StrategySignal
from core.indicators import calc_vwap, find_swing_points


def _market_structure(df, lookback=20, swing_len=5):
    """Check if price broke a swing high or swing low.
    Returns: 'bullish', 'bearish', or 'neutral'."""
    swing_highs, swing_lows = find_swing_points(df.tail(lookback + swing_len * 2), swing_len)
    last_close = float(df["Close"].iloc[-1])

    broke_high = swing_highs and last_close > swing_highs[-1][1]
    broke_low = swing_lows and last_close < swing_lows[-1][1]

    if broke_high and not broke_low:
        return "bullish"
    if broke_low and not broke_high:
        return "bearish"
    return "neutral"


def _volume_on_breakout(df, vol_ma_len=21):
    """Check if today's volume > 1.5x average (breakout confirmation)."""
    vol_ma = df["Volume"].iloc[-vol_ma_len:].mean()
    if vol_ma == 0:
        return False
    return float(df["Volume"].iloc[-1] / vol_ma) > 1.5


def _volume_confirmation(df, vol_ma_len=21):
    """Volume confirmation as directional string for scoring compatibility."""
    if not _volume_on_breakout(df, vol_ma_len):
        return "neutral"
    structure = _market_structure(df)
    return structure if structure != "neutral" else "neutral"


def _vwap_bias(df, lookback=20):
    """Price vs VWAP. Returns: 'bullish', 'bearish', or 'neutral'."""
    vwap = calc_vwap(df, lookback)
    if vwap is None:
        return "neutral"
    close = float(df["Close"].iloc[-1])
    if close > vwap:
        return "bullish"
    elif close < vwap:
        return "bearish"
    return "neutral"


def _pullback_holds(df, swing_len=5):
    """Check if recent pullback held above breakout level.
    Bullish: low of last 3 bars held above swing high (new support).
    Bearish: high of last 3 bars held below swing low (new resistance).
    Returns: 'bullish', 'bearish', or None."""
    swing_highs, swing_lows = find_swing_points(df.tail(30 + swing_len * 2), swing_len)

    if swing_highs:
        key_high = swing_highs[-1][1]
        last_close = float(df["Close"].iloc[-1])
        recent_low = float(df["Low"].iloc[-3:].min())
        if last_close > key_high and recent_low >= key_high * 0.995:
            return "bullish"

    if swing_lows:
        key_low = swing_lows[-1][1]
        last_close = float(df["Close"].iloc[-1])
        recent_high = float(df["High"].iloc[-3:].max())
        if last_close < key_low and recent_high <= key_low * 1.005:
            return "bearish"

    return None


def _liquidity_sweep(df, lookback=20):
    """Detect sweep of swing point liquidity with reversal.
    Returns: 'bull_sweep', 'bear_sweep', or None."""
    if len(df) < lookback + 2:
        return None

    scan_df = df.tail(lookback)
    swing_highs, swing_lows = find_swing_points(scan_df.iloc[:-2], lookback=3)
    last = df.iloc[-1]
    prev = df.iloc[-2]

    if swing_lows:
        key_low = swing_lows[-1][1]
        if (prev["Low"] < key_low or last["Low"] < key_low) and last["Close"] > key_low and last["Close"] > last["Open"]:
            return "bull_sweep"

    if swing_highs:
        key_high = swing_highs[-1][1]
        if (prev["High"] > key_high or last["High"] > key_high) and last["Close"] < key_high and last["Close"] < last["Open"]:
            return "bear_sweep"

    return None


def calc_institutional_trend(df):
    """Institutional trend with hierarchical logic:

    Gate (must pass): structure breakout + volume > 1.5x
    Bonus: VWAP confirms, pullback holds, liquidity sweep

    Without gate → NEUTRAL (structure break without volume = weak, score ±1)
    With gate → BULLISH/BEARISH (score ±2 to ±5)
    """
    components = {
        "market_structure": _market_structure(df),
        "volume_confirm": _volume_confirmation(df),
        "volume_breakout": _volume_on_breakout(df),
        "vwap_bias": _vwap_bias(df),
        "pullback_holds": _pullback_holds(df),
        "liquidity_sweep": _liquidity_sweep(df),
    }

    structure = components["market_structure"]
    has_volume = components["volume_breakout"]
    vwap = components["vwap_bias"]
    pullback = components["pullback_holds"]
    sweep = components["liquidity_sweep"]

    score = 0

    if structure == "bullish" and has_volume:
        score = 2
        if vwap == "bullish":
            score += 1
        if pullback == "bullish":
            score += 1
        if sweep == "bull_sweep":
            score += 1
    elif structure == "bearish" and has_volume:
        score = -2
        if vwap == "bearish":
            score -= 1
        if pullback == "bearish":
            score -= 1
        if sweep == "bear_sweep":
            score -= 1
    elif structure == "bullish":
        score = 1  # Structure only, no volume = weak
    elif structure == "bearish":
        score = -1

    if score >= 2:
        direction = "BULLISH"
    elif score <= -2:
        direction = "BEARISH"
    else:
        direction = "NEUTRAL"

    return {"direction": direction, "score": score, "components": components}


class InstitutionalTrend(BaseStrategy):
    """Provides directional bias for scoring engine."""
    name = "InstitutionalTrend"

    def detect(self, df, cfg, market_ctx) -> list:
        return []
