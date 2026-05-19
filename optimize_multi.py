"""
Multi-Strategy Parameter Optimization — separated by holding timeframe.

Grid search over strategy-specific parameters for each timeframe.
Walk-forward: 70% train / 30% test to detect overfitting.

Usage:
    python optimize_multi.py --timeframe long
    python optimize_multi.py --timeframe short
    python optimize_multi.py --timeframe all
"""

import argparse
import itertools
from copy import deepcopy

import yfinance as yf
import pandas as pd
import numpy as np

from config import SYMBOLS, DEFAULT_CFG
from strategies.vp_signals import VPSignals
from strategies.vwap_signals import VWAPSignals
from strategies.trend_signals import TrendSignals


# ─── Parameter grids per timeframe ───────────────────────────────────────────

PARAM_GRIDS = {
    "short": {
        "label": "短線 (VP Rejection / VWAP Deviation)",
        "max_hold": [5, 7, 10],
        "params": {
            "vp_lookback": [40, 60, 90],
            "va_pct": [0.60, 0.68, 0.75],
            "max_sl_atr": [2.0, 3.0, 4.0],
        },
        "strategies": lambda: [VPSignals(), VWAPSignals()],
        "signal_filter": lambda sig: sig.holding_type == "short",
    },
    "mid": {
        "label": "中線 (Breakout Retest / VWAP Reclaim / Compression)",
        "max_hold": [15, 20, 30],
        "params": {
            "vp_lookback": [40, 60, 90, 120],
            "va_pct": [0.60, 0.68, 0.75, 0.80],
            "max_sl_atr": [2.5, 3.0, 4.0],
        },
        "strategies": lambda: [VPSignals(), VWAPSignals(), TrendSignals()],
        "signal_filter": lambda sig: sig.holding_type == "mid",
    },
    "long": {
        "label": "長線 (Breakout Acceptance / EMA Cross / 底部吸籌)",
        "max_hold": [45, 65, 90],
        "params": {
            "vp_lookback": [60, 90, 120, 180],
            "va_pct": [0.68, 0.75, 0.80],
            "max_sl_atr": [3.0, 4.0, 5.0],
            "entry_delay": [0, 1, 2],  # 突破後等幾根再進場
        },
        "strategies": lambda: [TrendSignals(), VWAPSignals()],
        "signal_filter": lambda sig: sig.holding_type == "long",
    },
}

SLIPPAGE_PCT = 0.05


# ─── Simulation ──────────────────────────────────────────────────────────────

def simulate(df, cfg, strategies, max_hold, sig_filter):
    """Simulate trades on a single symbol's DataFrame."""
    results = []
    if len(df) < cfg["vp_lookback"] + 40:
        return results

    entry_delay = cfg.get("entry_delay", 0)
    df.attrs["symbol"] = "OPT"
    start_idx = cfg["vp_lookback"] + 30

    for i in range(start_idx, len(df)):
        window = df.iloc[:i + 1].copy()
        window.attrs["symbol"] = "OPT"

        all_signals = []
        for strategy in strategies:
            try:
                sigs = strategy.detect(window, cfg, market_ctx=None)
                all_signals.extend(sigs)
            except Exception:
                pass

        filtered = [s for s in all_signals if s.direction in ("LONG", "SHORT") and sig_filter(s)]

        for sig in filtered:
            # entry_delay: wait N bars after signal before entering
            entry_bar = i + 1 + entry_delay
            if entry_bar >= len(df):
                continue

            # Check price still holds during delay (no invalidation)
            if entry_delay > 0 and sig.direction == "LONG":
                held = all(float(df.iloc[i + 1 + d]["Low"]) > sig.stop for d in range(entry_delay) if i + 1 + d < len(df))
                if not held:
                    continue
            elif entry_delay > 0 and sig.direction == "SHORT":
                held = all(float(df.iloc[i + 1 + d]["High"]) < sig.stop for d in range(entry_delay) if i + 1 + d < len(df))
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
                        results.append((-1.0, sig.signal_type))
                        break
                    if h >= tp:
                        results.append((abs(tp - entry) / actual_risk, sig.signal_type))
                        break
                else:
                    if h >= sl:
                        results.append((-1.0, sig.signal_type))
                        break
                    if l <= tp:
                        results.append((abs(entry - tp) / actual_risk, sig.signal_type))
                        break
            else:
                last_c = float(df.iloc[min(entry_bar + max_hold, len(df) - 1)]["Close"])
                if sig.direction == "LONG":
                    r = (last_c - entry) / actual_risk
                else:
                    r = (entry - last_c) / actual_risk
                results.append((r, sig.signal_type))

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
        "win_rate": len(wins) / len(pnls) * 100,
        "expectancy": exp,
        "profit_factor": sum(wins) / abs(sum(losses)) if losses and sum(losses) != 0 else 999,
        "total_r": sum(pnls),
        "sharpe": exp / std if std > 0 else 0,
    }


# ─── Main ────────────────────────────────────────────────────────────────────

