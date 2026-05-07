"""
Backtest module — simulates VP strategy signals over historical data.
Walks through each trading day, generates signals, and tracks outcomes.

Usage:
    python backtest.py [--days 120] [--symbols NVDA,AAPL] [--min-score 3]
                       [--vp-lookback 60] [--va-pct 0.68] [--max-sl-atr 3.0]
"""

import sys
import argparse
from datetime import datetime
from dataclasses import dataclass

import yfinance as yf
import pandas as pd
import numpy as np

from config import SYMBOLS, DEFAULT_CFG, SECTOR_MAP
from core.indicators import calc_vp, calc_atr
from core.market_context import fetch_market_context
from scoring.confidence import score_signal, calc_stock_factors
from strategies.vp_signals import VPSignals


@dataclass
class Trade:
    symbol: str
    direction: str
    signal_type: str
    entry: float
    tp: float
    sl: float
    entry_date: str
    exit_date: str = ""
    exit_price: float = 0.0
    result: str = ""  # "WIN" / "LOSS" / "OPEN"
    pnl_r: float = 0.0  # P&L in R multiples
    score: int = 0


def run_backtest(symbols, cfg, days=120, max_hold=10, min_score=0):
    """Walk-forward backtest: for each day, generate signals and track outcomes."""
    strategy = VPSignals()
    trades = []
    market_ctx = fetch_market_context(cfg)

    for symbol in symbols:
        # Download enough history: days + lookback + buffer
        total_days = days + cfg["vp_lookback"] + 30
        df = yf.download(symbol, period=f"{total_days}d", progress=False)
        if df.empty or len(df) < cfg["vp_lookback"] + days:
            print(f"  {symbol}: insufficient data, skipping")
            continue

        if isinstance(df.columns, pd.MultiIndex):
            df.columns = df.columns.get_level_values(0)

        df.attrs["symbol"] = symbol

        # Walk forward: start from lookback offset, simulate each day
        start_idx = cfg["vp_lookback"] + 20
        end_idx = len(df)

        for i in range(start_idx, end_idx):
            # Slice up to day i (inclusive) — this is what scanner sees at close of day i
            window = df.iloc[:i + 1].copy()
            window.attrs["symbol"] = symbol

            signals = strategy.detect(window, cfg, market_ctx=None)

            for sig in signals:
                if sig.direction == "WARNING":
                    continue

                # Score the signal and filter
                if min_score > 0:
                    factors = calc_stock_factors(window, symbol, cfg, market_ctx)
                    sector_etf = SECTOR_MAP.get(symbol, "QQQ")
                    score, _ = score_signal(sig.direction, sig.strategy, factors, market_ctx, sector_etf, False)
                    # Trend filter
                    trend = factors.get("inst_trend", "NEUTRAL")
                    if sig.direction == "LONG" and trend == "BEARISH":
                        continue
                    if sig.direction == "SHORT" and trend == "BULLISH":
                        continue
                    if score < min_score:
                        continue
                else:
                    score = 0

                # Use next day's open as actual entry (realistic execution)
                if i + 1 >= end_idx:
                    continue
                entry = float(df.iloc[i + 1]["Open"])
                tp = entry + (sig.tp - sig.entry) if sig.direction == "LONG" else entry - (sig.entry - sig.tp)
                sl = entry - (sig.entry - sig.sl) if sig.direction == "LONG" else entry + (sig.sl - sig.entry)
                risk = abs(entry - sl)
                if risk == 0:
                    continue

                entry_date = str(df.index[i + 1].date())

                # Simulate forward: check next max_hold days
                trade = Trade(
                    symbol=symbol, direction=sig.direction,
                    signal_type=sig.strategy, entry=entry,
                    tp=tp, sl=sl, entry_date=entry_date, score=score
                )

                for j in range(i + 2, min(i + 2 + max_hold, end_idx)):
                    day = df.iloc[j]
                    h, l, c = day["High"], day["Low"], day["Close"]

                    if sig.direction == "LONG":
                        if l <= sl:
                            trade.exit_price = sl
                            trade.result = "LOSS"
                            trade.pnl_r = -1.0
                            trade.exit_date = str(df.index[j].date())
                            break
                        if h >= tp:
                            trade.exit_price = tp
                            trade.result = "WIN"
                            trade.pnl_r = abs(tp - entry) / risk
                            trade.exit_date = str(df.index[j].date())
                            break
                    else:  # SHORT
                        if h >= sl:
                            trade.exit_price = sl
                            trade.result = "LOSS"
                            trade.pnl_r = -1.0
                            trade.exit_date = str(df.index[j].date())
                            break
                        if l <= tp:
                            trade.exit_price = tp
                            trade.result = "WIN"
                            trade.pnl_r = abs(entry - tp) / risk
                            trade.exit_date = str(df.index[j].date())
                            break
                else:
                    # Max hold reached, exit at close
                    last_close = float(df.iloc[min(i + 1 + max_hold, end_idx - 1)]["Close"])
                    trade.exit_price = last_close
                    trade.exit_date = str(df.index[min(i + 1 + max_hold, end_idx - 1)].date())
                    if sig.direction == "LONG":
                        trade.pnl_r = (last_close - entry) / risk
                    else:
                        trade.pnl_r = (entry - last_close) / risk
                    trade.result = "WIN" if trade.pnl_r > 0 else "LOSS"

                trades.append(trade)

        print(f"  {symbol}: {sum(1 for t in trades if t.symbol == symbol)} trades")

    return trades


