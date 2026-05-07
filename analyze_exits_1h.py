"""
1H TP/SL exit analysis — test different exit strategies on intraday signals.

Usage:
    python analyze_exits_1h.py [--symbols NVDA,AAPL]
"""

import argparse
import yfinance as yf
import pandas as pd
import numpy as np

from config import SYMBOLS, DEFAULT_CFG
from core.indicators import calc_vp, calc_atr
from core.data import download_symbol

MIN_VOL_RATIO = 1.2
VOL_AVG_PERIOD = 20
MAX_HOLD = 6


def download_1h(symbol):
    df = yf.download(symbol, period="60d", interval="1h", progress=False)
    if df.empty:
        return None
    if isinstance(df.columns, pd.MultiIndex):
        df.columns = df.columns.get_level_values(0)
    return df


def collect_1h_trades(symbols, cfg):
    """Collect all 1H signals with forward bars for exit simulation."""
    trades = []

    for symbol in symbols:
        df_daily = download_symbol(symbol)
        if df_daily is None or len(df_daily) < cfg["vp_lookback"] + 5:
            continue

        df_1h = download_1h(symbol)
        if df_1h is None or len(df_1h) < VOL_AVG_PERIOD + 10:
            continue

        for lb in [60, 120]:
            if len(df_daily) < lb + 5:
                continue
            vp = calc_vp(df_daily, lb, cfg["va_pct"])
            atr = calc_atr(df_daily, cfg["atr_len"])
            if not vp or not atr:
                continue

            vah, val = vp["vah"], vp["val"]

            for i in range(VOL_AVG_PERIOD + 1, len(df_1h) - MAX_HOLD - 1):
                candle = df_1h.iloc[i]
                prev = df_1h.iloc[i - 1]
                vol_avg = df_1h["Volume"].iloc[i - VOL_AVG_PERIOD:i].mean()

                o, h, l, c, v = candle["Open"], candle["High"], candle["Low"], candle["Close"], candle["Volume"]
                body = abs(c - o)
                if body == 0 or vol_avg == 0:
                    continue

                sig = None
                signal_name = ""
                wick_dn = min(c, o) - l
                wick_up = h - max(c, o)

                if l <= val * 1.005 and c > o and c > val and wick_dn >= body * 0.8 and v > vol_avg * MIN_VOL_RATIO:
                    sig = "LONG"
                    signal_name = "VA Rejection"
                elif h >= vah * 0.995 and c < o and c < vah and wick_up >= body * 0.8 and v > vol_avg * MIN_VOL_RATIO:
                    sig = "SHORT"
                    signal_name = "VA Rejection"
                elif prev["Close"] < val and c > val and c > o and v > vol_avg * MIN_VOL_RATIO:
                    sig = "LONG"
                    signal_name = "Failed Auction"
                elif prev["Close"] > vah and c < vah and c < o and v > vol_avg * MIN_VOL_RATIO:
                    sig = "SHORT"
                    signal_name = "Failed Auction"
                elif abs(l - vah) < atr * 0.5 and c > vah and c > o and v > vol_avg * MIN_VOL_RATIO:
                    sig = "LONG"
                    signal_name = "Breakout Retest"
                elif abs(h - val) < atr * 0.5 and c < val and c < o and v > vol_avg * MIN_VOL_RATIO:
                    sig = "SHORT"
                    signal_name = "Breakout Retest"

                if sig is None:
                    continue

                # Collect forward bars
                forward = []
                for j in range(i + 1, min(i + 1 + MAX_HOLD + 5, len(df_1h))):
                    forward.append({
                        "h": float(df_1h.iloc[j]["High"]),
                        "l": float(df_1h.iloc[j]["Low"]),
                        "c": float(df_1h.iloc[j]["Close"]),
                    })

                if not forward:
                    continue

                trades.append({
                    "symbol": symbol,
                    "direction": sig,
                    "signal": signal_name,
                    "entry": float(c),
                    "atr": atr,
                    "vah": vah,
                    "val": val,
                    "poc": vp["poc"],
                    "forward": forward,
                })

        print(f"  {symbol}: {sum(1 for t in trades if t['symbol'] == symbol)} signals")

    return trades


