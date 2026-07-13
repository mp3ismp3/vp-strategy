"""Auction Theory Elements — VA Migration, Initial Balance, Single Prints.

These complement Volume Profile by adding temporal analysis:
- VA Migration: how value area is shifting over time (trend detection)
- Initial Balance: first hour's range predicts day type
- Single Prints / Poor Highs/Lows: unfilled areas and weak extremes
"""

import numpy as np
import pandas as pd

from core.indicators import calc_vp, calc_vp_hourly, calc_atr


def calc_va_migration(df, df_1h=None, va_pct=0.68, periods=(1, 5, 20)):
    """Track how Value Area is shifting over time.

    Compares current VA vs previous VA over multiple lookback periods.
    Direction + speed tells you if value is migrating (trending) or stable.

    Args:
        df: Daily OHLCV DataFrame
        df_1h: Optional 1H DataFrame for precision
        va_pct: Value Area percentage
        periods: tuple of lookback day offsets to compare

    Returns:
        {
            "direction": "up" | "down" | "flat",
            "speed": float (normalized by ATR),
            "poc_shift": float,
            "details": {period: {"poc_now": f, "poc_prev": f, "shift": f, "direction": str}}
        }
        or None if insufficient data.
    """
    if df is None or len(df) < 80:
        return None

    atr = calc_atr(df, 14)
    if atr is None or atr <= 0:
        return None

    # Current VP
    if df_1h is not None and len(df_1h) >= 100:
        vp_now = calc_vp_hourly(df_1h, lookback_days=20, va_pct=va_pct)
    else:
        vp_now = calc_vp(df, 20, va_pct)

    if vp_now is None:
        return None

    details = {}
    shifts = []

    for period in periods:
        if len(df) < period + 40:
            continue

        # Previous VP (ending 'period' days ago)
        df_prev = df.iloc[:-(period)]
        vp_prev = calc_vp(df_prev, 20, va_pct)
        if vp_prev is None:
            continue

        shift = vp_now["poc"] - vp_prev["poc"]
        shifts.append(shift)

        details[period] = {
            "poc_now": round(vp_now["poc"], 2),
            "poc_prev": round(vp_prev["poc"], 2),
            "shift": round(shift, 2),
            "direction": "up" if shift > atr * 0.3 else "down" if shift < -atr * 0.3 else "flat",
        }

    if not shifts:
        return None

    # Overall direction from longest period
    main_shift = shifts[-1] if shifts else 0
    speed = abs(main_shift) / atr if atr > 0 else 0

    if main_shift > atr * 0.3:
        direction = "up"
    elif main_shift < -atr * 0.3:
        direction = "down"
    else:
        direction = "flat"

    return {
        "direction": direction,
        "speed": round(speed, 2),
        "poc_shift": round(main_shift, 2),
        "details": details,
    }


def calc_initial_balance(df_1h):
    """Calculate Initial Balance — first hour's range each day.

    IB predicts day type:
    - Price stays in IB = balance/range day
    - Price breaks IB = directional/trend day

    Args:
        df_1h: 1H OHLCV DataFrame with timezone-aware index

    Returns:
        {
            "today": {"ib_high": f, "ib_low": f, "ib_width": f,
                      "broken": "up"|"down"|"both"|"none",
                      "day_type": "balance"|"directional_up"|"directional_down"|"double_break"},
            "stats": {"avg_ib_width": f, "pct_directional": f,
                      "today_relative": "wide"|"normal"|"narrow"}
        }
        or None if insufficient data.
    """
    if df_1h is None or len(df_1h) < 50:
        return None

    # Group by date
    df_1h = df_1h.copy()
    df_1h["date"] = df_1h.index.date

    dates = sorted(df_1h["date"].unique())
    if len(dates) < 2:
        return None

    # Calculate IB for each day (first bar = first hour)
    ib_data = []
    for date in dates:
        day_bars = df_1h[df_1h["date"] == date]
        if len(day_bars) < 1:
            continue

        first_bar = day_bars.iloc[0]
        ib_high = float(first_bar["High"])
        ib_low = float(first_bar["Low"])
        ib_width = ib_high - ib_low

        # Check if IB was broken during the day
        rest = day_bars.iloc[1:] if len(day_bars) > 1 else pd.DataFrame()
        broke_high = float(rest["High"].max()) > ib_high if len(rest) > 0 else False
        broke_low = float(rest["Low"].min()) < ib_low if len(rest) > 0 else False

        if broke_high and broke_low:
            broken = "both"
            day_type = "double_break"
        elif broke_high:
            broken = "up"
            day_type = "directional_up"
        elif broke_low:
            broken = "down"
            day_type = "directional_down"
        else:
            broken = "none"
            day_type = "balance"

        ib_data.append({
            "date": date,
            "ib_high": ib_high,
            "ib_low": ib_low,
            "ib_width": ib_width,
            "broken": broken,
            "day_type": day_type,
        })

    if not ib_data:
        return None

    # Today = last entry
    today = ib_data[-1]

    # 20-day rolling stats
    recent = ib_data[-20:] if len(ib_data) >= 20 else ib_data
    avg_width = np.mean([d["ib_width"] for d in recent])
    directional_count = sum(1 for d in recent if d["day_type"] != "balance")
    pct_directional = directional_count / len(recent)

    # Today's IB relative to average
    if today["ib_width"] > avg_width * 1.3:
        today_relative = "wide"
    elif today["ib_width"] < avg_width * 0.7:
        today_relative = "narrow"
    else:
        today_relative = "normal"

    return {
        "today": {
            "ib_high": round(today["ib_high"], 2),
            "ib_low": round(today["ib_low"], 2),
            "ib_width": round(today["ib_width"], 2),
            "broken": today["broken"],
            "day_type": today["day_type"],
        },
        "stats": {
            "avg_ib_width": round(avg_width, 2),
            "pct_directional": round(pct_directional, 2),
            "today_relative": today_relative,
        },
    }


