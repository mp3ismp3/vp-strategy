"""Entry Trigger Detection — Spring, LPS, SOS Breakout.

Detects actionable entry signals and calculates proximity to trigger levels.
Each trigger includes entry, stop-loss, target, and R:R ratio.

v4.1: Added market environment gate, stop-loss cap, measured move targets,
      and 2-day confirmation mechanism.
"""

import numpy as np

from core.indicators import calc_atr, find_swing_points
from strategies.accumulation.config import (
    DEFAULT_LOOKBACK,
    LPS_VOL_MULT,
    MAX_STOP_LOSS_PCT,
    PROXIMITY_PRICE_PCT,
    PROXIMITY_VOL_PCT,
    SOS_CONFIRM_DAYS,
    SOS_VOL_MULT,
    SPRING_LOOKBACK,
    SPRING_VOL_MULT,
    SPY_EMA_PERIOD,
    SWING_LOOKBACK,
    TRIGGER_CONFIRM_DAYS,
    VIX_BLOCK_ALL,
    VIX_BLOCK_SPRING_LPS,
    VOL_MEDIAN_WINDOW,
)


def market_env_gate(trigger_type, market_ctx=None):
    """Check if market environment allows this trigger to fire.

    Args:
        trigger_type: "SPRING", "LPS", or "SOS_BREAKOUT"
        market_ctx: dict with 'vix' (float) and 'spy_above_ema50' (bool)

    Returns:
        dict with 'allowed' (bool), 'reason' (str), 'confidence_adj' (float 0-1)
    """
    if market_ctx is None:
        return {"allowed": True, "reason": "", "confidence_adj": 1.0}

    vix = market_ctx.get("vix")
    spy_above_ema = market_ctx.get("spy_above_ema50", True)

    # VIX >= 30: block everything (extreme fear / crash)
    if vix is not None and vix >= VIX_BLOCK_ALL:
        return {
            "allowed": False,
            "reason": f"VIX={vix:.1f} ≥ {VIX_BLOCK_ALL} (極端恐慌，暫停所有觸發)",
            "confidence_adj": 0.0,
        }

    # VIX 25-30: only allow SOS (confirmed breakouts still valid)
    if vix is not None and vix >= VIX_BLOCK_SPRING_LPS:
        if trigger_type in ("SPRING", "LPS"):
            return {
                "allowed": False,
                "reason": f"VIX={vix:.1f} ≥ {VIX_BLOCK_SPRING_LPS} (高波動，僅允許 SOS 突破)",
                "confidence_adj": 0.0,
            }
        # SOS allowed but with reduced confidence
        return {"allowed": True, "reason": f"VIX={vix:.1f} 偏高", "confidence_adj": 0.7}

    # SPY below EMA50: reduce confidence for Spring/LPS
    if not spy_above_ema:
        if trigger_type in ("SPRING", "LPS"):
            return {
                "allowed": True,
                "reason": "SPY 在 EMA50 下方 (降低信心)",
                "confidence_adj": 0.6,
            }
        return {"allowed": True, "reason": "SPY 在 EMA50 下方", "confidence_adj": 0.8}

    return {"allowed": True, "reason": "", "confidence_adj": 1.0}


def _cap_stop_loss(entry, stop, max_pct=MAX_STOP_LOSS_PCT):
    """Cap stop-loss distance to max_pct of entry price.

    Returns adjusted stop that is no further than max_pct from entry.
    """
    max_distance = entry * max_pct
    if entry - stop > max_distance:
        return round(entry - max_distance, 2)
    return stop


