"""
TP/SL ratio analysis — test different exit strategies.
Generates signals once, then simulates multiple exit approaches.

Usage:
    python analyze_exits.py [--symbols NVDA,AAPL] [--days 365]
"""

import argparse
import yfinance as yf
import pandas as pd
import numpy as np

from config import SYMBOLS, DEFAULT_CFG
from core.indicators import calc_atr
from strategies.vp_signals import VPSignals


def collect_trades(symbols, cfg, days=365):
    """Generate signals and store raw forward price data for each."""
    strategy = VPSignals()
    trades = []

    for symbol in symbols:
        total_days = days + cfg["vp_lookback"] + 30
        df = yf.download(symbol, period=f"{total_days}d", progress=False)
        if df.empty or len(df) < cfg["vp_lookback"] + 50:
            continue
        if isinstance(df.columns, pd.MultiIndex):
            df.columns = df.columns.get_level_values(0)
        df.attrs["symbol"] = symbol

        start_idx = cfg["vp_lookback"] + 20
        end_idx = len(df)

        for i in range(start_idx, end_idx):
            window = df.iloc[:i + 1].copy()
            window.attrs["symbol"] = symbol
            signals = strategy.detect(window, cfg, market_ctx=None)

            for sig in signals:
                if sig.direction == "WARNING" or i + 1 >= end_idx:
                    continue

                atr = calc_atr(window, cfg["atr_len"])
                if not atr or atr == 0:
                    continue

                entry = float(df.iloc[i + 1]["Open"])
                # Store next 15 days of OHLC for simulation
                forward = []
                for j in range(i + 2, min(i + 17, end_idx)):
                    forward.append({
                        "h": float(df.iloc[j]["High"]),
                        "l": float(df.iloc[j]["Low"]),
                        "c": float(df.iloc[j]["Close"]),
                    })

                if not forward:
                    continue

                trades.append({
                    "symbol": symbol,
                    "direction": sig.direction,
                    "signal": sig.strategy,
                    "entry": entry,
                    "atr": atr,
                    "orig_tp": sig.tp,
                    "orig_sl": sig.sl,
                    "forward": forward,
                })

        print(f"  {symbol}: done")

    return trades


def simulate_exit(trades, tp_atr, sl_atr, max_hold):
    """Simulate fixed ATR-based TP/SL."""
    pnls = []
    for t in trades:
        entry, atr, direction = t["entry"], t["atr"], t["direction"]
        tp = entry + atr * tp_atr if direction == "LONG" else entry - atr * tp_atr
        sl = entry - atr * sl_atr if direction == "LONG" else entry + atr * sl_atr
        risk = atr * sl_atr

        for j, bar in enumerate(t["forward"][:max_hold]):
            if direction == "LONG":
                if bar["l"] <= sl:
                    pnls.append(-1.0)
                    break
                if bar["h"] >= tp:
                    pnls.append(tp_atr / sl_atr)
                    break
            else:
                if bar["h"] >= sl:
                    pnls.append(-1.0)
                    break
                if bar["l"] <= tp:
                    pnls.append(tp_atr / sl_atr)
                    break
        else:
            last_c = t["forward"][min(max_hold - 1, len(t["forward"]) - 1)]["c"]
            if direction == "LONG":
                pnls.append((last_c - entry) / risk)
            else:
                pnls.append((entry - last_c) / risk)
    return pnls


