"""
VP Strategy Scanner — Main entry point.

Usage:
  python scanner.py            # scan and send Telegram
  python scanner.py --dry-run  # scan and print only
"""

import sys
import json
from datetime import datetime
from pathlib import Path

from config import SYMBOLS, DEFAULT_CFG, SECTOR_MAP
from core.data import download_symbol
from core.market_context import fetch_market_context
from strategies.vp_signals import VPSignals
from strategies.inst_trend import calc_institutional_trend
from scoring.confidence import score_signal, calc_stock_factors
from notifications.telegram import send_telegram

STATE_FILE = Path(__file__).parent / "vp_state.json"
DRY_RUN = "--dry-run" in sys.argv

# All active strategies
STRATEGIES = [VPSignals()]


# ─── State Management ────────────────────────────────────────────────────────

def load_state():
    if STATE_FILE.exists():
        return json.loads(STATE_FILE.read_text())
    return {}


def save_state(state):
    STATE_FILE.write_text(json.dumps(state, indent=2))


def check_cooldown(key, state, cooldown):
    last = state.get(key, "")
    if not last:
        return True
    try:
        return (datetime.now() - datetime.strptime(last, "%Y-%m-%d")).days >= cooldown
    except ValueError:
        return True


# ─── Scanning ────────────────────────────────────────────────────────────────

def scan_symbol(symbol, df, cfg, lookbacks, state, today, market_ctx):
    """Run all strategies on a symbol for multiple lookbacks."""
    results = {lb: [] for lb in lookbacks}
    factors_cache = None

    for lb in lookbacks:
        if len(df) < lb + 5:
            continue
        cooldown_key = f"{symbol}_{lb}"
        if not check_cooldown(cooldown_key, state, cfg["cooldown_bars"]):
            continue

        cfg_copy = dict(cfg, vp_lookback=lb)
        df.attrs["symbol"] = symbol

        # Run all strategies
        signals = []
        for strategy in STRATEGIES:
            signals.extend(strategy.detect(df, cfg_copy, market_ctx))

        if not signals:
            continue

        # Calculate factors once per symbol
        if factors_cache is None:
            factors_cache = calc_stock_factors(df, symbol, cfg_copy, market_ctx)

        for sig in signals:
            results[lb].append((sig, factors_cache))
            if sig.direction != "WARNING":
                state[cooldown_key] = today

    return results


def apply_scores(all_signals, market_ctx):
    """Apply scoring to all signals, including cross-lookback alignment."""
    lookbacks = list(all_signals.keys())
    scored = {lb: [] for lb in lookbacks}

    # Build direction sets for cross-LB check
    dir_sets = {}
    for lb in lookbacks:
        dir_sets[lb] = {(sig.symbol, sig.direction) for sig, _ in all_signals[lb] if sig.direction != "WARNING"}

    for lb in lookbacks:
        other_lb = [x for x in lookbacks if x != lb]
        for sig, factors in all_signals[lb]:
            if sig.direction == "WARNING":
                scored[lb].append((sig, 0, {}))
                continue
            has_same = any((sig.symbol, sig.direction) in dir_sets[olb] for olb in other_lb)
            sector_etf = SECTOR_MAP.get(sig.symbol, "QQQ")
            score, details = score_signal(sig.direction, sig.strategy, factors, market_ctx, sector_etf, has_same)
            scored[lb].append((sig, score, details))

    return scored


# ─── Formatting ──────────────────────────────────────────────────────────────

