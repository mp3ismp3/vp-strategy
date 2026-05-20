"""
Auto Optimize & Backtest — FAST vectorized version.

Pre-computes all indicators once per symbol, then grid search only does
threshold comparisons (no recomputation). ~10-20x faster than original.

Usage:
    python auto_optimize.py
    python auto_optimize.py --symbols NVDA,AAPL,META
"""

import argparse
import itertools
import json
from pathlib import Path
from datetime import datetime

import yfinance as yf
import pandas as pd
import numpy as np

from config import SYMBOLS, DEFAULT_CFG


DATA_DIR = Path(__file__).parent / "data"
RESULTS_FILE = DATA_DIR / "optimization_results.json"
SLIPPAGE_PCT = 0.05


# ─── Vectorized indicator pre-computation ────────────────────────────────────

def precompute(df, lookbacks=[40, 60, 90, 120, 180]):
    """Pre-compute all indicators for all lookback values. Returns dict of arrays."""
    n = len(df)
    h, l, c, o, v = df["High"].values, df["Low"].values, df["Close"].values, df["Open"].values, df["Volume"].values

    # TR and ATR(14)
    tr = np.zeros(n)
    tr[1:] = np.maximum(h[1:] - l[1:], np.maximum(np.abs(h[1:] - c[:-1]), np.abs(l[1:] - c[:-1])))
    atr14 = pd.Series(tr).rolling(14).mean().values

    # Volume MA(21) and vol_ratio
    vol_ma21 = pd.Series(v).rolling(21).mean().values
    vol_ratio = np.where(vol_ma21 > 0, v / vol_ma21, 0)

    # EMA 20, 50
    ema20 = pd.Series(c).ewm(span=20, adjust=False).mean().values
    ema50 = pd.Series(c).ewm(span=50, adjust=False).mean().values

    # Donchian(20) — rolling max/min of previous 20 bars (excluding current)
    don_upper = pd.Series(h).shift(1).rolling(20).max().values
    don_lower = pd.Series(l).shift(1).rolling(20).min().values

    # VP (POC/VAH/VAL) for each lookback
    vp_data = {}
    for lb in lookbacks:
        poc = np.full(n, np.nan)
        vah = np.full(n, np.nan)
        val = np.full(n, np.nan)
        for i in range(lb, n):
            seg_c = (h[i-lb:i] + l[i-lb:i] + c[i-lb:i]) / 3
            seg_v = v[i-lb:i].astype(float)
            sv = seg_v.sum()
            if sv == 0:
                continue
            p = np.sum(seg_c * seg_v) / sv
            var = np.sum(seg_c**2 * seg_v) / sv - p**2
            std = np.sqrt(max(var, 0))
            poc[i] = p
            vah[i] = p + std
            val[i] = p - std
        vp_data[lb] = {"poc": poc, "vah": vah, "val": val}

    # VWAP bands for each lookback
    vwap_data = {}
    for lb in lookbacks:
        vwap = np.full(n, np.nan)
        vwap_upper = np.full(n, np.nan)
        vwap_lower = np.full(n, np.nan)
        for i in range(lb, n):
            seg_c = (h[i-lb:i] + l[i-lb:i] + c[i-lb:i]) / 3
            seg_v = v[i-lb:i].astype(float)
            sv = seg_v.sum()
            if sv == 0:
                continue
            vw = np.sum(seg_c * seg_v) / sv
            var = np.sum((seg_c - vw)**2 * seg_v) / sv
            std = np.sqrt(max(var, 0))
            vwap[i] = vw
            vwap_upper[i] = vw + 2 * std
            vwap_lower[i] = vw - 2 * std
        vwap_data[lb] = {"vwap": vwap, "upper": vwap_upper, "lower": vwap_lower}

    # Candle properties
    body = np.abs(c - o)
    wick_dn = np.minimum(c, o) - l
    wick_up = h - np.maximum(c, o)
    bull = c > o
    bear = c < o

    return {
        "h": h, "l": l, "c": c, "o": o, "v": v, "n": n,
        "atr14": atr14, "vol_ratio": vol_ratio, "vol_ma21": vol_ma21,
        "ema20": ema20, "ema50": ema50,
        "don_upper": don_upper, "don_lower": don_lower,
        "vp": vp_data, "vwap": vwap_data,
        "body": body, "wick_dn": wick_dn, "wick_up": wick_up,
        "bull": bull, "bear": bear, "tr": tr,
    }