def simulate_trailing(trades, tp_atr, sl_atr, trail_atr, max_hold):
    """Simulate with trailing stop: move SL to breakeven after 1R profit."""
    pnls = []
    for t in trades:
        entry, atr, direction = t["entry"], t["atr"], t["direction"]
        tp = entry + atr * tp_atr if direction == "LONG" else entry - atr * tp_atr
        sl = entry - atr * sl_atr if direction == "LONG" else entry + atr * sl_atr
        risk = atr * sl_atr
        current_sl = sl

        for j, bar in enumerate(t["forward"][:max_hold]):
            # Update trailing stop
            if direction == "LONG":
                if bar["h"] >= entry + atr * trail_atr:
                    current_sl = max(current_sl, entry)  # Move to breakeven
                if bar["l"] <= current_sl:
                    pnls.append((current_sl - entry) / risk)
                    break
                if bar["h"] >= tp:
                    pnls.append(tp_atr / sl_atr)
                    break
            else:
                if bar["l"] <= entry - atr * trail_atr:
                    current_sl = min(current_sl, entry)
                if bar["h"] >= current_sl:
                    pnls.append((entry - current_sl) / risk)
                    break
                if bar["l"] <= tp:
                    pnls.append(tp_atr / sl_atr)
                    break
        else:
            last_c = t["forward"][min(max_hold - 1, len(t["forward"]) - 1)]["c"]
            if direction == "LONG":
                pnls.append((last_c - entry) / risk)
            else:
                pnls.append((entry - last_c) / risk)
    return pnls


