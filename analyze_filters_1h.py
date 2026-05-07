"""
1H filter analysis — quantify the impact of each filter on intraday signals.

Usage:
    python analyze_filters_1h.py [--symbols NVDA,AAPL]
"""

import argparse
import yfinance as yf
import pandas as pd
import numpy as np

from config import SYMBOLS, DEFAULT_CFG, SECTOR_MAP
from core.indicators import calc_vp, calc_atr
from core.data import download_symbol
from core.market_context import fetch_market_context
from scoring.confidence import score_signal, calc_stock_factors
from strategies.inst_trend import calc_institutional_trend

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


def collect_trades(symbols, cfg):
    market_ctx = fetch_market_context(cfg)
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

            # Get trend and score factors once per symbol/lb
            factors = calc_stock_factors(df_daily, symbol, dict(cfg, vp_lookback=lb), market_ctx)
            trend = factors.get("inst_trend", "NEUTRAL")
            vol_ratio_daily = factors.get("vol_ratio", 0)
            sector_etf = SECTOR_MAP.get(symbol, "QQQ")

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
                hourly_vol_ratio = v / vol_avg

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

                # Score
                score, _ = score_signal(sig, f"VP: {signal_name}", factors, market_ctx, sector_etf, False)

                # TP/SL
                if signal_name == "Breakout Retest":
                    tp = c + (vah - val) if sig == "LONG" else c - (vah - val)
                else:
                    tp = vah if sig == "LONG" else val
                sl = c - atr * 0.5 if sig == "LONG" else c + atr * 0.5
                risk = abs(c - sl)
                if risk == 0:
                    continue

                # Simulate
                pnl_r = 0.0
                for j in range(i + 1, min(i + 1 + MAX_HOLD, len(df_1h))):
                    fh, fl = df_1h.iloc[j]["High"], df_1h.iloc[j]["Low"]
                    if sig == "LONG":
                        if fl <= sl:
                            pnl_r = -1.0; break
                        if fh >= tp:
                            pnl_r = (tp - c) / risk; break
                    else:
                        if fh >= sl:
                            pnl_r = -1.0; break
                        if fl <= tp:
                            pnl_r = (c - tp) / risk; break
                else:
                    exit_c = float(df_1h.iloc[min(i + MAX_HOLD, len(df_1h) - 1)]["Close"])
                    pnl_r = (exit_c - c) / risk if sig == "LONG" else (c - exit_c) / risk

                trades.append({
                    "symbol": symbol,
                    "direction": sig,
                    "signal": signal_name,
                    "score": score,
                    "trend": trend,
                    "hourly_vol": hourly_vol_ratio,
                    "pnl_r": pnl_r,
                })

        print(f"  {symbol}: {sum(1 for t in trades if t['symbol'] == symbol)} signals")

    return trades


