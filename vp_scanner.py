"""
Institutional Volume Profile Scanner
Scans daily data, detects VP signals, sends Telegram alerts.

Setup:
1. pip install yfinance requests pandas numpy
2. Create Telegram bot: talk to @BotFather → /newbot → get token
3. Get chat_id: send message to bot, visit https://api.telegram.org/bot<TOKEN>/getUpdates
4. Set environment variables:
   export TELEGRAM_BOT_TOKEN="your_bot_token"
   export TELEGRAM_CHAT_ID="your_chat_id"
5. python vp_scanner.py

Cron (run daily after market close):
   0 17 * * 1-5 cd /home/ubuntu/main && python vp_scanner.py
"""

import os
import json
import numpy as np
import pandas as pd
import yfinance as yf
import requests
from datetime import datetime, timedelta
from pathlib import Path

# ─── Config ──────────────────────────────────────────────────────────────────

CONFIG = {
    "symbols": [
        # Mega Cap Tech
        "AAPL", "MSFT", "GOOGL", "AMZN", "META", "NVDA", "TSLA",
        # Semiconductor / AI Chips
        "AVGO", "AMD", "INTC", "QCOM", "MU", "MRVL", "ARM", "TSM", "ASML", "AMAT", "LRCX", "KLAC", "ON",
        # AI / Cloud / Software
        "NOW", "CRWV", "PLTR", "AI", "SNOW", "DDOG", "NET", "MDB", "PANW", "CRWD", "ZS", "FTNT",
        # Cloud Infrastructure
        "CRM", "ORCL", "IBM", "ADBE", "INTU", "WDAY", "TEAM", "HUBS",
        # AI Hardware / Robotics
        "DELL", "HPE", "SMCI", "VRT", "ANET",
        # ETFs
        "SPY", "QQQ",
        # Misc Tech / AI Adjacent
        "UBER", "SQ", "SHOP", "COIN",
    ],
    "vp_lookback": 60,
    "va_pct": 0.68,
    "atr_len": 14,
    "vol_ma_len": 21,
    "max_sl_atr": 3.0,
    "cooldown_bars": 3,
    "long_only": False,
}

TELEGRAM_TOKEN = os.environ.get("TELEGRAM_BOT_TOKEN", "")
TELEGRAM_CHAT_ID = os.environ.get("TELEGRAM_CHAT_ID", "")
STATE_FILE = Path(__file__).parent / "vp_state.json"

# ─── Volume Profile Calculation ──────────────────────────────────────────────

def calc_vp(df, lookback, va_pct):
    """Calculate POC, VAH, VAL using volume-weighted statistics."""
    d = df.tail(lookback)
    price = d["Close"].values
    vol = d["Volume"].values
    hlc3 = (d["High"].values + d["Low"].values + d["Close"].values) / 3

    sum_v = vol.sum()
    if sum_v == 0:
        return None

    poc = np.sum(hlc3 * vol) / sum_v
    vw_var = np.sum(hlc3 ** 2 * vol) / sum_v - poc ** 2
    vw_std = np.sqrt(max(vw_var, 0))

    # k mapping: va_pct → standard deviations
    if va_pct <= 0.5:
        k = va_pct * 1.35
    elif va_pct <= 0.68:
        k = 0.67 + (va_pct - 0.5) * 1.83
    elif va_pct <= 0.80:
        k = 1.0 + (va_pct - 0.68) * 2.33
    else:
        k = 1.28 + (va_pct - 0.80) * 2.47

    vah = min(poc + k * vw_std, d["High"].max())
    val = max(poc - k * vw_std, d["Low"].min())

    return {"poc": poc, "vah": vah, "val": val}


def calc_atr(df, length):
    h = df["High"].values
    l = df["Low"].values
    c = df["Close"].values
    tr = np.maximum(h[1:] - l[1:], np.maximum(np.abs(h[1:] - c[:-1]), np.abs(l[1:] - c[:-1])))
    if len(tr) < length:
        return None
    return np.mean(tr[-length:])


