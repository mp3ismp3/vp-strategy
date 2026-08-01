"""
Export chart data for the Next.js frontend.

Generates:
  - data/frontend_charts.json — OHLC + VP histogram for all symbols

Run after scan_all.py in CI:
  python export_frontend_data.py

This script does NOT modify scan_results.json or accum_state.json.
"""

import json
import sys
from pathlib import Path

import pandas as pd

from config import SYMBOLS, DEFAULT_CFG
from core.data_provider import YahooProvider
from core.vp_multitf import compute_vp_multitf, resample_to_weekly, resample_to_monthly

DRY_RUN = "--dry-run" in sys.argv
DATA_DIR = Path(__file__).parent / "data"
OUTPUT_FILE = DATA_DIR / "frontend_charts.json"


def _df_to_ohlc(df: pd.DataFrame, n_bars: int) -> list[dict]:
    """Convert last n_bars of DataFrame to OHLC list for frontend."""
    import math
    tail = df.tail(n_bars)
    records = []
    for ts, row in tail.iterrows():
        o, h, l, c, v = float(row["Open"]), float(row["High"]), float(row["Low"]), float(row["Close"]), float(row["Volume"])
        # Skip bars with NaN
        if math.isnan(o) or math.isnan(h) or math.isnan(l) or math.isnan(c):
            continue
        records.append({
            "time": ts.strftime("%Y-%m-%d"),
            "open": round(o, 2),
            "high": round(h, 2),
            "low": round(l, 2),
            "close": round(c, 2),
            "volume": int(v) if not math.isnan(v) else 0,
        })
    return records


def _trim_histogram(hist: dict) -> dict:
    """Format histogram for JSON output. Keep all bins (100) for full precision."""
    if not hist:
        return None
    prices = hist.get("prices", [])
    volumes = hist.get("volumes", [])
    return {
        "prices": [round(p, 2) for p in prices],
        "volumes": [round(v, 0) for v in volumes],
    }


def main():
    print(f"Exporting frontend chart data for {len(SYMBOLS)} symbols...")

    provider = YahooProvider(max_workers=5, jitter=(0.1, 0.3))
    print("  Downloading daily data...")
    data = provider.batch_daily(SYMBOLS, period="1y")
    print(f"  Downloaded {len(data)}/{len(SYMBOLS)}")

    print("  Downloading 1H data...")
    data_1h = provider.batch_intraday(SYMBOLS, period="730d", interval="1h")
    print(f"  Downloaded {len(data_1h)}/{len(SYMBOLS)} 1H")

    charts = {}

    for symbol in SYMBOLS:
        df = data.get(symbol)
        if df is None or len(df) < 60:
            continue

        df_1h = data_1h.get(symbol)

        try:
            vp = compute_vp_multitf(df, DEFAULT_CFG["va_pct"], df_1h=df_1h)
            if not vp:
                continue

            weekly_df = resample_to_weekly(df)
            monthly_df = resample_to_monthly(df)

            chart_data = {
                "price": vp["price"] if vp["price"] == vp["price"] else float(df["Close"].dropna().iloc[-1]),
                "daily": {
                    "ohlc": _df_to_ohlc(df, 252),
                    "poc": vp["daily"]["poc"],
                    "vah": vp["daily"]["vah"],
                    "val": vp["daily"]["val"],
                    "position": vp["daily"]["position"],
                    "position_pct": vp["daily"]["position_pct"],
                    "histogram": _trim_histogram(vp["daily"].get("histogram")),
                },
                "weekly": {
                    "ohlc": _df_to_ohlc(weekly_df, 52),
                    "poc": vp["weekly"]["poc"] if vp.get("weekly") else 0,
                    "vah": vp["weekly"]["vah"] if vp.get("weekly") else 0,
                    "val": vp["weekly"]["val"] if vp.get("weekly") else 0,
                    "position": vp["weekly"]["position"] if vp.get("weekly") else "inside_va",
                    "position_pct": vp["weekly"]["position_pct"] if vp.get("weekly") else 0,
                    "histogram": _trim_histogram(vp["weekly"].get("histogram")) if vp.get("weekly") else None,
                },
                "monthly": {
                    "ohlc": _df_to_ohlc(monthly_df, 12),
                    "poc": vp["monthly"]["poc"] if vp.get("monthly") else 0,
                    "vah": vp["monthly"]["vah"] if vp.get("monthly") else 0,
                    "val": vp["monthly"]["val"] if vp.get("monthly") else 0,
                    "position": vp["monthly"]["position"] if vp.get("monthly") else "inside_va",
                    "position_pct": vp["monthly"]["position_pct"] if vp.get("monthly") else 0,
                    "histogram": _trim_histogram(vp["monthly"].get("histogram")) if vp.get("monthly") else None,
                },
            }

            charts[symbol] = chart_data

        except Exception as e:
            print(f"  Error {symbol}: {e}")

    # Save
    DATA_DIR.mkdir(exist_ok=True)
    # Replace NaN with null for valid JSON
    json_str = json.dumps(charts, indent=2, ensure_ascii=False)
    json_str = json_str.replace(": NaN", ": null")
    OUTPUT_FILE.write_text(json_str)
    size_mb = OUTPUT_FILE.stat().st_size / 1024 / 1024
    print(f"\n  Saved {len(charts)} symbols to {OUTPUT_FILE} ({size_mb:.1f} MB)")


if __name__ == "__main__":
    main()
