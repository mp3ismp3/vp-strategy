"""Signal Quality Engine — Per-signal-type quality scoring + direction-fit ranking.

Design:
  - Each signal_type defines its own quality dimensions (0-100)
  - Direction fit multiplier based on bias alignment (0.4 - 1.0)
  - Rank = quality × direction_fit × R:R
  - No multi-signal fusion — each signal evaluated independently
"""

import numpy as np


# ─── Direction Fit Multiplier ───

def direction_fit(signal_direction: str, bias: str, strength: int) -> float:
    """How well does this signal's direction align with the market bias?

    Returns multiplier 0.4 - 1.0
    """
    if bias == "NEUTRAL" or strength == 0:
        return 0.7  # No clear bias — neutral multiplier

    same_direction = (
        (signal_direction == "LONG" and bias == "BULL") or
        (signal_direction == "SHORT" and bias == "BEAR")
    )

    if same_direction:
        return 0.85 + (strength * 0.05)  # 0.90, 0.95, 1.0
    else:
        return max(0.4, 0.7 - (strength * 0.15))  # 0.55, 0.40, 0.40


# ─── Per-Signal Quality Scoring ───

def score_va_rejection(signal, df) -> int:
    """VA Rejection quality: wick strength + volume + precision at VA edge.

    A great VA Rejection has:
    - Long wick (strong rejection) → 0-35
    - Above-average volume (confirmation) → 0-35
    - Precise touch of VAL/VAH (not far away) → 0-30
    """
    score = 0
    c, o, h, l = (float(df["Close"].iloc[-1]), float(df["Open"].iloc[-1]),
                  float(df["High"].iloc[-1]), float(df["Low"].iloc[-1]))
    body = abs(c - o)
    bar_range = h - l

    # Wick strength (0-35)
    if signal.direction == "LONG":
        wick = min(c, o) - l
    else:
        wick = h - max(c, o)

    if body > 0:
        wick_ratio = wick / body
        score += int(min(35, wick_ratio * 12))  # ratio 3.0 = 35
    elif wick > 0:
        score += 25  # doji with wick

    # Volume (0-35)
    vol_ratio = _vol_ratio(df)
    score += int(min(35, max(0, (vol_ratio - 0.8) * 20)))

    # Precision — how close to VA edge (via stop distance as proxy) (0-30)
    risk = abs(signal.entry - signal.stop)
    if signal.entry > 0 and risk > 0:
        risk_pct = risk / signal.entry * 100
        # Tighter stop = more precise = higher score
        if risk_pct <= 1.5:
            score += 30
        elif risk_pct <= 2.5:
            score += 22
        elif risk_pct <= 4.0:
            score += 15
        else:
            score += 5

    return min(100, score)


def score_failed_auction(signal, df) -> int:
    """Failed Auction quality: reclaim strength + volume + close position.

    A great Failed Auction has:
    - Strong close back inside VA (far from breach point) → 0-35
    - High volume on reclaim day → 0-35
    - Close in upper/lower half confirming direction → 0-30
    """
    score = 0
    c, o, h, l = (float(df["Close"].iloc[-1]), float(df["Open"].iloc[-1]),
                  float(df["High"].iloc[-1]), float(df["Low"].iloc[-1]))
    bar_range = h - l

    # Reclaim strength — how far back inside VA (body size as proxy) (0-35)
    body = abs(c - o)
    if bar_range > 0:
        body_ratio = body / bar_range
        score += int(min(35, body_ratio * 45))  # 0.8 body ratio = 35

    # Volume (0-35)
    vol_ratio = _vol_ratio(df)
    score += int(min(35, max(0, (vol_ratio - 0.8) * 20)))

    # Close position (0-30)
    if bar_range > 0:
        close_pos = (c - l) / bar_range
        if signal.direction == "LONG":
            score += int(min(30, close_pos * 35))
        else:
            score += int(min(30, (1 - close_pos) * 35))

    return min(100, score)


