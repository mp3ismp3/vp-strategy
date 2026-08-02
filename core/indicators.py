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


def calc_vp_hourly(df_1h, lookback_days=60, va_pct=0.68, n_bins=None,
                   return_histogram=False):
    """Calculate VP using 1H bars for higher precision.

    Each 1H bar has a much narrower H-L range than daily bars, so volume
    is assigned to fewer bins → more precise VP shape.

    Args:
        df_1h: DataFrame with 1H OHLCV data
        lookback_days: number of trading days to include
        va_pct: Value Area percentage (default 0.68)
        n_bins: number of bins (None = auto via calc_dynamic_bins)
        return_histogram: include histogram data in result

    Returns same format as calc_vp.
    """
    if df_1h is None or len(df_1h) < 50:
        return None

    # Filter to last N trading days (~7 bars per day)
    bars_needed = lookback_days * 7
    d = df_1h.tail(bars_needed)

    if len(d) < 50:
        return None

    # Auto bin count if not specified
    if n_bins is None:
        n_bins = calc_dynamic_bins(d)

    return calc_vp(d, len(d), va_pct, n_bins=n_bins,
                   return_histogram=return_histogram)


def calc_dynamic_bins(df, atr_len=14, min_bins=50, max_bins=200):
    """Calculate optimal bin count based on price range vs ATR.

    Each bin should be approximately half an ATR wide for meaningful
    volume node detection.

    Args:
        df: OHLCV DataFrame (daily or intraday)
        atr_len: ATR period
        min_bins: minimum bins
        max_bins: maximum bins

    Returns:
        int: optimal number of bins
    """
    if len(df) < atr_len + 1:
        return 100  # default fallback

    atr = calc_atr(df, atr_len)
    if atr is None or atr <= 0:
        return 100

    price_high = df["High"].values[-len(df):].max()
    price_low = df["Low"].values[-len(df):].min()
    price_range = price_high - price_low

    if price_range <= 0:
        return 100

    # Target: each bin ≈ ATR/2 wide
    bin_width = atr / 2
    n_bins = int(price_range / bin_width)

    return max(min_bins, min(n_bins, max_bins))


def detect_hvn_lvn(bin_volumes, bin_prices, threshold_hvn=1.0, threshold_lvn=0.3):
    """Detect High Volume Nodes and Low Volume Nodes from VP histogram.

    HVN = bins with volume > mean + threshold_hvn * std (support/resistance)
    LVN = bins with volume < mean * threshold_lvn between two HVNs (fast-move zones)

    Args:
        bin_volumes: list of volume per bin
        bin_prices: list of price per bin (bin centers)
        threshold_hvn: std multiplier for HVN detection (default 1.0)
        threshold_lvn: fraction of mean for LVN detection (default 0.3)

    Returns:
        {"hvn": [{"price": f, "volume": f, "strength": f}],
         "lvn": [{"price": f, "volume": f}]}
    """
    volumes = np.array(bin_volumes)
    prices = np.array(bin_prices)

    if len(volumes) == 0 or volumes.max() == 0:
        return {"hvn": [], "lvn": []}

    mean_vol = volumes.mean()
    std_vol = volumes.std()
    max_vol = volumes.max()

    # HVN: peaks above mean + threshold * std
    hvn_threshold = mean_vol + threshold_hvn * std_vol
    hvn_mask = volumes >= hvn_threshold

    hvn_list = []
    for i in range(len(volumes)):
        if hvn_mask[i]:
            hvn_list.append({
                "price": round(float(prices[i]), 2),
                "volume": float(volumes[i]),
                "strength": round(float(volumes[i] / max_vol), 2),
            })

    # LVN: valleys below mean * threshold, between HVNs
    lvn_threshold = mean_vol * threshold_lvn
    lvn_list = []

    # Find LVN regions between HVN peaks
    hvn_indices = np.where(hvn_mask)[0]
    if len(hvn_indices) >= 2:
        for j in range(len(hvn_indices) - 1):
            start = hvn_indices[j] + 1
            end = hvn_indices[j + 1]
            if end <= start:
                continue
            region = volumes[start:end]
            region_prices = prices[start:end]
            for k in range(len(region)):
                if region[k] < lvn_threshold:
                    lvn_list.append({
                        "price": round(float(region_prices[k]), 2),
                        "volume": float(region[k]),
                    })

    return {"hvn": hvn_list, "lvn": lvn_list}


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


