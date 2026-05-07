"""
Filter analysis — quantify the impact of each filter on strategy performance.
Runs backtest multiple times with different filter combinations.

Usage:
    python analyze_filters.py [--symbols NVDA,AAPL] [--days 365]
"""

import argparse
import yfinance as yf
import pandas as pd
import numpy as np

from config import SYMBOLS, DEFAULT_CFG, SECTOR_MAP
from core.indicators import calc_vp, calc_atr
from core.market_context import fetch_market_context
from scoring.confidence import score_signal, calc_stock_factors
from strategies.vp_signals import VPSignals


def run_with_filters(symbols, cfg, days=365, max_hold=10):
    """Generate all signals with full metadata for filter analysis."""
    strategy = VPSignals()
    market_ctx = fetch_market_context(cfg)
    all_trades = []

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
                if sig.direction == "WARNING":
                    continue
                if i + 1 >= end_idx:
                    continue

                # Score
                factors = calc_stock_factors(window, symbol, cfg, market_ctx)
                sector_etf = SECTOR_MAP.get(symbol, "QQQ")
                score, details = score_signal(sig.direction, sig.strategy, factors, market_ctx, sector_etf, False)

                trend = factors.get("inst_trend", "NEUTRAL")
                regime = factors.get("regime", "Unknown")
                vol_ratio = factors.get("vol_ratio", 0)

                # Simulate trade with next-day open
                entry = float(df.iloc[i + 1]["Open"])
                tp = entry + (sig.tp - sig.entry) if sig.direction == "LONG" else entry - (sig.entry - sig.tp)
                sl = entry - (sig.entry - sig.sl) if sig.direction == "LONG" else entry + (sig.sl - sig.entry)
                risk = abs(entry - sl)
                if risk == 0:
                    continue

                # Track outcome
                pnl_r = 0.0
                for j in range(i + 2, min(i + 2 + max_hold, end_idx)):
                    h, l = df.iloc[j]["High"], df.iloc[j]["Low"]
                    if sig.direction == "LONG":
                        if l <= sl:
                            pnl_r = -1.0
                            break
                        if h >= tp:
                            pnl_r = (tp - entry) / risk
                            break
                    else:
                        if h >= sl:
                            pnl_r = -1.0
                            break
                        if l <= tp:
                            pnl_r = (entry - tp) / risk
                            break
                else:
                    last_c = float(df.iloc[min(i + 1 + max_hold, end_idx - 1)]["Close"])
                    pnl_r = (last_c - entry) / risk if sig.direction == "LONG" else (entry - last_c) / risk

                all_trades.append({
                    "symbol": symbol,
                    "direction": sig.direction,
                    "signal": sig.strategy,
                    "score": score,
                    "trend": trend,
                    "regime": regime,
                    "vol_ratio": vol_ratio,
                    "pnl_r": pnl_r,
                })

        print(f"  {symbol}: done")

    return all_trades