def score_breakout_retest(signal, df) -> int:
    """Breakout Retest quality: hold at level + volume + follow-through.

    A great Breakout Retest has:
    - Price held above/below the breakout level (wick test, not close breach) → 0-35
    - Decent volume on hold day → 0-30
    - Close in direction of breakout → 0-35
    """
    score = 0
    c, o, h, l = (float(df["Close"].iloc[-1]), float(df["Open"].iloc[-1]),
                  float(df["High"].iloc[-1]), float(df["Low"].iloc[-1]))
    bar_range = h - l

    # Hold quality — wick tested but close held (0-35)
    if signal.direction == "LONG":
        # Low tested but close above entry
        if bar_range > 0:
            hold_quality = (c - l) / bar_range  # Higher close = better hold
            score += int(min(35, hold_quality * 40))
    else:
        if bar_range > 0:
            hold_quality = (h - c) / bar_range
            score += int(min(35, hold_quality * 40))

    # Volume (0-30)
    vol_ratio = _vol_ratio(df)
    score += int(min(30, max(0, (vol_ratio - 0.7) * 17)))

    # Close confirms direction (0-35)
    bullish_close = c > o
    if (signal.direction == "LONG" and bullish_close) or \
       (signal.direction == "SHORT" and not bullish_close):
        body = abs(c - o)
        if bar_range > 0:
            score += int(min(35, (body / bar_range) * 45))

    return min(100, score)


def score_vwap_reclaim(signal, df) -> int:
    """VWAP Reclaim quality: distance above VWAP + volume + body strength.

    A great VWAP Reclaim has:
    - Closed meaningfully above/below VWAP (not just barely) → 0-30
    - Strong volume confirmation → 0-35
    - Large body (conviction close) → 0-35
    """
    score = 0
    c, o, h, l = (float(df["Close"].iloc[-1]), float(df["Open"].iloc[-1]),
                  float(df["High"].iloc[-1]), float(df["Low"].iloc[-1]))
    bar_range = h - l

    # Distance from VWAP (proxy via risk/entry) (0-30)
    # Larger move past VWAP = more conviction
    body = abs(c - o)
    from core.indicators import calc_atr
    atr = calc_atr(df, 14) or 1.0
    body_atr = body / atr
    score += int(min(30, body_atr * 25))  # body = 1.2x ATR → 30

    # Volume (0-35)
    vol_ratio = _vol_ratio(df)
    score += int(min(35, max(0, (vol_ratio - 0.8) * 20)))

    # Body strength — large body relative to bar range (0-35)
    if bar_range > 0:
        body_ratio = body / bar_range
        score += int(min(35, body_ratio * 43))

    return min(100, score)


def score_vwap_deviation(signal, df) -> int:
    """VWAP Deviation quality: band touch precision + reversal candle + wick.

    A great VWAP Deviation has:
    - Precise touch of ±2σ band (extremity) → 0-30
    - Strong reversal candle (long wick at extreme) → 0-40
    - Close back toward mean (not stuck at extreme) → 0-30
    Note: does NOT require high volume — this is mean reversion.
    """
    score = 0
    c, o, h, l = (float(df["Close"].iloc[-1]), float(df["Open"].iloc[-1]),
                  float(df["High"].iloc[-1]), float(df["Low"].iloc[-1]))
    bar_range = h - l
    body = abs(c - o)

    # Reversal candle quality — wick at extreme (0-40)
    if signal.direction == "LONG":
        wick = min(c, o) - l  # Lower wick
    else:
        wick = h - max(c, o)  # Upper wick

    if body > 0:
        wick_ratio = wick / body
        score += int(min(40, wick_ratio * 15))
    elif wick > 0:
        score += 30  # doji with wick at extreme

    # Band precision — how close to the band (via reasons or stop) (0-30)
    # Tighter stop = more precise band touch
    risk = abs(signal.entry - signal.stop)
    if signal.entry > 0 and risk > 0:
        risk_pct = risk / signal.entry * 100
        if risk_pct <= 1.5:
            score += 30
        elif risk_pct <= 2.5:
            score += 22
        elif risk_pct <= 4.0:
            score += 15
        else:
            score += 8

    # Close back toward mean (0-30)
    if bar_range > 0:
        if signal.direction == "LONG":
            score += int(min(30, ((c - l) / bar_range) * 35))
        else:
            score += int(min(30, ((h - c) / bar_range) * 35))

    return min(100, score)


