"""VP Multi-Timeframe Analysis — computes POC/VAH/VAL on daily/weekly/monthly.

For each timeframe, shows where current price sits relative to value area.
When 1H data is available, uses it for daily VP (7x precision improvement).
"""

import numpy as np
import pandas as pd

from core.indicators import calc_vp, calc_vp_hourly, detect_hvn_lvn


def resample_to_weekly(df: pd.DataFrame) -> pd.DataFrame:
    """Resample daily OHLCV to weekly."""
    weekly = df.resample("W").agg({
        "Open": "first",
        "High": "max",
        "Low": "min",
        "Close": "last",
        "Volume": "sum",
    }).dropna()
    return weekly


def resample_to_monthly(df: pd.DataFrame) -> pd.DataFrame:
    """Resample daily OHLCV to monthly."""
    monthly = df.resample("ME").agg({
        "Open": "first",
        "High": "max",
        "Low": "min",
        "Close": "last",
        "Volume": "sum",
    }).dropna()
    return monthly


def _price_position(price, val, vah):
    """Determine price position relative to VA.

    Returns: 'above_va', 'inside_va', 'below_va'
    """
    if price > vah:
        return "above_va"
    elif price < val:
        return "below_va"
    else:
        return "inside_va"


def _price_position_pct(price, val, vah):
    """Price position as percentage within VA. 0%=VAL, 100%=VAH, can exceed."""
    if vah == val:
        return 50.0
    return round((price - val) / (vah - val) * 100, 1)


def _va_touch(low, high, val, vah):
    """Return which value-area edge the latest bar touched, if any.

    The latest bar is considered to touch an edge when its full range crosses
    that edge.  This captures intraday tests even when the close moves away
    before the scan runs.
    """
    touches = []
    if low <= val <= high:
        touches.append("val")
    if low <= vah <= high and vah != val:
        touches.append("vah")
    if len(touches) == 2:
        return "both"
    return touches[0] if touches else None


def _va_touch_context(touch, close, val, vah, previous_close=None,
                      low=None, high=None):
    """Describe the close after a value-area edge was tested.

    This is an observation label, not a confirmed trading signal.
    """
    if touch == "both":
        return "range_test"
    if touch == "val":
        if (previous_close is not None and high is not None
                and previous_close < val <= high and close <= val):
            return "retest_from_below"
        if close < val:
            return "closed_below_value"
        if close > val:
            return "reentered_value"
        return "at_val"
    if touch == "vah":
        if (previous_close is not None and low is not None
                and previous_close > vah >= low and close >= vah):
            return "retest_from_above"
        if close > vah:
            return "closed_above_value"
        if close < vah:
            return "reentered_value"
        return "at_vah"
    return None


def compute_vp_multitf(df: pd.DataFrame, va_pct: float = 0.68,
                        df_1h: pd.DataFrame = None) -> dict:
    """Compute Volume Profile for daily/weekly/monthly timeframes.

    Args:
        df: Daily OHLCV DataFrame (needs at least 60 bars)
        va_pct: Value Area percentage (default 0.68)
        df_1h: Optional 1H OHLCV DataFrame for higher-precision daily VP

    Returns:
        {
            "price": float,
            "daily": {"poc", "vah", "val", "position", "position_pct",
                      "histogram", "hvn", "lvn", "data_source"},
            "weekly": {...},
            "monthly": {...},
        }
        Returns None if insufficient data.
    """
    required_columns = ["Open", "High", "Low", "Close", "Volume"]
    if (df is None or len(df) < 60
            or not set(required_columns).issubset(df.columns)):
        return None

    numeric_bars = df[required_columns].apply(pd.to_numeric, errors="coerce")
    valid_bars = np.isfinite(numeric_bars).all(axis=1)
    df = df.loc[valid_bars]
    if len(df) < 60:
        return None

    price = float(df["Close"].iloc[-1])

    # Daily VP: prefer 1H data if available (7x precision)
    if df_1h is not None and len(df_1h) >= 100:
        daily_vp = calc_vp_hourly(df_1h, lookback_days=60, va_pct=va_pct,
                                   return_histogram=True)
        daily_source = "1h"
    else:
        daily_vp = None
        daily_source = "daily"

    # Fallback to daily bars if 1H VP failed
    if daily_vp is None:
        daily_vp = calc_vp(df, 60, va_pct, return_histogram=True)
        daily_source = "daily"

    if daily_vp is None:
        return None

    # Weekly VP: resampled daily (1H too granular for weekly)
    weekly_df = resample_to_weekly(df)
    weekly_vp = (calc_vp(weekly_df, min(52, len(weekly_df)), va_pct,
                         return_histogram=True)
                 if len(weekly_df) >= 12 else None)

    # Monthly VP: resampled daily
    monthly_df = resample_to_monthly(df)
    monthly_vp = (calc_vp(monthly_df, min(12, len(monthly_df)), va_pct,
                          return_histogram=True)
                  if len(monthly_df) >= 6 else None)

    latest_high = float(df["High"].iloc[-1])
    latest_low = float(df["Low"].iloc[-1])
    previous_close = float(df["Close"].iloc[-2]) if len(df) > 1 else None
    latest_date = pd.Timestamp(df.index[-1]).date().isoformat()

    def _build_tf(vp, source="daily"):
        if vp is None:
            return None
        touch = _va_touch(latest_low, latest_high, vp["val"], vp["vah"])
        result = {
            "poc": round(vp["poc"], 2),
            "vah": round(vp["vah"], 2),
            "val": round(vp["val"], 2),
            "position": _price_position(price, vp["val"], vp["vah"]),
            "position_pct": _price_position_pct(price, vp["val"], vp["vah"]),
            "va_touch": touch,
            "va_touch_date": latest_date if touch else None,
            "va_touch_context": _va_touch_context(
                touch, price, vp["val"], vp["vah"],
                previous_close=previous_close,
                low=latest_low,
                high=latest_high,
            ),
            "data_source": source,
        }
        if "histogram" in vp:
            result["histogram"] = vp["histogram"]
            # Detect HVN/LVN
            hvn_lvn = detect_hvn_lvn(
                vp["histogram"]["volumes"],
                vp["histogram"]["prices"],
            )
            result["hvn"] = hvn_lvn["hvn"]
            result["lvn"] = hvn_lvn["lvn"]
        return result

    return {
        "price": round(price, 2),
        "bar_date": latest_date,
        "daily": _build_tf(daily_vp, daily_source),
        "weekly": _build_tf(weekly_vp, "weekly"),
        "monthly": _build_tf(monthly_vp, "monthly"),
    }
