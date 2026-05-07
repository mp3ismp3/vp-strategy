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
                wick_dn = min(c, o) - l
                wick_up = h - max(c, o)

                if l <= val * 1.005 and c > o and c > val and wick_dn >= body * 0.8 and v > vol_avg * MIN_VOL_RATIO:
                    sig = "LONG"
                elif h >= vah * 0.995 and c < o and c < vah and wick_up >= body * 0.8 and v > vol_avg * MIN_VOL_RATIO:
                    sig = "SHORT"
                elif prev["Close"] < val and c > val and c > o and v > vol_avg * MIN_VOL_RATIO:
                    sig = "LONG"
                elif prev["Close"] > vah and c < vah and c < o and v > vol_avg * MIN_VOL_RATIO:
                    sig = "SHORT"
                elif abs(l - vah) < atr * 0.5 and c > vah and c > o and v > vol_avg * MIN_VOL_RATIO:
                    sig = "LONG"
                elif abs(h - val) < atr * 0.5 and c < val and c < o and v > vol_avg * MIN_VOL_RATIO:
                    sig = "SHORT"

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

    results = []

    # Current: TP=VAH/VAL, SL=0.5 ATR
    orig_pnls = []
    for t in trades:
        entry, atr, d = t["entry"], t["atr"], t["direction"]
        tp = t["vah"] if d == "LONG" else t["val"]
        sl = entry - atr * 0.5 if d == "LONG" else entry + atr * 0.5
        risk = atr * 0.5
        if risk == 0:
            continue
        for bar in t["forward"][:MAX_HOLD]:
            if d == "LONG":
                if bar["l"] <= sl:
                    orig_pnls.append(-1.0); break
                if bar["h"] >= tp:
                    orig_pnls.append((tp - entry) / risk); break
            else:
                if bar["h"] >= sl:
                    orig_pnls.append(-1.0); break
                if bar["l"] <= tp:
                    orig_pnls.append((entry - tp) / risk); break
        else:
            last_c = t["forward"][min(MAX_HOLD - 1, len(t["forward"]) - 1)]["c"]
            r = (last_c - entry) / risk if d == "LONG" else (entry - last_c) / risk
            orig_pnls.append(r)
    results.append(evaluate(orig_pnls, "★ CURRENT (TP=VAH/VAL, SL=0.5ATR)"))

    # TP = POC
    for sl in [0.3, 0.5, 0.8, 1.0]:
        pnls = simulate_to_poc(trades, sl, MAX_HOLD)
        results.append(evaluate(pnls, f"TP=POC, SL={sl}ATR"))

    # Fixed R:R
    for tp_atr in [0.5, 0.8, 1.0, 1.5, 2.0, 2.5, 3.0]:
        for sl_atr in [0.3, 0.5, 0.8, 1.0]:
            pnls = simulate(trades, tp_atr, sl_atr, MAX_HOLD)
            rr = tp_atr / sl_atr
            results.append(evaluate(pnls, f"Fixed TP={tp_atr} SL={sl_atr} (1:{rr:.1f})"))

    # Sort
    results.sort(key=lambda x: x["exp"], reverse=True)

    print(f"{'='*75}")
    print(f"  1H EXIT STRATEGY ANALYSIS (sorted by expectancy)")
    print(f"{'='*75}")
    print(f"  {'Strategy':<42} | {'N':>5} {'WR':>6} {'Exp':>7} {'PF':>6}")
    print(f"  {'─'*42} | {'─'*5} {'─'*6} {'─'*7} {'─'*6}")

    for r in results[:20]:
        marker = "→" if "CURRENT" in r["label"] else " "
        print(f" {marker}{r['label']:<42} | {r['n']:>5} {r['wr']:>5.1f}% {r['exp']:>+6.2f}R {r['pf']:>5.2f}")

    best = results[0]
    current = next(r for r in results if "CURRENT" in r["label"])
    print(f"\n{'─'*75}")
    print(f"  ★ CURRENT:  Exp {current['exp']:+.2f}R | WR {current['wr']:.1f}%")
    print(f"  ✅ BEST:     {best['label']}")
    print(f"              Exp {best['exp']:+.2f}R | WR {best['wr']:.1f}% | PF {best['pf']:.2f}")
    print(f"{'='*75}")


if __name__ == "__main__":
    main()