def simulate(trades, tp_atr, sl_atr, max_hold):
    pnls = []
    for t in trades:
        entry, atr, d = t["entry"], t["atr"], t["direction"]
        tp = entry + atr * tp_atr if d == "LONG" else entry - atr * tp_atr
        sl = entry - atr * sl_atr if d == "LONG" else entry + atr * sl_atr
        risk = atr * sl_atr

        for bar in t["forward"][:max_hold]:
            if d == "LONG":
                if bar["l"] <= sl:
                    pnls.append(-1.0); break
                if bar["h"] >= tp:
                    pnls.append(tp_atr / sl_atr); break
            else:
                if bar["h"] >= sl:
                    pnls.append(-1.0); break
                if bar["l"] <= tp:
                    pnls.append(tp_atr / sl_atr); break
        else:
            last_c = t["forward"][min(max_hold - 1, len(t["forward"]) - 1)]["c"]
            r = (last_c - entry) / risk if d == "LONG" else (entry - last_c) / risk
            pnls.append(r)
    return pnls


def simulate_to_poc(trades, sl_atr, max_hold):
    """TP = POC (middle of VA)."""
    pnls = []
    for t in trades:
        entry, atr, d = t["entry"], t["atr"], t["direction"]
        tp = t["poc"]
        sl = entry - atr * sl_atr if d == "LONG" else entry + atr * sl_atr
        risk = atr * sl_atr
        if risk == 0:
            continue

        for bar in t["forward"][:max_hold]:
            if d == "LONG":
                if bar["l"] <= sl:
                    pnls.append(-1.0); break
                if bar["h"] >= tp:
                    pnls.append((tp - entry) / risk); break
            else:
                if bar["h"] >= sl:
                    pnls.append(-1.0); break
                if bar["l"] <= tp:
                    pnls.append((entry - tp) / risk); break
        else:
            last_c = t["forward"][min(max_hold - 1, len(t["forward"]) - 1)]["c"]
            r = (last_c - entry) / risk if d == "LONG" else (entry - last_c) / risk
            pnls.append(r)
    return pnls


def evaluate(pnls, label):
    if not pnls:
        return {"label": label, "n": 0, "wr": 0, "exp": 0, "pf": 0}
    wins = [p for p in pnls if p > 0]
    losses = [p for p in pnls if p <= 0]
    return {
        "label": label,
        "n": len(pnls),
        "wr": len(wins) / len(pnls) * 100,
        "exp": np.mean(pnls),
        "pf": sum(wins) / abs(sum(losses)) if losses else 999,
    }


