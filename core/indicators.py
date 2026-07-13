"""Shared technical indicators."""

import numpy as np


def calc_vp(df, lookback, va_pct, n_bins=100, return_histogram=False):
    """Calculate Volume Profile using histogram-based approach.

    Bins the price range into n_bins buckets, distributes each bar's volume
    across its high-low range, finds the peak bin (POC), then expands outward
    from POC until va_pct of total volume is captured (Value Area).

    Args:
        df: DataFrame with OHLCV columns
        lookback: number of bars to use
        va_pct: fraction of volume for Value Area (e.g. 0.68)
        n_bins: number of price bins (default 100)
        return_histogram: if True, also return histogram data for charting

    Returns:
        {"poc": float, "vah": float, "val": float}
        If return_histogram=True:
        {"poc": float, "vah": float, "val": float,
         "histogram": {"prices": list, "volumes": list}}
    """
    d = df.tail(lookback)
    if len(d) < 5:
        return None

    highs = d["High"].values
    lows = d["Low"].values
    volumes = d["Volume"].values
    total_vol = volumes.sum()

    if total_vol == 0:
        return None

    price_low = float(lows.min())
    price_high = float(highs.max())
    price_range = price_high - price_low

    if price_range <= 0:
        return None

    # Create price bins
    bin_size = price_range / n_bins
    bin_volumes = np.zeros(n_bins)

    # Distribute each bar's volume evenly across its high-low range
    for i in range(len(d)):
        bar_low = lows[i]
        bar_high = highs[i]
        bar_vol = volumes[i]
        if bar_high <= bar_low or bar_vol <= 0:
            continue

        # Find which bins this bar spans
        start_bin = int((bar_low - price_low) / bin_size)
        end_bin = int((bar_high - price_low) / bin_size)
        start_bin = max(0, min(start_bin, n_bins - 1))
        end_bin = max(0, min(end_bin, n_bins - 1))

        # Distribute volume evenly across spanned bins
        n_spanned = end_bin - start_bin + 1
        vol_per_bin = bar_vol / n_spanned
        bin_volumes[start_bin:end_bin + 1] += vol_per_bin

    # POC = price level of the bin with maximum volume
    poc_bin = int(np.argmax(bin_volumes))
    poc = price_low + (poc_bin + 0.5) * bin_size

    # Value Area: expand from POC bin outward until va_pct volume captured
    va_volume_target = total_vol * va_pct
    va_volume = bin_volumes[poc_bin]
    lower_idx = poc_bin - 1
    upper_idx = poc_bin + 1

    while va_volume < va_volume_target and (lower_idx >= 0 or upper_idx < n_bins):
        lower_vol = bin_volumes[lower_idx] if lower_idx >= 0 else 0
        upper_vol = bin_volumes[upper_idx] if upper_idx < n_bins else 0

        if lower_vol >= upper_vol:
            if lower_idx >= 0:
                va_volume += bin_volumes[lower_idx]
                lower_idx -= 1
            elif upper_idx < n_bins:
                va_volume += bin_volumes[upper_idx]
                upper_idx += 1
        else:
            if upper_idx < n_bins:
                va_volume += bin_volumes[upper_idx]
                upper_idx += 1
            elif lower_idx >= 0:
                va_volume += bin_volumes[lower_idx]
                lower_idx -= 1

    val_ = price_low + (lower_idx + 1) * bin_size
    vah = price_low + upper_idx * bin_size

    # Clamp to actual price range
    vah = min(vah, price_high)
    val_ = max(val_, price_low)

    result = {"poc": float(poc), "vah": float(vah), "val": float(val_)}

    if return_histogram:
        # Return bin center prices and volumes for charting
        bin_prices = [price_low + (i + 0.5) * bin_size for i in range(n_bins)]
        result["histogram"] = {
            "prices": bin_prices,
            "volumes": bin_volumes.tolist(),
        }

    return result


