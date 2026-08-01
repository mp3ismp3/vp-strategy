"""MACD Divergence Scanner — Daily + Weekly divergence detection with Telegram alerts.

Scans all symbols for MACD divergence on daily and weekly timeframes.
Highlights dual divergence (same direction on both timeframes) as strongest signal.

Usage:
    python macd_scan.py               # Scan all symbols + Telegram
    python macd_scan.py --dry-run     # Scan + print only (no Telegram)
    python macd_scan.py NVDA,AMD      # Scan specific symbols only
"""

import argparse
import os
from datetime import datetime, timezone, timedelta

from config import SYMBOLS
from core.data_provider import YahooProvider
from core.indicators import calc_macd, detect_macd_divergence, resample_to_weekly
from notifications.telegram import send_telegram

ET = timezone(timedelta(hours=-4))


def _scan_symbol(df, swing_lookback=5, max_bars_ago=10):
    """Scan a single symbol for daily and weekly MACD divergence.

    Args:
        df: Daily OHLCV DataFrame (1 year of data).
        swing_lookback: sensitivity for swing detection.
        max_bars_ago: max bars from end to consider a signal recent.

    Returns:
        dict with keys: daily_divs, weekly_divs, is_dual, dual_type
        or None if insufficient data.
    """
    if df is None or len(df) < 60:
        return None

    # Daily divergence
    daily_divs = detect_macd_divergence(
        df, lookback=60, swing_lookback=swing_lookback, max_bars_ago=max_bars_ago
    )

    # Weekly divergence
    weekly_df = resample_to_weekly(df)
    weekly_divs = []
    if weekly_df is not None and len(weekly_df) >= 35:
        weekly_divs = detect_macd_divergence(
            weekly_df, lookback=30, swing_lookback=3, max_bars_ago=max_bars_ago
        )

    if not daily_divs and not weekly_divs:
        return None

    # Check for dual divergence (same direction on both timeframes)
    is_dual = False
    dual_type = None
    for dd in daily_divs:
        for wd in weekly_divs:
            if dd["type"] == wd["type"]:
                is_dual = True
                dual_type = dd["type"]
                break
        if is_dual:
            break

    return {
        "daily_divs": daily_divs,
        "weekly_divs": weekly_divs,
        "is_dual": is_dual,
        "dual_type": dual_type,
    }


def format_macd_report(results, scan_time):
    """Format the MACD divergence scan results into a Telegram message.

    Args:
        results: dict of {symbol: scan_result}
        scan_time: datetime of scan

    Returns:
        str: HTML-formatted Telegram message.
    """
    date_str = scan_time.strftime("%Y-%m-%d %H:%M ET")

    lines = []
    lines.append("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━")
    lines.append(f"📉 <b>MACD 背離掃描</b> — {date_str}")
    lines.append("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━")
    lines.append("")

    # Separate results into categories
    dual_results = {s: r for s, r in results.items() if r["is_dual"]}
    daily_only = {s: r for s, r in results.items()
                  if not r["is_dual"] and r["daily_divs"]}
    weekly_only = {s: r for s, r in results.items()
                   if not r["is_dual"] and r["weekly_divs"] and not r["daily_divs"]}

    # ─── 🔥 Dual Divergence (Strongest Signal) ───
    lines.append("━━ 🔥 雙重背離（日線+周線同向）━━")
    if dual_results:
        for symbol, r in sorted(dual_results.items()):
            direction = "看漲" if r["dual_type"] == "bullish" else "看跌"
            emoji = "🟢" if r["dual_type"] == "bullish" else "🔴"

            dd = next((d for d in r["daily_divs"] if d["type"] == r["dual_type"]), None)
            wd = next((d for d in r["weekly_divs"] if d["type"] == r["dual_type"]), None)

            d_bars = f"D:{dd['bars_ago']}bar" if dd else ""
            w_bars = f"W:{wd['bars_ago']}bar" if wd else ""

            lines.append(f"  {emoji} <b>{symbol}</b> — {direction} | {d_bars} {w_bars}")
            if dd:
                lines.append(f"    日線: ${dd['price_prev']:.2f}→${dd['price_curr']:.2f} vs MACD {dd['macd_prev']:.4f}→{dd['macd_curr']:.4f}")
            if wd:
                lines.append(f"    周線: ${wd['price_prev']:.2f}→${wd['price_curr']:.2f} vs MACD {wd['macd_prev']:.4f}→{wd['macd_curr']:.4f}")
    else:
        lines.append("  (無)")
    lines.append("")

    # ─── 📊 Daily Divergence ───
    lines.append("━━ 📊 日線背離 ━━")
    if daily_only:
        for symbol, r in sorted(daily_only.items()):
            for d in r["daily_divs"]:
                emoji = "🟢" if d["type"] == "bullish" else "🔴"
                direction = "看漲" if d["type"] == "bullish" else "看跌"
                lines.append(
                    f"  {emoji} <b>{symbol}</b> — {direction} | "
                    f"{d['bars_ago']}bar ago | "
                    f"${d['price_prev']:.2f}→${d['price_curr']:.2f}"
                )
    else:
        lines.append("  (無)")
    lines.append("")

    # ─── 📅 Weekly Divergence ───
    lines.append("━━ 📅 周線背離 ━━")
    if weekly_only:
        for symbol, r in sorted(weekly_only.items()):
            for d in r["weekly_divs"]:
                emoji = "🟢" if d["type"] == "bullish" else "🔴"
                direction = "看漲" if d["type"] == "bullish" else "看跌"
                lines.append(
                    f"  {emoji} <b>{symbol}</b> — {direction} | "
                    f"{d['bars_ago']}bar ago | "
                    f"${d['price_prev']:.2f}→${d['price_curr']:.2f}"
                )
    else:
        lines.append("  (無)")
    lines.append("")

    # ─── Summary ───
    total = len(results)
    lines.append(
        f"📊 共 {total} 檔有背離訊號 | "
        f"🔥 雙重: {len(dual_results)} | "
        f"日線: {len(daily_only)} | "
        f"周線: {len(weekly_only)}"
    )

    msg = "\n".join(lines)

    # Truncate if needed
    if len(msg) > 3900:
        msg = _truncate_macd_report(msg)

    return msg


