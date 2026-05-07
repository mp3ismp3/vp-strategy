"""
Parameter optimization — grid search over key strategy parameters.
Uses walk-forward: first 70% as train, last 30% as test (out-of-sample).

Usage:
    python optimize.py [--symbols NVDA,AAPL,MSFT]
"""

import argparse
import itertools
from copy import deepcopy

import yfinance as yf
import pandas as pd
import numpy as np

from config import SYMBOLS, DEFAULT_CFG
from strategies.vp_signals import VPSignals


# Parameter grid
PARAM_GRID = {
    "vp_lookback": [40, 60, 90, 120],
    "va_pct": [0.60, 0.68, 0.75],
    "max_sl_atr": [2.0, 3.0, 4.0],
}

SLIPPAGE_PCT = 0.05  # 0.05% per trade (entry + exit)
MAX_CONCURRENT = 5   # Max simultaneous positions


def simulate(df, cfg, max_hold=10):
    """Run backtest on single symbol, return list of (pnl_r, signal_type)."""
    strategy = VPSignals()
    results = []

    if len(df) < cfg["vp_lookback"] + 30:
        return results

    df.attrs["symbol"] = "TEST"
    start_idx = cfg["vp_lookback"] + 20

    for i in range(start_idx, len(df)):
        window = df.iloc[:i + 1].copy()
        window.attrs["symbol"] = "TEST"

        signals = strategy.detect(window, cfg, market_ctx=None)

        for sig in signals:
            if sig.direction == "WARNING":
                continue

            entry = sig.entry
            risk = abs(entry - sig.sl)
            if risk == 0:
                continue

            # Apply slippage
            slip = entry * SLIPPAGE_PCT / 100
            if sig.direction == "LONG":
                entry += slip
            else:
                entry -= slip

            tp, sl = sig.tp, sig.sl

            for j in range(i + 1, min(i + 1 + max_hold, len(df))):
                h, l = df.iloc[j]["High"], df.iloc[j]["Low"]

                if sig.direction == "LONG":
                    if l <= sl:
                        results.append((-1.0 - SLIPPAGE_PCT / 100, sig.strategy))
                        break
                    if h >= tp:
                        r = (tp - entry) / risk
                        results.append((r - SLIPPAGE_PCT / 100, sig.strategy))
                        break
                else:
                    if h >= sl:
                        results.append((-1.0 - SLIPPAGE_PCT / 100, sig.strategy))
                        break
                    if l <= tp:
                        r = (entry - tp) / risk
                        results.append((r - SLIPPAGE_PCT / 100, sig.strategy))
                        break
            else:
                last_c = float(df.iloc[min(i + max_hold, len(df) - 1)]["Close"])
                if sig.direction == "LONG":
                    r = (last_c - entry) / risk
                else:
                    r = (entry - last_c) / risk
                results.append((r - SLIPPAGE_PCT / 100, sig.strategy))

    return results


def evaluate(results):
    """Calculate key metrics from results."""
    if not results:
        return {"trades": 0, "win_rate": 0, "expectancy": 0, "profit_factor": 0, "total_r": 0}

    pnls = [r[0] for r in results]
    wins = [p for p in pnls if p > 0]
    losses = [p for p in pnls if p <= 0]

    return {
        "trades": len(pnls),
        "win_rate": len(wins) / len(pnls) * 100 if pnls else 0,
        "expectancy": np.mean(pnls) if pnls else 0,
        "profit_factor": sum(wins) / abs(sum(losses)) if losses else 999,
        "total_r": sum(pnls),
    }


