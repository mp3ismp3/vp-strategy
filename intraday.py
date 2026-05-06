"""
Intraday signal confirmation — runs during market hours.
Uses 1H candles to confirm VA signals at key levels from daily VP structure.
"""

import sys
import json
from datetime import datetime
from pathlib import Path

from config import SYMBOLS, DEFAULT_CFG
from core.data import download_symbol
from core.indicators import calc_vp, calc_atr
from notifications.telegram import send_telegram

DRY_RUN = "--dry-run" in sys.argv
STATE_FILE = Path(__file__).parent / "intraday_state.json"


def load_state():
    if STATE_FILE.exists():
        return json.loads(STATE_FILE.read_text())
    return {}


def save_state(state):
    STATE_FILE.write_text(json.dumps(state, indent=2))


def download_1h(symbol):
    """Download 1H candles (yfinance keeps ~60 days of intraday)."""
    import yfinance as yf
    try:
        df = yf.download(symbol, period="5d", interval="1h", progress=False)
        if df.empty:
            return None
        import pandas as pd
        if isinstance(df.columns, pd.MultiIndex):
            df.columns = df.columns.get_level_values(0)
        return df
    except Exception:
        return None


def check_va_rejection_long(candle, vah, val, vol_avg):
    """1H candle confirms VA Rejection LONG at VAL."""
    o, h, l, c, v = candle["Open"], candle["High"], candle["Low"], candle["Close"], candle["Volume"]
    body = abs(c - o)
    wick_dn = min(c, o) - l

    near_val = l <= val * 1.003
    bull_close = c > o
    rejection = body > 0 and wick_dn > body * 1.2
    has_volume = v > vol_avg * 1.2

    return near_val and bull_close and rejection and has_volume


def check_va_rejection_short(candle, vah, val, vol_avg):
    """1H candle confirms VA Rejection SHORT at VAH."""
    o, h, l, c, v = candle["Open"], candle["High"], candle["Low"], candle["Close"], candle["Volume"]
    body = abs(c - o)
    wick_up = h - max(c, o)

    near_vah = h >= vah * 0.997
    bear_close = c < o
    rejection = body > 0 and wick_up > body * 1.2
    has_volume = v > vol_avg * 1.2

    return near_vah and bear_close and rejection and has_volume


def check_failed_auction_long(candle, prev_candle, val, vol_avg):
    """Previous 1H closed below VAL, current 1H reclaimed above."""
    if prev_candle is None:
        return False
    prev_c = prev_candle["Close"]
    c, o, v = candle["Close"], candle["Open"], candle["Volume"]

    broke_below = prev_c < val
    reclaimed = c > val and c > o
    has_volume = v > vol_avg * 1.2

    return broke_below and reclaimed and has_volume


def check_failed_auction_short(candle, prev_candle, vah, vol_avg):
    """Previous 1H closed above VAH, current 1H dropped back below."""
    if prev_candle is None:
        return False
    prev_c = prev_candle["Close"]
    c, o, v = candle["Close"], candle["Open"], candle["Volume"]

    broke_above = prev_c > vah
    dropped = c < vah and c < o
    has_volume = v > vol_avg * 1.2

    return broke_above and dropped and has_volume


def check_breakout_retest_long(candle, vah, vol_avg):
    """Price pulled back to VAH from above and held."""
    o, h, l, c, v = candle["Open"], candle["High"], candle["Low"], candle["Close"], candle["Volume"]

    near_vah = l <= vah * 1.003 and l >= vah * 0.995
    held = c > vah
    bull = c > o
    has_volume = v > vol_avg * 0.8

    return near_vah and held and bull and has_volume


def check_breakout_retest_short(candle, val, vol_avg):
    """Price pulled back to VAL from below and held."""
    o, h, l, c, v = candle["Open"], candle["High"], candle["Low"], candle["Close"], candle["Volume"]

    near_val = h >= val * 0.997 and h <= val * 1.005
    held = c < val
    bear = c < o
    has_volume = v > vol_avg * 0.8

    return near_val and held and bear and has_volume