def calc_macd(df, fast=12, slow=26, signal=9):
    """Calculate MACD indicator.

    Args:
        df: DataFrame with 'Close' column
        fast: fast EMA period (default 12)
        slow: slow EMA period (default 26)
        signal: signal line EMA period (default 9)

    Returns:
        DataFrame with columns: macd, signal, histogram
        Returns None if insufficient data.
    """
    import pandas as pd

    if df is None or len(df) < slow + signal:
        return None

    close = df["Close"]
    ema_fast = close.ewm(span=fast, adjust=False).mean()
    ema_slow = close.ewm(span=slow, adjust=False).mean()
    macd_line = ema_fast - ema_slow
    signal_line = macd_line.ewm(span=signal, adjust=False).mean()
    histogram = macd_line - signal_line

    result = pd.DataFrame({
        "macd": macd_line,
        "signal": signal_line,
        "histogram": histogram,
    }, index=df.index)

    return result


def find_swing_highs(values, lookback=5):
    """Find swing high points in a 1-D array.

    A swing high is a point higher than all points within `lookback` on both sides.

    Args:
        values: numpy array of prices or indicator values.
        lookback: number of bars on each side to compare.

    Returns:
        List of dicts: [{"index": int, "value": float}, ...]
    """
    import numpy as np

    values = np.asarray(values, dtype=float)
    points = []
    for i in range(lookback, len(values) - lookback):
        window = values[i - lookback: i + lookback + 1]
        if values[i] == window.max() and np.sum(window == values[i]) == 1:
            points.append({"index": i, "value": float(values[i])})
    return points


def find_swing_lows(values, lookback=5):
    """Find swing low points in a 1-D array.

    A swing low is a point lower than all points within `lookback` on both sides.

    Args:
        values: numpy array of prices or indicator values.
        lookback: number of bars on each side to compare.

    Returns:
        List of dicts: [{"index": int, "value": float}, ...]
    """
    import numpy as np

    values = np.asarray(values, dtype=float)
    points = []
    for i in range(lookback, len(values) - lookback):
        window = values[i - lookback: i + lookback + 1]
        if values[i] == window.min() and np.sum(window == values[i]) == 1:
            points.append({"index": i, "value": float(values[i])})
    return points


def macd_turning_points(macd_values, mode="low"):
    """Find MACD turning points using zero-crossing segmentation.

    Instead of swing detection (which requires a tunable lookback parameter),
    this uses MACD's natural structure: segments between zero-crossings contain
    turning points. Within each segment, all significant extrema are detected
    by finding points where the derivative changes sign.

    This is parameter-free and robust because MACD is already smoothed by EMA.

    Args:
        macd_values: 1-D numpy array of MACD line values.
        mode: "low" to find lows (in negative segments),
              "high" to find highs (in positive segments).

    Returns:
        List of dicts: [{"index": int, "value": float}, ...]
    """
    import numpy as np

    values = np.asarray(macd_values, dtype=float)
    n = len(values)
    if n < 3:
        return []

    points = []

    # Find zero-crossing boundaries
    crossings = [0]
    for i in range(1, n):
        if values[i] * values[i - 1] < 0:
            crossings.append(i)
    crossings.append(n)

    for seg_idx in range(len(crossings) - 1):
        seg_start = crossings[seg_idx]
        seg_end = crossings[seg_idx + 1]
        seg = values[seg_start:seg_end]

        if len(seg) < 2:
            continue

        if mode == "low":
            # Only consider segments where MACD is negative (below zero)
            if seg.mean() >= 0:
                continue
            # Find all local minima within this segment
            seg_points = _find_segment_extrema(seg, seg_start, mode="min")
            if seg_points:
                points.extend(seg_points)
            else:
                # Fallback: absolute min of segment
                local_idx = int(np.argmin(seg))
                points.append({
                    "index": seg_start + local_idx,
                    "value": float(seg[local_idx]),
                })
        else:  # mode == "high"
            # Only consider segments where MACD is positive (above zero)
            if seg.mean() <= 0:
                continue
            # Find all local maxima within this segment
            seg_points = _find_segment_extrema(seg, seg_start, mode="max")
            if seg_points:
                points.extend(seg_points)
            else:
                # Fallback: absolute max of segment
                local_idx = int(np.argmax(seg))
                points.append({
                    "index": seg_start + local_idx,
                    "value": float(seg[local_idx]),
                })

    return points