# ─── Signal Detection ────────────────────────────────────────────────────────

def detect_signals(df, cfg):
    if len(df) < cfg["vp_lookback"] + 5:
        return []

    vp = calc_vp(df, cfg["vp_lookback"], cfg["va_pct"])
    if vp is None:
        return []

    atr = calc_atr(df, cfg["atr_len"])
    if atr is None or atr == 0:
        return []

    poc, vah, val = vp["poc"], vp["vah"], vp["val"]

    # Current and previous bar
    cur = df.iloc[-1]
    prev = df.iloc[-2]

    o, h, l, c, v = cur["Open"], cur["High"], cur["Low"], cur["Close"], cur["Volume"]
    po, ph, pl, pc = prev["Open"], prev["High"], prev["Low"], prev["Close"]

    # Volume context
    vol_ma = df["Volume"].iloc[-cfg["vol_ma_len"]:].mean()
    vol_ratio = v / vol_ma if vol_ma > 0 else 0
    high_vol = vol_ratio > 1.2
    low_vol = vol_ratio < 0.8
    climax_vol = vol_ratio > 2.5

    # Price action
    body = abs(c - o)
    wick_up = h - max(c, o)
    wick_dn = min(c, o) - l
    bull_close = c > o
    bear_close = c < o

    bull_rejection = body > 0 and wick_dn > body * 1.5 and wick_dn > wick_up * 2 and bull_close
    bear_rejection = body > 0 and wick_up > body * 1.5 and wick_up > wick_dn * 2 and bear_close

    # POC slope
    vp5 = calc_vp(df.iloc[:-5], cfg["vp_lookback"], cfg["va_pct"])
    poc_rising = vp5 is not None and (poc - vp5["poc"]) > atr * 0.1
    poc_falling = vp5 is not None and (poc - vp5["poc"]) < -atr * 0.1

    signals = []

    # Signal 1: VA Rejection
    if c > val and c < poc and bull_rejection and high_vol and l <= val + atr * 0.3 and not poc_falling:
        sl = max(val - atr * 0.5, c - atr * cfg["max_sl_atr"])
        signals.append(("LONG", "VA Rejection", c, vah, sl))

    if not cfg["long_only"]:
        if c < vah and c > poc and bear_rejection and high_vol and h >= vah - atr * 0.3 and not poc_rising:
            sl = min(vah + atr * 0.5, c + atr * cfg["max_sl_atr"])
            signals.append(("SHORT", "VA Rejection", c, val, sl))

    # Signal 2: Failed Auction
    if pl < val and pc < val and c > val and bull_close and high_vol:
        sl = max(pl - atr * 0.3, c - atr * cfg["max_sl_atr"])
        signals.append(("LONG", "Failed Auction", c, vah, sl))

    if not cfg["long_only"]:
        if ph > vah and pc > vah and c < vah and bear_close and high_vol:
            sl = min(ph + atr * 0.3, c + atr * cfg["max_sl_atr"])
            signals.append(("SHORT", "Failed Auction", c, val, sl))

    # Signal 3: Breakout Retest (check last 10 bars for confirmed break)
    confirmed_above = False
    confirmed_below = False
    for i in range(-10, -2):
        if i + 1 >= 0:
            break
        b1 = df.iloc[i]
        b2 = df.iloc[i + 1]
        v_i = b1["Volume"]
        if b1["Close"] > vah and b2["Close"] > vah and v_i > vol_ma * 1.2:
            confirmed_above = True
            confirmed_below = False
        if b1["Close"] < val and b2["Close"] < val and v_i > vol_ma * 1.2:
            confirmed_below = True
            confirmed_above = False
        if b1["Close"] > val and b1["Close"] < vah:
            confirmed_above = False
            confirmed_below = False

    if confirmed_above and l <= vah + atr * 0.3 and c > vah and bull_close and not low_vol:
        tp = poc + 2 * (vah - poc)
        sl = max(vah - atr * 0.5, c - atr * cfg["max_sl_atr"])
        signals.append(("LONG", "Breakout Retest", c, tp, sl))

    if not cfg["long_only"] and confirmed_below and h >= val - atr * 0.3 and c < val and bear_close and not low_vol:
        tp = poc - 2 * (poc - val)
        sl = min(val + atr * 0.5, c + atr * cfg["max_sl_atr"])
        signals.append(("SHORT", "Breakout Retest", c, tp, sl))

    # Climax volume warning
    if climax_vol:
        signals.append(("WARNING", "Climax Volume", c, 0, vol_ratio))

    return signals


