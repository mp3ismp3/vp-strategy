"""
Multi-Strategy Backtest — separated by holding timeframe.

Backtests each strategy independently with appropriate max_hold:
  - Short (VP Rejection, Failed Auction, VWAP Deviation): max_hold = 5-10 days
  - Mid (Breakout Retest, VWAP Reclaim, AVWAP Pullback, Compression Breakout): max_hold = 10-30 days
  - Long (Breakout Acceptance, EMA Cross): max_hold = 30-90 days

Usage:
    python backtest_multi.py --timeframe long
    python backtest_multi.py --timeframe short --symbols NVDA,AAPL
    python backtest_multi.py --timeframe all --days 250
"""

import argparse
from dataclasses import dataclass, field
from copy import deepcopy

import yfinance as yf
import pandas as pd
import numpy as np

from config import SYMBOLS, DEFAULT_CFG
from strategies.vp_signals import VPSignals
from strategies.vwap_signals import VWAPSignals
from strategies.trend_signals import TrendSignals


# ─── Timeframe definitions ───────────────────────────────────────────────────

TIMEFRAMES = {
    "short": {
        "label": "短線 (1-5天)",
        "max_hold": 7,
        "strategies": [VPSignals(), VWAPSignals()],
        "signal_filter": lambda sig: sig.holding_type == "short",
    },
    "mid": {
        "label": "中線 (1-4週)",
        "max_hold": 25,
        "strategies": [VPSignals(), VWAPSignals(), TrendSignals()],
        "signal_filter": lambda sig: sig.holding_type == "mid",
    },
    "long": {
        "label": "長線 (1-3月)",
        "max_hold": 65,
        "strategies": [TrendSignals(), VWAPSignals()],
        "signal_filter": lambda sig: sig.holding_type == "long",
    },
}

SLIPPAGE_PCT = 0.05


@dataclass
class Trade:
    symbol: str
    direction: str
    signal_type: str
    holding_type: str
    entry: float
    tp: float
    sl: float
    entry_date: str
    exit_date: str = ""
    exit_price: float = 0.0
    result: str = ""
    pnl_r: float = 0.0
    hold_days: int = 0
    reasons: list = field(default_factory=list)


# ─── Backtest Engine ─────────────────────────────────────────────────────────

def run_backtest(symbols, cfg, timeframe="long", days=250):
    """Walk-forward backtest for a specific timeframe."""
    tf = TIMEFRAMES[timeframe]
    strategies = tf["strategies"]
    max_hold = tf["max_hold"]
    sig_filter = tf["signal_filter"]
    trades = []

    for symbol in symbols:
        total_days = days + cfg["vp_lookback"] + 60
        df = yf.download(symbol, period=f"{total_days}d", progress=False)
        if df.empty:
            continue
        if isinstance(df.columns, pd.MultiIndex):
            df.columns = df.columns.get_level_values(0)
        if len(df) < cfg["vp_lookback"] + 60:
            continue

        df.attrs["symbol"] = symbol
        start_idx = cfg["vp_lookback"] + 30
        end_idx = len(df)

        for i in range(start_idx, end_idx):
            window = df.iloc[:i + 1].copy()
            window.attrs["symbol"] = symbol

            all_signals = []
            for strategy in strategies:
                try:
                    sigs = strategy.detect(window, cfg, market_ctx=None)
                    all_signals.extend(sigs)
                except Exception:
                    pass

            # Filter by timeframe
            filtered = [s for s in all_signals if s.direction in ("LONG", "SHORT") and sig_filter(s)]

            for sig in filtered:
                if i + 1 >= end_idx:
                    continue

                entry = float(df.iloc[i + 1]["Open"])
                risk = abs(sig.entry - sig.stop)
                if risk == 0:
                    continue

                # Adjust TP/SL relative to actual entry
                if sig.direction == "LONG":
                    entry += entry * SLIPPAGE_PCT / 100
                    tp = entry + abs(sig.target - sig.entry)
                    sl = entry - abs(sig.entry - sig.stop)
                else:
                    entry -= entry * SLIPPAGE_PCT / 100
                    tp = entry - abs(sig.entry - sig.target)
                    sl = entry + abs(sig.stop - sig.entry)

                actual_risk = abs(entry - sl)
                if actual_risk == 0:
                    continue

                entry_date = str(df.index[i + 1].date())
                trade = Trade(
                    symbol=symbol, direction=sig.direction,
                    signal_type=sig.signal_type, holding_type=sig.holding_type,
                    entry=entry, tp=tp, sl=sl, entry_date=entry_date,
                    reasons=sig.reasons[:2],
                )

                # Simulate forward
                for j in range(i + 2, min(i + 2 + max_hold, end_idx)):
                    h, l = float(df.iloc[j]["High"]), float(df.iloc[j]["Low"])

                    if sig.direction == "LONG":
                        if l <= sl:
                            trade.exit_price = sl
                            trade.result = "LOSS"
                            trade.pnl_r = -1.0
                            break
                        if h >= tp:
                            trade.exit_price = tp
                            trade.result = "WIN"
                            trade.pnl_r = abs(tp - entry) / actual_risk
                            break
                    else:
                        if h >= sl:
                            trade.exit_price = sl
                            trade.result = "LOSS"
                            trade.pnl_r = -1.0
                            break
                        if l <= tp:
                            trade.exit_price = tp
                            trade.result = "WIN"
                            trade.pnl_r = abs(entry - tp) / actual_risk
                            break
                else:
                    last_idx = min(i + 1 + max_hold, end_idx - 1)
                    last_c = float(df.iloc[last_idx]["Close"])
                    trade.exit_price = last_c
                    if sig.direction == "LONG":
                        trade.pnl_r = (last_c - entry) / actual_risk
                    else:
                        trade.pnl_r = (entry - last_c) / actual_risk
                    trade.result = "WIN" if trade.pnl_r > 0 else "LOSS"

                trade.exit_date = str(df.index[min(i + 1 + max_hold, end_idx - 1)].date()) if not trade.exit_date else trade.exit_date
                trade.hold_days = (pd.Timestamp(trade.exit_date) - pd.Timestamp(trade.entry_date)).days
                trades.append(trade)

        print(f"  {symbol}: {sum(1 for t in trades if t.symbol == symbol)} trades")

    return trades