def main():
    parser = argparse.ArgumentParser(description="Multi-Strategy Parameter Optimization")
    parser.add_argument("--timeframe", type=str, default="long", choices=["short", "mid", "long", "all"])
    parser.add_argument("--symbols", type=str, default="", help="Comma-separated symbols")
    args = parser.parse_args()

    symbols = args.symbols.split(",") if args.symbols else SYMBOLS
    symbols = [s.strip() for s in symbols if s.strip()]

    timeframes = ["short", "mid", "long"] if args.timeframe == "all" else [args.timeframe]

    # Download data once
    print("Downloading data...")
    all_data = {}
    for symbol in symbols:
        df = yf.download(symbol, period="2y", progress=False)
        if df.empty:
            continue
        if isinstance(df.columns, pd.MultiIndex):
            df.columns = df.columns.get_level_values(0)
        if len(df) >= 200:
            all_data[symbol] = df
    print(f"  {len(all_data)} symbols loaded\n")

    # Split train/test
    split_data = {}
    for symbol, df in all_data.items():
        idx = int(len(df) * 0.7)
        split_data[symbol] = {"train": df.iloc[:idx], "test": df.iloc[idx:]}

    for tf_name in timeframes:
        grid = PARAM_GRIDS[tf_name]
        param_keys = list(grid["params"].keys())
        param_values = list(grid["params"].values())
        max_holds = grid["max_hold"]
        sig_filter = grid["signal_filter"]

        # Build all combos: params × max_hold
        param_combos = list(itertools.product(*param_values))
        all_combos = list(itertools.product(param_combos, max_holds))

        print(f"{'━'*70}")
        print(f"  {grid['label']}")
        print(f"  Params: {' × '.join(f'{k}={v}' for k, v in grid['params'].items())}")
        print(f"  Max hold: {max_holds}")
        print(f"  Total combinations: {len(all_combos)}")
        print(f"{'━'*70}\n")

        results_table = []
        for idx, (params, max_hold) in enumerate(all_combos):
            cfg = deepcopy(DEFAULT_CFG)
            for k, v in zip(param_keys, params):
                cfg[k] = v

            strategies = grid["strategies"]()
            train_results = []
            test_results = []

            for symbol in split_data:
                train_results.extend(simulate(split_data[symbol]["train"], cfg, strategies, max_hold, sig_filter))
                test_results.extend(simulate(split_data[symbol]["test"], cfg, strategies, max_hold, sig_filter))

            train_m = evaluate(train_results)
            test_m = evaluate(test_results)

            results_table.append({
                "params": params,
                "max_hold": max_hold,
                "train": train_m,
                "test": test_m,
            })

            if (idx + 1) % 10 == 0:
                print(f"  Progress: {idx+1}/{len(all_combos)}")

        # Sort by test expectancy
        results_table.sort(key=lambda x: x["test"]["expectancy"], reverse=True)

        # Print top 10
        print(f"\n{'='*70}")
        print(f"  TOP 10 — {grid['label']}")
        print(f"{'='*70}")
        header = "  " + " ".join(f"{k:>6}" for k in param_keys) + f" {'Hold':>5} | {'Tr WR':>6} {'Tr Exp':>7} | {'Te WR':>6} {'Te Exp':>7} {'Te PF':>6} {'Sharpe':>6}"
        print(header)
        print("  " + "─" * (len(header) - 2))

        for row in results_table[:10]:
            p_str = " ".join(f"{v:>6}" if isinstance(v, int) else f"{v:>6.2f}" for v in row["params"])
            tr, te = row["train"], row["test"]
            print(f"  {p_str} {row['max_hold']:>5} | {tr['win_rate']:>5.1f}% {tr['expectancy']:>+6.2f}R | {te['win_rate']:>5.1f}% {te['expectancy']:>+6.2f}R {te['profit_factor']:>5.2f} {te['sharpe']:>5.2f}")

        # Best
        best = results_table[0]
        print(f"\n  ✅ BEST: {dict(zip(param_keys, best['params']))} | max_hold={best['max_hold']}")
        print(f"     Train: {best['train']['trades']} trades | Exp {best['train']['expectancy']:+.3f}R")
        print(f"     Test:  {best['test']['trades']} trades | Exp {best['test']['expectancy']:+.3f}R | PF {best['test']['profit_factor']:.2f}")

        if best["test"]["expectancy"] <= 0 and best["train"]["expectancy"] > 0:
            print(f"     ⚠️ Overfitting detected — train positive but test negative")
        elif best["test"]["expectancy"] > 0:
            # Robustness check: top 3 should all be positive
            top3_positive = all(r["test"]["expectancy"] > 0 for r in results_table[:3])
            if top3_positive:
                print(f"     ✅ Robust — top 3 parameter sets all positive OOS")
            else:
                print(f"     ⚠️ Fragile — only best params positive, neighbors negative")

        # Signal type breakdown for best params
        cfg = deepcopy(DEFAULT_CFG)
        for k, v in zip(param_keys, best["params"]):
            cfg[k] = v
        strategies = grid["strategies"]()
        all_results = []
        for symbol in split_data:
            all_results.extend(simulate(split_data[symbol]["test"], cfg, strategies, best["max_hold"], sig_filter))

        if all_results:
            print(f"\n  Signal breakdown (test, best params):")
            by_type = {}
            for pnl, st in all_results:
                by_type.setdefault(st, []).append(pnl)
            for st, pnls in sorted(by_type.items(), key=lambda x: np.mean(x[1]), reverse=True):
                wr = len([p for p in pnls if p > 0]) / len(pnls) * 100
                print(f"    {st:<25} {len(pnls):>4} trades | WR {wr:.0f}% | Exp {np.mean(pnls):+.2f}R")

        print()


if __name__ == "__main__":
    main()
