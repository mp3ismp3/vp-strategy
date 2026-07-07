"""Accumulation Detector — Daily scoring engine.

Computes a raw accumulation score (0-18) from 6 indicators:
1. OBV Trend (segmented slope)
2. Close Position + Lower Wicks
3. Volume Asymmetry (exponentially weighted)
4. ATR Tightening (percentile-based)
5. Buying Streak
6. Relative Strength vs SPY (beta-adjusted)

Also computes support/resistance levels for the tracker.
"""

import numpy as np
import pandas as pd

from core.indicators import find_swing_points
from strategies.accumulation.config import DEFAULT_LOOKBACK, SWING_LOOKBACK


def _percentileofscore(data, score):
    """Calculate percentile rank of score within data (replaces scipy)."""
    arr = np.asarray(data)
    if len(arr) == 0:
        return 50.0
    return float(np.sum(arr <= score) / len(arr) * 100)


def compute_daily_score(df, spy_df=None, lookback=DEFAULT_LOOKBACK):
    """Compute accumulation score and support levels for a single symbol.
    
    Args:
        df: Full DataFrame (6mo+ of OHLCV data)
        spy_df: SPY DataFrame for relative strength (optional)
        lookback: Number of bars for scoring window
    
    Returns:
        dict with raw_score, components, support_primary, support_dynamic, resistance
        or None if insufficient data.
    """
    if len(df) < lookback + 10:
        return None

    d = df.tail(lookback).copy()
    c = d["Close"].values.astype(float)
    o = d["Open"].values.astype(float)
    h = d["High"].values.astype(float)
    l = d["Low"].values.astype(float)
    v = d["Volume"].values.astype(float)
    n = len(d)

    # ─── Spike Filter (median-based) ───
    vol_median = np.median(v)
    v_clean = np.where(v > 3 * vol_median, vol_median, v)

    # Bar properties
    bar_range = h - l
    close_pos = np.where(bar_range > 0, (c - l) / bar_range, 0.5)

    components = {}

    # ─── 1. OBV Trend (Segmented Slope) ───
    obv = np.zeros(n)
    for i in range(1, n):
        if c[i] > c[i - 1]:
            obv[i] = obv[i - 1] + v_clean[i]
        elif c[i] < c[i - 1]:
            obv[i] = obv[i - 1] - v_clean[i]
        else:
            obv[i] = obv[i - 1]

    half = n // 2
    x_early = np.arange(half)
    x_recent = np.arange(n - half)

    obv_slope_early = np.polyfit(x_early, obv[:half], 1)[0] if half > 1 else 0
    obv_slope_recent = np.polyfit(x_recent, obv[half:], 1)[0] if (n - half) > 1 else 0

    obv_score = 0
    if obv_slope_recent > 0 and obv_slope_early > 0 and obv_slope_recent > obv_slope_early:
        obv_score = 3  # Accelerating accumulation
        obv_signal = "加速吸籌中"
    elif obv_slope_recent > 0 and obv_slope_early <= 0:
        obv_score = 2  # Newly started
        obv_signal = "新啟動吸籌"
    elif obv_slope_recent > 0 and obv_slope_early > 0:
        obv_score = 2  # Steady (recent not accelerating but still positive)
        obv_signal = "穩定吸籌中"
    elif obv_slope_recent > 0:
        obv_score = 1  # Weak
        obv_signal = "微弱吸籌跡象"
    else:
        obv_score = 0
        obv_signal = "無吸籌跡象"

    ratio_str = f"{obv_slope_recent / max(abs(obv_slope_early), 1):.1f}x" if obv_slope_early != 0 else "N/A"
    components["obv"] = {
        "score": obv_score,
        "signal": obv_signal,
        "detail": f"recent_slope={obv_slope_recent:.0f}, early_slope={obv_slope_early:.0f}, ratio={ratio_str}",
    }

    # ─── 2. Close Position ───
    avg_close_pos = float(np.mean(close_pos[-20:]))
    lower_wick = np.minimum(c, o) - l
    body = np.abs(c - o)
    wick_days = int(np.sum(lower_wick[-20:] > np.where(body[-20:] > 0, body[-20:] * 1.2, 0.01)))

    close_score = 0
    if avg_close_pos >= 0.65 and wick_days >= 8:
        close_score = 3
    elif avg_close_pos >= 0.60 or wick_days >= 6:
        close_score = 2
    elif avg_close_pos >= 0.55:
        close_score = 1

    components["close_position"] = {
        "score": close_score,
        "signal": f"收盤位置 {avg_close_pos:.0%} | 下影線 {wick_days} 天",
        "detail": f"avg_close_pos={avg_close_pos:.3f}, wick_days={wick_days}",
    }

    # ─── 3. Volume Asymmetry (Exponentially Weighted) ───
    weights = np.exp(np.linspace(-1, 0, n - 1))
    weights /= weights.sum()

    rally_wt = 0.0
    pullback_wt = 0.0
    for i in range(1, n):
        w = weights[i - 1]
        if c[i] > c[i - 1]:
            rally_wt += v_clean[i] * w
        elif c[i] < c[i - 1]:
            pullback_wt += v_clean[i] * w

    vol_asymmetry = rally_wt / max(pullback_wt, 1.0)

    vol_score = 0
    if vol_asymmetry >= 1.4:
        vol_score = 3
    elif vol_asymmetry >= 1.2:
        vol_score = 2
    elif vol_asymmetry >= 1.1:
        vol_score = 1

    components["volume_asymmetry"] = {
        "score": vol_score,
        "signal": f"上漲量/下跌量 = {vol_asymmetry:.2f}x (加權)",
        "detail": f"weighted_rally={rally_wt:.0f}, weighted_pullback={pullback_wt:.0f}",
    }

    # ─── 4. ATR Tightening (Percentile-based) ───
    tr = np.zeros(n)
    tr[0] = h[0] - l[0]  # First bar uses high-low range
    tr[1:] = np.maximum(h[1:] - l[1:], np.maximum(np.abs(h[1:] - c[:-1]), np.abs(l[1:] - c[:-1])))

    # Rolling ATR values (10-bar windows)
    atr_values = []
    for i in range(10, n):
        atr_values.append(np.mean(tr[i - 10:i]))

    if len(atr_values) >= 5:
        recent_atr = atr_values[-1]
        pctile = _percentileofscore(atr_values, recent_atr)

        # Volume during compression
        recent_vol = float(np.mean(v_clean[-10:]))
        hist_vol = float(np.mean(v_clean[:-10])) if n > 10 else float(np.mean(v_clean))
        vol_maintained = recent_vol / max(hist_vol, 1)

        tight_score = 0
        if pctile <= 15 and vol_maintained >= 0.85:
            tight_score = 3
        elif pctile <= 25 and vol_maintained >= 0.80:
            tight_score = 2
        elif pctile <= 35:
            tight_score = 1
    else:
        pctile = 50.0
        vol_maintained = 1.0
        tight_score = 0

    components["tightening"] = {
        "score": tight_score,
        "signal": f"ATR 百分位 {pctile:.0f}% | 量能維持 {vol_maintained:.0%}",
        "detail": f"atr_percentile={pctile:.1f}, vol_maintained={vol_maintained:.2f}",
    }

    # ─── 5. Buying Streak ───
    max_streak = 0
    current_streak = 0
    for i in range(n):
        if close_pos[i] > 0.55:
            current_streak += 1
            max_streak = max(max_streak, current_streak)
        else:
            current_streak = 0

    # Recent streak (from end)
    recent_streak = 0
    for i in range(n - 1, -1, -1):
        if close_pos[i] > 0.55:
            recent_streak += 1
        else:
            break

    streak_score = 0
    if max_streak >= 7 or recent_streak >= 5:
        streak_score = 3
    elif max_streak >= 5 or recent_streak >= 3:
        streak_score = 2
    elif max_streak >= 3:
        streak_score = 1

    components["buying_streak"] = {
        "score": streak_score,
        "signal": f"最大連續 {max_streak} 天 | 當前 {recent_streak} 天收上半",
        "detail": f"max_streak={max_streak}, recent_streak={recent_streak}",
    }

    # ─── 6. Relative Strength vs SPY (Beta-adjusted) ───
    rs_score = 0
    rs_signal = "無 SPY 資料"

    if spy_df is not None and len(spy_df) >= lookback:
        # Align by date index to handle halted/missing days
        stock_close = df.tail(lookback + 10)["Close"]
        spy_close = spy_df["Close"]
        # Inner join on date ensures only matching trading days are compared
        aligned = pd.DataFrame({"stock": stock_close, "spy": spy_close}).dropna()
        aligned = aligned.tail(lookback)

        if len(aligned) >= 15:
            stock_vals = aligned["stock"].values.astype(float)
            spy_vals = aligned["spy"].values.astype(float)
            stock_returns = np.diff(stock_vals) / stock_vals[:-1]
            spy_returns = np.diff(spy_vals) / spy_vals[:-1]

            # Beta calculation
            if len(spy_returns) > 5 and np.var(spy_returns) > 0:
                cov_matrix = np.cov(stock_returns, spy_returns)
                beta = cov_matrix[0, 1] / np.var(spy_returns)
                beta = max(0.3, min(3.0, beta))  # Clamp extreme betas

                # Alpha = actual - expected (beta * SPY)
                expected_returns = spy_returns * beta
                alpha = stock_returns - expected_returns

                # Days SPY was down
                spy_down_mask = spy_returns < -0.003
                if np.sum(spy_down_mask) > 0:
                    alpha_on_down = alpha[spy_down_mask]
                    held_up_ratio = float(np.mean(alpha_on_down > 0))

                    # Overall alpha
                    total_alpha = float(np.sum(alpha)) * 100

                    if held_up_ratio >= 0.6 and total_alpha > 0:
                        rs_score = 3
                    elif held_up_ratio >= 0.5 or total_alpha > 2:
                        rs_score = 2
                    elif held_up_ratio >= 0.4:
                        rs_score = 1

                    rs_signal = f"Beta={beta:.1f} | 相對強度 {held_up_ratio:.0%} | Alpha {total_alpha:+.1f}%"
                else:
                    rs_signal = "SPY 無下跌日"
            else:
                rs_signal = "資料不足計算 Beta"

    components["relative_strength"] = {
        "score": rs_score,
        "signal": rs_signal,
        "detail": rs_signal,
    }

    # ─── Composite Score ───
    raw_score = obv_score + close_score + vol_score + tight_score + streak_score + rs_score

    # ─── Support / Resistance Levels ───
    support_primary, support_dynamic, resistance = _compute_levels(df, lookback)

    return {
        "raw_score": raw_score,
        "components": components,
        "support_primary": support_primary,
        "support_dynamic": support_dynamic,
        "resistance": resistance,
    }


