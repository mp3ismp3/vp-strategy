"""
Multi-Strategy Scanner — VP Multi-Timeframe Analysis.

Computes Volume Profile (POC/VAH/VAL) on Daily/Weekly/Monthly for all symbols.
Shows price position relative to value area on each timeframe.

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
from core.vp_multitf import compute_vp_multitf
from notifications.telegram import send_telegram
from notifications.teams import send_teams

DRY_RUN = "--dry-run" in sys.argv
DATA_DIR = Path(__file__).parent / "data"
RESULTS_FILE = DATA_DIR / "scan_results.json"
ET = timezone(timedelta(hours=-4))


def main():
    cfg = DEFAULT_CFG
    now = datetime.now(ET)
    print(f"[{now.strftime('%Y-%m-%d %H:%M')} ET] VP Multi-TF Scan — {len(SYMBOLS)} symbols...")

    print("  Fetching market context...")
    market_ctx = fetch_market_context(cfg)

    # Download data
    provider = YahooProvider(max_workers=5, jitter=(0.1, 0.3))
    print("  Downloading market data...")
    data = provider.batch_daily(SYMBOLS, period="1y")
    print(f"  Downloaded {len(data)}/{len(SYMBOLS)} symbols")

    # Compute VP multi-TF for each symbol
    vp_results = {}
    for symbol in SYMBOLS:
        df = data.get(symbol)
        if df is None or len(df) < 60:
            continue
        try:
            result = compute_vp_multitf(df, cfg["va_pct"])
            if result:
                vp_results[symbol] = result
        except Exception as e:
            print(f"  Error computing {symbol}: {e}")

    print(f"  Computed VP for {len(vp_results)}/{len(SYMBOLS)} symbols")

    # Save JSON
    DATA_DIR.mkdir(exist_ok=True)
    output = {
        "scan_time": now.isoformat(),
        "market_ctx": {
            "vix": market_ctx.get("vix"),
            "spy_state": market_ctx.get("spy_state"),
        },
        "total_symbols": len(SYMBOLS),
        "vp_data": vp_results,
    }
    RESULTS_FILE.write_text(json.dumps(output, indent=2, ensure_ascii=False))
    print(f"  Results saved to {RESULTS_FILE}")

    # Telegram message — top movers (above/below VA on multiple timeframes)
    msg = _format_telegram(vp_results, market_ctx, now)
    send_telegram(msg, dry_run=DRY_RUN)
    if DRY_RUN:
        print("\n" + msg)

    # Teams
    teams_msg = msg.replace("<b>", "**").replace("</b>", "**")
    send_teams(teams_msg, title="📊 VP Multi-TF Scan", dry_run=DRY_RUN)

    print(f"\nDone. {len(vp_results)} symbols analyzed.")


def _format_telegram(vp_results, market_ctx, now):
    """Format VP analysis for Telegram."""
    msg = f"<b>📊 VP Multi-TF — {now.strftime('%Y-%m-%d %H:%M')} ET</b>\n"
    if market_ctx.get("vix"):
        vix = market_ctx["vix"]
        emoji = "🟢" if vix < 15 else "🟡" if vix < 25 else "🔴"
        msg += f"{emoji} VIX: {vix:.1f} | SPY: {market_ctx.get('spy_state', '?')}\n"
    msg += "\n"

    # Show symbols where all 3 TFs agree (strong position)
    bullish = []  # above VA on 2+ timeframes
    bearish = []  # below VA on 2+ timeframes

    for sym, vp in vp_results.items():
        above_count = sum(
            1 for tf in ["daily", "weekly", "monthly"]
            if vp.get(tf) and vp[tf]["position"] == "above_va"
        )
        below_count = sum(
            1 for tf in ["daily", "weekly", "monthly"]
            if vp.get(tf) and vp[tf]["position"] == "below_va"
        )
        if above_count >= 2:
            bullish.append((sym, vp, above_count))
        if below_count >= 2:
            bearish.append((sym, vp, below_count))

    bullish.sort(key=lambda x: -x[2])
    bearish.sort(key=lambda x: -x[2])

    if bullish:
        msg += "<b>🟢 Bullish (Above VA 2+ TFs):</b>\n"
        for sym, vp, cnt in bullish[:10]:
            d = vp.get("daily", {})
            msg += f"  {sym} ${vp['price']} — D:{d.get('position_pct',0):.0f}% "
            w = vp.get("weekly", {})
            m = vp.get("monthly", {})
            msg += f"W:{w.get('position_pct',0):.0f}% M:{m.get('position_pct',0):.0f}%\n"
        msg += "\n"

    if bearish:
        msg += "<b>🔴 Bearish (Below VA 2+ TFs):</b>\n"
        for sym, vp, cnt in bearish[:10]:
            d = vp.get("daily", {})
            msg += f"  {sym} ${vp['price']} — D:{d.get('position_pct',0):.0f}% "
            w = vp.get("weekly", {})
            m = vp.get("monthly", {})
            msg += f"W:{w.get('position_pct',0):.0f}% M:{m.get('position_pct',0):.0f}%\n"
        msg += "\n"

    if not bullish and not bearish:
        msg += "所有標的都在 Value Area 內，市場均衡。\n"

    return msg


if __name__ == "__main__":
    main()