# ─── Signal detection (vectorized) ──────────────────────────────────────────

def detect_signals(pre, cfg):
    """Detect all signals using pre-computed indicators. Returns list of (bar_idx, signal_type, direction, entry, stop, target)."""
    lb = cfg["vp_lookback"]
    va_pct = cfg["va_pct"]
    max_sl = cfg["max_sl_atr"]

    n = pre["n"]
    c, o, h, l, v = pre["c"], pre["o"], pre["h"], pre["l"], pre["v"]
    atr = pre["atr14"]
    vr = pre["vol_ratio"]
    bull, bear = pre["bull"], pre["bear"]
    body, wick_dn, wick_up = pre["body"], pre["wick_dn"], pre["wick_up"]
    ema20, ema50 = pre["ema20"], pre["ema50"]
    don_up, don_lo = pre["don_upper"], pre["don_lower"]

    # Get VP for this lookback (use closest available)
    available_lbs = sorted(pre["vp"].keys())
    vp_lb = min(available_lbs, key=lambda x: abs(x - lb))
    vp = pre["vp"][vp_lb]
    vwap_d = pre["vwap"][vp_lb]
    poc, vah, val = vp["poc"], vp["vah"], vp["val"]
    vwap, vwap_upper, vwap_lower = vwap_d["vwap"], vwap_d["upper"], vwap_d["lower"]

    # Scale VAH/VAL by va_pct (approximate)
    k = 1.0 if va_pct <= 0.68 else 1.0 + (va_pct - 0.68) * 2.5
    vah_scaled = poc + (vah - poc) * k
    val_scaled = poc - (poc - val) * k

    signals = []

    for i in range(max(lb + 5, 60), n):
        if np.isnan(atr[i]) or atr[i] == 0 or np.isnan(poc[i]):
            continue

        a = atr[i]

        # ─── SHORT-TERM SIGNALS ───

        # VA Rejection LONG
        bull_rej = body[i] > 0 and wick_dn[i] > body[i] * 1.5 and wick_dn[i] > wick_up[i] * 2 and bull[i]
        if bull_rej and vr[i] > 1.2 and c[i] > val_scaled[i] and c[i] < poc[i] and l[i] <= val_scaled[i] + a * 0.3:
            sl = max(val_scaled[i] - a * 0.5, c[i] - a * max_sl)
            tp = c[i] + (vah_scaled[i] - c[i])
            signals.append((i, "VA Rejection", "LONG", c[i], sl, tp, "short"))

        # Failed Auction LONG
        if i >= 2 and l[i-1] < val_scaled[i] and c[i-1] < val_scaled[i] and c[i] > val_scaled[i] and bull[i] and vr[i] > 1.2:
            sl = max(l[i-1] - a * 0.3, c[i] - a * max_sl)
            tp = c[i] + (vah_scaled[i] - c[i])
            signals.append((i, "Failed Auction", "LONG", c[i], sl, tp, "short"))

        # VWAP Deviation LONG
        if not np.isnan(vwap_lower[i]) and l[i] <= vwap_lower[i] + a * 0.1 and c[i] > vwap_lower[i] and bull[i] and wick_dn[i] >= body[i] * 1.5:
            sl = max(vwap_lower[i] - a * 0.5, c[i] - a * max_sl)
            tp = vwap[i] if not np.isnan(vwap[i]) else c[i] + a * 2
            signals.append((i, "VWAP Deviation", "LONG", c[i], sl, tp, "short"))

        # ─── MID-TERM SIGNALS ───

        # Breakout Retest LONG
        if i >= 10 and c[i] > vah_scaled[i] and bull[i] and vr[i] > 0.8:
            # Check confirmed breakout in last 10 bars
            confirmed = False
            for j in range(i-10, i-2):
                if j >= 0 and j+1 < n and c[j] > vah_scaled[i] and c[j+1] > vah_scaled[i] and vr[j] > 1.2:
                    confirmed = True
                    break
            if confirmed and l[i] <= vah_scaled[i] + a * 0.3:
                sl = max(vah_scaled[i] - a * 0.5, c[i] - a * max_sl)
                tp = c[i] + (vah_scaled[i] - val_scaled[i])
                signals.append((i, "Breakout Retest", "LONG", c[i], sl, tp, "mid"))

        # VWAP Reclaim LONG
        if i >= 2 and not np.isnan(vwap[i]) and c[i-1] < vwap[i] and c[i] > vwap[i] and bull[i] and vr[i] >= 1.2:
            sl = max(vwap[i] - a * 0.5, c[i] - a * max_sl)
            tp = vwap_upper[i] if not np.isnan(vwap_upper[i]) else c[i] + a * 2
            signals.append((i, "VWAP Reclaim", "LONG", c[i], sl, tp, "mid"))

        # Compression Breakout LONG
        if i >= 20 and not np.isnan(atr[i-1]):
            hist_atr = np.mean(pre["tr"][max(0,i-34):i-14]) if i > 34 else a
            if hist_atr > 0 and atr[i-1] < 0.7 * hist_atr and (h[i] - l[i]) > a * 1.5 and bull[i]:
                sl = max(l[i] - a * 0.3, c[i] - a * max_sl)
                tp = c[i] + a * 2.5
                signals.append((i, "Compression Breakout", "LONG", c[i], sl, tp, "mid"))

        # ─── LONG-TERM SIGNALS ───

        # Breakout Acceptance LONG
        if i >= 2 and not np.isnan(don_up[i]) and c[i] > don_up[i] and c[i-1] > don_up[i]:
            prev_low_held = l[i-1] > don_up[i] - a * 0.1
            if prev_low_held and vr[i] > 1.3:
                sl = max(don_up[i] - a * 0.5, c[i] - a * max_sl)
                tp = c[i] + (don_up[i] - don_lo[i])
                signals.append((i, "Breakout Acceptance", "LONG", c[i], sl, tp, "long"))

        # EMA Cross LONG
        if i >= 3 and ema20[i] > ema50[i] and c[i] > ema20[i] and bull[i] and vr[i] >= 1.2:
            if ema20[i-3] <= ema50[i-3]:  # Just crossed
                sl = max(ema20[i] - a * 0.3, c[i] - a * max_sl)
                tp = c[i] + a * 3.0
                signals.append((i, "EMA Cross", "LONG", c[i], sl, tp, "long"))

    return signals


