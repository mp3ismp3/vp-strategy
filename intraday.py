"""
Intraday signal confirmation — runs hourly during market hours.
Uses 1H candles to confirm VA signals at key levels from daily VP structure.
Only sends signals with confidence >= 3 and volume >= 1.5x avg.
"""

import sys
import json
from datetime import datetime
from pathlib import Path

from config import SYMBOLS, DEFAULT_CFG, SECTOR_MAP
from core.data import download_symbol
from core.indicators import calc_vp, calc_atr
from core.market_context import fetch_market_context
from scoring.confidence import score_signal, calc_stock_factors
from notifications.telegram import send_telegram

DRY_RUN = "--dry-run" in sys.argv
STATE_FILE = Path(__file__).parent / "intraday_state.json"
MIN_VOL_RATIO = 1.2  # 1H volume must be > 1.2x avg (institutional: 1.5x on daily, scaled down for 1H)
MIN_SCORE = 3        # Only send signals with score >= 3
VOL_AVG_PERIOD = 20  # Use 20-period avg like institutions, not 5


def load_state():
    if STATE_FILE.exists():
        return json.loads(STATE_FILE.read_text())
    return {}


def save_state(state):
    STATE_FILE.write_text(json.dumps(state, indent=2))


def download_1h(symbol):
    """Download 1H candles."""
    import yfinance as yf
    import pandas as pd
    try:
        df = yf.download(symbol, period="5d", interval="1h", progress=False)
        if df.empty:
            return None
        if isinstance(df.columns, pd.MultiIndex):
            df.columns = df.columns.get_level_values(0)
        return df
    except Exception:
        return None


def check_va_rejection_long(candle, val, vol_avg):
    """Institutional: price touches VAL + closes bullish + wick shows buying."""
    o, h, l, c, v = candle["Open"], candle["High"], candle["Low"], candle["Close"], candle["Volume"]
    body = abs(c - o)
    wick_dn = min(c, o) - l
    # Price must touch or pierce VAL (within 0.5%)
    touched = l <= val * 1.005
    # Must close bullish and above VAL
    bullish = c > o and c > val
    # Wick shows rejection (relaxed: wick >= body * 0.8)
    rejection = body > 0 and wick_dn >= body * 0.8
    # Volume confirmation
    vol_ok = v > vol_avg * MIN_VOL_RATIO
    return touched and bullish and rejection and vol_ok


def check_va_rejection_short(candle, vah, vol_avg):
    """Institutional: price touches VAH + closes bearish + wick shows selling."""
    o, h, l, c, v = candle["Open"], candle["High"], candle["Low"], candle["Close"], candle["Volume"]
    body = abs(c - o)
    wick_up = h - max(c, o)
    touched = h >= vah * 0.995
    bearish = c < o and c < vah
    rejection = body > 0 and wick_up >= body * 0.8
    vol_ok = v > vol_avg * MIN_VOL_RATIO
    return touched and bearish and rejection and vol_ok


def check_failed_auction_long(candle, prev, val, vol_avg, pdl=None):
    """Price broke below VAL or PDL then reclaimed — trapped shorts."""
    if prev is None:
        return False
    c, o, v = candle["Close"], candle["Open"], candle["Volume"]
    level = val
    # Also trigger if broke below prior day low
    if pdl and prev["Close"] < pdl:
        level = pdl
    broke = prev["Close"] < level
    reclaimed = c > level and c > o
    vol_ok = v > vol_avg * MIN_VOL_RATIO
    return broke and reclaimed and vol_ok


def check_failed_auction_short(candle, prev, vah, vol_avg, pdh=None):
    """Price broke above VAH or PDH then dropped — trapped longs."""
    if prev is None:
        return False
    c, o, v = candle["Close"], candle["Open"], candle["Volume"]
    level = vah
    if pdh and prev["Close"] > pdh:
        level = pdh
    broke = prev["Close"] > level
    dropped = c < level and c < o
    vol_ok = v > vol_avg * MIN_VOL_RATIO
    return broke and dropped and vol_ok


def check_breakout_retest_long(candle, vah, vol_avg, atr):
    o, h, l, c, v = candle["Open"], candle["High"], candle["Low"], candle["Close"], candle["Volume"]
    return (abs(l - vah) < atr * 0.5 and c > vah
            and c > o and v > vol_avg * MIN_VOL_RATIO)


def check_breakout_retest_short(candle, val, vol_avg, atr):
    o, h, l, c, v = candle["Open"], candle["High"], candle["Low"], candle["Close"], candle["Volume"]
    return (abs(h - val) < atr * 0.5 and c < val
            and c < o and v > vol_avg * MIN_VOL_RATIO)


