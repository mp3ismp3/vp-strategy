"""Accumulation Detection v4 — Wyckoff-based institutional accumulation tracker.

Maintains a persistent watchlist of symbols showing accumulation patterns.
Uses decay scoring, Wyckoff phase classification, and entry trigger detection.

Usage:
    python accumulation.py                    # Scan all symbols, update state
    python accumulation.py NVDA,AVGO,AMD      # Scan specific symbols
    python accumulation.py --notify           # Scan + send Telegram notifications
    python accumulation.py --dry-run          # Scan + print (no Telegram)
    python accumulation.py --debug            # Show detailed component breakdown
    python accumulation.py --phase            # Show phase classification only
    python accumulation.py --triggers         # Show trigger status only
"""

import argparse
import os
import sys
import numpy as np
import pandas as pd
import yfinance as yf

from strategies.accumulation.config import (
    CLOSE_POS_FAIL,
    CLOSE_POS_HARD_FAIL,
    DEFAULT_LOOKBACK,
    SOFT_FAIL_DAYS,
    VOLUME_HARD_MULT,
    VOLUME_SURGE_MULT,
    VOL_MEDIAN_WINDOW,
)
from strategies.accumulation.detector import compute_daily_score
from strategies.accumulation.entry_triggers import check_triggers
from strategies.accumulation.notifications import (
    format_daily_report,
    format_proximity_alert,
    format_trigger_alert,
)
from strategies.accumulation.phase_classifier import classify_phase
from strategies.accumulation.tracker import AccumulationTracker


def _download_spy():
    """Download SPY for relative strength comparison."""
    df = yf.download("SPY", period="6mo", progress=False)
    if isinstance(df.columns, pd.MultiIndex):
        df.columns = df.columns.get_level_values(0)
    return df if not df.empty else None


def _download_symbol(symbol):
    """Download a single symbol."""
    df = yf.download(symbol, period="6mo", progress=False)
    if isinstance(df.columns, pd.MultiIndex):
        df.columns = df.columns.get_level_values(0)
    return df if not df.empty else None


def _get_market_context():
    """Get basic market context (VIX + SPY state)."""
    ctx = {"vix": None, "spy_state": "unknown"}
    try:
        vix_df = yf.download("^VIX", period="5d", progress=False)
        if isinstance(vix_df.columns, pd.MultiIndex):
            vix_df.columns = vix_df.columns.get_level_values(0)
        if not vix_df.empty:
            ctx["vix"] = float(vix_df["Close"].iloc[-1])
    except Exception:
        pass

    try:
        spy_df = yf.download("SPY", period="1mo", progress=False)
        if isinstance(spy_df.columns, pd.MultiIndex):
            spy_df.columns = spy_df.columns.get_level_values(0)
        if not spy_df.empty and len(spy_df) >= 5:
            spy_5d_return = (float(spy_df["Close"].iloc[-1]) / float(spy_df["Close"].iloc[-5]) - 1) * 100
            if spy_5d_return > 1:
                ctx["spy_state"] = "上漲趨勢"
            elif spy_5d_return < -1:
                ctx["spy_state"] = "下跌趨勢"
            else:
                ctx["spy_state"] = "盤整"
    except Exception:
        pass

    return ctx