def score_avwap_pullback(signal, df) -> int:
    """AVWAP Pullback quality: precision of pullback + hold + volume.

    A great AVWAP Pullback has:
    - Precise touch of AVWAP (low near AVWAP level) → 0-35
    - Bullish close above AVWAP → 0-35
    - Reasonable volume (not exhausted) → 0-30
    """
    score = 0
    c, o, h, l = (float(df["Close"].iloc[-1]), float(df["Open"].iloc[-1]),
                  float(df["High"].iloc[-1]), float(df["Low"].iloc[-1]))
    bar_range = h - l

    # Precision (0-35) — close is above entry, low tested near it
    if signal.entry > 0 and bar_range > 0:
        # How much of the bar is above entry
        above_ratio = (c - signal.entry) / bar_range if c > signal.entry else 0
        score += int(min(35, above_ratio * 50 + 15))

    # Bullish close (0-35)
    if c > o and bar_range > 0:
        body_ratio = (c - o) / bar_range
        score += int(min(35, body_ratio * 45 + 10))

    # Volume (0-30) — moderate is fine
    vol_ratio = _vol_ratio(df)
    if vol_ratio >= 0.8:
        score += int(min(30, vol_ratio * 15))

    return min(100, score)


def score_breakout_acceptance(signal, df) -> int:
    """Breakout Acceptance quality: days accepted + volume + distance from level.

    A great Breakout Acceptance has:
    - Multiple days above breakout level → 0-35
    - Strong volume on breakout → 0-35
    - Price moved meaningfully past level (not just barely) → 0-30
    """
    score = 0
    c = float(df["Close"].iloc[-1])

    # Days accepted (0-35) — already requires 2 days, bonus for more
    # Check how many days above/below the Donchian level
    closes = df["Close"].values[-5:]
    if signal.direction == "LONG":
        days = sum(1 for x in closes if x > signal.stop)
    else:
        days = sum(1 for x in closes if x < signal.stop)
    score += int(min(35, days * 10))

    # Volume (0-35)
    vol_ratio = _vol_ratio(df)
    score += int(min(35, max(0, (vol_ratio - 1.0) * 22)))

    # Distance past level (0-30)
    from core.indicators import calc_atr
    atr = calc_atr(df, 14) or 1.0
    distance = abs(c - signal.stop) / atr
    score += int(min(30, distance * 20))

    return min(100, score)


def score_ema_cross(signal, df) -> int:
    """EMA Cross quality: separation speed + price confirmation + volume.

    A great EMA Cross has:
    - EMAs diverging quickly (not flat cross) → 0-35
    - Price clearly on the right side → 0-35
    - Volume confirms → 0-30
    """
    score = 0
    c = float(df["Close"].iloc[-1])

    # EMA separation speed (0-35)
    from core.indicators import calc_ema, calc_atr
    ema20 = calc_ema(df["Close"], 20)
    ema50 = calc_ema(df["Close"], 50)
    atr = calc_atr(df, 14) or 1.0

    if ema20 and ema50:
        separation = abs(ema20 - ema50) / atr
        score += int(min(35, separation * 40))

    # Price confirmation (0-35) — price above/below both EMAs
    if ema20 and ema50:
        if signal.direction == "LONG" and c > ema20 > ema50:
            dist_above = (c - ema20) / atr
            score += int(min(35, 20 + dist_above * 15))
        elif signal.direction == "SHORT" and c < ema20 < ema50:
            dist_below = (ema20 - c) / atr
            score += int(min(35, 20 + dist_below * 15))

    # Volume (0-30)
    vol_ratio = _vol_ratio(df)
    score += int(min(30, max(0, (vol_ratio - 0.8) * 18)))

    return min(100, score)