def scan_intraday(symbols, cfg, market_ctx):
    """Scan for intraday confirmations, return scored signals."""
    signals = []
    stats = {"scanned": 0, "near_va": 0, "pattern": 0, "trend_ok": 0, "scored": 0}

    for symbol in symbols:
        df_daily = download_symbol(symbol)
        if df_daily is None or len(df_daily) < cfg["vp_lookback"] + 5:
            continue

        df_1h = download_1h(symbol)
        if df_1h is None or len(df_1h) < 6:
            continue

        stats["scanned"] += 1

        # Prior day high/low (institutional key levels)
        pdh = float(df_daily["High"].iloc[-1])
        pdl = float(df_daily["Low"].iloc[-1])

        for lb in [60, 120]:
            if len(df_daily) < lb + 5:
                continue

            vp = calc_vp(df_daily, lb, cfg["va_pct"])
            atr = calc_atr(df_daily, cfg["atr_len"])
            if not vp or not atr:
                continue

            vah, val = vp["vah"], vp["val"]
            last = df_1h.iloc[-1]
            prev = df_1h.iloc[-2] if len(df_1h) >= 2 else None
            # Use 20-period volume average (institutional standard)
            vol_avg = df_1h["Volume"].iloc[-21:-1].mean() if len(df_1h) >= 21 else df_1h["Volume"].iloc[:-1].mean()

            sig = None
            if check_va_rejection_long(last, val, vol_avg):
                sig = ("LONG", "VP: VA Rejection", float(last["Close"]), vah, val - atr * 0.5)
            elif check_va_rejection_short(last, vah, vol_avg):
                sig = ("SHORT", "VP: VA Rejection", float(last["Close"]), val, vah + atr * 0.5)
            elif check_failed_auction_long(last, prev, val, vol_avg, pdl):
                sig = ("LONG", "VP: Failed Auction", float(last["Close"]), vah, float(last["Low"]) - atr * 0.3)
            elif check_failed_auction_short(last, prev, vah, vol_avg, pdh):
                sig = ("SHORT", "VP: Failed Auction", float(last["Close"]), val, float(last["High"]) + atr * 0.3)
            elif check_breakout_retest_long(last, vah, vol_avg, atr):
                sig = ("LONG", "VP: Breakout Retest", float(last["Close"]), vah + (vah - val), vah - atr * 0.5)
            elif check_breakout_retest_short(last, val, vol_avg, atr):
                sig = ("SHORT", "VP: Breakout Retest", float(last["Close"]), val - (vah - val), val + atr * 0.5)

            if sig is None:
                continue

            stats["pattern"] += 1
            direction, name, entry, tp, sl = sig

            # Score the signal
            factors = calc_stock_factors(df_daily, symbol, dict(cfg, vp_lookback=lb), market_ctx)
            sector_etf = SECTOR_MAP.get(symbol, "QQQ")
            score, details = score_signal(direction, name, factors, market_ctx, sector_etf, False)

            # Hard filter: don't send counter-trend signals
            trend = factors.get("inst_trend", "NEUTRAL")
            if direction == "LONG" and trend == "BEARISH":
                print(f"  [SKIP] {symbol} [{lb}D] LONG — trend BEARISH")
                continue
            if direction == "SHORT" and trend == "BULLISH":
                print(f"  [SKIP] {symbol} [{lb}D] SHORT — trend BULLISH")
                continue

            stats["trend_ok"] += 1

            if score >= MIN_SCORE:
                stats["scored"] += 1
                signals.append((symbol, direction, name, lb, entry, tp, sl, score, details))
            else:
                print(f"  [SKIP] {symbol} [{lb}D] {direction} {name} — score {score} < {MIN_SCORE}")

    print(f"\n  Stats: scanned={stats['scanned']} | pattern={stats['pattern']} | trend_ok={stats['trend_ok']} | passed={stats['scored']}")
    return signals


def format_intraday(signals):
    today = datetime.now().strftime("%Y-%m-%d %H:%M")

    if not signals:
        return ""

    lines = [f"<b>⚡ 盤中確認 — {today} ET</b>\n"]
    lines.append(f"1H K 線確認 | 信心 ≥ {MIN_SCORE} | 量能 ≥ {MIN_VOL_RATIO}x\n")

    for symbol, direction, name, lb, entry, tp, sl, score, details in signals:
        emoji = "🟢" if direction == "LONG" else "🔴"
        dir_zh = "做多" if direction == "LONG" else "做空"
        sig_label = name.split(": ", 1)[-1]
        stars = "⭐" * score
        risk = abs(entry - sl)
        reward = abs(tp - entry)
        rr = f"{reward/risk:.1f}" if risk > 0 else "—"

        lines.append(f"{emoji} <b>{symbol}</b> {dir_zh} ({sig_label}) [{lb}D] {stars} ({score}/5)")
        lines.append(f"   ▸ Entry: <code>{entry:.2f}</code> | TP: <code>{tp:.2f}</code> | SL: <code>{sl:.2f}</code>")
        lines.append(f"   ▸ R:R = 1:{rr}")
        lines.append(f"   ⚠️ 盤中輕倉，收盤確認後加倉")
        lines.append("")

    return "\n".join(lines)


def main():
    print("Scanning intraday confirmations (1H)...")
    state = load_state()
    today = datetime.now().strftime("%Y-%m-%d")

    market_ctx = fetch_market_context(DEFAULT_CFG)
    signals = scan_intraday(SYMBOLS, DEFAULT_CFG, market_ctx)

    # Deduplicate: same signal same hour won't repeat
    now_hour = datetime.now().strftime("%H")
    new_signals = []
    for sig in signals:
        key = f"{sig[0]}_{sig[1]}_{sig[2]}_{today}_{now_hour}"
        if key not in state:
            state[key] = today
            new_signals.append(sig)

    if new_signals:
        msg = format_intraday(new_signals)
        send_telegram(msg, dry_run=DRY_RUN)
        print(msg)
    else:
        print("No new intraday signals.")

    save_state(state)


if __name__ == "__main__":
    main()