def _truncate_macd_report(msg):
    """Truncate MACD report to fit Telegram 4096 char limit."""
    if len(msg) <= 4000:
        return msg
    # Keep first 3900 chars and add truncation notice
    cut = msg[:3900].rsplit("\n", 1)[0]
    return cut + "\n...(已截斷，更多背離請查看 Web UI)"


def main():
    parser = argparse.ArgumentParser(description="MACD Divergence Scanner")
    parser.add_argument("symbols", type=str, nargs="?", default="",
                        help="Comma-separated symbols (default: all)")
    parser.add_argument("--dry-run", action="store_true",
                        help="Print only, no Telegram")
    parser.add_argument("--notify", action="store_true",
                        help="Send Telegram notifications")
    args = parser.parse_args()

    symbols = ([s.strip() for s in args.symbols.split(",") if s.strip()]
               if args.symbols else SYMBOLS)

    now = datetime.now(ET)
    print(f"[{now.strftime('%Y-%m-%d %H:%M')} ET] MACD Divergence Scan — {len(symbols)} symbols...")

    # Download data (batch for efficiency)
    provider = YahooProvider(max_workers=5, jitter=(0.1, 0.3))
    print("  Downloading daily data (1 year)...")
    data = provider.batch_daily(symbols, period="1y")
    print(f"  Downloaded {len(data)}/{len(symbols)} symbols")

    # Scan each symbol
    results = {}
    for symbol in symbols:
        df = data.get(symbol)
        result = _scan_symbol(df)
        if result:
            results[symbol] = result

    # Print results
    print(f"\n{'═' * 60}")
    print(f"  MACD DIVERGENCE RESULTS")
    print(f"{'═' * 60}")

    dual = {s: r for s, r in results.items() if r["is_dual"]}
    daily = {s: r for s, r in results.items() if not r["is_dual"] and r["daily_divs"]}
    weekly = {s: r for s, r in results.items()
              if not r["is_dual"] and r["weekly_divs"] and not r["daily_divs"]}

    if dual:
        print(f"\n  🔥 雙重背離 (日線+周線同向): {len(dual)} 檔")
        for symbol, r in sorted(dual.items()):
            direction = "BULLISH" if r["dual_type"] == "bullish" else "BEARISH"
            print(f"    {symbol} — {direction}")

    if daily:
        print(f"\n  📊 日線背離: {len(daily)} 檔")
        for symbol, r in sorted(daily.items()):
            for d in r["daily_divs"]:
                print(f"    {symbol} — {d['type'].upper()} ({d['bars_ago']} bars ago)")

    if weekly:
        print(f"\n  📅 周線背離: {len(weekly)} 檔")
        for symbol, r in sorted(weekly.items()):
            for d in r["weekly_divs"]:
                print(f"    {symbol} — {d['type'].upper()} ({d['bars_ago']} bars ago)")

    if not results:
        print("\n  (無背離訊號)")

    print(f"\n  總計: {len(results)} 檔有背離")
    print(f"{'═' * 60}")

    # ─── Notifications ───
    should_notify = args.notify or (os.environ.get("TELEGRAM_BOT_TOKEN") and not args.dry_run)

    if (should_notify or args.dry_run) and results:
        msg = format_macd_report(results, now)

        if args.dry_run:
            print(f"\n{'─' * 40}")
            print("  [TELEGRAM MESSAGE]")
            print(msg)
        else:
            send_telegram(msg, dry_run=not should_notify)
            print("\n  ✅ Telegram 通知已發送")


if __name__ == "__main__":
    main()
