"""Accumulation Detection — identifies steady institutional buying.

Signals that someone is consistently buying:
1. OBV Trend: On-Balance Volume rising while price flat/slightly up
2. Positive Delta Streak: More up-volume days than down-volume days
3. Volume Dry-up on Pullbacks: Pullbacks have low volume, rallies have high volume
4. Price Tightening + Volume: Range compresses but volume stays or increases

Usage:
    python accumulation.py NVDA
    python accumulation.py NVDA,AVGO,AMD --days 60
"""

import argparse
import yfinance as yf
import pandas as pd
import numpy as np


def detect_accumulation(df, lookback=40):
    """Analyze volume behavior for signs of institutional accumulation.

    Returns dict with scores and evidence.
    """
    if len(df) < lookback + 10:
        return None

    d = df.tail(lookback).copy()
    c = d["Close"].values
    o = d["Open"].values
    h = d["High"].values
    l = d["Low"].values
    v = d["Volume"].values.astype(float)

    n = len(d)
    results = {}

    # ─── 1. OBV Trend (On-Balance Volume) ───
    # OBV rising while price flat = someone accumulating
    obv = np.zeros(n)
    for i in range(1, n):
        if c[i] > c[i-1]:
            obv[i] = obv[i-1] + v[i]
        elif c[i] < c[i-1]:
            obv[i] = obv[i-1] - v[i]
        else:
            obv[i] = obv[i-1]

    # OBV slope (linear regression)
    x = np.arange(n)
    obv_slope = np.polyfit(x, obv, 1)[0]
    price_slope = np.polyfit(x, c, 1)[0]

    # OBV rising + price flat/slightly up = accumulation
    obv_rising = obv_slope > 0
    price_flat = abs(price_slope / c[0]) < 0.001  # < 0.1% per day
    price_up = price_slope > 0

    obv_score = 0
    if obv_rising and price_flat:
        obv_score = 3  # Strong: volume buying but price not moving (absorption)
    elif obv_rising and price_up:
        obv_score = 2  # Moderate: buying with gentle uptrend
    elif obv_rising:
        obv_score = 1

    results["obv"] = {
        "score": obv_score,
        "obv_slope": round(float(obv_slope), 0),
        "price_change": round(float((c[-1] / c[0] - 1) * 100), 2),
        "signal": "OBV rising + price flat → absorption" if obv_score == 3 else
                  "OBV rising + price up → trend buying" if obv_score == 2 else "Weak/None",
    }

    # ─── 2. Positive Delta Streak ───
    # Count days where close > open (buying pressure) with above-avg volume
    vol_ma = np.mean(v)
    up_days = [(c[i] > o[i]) and v[i] > vol_ma * 0.8 for i in range(n)]
    down_days = [(c[i] < o[i]) and v[i] > vol_ma * 0.8 for i in range(n)]

    up_count = sum(up_days[-20:])
    down_count = sum(down_days[-20:])
    ratio = up_count / max(down_count, 1)

    delta_score = 0
    if ratio >= 2.0:
        delta_score = 3  # 2:1 up vs down = strong buying
    elif ratio >= 1.5:
        delta_score = 2
    elif ratio >= 1.2:
        delta_score = 1

    results["delta"] = {
        "score": delta_score,
        "up_days_20": up_count,
        "down_days_20": down_count,
        "ratio": round(ratio, 2),
        "signal": f"Up/Down ratio {ratio:.1f}:1 (last 20 days)",
    }

    # ─── 3. Volume on Pullbacks vs Rallies ───
    # Accumulation: rallies have high volume, pullbacks have low volume
    rally_vol = []
    pullback_vol = []
    for i in range(1, n):
        if c[i] > c[i-1]:
            rally_vol.append(v[i])
        else:
            pullback_vol.append(v[i])

    avg_rally_vol = np.mean(rally_vol) if rally_vol else 0
    avg_pullback_vol = np.mean(pullback_vol) if pullback_vol else 1

    vol_asymmetry = avg_rally_vol / max(avg_pullback_vol, 1)

    vol_score = 0
    if vol_asymmetry >= 1.4:
        vol_score = 3  # Rallies have 40%+ more volume than pullbacks
    elif vol_asymmetry >= 1.2:
        vol_score = 2
    elif vol_asymmetry >= 1.1:
        vol_score = 1

    results["volume_asymmetry"] = {
        "score": vol_score,
        "rally_avg_vol": int(avg_rally_vol),
        "pullback_avg_vol": int(avg_pullback_vol),
        "ratio": round(vol_asymmetry, 2),
        "signal": f"Rally volume {vol_asymmetry:.2f}x pullback volume",
    }

    # ─── 4. Price Tightening (Compression + Volume) ───
    # Range getting smaller but volume not dropping = accumulation before breakout
    first_half_range = np.mean(h[:n//2] - l[:n//2])
    second_half_range = np.mean(h[n//2:] - l[n//2:])
    first_half_vol = np.mean(v[:n//2])
    second_half_vol = np.mean(v[n//2:])

    range_compression = second_half_range / max(first_half_range, 0.01)
    vol_maintained = second_half_vol / max(first_half_vol, 1)

    tight_score = 0
    if range_compression < 0.7 and vol_maintained >= 0.9:
        tight_score = 3  # Range shrinking but volume steady = coiling
    elif range_compression < 0.8 and vol_maintained >= 0.8:
        tight_score = 2
    elif range_compression < 0.9:
        tight_score = 1

    results["tightening"] = {
        "score": tight_score,
        "range_compression": round(range_compression, 2),
        "vol_maintained": round(vol_maintained, 2),
        "signal": "Range compressing + volume steady → coiling for breakout" if tight_score >= 2 else "Normal",
    }

    # ─── Composite Score ───
    total = obv_score + delta_score + vol_score + tight_score  # max 12
    level = "🟢 STRONG" if total >= 8 else "🟡 MODERATE" if total >= 5 else "⚪ WEAK"

    results["composite"] = {
        "score": total,
        "max": 12,
        "level": level,
        "conclusion": (
            "Clear institutional accumulation — steady buying detected" if total >= 8 else
            "Some accumulation signs — monitor for breakout" if total >= 5 else
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
        print(f"  {comp['level']} {symbol} — Accumulation Score: {comp['score']}/{comp['max']}")
        print(f"  {comp['conclusion']}")
        print(f"  {'─'*50}")
        print(f"  OBV:        {result['obv']['signal']} (score: {result['obv']['score']}/3)")
        print(f"  Delta:      {result['delta']['signal']} (score: {result['delta']['score']}/3)")
        print(f"  Vol Asym:   {result['volume_asymmetry']['signal']} (score: {result['volume_asymmetry']['score']}/3)")
        print(f"  Tightening: {result['tightening']['signal']} (score: {result['tightening']['score']}/3)")
        print(f"              Range compression: {result['tightening']['range_compression']:.0%} | Vol maintained: {result['tightening']['vol_maintained']:.0%}")
        print()


if __name__ == "__main__":
    main()