def evaluate(trades, label):
    """Calculate metrics for a subset of trades."""
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
    parser = argparse.ArgumentParser(description="Filter Analysis")
    parser.add_argument("--symbols", type=str, default="")
    parser.add_argument("--days", type=int, default=365)
    args = parser.parse_args()

    symbols = args.symbols.split(",") if args.symbols else SYMBOLS
    symbols = [s.strip() for s in symbols if s.strip()]

    print(f"Filter Analysis — {len(symbols)} symbols, {args.days} days")
    print(f"{'─'*70}\n")

    trades = run_with_filters(symbols, DEFAULT_CFG, days=args.days)
    print(f"\nTotal raw signals: {len(trades)}\n")

    if not trades:
        print("❌ No trades generated.")
        return

    # Define filter groups
    results = []

    # === INDIVIDUAL FILTERS ===

    # A: Baseline (no filter)
    results.append(evaluate(trades, "A: 無篩選（全部信號）"))

    # Score tiers
    results.append(evaluate([t for t in trades if t["score"] >= 2], "B1: Score ≥ 2"))
    results.append(evaluate([t for t in trades if t["score"] >= 3], "B2: Score ≥ 3"))
    results.append(evaluate([t for t in trades if t["score"] >= 4], "B3: Score ≥ 4"))
    results.append(evaluate([t for t in trades if t["score"] == 5], "B4: Score = 5"))

    # Trend filter
    trend_ok = [t for t in trades if not (
        (t["direction"] == "LONG" and t["trend"] == "BEARISH") or
        (t["direction"] == "SHORT" and t["trend"] == "BULLISH")
    )]
    results.append(evaluate(trend_ok, "C: 順趨勢（過濾逆勢）"))
    results.append(evaluate([t for t in trades if t["trend"] == "BULLISH" and t["direction"] == "LONG"], "C2: BULLISH+LONG"))
    results.append(evaluate([t for t in trades if t["trend"] == "BEARISH" and t["direction"] == "SHORT"], "C3: BEARISH+SHORT"))
    results.append(evaluate([t for t in trades if t["trend"] == "NEUTRAL"], "C4: NEUTRAL only"))

    # Regime
    results.append(evaluate([t for t in trades if t["regime"] == "Range"], "D1: Regime=Range"))
    results.append(evaluate([t for t in trades if t["regime"] == "Trend"], "D2: Regime=Trend"))
    results.append(evaluate([t for t in trades if t["regime"] == "Expansion"], "D3: Regime=Expansion"))

    # Volume ratio tiers
    results.append(evaluate([t for t in trades if t["vol_ratio"] > 1.2], "E1: 量能 > 1.2x"))
    results.append(evaluate([t for t in trades if t["vol_ratio"] > 1.5], "E2: 量能 > 1.5x"))
    results.append(evaluate([t for t in trades if t["vol_ratio"] > 2.0], "E3: 量能 > 2.0x"))
    results.append(evaluate([t for t in trades if t["vol_ratio"] > 2.5], "E4: 量能 > 2.5x"))
    results.append(evaluate([t for t in trades if 1.2 <= t["vol_ratio"] <= 1.5], "E5: 量能 1.2-1.5x"))
    results.append(evaluate([t for t in trades if 1.5 < t["vol_ratio"] <= 2.0], "E6: 量能 1.5-2.0x"))
    results.append(evaluate([t for t in trades if 2.0 < t["vol_ratio"] <= 3.0], "E7: 量能 2.0-3.0x"))
    results.append(evaluate([t for t in trades if t["vol_ratio"] > 3.0], "E8: 量能 > 3.0x"))

    # Direction
    results.append(evaluate([t for t in trades if t["direction"] == "LONG"], "F1: 只做多"))
    results.append(evaluate([t for t in trades if t["direction"] == "SHORT"], "F2: 只做空"))

    # Signal type
    results.append(evaluate([t for t in trades if "Rejection" in t["signal"]], "G1: VA Rejection"))
    results.append(evaluate([t for t in trades if "Failed" in t["signal"]], "G2: Failed Auction"))
    results.append(evaluate([t for t in trades if "Breakout" in t["signal"]], "G3: Breakout Retest"))

    # === COMBINATIONS ===

    # Score + Trend
    results.append(evaluate([t for t in trend_ok if t["score"] >= 3], "H1: Score≥3 + 順趨勢"))
    results.append(evaluate([t for t in trend_ok if t["score"] >= 4], "H2: Score≥4 + 順趨勢"))

    # Score + Volume
    results.append(evaluate([t for t in trades if t["score"] >= 3 and t["vol_ratio"] > 1.5], "H3: Score≥3 + 量能>1.5x"))
    results.append(evaluate([t for t in trades if t["score"] >= 3 and t["vol_ratio"] > 2.0], "H4: Score≥3 + 量能>2.0x"))
    results.append(evaluate([t for t in trades if t["score"] >= 4 and t["vol_ratio"] > 1.5], "H5: Score≥4 + 量能>1.5x"))

    # Score + Trend + Volume
    results.append(evaluate([t for t in trend_ok if t["score"] >= 3 and t["vol_ratio"] > 1.5], "H6: Score≥3 + 順趨勢 + 量能>1.5x"))
    results.append(evaluate([t for t in trend_ok if t["score"] >= 4 and t["vol_ratio"] > 1.5], "H7: Score≥4 + 順趨勢 + 量能>1.5x"))

    # Score + Regime
    results.append(evaluate([t for t in trades if t["score"] >= 3 and t["regime"] == "Range"], "H8: Score≥3 + Range"))
    results.append(evaluate([t for t in trades if t["score"] >= 3 and t["regime"] == "Trend"], "H9: Score≥3 + Trend"))

    # Triple: Score + Trend + Range
    results.append(evaluate([t for t in trend_ok if t["score"] >= 3 and t["regime"] == "Range"], "H10: Score≥3 + 順趨勢 + Range"))

    # Score + Trend + Volume + Range (max filter)
    results.append(evaluate([t for t in trend_ok if t["score"] >= 3 and t["vol_ratio"] > 1.5 and t["regime"] == "Range"], "H11: 全篩選(S3+趨勢+量1.5+Range)"))

    # Print report
    print(f"{'='*70}")
    print(f"  FILTER ANALYSIS REPORT")
    print(f"{'='*70}")
    print(f"  {'Filter':<30} | {'Trades':>6} {'WR':>7} {'Exp':>8} {'PF':>7}")
    print(f"  {'─'*30} | {'─'*6} {'─'*7} {'─'*8} {'─'*7}")

    baseline_exp = results[0]["exp"] if results[0]["n"] > 0 else 0

    for r in results:
        delta = ""
        if r["n"] > 0 and r["label"] != results[0]["label"]:
            diff = r["exp"] - baseline_exp
            delta = f" ({diff:+.2f})"
        print(f"  {r['label']:<30} | {r['n']:>6} {r['wr']:>6.1f}% {r['exp']:>+7.2f}R {r['pf']:>6.2f}{delta}")

    # Find best filter
    valid = [r for r in results if r["n"] >= 20]
    if valid:
        best = max(valid, key=lambda x: x["exp"])
        print(f"\n{'─'*70}")
        print(f"  ✅ BEST FILTER (min 20 trades): {best['label']}")
        print(f"     {best['n']} trades | WR {best['wr']:.1f}% | Exp {best['exp']:+.2f}R | PF {best['pf']:.2f}")
        print(f"{'='*70}")


if __name__ == "__main__":
    main()