def check_failure(df, support_primary, support_dynamic, lookback=DEFAULT_LOOKBACK):
    """Check if accumulation has failed (breakdown).
    
    Returns:
        dict with 'failed', 'severity' ('hard'/'soft'/None), 'reason', 'is_spring'
    """
    result = {"failed": False, "severity": None, "reason": "", "is_spring": False}

    if len(df) < 10:
        return result

    c = df["Close"].values.astype(float)
    h = df["High"].values.astype(float)
    l = df["Low"].values.astype(float)
    v = df["Volume"].values.astype(float)

    last_close = float(c[-1])
    last_low = float(l[-1])
    last_bar_range = h[-1] - l[-1]
    close_pos = (c[-1] - l[-1]) / last_bar_range if last_bar_range > 0 else 0.5

    vol_median = float(np.median(v[-VOL_MEDIAN_WINDOW:])) if len(v) >= VOL_MEDIAN_WINDOW else float(np.median(v))
    vol_ratio = v[-1] / max(vol_median, 1)

    # ─── Spring Detection (NOT a failure) ───
    # Intraday pierce below support but close recovers above
    if last_low < support_dynamic and last_close > support_dynamic:
        result["is_spring"] = True
        return result

    # ─── Hard Failure: below PRIMARY support ───
    if last_close < support_primary:
        if vol_ratio > VOLUME_HARD_MULT and close_pos < CLOSE_POS_HARD_FAIL:
            result["failed"] = True
            result["severity"] = "hard"
            result["reason"] = f"收盤 ${last_close:.2f} < 主支撐 ${support_primary:.2f} + 量增 {vol_ratio:.1f}x + 收低 {close_pos:.0%}"
            return result

        # Check consecutive days below primary
        days_below = 0
        for i in range(len(c) - 1, max(0, len(c) - 5) - 1, -1):
            if c[i] < support_primary:
                days_below += 1
            else:
                break
        if days_below >= 2:
            result["failed"] = True
            result["severity"] = "hard"
            result["reason"] = f"連續 {days_below} 天收盤 < 主支撐 ${support_primary:.2f}"
            return result

    # ─── Soft Failure: below DYNAMIC support with selling pressure ───
    if last_close < support_dynamic:
        if vol_ratio > VOLUME_SURGE_MULT and close_pos < CLOSE_POS_FAIL:
            result["failed"] = True
            result["severity"] = "soft"
            result["reason"] = f"收盤 ${last_close:.2f} < 動態支撐 ${support_dynamic:.2f} + 量增 {vol_ratio:.1f}x + 收低 {close_pos:.0%}"
            return result

    return result


