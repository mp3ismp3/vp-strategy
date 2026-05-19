"""
Auto Optimize & Backtest — finds best params for all timeframes, then backtests with them.

Runs:
  1. optimize_multi for short/mid/long → finds best params
  2. backtest_multi with best params → detailed report
  3. Saves results to data/optimization_results.json

Usage:
    python auto_optimize.py
    python auto_optimize.py --symbols NVDA,AAPL,META
"""

import argparse
import itertools
import json
from copy import deepcopy
from pathlib import Path
from datetime import datetime

import yfinance as yf
import pandas as pd
import numpy as np

from config import SYMBOLS, DEFAULT_CFG
from strategies.vp_signals import VPSignals
from strategies.vwap_signals import VWAPSignals
from strategies.trend_signals import TrendSignals


DATA_DIR = Path(__file__).parent / "data"
RESULTS_FILE = DATA_DIR / "optimization_results.json"
SLIPPAGE_PCT = 0.05

# ─── Parameter grids ─────────────────────────────────────────────────────────

GRIDS = {
    "short": {
        "label": "短線 (VA Rejection / VWAP Deviation)",
        "max_hold": [5, 7, 10],
        "params": {
            "vp_lookback": [40, 60, 90],
            "va_pct": [0.60, 0.68, 0.75],
            "max_sl_atr": [2.0, 3.0, 4.0],
            "entry_delay": [0, 1],
        },
        "strategies": lambda: [VPSignals(), VWAPSignals()],
        "signal_filter": lambda sig: sig.holding_type == "short",
    },
    "mid": {
        "label": "中線 (Breakout Retest / VWAP Reclaim / Compression)",
        "max_hold": [15, 20, 30],
        "params": {
            "vp_lookback": [60, 90, 120],
            "va_pct": [0.68, 0.75, 0.80],
            "max_sl_atr": [2.5, 3.0, 4.0],
            "entry_delay": [0, 1],
        },
        "strategies": lambda: [VPSignals(), VWAPSignals(), TrendSignals()],
        "signal_filter": lambda sig: sig.holding_type == "mid",
    },
    "long": {
        "label": "長線 (Breakout Acceptance / EMA Cross)",
        "max_hold": [45, 65, 90],
        "params": {
            "vp_lookback": [60, 90, 120, 180],
            "va_pct": [0.68, 0.75, 0.80],
            "max_sl_atr": [3.0, 4.0, 5.0],
            "entry_delay": [0, 1, 2],
        },
        "strategies": lambda: [TrendSignals(), VWAPSignals()],
        "signal_filter": lambda sig: sig.holding_type == "long",
    },
}


# ─── Simulation ──────────────────────────────────────────────────────────────

def simulate(df, cfg, strategies, max_hold, sig_filter, entry_delay=0):
    results = []
    if len(df) < cfg["vp_lookback"] + 40:
        return results

    df.attrs["symbol"] = "OPT"
    start_idx = cfg["vp_lookback"] + 30

    for i in range(start_idx, len(df)):
        window = df.iloc[:i + 1].copy()
        window.attrs["symbol"] = "OPT"

        all_signals = []
        for strategy in strategies:
            try:
                all_signals.extend(strategy.detect(window, cfg, market_ctx=None))
            except Exception:
                pass

        filtered = [s for s in all_signals if s.direction in ("LONG", "SHORT") and sig_filter(s)]

        for sig in filtered:
            entry_bar = i + 1 + entry_delay
            if entry_bar >= len(df):
                continue

            # Check hold during delay
            if entry_delay > 0:
                held = True
                for d in range(entry_delay):
                    idx = i + 1 + d
                    if idx >= len(df):
                        held = False
                        break
                    if sig.direction == "LONG" and float(df.iloc[idx]["Low"]) <= sig.stop:
                        held = False
                        break
                    if sig.direction == "SHORT" and float(df.iloc[idx]["High"]) >= sig.stop:
                        held = False
                        break
                if not held:
                    continue

            entry = float(df.iloc[entry_bar]["Open"])
            risk = abs(sig.entry - sig.stop)
            if risk == 0:
                continue

            slip = entry * SLIPPAGE_PCT / 100
            if sig.direction == "LONG":
                entry += slip
                tp = entry + abs(sig.target - sig.entry)
                sl = entry - abs(sig.entry - sig.stop)
            else:
                entry -= slip
                tp = entry - abs(sig.entry - sig.target)
                sl = entry + abs(sig.stop - sig.entry)

            actual_risk = abs(entry - sl)
            if actual_risk == 0:
                continue

            for j in range(entry_bar + 1, min(entry_bar + 1 + max_hold, len(df))):
                h, l = float(df.iloc[j]["High"]), float(df.iloc[j]["Low"])
                if sig.direction == "LONG":
                    if l <= sl:
                        results.append((-1.0, sig.signal_type, sig.direction))
                        break
                    if h >= tp:
                        results.append((abs(tp - entry) / actual_risk, sig.signal_type, sig.direction))
                        break
                else:
                    if h >= sl:
                        results.append((-1.0, sig.signal_type, sig.direction))
                        break
                    if l <= tp:
                        results.append((abs(entry - tp) / actual_risk, sig.signal_type, sig.direction))
                        break
            else:
                last_c = float(df.iloc[min(entry_bar + max_hold, len(df) - 1)]["Close"])
                r = (last_c - entry) / actual_risk if sig.direction == "LONG" else (entry - last_c) / actual_risk
                results.append((r, sig.signal_type, sig.direction))

    return results