def format_signals(signals, lookback):
    if not signals:
        return f"\n{'─'*20}\n<b>📏 {lookback}D Lookback</b>\n✅ No signals\n"

    lines = [f"\n{'─'*20}\n<b>📏 {lookback}D Lookback</b>\n"]
    for sig, score, details in signals:
        emoji = "🟢" if sig.direction == "LONG" else "🔴" if sig.direction == "SHORT" else "⚠️"
        sig_label = sig.strategy.split(": ", 1)[-1] if ": " in sig.strategy else sig.strategy

        if sig.direction == "WARNING":
            lines.append(f"{emoji} <b>{sig.symbol}</b> — Climax Volume")
            lines.append(f"   Price: {sig.entry:.2f} | Vol: {sig.sl:.1f}x avg\n")
        else:
            stars = "⭐" * score
            direction_zh = "做多" if sig.direction == "LONG" else "做空"

            # Priority tag based on backtest results
            priority = ""
            is_breakout = "Breakout" in sig.strategy
            is_long = sig.direction == "LONG"
            if is_breakout and is_long:
                priority = " 🏆"  # Best: Breakout + LONG
            elif is_long and score >= 4:
                priority = " ⭐⭐"  # Strong: LONG + high score
            elif is_long:
                priority = " ✅"  # Good: LONG
            elif sig.direction == "SHORT":
                priority = " ⚠️低勝率"  # Weak: SHORT

            lines.append(f"{emoji} <b>{sig.symbol}</b> {direction_zh} ({sig_label}) {stars} ({score}/5){priority}")
            # R:R ratio
            risk = abs(sig.entry - sig.sl)
            reward = abs(sig.tp - sig.entry)
            rr = f"{reward/risk:.1f}" if risk > 0 else "—"
            lines.append(f"   ▸ Entry: <code>{sig.entry:.2f}</code>")
            lines.append(f"   ▸ TP: <code>{sig.tp:.2f}</code> (+{reward:.2f})")
            lines.append(f"   ▸ SL: <code>{sig.sl:.2f}</code> (-{risk:.2f})")
            lines.append(f"   ▸ R:R = 1:{rr}")
            # Gate + bonus on one line each
            regime = details.get("Regime", "")
            gate_keys = ("量能", "趨勢")
            gate = " ".join(f"{k}{v}" for k, v in details.items() if k in gate_keys)
            bonus = " ".join(f"{k}{v}" for k, v in details.items() if k not in gate_keys and k != "Regime")
            lines.append(f"   🔑 {gate} | {regime}")
            if bonus:
                lines.append(f"   📊 {bonus}")
            lines.append("")

    return "\n".join(lines)


# ─── Main ────────────────────────────────────────────────────────────────────

def main():
    cfg = DEFAULT_CFG
    state = load_state()
    today = datetime.now().strftime("%Y-%m-%d")
    lookbacks = [60, 120]

    print(f"[{today}] Scanning {len(SYMBOLS)} symbols (60D + 120D)...")
    print("  Fetching market context...")
    market_ctx = fetch_market_context(cfg)

    all_signals = {lb: [] for lb in lookbacks}
    for symbol in SYMBOLS:
        try:
            if symbol == "SPY" and market_ctx.get("spy_df") is not None:
                df = market_ctx["spy_df"]
            else:
                df = download_symbol(symbol)
                if df is None:
                    continue
            res = scan_symbol(symbol, df, cfg, lookbacks, state, today, market_ctx)
            for lb in lookbacks:
                all_signals[lb].extend(res[lb])
        except Exception as e:
            print(f"Error scanning {symbol}: {e}")

    scored = apply_scores(all_signals, market_ctx)

    msg = f"<b>📊 VP Signals — {today}</b>\n"
    msg += f"Scanned {len(SYMBOLS)} symbols"
    if market_ctx["vix"]:
        vix = market_ctx["vix"]
        vix_emoji = "🟢" if vix < 15 else "🟡" if vix < 25 else "🔴"
        spy_label = {"above_va": "Above VA ↑", "in_va": "In VA ↔", "below_va": "Below VA ↓"}.get(market_ctx["spy_state"], market_ctx["spy_state"])
        msg += f"\n{vix_emoji} VIX: {vix:.1f} | SPY: {spy_label}"
    msg += "\n"
    for lb in lookbacks:
        msg += format_signals(scored[lb], lb)

    send_telegram(msg, dry_run=DRY_RUN)
    print(msg)
    save_state(state)


if __name__ == "__main__":
    main()