def scan_intraday(symbols, cfg):
    """Scan for intraday confirmations."""
    signals = []

    for symbol in symbols:
        # Get daily VP structure
        df_daily = download_symbol(symbol)
        if df_daily is None or len(df_daily) < cfg["vp_lookback"] + 5:
            continue

        # Get 1H candles
        df_1h = download_1h(symbol)
        if df_1h is None or len(df_1h) < 6:
            continue

        for lb in [60, 120]:
            if len(df_daily) < lb + 5:
                continue

            vp = calc_vp(df_daily, lb, cfg["va_pct"])
            atr = calc_atr(df_daily, cfg["atr_len"])
            if not vp or not atr:
                continue

            vah, val = vp["vah"], vp["val"]

            # Use last completed 1H candle
            last = df_1h.iloc[-1]
            prev = df_1h.iloc[-2] if len(df_1h) >= 2 else None

            # 1H volume average (last 5 candles)
            vol_avg = df_1h["Volume"].iloc[-6:-1].mean() if len(df_1h) >= 6 else df_1h["Volume"].mean()

            # Check signals
            if check_va_rejection_long(last, vah, val, vol_avg):
                sl = val - atr * 0.5
                tp = vp["poc"]
                signals.append((symbol, "LONG", "VA Rejection", lb, float(last["Close"]), tp, sl))

            elif check_va_rejection_short(last, vah, val, vol_avg):
                sl = vah + atr * 0.5
                tp = vp["poc"]
                signals.append((symbol, "SHORT", "VA Rejection", lb, float(last["Close"]), tp, sl))

            elif check_failed_auction_long(last, prev, val, vol_avg):
                sl = float(last["Low"]) - atr * 0.3
                tp = vp["poc"]
                signals.append((symbol, "LONG", "Failed Auction", lb, float(last["Close"]), tp, sl))

            elif check_failed_auction_short(last, prev, vah, vol_avg):
                sl = float(last["High"]) + atr * 0.3
                tp = vp["poc"]
                signals.append((symbol, "SHORT", "Failed Auction", lb, float(last["Close"]), tp, sl))

            elif check_breakout_retest_long(last, vah, vol_avg):
                tp = vah + (vah - vp["poc"])
                sl = vah - atr * 0.5
                signals.append((symbol, "LONG", "Breakout Retest", lb, float(last["Close"]), tp, sl))

            elif check_breakout_retest_short(last, val, vol_avg):
                tp = val - (vp["poc"] - val)
                sl = val + atr * 0.5
                signals.append((symbol, "SHORT", "Breakout Retest", lb, float(last["Close"]), tp, sl))

    return signals


def format_intraday(signals):
    """Format intraday signals for Telegram."""
    today = datetime.now().strftime("%Y-%m-%d %H:%M")

    if not signals:
        return f"<b>⚡ 盤中確認 — {today} ET</b>\n\n✅ 目前無 1H 確認信號\n"

    lines = [f"<b>⚡ 盤中確認 — {today} ET</b>\n"]
    lines.append("以下信號已由 1H K 線確認（建議輕倉）：\n")

    for symbol, direction, name, lb, entry, tp, sl in signals:
        emoji = "🟢" if direction == "LONG" else "🔴"
        dir_zh = "做多" if direction == "LONG" else "做空"
        risk = abs(entry - sl)
        reward = abs(tp - entry)
        rr = f"{reward/risk:.1f}" if risk > 0 else "—"

        lines.append(f"{emoji} <b>{symbol}</b> {dir_zh} ({name}) [{lb}D]")
        lines.append(f"   ▸ Entry: <code>{entry:.2f}</code>")
        lines.append(f"   ▸ TP: <code>{tp:.2f}</code> | SL: <code>{sl:.2f}</code>")
        lines.append(f"   ▸ R:R = 1:{rr}")
        lines.append(f"   ⚠️ 1H 確認，建議半倉，收盤確認後加倉")
        lines.append("")

    return "\n".join(lines)


def main():
    print("Scanning intraday confirmations (1H)...")
    state = load_state()
    today = datetime.now().strftime("%Y-%m-%d")

    signals = scan_intraday(SYMBOLS, DEFAULT_CFG)

    # Deduplicate: don't send same signal twice in one day
    new_signals = []
    for sig in signals:
        key = f"{sig[0]}_{sig[1]}_{sig[2]}_{today}"
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