def main():
    parser = argparse.ArgumentParser(description="Accumulation Tracker v4")
    parser.add_argument("symbols", type=str, nargs="?", default="",
                        help="Comma-separated symbols (default: all)")
    parser.add_argument("--days", type=int, default=DEFAULT_LOOKBACK,
                        help=f"Lookback days (default: {DEFAULT_LOOKBACK})")
    parser.add_argument("--notify", action="store_true",
                        help="Send Telegram notifications")
    parser.add_argument("--dry-run", action="store_true",
                        help="Print only, no Telegram")
    parser.add_argument("--debug", action="store_true",
                        help="Show detailed component breakdown")
    parser.add_argument("--phase", action="store_true",
                        help="Show phase classification only")
    parser.add_argument("--triggers", action="store_true",
                        help="Show trigger status only")
    args = parser.parse_args()

    from config import SYMBOLS as DEFAULT_SYMBOLS
    symbols = [s.strip() for s in args.symbols.split(",") if s.strip()] if args.symbols else DEFAULT_SYMBOLS

    print(f"{'═' * 60}")
    print(f"  ACCUMULATION TRACKER v4 (lookback: {args.days} days)")
    print(f"{'═' * 60}\n")

    # ─── 1. Market Context ───
    market_ctx = _get_market_context()
    vix_str = f"{market_ctx['vix']:.1f}" if market_ctx["vix"] else "N/A"
    print(f"  📊 Market: VIX={vix_str} | SPY={market_ctx['spy_state']}")
    print()

    # ─── 2. Download SPY for relative strength ───
    spy_df = _download_spy()

    # ─── 3. Load Tracker State ───
    tracker = AccumulationTracker()
    tracker.load_state()
    print(f"  📋 Loaded state: {tracker.count} symbols tracked "
          f"(✅{tracker.confirmed_count} + 👀{tracker.watch_count})")
    print()

    # ─── 4. Scan Each Symbol ───
    trigger_results = {}
    phase_results = {}

    for symbol in symbols:
        df = _download_symbol(symbol)
        if df is None or len(df) < args.days + 10:
            continue

        # 4a. Compute daily score
        score_result = compute_daily_score(df, spy_df, args.days)
        if score_result is None:
            continue

        raw_score = score_result["raw_score"]
        sp = score_result["support_primary"]
        sd = score_result["support_dynamic"]
        res = score_result["resistance"]

        # 4b. Classify phase
        phase_info = classify_phase(df, sp, sd, res, args.days)
        phase = phase_info["phase"]
        phase_results[symbol] = phase_info

        # 4c. Check failure (before update, to avoid adding then immediately removing)
        if tracker.is_tracked(symbol):
            tracked = tracker.get_symbol(symbol)
            failure = check_failure(df, tracked["support_primary"], tracked["support_dynamic"])

            if failure["is_spring"]:
                tracker.clear_failure(symbol)
            elif failure["failed"]:
                tracker.mark_failure(symbol, failure["reason"], failure["severity"])
                if symbol not in tracker._state:
                    # Was removed
                    _print_failure(symbol, failure)
                    continue

        # 4d. Update tracker
        tracker.update(symbol, raw_score, phase, sp, sd, res)

        # 4e. Check triggers (only for tracked symbols)
        if tracker.is_tracked(symbol):
            triggers = check_triggers(df, phase, sp, sd, res, args.days)
            trigger_results[symbol] = triggers

            # Record fired triggers
            for t in triggers.get("triggered", []):
                tracker.record_trigger(symbol, t["type"])

        # ─── Print Output ───
        if args.debug:
            _print_debug(symbol, score_result, phase_info, trigger_results.get(symbol))
        elif args.phase:
            _print_phase(symbol, phase_info, raw_score)
        elif args.triggers and symbol in trigger_results:
            _print_triggers(symbol, trigger_results[symbol], phase_info)
        elif raw_score >= 5 or tracker.is_tracked(symbol):
            _print_summary(symbol, raw_score, phase_info, tracker.get_symbol(symbol))

    # ─── 5. Save State ───
    tracker.save_state()
    print(f"\n{'─' * 60}")
    print(f"  💾 State saved: {tracker.count} symbols "
          f"(✅{tracker.confirmed_count} + 👀{tracker.watch_count})")

    # ─── 6. Print Changes ───
    changes = tracker.get_changes()
    if changes:
        print(f"\n  📋 Changes this scan:")
        for ch in changes:
            ch_type = ch["type"]
            sym = ch["symbol"]
            if ch_type == "added":
                print(f"    🆕 {sym} → 觀察 (Phase {ch['phase']}, {ch['score']}分)")
            elif ch_type == "promoted":
                print(f"    📈 {sym} → 確認 ({ch['score']:.1f}分)")
            elif ch_type == "demoted":
                print(f"    📉 {sym} → 觀察 ({ch['score']:.1f}分)")
            elif ch_type == "removed":
                print(f"    ❌ {sym} 移除 ({ch.get('reason', '')})")

    # ─── 7. Notifications ───
    should_notify = args.notify or (os.environ.get("TELEGRAM_BOT_TOKEN") and not args.dry_run)

    if should_notify or args.dry_run:
        from notifications.telegram import send_telegram

        # 7a. Trigger alerts (independent, sent first)
        for symbol, tr in trigger_results.items():
            for t in tr.get("triggered", []):
                msg = format_trigger_alert(symbol, t, phase_results.get(symbol))
                if args.dry_run:
                    print(f"\n{'─' * 40}")
                    print(f"  [TRIGGER ALERT]")
                    print(msg)
                else:
                    send_telegram(msg, dry_run=not should_notify)

        # 7b. Proximity alerts
        for symbol, tr in trigger_results.items():
            for p in tr.get("proximity", []):
                # Only send proximity if price is really close
                if p.get("pct_away", 999) <= 2.0:
                    msg = format_proximity_alert(symbol, p, phase_results.get(symbol))
                    if args.dry_run:
                        print(f"\n{'─' * 40}")
                        print(f"  [PROXIMITY ALERT]")
                        print(msg)
                    else:
                        send_telegram(msg, dry_run=not should_notify)

        # 7c. Daily report (sent last)
        report = format_daily_report(tracker, trigger_results, market_ctx)
        if args.dry_run:
            print(f"\n{'═' * 60}")
            print("  [DAILY REPORT]")
            print(report)
        else:
            send_telegram(report, dry_run=not should_notify)