def detect_single_prints(bin_volumes, bin_prices, threshold=0.10,
                         min_consecutive=3):
    """Detect single print areas — thin volume zones passed through quickly.

    These are price levels the market moved through without accepting,
    creating a "gap" in the VP that is likely to be revisited (filled).

    Args:
        bin_volumes: list of volume per bin from VP histogram
        bin_prices: list of bin center prices
        threshold: fraction of max volume below which bins are considered thin
        min_consecutive: minimum consecutive thin bins to count as single print

    Returns:
        [{"price_start": f, "price_end": f, "avg_volume_pct": f}]
    """
    volumes = np.array(bin_volumes)
    prices = np.array(bin_prices)

    if len(volumes) == 0 or volumes.max() == 0:
        return []

    max_vol = volumes.max()
    thin_mask = volumes < (max_vol * threshold)

    # Find consecutive thin regions
    single_prints = []
    start = None
    count = 0

    for i in range(len(volumes)):
        if thin_mask[i]:
            if start is None:
                start = i
            count += 1
        else:
            if count >= min_consecutive and start is not None:
                avg_pct = float(volumes[start:start + count].mean() / max_vol)
                single_prints.append({
                    "price_start": round(float(prices[start]), 2),
                    "price_end": round(float(prices[start + count - 1]), 2),
                    "avg_volume_pct": round(avg_pct, 3),
                })
            start = None
            count = 0

    # Handle trailing region
    if count >= min_consecutive and start is not None:
        avg_pct = float(volumes[start:start + count].mean() / max_vol)
        single_prints.append({
            "price_start": round(float(prices[start]), 2),
            "price_end": round(float(prices[start + count - 1]), 2),
            "avg_volume_pct": round(avg_pct, 3),
        })

    return single_prints


def detect_poor_highs_lows(df, lookback=20):
    """Detect poor highs and poor lows — weak extremes likely to be revisited.

    A "poor high" has no selling tail (excess) at the top → buyers weren't
    aggressively rejected → price will likely revisit and possibly exceed.

    A "poor low" has no buying tail at the bottom → sellers weren't
    aggressively rejected → price will likely revisit.

    Args:
        df: Daily OHLCV DataFrame
        lookback: number of days to scan

    Returns:
        {"poor_highs": [{"price": f, "date": str}],
         "poor_lows": [{"price": f, "date": str}]}
    """
    if df is None or len(df) < lookback:
        return {"poor_highs": [], "poor_lows": []}

    recent = df.tail(lookback)
    poor_highs = []
    poor_lows = []

    for i in range(len(recent)):
        row = recent.iloc[i]
        o, h, l, c = row["Open"], row["High"], row["Low"], row["Close"]
        bar_range = h - l
        if bar_range <= 0:
            continue

        # Close position within bar (0% = at low, 100% = at high)
        close_pct = (c - l) / bar_range

        # Poor high: close in upper 20% (no selling tail / excess at top)
        # This means the bar closed near its high — no rejection
        if close_pct >= 0.80:
            # Check if this is actually a session high (local high in last 5 bars)
            idx = len(df) - lookback + i
            local_window = df["High"].iloc[max(0, idx - 2):min(len(df), idx + 3)]
            if h >= local_window.max() * 0.998:
                poor_highs.append({
                    "price": round(float(h), 2),
                    "date": str(recent.index[i].date()),
                })

        # Poor low: close in lower 20% (no buying tail / excess at bottom)
        if close_pct <= 0.20:
            idx = len(df) - lookback + i
            local_window = df["Low"].iloc[max(0, idx - 2):min(len(df), idx + 3)]
            if l <= local_window.min() * 1.002:
                poor_lows.append({
                    "price": round(float(l), 2),
                    "date": str(recent.index[i].date()),
                })

    return {"poor_highs": poor_highs, "poor_lows": poor_lows}
