"""Wyckoff Phase Classifier — Determines current accumulation phase (A-E).

Phases:
  A (Stopping)   — Downtrend halting, SC + AR forming
  B (Building)   — Range-bound absorption, supply diminishing
  C (Spring)     — Shakeout / test of lows, or approaching spring zone
  D (Trending)   — Higher lows forming, SOS rallies
  E (Markup)     — Breakout above range, accumulation complete
  UNKNOWN        — Does not fit accumulation structure
"""

import numpy as np

from core.indicators import find_swing_points
from strategies.accumulation.config import (
    DEFAULT_LOOKBACK,
    SOS_VOL_MULT,
    SWING_LOOKBACK,
    VOL_MEDIAN_WINDOW,
)


def classify_phase(df, support_primary, support_dynamic, resistance,
                   lookback=DEFAULT_LOOKBACK):
    """Classify the current Wyckoff accumulation phase.

    Args:
        df: Full DataFrame (OHLCV)
        support_primary: SC low (absolute floor)
        support_dynamic: Recent swing low
        resistance: Range high (AR level)
        lookback: Analysis window

    Returns:
        dict with phase, confidence, next_event, description
    """
    if len(df) < lookback + 10:
        return _unknown("資料不足")

    tail = df.tail(lookback)
    c = tail["Close"].values.astype(float)
    h = tail["High"].values.astype(float)
    l = tail["Low"].values.astype(float)
    v = tail["Volume"].values.astype(float)
    n = len(c)

    last_close = float(c[-1])
    vol_median = float(np.median(v[-VOL_MEDIAN_WINDOW:])) if n >= VOL_MEDIAN_WINDOW else float(np.median(v))

    # Swing points for structure analysis
    swing_highs, swing_lows = find_swing_points(tail, SWING_LOOKBACK)

    # Check phases in priority order (E → D → C → B → A → UNKNOWN)

    # ─── Phase E: Markup (breakout above resistance) ───
    result = _check_phase_e(c, v, last_close, resistance, vol_median)
    if result:
        return result

    # ─── Phase D: Trending (higher lows + SOS) ───
    result = _check_phase_d(c, v, h, l, swing_lows, swing_highs,
                            last_close, resistance, vol_median, support_dynamic)
    if result:
        return result

    # ─── Phase C: Spring zone ───
    result = _check_phase_c(c, v, l, last_close, support_dynamic,
                            support_primary, vol_median, n)
    if result:
        return result

    # ─── Phase B: Building ───
    result = _check_phase_b(c, v, l, last_close, support_primary,
                            resistance, vol_median, swing_lows, n)
    if result:
        return result

    # ─── Phase A: Stopping ───
    result = _check_phase_a(df, c, v, h, l, last_close, vol_median, lookback)
    if result:
        return result

    return _unknown("不符合吸籌結構")


def _check_phase_e(c, v, last_close, resistance, vol_median):
    """Phase E: Price broke above resistance with volume."""
    if last_close <= resistance:
        return None

    # Check breakout quality
    days_above = 0
    for i in range(len(c) - 1, max(0, len(c) - 5) - 1, -1):
        if c[i] > resistance:
            days_above += 1
        else:
            break

    # Volume on breakout day(s)
    breakout_vol = float(np.max(v[-days_above:])) if days_above > 0 else float(v[-1])
    vol_confirmed = breakout_vol > vol_median * SOS_VOL_MULT

    # Require BOTH: 2+ days above resistance AND at least one volume-confirmed day
    if days_above >= 2 and vol_confirmed:
        confidence = 0.9
        return {
            "phase": "E",
            "confidence": confidence,
            "next_event": "持有/追蹤趨勢，注意回測支撐",
            "description": f"已突破壓力 ${resistance:.1f}，連續 {days_above} 天站穩"
                           f" + 量能確認 ({breakout_vol/vol_median:.1f}x)",
        }
    return None


