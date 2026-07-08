"""
Multi-Strategy Scanner — scans all symbols, scores each signal independently.

Usage:
  python scan_all.py            # scan + Telegram
  python scan_all.py --dry-run  # scan + print only (no Telegram)
"""

import sys
import json
from datetime import datetime, timezone, timedelta
from pathlib import Path

from config import SYMBOLS, DEFAULT_CFG
from core.data_provider import YahooProvider
from core.market_context import fetch_market_context
from core.indicators import calc_atr, determine_bias
from regime.engine import detect_regime, get_active_strategies
from strategies.vp_signals import VPSignals
from strategies.vwap_signals import VWAPSignals
from strategies.trend_signals import TrendSignals
from scoring.quality import score_signal
from scoring.holding import estimate_holding
from notifications.telegram import send_telegram

DRY_RUN = "--dry-run" in sys.argv
DATA_DIR = Path(__file__).parent / "data"
RESULTS_FILE = DATA_DIR / "scan_results.json"
ET = timezone(timedelta(hours=-4))

STRATEGIES = [VPSignals(), VWAPSignals(), TrendSignals()]


def scan_symbol(symbol, df, cfg, market_ctx):
    """Run regime detection + strategies + quality scoring on one symbol."""
    if df is None or len(df) < cfg["vp_lookback"] + 10:
        return None

    df.attrs["symbol"] = symbol

    # 1. Regime detection (still used for strategy activation)
    regime_state = detect_regime(df, cfg, market_ctx)
    active = get_active_strategies(regime_state)

    # 2. Direction bias (new)
    bias_info = determine_bias(df)

    # 3. Collect signals from active strategies
    all_signals = []
    for strategy in STRATEGIES:
        if strategy.name not in active:
            continue
        try:
            sigs = strategy.detect(df, cfg, market_ctx)
            all_signals.extend(sigs)
        except Exception:
            pass

    # 4. Score each signal independently
    scored_signals = []
    for sig in all_signals:
        if not sig.triggered or sig.direction in ("WARNING", "NEUTRAL"):
            continue

        scoring = score_signal(sig, df, bias_info)

        # Holding estimate
        atr = calc_atr(df, cfg["atr_len"]) or 0
        atr_avg = atr
        if len(df) > 40:
            h, l, c = df["High"].values, df["Low"].values, df["Close"].values
            trs = []
            for i in range(-20, 0):
                if abs(i) < len(df):
                    trs.append(max(h[i] - l[i], abs(h[i] - c[i - 1]),
                                   abs(l[i] - c[i - 1])))
            atr_avg = sum(trs) / len(trs) if trs else atr

        holding = estimate_holding(sig, atr, atr_avg, market_ctx.get("vix"))

        scored_signals.append({
            "ticker": symbol,
            "signal_type": sig.signal_type,
            "strategy": sig.strategy,
            "direction": sig.direction,
            "quality": scoring["quality"],
            "direction_fit": scoring["direction_fit"],
            "rr": scoring["rr"],
            "rank": scoring["rank"],
            "label": scoring["label"],
            "entry": round(sig.entry, 2),
            "stop": round(sig.stop, 2),
            "target": round(sig.target, 2),
            "holding": holding.range_str,
            "holding_days": holding.days,
            "holding_type": sig.holding_type,
            "regime": regime_state.regime,
            "bias": bias_info["bias"],
            "bias_strength": bias_info["strength"],
            "reasons": sig.reasons,
            "warnings": sig.warnings,
        })

    # Return best signal for this symbol (highest rank), plus all signals
    if not scored_signals:
        return None

    scored_signals.sort(key=lambda x: x["rank"], reverse=True)
    best = scored_signals[0]

    return {
        "ticker": symbol,
        "score": best["quality"],
        "quality": best["quality"],
        "direction": best["direction"],
        "label": best["label"],
        "setup": best["signal_type"],
        "regime": best["regime"],
        "rr": best["rr"],
        "rank": best["rank"],
        "holding": best["holding"],
        "holding_days": best["holding_days"],
        "holding_timeframe": best["holding_type"],
        "bias": best["bias"],
        "bias_strength": best["bias_strength"],
        "direction_fit": best["direction_fit"],
        "signals": scored_signals,
    }


def main():
    cfg = DEFAULT_CFG
    now = datetime.now(ET)
    print(f"[{now.strftime('%Y-%m-%d %H:%M')} ET] Scanning {len(SYMBOLS)} symbols...")

    print("  Fetching market context...")
    market_ctx = fetch_market_context(cfg)

    # Download data
    provider = YahooProvider(max_workers=5, jitter=(0.1, 0.3))
    print("  Downloading market data...")
    data = provider.batch_daily(SYMBOLS, period="1y")
    print(f"  Downloaded {len(data)}/{len(SYMBOLS)} symbols")

    # Scan each symbol
    results = []
    for symbol in SYMBOLS:
        df = data.get(symbol)
        if symbol == "SPY" and market_ctx.get("spy_df") is not None:
            df = market_ctx["spy_df"]
        try:
            r = scan_symbol(symbol, df, cfg, market_ctx)
            if r:
                results.append(r)
        except Exception as e:
            print(f"  Error scanning {symbol}: {e}")

    # Sort by rank descending (quality × direction_fit × R:R)
    results.sort(key=lambda x: x["rank"], reverse=True)

    # Save JSON
    DATA_DIR.mkdir(exist_ok=True)
    output = {
        "scan_time": now.isoformat(),
        "market_ctx": {
            "vix": market_ctx.get("vix"),
            "spy_state": market_ctx.get("spy_state"),
            "sector_momentum": market_ctx.get("sector_momentum", {}),
        },
        "total_symbols": len(SYMBOLS),
        "signals_found": sum(1 for r in results if r["quality"] >= 45),
        "results": results,
    }
    RESULTS_FILE.write_text(json.dumps(output, indent=2, ensure_ascii=False))
    print(f"  Results saved to {RESULTS_FILE}")

    # Format and send Telegram
    actionable = [r for r in results if r["quality"] >= 45]
    msg = f"<b>📊 Multi-Strategy Scan — {now.strftime('%Y-%m-%d %H:%M')} ET</b>\n"
    msg += f"Scanned {len(SYMBOLS)} symbols | Signals: {len(actionable)}\n"
    if market_ctx.get("vix"):
        vix = market_ctx["vix"]
        emoji = "🟢" if vix < 15 else "🟡" if vix < 25 else "🔴"
        msg += f"{emoji} VIX: {vix:.1f} | SPY: {market_ctx.get('spy_state', '?')}\n"
    msg += "\n"

    for r in actionable[:10]:  # Top 10
        emoji = "🟢" if r["direction"] == "LONG" else "🔴"
        bias_arrow = "↑" if r["bias"] == "BULL" else "↓" if r["bias"] == "BEAR" else "→"
        msg += f"{emoji} <b>{r['ticker']}</b> — {r['label']} (Q:{r['quality']})\n"
        msg += f"   {r['setup']} | R:R {r['rr']:.1f} | Rank {r['rank']:.2f}\n"
        msg += f"   Hold: {r['holding']} | Bias: {bias_arrow}{r['bias']}({r['bias_strength']})\n"
        if r.get("warnings"):
            msg += f"   ⚠️ {r['warnings'][0]}\n"
        msg += "\n"

    if not actionable:
        msg += "✅ No actionable signals today.\n"

    send_telegram(msg, dry_run=DRY_RUN)
    if DRY_RUN:
        print("\n" + msg)

    print(f"\nDone. {len(actionable)} actionable signals (quality ≥ 45).")


if __name__ == "__main__":
    main()
