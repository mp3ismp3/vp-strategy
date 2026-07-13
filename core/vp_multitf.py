"""VP Multi-Timeframe Analysis — computes POC/VAH/VAL on daily/weekly/monthly.

For each timeframe, shows where current price sits relative to value area.
"""

import numpy as np
import pandas as pd

from core.indicators import calc_vp


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

    Returns: 'above_va', 'inside_va', 'below_va', 'at_poc'
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


def compute_vp_multitf(df: pd.DataFrame, va_pct: float = 0.68) -> dict:
    """Compute Volume Profile for daily/weekly/monthly timeframes.

    Args:
        df: Daily OHLCV DataFrame (needs at least 6 months of data)
        va_pct: Value Area percentage (default 0.68)

    Returns:
        {
            "price": float,  # current close price
            "daily": {"poc": f, "vah": f, "val": f, "position": str, "position_pct": f},
            "weekly": {"poc": f, "vah": f, "val": f, "position": str, "position_pct": f},
            "monthly": {"poc": f, "vah": f, "val": f, "position": str, "position_pct": f},
        }
        Returns None if insufficient data.
    """
    if df is None or len(df) < 60:
        return None

    price = float(df["Close"].iloc[-1])

    # Daily VP: last 60 bars
    daily_vp = calc_vp(df, 60, va_pct, return_histogram=True)
    if daily_vp is None:
        return None

    # Weekly VP: last 52 weeks
    weekly_df = resample_to_weekly(df)
    weekly_vp = calc_vp(weekly_df, min(52, len(weekly_df)), va_pct, return_histogram=True) if len(weekly_df) >= 12 else None

    # Monthly VP: last 12 months
    monthly_df = resample_to_monthly(df)
    monthly_vp = calc_vp(monthly_df, min(12, len(monthly_df)), va_pct, return_histogram=True) if len(monthly_df) >= 6 else None

    def _build_tf(vp):
        if vp is None:
            return None
        result = {
            "poc": round(vp["poc"], 2),
            "vah": round(vp["vah"], 2),
            "val": round(vp["val"], 2),
            "position": _price_position(price, vp["val"], vp["vah"]),
            "position_pct": _price_position_pct(price, vp["val"], vp["vah"]),
        }
        if "histogram" in vp:
            result["histogram"] = vp["histogram"]
        return result

    return {
        "price": round(price, 2),
        "daily": _build_tf(daily_vp),
        "weekly": _build_tf(weekly_vp),
        "monthly": _build_tf(monthly_vp),
    }