def calc_atr(df, length):
    """Calculate Average True Range."""
    h, l, c = df["High"].values, df["Low"].values, df["Close"].values
    tr = np.maximum(h[1:] - l[1:], np.maximum(np.abs(h[1:] - c[:-1]), np.abs(l[1:] - c[:-1])))
    if len(tr) < length:
        return None
    return float(np.mean(tr[-length:]))


def calc_vwap(df, lookback):
    """Calculate rolling VWAP over lookback period."""
    d = df.tail(lookback)
    hlc3 = (d["High"].values + d["Low"].values + d["Close"].values) / 3
    vol = d["Volume"].values
    sum_v = vol.sum()
    if sum_v == 0:
        return None
    return float(np.sum(hlc3 * vol) / sum_v)


def calc_delta(df, lookback=10):
    """Approximate delta (buy/sell pressure) from daily OHLCV.
    Positive = net buying, Negative = net selling."""
    tail = df.tail(lookback)
    ranges = (tail["High"] - tail["Low"]).values
    deltas = np.where(
        ranges > 0,
        (tail["Close"].values - tail["Open"].values) / ranges * tail["Volume"].values,
        0,
    )
    return float(np.sum(deltas))


def calc_vol_ratio(df, vol_ma_len=21):
    """Current volume / MA volume."""
    vol_ma = df["Volume"].iloc[-vol_ma_len:].mean()
    if vol_ma == 0:
        return 0.0
    return float(df["Volume"].iloc[-1] / vol_ma)


def find_swing_points(df, lookback=5):
    """Find swing highs and swing lows.
    Returns (swing_highs, swing_lows) as lists of (index, price)."""
    highs = df["High"].values
    lows = df["Low"].values
    swing_highs = []
    swing_lows = []
    for i in range(lookback, len(df) - lookback):
        if highs[i] == max(highs[i - lookback:i + lookback + 1]):
            swing_highs.append((i, highs[i]))
        if lows[i] == min(lows[i - lookback:i + lookback + 1]):
            swing_lows.append((i, lows[i]))
    return swing_highs, swing_lows


def calc_anchored_vwap(df, anchor_idx):
    """Calculate VWAP anchored from a specific bar index."""
    if anchor_idx < 0:
        anchor_idx = len(df) + anchor_idx
    if anchor_idx < 0 or anchor_idx >= len(df):
        return None
    d = df.iloc[anchor_idx:]
    hlc3 = (d["High"].values + d["Low"].values + d["Close"].values) / 3
    vol = d["Volume"].values
    cum_vol = np.cumsum(vol)
    cum_vwap = np.cumsum(hlc3 * vol)
    mask = cum_vol > 0
    vwap_arr = np.where(mask, cum_vwap / cum_vol, 0)
    return float(vwap_arr[-1]) if len(vwap_arr) > 0 else None


def calc_vwap_bands(df, lookback, num_std=2):
    """Calculate VWAP with standard deviation bands over lookback period.
    Returns dict with vwap, upper, lower or None."""
    d = df.tail(lookback)
    hlc3 = (d["High"].values + d["Low"].values + d["Close"].values) / 3
    vol = d["Volume"].values
    sum_v = vol.sum()
    if sum_v == 0:
        return None
    vwap = float(np.sum(hlc3 * vol) / sum_v)
    variance = float(np.sum((hlc3 - vwap) ** 2 * vol) / sum_v)
    std = np.sqrt(max(variance, 0))
    return {"vwap": vwap, "upper": vwap + num_std * std, "lower": vwap - num_std * std, "std": std}


def find_swing_anchor(df, lookback=5):
    """Find the most recent swing low index for AVWAP anchoring."""
    _, swing_lows = find_swing_points(df, lookback)
    if swing_lows:
        return swing_lows[-1][0]
    return 0


def calc_donchian(df, period=20):
    """Calculate Donchian Channel. Returns dict with upper, lower, mid or None."""
    if len(df) < period:
        return None
    d = df.tail(period)
    upper = float(d["High"].max())
    lower = float(d["Low"].min())
    return {"upper": upper, "lower": lower, "mid": (upper + lower) / 2}


