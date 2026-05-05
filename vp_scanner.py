"""
Institutional Volume Profile Scanner with Confidence Scoring
Scans daily data, detects VP signals, scores them, sends Telegram alerts.

Usage:
  python vp_scanner.py            # scan and send Telegram
  python vp_scanner.py --dry-run  # scan and print only, no Telegram
"""

import os
import sys
import json
import numpy as np
import pandas as pd
import yfinance as yf
import requests
from datetime import datetime
from pathlib import Path

# ─── Config ──────────────────────────────────────────────────────────────────

CONFIG = {
    "symbols": [
        "AAPL", "MSFT", "GOOGL", "AMZN", "META", "NVDA", "TSLA",
        "AVGO", "AMD", "INTC", "QCOM", "MU", "MRVL", "ARM", "TSM", "ASML", "AMAT", "LRCX", "KLAC", "ON",
        "NOW", "CRWV", "PLTR", "AI", "SNOW", "DDOG", "NET", "MDB", "PANW", "CRWD", "ZS", "FTNT",
        "CRM", "ORCL", "IBM", "ADBE", "INTU", "WDAY", "TEAM", "HUBS",
        "DELL", "HPE", "SMCI", "VRT", "ANET",
        "SPY", "QQQ",
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

# Sector ETF mapping for momentum scoring
SECTOR_ETFS = ["SMH", "XLK", "IGV", "SKYY", "BOTZ"]

SECTOR_MAP = {
    # Semiconductor / AI Chips
    "NVDA": "SMH", "AVGO": "SMH", "AMD": "SMH", "INTC": "SMH", "QCOM": "SMH",
    "MU": "SMH", "MRVL": "SMH", "ARM": "SMH", "TSM": "SMH", "ASML": "SMH",
    "AMAT": "SMH", "LRCX": "SMH", "KLAC": "SMH", "ON": "SMH",
    # Mega Cap Tech
    "AAPL": "XLK", "MSFT": "XLK", "GOOGL": "XLK", "META": "XLK", "TSLA": "XLK",
    # AI / Cloud / Software
    "NOW": "IGV", "CRWV": "IGV", "PLTR": "IGV", "AI": "IGV", "SNOW": "IGV",
    "DDOG": "IGV", "NET": "IGV", "MDB": "IGV", "PANW": "IGV", "CRWD": "IGV",
    "ZS": "IGV", "FTNT": "IGV",
    # Cloud Infrastructure
    "CRM": "IGV", "ORCL": "XLK", "IBM": "XLK", "ADBE": "IGV", "INTU": "IGV",
    "WDAY": "IGV", "TEAM": "IGV", "HUBS": "IGV",
    # AI Hardware / Robotics
    "DELL": "XLK", "HPE": "XLK", "SMCI": "SMH", "VRT": "XLK", "ANET": "XLK",
    # ETFs
    "SPY": "SPY", "QQQ": "QQQ",
    # Misc
    "UBER": "XLK", "SQ": "XLK", "SHOP": "IGV", "COIN": "XLK", "AMZN": "XLK",
}

TELEGRAM_TOKEN = os.environ.get("TELEGRAM_BOT_TOKEN", "")
TELEGRAM_CHAT_ID = os.environ.get("TELEGRAM_CHAT_ID", "")
STATE_FILE = Path(__file__).parent / "vp_state.json"
DRY_RUN = "--dry-run" in sys.argv

# ─── Volume Profile Calculation ──────────────────────────────────────────────

def calc_vp(df, lookback, va_pct):
    d = df.tail(lookback)
    hlc3 = (d["High"].values + d["Low"].values + d["Close"].values) / 3
    vol = d["Volume"].values
    sum_v = vol.sum()
    if sum_v == 0:
        return None
    poc = np.sum(hlc3 * vol) / sum_v
    vw_var = np.sum(hlc3 ** 2 * vol) / sum_v - poc ** 2
    vw_std = np.sqrt(max(vw_var, 0))
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
    h, l, c = df["High"].values, df["Low"].values, df["Close"].values
    tr = np.maximum(h[1:] - l[1:], np.maximum(np.abs(h[1:] - c[:-1]), np.abs(l[1:] - c[:-1])))
    if len(tr) < length:
        return None
    return np.mean(tr[-length:])


# ─── Market Context ──────────────────────────────────────────────────────────

def fetch_market_context(cfg):
    """Download VIX, SPY VA state, and sector ETF momentum."""
    ctx = {"vix": None, "spy_state": "unknown", "sector_momentum": {}}

    # VIX
    try:
        vix = yf.download("^VIX", period="5d", interval="1d", progress=False)
        if isinstance(vix.columns, pd.MultiIndex):
            vix.columns = vix.columns.get_level_values(0)
        if not vix.empty:
            ctx["vix"] = float(vix["Close"].iloc[-1])
    except Exception:
        pass

    # SPY VA state
    spy_df = None
    try:
        spy_df = yf.download("SPY", period="1y", interval="1d", progress=False)
        if isinstance(spy_df.columns, pd.MultiIndex):
            spy_df.columns = spy_df.columns.get_level_values(0)
        if not spy_df.empty and len(spy_df) >= cfg["vp_lookback"]:
            vp = calc_vp(spy_df, cfg["vp_lookback"], cfg["va_pct"])
            if vp:
                last_close = float(spy_df["Close"].iloc[-1])
                if last_close > vp["vah"]:
                    ctx["spy_state"] = "above_va"
                elif last_close < vp["val"]:
                    ctx["spy_state"] = "below_va"
                else:
                    ctx["spy_state"] = "in_va"
    except Exception:
        pass
    ctx["spy_df"] = spy_df

    # Sector ETF momentum (10-day return)
    try:
        d = yf.download(SECTOR_ETFS, period="1mo", interval="1d", progress=False)
        if not d.empty:
            if isinstance(d.columns, pd.MultiIndex):
                for etf in SECTOR_ETFS:
                    try:
                        close = d["Close"][etf]
                        if len(close.dropna()) >= 10:
                            ctx["sector_momentum"][etf] = (float(close.iloc[-1]) / float(close.iloc[-10]) - 1) * 100
                    except (KeyError, IndexError):
                        pass
            else:
                # Single ETF fallback
                if len(d) >= 10:
                    close = d["Close"]
                    ctx["sector_momentum"][SECTOR_ETFS[0]] = (float(close.iloc[-1]) / float(close.iloc[-10]) - 1) * 100
    except Exception:
        pass

    vix_str = f"{ctx['vix']:.1f}" if ctx['vix'] else "N/A"
    print(f"  Market: VIX={vix_str} | SPY={ctx['spy_state']} | Sectors={len(ctx['sector_momentum'])}")
    return ctx


# ─── Stock-Level Factors ─────────────────────────────────────────────────────

def calc_stock_factors(df, symbol, cfg):
    """Calculate per-stock scoring factors."""
    factors = {"delta": 0, "va_narrow": False, "poc_slope": 0, "vol_ratio": 0, "earnings_days": None, "atr": 0}

    # Delta approximation: last 10 days
    tail = df.tail(10)
    ranges = (tail["High"] - tail["Low"]).values
    deltas = np.where(ranges > 0, (tail["Close"].values - tail["Open"].values) / ranges * tail["Volume"].values, 0)
    factors["delta"] = float(np.sum(deltas))

    # VA width
    vp = calc_vp(df, cfg["vp_lookback"], cfg["va_pct"])
    atr = calc_atr(df, cfg["atr_len"])
    factors["atr"] = atr if atr else 0
    if vp and atr and atr > 0:
        factors["va_narrow"] = (vp["vah"] - vp["val"]) / atr < 1.5

    # POC slope (20-day)
    if len(df) > cfg["vp_lookback"] + 20:
        vp_old = calc_vp(df.iloc[:-20], cfg["vp_lookback"], cfg["va_pct"])
        if vp and vp_old:
            factors["poc_slope"] = vp["poc"] - vp_old["poc"]

    # Volume ratio
    vol_ma = df["Volume"].iloc[-cfg["vol_ma_len"]:].mean()
    if vol_ma > 0:
        factors["vol_ratio"] = float(df["Volume"].iloc[-1] / vol_ma)

    # Earnings date
    try:
        tk = yf.Ticker(symbol)
        cal = tk.calendar
        if cal is not None:
            if isinstance(cal, pd.DataFrame) and "Earnings Date" in cal.columns:
                ed = pd.Timestamp(cal["Earnings Date"].iloc[0])
            elif isinstance(cal, dict) and "Earnings Date" in cal:
                dates = cal["Earnings Date"]
                ed = pd.Timestamp(dates[0]) if isinstance(dates, list) else pd.Timestamp(dates)
            else:
                ed = None
            if ed is not None:
                factors["earnings_days"] = (ed - pd.Timestamp.now()).days
    except Exception:
        pass

    return factors


# ─── Scoring Engine ──────────────────────────────────────────────────────────

def score_signal(direction, sig_name, factors, market_ctx, sector_etf, has_same_dir_other_lb):
    """
    Score a signal 1-5 based on institutional factors.
    Returns (score, details_dict).
    """
    score = 0
    details = {}
    is_long = direction == "LONG"

    # 1. Market (SPY) alignment
    spy = market_ctx["spy_state"]
    if (is_long and spy in ("above_va", "in_va")) or (not is_long and spy in ("below_va", "in_va")):
        score += 1
        details["大盤"] = "✅"
    else:
        details["大盤"] = "❌"

    # 2. VIX environment
    vix = market_ctx.get("vix")
    if vix is not None:
        # Mean-reversion signals (VA Rejection, Failed Auction) benefit from high VIX
        # Breakout signals benefit from low VIX
        if sig_name in ("VA Rejection", "Failed Auction") and vix >= 20:
            score += 1
            details["VIX"] = "✅"
        elif sig_name == "Breakout Retest" and vix < 20:
            score += 1
            details["VIX"] = "✅"
        else:
            details["VIX"] = "❌"
    else:
        details["VIX"] = "—"

    # 3. Volume strength > 1.5x
    vr = factors["vol_ratio"]
    if vr > 1.5:
        score += 1
        details["量能"] = f"{vr:.1f}x✅"
    else:
        details["量能"] = f"{vr:.1f}x❌"

    # 4. POC/trend alignment (normalized by ATR)
    slope = factors["poc_slope"]
    atr = factors["atr"]
    slope_threshold = atr * 0.1 if atr > 0 else 0
    if (is_long and slope > slope_threshold) or (not is_long and slope < -slope_threshold):
        score += 1
        details["趨勢"] = "✅"
    else:
        details["趨勢"] = "❌"

    # 5. Sector momentum
    mom = market_ctx["sector_momentum"].get(sector_etf)
    if mom is not None:
        if (is_long and mom > 0) or (not is_long and mom < 0):
            score += 1
            details["板塊"] = "✅"
        else:
            details["板塊"] = "❌"
    else:
        details["板塊"] = "—"

    # 6. 60D/120D same direction
    if has_same_dir_other_lb:
        score += 1
        details["雙LB"] = "✅"
    else:
        details["雙LB"] = "❌"

    # 7. Delta alignment
    delta = factors["delta"]
    if (is_long and delta > 0) or (not is_long and delta < 0):
        score += 1
        details["Delta"] = f"{'偏多' if delta > 0 else '偏空'}✅"
    else:
        details["Delta"] = f"{'偏多' if delta > 0 else '偏空'}❌"

    # -1: Earnings within 3 days
    ed = factors["earnings_days"]
    if ed is not None and 0 <= ed <= 3:
        score -= 1
        details["財報"] = f"⚠️{ed}天後"
    elif ed is not None and 0 <= ed <= 7:
        details["財報"] = f"{ed}天後"

    # -1: VA too narrow
    if factors["va_narrow"]:
        score -= 1
        details["VA窄"] = "⚠️"

    score = max(1, min(5, score))
    return score, details


# ─── Signal Detection (unchanged logic) ─────────────────────────────────────

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
    cur, prev = df.iloc[-1], df.iloc[-2]
    o, h, l, c, v = cur["Open"], cur["High"], cur["Low"], cur["Close"], cur["Volume"]
    po, ph, pl, pc = prev["Open"], prev["High"], prev["Low"], prev["Close"]

    vol_ma = df["Volume"].iloc[-cfg["vol_ma_len"]:].mean()
    vol_ratio = v / vol_ma if vol_ma > 0 else 0
    high_vol = vol_ratio > 1.2
    low_vol = vol_ratio < 0.8
    climax_vol = vol_ratio > 2.5

    body = abs(c - o)
    wick_up = h - max(c, o)
    wick_dn = min(c, o) - l
    bull_close = c > o
    bear_close = c < o
    bull_rejection = body > 0 and wick_dn > body * 1.5 and wick_dn > wick_up * 2 and bull_close
    bear_rejection = body > 0 and wick_up > body * 1.5 and wick_up > wick_dn * 2 and bear_close

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

    # Signal 3: Breakout Retest
    confirmed_above, confirmed_below = False, False
    for i in range(-10, -2):
        if i + 1 >= 0:
            break
        b1, b2 = df.iloc[i], df.iloc[i + 1]
        if b1["Close"] > vah and b2["Close"] > vah and b1["Volume"] > vol_ma * 1.2:
            confirmed_above, confirmed_below = True, False
        if b1["Close"] < val and b2["Close"] < val and b1["Volume"] > vol_ma * 1.2:
            confirmed_below, confirmed_above = True, False
        if b1["Close"] > val and b1["Close"] < vah:
            confirmed_above = confirmed_below = False

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


# ─── State Management ────────────────────────────────────────────────────────

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
        return (datetime.now() - datetime.strptime(last, "%Y-%m-%d")).days >= cooldown
    except ValueError:
        return True


# ─── Telegram ────────────────────────────────────────────────────────────────

def send_telegram(message):
    if DRY_RUN or not TELEGRAM_TOKEN or not TELEGRAM_CHAT_ID:
        print(f"[{'DRY-RUN' if DRY_RUN else 'NO TELEGRAM'}] Message length: {len(message)}")
        return
    url = f"https://api.telegram.org/bot{TELEGRAM_TOKEN}/sendMessage"
    # Split by newline to avoid cutting HTML tags
    chunks, current = [], ""
    for line in message.split("\n"):
        if len(current) + len(line) + 1 > 4096:
            chunks.append(current)
            current = line
        else:
            current += ("\n" if current else "") + line
    if current:
        chunks.append(current)
    for chunk in chunks:
        try:
            requests.post(url, json={"chat_id": TELEGRAM_CHAT_ID, "text": chunk, "parse_mode": "HTML"}, timeout=10)
        except Exception as e:
            print(f"Telegram error: {e}")


# ─── Main ────────────────────────────────────────────────────────────────────

def scan_symbol(symbol, df, cfg, lookbacks, state, today, market_ctx):
    """Detect signals for multiple lookbacks, with scoring factors."""
    results = {lb: [] for lb in lookbacks}
    factors_cache = None

    for lb in lookbacks:
        if len(df) < lb + 5:
            continue
        cooldown_key = f"{symbol}_{lb}"
        if not check_cooldown(cooldown_key, state, cfg["cooldown_bars"]):
            continue
        cfg_copy = dict(cfg, vp_lookback=lb)
        sigs = detect_signals(df, cfg_copy)
        if not sigs:
            continue

        # Calculate factors once per symbol (earnings query is expensive)
        if factors_cache is None:
            factors_cache = calc_stock_factors(df, symbol, cfg_copy)

        for sig in sigs:
            direction, name, price, tp, sl = sig
            results[lb].append((symbol, direction, name, price, tp, sl, factors_cache))
            if direction != "WARNING":
                state[cooldown_key] = today

    return results


def apply_scores(all_signals, market_ctx):
    """Apply scoring to all signals, including cross-lookback alignment."""
    lookbacks = list(all_signals.keys())
    scored = {lb: [] for lb in lookbacks}

    # Build direction sets per lookback for cross-LB check
    dir_sets = {}
    for lb in lookbacks:
        dir_sets[lb] = {(sym, d) for sym, d, *_ in all_signals[lb] if d != "WARNING"}

    for lb in lookbacks:
        other_lb = [x for x in lookbacks if x != lb]
        for entry in all_signals[lb]:
            symbol, direction, name, price, tp, sl, factors = entry
            if direction == "WARNING":
                scored[lb].append((symbol, direction, name, price, tp, sl, 0, {}))
                continue

            # Check if same symbol+direction exists in other lookback
            has_same = any((symbol, direction) in dir_sets[olb] for olb in other_lb)
            sector_etf = SECTOR_MAP.get(symbol, "QQQ")
            score, details = score_signal(direction, name, factors, market_ctx, sector_etf, has_same)
            scored[lb].append((symbol, direction, name, price, tp, sl, score, details))

    return scored


def format_signals(signals, lookback):
    if not signals:
        return f"\n<b>📏 {lookback}D Lookback</b>\n✅ No signals\n"

    lines = [f"\n<b>📏 {lookback}D Lookback</b>\n"]
    for entry in signals:
        symbol, direction, name, price, tp, sl, score, details = entry
        emoji = "🟢" if direction == "LONG" else "🔴" if direction == "SHORT" else "⚠️"

        if direction == "WARNING":
            lines.append(f"{emoji} <b>{symbol}</b> {direction} ({name})")
            lines.append(f"   Price: {price:.2f} | Vol Ratio: {sl:.1f}x\n")
        else:
            stars = "⭐" * score
            lines.append(f"{emoji} <b>{symbol}</b> {direction} ({name}) {stars} ({score}/5)")
            lines.append(f"   Entry: {price:.2f} | TP: {tp:.2f} | SL: {sl:.2f}")
            # Factor summary line
            parts = [f"{k}{v}" for k, v in details.items()]
            lines.append(f"   📊 {' '.join(parts)}\n")

    return "\n".join(lines)


def main():
    cfg = CONFIG
    state = load_state()
    today = datetime.now().strftime("%Y-%m-%d")
    lookbacks = [60, 120]

    print(f"[{today}] Scanning {len(cfg['symbols'])} symbols (60D + 120D)...")
    print("  Fetching market context...")
    market_ctx = fetch_market_context(cfg)

    all_signals = {lb: [] for lb in lookbacks}
    for symbol in cfg["symbols"]:
        try:
            # Reuse SPY df from market context
            if symbol == "SPY" and market_ctx.get("spy_df") is not None:
                df = market_ctx["spy_df"]
            else:
                df = yf.download(symbol, period="1y", interval="1d", progress=False)
                if df.empty:
                    continue
                if isinstance(df.columns, pd.MultiIndex):
                    df.columns = df.columns.get_level_values(0)
            res = scan_symbol(symbol, df, cfg, lookbacks, state, today, market_ctx)
            for lb in lookbacks:
                all_signals[lb].extend(res[lb])
        except Exception as e:
            print(f"Error scanning {symbol}: {e}")

    # Apply scores (needs all signals for cross-LB check)
    scored = apply_scores(all_signals, market_ctx)

    # Format message
    msg = f"<b>📊 VP Signals — {today}</b>\n"
    msg += f"Scanned {len(cfg['symbols'])} symbols"
    if market_ctx["vix"]:
        msg += f" | VIX: {market_ctx['vix']:.1f} | SPY: {market_ctx['spy_state']}"
    msg += "\n"
    for lb in lookbacks:
        msg += format_signals(scored[lb], lb)

    send_telegram(msg)
    print(msg)
    save_state(state)


if __name__ == "__main__":
    main()