# ─── State Management (cooldown) ─────────────────────────────────────────────

def load_state():
    if STATE_FILE.exists():
        return json.loads(STATE_FILE.read_text())
    return {}

def save_state(state):
    STATE_FILE.write_text(json.dumps(state, indent=2))

def check_cooldown(symbol, state, cooldown):
    last = state.get(symbol, "")
    if not last:
        return True
    try:
        last_dt = datetime.strptime(last, "%Y-%m-%d")
        days_since = (datetime.now() - last_dt).days
        return days_since >= cooldown
    except ValueError:
        return True


# ─── Telegram ────────────────────────────────────────────────────────────────

def send_telegram(message):
    if not TELEGRAM_TOKEN or not TELEGRAM_CHAT_ID:
        print(f"[NO TELEGRAM] {message}")
        return
    url = f"https://api.telegram.org/bot{TELEGRAM_TOKEN}/sendMessage"
    try:
        requests.post(url, json={
            "chat_id": TELEGRAM_CHAT_ID,
            "text": message,
            "parse_mode": "HTML",
        }, timeout=10)
    except Exception as e:
        print(f"Telegram error: {e}")


# ─── Main ────────────────────────────────────────────────────────────────────

def main():
    cfg = CONFIG
    state = load_state()
    today = datetime.now().strftime("%Y-%m-%d")
    all_signals = []

    print(f"[{today}] Scanning {len(cfg['symbols'])} symbols...")

    for symbol in cfg["symbols"]:
        try:
            df = yf.download(symbol, period="6mo", interval="1d", progress=False)
            if df.empty or len(df) < cfg["vp_lookback"] + 5:
                continue

            # Flatten MultiIndex columns if present
            if isinstance(df.columns, pd.MultiIndex):
                df.columns = df.columns.get_level_values(0)

            if not check_cooldown(symbol, state, cfg["cooldown_bars"]):
                continue

            signals = detect_signals(df, cfg)
            for sig in signals:
                direction, name, price, tp, sl = sig
                all_signals.append((symbol, direction, name, price, tp, sl))
                state[symbol] = today

        except Exception as e:
            print(f"Error scanning {symbol}: {e}")

    # Send alerts
    if all_signals:
        lines = [f"<b>📊 VP Signals — {today}</b>\n"]
        for symbol, direction, name, price, tp, sl in all_signals:
            emoji = "🟢" if direction == "LONG" else "🔴" if direction == "SHORT" else "⚠️"
            lines.append(f"{emoji} <b>{symbol}</b> {direction} ({name})")
            if direction == "WARNING":
                lines.append(f"   Price: {price:.2f} | Vol Ratio: {sl:.1f}x\n")
            else:
                lines.append(f"   Entry: {price:.2f} | TP: {tp:.2f} | SL: {sl:.2f}\n")
        msg = "\n".join(lines)
        send_telegram(msg)
        print(msg)
    else:
        msg = f"📊 VP Scanner — {today}\n\nScanned {len(cfg['symbols'])} symbols.\n✅ No signals today."
        send_telegram(msg)
        print("No signals today.")

    save_state(state)


if __name__ == "__main__":
    main()