def check_triggers(df, phase, support_primary, support_dynamic, resistance,
                   lookback=DEFAULT_LOOKBACK, market_ctx=None,
                   pending_triggers=None):
    """Check for entry triggers and proximity to trigger levels.
    
    Args:
        df: Full OHLCV DataFrame
        phase: Current Wyckoff phase (from classify_phase)
        support_primary: SC low
        support_dynamic: Recent swing low
        resistance: Range high / AR level
        lookback: Number of bars to use
        market_ctx: Market environment dict (vix, spy_above_ema50)
        pending_triggers: List of pending (unconfirmed) triggers from previous day
        
    Returns:
        dict with 'triggered', 'proximity', 'distance', 'pending', and 'gate' keys
    """
    result = {
        "triggered": [],
        "proximity": [],
        "pending": [],  # Triggers awaiting day-2 confirmation
        "gate": {},     # Market environment gate status
        "distance": {
            "nearest_trigger": None,
            "price_away_pct": None,
            "volume_ready": False,
        },
    }

    if len(df) < lookback + 10:
        return result

    tail = df.tail(lookback)
    c = tail["Close"].values.astype(float)
    h = tail["High"].values.astype(float)
    l = tail["Low"].values.astype(float)
    v = tail["Volume"].values.astype(float)
    n = len(c)

    last_close = float(c[-1])
    vol_median = float(np.median(v[-VOL_MEDIAN_WINDOW:])) if n >= VOL_MEDIAN_WINDOW else float(np.median(v))

    # ATR for stop-loss calculation
    atr = calc_atr(df, 14)
    if atr is None or atr == 0:
        atr = float(np.mean(h[-14:] - l[-14:])) or 0.01  # Fallback, avoid zero

    # Swing points
    swing_highs, swing_lows = find_swing_points(tail, SWING_LOOKBACK)

    # ─── Check Day-2 Confirmation for Pending Triggers ───
    if pending_triggers:
        for pt in pending_triggers:
            confirmed = _check_day2_confirmation(
                pt, c, l, h, support_dynamic, resistance
            )
            if confirmed:
                result["triggered"].append(pt)
            # If not confirmed, trigger is dropped (not re-added to pending)

    # ─── Spring Entry (Phase C) ───
    if phase in ("C", "B"):
        gate = market_env_gate("SPRING", market_ctx)
        result["gate"]["SPRING"] = gate
        spring = _check_spring(c, h, l, v, n, support_dynamic, support_primary,
                               resistance, vol_median, atr)
        if spring:
            if spring["type"] == "triggered":
                if not gate["allowed"]:
                    spring["data"]["blocked"] = gate["reason"]
                    result["proximity"].append({
                        "type": "SPRING",
                        "trigger_price": spring["data"].get("entry", support_dynamic),
                        "current": round(float(c[-1]), 2),
                        "pct_away": 0.0,
                        "vol_status": f"⛔ 觸發被阻: {gate['reason']}",
                        "description": "Spring 條件達成但市場環境不允許",
                    })
                else:
                    # Apply confidence adjustment
                    if gate["confidence_adj"] < 1.0:
                        spring["data"]["confidence_note"] = gate["reason"]
                    # Day-2 confirmation: pend instead of immediate trigger
                    spring["data"]["_pending_type"] = "SPRING"
                    result["pending"].append(spring["data"])
            else:
                result["proximity"].append(spring["data"])

    # ─── LPS Entry (Phase D) ───
    if phase == "D":
        gate = market_env_gate("LPS", market_ctx)
        result["gate"]["LPS"] = gate
        lps = _check_lps(c, h, l, v, n, swing_lows, support_dynamic,
                         resistance, vol_median, atr)
        if lps:
            if lps["type"] == "triggered":
                if not gate["allowed"]:
                    lps["data"]["blocked"] = gate["reason"]
                    result["proximity"].append({
                        "type": "LPS",
                        "trigger_price": lps["data"].get("entry", support_dynamic),
                        "current": round(float(c[-1]), 2),
                        "pct_away": 0.0,
                        "vol_status": f"⛔ 觸發被阻: {gate['reason']}",
                        "description": "LPS 條件達成但市場環境不允許",
                    })
                else:
                    if gate["confidence_adj"] < 1.0:
                        lps["data"]["confidence_note"] = gate["reason"]
                    lps["data"]["_pending_type"] = "LPS"
                    result["pending"].append(lps["data"])
            else:
                result["proximity"].append(lps["data"])

    # ─── SOS Breakout (Phase D → E) ───
    if phase in ("D", "C"):
        gate = market_env_gate("SOS_BREAKOUT", market_ctx)
        result["gate"]["SOS_BREAKOUT"] = gate
        sos = _check_sos_breakout(c, v, n, resistance, support_dynamic,
                                  support_primary, vol_median, atr, swing_lows)
        if sos:
            if sos["type"] == "triggered":
                if not gate["allowed"]:
                    sos["data"]["blocked"] = gate["reason"]
                    result["proximity"].append({
                        "type": "SOS_BREAKOUT",
                        "trigger_price": round(resistance, 2),
                        "current": round(float(c[-1]), 2),
                        "pct_away": 0.0,
                        "vol_status": f"⛔ 觸發被阻: {gate['reason']}",
                        "description": "SOS 條件達成但市場環境不允許",
                    })
                else:
                    # SOS already has 2-day confirmation built in, no pending needed
                    if gate["confidence_adj"] < 1.0:
                        sos["data"]["confidence_note"] = gate["reason"]
                    result["triggered"].append(sos["data"])
            else:
                result["proximity"].append(sos["data"])

    # ─── Distance Summary ───
    _compute_distance_summary(result, last_close, resistance, support_dynamic,
                              vol_median, v, phase)

    return result