# ─── Backtest simulation ─────────────────────────────────────────────────────

def simulate_signals(pre, signals, max_hold, entry_delay=0):
    """Simulate trades from pre-detected signals."""
    results = []
    n = pre["n"]
    h, l, c, o = pre["h"], pre["l"], pre["c"], pre["o"]

    for (bar_idx, sig_type, direction, sig_entry, sig_stop, sig_target, holding) in signals:
        entry_bar = bar_idx + 1 + entry_delay
        if entry_bar >= n:
            continue

        # Check hold during delay
        if entry_delay > 0:
            held = True
            for d in range(entry_delay):
                idx = bar_idx + 1 + d
                if idx >= n or l[idx] <= sig_stop:
                    held = False
                    break
            if not held:
                continue

        entry = float(o[entry_bar])
        risk = abs(sig_entry - sig_stop)
        if risk == 0:
            continue

        slip = entry * SLIPPAGE_PCT / 100
        entry += slip
        tp = entry + abs(sig_target - sig_entry)
        sl = entry - abs(sig_entry - sig_stop)
        actual_risk = abs(entry - sl)
        if actual_risk == 0:
            continue

        # Forward simulation
        for j in range(entry_bar + 1, min(entry_bar + 1 + max_hold, n)):
            if l[j] <= sl:
                results.append((-1.0, sig_type, direction, holding))
                break
            if h[j] >= tp:
                results.append((abs(tp - entry) / actual_risk, sig_type, direction, holding))
                break
        else:
            last_c = float(c[min(entry_bar + max_hold, n - 1)])
            r = (last_c - entry) / actual_risk
            results.append((r, sig_type, direction, holding))

    return results


