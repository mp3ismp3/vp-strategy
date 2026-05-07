"""
1H intraday parameter optimization.
Grid search over signal detection parameters using 60-day 1H data.

Usage:
    python optimize_1h.py [--symbols NVDA,AAPL,MSFT]
"""

import argparse
import itertools

import yfinance as yf
import pandas as pd
import numpy as np

from config import SYMBOLS, DEFAULT_CFG
from core.indicators import calc_vp, calc_atr
from core.data import download_symbol

MAX_HOLD_BARS = 6
SLIPPAGE_PCT = 0.05

PARAM_GRID = {
    "vol_ratio": [1.0, 1.2, 1.5],
    "wick_ratio": [0.6, 0.8, 1.0],
    "va_proximity": [0.003, 0.005, 0.008],
    "retest_atr": [0.3, 0.5, 0.8],
}


def download_1h(symbol):
    df = yf.download(symbol, period="60d", interval="1h", progress=False)
    if df.empty:
        return None
    if isinstance(df.columns, pd.MultiIndex):
        df.columns = df.columns.get_level_values(0)
    return df


def simulate_1h(df_1h, vah, val, atr, params):
    """Run 1H signals with given params, return list of pnl_r."""
    results = []
    vol_ratio = params["vol_ratio"]
    wick_ratio = params["wick_ratio"]
    prox = params["va_proximity"]
    retest_atr = params["retest_atr"]

    if len(df_1h) < 22:
        return results

    for i in range(21, len(df_1h) - MAX_HOLD_BARS):
        candle = df_1h.iloc[i]
        prev = df_1h.iloc[i - 1]
        vol_avg = df_1h["Volume"].iloc[i - 20:i].mean()

        o, h, l, c, v = candle["Open"], candle["High"], candle["Low"], candle["Close"], candle["Volume"]
        body = abs(c - o)
        if body == 0 or vol_avg == 0:
            continue

        sig = None

        # VA Rejection LONG
        wick_dn = min(c, o) - l
        if l <= val * (1 + prox) and c > o and c > val and wick_dn >= body * wick_ratio and v > vol_avg * vol_ratio:
            sig = ("LONG", c, vah, val - atr * 0.5)

        # VA Rejection SHORT
        if sig is None:
            wick_up = h - max(c, o)
            if h >= vah * (1 - prox) and c < o and c < vah and wick_up >= body * wick_ratio and v > vol_avg * vol_ratio:
                sig = ("SHORT", c, val, vah + atr * 0.5)

        # Failed Auction LONG
        if sig is None:
            if prev["Close"] < val and c > val and c > o and v > vol_avg * vol_ratio:
                sig = ("LONG", c, vah, l - atr * 0.3)

        # Failed Auction SHORT
        if sig is None:
            if prev["Close"] > vah and c < vah and c < o and v > vol_avg * vol_ratio:
                sig = ("SHORT", c, val, h + atr * 0.3)

        # Breakout Retest LONG
        if sig is None:
            if abs(l - vah) < atr * retest_atr and c > vah and c > o and v > vol_avg * vol_ratio:
                sig = ("LONG", c, vah + (vah - val), vah - atr * 0.5)

        # Breakout Retest SHORT
        if sig is None:
            if abs(h - val) < atr * retest_atr and c < val and c < o and v > vol_avg * vol_ratio:
                sig = ("SHORT", c, val - (vah - val), val + atr * 0.5)

        if sig is None:
            continue

        direction, entry, tp, sl = sig
        risk = abs(entry - sl)
        if risk == 0:
            continue

        entry += entry * SLIPPAGE_PCT / 100 * (1 if direction == "LONG" else -1)

        for j in range(i + 1, min(i + 1 + MAX_HOLD_BARS, len(df_1h))):
            fh, fl = df_1h.iloc[j]["High"], df_1h.iloc[j]["Low"]
            if direction == "LONG":
                if fl <= sl:
                    results.append(-1.0)
                    break
                if fh >= tp:
                    results.append((tp - entry) / risk)
                    break
            else:
                if fh >= sl:
                    results.append(-1.0)
                    break
                if fl <= tp:
                    results.append((entry - tp) / risk)
                    break
        else:
            exit_c = float(df_1h.iloc[min(i + MAX_HOLD_BARS, len(df_1h) - 1)]["Close"])
            r = (exit_c - entry) / risk if direction == "LONG" else (entry - exit_c) / risk
            results.append(r)

    return results