def main():
    parser = argparse.ArgumentParser(description="1H Exit Analysis")
    parser.add_argument("--symbols", type=str, default="")
    args = parser.parse_args()

    default_symbols = ["NVDA", "AAPL", "MSFT", "AMZN", "GOOGL", "META", "TSLA", "AMD", "SPY", "QQQ"]
    symbols = args.symbols.split(",") if args.symbols else default_symbols
    symbols = [s.strip() for s in symbols if s.strip()]

    print(f"1H Exit Analysis — {len(symbols)} symbols")
    print(f"{'─'*70}\n")

    trades = collect_1h_trades(symbols, DEFAULT_CFG)
    print(f"\nTotal 1H signals: {len(trades)}\n")

    if not trades:
        print("❌ No trades.")
        return

    # Group by signal type (LONG only)
    long_trades = [t for t in trades if t["direction"] == "LONG"]
    breakout_long = [t for t in long_trades if t["signal"] == "Breakout Retest"]
    failed_long = [t for t in long_trades if t["signal"] == "Failed Auction"]
    rejection_long = [t for t in long_trades if t["signal"] == "VA Rejection"]

    print(f"  LONG: {len(long_trades)} | Breakout: {len(breakout_long)} | Failed: {len(failed_long)} | Rejection: {len(rejection_long)}\n")

    groups = [
        ("ALL LONG", long_trades),
        ("BREAKOUT RETEST LONG", breakout_long),
        ("FAILED AUCTION LONG", failed_long),
        ("VA REJECTION LONG", rejection_long),
    ]

    for label, subset in groups:
        if not subset or len(subset) < 5:
            print(f"\n  {label}: too few trades ({len(subset)}), skip\n")
            continue

        print(f"\n{'='*75}")
        print(f"  {label} ({len(subset)} trades)")
        print(f"{'='*75}")

        results = []

        # Fixed R:R
        for tp_atr in [0.5, 0.8, 1.0, 1.5, 2.0, 2.5, 3.0]:
            for sl_atr in [0.3, 0.5, 0.8, 1.0]:
                pnls = simulate(subset, tp_atr, sl_atr, MAX_HOLD)
                rr = tp_atr / sl_atr
                results.append(evaluate(pnls, f"Fixed TP={tp_atr} SL={sl_atr} (1:{rr:.1f})"))

        # TP = POC
        for sl in [0.3, 0.5, 0.8, 1.0]:
            pnls = simulate_to_poc(subset, sl, MAX_HOLD)
            results.append(evaluate(pnls, f"TP=POC, SL={sl}ATR"))

        # Original TP/SL
        orig_pnls = []
        for t in subset:
            entry, atr, d = t["entry"], t["atr"], t["direction"]
            tp = t["vah"]
            sl = entry - atr * 0.5
            risk = atr * 0.5
            if risk == 0:
                continue
            for bar in t["forward"][:MAX_HOLD]:
                if bar["l"] <= sl:
                    orig_pnls.append(-1.0); break
                if bar["h"] >= tp:
                    orig_pnls.append((tp - entry) / risk); break
            else:
                last_c = t["forward"][min(MAX_HOLD - 1, len(t["forward"]) - 1)]["c"]
                orig_pnls.append((last_c - entry) / risk)
        results.insert(0, evaluate(orig_pnls, "★ CURRENT (TP=VAH, SL=0.5ATR)"))

        results.sort(key=lambda x: x["exp"], reverse=True)

        print(f"  {'Strategy':<42} | {'N':>5} {'WR':>6} {'Exp':>7} {'PF':>6}")
        print(f"  {'─'*42} | {'─'*5} {'─'*6} {'─'*7} {'─'*6}")
        for r in results[:15]:
            marker = "→" if "CURRENT" in r["label"] else " "
            print(f" {marker}{r['label']:<42} | {r['n']:>5} {r['wr']:>5.1f}% {r['exp']:>+6.2f}R {r['pf']:>5.2f}")

        best = results[0]
        current = next((r for r in results if "CURRENT" in r["label"]), results[-1])
        print(f"\n  ★ CURRENT: Exp {current['exp']:+.2f}R | ✅ BEST: {best['label']} Exp {best['exp']:+.2f}R")

    # Hold bars analysis
    print(f"\n{'='*75}")
    print(f"  MAX HOLD BARS (TP=1.5 SL=0.5)")
    print(f"{'='*75}")
    for label, subset in groups:
        if not subset or len(subset) < 5:
            continue
        print(f"\n  {label}:")
        for hold in [3, 4, 5, 6, 8, 10]:
            pnls = simulate(subset, 1.5, 0.5, max_hold=hold)
            r = evaluate(pnls, f"Hold={hold}h")
            print(f"    {r['label']:<10} | {r['n']:>5} {r['wr']:>5.1f}% {r['exp']:>+6.2f}R {r['pf']:>5.2f}")
    print(f"{'='*75}")


if __name__ == "__main__":
    main()