def _check_phase_d(c, v, h, l, swing_lows, swing_highs, last_close,
                   resistance, vol_median, support_dynamic):
    """Phase D: Higher lows confirmed + SOS rally."""
    # Need at least 2 ascending swing lows
    if len(swing_lows) < 2:
        return None

    # Check if recent swing lows are ascending (higher lows)
    recent_lows = swing_lows[-3:]  # Last 3 swing lows
    ascending_count = 0
    for i in range(1, len(recent_lows)):
        if recent_lows[i][1] > recent_lows[i - 1][1]:
            ascending_count += 1

    if ascending_count == 0:
        return None

    # Check for SOS (Sign of Strength): recent rally with above-average volume
    # Look at last 10 bars for rally with volume
    n = len(c)
    has_sos = False
    for i in range(max(0, n - 10), n):
        bar_return = (c[i] - c[max(0, i - 3)]) / c[max(0, i - 3)] if c[max(0, i - 3)] > 0 else 0
        if bar_return > 0.02 and v[i] > vol_median * 1.3:
            has_sos = True
            break

    # Must be above dynamic support and below resistance
    if last_close < support_dynamic or last_close > resistance:
        return None

    confidence = 0.5
    if ascending_count >= 2:
        confidence += 0.15
    if has_sos:
        confidence += 0.2
    confidence = min(confidence, 0.9)

    pct_to_resistance = (resistance - last_close) / last_close * 100

    return {
        "phase": "D",
        "confidence": confidence,
        "next_event": f"等待突破 ${resistance:.1f} ({pct_to_resistance:.1f}%) 或 LPS 回踩進場",
        "description": f"Higher lows 確認 ({ascending_count}次)" +
                       (" + SOS 量能確認" if has_sos else " — 等待 SOS 確認"),
    }


def _check_phase_c(c, v, l, last_close, support_dynamic, support_primary,
                   vol_median, n):
    """Phase C: Spring zone — recent breach of support or near support."""
    # Check if there was a recent spring (breach + recovery)
    spring_happened = False
    spring_bar = -1

    for i in range(max(0, n - 10), n):
        if l[i] < support_dynamic:
            # Breached support — check if recovered
            if i < n - 1 and c[i] > support_dynamic:
                # Same day recovery (intraday pierce, close above)
                spring_happened = True
                spring_bar = i
            elif i < n - 1:
                # Check next days for recovery
                for j in range(i + 1, min(i + 4, n)):
                    if c[j] > support_dynamic:
                        spring_happened = True
                        spring_bar = j
                        break

    if spring_happened:
        # Check volume shift on recovery
        recovery_vol = float(v[spring_bar]) if spring_bar >= 0 else float(v[-1])
        vol_shift = recovery_vol > vol_median

        confidence = 0.8 if vol_shift else 0.6
        return {
            "phase": "C",
            "confidence": confidence,
            "next_event": "Spring 已發生 — 等待確認進場 (Pilot Entry)",
            "description": f"跌破 ${support_dynamic:.1f} 後收回" +
                           (" + 量能轉換確認" if vol_shift else " — 等待量能確認"),
        }

    # Near spring zone (price close to support, volume drying up)
    pct_above_support = (last_close - support_dynamic) / last_close * 100
    recent_vol_avg = float(np.mean(v[-5:])) if n >= 5 else float(np.mean(v))
    vol_drying = recent_vol_avg < vol_median * 0.8

    if pct_above_support <= 2.0 and vol_drying:
        confidence = 0.5
        return {
            "phase": "C",
            "confidence": confidence,
            "next_event": f"接近 Spring 區域 (${support_dynamic:.1f}) — 等待跌破+收回",
            "description": f"價格距支撐 {pct_above_support:.1f}%，量能乾涸 ({recent_vol_avg/vol_median:.0%}x)",
        }

    return None