def _find_segment_extrema(seg, seg_start, mode="min"):
    """Find local extrema within a MACD segment using derivative sign changes.

    Since MACD is already smoothed, we just look for direction reversals.
    A local min/max occurs where the MACD stops falling/rising and reverses.

    Args:
        seg: numpy array of values within one zero-crossing segment.
        seg_start: absolute index offset for this segment.
        mode: "min" or "max".

    Returns:
        List of dicts with index/value, or empty list.
    """
    import numpy as np

    if len(seg) < 3:
        return []

    points = []
    # Compute differences (sign of slope)
    diff = np.diff(seg)

    for i in range(1, len(diff)):
        if mode == "min":
            # Slope goes from negative to positive (or zero) → local minimum
            if diff[i - 1] < 0 and diff[i] >= 0:
                points.append({
                    "index": seg_start + i,
                    "value": float(seg[i]),
                })
        else:  # mode == "max"
            # Slope goes from positive to negative (or zero) → local maximum
            if diff[i - 1] > 0 and diff[i] <= 0:
                points.append({
                    "index": seg_start + i,
                    "value": float(seg[i]),
                })

    # If multiple points found, filter out insignificant ones
    # (keep only those that are at least 20% of segment range from each other)
    if len(points) > 1:
        seg_range = float(np.ptp(seg))
        if seg_range > 0:
            min_significance = seg_range * 0.15
            filtered = [points[0]]
            for p in points[1:]:
                if abs(p["value"] - filtered[-1]["value"]) >= min_significance:
                    filtered.append(p)
                elif mode == "min" and p["value"] < filtered[-1]["value"]:
                    filtered[-1] = p
                elif mode == "max" and p["value"] > filtered[-1]["value"]:
                    filtered[-1] = p
            points = filtered

    return points


def detect_macd_divergence(df, lookback=60, swing_lookback=5, max_bars_ago=10):
    """Detect MACD divergence (bullish and bearish) on a DataFrame.

    Bullish divergence: price makes lower low, MACD makes higher low.
    Bearish divergence: price makes higher high, MACD makes lower high.

    Price turning points use swing detection (lookback-based).
    MACD turning points use zero-crossing segmentation (parameter-free),
    which is more robust because MACD is already smoothed by EMA.

    Args:
        df: DataFrame with OHLCV columns (needs at least slow+signal+lookback bars).
        lookback: how many recent bars to scan for swing points.
        swing_lookback: swing point sensitivity for price (bars on each side).
        max_bars_ago: only report divergences where the latest swing is within
                      this many bars from the end.

    Returns:
        List of dicts:
        [{"type": "bullish"|"bearish",
          "bars_ago": int,
          "price_prev": float, "price_curr": float,
          "macd_prev": float, "macd_curr": float,
          "index": int (absolute index in df)}, ...]
        Returns empty list if insufficient data.
    """
    import numpy as np

    macd_df = calc_macd(df)
    if macd_df is None:
        return []

    n = len(df)
    if n < lookback:
        return []

    start = n - lookback
    price_lows = df["Low"].values.astype(float)
    price_highs = df["High"].values.astype(float)
    macd_values = macd_df["macd"].values.astype(float)

    signals = []

    # MACD turning points via zero-crossing (parameter-free)
    m_lows = macd_turning_points(macd_values[start:], mode="low")
    m_highs = macd_turning_points(macd_values[start:], mode="high")

    # ─── Bullish Divergence: price lower low + MACD higher low ───
    p_lows = find_swing_lows(price_lows[start:], swing_lookback)

    if len(p_lows) >= 2 and len(m_lows) >= 2:
        p1 = p_lows[-2]
        p2 = p_lows[-1]

        # Find MACD low closest to each price low
        m1 = _closest_swing(m_lows, p1["index"])
        m2 = _closest_swing(m_lows, p2["index"])

        if m1 and m2:
            bars_ago = (lookback - 1) - p2["index"]
            if (p2["value"] < p1["value"] and
                    m2["value"] > m1["value"] and
                    bars_ago <= max_bars_ago):
                signals.append({
                    "type": "bullish",
                    "bars_ago": bars_ago,
                    "price_prev": p1["value"],
                    "price_curr": p2["value"],
                    "macd_prev": m1["value"],
                    "macd_curr": m2["value"],
                    "index": start + p2["index"],
                })

    # ─── Bearish Divergence: price higher high + MACD lower high ───
    p_highs = find_swing_highs(price_highs[start:], swing_lookback)

    if len(p_highs) >= 2 and len(m_highs) >= 2:
        p1 = p_highs[-2]
        p2 = p_highs[-1]

        m1 = _closest_swing(m_highs, p1["index"])
        m2 = _closest_swing(m_highs, p2["index"])

        if m1 and m2:
            bars_ago = (lookback - 1) - p2["index"]
            if (p2["value"] > p1["value"] and
                    m2["value"] < m1["value"] and
                    bars_ago <= max_bars_ago):
                signals.append({
                    "type": "bearish",
                    "bars_ago": bars_ago,
                    "price_prev": p1["value"],
                    "price_curr": p2["value"],
                    "macd_prev": m1["value"],
                    "macd_curr": m2["value"],
                    "index": start + p2["index"],
                })

    return signals