# ─── Print Helpers ───

def _print_summary(symbol, raw_score, phase_info, tracked_state):
    """Print one-line summary for a symbol."""
    phase = phase_info["phase"]
    conf = phase_info["confidence"]
    tier = tracked_state["tier"] if tracked_state else "—"
    decay = tracked_state["decay_score"] if tracked_state else raw_score

    tier_emoji = "✅" if tier == "confirmed" else "👀" if tier == "watch" else "  "
    level = "🟢" if decay >= 11 else "🟡" if decay >= 7 else "⚪"

    print(f"  {level} {tier_emoji} {symbol:6s} | Phase {phase} ({conf:.0%}) | "
          f"Score {raw_score} (decay {decay:.1f}) | {phase_info['next_event']}")


def _print_debug(symbol, score_result, phase_info, triggers):
    """Print detailed breakdown."""
    print(f"\n  {'─' * 50}")
    print(f"  {symbol} — Raw Score: {score_result['raw_score']}/18")
    print(f"  Phase: {phase_info['phase']} (confidence: {phase_info['confidence']:.0%})")
    print(f"  {phase_info['description']}")
    print(f"  Next: {phase_info['next_event']}")
    print(f"  Support: P=${score_result['support_primary']:.2f} | "
          f"D=${score_result['support_dynamic']:.2f} | R=${score_result['resistance']:.2f}")
    print(f"  {'─' * 50}")

    for name, comp in score_result["components"].items():
        print(f"  {name:20s}: {comp['score']}/3 — {comp['signal']}")

    if triggers:
        if triggers["triggered"]:
            print(f"\n  ⚡ TRIGGERED:")
            for t in triggers["triggered"]:
                print(f"    {t['type']}: Entry ${t['entry']} | SL ${t['stop']} | "
                      f"TP ${t['target']} | R:R 1:{t['rr']}")
                print(f"    {t['reason']}")
        if triggers["proximity"]:
            print(f"\n  ⚠️ PROXIMITY:")
            for p in triggers["proximity"]:
                print(f"    {p['type']}: ${p['trigger_price']} (差 {p['pct_away']:.1f}%)")
                print(f"    {p['vol_status']}")
        dist = triggers.get("distance", {})
        if dist.get("nearest_trigger"):
            print(f"\n  📏 Distance: {dist['nearest_trigger']} — {dist['price_away_pct']:.1f}% away")


def _print_phase(symbol, phase_info, raw_score):
    """Print phase-only output."""
    phase = phase_info["phase"]
    conf = phase_info["confidence"]
    print(f"  {symbol:6s} | Phase {phase} ({conf:.0%}) | Score {raw_score}/18")
    print(f"         {phase_info['description']}")
    print(f"         → {phase_info['next_event']}")
    print()


def _print_triggers(symbol, triggers, phase_info):
    """Print trigger-only output."""
    print(f"\n  {symbol} (Phase {phase_info['phase']}):")
    if triggers["triggered"]:
        for t in triggers["triggered"]:
            print(f"    ⚡ {t['type']}: Entry ${t['entry']} | SL ${t['stop']} | "
                  f"TP ${t['target']} | R:R 1:{t['rr']}")
            print(f"       {t['reason']}")
            print(f"       行動: {t['action']}")
    elif triggers["proximity"]:
        for p in triggers["proximity"]:
            print(f"    ⚠️ {p['type']}: 觸發價 ${p['trigger_price']} (差 {p['pct_away']:.1f}%)")
            print(f"       {p['vol_status']}")
    else:
        dist = triggers.get("distance", {})
        if dist.get("nearest_trigger"):
            print(f"    📏 最近觸發: {dist['nearest_trigger']} — 差 {dist['price_away_pct']:.1f}%")
        else:
            print(f"    — 無接近觸發條件")


def _print_failure(symbol, failure):
    """Print failure notice."""
    sev = "❌" if failure["severity"] == "hard" else "⚠️"
    print(f"  {sev} {symbol}: {failure['reason']}")


if __name__ == "__main__":
    main()