# ─── Report ──────────────────────────────────────────────────────────────────

def print_report(trades, timeframe):
    tf = TIMEFRAMES[timeframe]
    if not trades:
        print(f"\n❌ No trades for {tf['label']}.")
        return

    wins = [t for t in trades if t.result == "WIN"]
    losses = [t for t in trades if t.result == "LOSS"]
    total = len(trades)
    win_rate = len(wins) / total * 100
    expectancy = np.mean([t.pnl_r for t in trades])
    total_r = sum(t.pnl_r for t in trades)
    avg_hold = np.mean([t.hold_days for t in trades])

    # Max drawdown in R
    cumulative = np.cumsum([t.pnl_r for t in trades])
    peak = np.maximum.accumulate(cumulative)
    drawdown = peak - cumulative
    max_dd = float(np.max(drawdown)) if len(drawdown) > 0 else 0

    # Sharpe-like (expectancy / std)
    pnls = [t.pnl_r for t in trades]
    sharpe = expectancy / np.std(pnls) if np.std(pnls) > 0 else 0

    print(f"\n{'='*65}")
    print(f"  {tf['label']} BACKTEST REPORT")
    print(f"{'='*65}")
    print(f"  Trades: {total} | WR: {win_rate:.1f}% | Exp: {expectancy:+.2f}R | Total: {total_r:+.1f}R")
    print(f"  Avg Hold: {avg_hold:.0f} days | Max DD: {max_dd:.1f}R | Sharpe: {sharpe:.2f}")

    if wins:
        print(f"  Avg Win: +{np.mean([t.pnl_r for t in wins]):.2f}R | Avg Loss: -{np.mean([abs(t.pnl_r) for t in losses]):.2f}R")

    # By signal type
    print(f"\n{'─'*65}")
    print(f"  {'Signal Type':<25} {'Trades':>6} {'WR':>7} {'Exp':>8} {'Total R':>8} {'Avg Hold':>8}")
    print(f"  {'─'*25} {'─'*6} {'─'*7} {'─'*8} {'─'*8} {'─'*8}")
    for st in sorted(set(t.signal_type for t in trades)):
        st_trades = [t for t in trades if t.signal_type == st]
        st_wins = [t for t in st_trades if t.result == "WIN"]
        wr = len(st_wins) / len(st_trades) * 100
        exp = np.mean([t.pnl_r for t in st_trades])
        tot = sum(t.pnl_r for t in st_trades)
        ah = np.mean([t.hold_days for t in st_trades])
        print(f"  {st:<25} {len(st_trades):>6} {wr:>6.1f}% {exp:>+7.2f}R {tot:>+7.1f}R {ah:>7.0f}d")

    # By direction
    print(f"\n{'─'*65}")
    for d in ["LONG", "SHORT"]:
        d_trades = [t for t in trades if t.direction == d]
        if not d_trades:
            continue
        d_wr = len([t for t in d_trades if t.result == "WIN"]) / len(d_trades) * 100
        d_exp = np.mean([t.pnl_r for t in d_trades])
        print(f"  {d}: {len(d_trades)} trades | WR {d_wr:.1f}% | Exp {d_exp:+.2f}R")

    print(f"{'='*65}\n")


# ─── Main ────────────────────────────────────────────────────────────────────

def main():
    parser = argparse.ArgumentParser(description="Multi-Strategy Backtest by Timeframe")
    parser.add_argument("--timeframe", type=str, default="long", choices=["short", "mid", "long", "all"])
    parser.add_argument("--days", type=int, default=250, help="Backtest period in days")
    parser.add_argument("--symbols", type=str, default="", help="Comma-separated symbols")
    args = parser.parse_args()

    symbols = args.symbols.split(",") if args.symbols else SYMBOLS
    symbols = [s.strip() for s in symbols if s.strip()]

    timeframes = ["short", "mid", "long"] if args.timeframe == "all" else [args.timeframe]

    for tf in timeframes:
        print(f"\n{'━'*65}")
        print(f"  Running {TIMEFRAMES[tf]['label']} backtest | {len(symbols)} symbols | {args.days} days")
        print(f"  Max hold: {TIMEFRAMES[tf]['max_hold']} days")
        print(f"{'━'*65}")
        trades = run_backtest(symbols, DEFAULT_CFG, timeframe=tf, days=args.days)
        print_report(trades, tf)


if __name__ == "__main__":
    main()