def _compute_levels(df, lookback):
    """Compute primary support, dynamic support, and resistance levels."""
    # Primary support: significant low in full data
    # Look for SC-like event: high volume + wide bar + close near high (stopping volume)
    full_c = df["Close"].values.astype(float)
    full_h = df["High"].values.astype(float)
    full_l = df["Low"].values.astype(float)
    full_v = df["Volume"].values.astype(float)

    # Simple approach: 6-month low, weighted toward high-volume lows
    support_primary = float(df["Low"].min())

    # Try to find SC (Selling Climax) — high volume day near the low
    if len(df) > 20:
        vol_med = np.median(full_v)
        for i in range(len(df) - 1, max(0, len(df) - lookback * 2) - 1, -1):
            bar_r = full_h[i] - full_l[i]
            if bar_r > 0:
                cp = (full_c[i] - full_l[i]) / bar_r
                # SC candidate: high volume, wide bar, close in upper portion
                if full_v[i] > vol_med * 2 and cp > 0.4 and full_l[i] <= support_primary * 1.02:
                    support_primary = float(full_l[i])
                    break

    # Dynamic support: most recent swing low
    swing_highs, swing_lows = find_swing_points(df.tail(lookback + SWING_LOOKBACK * 2), SWING_LOOKBACK)
    if swing_lows:
        support_dynamic = float(swing_lows[-1][1])
    else:
        support_dynamic = float(df.tail(lookback)["Low"].min())

    # Resistance: most recent swing high or range high
    if swing_highs:
        resistance = float(swing_highs[-1][1])
    else:
        resistance = float(df.tail(lookback)["High"].max())

    # Ensure dynamic >= primary
    if support_dynamic < support_primary:
        support_dynamic = support_primary

    return support_primary, support_dynamic, resistance
