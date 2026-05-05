"""Shared technical indicators."""

import numpy as np


def calc_vp(df, lookback, va_pct):
    """Calculate Volume Profile: POC, VAH, VAL."""
    d = df.tail(lookback)
    hlc3 = (d["High"].values + d["Low"].values + d["Close"].values) / 3
    vol = d["Volume"].values
    sum_v = vol.sum()
    if sum_v == 0:
        return None
    poc = np.sum(hlc3 * vol) / sum_v
    vw_var = np.sum(hlc3 ** 2 * vol) / sum_v - poc ** 2
    vw_std = np.sqrt(max(vw_var, 0))
    if va_pct <= 0.5:
        k = va_pct * 1.35
    elif va_pct <= 0.68:
        k = 0.67 + (va_pct - 0.5) * 1.83
    elif va_pct <= 0.80:
        k = 1.0 + (va_pct - 0.68) * 2.33
    else:
        k = 1.28 + (va_pct - 0.80) * 2.47
    vah = min(poc + k * vw_std, d["High"].max())
    val_ = max(poc - k * vw_std, d["Low"].min())
    return {"poc": poc, "vah": vah, "val": val_}


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