def evaluate(results):
    if not results:
        return {"trades": 0, "win_rate": 0, "expectancy": 0, "profit_factor": 0, "total_r": 0, "sharpe": 0}
    pnls = [r[0] for r in results]
    wins = [p for p in pnls if p > 0]
    losses = [p for p in pnls if p <= 0]
    exp = np.mean(pnls)
    std = np.std(pnls)
    return {
        "trades": len(pnls),
        "win_rate": round(len(wins) / len(pnls) * 100, 1),
        "expectancy": round(exp, 3),
        "profit_factor": round(sum(wins) / abs(sum(losses)), 2) if losses and sum(losses) != 0 else 999,
        "total_r": round(sum(pnls), 1),
        "sharpe": round(exp / std, 2) if std > 0 else 0,
    }


# ─── Main ────────────────────────────────────────────────────────────────────

def main():
    parser = argparse.ArgumentParser(description="Auto Optimize & Backtest All Timeframes")
    parser.add_argument("--symbols", type=str, default="", help="Comma-separated symbols (default: all)")
    args = parser.parse_args()

    symbols = args.symbols.split(",") if args.symbols else SYMBOLS
    symbols = [s.strip() for s in symbols if s.strip()]

    print(f"{'═'*70}")
    print(f"  AUTO OPTIMIZE & BACKTEST")
    print(f"  {len(symbols)} symbols | 3 timeframes | Walk-forward 70/30")
    print(f"{'═'*70}\n")

    # Download all data once (2 years)
    print("Downloading 2 years of data...")
    all_data = {}
    for i, symbol in enumerate(symbols):
        df = yf.download(symbol, period="2y", progress=False)
        if df.empty:
            continue
        if isinstance(df.columns, pd.MultiIndex):
            df.columns = df.columns.get_level_values(0)
        if len(df) >= 200:
            all_data[symbol] = df
            print(f"    {symbol}: {len(df)} days", flush=True)
    print(f"  ✓ {len(all_data)} symbols loaded\n", flush=True)

    # Split 70/30
    split_data = {}
    for sym, df in all_data.items():
        idx = int(len(df) * 0.7)
        split_data[sym] = {"train": df.iloc[:idx], "test": df.iloc[idx:]}

    final_results = {}

    for tf_name, grid in GRIDS.items():
        print(f"\n{'━'*70}")
        print(f"  OPTIMIZING: {grid['label']}")
        print(f"{'━'*70}")

        param_keys = list(grid["params"].keys())
        param_values = list(grid["params"].values())
        param_combos = list(itertools.product(*param_values))
        max_holds = grid["max_hold"]
        all_combos = list(itertools.product(param_combos, max_holds))
        sig_filter = grid["signal_filter"]

        print(f"  {len(all_combos)} combinations to test...", flush=True)

        results_table = []
        for idx, (params, max_hold) in enumerate(all_combos):
            cfg = deepcopy(DEFAULT_CFG)
            entry_delay = 0
            for k, v in zip(param_keys, params):
                if k == "entry_delay":
                    entry_delay = v
                else:
                    cfg[k] = v

            strategies = grid["strategies"]()
            train_results = []
            test_results = []

            for sym in split_data:
                train_results.extend(simulate(split_data[sym]["train"], cfg, strategies, max_hold, sig_filter, entry_delay))
                test_results.extend(simulate(split_data[sym]["test"], cfg, strategies, max_hold, sig_filter, entry_delay))

            results_table.append({
                "params": dict(zip(param_keys, params)),
                "max_hold": max_hold,
                "train": evaluate(train_results),
                "test": evaluate(test_results),
                "test_results": test_results,
            })

            if (idx + 1) % 5 == 0 or idx == 0:
                print(f"    [{tf_name}] {idx+1}/{len(all_combos)} combos done...", flush=True)

        # Sort by test expectancy
        results_table.sort(key=lambda x: x["test"]["expectancy"], reverse=True)
        best = results_table[0]

        # Robustness check
        top3_positive = all(r["test"]["expectancy"] > 0 for r in results_table[:3])
        robust = top3_positive and best["test"]["expectancy"] > 0

        # Signal breakdown
        signal_breakdown = {}
        for pnl, sig_type, direction in best.get("test_results", []):
            key = f"{sig_type} ({direction})"
            signal_breakdown.setdefault(key, []).append(pnl)

        signal_report = {}
        for key, pnls in sorted(signal_breakdown.items(), key=lambda x: np.mean(x[1]), reverse=True):
            signal_report[key] = {
                "trades": len(pnls),
                "win_rate": round(len([p for p in pnls if p > 0]) / len(pnls) * 100, 1),
                "expectancy": round(np.mean(pnls), 3),
            }

        # Print results
        print(f"\n  {'─'*60}")
        print(f"  TOP 5:")
        for i, row in enumerate(results_table[:5]):
            p = row["params"]
            te = row["test"]
            p_str = " ".join(f"{k}={v}" for k, v in p.items())
            print(f"    #{i+1} {p_str} hold={row['max_hold']} | WR {te['win_rate']}% Exp {te['expectancy']:+.3f}R PF {te['profit_factor']}")

        print(f"\n  ✅ BEST PARAMS: {best['params']} | max_hold={best['max_hold']}")
        print(f"     Train: {best['train']['trades']} trades | WR {best['train']['win_rate']}% | Exp {best['train']['expectancy']:+.3f}R")
        print(f"     Test:  {best['test']['trades']} trades | WR {best['test']['win_rate']}% | Exp {best['test']['expectancy']:+.3f}R | PF {best['test']['profit_factor']} | Sharpe {best['test']['sharpe']}")
        print(f"     {'✅ Robust (top 3 all positive OOS)' if robust else '⚠️ Fragile (not all top 3 positive)'}")

        if signal_report:
            print(f"\n  Signal breakdown (best params, test set):")
            for key, stats in signal_report.items():
                print(f"    {key:<35} {stats['trades']:>3} trades | WR {stats['win_rate']}% | Exp {stats['expectancy']:+.3f}R")

        # Store
        final_results[tf_name] = {
            "label": grid["label"],
            "best_params": best["params"],
            "best_max_hold": best["max_hold"],
            "train_metrics": best["train"],
            "test_metrics": best["test"],
            "robust": robust,
            "signal_breakdown": signal_report,
            "top5": [{"params": r["params"], "max_hold": r["max_hold"],
                      "test": r["test"]} for r in results_table[:5]],
        }

    # ─── Final Summary ────────────────────────────────────────────────────────

    print(f"\n\n{'═'*70}")
    print(f"  FINAL SUMMARY — BEST PARAMS PER TIMEFRAME")
    print(f"{'═'*70}\n")

    for tf, data in final_results.items():
        status = "✅" if data["robust"] else "⚠️"
        te = data["test_metrics"]
        print(f"  {status} {data['label']}")
        print(f"     Params: {data['best_params']}")
        print(f"     Max Hold: {data['best_max_hold']} days")
        print(f"     Test: {te['trades']} trades | WR {te['win_rate']}% | Exp {te['expectancy']:+.3f}R | Sharpe {te['sharpe']}")
        print()

    # Best signal across all
    print(f"  {'─'*60}")
    print(f"  BEST SIGNALS (highest expectancy):")
    all_signals = []
    for tf, data in final_results.items():
        for sig, stats in data["signal_breakdown"].items():
            all_signals.append((sig, stats, tf))
    all_signals.sort(key=lambda x: x[1]["expectancy"], reverse=True)
    for sig, stats, tf in all_signals[:5]:
        print(f"    {sig:<35} [{tf}] {stats['trades']} trades | WR {stats['win_rate']}% | Exp {stats['expectancy']:+.3f}R")

    # Save to JSON
    DATA_DIR.mkdir(exist_ok=True)
    output = {
        "timestamp": datetime.now().isoformat(),
        "symbols_count": len(all_data),
        "results": final_results,
    }
    RESULTS_FILE.write_text(json.dumps(output, indent=2, ensure_ascii=False))
    print(f"\n  Results saved to {RESULTS_FILE}")
    print(f"{'═'*70}")


if __name__ == "__main__":
    main()
