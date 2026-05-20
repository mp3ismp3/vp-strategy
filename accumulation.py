"""Accumulation Detection — identifies steady institutional buying.

Indicators:
1. OBV Trend: On-Balance Volume rising while price flat
2. Positive Delta Streak: More buying days than selling days
3. Volume Asymmetry: Rally volume > pullback volume
4. Price Tightening: Range compresses but volume maintained
5. Close Position: Consistently closing in upper half of bar
6. Price Position Guard: Discount if near highs (possible distribution)
7. Spike filter: Exclude event-driven volume spikes from calculations

Usage:
    python accumulation.py NVDA
    python accumulation.py NVDA,AVGO,AMD --days 40
"""

import argparse
import yfinance as yf
import pandas as pd
import numpy as np


def detect_accumulation(df, lookback=40):
    """Analyze volume behavior for signs of institutional accumulation."""
    if len(df) < lookback + 10:
        return None

    d = df.tail(lookback).copy()
    c = d["Close"].values
    o = d["Open"].values
    h = d["High"].values
    l = d["Low"].values
    v = d["Volume"].values.astype(float)
    n = len(d)

    # ─── Pre-filter: remove volume spikes > 3x avg ───
    vol_avg = np.mean(v)
    v_clean = np.where(v > 3 * vol_avg, vol_avg, v)  # Cap spikes at avg

    results = {}

    # ─── 1. OBV Trend ───
    obv = np.zeros(n)
    for i in range(1, n):
        if c[i] > c[i-1]:
            obv[i] = obv[i-1] + v_clean[i]
        elif c[i] < c[i-1]:
            obv[i] = obv[i-1] - v_clean[i]
        else:
            obv[i] = obv[i-1]

    x = np.arange(n)
    obv_slope = np.polyfit(x, obv, 1)[0]
    price_slope = np.polyfit(x, c, 1)[0]

    obv_rising = obv_slope > 0
    price_flat = abs(price_slope / c[0]) < 0.001

    obv_score = 0
    if obv_rising and price_flat:
        obv_score = 3
    elif obv_rising and price_slope > 0:
        obv_score = 2
    elif obv_rising:
        obv_score = 1

    results["obv"] = {
        "score": obv_score,
        "signal": "OBV rising + price flat → absorption" if obv_score == 3 else
                  "OBV rising + price up → trend buying" if obv_score == 2 else "Weak/None",
    }

    # ─── 2. Close Position (收盤位置) ───
    # (C-L)/(H-L) > 0.6 = buyers controlling close
    bar_range = h - l
    close_pos = np.where(bar_range > 0, (c - l) / bar_range, 0.5)
    avg_close_pos = np.mean(close_pos[-20:])

    # Count days with lower wick > body (buying on dips)
    lower_wick = np.minimum(c, o) - l
    body = np.abs(c - o)
    wick_days = np.sum(lower_wick[-20:] > body[-20:] * 1.2)

    close_score = 0
    if avg_close_pos >= 0.65 and wick_days >= 8:
        close_score = 3  # Closing high + frequent lower wicks
    elif avg_close_pos >= 0.6 or wick_days >= 6:
        close_score = 2
    elif avg_close_pos >= 0.55:
        close_score = 1

    results["close_position"] = {
        "score": close_score,
        "avg_close_pos": round(float(avg_close_pos), 2),
        "wick_days_20": int(wick_days),
        "signal": f"Avg close at {avg_close_pos:.0%} of bar | {wick_days} lower-wick days",
    }

    # ─── 3. Volume Asymmetry ───
    rally_vol = [v_clean[i] for i in range(1, n) if c[i] > c[i-1]]
    pullback_vol = [v_clean[i] for i in range(1, n) if c[i] < c[i-1]]

    avg_rally = np.mean(rally_vol) if rally_vol else 0
    avg_pullback = np.mean(pullback_vol) if pullback_vol else 1
    vol_asymmetry = avg_rally / max(avg_pullback, 1)

    vol_score = 0
    if vol_asymmetry >= 1.4:
        vol_score = 3
    elif vol_asymmetry >= 1.2:
        vol_score = 2
    elif vol_asymmetry >= 1.1:
        vol_score = 1

    results["volume_asymmetry"] = {
        "score": vol_score,
        "ratio": round(float(vol_asymmetry), 2),
        "signal": f"Rally volume {vol_asymmetry:.2f}x pullback volume",
    }

    # ─── 4. Price Tightening ───
    first_half_range = np.mean(h[:n//2] - l[:n//2])
    second_half_range = np.mean(h[n//2:] - l[n//2:])
    first_half_vol = np.mean(v_clean[:n//2])
    second_half_vol = np.mean(v_clean[n//2:])

    range_compression = second_half_range / max(first_half_range, 0.01)
    vol_maintained = second_half_vol / max(first_half_vol, 1)

    tight_score = 0
    if range_compression < 0.7 and vol_maintained >= 0.9:
        tight_score = 3
    elif range_compression < 0.8 and vol_maintained >= 0.8:
        tight_score = 2
    elif range_compression < 0.9:
        tight_score = 1

    results["tightening"] = {
        "score": tight_score,
        "range_compression": round(float(range_compression), 2),
        "vol_maintained": round(float(vol_maintained), 2),
        "signal": "Range compressing + volume steady → coiling" if tight_score >= 2 else "Normal",
    }

    # ─── 5. Delta (using close position, not candle color) ───
    # close_pos > 0.5 = buying pressure that day
    buying_days = np.sum(close_pos[-20:] > 0.55)
    selling_days = np.sum(close_pos[-20:] < 0.45)
    ratio = buying_days / max(selling_days, 1)

    delta_score = 0
    if ratio >= 2.0:
        delta_score = 3
    elif ratio >= 1.5:
        delta_score = 2
    elif ratio >= 1.2:
        delta_score = 1

    results["delta"] = {
        "score": delta_score,
        "buying_days": int(buying_days),
        "selling_days": int(selling_days),
        "ratio": round(float(ratio), 2),
        "signal": f"Buying/Selling ratio {ratio:.1f}:1 (last 20 days)",
    }

    # ─── 6. Price Position Guard ───
    # If price is in top 25% of 6-month range → possible distribution, discount
    full_df_high = df["High"].max()
    full_df_low = df["Low"].min()
    full_range = full_df_high - full_df_low
    current_pos = (c[-1] - full_df_low) / max(full_range, 0.01)

    position_discount = 1.0
    if current_pos > 0.85:
        position_discount = 0.4  # Near ATH — likely distribution
    elif current_pos > 0.75:
        position_discount = 0.6
    elif current_pos < 0.4:
        position_discount = 1.2  # Low position — accumulation more likely (bonus)

    results["price_position"] = {
        "position_pct": round(float(current_pos * 100), 1),
        "discount": position_discount,
        "signal": (f"Price at {current_pos:.0%} of 6mo range" +
                  (" ⚠️ near highs — possible distribution" if position_discount < 1.0 else
                   " ✅ low position — accumulation likely" if position_discount > 1.0 else "")),
    }

    # ─── Composite Score ───
    raw_total = obv_score + close_score + vol_score + tight_score + delta_score  # max 15
    adjusted_total = round(raw_total * position_discount)
    adjusted_total = max(0, min(15, adjusted_total))

    level = "🟢 STRONG" if adjusted_total >= 9 else "🟡 MODERATE" if adjusted_total >= 6 else "⚪ WEAK"

    results["composite"] = {
        "raw_score": raw_total,
        "adjusted_score": adjusted_total,
        "max": 15,
        "level": level,
        "conclusion": (
            "Clear institutional accumulation — steady buying detected" if adjusted_total >= 9 else
            "Some accumulation signs — monitor for breakout" if adjusted_total >= 6 else
            "No clear accumulation pattern"
        ),
    }

    return results


def main():
    parser = argparse.ArgumentParser(description="Accumulation Detection")
    parser.add_argument("symbols", type=str, help="Comma-separated symbols")
    parser.add_argument("--days", type=int, default=40, help="Lookback days (default: 40)")
    args = parser.parse_args()

    symbols = [s.strip() for s in args.symbols.split(",")]

    print(f"{'═'*60}")
    print(f"  ACCUMULATION ANALYSIS (lookback: {args.days} days)")
    print(f"{'═'*60}\n")

    for symbol in symbols:
        df = yf.download(symbol, period="6mo", progress=False)
        if df.empty:
            print(f"  {symbol}: no data\n")
            continue
        if isinstance(df.columns, pd.MultiIndex):
            df.columns = df.columns.get_level_values(0)

        result = detect_accumulation(df, args.days)
        if not result:
            print(f"  {symbol}: insufficient data\n")
            continue

        comp = result["composite"]
        pos = result["price_position"]
        print(f"  {comp['level']} {symbol} — Score: {comp['adjusted_score']}/{comp['max']} (raw: {comp['raw_score']})")
        print(f"  {comp['conclusion']}")
        print(f"  {'─'*50}")
        print(f"  OBV:        {result['obv']['signal']} ({result['obv']['score']}/3)")
        print(f"  Close Pos:  {result['close_position']['signal']} ({result['close_position']['score']}/3)")
        print(f"  Vol Asym:   {result['volume_asymmetry']['signal']} ({result['volume_asymmetry']['score']}/3)")
        print(f"  Tightening: {result['tightening']['signal']} ({result['tightening']['score']}/3)")
        print(f"  Delta:      {result['delta']['signal']} ({result['delta']['score']}/3)")
        print(f"  Position:   {pos['signal']} (discount: {pos['discount']}x)")
        print()


if __name__ == "__main__":
    main()