def simulate_partial(trades, tp1_atr, tp2_atr, sl_atr, max_hold):
    """Simulate partial exit: 50% at TP1, 50% at TP2."""
    pnls = []
    for t in trades:
        entry, atr, direction = t["entry"], t["atr"], t["direction"]
        tp1 = entry + atr * tp1_atr if direction == "LONG" else entry - atr * tp1_atr
        tp2 = entry + atr * tp2_atr if direction == "LONG" else entry - atr * tp2_atr
        sl = entry - atr * sl_atr if direction == "LONG" else entry + atr * sl_atr
        risk = atr * sl_atr

        hit_tp1 = False
        pnl = 0.0

        for j, bar in enumerate(t["forward"][:max_hold]):
            if direction == "LONG":
                if bar["l"] <= sl:
                    pnl += -0.5 if not hit_tp1 else 0  # Already took 50% at TP1
                    pnl += -0.5 if not hit_tp1 else -0.5
                    if hit_tp1:
                        pnl = (tp1_atr / sl_atr) * 0.5 - 0.5
                    else:
                        pnl = -1.0
                    break
                if not hit_tp1 and bar["h"] >= tp1:
                    hit_tp1 = True
                    sl = entry  # Move SL to breakeven for remaining
                if hit_tp1 and bar["h"] >= tp2:
                    pnl = (tp1_atr / sl_atr) * 0.5 + (tp2_atr / sl_atr) * 0.5
                    break
            else:
                if bar["h"] >= sl:
                    if hit_tp1:
                        pnl = (tp1_atr / sl_atr) * 0.5 - 0.5
                    else:
                        pnl = -1.0
                    break
                if not hit_tp1 and bar["l"] <= tp1:
                    hit_tp1 = True
                    sl = entry
                if hit_tp1 and bar["l"] <= tp2:
                    pnl = (tp1_atr / sl_atr) * 0.5 + (tp2_atr / sl_atr) * 0.5
                    break
        else:
            last_c = t["forward"][min(max_hold - 1, len(t["forward"]) - 1)]["c"]
            if hit_tp1:
                r2 = (last_c - entry) / risk if direction == "LONG" else (entry - last_c) / risk
                pnl = (tp1_atr / sl_atr) * 0.5 + r2 * 0.5
            else:
                r = (last_c - entry) / risk if direction == "LONG" else (entry - last_c) / risk
                pnl = r

        pnls.append(pnl)
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
    parser = argparse.ArgumentParser(description="TP/SL Exit Analysis")
    parser.add_argument("--symbols", type=str, default="")
    parser.add_argument("--days", type=int, default=365)
    args = parser.parse_args()

    symbols = args.symbols.split(",") if args.symbols else SYMBOLS
    symbols = [s.strip() for s in symbols if s.strip()]

    print(f"TP/SL Exit Analysis — {len(symbols)} symbols, {args.days} days")
    print(f"{'─'*70}\n")

    trades = collect_trades(symbols, DEFAULT_CFG, days=args.days)
    print(f"\nTotal signals: {len(trades)}\n")

    if not trades:
        print("❌ No trades.")
        return

    results = []

    # === Fixed R:R ratios ===
    print("Testing fixed ATR-based TP/SL...")
    for tp_atr in [1.0, 1.5, 2.0, 2.5, 3.0, 4.0, 5.0]:
        for sl_atr in [0.5, 1.0, 1.5, 2.0]:
            rr = tp_atr / sl_atr
            pnls = simulate_exit(trades, tp_atr, sl_atr, max_hold=10)
            results.append(evaluate(pnls, f"Fixed TP={tp_atr} SL={sl_atr} (R:R=1:{rr:.1f})"))

    # === Trailing stop ===
    print("Testing trailing stop...")
    for tp_atr in [2.0, 3.0, 4.0]:
        for sl_atr in [1.0, 1.5]:
            for trail in [1.0, 1.5]:
                pnls = simulate_trailing(trades, tp_atr, sl_atr, trail, max_hold=10)
                results.append(evaluate(pnls, f"Trail TP={tp_atr} SL={sl_atr} trail@{trail}ATR"))

    # === Partial exit ===
    print("Testing partial exit...")
    for tp1 in [1.0, 1.5]:
        for tp2 in [2.5, 3.0, 4.0]:
            for sl_atr in [1.0, 1.5]:
                pnls = simulate_partial(trades, tp1, tp2, sl_atr, max_hold=10)
                results.append(evaluate(pnls, f"Partial 50%@{tp1}+50%@{tp2} SL={sl_atr}"))

    # === Original strategy TP/SL ===
    orig_pnls = []
    for t in trades:
        entry = t["entry"]
        tp, sl = t["orig_tp"], t["orig_sl"]
        # Adjust for next-day open
        if t["direction"] == "LONG":
            tp = entry + (t["orig_tp"] - entry)
            sl = entry - abs(entry - t["orig_sl"])
        else:
            tp = entry - abs(entry - t["orig_tp"])
            sl = entry + abs(t["orig_sl"] - entry)
        risk = abs(entry - sl)
        if risk == 0:
            continue
        for bar in t["forward"][:10]:
            if t["direction"] == "LONG":
                if bar["l"] <= sl:
                    orig_pnls.append(-1.0)
                    break
                if bar["h"] >= tp:
                    orig_pnls.append((tp - entry) / risk)
                    break
            else:
                if bar["h"] >= sl:
                    orig_pnls.append(-1.0)
                    break
                if bar["l"] <= tp:
                    orig_pnls.append((entry - tp) / risk)
                    break
        else:
            last_c = t["forward"][min(9, len(t["forward"]) - 1)]["c"]
            r = (last_c - entry) / risk if t["direction"] == "LONG" else (entry - last_c) / risk
            orig_pnls.append(r)
    results.insert(0, evaluate(orig_pnls, "★ CURRENT (original TP/SL)"))

    # Sort by expectancy
    results.sort(key=lambda x: x["exp"], reverse=True)

    # Print
    print(f"\n{'='*75}")
    print(f"  EXIT STRATEGY ANALYSIS (sorted by expectancy)")
    print(f"{'='*75}")
    print(f"  {'Strategy':<42} | {'N':>5} {'WR':>6} {'Exp':>7} {'PF':>6}")
    print(f"  {'─'*42} | {'─'*5} {'─'*6} {'─'*7} {'─'*6}")

    for r in results[:25]:
        marker = "→" if "CURRENT" in r["label"] else " "
        print(f" {marker}{r['label']:<42} | {r['n']:>5} {r['wr']:>5.1f}% {r['exp']:>+6.2f}R {r['pf']:>5.2f}")

    # Best
    best = results[0]
    current = next(r for r in results if "CURRENT" in r["label"])
    print(f"\n{'─'*75}")
    print(f"  ★ CURRENT:  {current['n']} trades | WR {current['wr']:.1f}% | Exp {current['exp']:+.2f}R | PF {current['pf']:.2f}")
    print(f"  ✅ BEST:     {best['label']}")
    print(f"              {best['n']} trades | WR {best['wr']:.1f}% | Exp {best['exp']:+.2f}R | PF {best['pf']:.2f}")
    improvement = best["exp"] - current["exp"]
    print(f"  📈 Improvement: {improvement:+.2f}R per trade")
    print(f"{'='*75}")


if __name__ == "__main__":
    main()