def _closest_swing(swings, target_index, tolerance=6):
    """Find the swing point closest to target_index within tolerance."""
    best = None
    best_dist = tolerance
    for s in swings:
        dist = abs(s["index"] - target_index)
        if dist < best_dist:
            best_dist = dist
            best = s
    return best


def resample_to_weekly(df):
    """Resample a daily OHLCV DataFrame to weekly bars.

    Args:
        df: DataFrame with OHLCV columns and DatetimeIndex.

    Returns:
        Weekly DataFrame with same columns, or None if insufficient data.
    """
    import pandas as pd

    if df is None or len(df) < 10:
        return None

    weekly = df.resample("W").agg({
        "Open": "first",
        "High": "max",
        "Low": "min",
        "Close": "last",
        "Volume": "sum",
    }).dropna()

    return weekly if len(weekly) >= 5 else None


def detect_fvg(df, lookback=60, min_gap_atr_ratio=0.5):
    """Detect Fair Value Gaps (FVG) on daily bars.

    A bullish FVG occurs when candle[i-1].High < candle[i+1].Low
    (gap between first candle's high and third candle's low → unfilled buying).

    A bearish FVG occurs when candle[i-1].Low > candle[i+1].High
    (gap between first candle's low and third candle's high → unfilled selling).

    Only gaps wider than min_gap_atr_ratio * ATR(14) are reported to filter noise.
    Also checks if the gap has been "filled" (price returned to close the gap).

    Args:
        df: DataFrame with OHLCV columns and DatetimeIndex.
        lookback: number of recent bars to scan (default 60).
        min_gap_atr_ratio: minimum gap size as fraction of ATR (default 0.5).

    Returns:
        List of dicts:
        [{"type": "bullish"|"bearish",
          "gap_high": float,   # upper edge of the gap
          "gap_low": float,    # lower edge of the gap
          "gap_size": float,   # gap_high - gap_low
          "bar_index": int,    # index of the middle candle (the impulse candle)
          "date": str,         # date of the middle candle (ISO format)
          "filled": bool,      # True if subsequent price action filled the gap
          "fill_pct": float,   # 0.0-1.0, how much of the gap has been filled
         }, ...]
        Returns empty list if insufficient data.
    """
    if df is None or len(df) < lookback or len(df) < 20:
        return []

    d = df.tail(lookback).copy()
    d = d.reset_index(drop=False)  # keep date as column

    highs = d["High"].values.astype(float)
    lows = d["Low"].values.astype(float)
    closes = d["Close"].values.astype(float)

    n = len(d)
    if n < 3:
        return []

    # Calculate ATR for gap significance filtering
    atr = calc_atr(df, 14)
    if atr is None or atr <= 0:
        min_gap = 0  # no filtering if ATR unavailable
    else:
        min_gap = atr * min_gap_atr_ratio

    fvgs = []

    for i in range(1, n - 1):
        # Bullish FVG: candle[i-1].High < candle[i+1].Low
        # The gap is between candle[i-1].High (gap_low) and candle[i+1].Low (gap_high)
        bull_gap_low = highs[i - 1]
        bull_gap_high = lows[i + 1]

        if bull_gap_high > bull_gap_low:
            gap_size = bull_gap_high - bull_gap_low
            if gap_size >= min_gap:
                # Check if gap has been filled by subsequent price action
                filled, fill_pct = _check_fvg_fill(
                    lows[i + 1:], bull_gap_low, bull_gap_high, "bullish"
                )

                # Get date from the middle candle
                date_val = d.iloc[i].get("Date", d.iloc[i].get("index", ""))
                date_str = str(date_val)[:10] if date_val is not None else ""

                fvgs.append({
                    "type": "bullish",
                    "gap_high": round(float(bull_gap_high), 2),
                    "gap_low": round(float(bull_gap_low), 2),
                    "gap_size": round(float(gap_size), 2),
                    "bar_index": i,
                    "date": date_str,
                    "filled": filled,
                    "fill_pct": round(float(fill_pct), 2),
                })

        # Bearish FVG: candle[i-1].Low > candle[i+1].High
        # The gap is between candle[i+1].High (gap_low) and candle[i-1].Low (gap_high)
        bear_gap_high = lows[i - 1]
        bear_gap_low = highs[i + 1]

        if bear_gap_high > bear_gap_low:
            gap_size = bear_gap_high - bear_gap_low
            if gap_size >= min_gap:
                # Check if gap has been filled
                filled, fill_pct = _check_fvg_fill(
                    highs[i + 1:], bear_gap_low, bear_gap_high, "bearish"
                )

                date_val = d.iloc[i].get("Date", d.iloc[i].get("index", ""))
                date_str = str(date_val)[:10] if date_val is not None else ""

                fvgs.append({
                    "type": "bearish",
                    "gap_high": round(float(bear_gap_high), 2),
                    "gap_low": round(float(bear_gap_low), 2),
                    "gap_size": round(float(gap_size), 2),
                    "bar_index": i,
                    "date": date_str,
                    "filled": filled,
                    "fill_pct": round(float(fill_pct), 2),
                })

    return fvgs