def _check_day2_confirmation(pending_trigger, c, l, h, support_dynamic, resistance):
    """Check if a pending trigger from yesterday is confirmed today.

    Spring/LPS: today's close must still be above support_dynamic.
    SOS: today's close must still be above resistance.
    """
    trigger_type = pending_trigger.get("_pending_type", pending_trigger.get("type", ""))
    last_close = float(c[-1])

    if trigger_type == "SPRING":
        # Day 2: price must hold above support_dynamic
        return last_close > support_dynamic
    elif trigger_type == "LPS":
        # Day 2: price must hold above the swing low (stop level + buffer)
        stop = pending_trigger.get("stop", support_dynamic)
        return last_close > stop
    elif trigger_type == "SOS_BREAKOUT":
        # Day 2: price must hold above resistance
        return last_close > resistance

    return False


def _check_spring(c, h, l, v, n, support_dynamic, support_primary,
                  resistance, vol_median, atr):
    """Detect Spring entry: breach of support + recovery + volume."""
    # Look back SPRING_LOOKBACK days for a breach below support_dynamic
    # Take the MOST RECENT breach (last one found), not the earliest
    breach_idx = -1
    for i in range(max(0, n - SPRING_LOOKBACK - 1), n - 1):
        if l[i] < support_dynamic:
            breach_idx = i

    if breach_idx < 0:
        # No breach — check proximity to spring zone
        pct_above = (c[-1] - support_dynamic) / c[-1] * 100 if c[-1] > 0 else 999
        if pct_above <= PROXIMITY_PRICE_PCT:
            return {
                "type": "proximity",
                "data": {
                    "type": "SPRING",
                    "trigger_price": round(support_dynamic, 2),
                    "current": round(float(c[-1]), 2),
                    "pct_away": round(pct_above, 2),
                    "vol_status": "等待跌破支撐 + 收回",
                    "description": f"價格接近 Spring 區域 ${support_dynamic:.2f}",
                },
            }
        return None

    # Breach found — check recovery
    last_close = float(c[-1])
    last_bar_range = h[-1] - l[-1]
    close_pos = (c[-1] - l[-1]) / last_bar_range if last_bar_range > 0 else 0.5

    recovered = last_close > support_dynamic
    volume_confirmed = v[-1] > vol_median * SPRING_VOL_MULT
    close_upper_half = close_pos > 0.5

    if recovered and volume_confirmed and close_upper_half:
        # TRIGGERED
        # Take the lowest point during the breach event (breach day + next 2 bars max)
        breach_end = min(breach_idx + 3, n)
        breach_low = float(min(l[breach_idx:breach_end]))
        stop = min(breach_low, support_primary) - 0.5 * atr
        # Measured move target: resistance + 0.5 × range height
        range_height = resistance - support_primary
        target = resistance + 0.5 * range_height
        entry = last_close
        # Cap stop-loss at MAX_STOP_LOSS_PCT
        stop = _cap_stop_loss(entry, stop)
        risk = entry - stop
        reward = target - entry
        rr = round(reward / risk, 1) if risk > 0 else 0

        # Trailing stop suggestion
        trailing_stop = round(entry - 1.5 * atr, 2)

        return {
            "type": "triggered",
            "data": {
                "type": "SPRING",
                "entry": round(entry, 2),
                "stop": round(stop, 2),
                "target": round(target, 2),
                "rr": rr,
                "trailing_stop": trailing_stop,
                "reason": f"跌破 ${support_dynamic:.2f} 後收回 + 量 {v[-1]/vol_median:.1f}x median",
                "action": "PILOT BUY 10-25%",
            },
        }
    elif recovered:
        # Recovered but missing confirmation
        return {
            "type": "proximity",
            "data": {
                "type": "SPRING",
                "trigger_price": round(support_dynamic, 2),
                "current": round(last_close, 2),
                "pct_away": 0.0,
                "vol_status": f"已收回但量能不足 ({v[-1]/vol_median:.1f}x, 需 {SPRING_VOL_MULT}x)",
                "description": "Spring 形態形成中 — 等待量能確認",
            },
        }

    return None