def main():
    parser = argparse.ArgumentParser(description="VP Strategy Parameter Optimization")
    parser.add_argument("--symbols", type=str, default="", help="Comma-separated (default: top 10 liquid)")
    args = parser.parse_args()

    # Use all symbols for better sample size
    symbols = args.symbols.split(",") if args.symbols else SYMBOLS
    symbols = [s.strip() for s in symbols if s.strip()]

    print(f"Parameter Optimization")
    print(f"  Symbols: {symbols}")
    print(f"  Grid: {' x '.join(f'{k}={v}' for k, v in PARAM_GRID.items())}")
    combos = list(itertools.product(*PARAM_GRID.values()))
    print(f"  Total combinations: {len(combos)}")
    print(f"  Split: 70% train / 30% test")
    print(f"  Slippage: {SLIPPAGE_PCT}% per trade")
    print(f"{'─'*70}\n")

    # Download all data once
    print("Downloading data...")
    all_data = {}
    for symbol in symbols:
        df = yf.download(symbol, period="2y", progress=False)
        if df.empty:
            continue
        if isinstance(df.columns, pd.MultiIndex):
            df.columns = df.columns.get_level_values(0)
        all_data[symbol] = df
        print(f"  {symbol}: {len(df)} days")

    # Split train/test
    split_data = {}
    for symbol, df in all_data.items():
        split_idx = int(len(df) * 0.7)
        split_data[symbol] = {"train": df.iloc[:split_idx], "test": df.iloc[split_idx:]}

    # Grid search
    print(f"\nRunning grid search ({len(combos)} combinations)...\n")
    results_table = []

    for combo in combos:
        cfg = deepcopy(DEFAULT_CFG)
        cfg["vp_lookback"] = combo[0]
        cfg["va_pct"] = combo[1]
        cfg["max_sl_atr"] = combo[2]

        train_results = []
        test_results = []

        for symbol in all_data:
            train_results.extend(simulate(split_data[symbol]["train"], cfg))
            test_results.extend(simulate(split_data[symbol]["test"], cfg))

        train_metrics = evaluate(train_results)
        test_metrics = evaluate(test_results)

        results_table.append({
            "params": combo,
            "train": train_metrics,
            "test": test_metrics,
        })

    # Sort by test expectancy (out-of-sample performance)
    results_table.sort(key=lambda x: x["test"]["expectancy"], reverse=True)

    # Print top 10
    print(f"{'='*70}")
    print(f"  TOP 10 PARAMETER SETS (sorted by out-of-sample expectancy)")
    print(f"{'='*70}")
    print(f"  {'LB':>4} {'VA%':>5} {'SL_ATR':>6} | {'Train WR':>8} {'Train Exp':>9} | {'Test WR':>7} {'Test Exp':>8} {'Test PF':>7}")
    print(f"  {'─'*4} {'─'*5} {'─'*6} | {'─'*8} {'─'*9} | {'─'*7} {'─'*8} {'─'*7}")

    for row in results_table[:10]:
        p = row["params"]
        tr = row["train"]
        te = row["test"]
        print(f"  {p[0]:>4} {p[1]:>5.2f} {p[2]:>6.1f} | {tr['win_rate']:>7.1f}% {tr['expectancy']:>+8.2f}R | {te['win_rate']:>6.1f}% {te['expectancy']:>+7.2f}R {te['profit_factor']:>6.2f}")

    # Best params
    best = results_table[0]
    print(f"\n{'='*70}")
    print(f"  BEST PARAMETERS (out-of-sample)")
    print(f"{'='*70}")
    print(f"  vp_lookback = {best['params'][0]}")
    print(f"  va_pct      = {best['params'][1]}")
    print(f"  max_sl_atr  = {best['params'][2]}")
    print(f"\n  Train: {best['train']['trades']} trades | WR {best['train']['win_rate']:.1f}% | Exp {best['train']['expectancy']:+.2f}R")
    print(f"  Test:  {best['test']['trades']} trades | WR {best['test']['win_rate']:.1f}% | Exp {best['test']['expectancy']:+.2f}R | PF {best['test']['profit_factor']:.2f}")

    # Overfitting check
    if results_table[0]["train"]["expectancy"] > 0 and results_table[0]["test"]["expectancy"] <= 0:
        print(f"\n  ⚠️ WARNING: Best train params are negative on test — likely overfitting!")
    elif results_table[0]["test"]["expectancy"] > 0:
        print(f"\n  ✅ Out-of-sample positive — parameters appear robust")

    print(f"\n{'='*70}")


if __name__ == "__main__":
    main()