def _check_phase_b(c, v, l, last_close, support_primary, resistance,
                   vol_median, swing_lows, n):
    """Phase B: Building cause — range-bound with OBV rising, declining test volume."""
    # Must be within range
    if last_close < support_primary * 0.98 or last_close > resistance * 1.02:
        return None

    # Price range check (not trending strongly in either direction)
    price_range = (max(c) - min(c)) / min(c) * 100 if min(c) > 0 else 0
    if price_range > 30:  # Too wide a range, probably not consolidating
        return None
    if price_range < 5:  # Too narrow — likely just a slow drift, not real consolidation
        return None

    # Trend filter: reject if price is making consecutive new lows
    # (last 10 closes all below the close from 20 bars ago = still in downtrend)
    if n >= 20:
        ref_close = c[n - 20]
        recent_closes = c[-10:]
        if all(rc < ref_close for rc in recent_closes):
            return None

    # Check OBV trend (simple: is overall OBV positive?)
    obv = np.zeros(n)
    for i in range(1, n):
        if c[i] > c[i - 1]:
            obv[i] = obv[i - 1] + v[i]
        elif c[i] < c[i - 1]:
            obv[i] = obv[i - 1] - v[i]
        else:
            obv[i] = obv[i - 1]
    obv_slope = np.polyfit(np.arange(n), obv, 1)[0] if n > 2 else 0
    obv_rising = obv_slope > 0

    # Check declining volume on tests of lows
    declining_tests = False
    if len(swing_lows) >= 2:
        # Compare volume around each swing low
        test_volumes = []
        for idx, price in swing_lows[-3:]:
            if idx >= 0 and idx < n:
                # Average volume in 2 bars around the swing low
                start = max(0, idx - 1)
                end = min(n, idx + 2)
                test_volumes.append(float(np.mean(v[start:end])))
        if len(test_volumes) >= 2:
            # Each subsequent test should have less volume
            declining_tests = all(
                test_volumes[i] < test_volumes[i - 1]
                for i in range(1, len(test_volumes))
            )

    # Require at least one support test (swing low near support zone)
    has_support_test = False
    if len(swing_lows) >= 1:
        for _, price in swing_lows[-3:]:
            # Support test: swing low within 3% of primary support
            if support_primary > 0 and abs(price - support_primary) / support_primary <= 0.03:
                has_support_test = True
                break

    confidence = 0.4
    if obv_rising:
        confidence += 0.2
    if declining_tests:
        confidence += 0.2
    if has_support_test:
        confidence += 0.1
    confidence = min(confidence, 0.85)

    # Must have OBV rising or declining tests, AND at least one support test
    if not obv_rising and not declining_tests:
        return None
    if not has_support_test and not declining_tests:
        # Without support test evidence, need both OBV rising AND some structural sign
        # to differentiate from a simple uptrend
        return None

    return {
        "phase": "B",
        "confidence": confidence,
        "next_event": "等待 Spring 或 Higher Low 形成",
        "description": ("OBV 上升" if obv_rising else "OBV 平坦") +
                       (" + 測試量遞減" if declining_tests else "") +
                       (" + 支撐測試確認" if has_support_test else "") +
                       " — 區間吸籌中",
    }


def _check_phase_a(df, c, v, h, l, last_close, vol_median, lookback):
    """Phase A: Stopping — significant decline + stopping volume."""
    n = len(c)

    # Check for significant decline from recent high
    if n < 20:
        return None

    # Look for 15%+ decline from high within extended lookback
    extended = df.tail(lookback + 30) if len(df) > lookback + 30 else df
    ext_high = float(extended["High"].max())
    decline_pct = (ext_high - last_close) / ext_high * 100

    if decline_pct < 12:
        return None

    # Look for stopping volume (high volume day with close near high = buyers stepping in)
    stopping_found = False
    for i in range(max(0, n - 20), n):
        bar_range = h[i] - l[i]
        if bar_range > 0:
            cp = (c[i] - l[i]) / bar_range
            wide_bar = bar_range > np.median(h - l) * 1.5
            high_vol = v[i] > vol_median * 2
            if wide_bar and high_vol and cp > 0.4:
                stopping_found = True
                break

    if not stopping_found:
        return None

    confidence = 0.6
    return {
        "phase": "A",
        "confidence": confidence,
        "next_event": "等待 AR (自動反彈) + ST (二次測試)",
        "description": f"跌幅 {decline_pct:.0f}% + 出現 Stopping Volume — 下跌可能停止",
    }


def _unknown(reason=""):
    """Return UNKNOWN phase result."""
    return {
        "phase": "UNKNOWN",
        "confidence": 0.0,
        "next_event": "不在吸籌結構中",
        "description": reason or "不符合 Wyckoff 吸籌階段條件",
    }