def print_report(trades):
    """Print backtest summary report."""
    if not trades:
        print("\n❌ No trades generated.")
        return

    wins = [t for t in trades if t.result == "WIN"]
    losses = [t for t in trades if t.result == "LOSS"]
    total = len(trades)
    win_rate = len(wins) / total * 100

    avg_win_r = np.mean([t.pnl_r for t in wins]) if wins else 0
    avg_loss_r = np.mean([abs(t.pnl_r) for t in losses]) if losses else 0
    expectancy = np.mean([t.pnl_r for t in trades])
    total_r = sum(t.pnl_r for t in trades)

    # By signal type
    signal_types = set(t.signal_type for t in trades)

    print(f"\n{'='*60}")
    print(f"  BACKTEST REPORT")
    print(f"{'='*60}")
    print(f"  Total trades:    {total}")
    print(f"  Wins:            {len(wins)} ({win_rate:.1f}%)")
    print(f"  Losses:          {len(losses)} ({100-win_rate:.1f}%)")
    print(f"  Avg Win:         +{avg_win_r:.2f}R")
    print(f"  Avg Loss:        -{avg_loss_r:.2f}R")
    print(f"  Expectancy:      {expectancy:+.2f}R per trade")
    print(f"  Total P&L:       {total_r:+.1f}R")
    print(f"  Profit Factor:   {sum(t.pnl_r for t in wins) / abs(sum(t.pnl_r for t in losses)):.2f}" if losses else "  Profit Factor:   ∞")

    # Max consecutive losses
    max_consec_loss = 0
    current_streak = 0
    for t in trades:
        if t.result == "LOSS":
            current_streak += 1
            max_consec_loss = max(max_consec_loss, current_streak)
        else:
            current_streak = 0
    print(f"  Max Consec Loss: {max_consec_loss}")

    print(f"\n{'─'*60}")
    print(f"  BY SIGNAL TYPE")
    print(f"{'─'*60}")
    for st in sorted(signal_types):
        st_trades = [t for t in trades if t.signal_type == st]
        st_wins = [t for t in st_trades if t.result == "WIN"]
        st_wr = len(st_wins) / len(st_trades) * 100 if st_trades else 0
        st_exp = np.mean([t.pnl_r for t in st_trades]) if st_trades else 0
        label = st.split(": ", 1)[-1] if ": " in st else st
        print(f"  {label:20s} | {len(st_trades):3d} trades | WR {st_wr:5.1f}% | Exp {st_exp:+.2f}R")

    # By direction
    print(f"\n{'─'*60}")
    print(f"  BY DIRECTION")
    print(f"{'─'*60}")
    for d in ["LONG", "SHORT"]:
        d_trades = [t for t in trades if t.direction == d]
        if not d_trades:
            continue
        d_wins = [t for t in d_trades if t.result == "WIN"]
        d_wr = len(d_wins) / len(d_trades) * 100
        d_exp = np.mean([t.pnl_r for t in d_trades])
        print(f"  {d:20s} | {len(d_trades):3d} trades | WR {d_wr:5.1f}% | Exp {d_exp:+.2f}R")

    # Top 5 best and worst
    sorted_trades = sorted(trades, key=lambda t: t.pnl_r, reverse=True)
    print(f"\n{'─'*60}")
    print(f"  TOP 5 WINS")
    print(f"{'─'*60}")
    for t in sorted_trades[:5]:
        print(f"  {t.symbol:6s} {t.direction:5s} {t.signal_type.split(': ',1)[-1]:18s} {t.entry_date} → {t.exit_date} | {t.pnl_r:+.2f}R")

    print(f"\n{'─'*60}")
    print(f"  TOP 5 LOSSES")
    print(f"{'─'*60}")
    for t in sorted_trades[-5:]:
        print(f"  {t.symbol:6s} {t.direction:5s} {t.signal_type.split(': ',1)[-1]:18s} {t.entry_date} → {t.exit_date} | {t.pnl_r:+.2f}R")

    print(f"\n{'='*60}")


def main():
    parser = argparse.ArgumentParser(description="VP Strategy Backtest")
    parser.add_argument("--days", type=int, default=120, help="Days to backtest (default: 120)")
    parser.add_argument("--symbols", type=str, default="", help="Comma-separated symbols (default: all)")
    parser.add_argument("--max-hold", type=int, default=10, help="Max holding days (default: 10)")
    parser.add_argument("--min-score", type=int, default=0, help="Min confidence score filter (0=off, 3=recommended)")
    parser.add_argument("--vp-lookback", type=int, default=None, help="Override vp_lookback")
    parser.add_argument("--va-pct", type=float, default=None, help="Override va_pct")
    parser.add_argument("--max-sl-atr", type=float, default=None, help="Override max_sl_atr")
    args = parser.parse_args()

    symbols = args.symbols.split(",") if args.symbols else SYMBOLS
    symbols = [s.strip() for s in symbols if s.strip()]

    cfg = dict(DEFAULT_CFG)
    if args.vp_lookback:
        cfg["vp_lookback"] = args.vp_lookback
    if args.va_pct:
        cfg["va_pct"] = args.va_pct
    if args.max_sl_atr:
        cfg["max_sl_atr"] = args.max_sl_atr

    print(f"VP Strategy Backtest")
    print(f"  Symbols: {len(symbols)} | Days: {args.days} | Max Hold: {args.max_hold}")
    print(f"  Config: lookback={cfg['vp_lookback']}, va_pct={cfg['va_pct']}, max_sl_atr={cfg['max_sl_atr']}")
    print(f"  Min Score: {args.min_score} {'(filtering enabled)' if args.min_score > 0 else '(no filter)'}")
    print(f"{'─'*60}")

    trades = run_backtest(symbols, cfg, days=args.days, max_hold=args.max_hold, min_score=args.min_score)
    print_report(trades)


if __name__ == "__main__":
    main()
