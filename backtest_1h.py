"""
Backtest for intraday (1H) strategy.
Uses yfinance 1H data (max ~60 days) to evaluate signal quality.

Usage:
    python backtest_1h.py [--symbols NVDA,AAPL,MSFT]
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
SLIPPAGE_PCT = 0.05
MAX_HOLD_BARS = 6  # Max 6 hours hold for intraday


def download_1h(symbol):
    df = yf.download(symbol, period="60d", interval="1h", progress=False)
    if df.empty:
        return None
    if isinstance(df.columns, pd.MultiIndex):
        df.columns = df.columns.get_level_values(0)
    return df


def run_1h_backtest(symbols, cfg):
    """Walk through 1H candles, detect signals, track outcomes."""
    trades = []

    for symbol in symbols:
        # Daily data for VP structure
        df_daily = download_symbol(symbol)
        if df_daily is None or len(df_daily) < cfg["vp_lookback"] + 5:
            print(f"  {symbol}: no daily data, skip")
            continue

        # 1H data for signal detection
        df_1h = download_1h(symbol)
        if df_1h is None or len(df_1h) < VOL_AVG_PERIOD + 5:
            print(f"  {symbol}: no 1H data, skip")
            continue

        # Get VP levels from daily
        for lb in [60, 120]:
            if len(df_daily) < lb + 5:
                continue

            vp = calc_vp(df_daily, lb, cfg["va_pct"])
            atr = calc_atr(df_daily, cfg["atr_len"])
            if not vp or not atr:
                continue

            vah, val = vp["vah"], vp["val"]
            pdh = float(df_daily["High"].iloc[-1])
            pdl = float(df_daily["Low"].iloc[-1])

            # Walk through 1H candles
            for i in range(VOL_AVG_PERIOD + 1, len(df_1h) - MAX_HOLD_BARS):
                candle = df_1h.iloc[i]
                prev = df_1h.iloc[i - 1]
                vol_avg = df_1h["Volume"].iloc[i - VOL_AVG_PERIOD:i].mean()

                o, h, l, c, v = candle["Open"], candle["High"], candle["Low"], candle["Close"], candle["Volume"]
                body = abs(c - o)

                sig = None

                # VA Rejection LONG
                wick_dn = min(c, o) - l
                if (l <= val * 1.005 and c > o and c > val and body > 0
                        and wick_dn >= body * 0.8 and v > vol_avg * MIN_VOL_RATIO):
                    sig = ("LONG", "VA Rejection", c, vah, val - atr * 0.5)

                # VA Rejection SHORT
                if sig is None:
                    wick_up = h - max(c, o)
                    if (h >= vah * 0.995 and c < o and c < vah and body > 0
                            and wick_up >= body * 0.8 and v > vol_avg * MIN_VOL_RATIO):
                        sig = ("SHORT", "VA Rejection", c, val, vah + atr * 0.5)

                # Failed Auction LONG
                if sig is None:
                    if prev["Close"] < val and c > val and c > o and v > vol_avg * MIN_VOL_RATIO:
                        sig = ("LONG", "Failed Auction", c, vah, l - atr * 0.3)

                # Failed Auction SHORT
                if sig is None:
                    if prev["Close"] > vah and c < vah and c < o and v > vol_avg * MIN_VOL_RATIO:
                        sig = ("SHORT", "Failed Auction", c, val, h + atr * 0.3)

                # Breakout Retest LONG
                if sig is None:
                    if abs(l - vah) < atr * 0.5 and c > vah and c > o and v > vol_avg * MIN_VOL_RATIO:
                        sig = ("LONG", "Breakout Retest", c, vah + (vah - val), vah - atr * 0.5)

                # Breakout Retest SHORT
                if sig is None:
                    if abs(h - val) < atr * 0.5 and c < val and c < o and v > vol_avg * MIN_VOL_RATIO:
                        sig = ("SHORT", "Breakout Retest", c, val - (vah - val), val + atr * 0.5)

                if sig is None:
                    continue

                direction, name, entry, tp, sl = sig
                risk = abs(entry - sl)
                if risk == 0:
                    continue

                # Apply slippage
                slip = entry * SLIPPAGE_PCT / 100
                entry = entry + slip if direction == "LONG" else entry - slip

                # Simulate forward
                result = None
                pnl_r = 0.0
                exit_bars = 0

                for j in range(i + 1, min(i + 1 + MAX_HOLD_BARS, len(df_1h))):
                    fh, fl = df_1h.iloc[j]["High"], df_1h.iloc[j]["Low"]
                    exit_bars = j - i

                    if direction == "LONG":
                        if fl <= sl:
                            result = "LOSS"
                            pnl_r = -1.0
                            break
                        if fh >= tp:
                            result = "WIN"
                            pnl_r = (tp - entry) / risk
                            break
                    else:
                        if fh >= sl:
                            result = "LOSS"
                            pnl_r = -1.0
                            break
                        if fl <= tp:
                            result = "WIN"
                            pnl_r = (entry - tp) / risk
                            break
                else:
                    # Exit at last bar close
                    exit_c = float(df_1h.iloc[min(i + MAX_HOLD_BARS, len(df_1h) - 1)]["Close"])
                    if direction == "LONG":
                        pnl_r = (exit_c - entry) / risk
                    else:
                        pnl_r = (entry - exit_c) / risk
                    result = "WIN" if pnl_r > 0 else "LOSS"

                pnl_r -= SLIPPAGE_PCT / 100  # exit slippage
                trades.append({
                    "symbol": symbol, "lb": lb, "direction": direction,
                    "signal": name, "result": result, "pnl_r": pnl_r,
                    "exit_bars": exit_bars,
                })

        n = sum(1 for t in trades if t["symbol"] == symbol)
        print(f"  {symbol}: {n} trades")

    return trades


def print_report(trades):
    if not trades:
        print("\n❌ No trades generated in 1H backtest.")
        return

    pnls = [t["pnl_r"] for t in trades]
    wins = [t for t in trades if t["result"] == "WIN"]
    total = len(trades)
    win_rate = len(wins) / total * 100
    expectancy = np.mean(pnls)
    total_r = sum(pnls)
    avg_win = np.mean([t["pnl_r"] for t in wins]) if wins else 0
    losses = [t for t in trades if t["result"] == "LOSS"]
    avg_loss = np.mean([abs(t["pnl_r"]) for t in losses]) if losses else 0
    pf = sum(t["pnl_r"] for t in wins) / abs(sum(t["pnl_r"] for t in losses)) if losses else 999

    print(f"\n{'='*60}")
    print(f"  1H INTRADAY BACKTEST REPORT (~60 days)")
    print(f"{'='*60}")
    print(f"  Total trades:    {total}")
    print(f"  Wins:            {len(wins)} ({win_rate:.1f}%)")
    print(f"  Losses:          {len(losses)} ({100-win_rate:.1f}%)")
    print(f"  Avg Win:         +{avg_win:.2f}R")
    print(f"  Avg Loss:        -{avg_loss:.2f}R")
    print(f"  Expectancy:      {expectancy:+.2f}R per trade")
    print(f"  Total P&L:       {total_r:+.1f}R")
    print(f"  Profit Factor:   {pf:.2f}")
    print(f"  Avg Hold:        {np.mean([t['exit_bars'] for t in trades]):.1f} bars (hours)")

    # By signal type
    print(f"\n{'─'*60}")
    print(f"  BY SIGNAL TYPE")
    print(f"{'─'*60}")
    for name in sorted(set(t["signal"] for t in trades)):
        st = [t for t in trades if t["signal"] == name]
        sw = [t for t in st if t["result"] == "WIN"]
        wr = len(sw) / len(st) * 100 if st else 0
        exp = np.mean([t["pnl_r"] for t in st])
        print(f"  {name:20s} | {len(st):3d} trades | WR {wr:5.1f}% | Exp {exp:+.2f}R")

    # By direction
    print(f"\n{'─'*60}")
    print(f"  BY DIRECTION")
    print(f"{'─'*60}")
    for d in ["LONG", "SHORT"]:
        dt = [t for t in trades if t["direction"] == d]
        if not dt:
            continue
        dw = [t for t in dt if t["result"] == "WIN"]
        wr = len(dw) / len(dt) * 100
        exp = np.mean([t["pnl_r"] for t in dt])
        print(f"  {d:20s} | {len(dt):3d} trades | WR {wr:5.1f}% | Exp {exp:+.2f}R")

    print(f"\n{'='*60}")


def main():
    parser = argparse.ArgumentParser(description="1H Intraday Backtest")
    parser.add_argument("--symbols", type=str, default="", help="Comma-separated (default: top 10)")
    args = parser.parse_args()

    default_symbols = ["NVDA", "AAPL", "MSFT", "AMZN", "GOOGL", "META", "TSLA", "AMD", "SPY", "QQQ"]
    symbols = args.symbols.split(",") if args.symbols else default_symbols
    symbols = [s.strip() for s in symbols if s.strip()]

    print(f"1H Intraday Backtest")
    print(f"  Symbols: {symbols}")
    print(f"  Data: ~60 days of 1H candles")
    print(f"  Max hold: {MAX_HOLD_BARS} bars | Slippage: {SLIPPAGE_PCT}%")
    print(f"{'─'*60}")

    trades = run_1h_backtest(symbols, DEFAULT_CFG)
    print_report(trades)


if __name__ == "__main__":
    main()