def _check_lps(c, h, l, v, n, swing_lows, support_dynamic, resistance,
               vol_median, atr):
    """Detect LPS entry: pullback on low volume holding above prior swing low."""
    if len(swing_lows) < 1:
        return None

    last_close = float(c[-1])
    prior_swing_low = float(swing_lows[-1][1])

    # Check if current bar is a pullback on low volume
    # Pullback: price declined for 1-3 bars but holds above prior swing low
    is_pullback = False
    if n >= 3:
        # Recent bars showing decline
        recent_decline = c[-1] < c[-3] or c[-1] < c[-2]
        # But holding above swing low
        holds_above = last_close > prior_swing_low
        is_pullback = recent_decline and holds_above

    if not is_pullback:
        # Check proximity to LPS zone
        if last_close > prior_swing_low:
            pct_above = (last_close - prior_swing_low) / last_close * 100
            if pct_above <= PROXIMITY_PRICE_PCT * 1.5:  # Slightly wider zone for LPS
                return {
                    "type": "proximity",
                    "data": {
                        "type": "LPS",
                        "trigger_price": round(prior_swing_low, 2),
                        "current": round(last_close, 2),
                        "pct_away": round(pct_above, 2),
                        "vol_status": f"等待回踩 + 低量 (<{LPS_VOL_MULT}x median)",
                        "description": f"接近 LPS 區域 ${prior_swing_low:.2f}",
                    },
                }
        return None

    # Check volume is low (< LPS_VOL_MULT × median)
    recent_vol_avg = float(np.mean(v[-3:]))
    low_volume = recent_vol_avg < vol_median * LPS_VOL_MULT

    # Close position
    last_bar_range = h[-1] - l[-1]
    close_pos = (c[-1] - l[-1]) / last_bar_range if last_bar_range > 0 else 0.5
    close_upper = close_pos > 0.5

    if low_volume and close_upper:
        # TRIGGERED
        stop = prior_swing_low - 0.5 * atr
        # Measured move: resistance + 0.5 × (resistance - prior_swing_low)
        range_height = resistance - prior_swing_low
        target = resistance + 0.5 * range_height
        entry = last_close
        # Cap stop-loss
        stop = _cap_stop_loss(entry, stop)
        risk = entry - stop
        reward = target - entry
        rr = round(reward / risk, 1) if risk > 0 else 0

        trailing_stop = round(entry - 1.2 * atr, 2)

        return {
            "type": "triggered",
            "data": {
                "type": "LPS",
                "entry": round(entry, 2),
                "stop": round(stop, 2),
                "target": round(target, 2),
                "rr": rr,
                "trailing_stop": trailing_stop,
                "reason": f"回踩量縮 ({recent_vol_avg/vol_median:.1f}x)，守住 ${prior_swing_low:.2f}",
                "action": "ADD 25-40%",
            },
        }
    elif low_volume:
        return {
            "type": "proximity",
            "data": {
                "type": "LPS",
                "trigger_price": round(prior_swing_low, 2),
                "current": round(last_close, 2),
                "pct_away": 0.0,
                "vol_status": f"量縮確認 ({recent_vol_avg/vol_median:.1f}x) — 收盤位置偏低",
                "description": "LPS 形態形成中 — 等待收盤轉強",
            },
        }

    return None