def score_compression_breakout(signal, df) -> int:
    """Compression Breakout quality: compression depth + expansion ratio + directional clarity.

    A great Compression Breakout has:
    - Deep compression before (ATR was very low) → 0-35
    - Today's range is much larger than recent ATR → 0-35
    - Clear directional close (large body) → 0-30
    """
    score = 0
    c, o, h, l = (float(df["Close"].iloc[-1]), float(df["Open"].iloc[-1]),
                  float(df["High"].iloc[-1]), float(df["Low"].iloc[-1]))
    bar_range = h - l
    body = abs(c - o)

    # Compression depth (0-35) — how compressed was ATR before today
    from core.indicators import calc_atr
    atr_prev = calc_atr(df.iloc[:-1], 14) or 1.0
    atr_hist = calc_atr(df.iloc[:-20], 14) or atr_prev
    if atr_hist > 0:
        compression_ratio = atr_prev / atr_hist
        # Lower = more compressed = better
        depth_score = max(0, (1 - compression_ratio) * 50)
        score += int(min(35, depth_score))

    # Expansion ratio (0-35) — today's range vs recent ATR
    if atr_prev > 0:
        expansion = bar_range / atr_prev
        score += int(min(35, (expansion - 1.0) * 20))

    # Directional clarity (0-30) — large body relative to range
    if bar_range > 0:
        body_ratio = body / bar_range
        score += int(min(30, body_ratio * 38))

    return min(100, score)


# ─── Dispatcher ───

QUALITY_SCORERS = {
    "VA Rejection": score_va_rejection,
    "Failed Auction": score_failed_auction,
    "Breakout Retest": score_breakout_retest,
    "VWAP Reclaim": score_vwap_reclaim,
    "VWAP Deviation": score_vwap_deviation,
    "AVWAP Pullback": score_avwap_pullback,
    "Breakout Acceptance": score_breakout_acceptance,
    "EMA Cross": score_ema_cross,
    "Compression Breakout": score_compression_breakout,
}


def score_signal(signal, df, bias_info: dict) -> dict:
    """Score a single signal independently.

    Returns dict with quality (0-100), direction_fit, rr, rank, label.
    """
    # Quality: per-signal-type scoring
    scorer = QUALITY_SCORERS.get(signal.signal_type)
    if scorer:
        quality = scorer(signal, df)
    else:
        quality = 50  # Unknown signal type — neutral score

    # Direction fit multiplier
    d_fit = direction_fit(signal.direction, bias_info["bias"], bias_info["strength"])

    # R:R ratio
    rr = signal.rr_ratio

    # Rank score (higher = better trade opportunity)
    rank = round(quality / 100.0 * d_fit * max(rr, 0.5), 2)

    # Label
    adj_quality = int(quality * d_fit)
    label = _label(adj_quality, signal.direction)

    return {
        "quality": quality,
        "direction_fit": round(d_fit, 2),
        "rr": rr,
        "rank": rank,
        "label": label,
        "adj_quality": adj_quality,
    }


def _label(adj_quality: int, direction: str) -> str:
    """Generate human-readable label."""
    if direction in ("NEUTRAL", "WARNING"):
        return "Avoid"
    d = "Long" if direction == "LONG" else "Short"
    if adj_quality >= 75:
        return f"Strong {d}"
    elif adj_quality >= 60:
        return f"Moderate {d}"
    elif adj_quality >= 45:
        return f"Lean {d}"
    return "Avoid"


# ─── Helpers ───

def _vol_ratio(df, lookback=21) -> float:
    """Current volume / MA volume."""
    vol = df["Volume"].values
    if len(vol) < lookback + 1:
        return 1.0
    vol_ma = float(np.mean(vol[-lookback - 1:-1]))  # Exclude today from MA
    if vol_ma == 0:
        return 1.0
    return float(vol[-1] / vol_ma)
