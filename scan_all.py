"""
Multi-Strategy Scanner — scans all symbols, fuses signals, outputs JSON.

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
from core.indicators import calc_atr
from regime.engine import detect_regime, get_active_strategies
from strategies.vp_signals import VPSignals
from strategies.vwap_signals import VWAPSignals
from strategies.trend_signals import TrendSignals
from scoring.fusion import fuse_signals
from scoring.holding import estimate_holding
from notifications.telegram import send_telegram

DRY_RUN = "--dry-run" in sys.argv
DATA_DIR = Path(__file__).parent / "data"
RESULTS_FILE = DATA_DIR / "scan_results.json"
ET = timezone(timedelta(hours=-4))

STRATEGIES = [VPSignals(), VWAPSignals(), TrendSignals()]
STRATEGY_MAP = {s.name: s for s in STRATEGIES}


def scan_symbol(symbol, df, cfg, market_ctx):
    """Run regime detection + active strategies on one symbol."""
    if df is None or len(df) < cfg["vp_lookback"] + 10:
        return None

    df.attrs["symbol"] = symbol
    regime_state = detect_regime(df, cfg, market_ctx)
    active = get_active_strategies(regime_state)

    all_signals = []
    for strategy in STRATEGIES:
        if strategy.name not in active:
            continue
        try:
            sigs = strategy.detect(df, cfg, market_ctx)
            all_signals.extend(sigs)
        except Exception:
            pass

    fusion = fuse_signals(all_signals, regime_state)

    # Holding estimate
    atr = calc_atr(df, cfg["atr_len"]) or 0
    atr_avg = atr
    if len(df) > 40:
        h, l, c = df["High"].values, df["Low"].values, df["Close"].values
        tr = max(h[-1] - l[-1], abs(h[-1] - c[-2]), abs(l[-1] - c[-2]))
        trs = []
        for i in range(-20, 0):
            if abs(i) < len(df):
                trs.append(max(h[i] - l[i], abs(h[i] - c[i-1]), abs(l[i] - c[i-1])))
        atr_avg = sum(trs) / len(trs) if trs else atr

    # Find the actual dominant StrategySignal for holding/rr
    dominant_sig = None
    if fusion.best_track != "—":
        best_track_result = fusion.tracks.get(fusion.best_track)
        if best_track_result:
            # Find matching signal
            for s in all_signals:
                if s.signal_type == best_track_result.main_signal and s.triggered:
                    dominant_sig = s
                    break

    holding = estimate_holding(dominant_sig, atr, atr_avg, market_ctx.get("vix"))
    rr = dominant_sig.rr_ratio if dominant_sig else 0.0

    return {
        "ticker": symbol,
        "score": fusion.best_score,
        "direction": fusion.direction,
        "label": fusion.label,
        "setup": fusion.best_setup,
        "regime": regime_state.regime,
        "rr": rr,
        "holding": holding.range_str,
        "holding_days": holding.days,
        "holding_timeframe": holding.timeframe,
        "holding_reasoning": holding.reasoning,
        "best_track": fusion.best_track,
        "cross_track_conflict": fusion.cross_track_conflict,
        "conflict_note": fusion.conflict_note,
        "tracks": {k: v.to_dict() for k, v in fusion.tracks.items()},
        "signals": [s.to_dict() for s in all_signals],
        "regime_trust": regime_state.normalized_trust,
    }


def main():
    cfg = DEFAULT_CFG
    now = datetime.now(ET)
    print(f"[{now.strftime('%Y-%m-%d %H:%M')} ET] Scanning {len(SYMBOLS)} symbols...")

    print("  Fetching market context...")
    market_ctx = fetch_market_context(cfg)

    # Download data with jitter
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

    # Sort by score descending
    results.sort(key=lambda x: x["score"], reverse=True)

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
        "signals_found": sum(1 for r in results if r["score"] >= 40),
        "results": results,
    }
    RESULTS_FILE.write_text(json.dumps(output, indent=2, ensure_ascii=False))
    print(f"  Results saved to {RESULTS_FILE}")

    # Format and send Telegram
    triggered = [r for r in results if r["score"] >= 40]
    msg = f"<b>📊 Multi-Strategy Scan — {now.strftime('%Y-%m-%d %H:%M')} ET</b>\n"
    msg += f"Scanned {len(SYMBOLS)} symbols | Signals: {len(triggered)}\n"
    if market_ctx.get("vix"):
        vix = market_ctx["vix"]
        emoji = "🟢" if vix < 15 else "🟡" if vix < 25 else "🔴"
        msg += f"{emoji} VIX: {vix:.1f} | SPY: {market_ctx.get('spy_state', '?')}\n"
    msg += "\n"

    for r in triggered[:10]:  # Top 10
        emoji = "🟢" if r["direction"] == "LONG" else "🔴" if r["direction"] == "SHORT" else "⚪"
        msg += f"{emoji} <b>{r['ticker']}</b> — {r['label']} ({r['score']}/100)\n"
        msg += f"   Setup: {r['setup']} | R:R {r['rr']:.1f} | Hold: {r['holding']}\n"
        msg += f"   Regime: {r['regime']} | {', '.join(f'{k}:{v:.0f}' for k,v in r['per_strategy'].items())}\n"
        if r["conflicts"]:
            msg += f"   ⚠️ Conflicts: {', '.join(r['conflicts'])}\n"
        msg += "\n"

    if not triggered:
        msg += "✅ No actionable signals today.\n"

    send_telegram(msg, dry_run=DRY_RUN)
    if DRY_RUN:
        print("\n" + msg)

    print(f"\nDone. {len(triggered)} actionable signals (score ≥ 40).")


if __name__ == "__main__":
    main()