def _check_sos_breakout(c, v, n, resistance, support_dynamic, support_primary,
                        vol_median, atr, swing_lows):
    """Detect SOS Breakout: close above resistance with volume confirmation."""
    last_close = float(c[-1])

    if last_close <= resistance:
        # Check proximity
        pct_below = (resistance - last_close) / last_close * 100 if last_close > 0 else 999
        vol_current = float(v[-1])
        vol_pct_of_needed = (vol_current / (vol_median * SOS_VOL_MULT)) * 100

        if pct_below <= PROXIMITY_PRICE_PCT:
            return {
                "type": "proximity",
                "data": {
                    "type": "SOS_BREAKOUT",
                    "trigger_price": round(resistance, 2),
                    "current": round(last_close, 2),
                    "pct_away": round(pct_below, 2),
                    "vol_status": f"量能 {vol_pct_of_needed:.0f}% (需 {SOS_VOL_MULT}x median)",
                    "description": f"接近突破 ${resistance:.2f}",
                },
            }
        return None

    # Price is above resistance — check volume confirmation
    vol_on_breakout = float(v[-1])
    vol_confirmed = vol_on_breakout > vol_median * SOS_VOL_MULT

    # Check consecutive days above resistance
    days_above = 0
    for i in range(n - 1, max(0, n - SOS_CONFIRM_DAYS - 1) - 1, -1):
        if c[i] > resistance:
            days_above += 1
        else:
            break

    # Either strong single-day breakout or multi-day confirmation
    if vol_confirmed or days_above >= SOS_CONFIRM_DAYS:
        # SL = most recent swing low or support_dynamic
        if swing_lows:
            sl_level = float(swing_lows[-1][1])
        else:
            sl_level = support_dynamic
        stop = sl_level - 0.3 * atr  # Tighter stop for breakout

        # Target: measured move (range projected up)
        range_height = resistance - support_primary
        target = resistance + range_height
        entry = last_close
        # Cap stop-loss
        stop = _cap_stop_loss(entry, stop)
        risk = entry - stop
        reward = target - entry
        rr = round(reward / risk, 1) if risk > 0 else 0

        trailing_stop = round(entry - 1.0 * atr, 2)

        return {
            "type": "triggered",
            "data": {
                "type": "SOS_BREAKOUT",
                "entry": round(entry, 2),
                "stop": round(stop, 2),
                "target": round(target, 2),
                "rr": rr,
                "trailing_stop": trailing_stop,
                "reason": (f"突破 ${resistance:.2f}" +
                           (f" + 量 {vol_on_breakout/vol_median:.1f}x" if vol_confirmed else "") +
                           (f" + 連續 {days_above} 天站穩" if days_above >= 2 else "")),
                "action": "FULL POSITION",
            },
        }
    else:
        # Above resistance but unconfirmed
        return {
            "type": "proximity",
            "data": {
                "type": "SOS_BREAKOUT",
                "trigger_price": round(resistance, 2),
                "current": round(last_close, 2),
                "pct_away": 0.0,
                "vol_status": f"已突破但量不足 ({vol_on_breakout/vol_median:.1f}x, 需 {SOS_VOL_MULT}x)，等 {SOS_CONFIRM_DAYS} 天確認",
                "description": "突破中 — 等待量能或時間確認",
            },
        }


def _compute_distance_summary(result, last_close, resistance, support_dynamic,
                              vol_median, v, phase):
    """Compute summary of nearest trigger distance."""
    distances = []

    if phase in ("C", "B"):
        # Distance to spring zone
        pct_to_spring = abs(last_close - support_dynamic) / last_close * 100 if last_close > 0 else 999
        distances.append(("SPRING", pct_to_spring))

    if phase in ("D", "C"):
        # Distance to breakout
        pct_to_breakout = (resistance - last_close) / last_close * 100 if last_close > 0 else 999
        distances.append(("SOS_BREAKOUT", pct_to_breakout))

    if distances:
        nearest = min(distances, key=lambda x: x[1])
        vol_current = float(v[-1]) if len(v) > 0 else 0
        vol_ready = vol_current > vol_median * PROXIMITY_VOL_PCT / 100 * SOS_VOL_MULT

        result["distance"] = {
            "nearest_trigger": nearest[0],
            "price_away_pct": round(nearest[1], 2),
            "volume_ready": vol_ready,
        }