def main():
    parser = argparse.ArgumentParser(description="1H Parameter Optimization")
    parser.add_argument("--symbols", type=str, default="", help="Comma-separated (default: top 10)")
    args = parser.parse_args()

    default_symbols = ["NVDA", "AAPL", "MSFT", "AMZN", "GOOGL", "META", "TSLA", "AMD", "SPY", "QQQ"]
    symbols = args.symbols.split(",") if args.symbols else default_symbols
    symbols = [s.strip() for s in symbols if s.strip()]

    combos = list(itertools.product(*PARAM_GRID.values()))
    print(f"1H Parameter Optimization")
    print(f"  Symbols: {symbols}")
    print(f"  Combinations: {len(combos)}")
    print(f"{'─'*70}\n")

    # Download data
    print("Downloading data...")
    data = {}
    for symbol in symbols:
        df_daily = download_symbol(symbol)
        df_1h = download_1h(symbol)
        if df_daily is None or df_1h is None or len(df_daily) < 65 or len(df_1h) < 22:
            print(f"  {symbol}: skip")
            continue
        vp = calc_vp(df_daily, 60, DEFAULT_CFG["va_pct"])
        atr = calc_atr(df_daily, DEFAULT_CFG["atr_len"])
        if not vp or not atr:
            continue
        data[symbol] = {"1h": df_1h, "vah": vp["vah"], "val": vp["val"], "atr": atr}
        print(f"  {symbol}: {len(df_1h)} 1H bars")

    # Grid search
    print(f"\nRunning grid search...\n")
    results_table = []

    for combo in combos:
        params = {
            "vol_ratio": combo[0],
            "wick_ratio": combo[1],
            "va_proximity": combo[2],
            "retest_atr": combo[3],
        }

        all_pnls = []
        for symbol, d in data.items():
            pnls = simulate_1h(d["1h"], d["vah"], d["val"], d["atr"], params)
            all_pnls.extend(pnls)

        if not all_pnls:
            results_table.append({"params": combo, "trades": 0, "win_rate": 0, "expectancy": 0, "pf": 0})
            continue

        wins = [p for p in all_pnls if p > 0]
        losses = [p for p in all_pnls if p <= 0]
        results_table.append({
            "params": combo,
            "trades": len(all_pnls),
            "win_rate": len(wins) / len(all_pnls) * 100,
            "expectancy": np.mean(all_pnls),
            "pf": sum(wins) / abs(sum(losses)) if losses else 999,
        })

    # Sort by expectancy
    results_table.sort(key=lambda x: x["expectancy"], reverse=True)

    # Print top 10
    print(f"{'='*70}")
    print(f"  TOP 10 PARAMETER SETS (sorted by expectancy)")
    print(f"{'='*70}")
    print(f"  {'Vol':>4} {'Wick':>5} {'Prox':>6} {'Retest':>6} | {'Trades':>6} {'WR':>6} {'Exp':>7} {'PF':>6}")
    print(f"  {'─'*4} {'─'*5} {'─'*6} {'─'*6} | {'─'*6} {'─'*6} {'─'*7} {'─'*6}")

    for row in results_table[:10]:
        p = row["params"]
        print(f"  {p[0]:>4.1f} {p[1]:>5.1f} {p[2]*100:>5.1f}% {p[3]:>6.1f} | {row['trades']:>6} {row['win_rate']:>5.1f}% {row['expectancy']:>+6.2f}R {row['pf']:>5.2f}")

    # Best
    best = results_table[0]
    bp = best["params"]
    print(f"\n{'='*70}")
    print(f"  BEST 1H PARAMETERS")
    print(f"{'='*70}")
    print(f"  MIN_VOL_RATIO  = {bp[0]}")
    print(f"  wick_ratio     = {bp[1]}")
    print(f"  va_proximity   = {bp[2]} ({bp[2]*100:.1f}%)")
    print(f"  retest_atr     = {bp[3]}")
    print(f"\n  Trades: {best['trades']} | WR: {best['win_rate']:.1f}% | Exp: {best['expectancy']:+.2f}R | PF: {best['pf']:.2f}")
    print(f"{'='*70}")


if __name__ == "__main__":
    main()
