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
    if df is None or len(df) < 60:
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

    def _build_tf(vp, source="daily"):
        if vp is None:
            return None
        result = {
            "poc": round(vp["poc"], 2),
            "vah": round(vp["vah"], 2),
            "val": round(vp["val"], 2),
            "position": _price_position(price, vp["val"], vp["vah"]),
            "position_pct": _price_position_pct(price, vp["val"], vp["vah"]),
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
        "daily": _build_tf(daily_vp, daily_source),
        "weekly": _build_tf(weekly_vp, "weekly"),
        "monthly": _build_tf(monthly_vp, "monthly"),
    }