def calc_ema(series, period):
    """Calculate Exponential Moving Average. Returns last value or None."""
    if len(series) < period:
        return None
    return float(series.ewm(span=period, adjust=False).mean().iloc[-1])


def is_atr_compressed(df, atr_len=14, lookback=20, threshold=0.7):
    """Check if current ATR is compressed (< threshold * historical avg ATR)."""
    if len(df) < lookback + atr_len + 5:
        return False
    h, l, c = df["High"].values, df["Low"].values, df["Close"].values
    tr = np.maximum(h[1:] - l[1:], np.maximum(np.abs(h[1:] - c[:-1]), np.abs(l[1:] - c[:-1])))
    if len(tr) < lookback + atr_len:
        return False
    current_atr = float(np.mean(tr[-atr_len:]))
    # Use historical ATR (before current period) as baseline
    hist_atr = float(np.mean(tr[-(lookback + atr_len):-atr_len]))
    if hist_atr == 0:
        return False
    return current_atr < threshold * hist_atr


def determine_bias(df, ema_fast=20, ema_slow=50, swing_len=5, position_lookback=50):
    """Determine directional bias using 3 independent layers.

    Layer 1: EMA Stack (close vs EMA20 vs EMA50)
    Layer 2: Higher High/Higher Low structure (swing points)
    Layer 3: Price position in recent range (0-1)

    Returns:
        dict with 'bias' ("BULL"/"BEAR"/"NEUTRAL"), 'strength' (0-3),
        'ema_stack', 'structure', 'position'
    """
    if len(df) < max(ema_slow + 5, position_lookback):
        return {"bias": "NEUTRAL", "strength": 0, "ema_stack": 0,
                "structure": 0, "position": 0.5}

    c = df["Close"].values.astype(float)
    h = df["High"].values.astype(float)
    l = df["Low"].values.astype(float)
    last_close = float(c[-1])

    score = 0  # -3 to +3

    # ─── Layer 1: EMA Stack ───
    ema_f = float(df["Close"].ewm(span=ema_fast, adjust=False).mean().iloc[-1])
    ema_s = float(df["Close"].ewm(span=ema_slow, adjust=False).mean().iloc[-1])

    ema_stack = 0
    if last_close > ema_f > ema_s:
        ema_stack = 1
        score += 1
    elif last_close < ema_f < ema_s:
        ema_stack = -1
        score -= 1

    # ─── Layer 2: HH/HL or LH/LL Structure ───
    swing_highs, swing_lows = find_swing_points(df.tail(position_lookback), swing_len)

    structure = 0
    if len(swing_highs) >= 2 and len(swing_lows) >= 2:
        hh = swing_highs[-1][1] > swing_highs[-2][1]  # Higher High
        hl = swing_lows[-1][1] > swing_lows[-2][1]    # Higher Low
        lh = swing_highs[-1][1] < swing_highs[-2][1]  # Lower High
        ll = swing_lows[-1][1] < swing_lows[-2][1]    # Lower Low

        if hh and hl:
            structure = 1
            score += 1
        elif lh and ll:
            structure = -1
            score -= 1

    # ─── Layer 3: Price Position in Range ───
    recent_high = float(np.max(h[-position_lookback:]))
    recent_low = float(np.min(l[-position_lookback:]))
    price_range = recent_high - recent_low

    if price_range > 0:
        position = (last_close - recent_low) / price_range
    else:
        position = 0.5

    if position > 0.7:
        score += 1
    elif position < 0.3:
        score -= 1

    # ─── Determine Bias ───
    if score >= 2:
        bias = "BULL"
    elif score <= -2:
        bias = "BEAR"
    else:
        bias = "NEUTRAL"

    return {
        "bias": bias,
        "strength": abs(score),
        "ema_stack": ema_stack,
        "structure": structure,
        "position": round(position, 3),
    }
