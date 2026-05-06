"""
Pre-market watchlist — runs before market open.
Identifies symbols where yesterday's close is near VA edges.
"""

import sys
from config import SYMBOLS, DEFAULT_CFG
from core.data import download_symbol
from core.indicators import calc_vp, calc_atr
from notifications.telegram import send_telegram

DRY_RUN = "--dry-run" in sys.argv
PROXIMITY_PCT = 0.02  # within 2% of VA edge


def calc_watchlist(symbols, cfg):
    """Find symbols near VA edges."""
    watchlist = []

    for symbol in symbols:
        df = download_symbol(symbol)
        if df is None or len(df) < cfg["vp_lookback"] + 5:
            continue

        for lb in [60, 120]:
            if len(df) < lb + 5:
                continue
            vp = calc_vp(df, lb, cfg["va_pct"])
            atr = calc_atr(df, cfg["atr_len"])
            if not vp or not atr:
                continue

            close = float(df["Close"].iloc[-1])
            vah, val, poc = vp["vah"], vp["val"], vp["poc"]

            dist_val = (close - val) / close if close != 0 else 999
            dist_vah = (vah - close) / close if close != 0 else 999

            # Near VAL — potential LONG
            if 0 < dist_val <= PROXIMITY_PCT:
                watchlist.append({
                    "symbol": symbol, "lookback": lb,
                    "level": "VAL", "level_price": val,
                    "close": close, "dist_pct": dist_val * 100,
                    "potential": "VA Rejection LONG",
                    "atr": atr,
                })

            # Near VAH — potential SHORT
            if 0 < dist_vah <= PROXIMITY_PCT:
                watchlist.append({
                    "symbol": symbol, "lookback": lb,
                    "level": "VAH", "level_price": vah,
                    "close": close, "dist_pct": dist_vah * 100,
                    "potential": "VA Rejection SHORT",
                    "atr": atr,
                })

            # Already broke out, might retest
            if close > vah and (close - vah) / atr < 1.0:
                watchlist.append({
                    "symbol": symbol, "lookback": lb,
                    "level": "VAH (above)", "level_price": vah,
                    "close": close, "dist_pct": (close - vah) / close * 100,
                    "potential": "Breakout Retest LONG",
                    "atr": atr,
                })

            if close < val and (val - close) / atr < 1.0:
                watchlist.append({
                    "symbol": symbol, "lookback": lb,
                    "level": "VAL (below)", "level_price": val,
                    "close": close, "dist_pct": (val - close) / close * 100,
                    "potential": "Breakout Retest SHORT",
                    "atr": atr,
                })

    return watchlist


def format_watchlist(watchlist):
    """Format watchlist into Telegram message."""
    from datetime import datetime
    today = datetime.now().strftime("%Y-%m-%d")

    if not watchlist:
        return f"<b>📋 今日觀察清單 — {today}</b>\n\n✅ 無接近 VA 邊緣的標的\n"

    watchlist.sort(key=lambda x: x["dist_pct"])

    lines = [f"<b>📋 今日觀察清單 — {today}</b>\n"]
    lines.append("以下標的接近 VA 關鍵位，今日可能觸發信號：\n")

    seen = set()
    for item in watchlist:
        key = (item["symbol"], item["lookback"], item["level"])
        if key in seen:
            continue
        seen.add(key)

        emoji = "🟢" if "LONG" in item["potential"] else "🔴"
        lines.append(
            f"{emoji} <b>{item['symbol']}</b> ({item['lookback']}D) "
            f"— 距 {item['level']} {item['dist_pct']:.1f}%"
        )
        lines.append(
            f"   關鍵位: <code>{item['level_price']:.2f}</code> | "
            f"昨收: <code>{item['close']:.2f}</code>"
        )
        lines.append(f"   若觸發 → {item['potential']}")
        lines.append("")

    count = len(seen)
    lines.append(f"共 {count} 個觀察目標")
    return "\n".join(lines)


def main():
    print("Calculating pre-market watchlist...")
    cfg = DEFAULT_CFG
    watchlist = calc_watchlist(SYMBOLS, cfg)
    msg = format_watchlist(watchlist)
    send_telegram(msg, dry_run=DRY_RUN)
    print(msg)


if __name__ == "__main__":
    main()