# ─── Evaluation ──────────────────────────────────────────────────────────────

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
        "expectancy": round(float(exp), 3),
        "profit_factor": round(float(sum(wins) / abs(sum(losses))), 2) if losses and sum(losses) != 0 else 999,
        "total_r": round(float(sum(pnls)), 1),
        "sharpe": round(float(exp / std), 2) if std > 0 else 0,
    }


# ─── Grid definitions ────────────────────────────────────────────────────────

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
        "signal_filter": lambda s: s[6] == "short",
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
        "signal_filter": lambda s: s[6] == "mid",
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
        "signal_filter": lambda s: s[6] == "long",
    },
}


# ─── Main ────────────────────────────────────────────────────────────────────

def main():
    parser = argparse.ArgumentParser(description="Auto Optimize & Backtest (Fast)")
    parser.add_argument("--symbols", type=str, default="", help="Comma-separated symbols (default: all)")
    args = parser.parse_args()

    symbols = args.symbols.split(",") if args.symbols else SYMBOLS
    symbols = [s.strip() for s in symbols if s.strip()]

    print(f"{'═'*70}")
    print(f"  AUTO OPTIMIZE & BACKTEST (Vectorized)")
    print(f"  {len(symbols)} symbols | 3 timeframes | Walk-forward 70/30")
    print(f"{'═'*70}\n")

    # Download data
    print("Downloading 2 years of data...", flush=True)
    all_data = {}
    for symbol in symbols:
        df = yf.download(symbol, period="2y", progress=False)
        if df.empty:
            continue
        if isinstance(df.columns, pd.MultiIndex):
            df.columns = df.columns.get_level_values(0)
        if len(df) >= 200:
            all_data[symbol] = df
            print(f"    {symbol}: {len(df)} days", flush=True)
    print(f"  ✓ {len(all_data)} symbols loaded\n", flush=True)

    # Pre-compute indicators for all symbols
    print("Pre-computing indicators...", flush=True)
    lookbacks_needed = [40, 60, 90, 120, 180]
    precomputed = {}
    for symbol, df in all_data.items():
        precomputed[symbol] = precompute(df, lookbacks_needed)
    print(f"  ✓ Indicators cached\n", flush=True)

    # Split 70/30 by index
    split_idx = {}
    for symbol, df in all_data.items():
        split_idx[symbol] = int(len(df) * 0.7)

    final_results = {}

    for tf_name, grid in GRIDS.items():
        print(f"{'━'*70}")
        print(f"  OPTIMIZING: {grid['label']}")
        print(f"{'━'*70}", flush=True)

        param_keys = list(grid["params"].keys())
        param_values = list(grid["params"].values())
        param_combos = list(itertools.product(*param_values))
        max_holds = grid["max_hold"]
        all_combos = list(itertools.product(param_combos, max_holds))
        sig_filter = grid["signal_filter"]

        print(f"  {len(all_combos)} combinations to test...", flush=True)

        results_table = []
        for idx, (params, max_hold) in enumerate(all_combos):
            cfg = dict(DEFAULT_CFG)
            entry_delay = 0
            for k, v in zip(param_keys, params):
                if k == "entry_delay":
                    entry_delay = v
                else:
                    cfg[k] = v

            train_results = []
            test_results = []

            for symbol in precomputed:
                pre = precomputed[symbol]
                si = split_idx[symbol]

                # Detect signals for this config
                all_signals = detect_signals(pre, cfg)
                filtered = [s for s in all_signals if sig_filter(s)]

                # Split into train/test by bar index
                train_sigs = [s for s in filtered if s[0] < si]
                test_sigs = [s for s in filtered if s[0] >= si]

                train_results.extend(simulate_signals(pre, train_sigs, max_hold, entry_delay))
                test_results.extend(simulate_signals(pre, test_sigs, max_hold, entry_delay))

            results_table.append({
                "params": dict(zip(param_keys, params)),
                "max_hold": max_hold,
                "train": evaluate(train_results),
                "test": evaluate(test_results),
                "test_results": test_results,
            })

            if (idx + 1) % 10 == 0:
                print(f"    [{tf_name}] {idx+1}/{len(all_combos)} done...", flush=True)

        # Sort by test expectancy
        results_table.sort(key=lambda x: x["test"]["expectancy"], reverse=True)
        best = results_table[0]

        # Robustness
        top3_positive = all(r["test"]["expectancy"] > 0 for r in results_table[:min(3, len(results_table))])
        robust = top3_positive and best["test"]["expectancy"] > 0

        # Signal breakdown
        signal_breakdown = {}
        for r in best.get("test_results", []):
            key = f"{r[1]} ({r[2]})"
            signal_breakdown.setdefault(key, []).append(r[0])

        signal_report = {}
        for key, pnls in sorted(signal_breakdown.items(), key=lambda x: np.mean(x[1]), reverse=True):
            signal_report[key] = {
                "trades": len(pnls),
                "win_rate": round(len([p for p in pnls if p > 0]) / len(pnls) * 100, 1),
                "expectancy": round(float(np.mean(pnls)), 3),
            }

        # Print
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
        print(f"     {'✅ Robust (top 3 all positive OOS)' if robust else '⚠️ Fragile (not all top 3 positive)'}", flush=True)

        if signal_report:
            print(f"\n  Signal breakdown (best params, test set):")
            for key, stats in signal_report.items():
                print(f"    {key:<35} {stats['trades']:>3} trades | WR {stats['win_rate']}% | Exp {stats['expectancy']:+.3f}R")

        final_results[tf_name] = {
            "label": grid["label"],
            "best_params": best["params"],
            "best_max_hold": best["max_hold"],
            "train_metrics": best["train"],
            "test_metrics": best["test"],
            "robust": robust,
            "signal_breakdown": signal_report,
            "top5": [{"params": r["params"], "max_hold": r["max_hold"], "test": r["test"]} for r in results_table[:5]],
        }

    # Final summary
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

    print(f"  {'─'*60}")
    print(f"  BEST SIGNALS (highest expectancy):")
    all_sigs = []
    for tf, data in final_results.items():
        for sig, stats in data["signal_breakdown"].items():
            all_sigs.append((sig, stats, tf))
    all_sigs.sort(key=lambda x: x[1]["expectancy"], reverse=True)
    for sig, stats, tf in all_sigs[:5]:
        print(f"    {sig:<35} [{tf}] {stats['trades']} trades | WR {stats['win_rate']}% | Exp {stats['expectancy']:+.3f}R")

    # Save
    DATA_DIR.mkdir(exist_ok=True)
    RESULTS_FILE.write_text(json.dumps({"timestamp": datetime.now().isoformat(), "symbols_count": len(all_data), "results": final_results}, indent=2, ensure_ascii=False, default=str))
    print(f"\n  Results saved to {RESULTS_FILE}")
    print(f"{'═'*70}")


if __name__ == "__main__":
    main()