def evaluate(trades, label):
    if not trades:
        return {"label": label, "n": 0, "wr": 0, "exp": 0, "pf": 0}
    pnls = [t["pnl_r"] for t in trades]
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
    parser = argparse.ArgumentParser(description="1H Filter Analysis")
    parser.add_argument("--symbols", type=str, default="")
    args = parser.parse_args()

    default_symbols = ["NVDA", "AAPL", "MSFT", "AMZN", "GOOGL", "META", "TSLA", "AMD", "SPY", "QQQ"]
    symbols = args.symbols.split(",") if args.symbols else default_symbols
    symbols = [s.strip() for s in symbols if s.strip()]

    print(f"1H Filter Analysis — {len(symbols)} symbols, 60 days")
    print(f"{'─'*70}\n")

    trades = collect_trades(symbols, DEFAULT_CFG)
    print(f"\nTotal 1H signals: {len(trades)}\n")

    if not trades:
        print("❌ No trades.")
        return

    results = []

    # Baseline
    results.append(evaluate(trades, "A: 無篩選"))

    # Score
    results.append(evaluate([t for t in trades if t["score"] >= 2], "B1: Score ≥ 2"))
    results.append(evaluate([t for t in trades if t["score"] >= 3], "B2: Score ≥ 3"))
    results.append(evaluate([t for t in trades if t["score"] >= 4], "B3: Score ≥ 4"))

    # Trend
    trend_ok = [t for t in trades if not (
        (t["direction"] == "LONG" and t["trend"] == "BEARISH") or
        (t["direction"] == "SHORT" and t["trend"] == "BULLISH")
    )]
    results.append(evaluate(trend_ok, "C: 順趨勢"))

    # Direction
    results.append(evaluate([t for t in trades if t["direction"] == "LONG"], "D1: 只做多"))
    results.append(evaluate([t for t in trades if t["direction"] == "SHORT"], "D2: 只做空"))

    # Signal type
    results.append(evaluate([t for t in trades if t["signal"] == "VA Rejection"], "E1: VA Rejection"))
    results.append(evaluate([t for t in trades if t["signal"] == "Failed Auction"], "E2: Failed Auction"))
    results.append(evaluate([t for t in trades if t["signal"] == "Breakout Retest"], "E3: Breakout Retest"))

    # Hourly volume tiers
    results.append(evaluate([t for t in trades if t["hourly_vol"] > 1.5], "F1: 1H量 > 1.5x"))
    results.append(evaluate([t for t in trades if t["hourly_vol"] > 2.0], "F2: 1H量 > 2.0x"))
    results.append(evaluate([t for t in trades if 1.2 <= t["hourly_vol"] <= 1.5], "F3: 1H量 1.2-1.5x"))
    results.append(evaluate([t for t in trades if 1.5 < t["hourly_vol"] <= 2.5], "F4: 1H量 1.5-2.5x"))

    # Combinations
    results.append(evaluate([t for t in trades if t["direction"] == "LONG" and t["signal"] == "Breakout Retest"], "G1: Breakout + 只做多"))
    results.append(evaluate([t for t in trades if t["direction"] == "LONG" and t["score"] >= 3], "G2: Score≥3 + 只做多"))
    results.append(evaluate([t for t in trades if t["direction"] == "LONG" and t["score"] >= 4], "G3: Score≥4 + 只做多"))
    results.append(evaluate([t for t in trend_ok if t["score"] >= 3], "G4: Score≥3 + 順趨勢"))
    results.append(evaluate([t for t in trend_ok if t["direction"] == "LONG" and t["score"] >= 3], "G5: Score≥3 + 順趨勢 + 只做多"))
    results.append(evaluate([t for t in trades if t["direction"] == "LONG" and t["signal"] == "Breakout Retest" and t["score"] >= 3], "G6: Breakout + 只做多 + Score≥3"))

    # Print
    results.sort(key=lambda x: x["exp"], reverse=True)

    print(f"{'='*70}")
    print(f"  1H FILTER ANALYSIS REPORT (sorted by expectancy)")
    print(f"{'='*70}")
    print(f"  {'Filter':<35} | {'N':>5} {'WR':>6} {'Exp':>7} {'PF':>6}")
    print(f"  {'─'*35} | {'─'*5} {'─'*6} {'─'*7} {'─'*6}")

    baseline_exp = next(r["exp"] for r in results if "無篩選" in r["label"])
    for r in results:
        delta = f" ({r['exp']-baseline_exp:+.2f})" if "無篩選" not in r["label"] and r["n"] > 0 else ""
        print(f"  {r['label']:<35} | {r['n']:>5} {r['wr']:>5.1f}% {r['exp']:>+6.2f}R {r['pf']:>5.2f}{delta}")

    valid = [r for r in results if r["n"] >= 20]
    if valid:
        best = max(valid, key=lambda x: x["exp"])
        print(f"\n{'─'*70}")
        print(f"  ✅ BEST (min 20 trades): {best['label']}")
        print(f"     {best['n']} trades | WR {best['wr']:.1f}% | Exp {best['exp']:+.2f}R | PF {best['pf']:.2f}")
    print(f"{'='*70}")


if __name__ == "__main__":
    main()