def _check_fvg_fill(subsequent_prices, gap_low, gap_high, fvg_type):
    """Check how much of an FVG has been filled by subsequent price action.

    For bullish FVG: price dips back down into the gap (lows penetrate gap_high→gap_low).
    For bearish FVG: price rallies back up into the gap (highs penetrate gap_low→gap_high).

    Args:
        subsequent_prices: array of lows (bullish) or highs (bearish) after the FVG.
        gap_low: lower boundary of the gap.
        gap_high: upper boundary of the gap.
        fvg_type: "bullish" or "bearish".

    Returns:
        (filled: bool, fill_pct: float 0.0-1.0)
    """
    if len(subsequent_prices) == 0:
        return False, 0.0

    gap_size = gap_high - gap_low
    if gap_size <= 0:
        return True, 1.0

    if fvg_type == "bullish":
        # For bullish FVG, check if any subsequent low went below gap_high
        # Fill amount = how far below gap_high the low reached, relative to gap_size
        min_low = float(np.min(subsequent_prices))
        if min_low >= gap_high:
            return False, 0.0
        penetration = gap_high - max(min_low, gap_low)
        fill_pct = min(penetration / gap_size, 1.0)
        filled = bool(fill_pct >= 1.0)
    else:
        # For bearish FVG, check if any subsequent high went above gap_low
        max_high = float(np.max(subsequent_prices))
        if max_high <= gap_low:
            return False, 0.0
        penetration = min(max_high, gap_high) - gap_low
        fill_pct = min(penetration / gap_size, 1.0)
        filled = bool(fill_pct >= 1.0)

    return filled, float(fill_pct)
