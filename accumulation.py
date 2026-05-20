"""Accumulation Detection v3 — identifies steady institutional buying.

Indicators:
1. OBV Trend: On-Balance Volume rising while price flat
2. Close Position: Consistently closing in upper half of bar
3. Volume Asymmetry: Rally volume > pullback volume
4. Price Tightening: ATR compressing (rolling, not half-split)
5. Buying Streak: Consecutive days closing in upper half (not just count)
6. Relative Strength vs SPY: Holds up when market drops
7. Price Position Guard: Discount near ATH without pullback

Usage:
    python accumulation.py NVDA
    python accumulation.py NVDA,AVGO,AMD --days 40
"""

import argparse
import os
import yfinance as yf
import pandas as pd
import numpy as np


def _download_spy():
    """Download SPY for relative strength comparison."""
    df = yf.download("SPY", period="6mo", progress=False)
    if isinstance(df.columns, pd.MultiIndex):
        df.columns = df.columns.get_level_values(0)
    return df if not df.empty else None


def detect_accumulation(df, spy_df=None, lookback=40):
    """Analyze volume behavior for signs of institutional accumulation."""
    if len(df) < lookback + 10:
        return None

    d = df.tail(lookback).copy()
    c = d["Close"].values
    o = d["Open"].values
    h = d["High"].values
    l = d["Low"].values
    v = d["Volume"].values.astype(float)
    n = len(d)

    # Spike filter: cap > 3x avg
    vol_avg = np.mean(v)
    v_clean = np.where(v > 3 * vol_avg, vol_avg, v)

    # Bar properties
    bar_range = h - l
    close_pos = np.where(bar_range > 0, (c - l) / bar_range, 0.5)

    results = {}

    # ─── 1. OBV Trend ───
    obv = np.zeros(n)
    for i in range(1, n):
        if c[i] > c[i-1]:
            obv[i] = obv[i-1] + v_clean[i]
        elif c[i] < c[i-1]:
            obv[i] = obv[i-1] - v_clean[i]
        else:
            obv[i] = obv[i-1]

    x = np.arange(n)
    obv_slope = np.polyfit(x, obv, 1)[0]
    price_slope = np.polyfit(x, c, 1)[0]
    price_flat = abs(price_slope / c[0]) < 0.001

    obv_score = 0
    if obv_slope > 0 and price_flat:
        obv_score = 3
    elif obv_slope > 0 and price_slope > 0:
        obv_score = 2
    elif obv_slope > 0:
        obv_score = 1

    results["obv"] = {
        "score": obv_score,
        "signal": "OBV rising + price flat → absorption" if obv_score == 3 else
                  "OBV rising + price up → trend buying" if obv_score == 2 else "Weak/None",
    }

    # ─── 2. Close Position ───
    avg_close_pos = np.mean(close_pos[-20:])
    lower_wick = np.minimum(c, o) - l
    body = np.abs(c - o)
    wick_days = int(np.sum(lower_wick[-20:] > np.where(body[-20:] > 0, body[-20:] * 1.2, 0.01)))

    close_score = 0
    if avg_close_pos >= 0.65 and wick_days >= 8:
        close_score = 3
    elif avg_close_pos >= 0.6 or wick_days >= 6:
        close_score = 2
    elif avg_close_pos >= 0.55:
        close_score = 1

    results["close_position"] = {
        "score": close_score,
        "avg_close_pos": round(float(avg_close_pos), 2),
        "wick_days": wick_days,
        "signal": f"Avg close at {avg_close_pos:.0%} of bar | {wick_days} lower-wick days",
    }

    # ─── 3. Volume Asymmetry ───
    rally_vol = [v_clean[i] for i in range(1, n) if c[i] > c[i-1]]
    pullback_vol = [v_clean[i] for i in range(1, n) if c[i] < c[i-1]]
    avg_rally = np.mean(rally_vol) if rally_vol else 0
    avg_pullback = np.mean(pullback_vol) if pullback_vol else 1
    vol_asymmetry = avg_rally / max(avg_pullback, 1)

    vol_score = 0
    if vol_asymmetry >= 1.4:
        vol_score = 3
    elif vol_asymmetry >= 1.2:
        vol_score = 2
    elif vol_asymmetry >= 1.1:
        vol_score = 1

    results["volume_asymmetry"] = {
        "score": vol_score,
        "ratio": round(float(vol_asymmetry), 2),
        "signal": f"Rally volume {vol_asymmetry:.2f}x pullback volume",
    }

    # ─── 4. Price Tightening (ATR rolling) ───
    tr = np.zeros(n)
    tr[1:] = np.maximum(h[1:] - l[1:], np.maximum(np.abs(h[1:] - c[:-1]), np.abs(l[1:] - c[:-1])))
    recent_atr = np.mean(tr[-10:]) if n >= 10 else np.mean(tr)
    hist_atr = np.mean(tr[-30:-10]) if n >= 30 else np.mean(tr[:n//2])
    atr_ratio = recent_atr / max(hist_atr, 0.01)

    # Volume during compression
    recent_vol = np.mean(v_clean[-10:])
    hist_vol = np.mean(v_clean[-30:-10]) if n >= 30 else np.mean(v_clean[:n//2])
    vol_during_compression = recent_vol / max(hist_vol, 1)

    tight_score = 0
    if atr_ratio < 0.6 and vol_during_compression >= 0.85:
        tight_score = 3
    elif atr_ratio < 0.7 and vol_during_compression >= 0.8:
        tight_score = 2
    elif atr_ratio < 0.8:
        tight_score = 1

    results["tightening"] = {
        "score": tight_score,
        "atr_ratio": round(float(atr_ratio), 2),
        "vol_maintained": round(float(vol_during_compression), 2),
        "signal": f"ATR ratio {atr_ratio:.2f} | Vol maintained {vol_during_compression:.0%}" +
                  (" → coiling" if tight_score >= 2 else ""),
    }

    # ─── 5. Buying Streak (consecutive days close > 55%) ───
    max_streak = 0
    current_streak = 0
    for i in range(n):
        if close_pos[i] > 0.55:
            current_streak += 1
            max_streak = max(max_streak, current_streak)
        else:
            current_streak = 0

    # Also count recent streak (from end)
    recent_streak = 0
    for i in range(n-1, -1, -1):
        if close_pos[i] > 0.55:
            recent_streak += 1
        else:
            break

    streak_score = 0
    if max_streak >= 7 or recent_streak >= 5:
        streak_score = 3
    elif max_streak >= 5 or recent_streak >= 3:
        streak_score = 2
    elif max_streak >= 3:
        streak_score = 1

    results["buying_streak"] = {
        "score": streak_score,
        "max_streak": max_streak,
        "recent_streak": recent_streak,
        "signal": f"Max streak: {max_streak} days | Current: {recent_streak} days closing in upper half",
    }

    # ─── 6. Relative Strength vs SPY ───
    rs_score = 0
    rs_signal = "SPY data not available"

    if spy_df is not None and len(spy_df) >= lookback:
        spy_tail = spy_df.tail(lookback)
        if len(spy_tail) == n:
            spy_c = spy_tail["Close"].values
            # Days where SPY dropped but stock held/rose
            stock_returns = np.diff(c) / c[:-1]
            spy_returns = np.diff(spy_c) / spy_c[:-1]

            spy_down_days = spy_returns < -0.003  # SPY down > 0.3%
            if np.sum(spy_down_days) > 0:
                stock_on_spy_down = stock_returns[spy_down_days]
                # How many of those days did stock hold up (not drop as much)?
                held_up = np.sum(stock_on_spy_down > spy_returns[spy_down_days] + 0.005)
                total_spy_down = np.sum(spy_down_days)
                hold_ratio = held_up / total_spy_down

                # Overall relative performance
                stock_total = (c[-1] / c[0] - 1) * 100
                spy_total = (spy_c[-1] / spy_c[0] - 1) * 100
                relative_perf = stock_total - spy_total

                if hold_ratio >= 0.6 and relative_perf > 0:
                    rs_score = 3
                elif hold_ratio >= 0.5 or relative_perf > 3:
                    rs_score = 2
                elif hold_ratio >= 0.4:
                    rs_score = 1

                rs_signal = f"Held up {hold_ratio:.0%} of SPY-down days | Relative: {relative_perf:+.1f}%"
            else:
                rs_signal = "No SPY down days in period"

    results["relative_strength"] = {
        "score": rs_score,
        "signal": rs_signal,
    }

    # ─── 7. Price Position Guard ───
    full_high = df["High"].max()
    full_low = df["Low"].min()
    full_range = full_high - full_low
    current_pos = (c[-1] - full_low) / max(full_range, 0.01)

    # Check if there was a pullback from high (> 15% from ATH = OK)
    ath = df["High"].max()
    pullback_from_ath = (ath - c[-1]) / ath

    position_discount = 1.0
    if current_pos > 0.85 and pullback_from_ath < 0.05:
        position_discount = 0.4  # Near ATH, no pullback → likely distribution
    elif current_pos > 0.75 and pullback_from_ath < 0.08:
        position_discount = 0.6
    elif pullback_from_ath > 0.15:
        position_discount = 1.2  # Pulled back 15%+ and consolidating → accumulation zone

    results["price_position"] = {
        "position_pct": round(float(current_pos * 100), 1),
        "pullback_from_ath": round(float(pullback_from_ath * 100), 1),
        "discount": position_discount,
        "signal": (f"Price at {current_pos:.0%} of range | {pullback_from_ath:.0%} from ATH" +
                  (" ⚠️ near ATH no pullback" if position_discount < 1.0 else
                   " ✅ pullback zone" if position_discount > 1.0 else "")),
    }

    # ─── Composite Score ───
    raw_total = obv_score + close_score + vol_score + tight_score + streak_score + rs_score  # max 18
    adjusted_total = round(raw_total * position_discount)
    adjusted_total = max(0, min(18, adjusted_total))

    level = "🟢 STRONG" if adjusted_total >= 11 else "🟡 MODERATE" if adjusted_total >= 7 else "⚪ WEAK"

    results["composite"] = {
        "raw_score": raw_total,
        "adjusted_score": adjusted_total,
        "max": 18,
        "level": level,
        "conclusion": (
            "Clear institutional accumulation — steady buying detected" if adjusted_total >= 11 else
            "Some accumulation signs — monitor for breakout" if adjusted_total >= 7 else
            "No clear accumulation pattern"
        ),
    }

    return results


def main():
    parser = argparse.ArgumentParser(description="Accumulation Detection")
    parser.add_argument("symbols", type=str, nargs="?", default="", help="Comma-separated symbols")
    parser.add_argument("--days", type=int, default=40, help="Lookback days (default: 40)")
    parser.add_argument("--notify", action="store_true", help="Send Telegram notification")
    args = parser.parse_args()

    from config import SYMBOLS as DEFAULT_SYMBOLS
    symbols = [s.strip() for s in args.symbols.split(",") if s.strip()] if args.symbols else DEFAULT_SYMBOLS

    print(f"{'═'*60}")
    print(f"  ACCUMULATION ANALYSIS v3 (lookback: {args.days} days)")
    print(f"{'═'*60}\n")

    spy_df = _download_spy()
    results_all = []

    for symbol in symbols:
        df = yf.download(symbol, period="6mo", progress=False)
        if df.empty:
            continue
        if isinstance(df.columns, pd.MultiIndex):
            df.columns = df.columns.get_level_values(0)

        result = detect_accumulation(df, spy_df, args.days)
        if not result:
            continue

        comp = result["composite"]
        pos = result["price_position"]
        results_all.append((symbol, result))

        print(f"  {comp['level']} {symbol} — Score: {comp['adjusted_score']}/{comp['max']} (raw: {comp['raw_score']})")
        print(f"  {comp['conclusion']}")
        print(f"  {'─'*50}")
        print(f"  OBV:         {result['obv']['signal']} ({result['obv']['score']}/3)")
        print(f"  Close Pos:   {result['close_position']['signal']} ({result['close_position']['score']}/3)")
        print(f"  Vol Asym:    {result['volume_asymmetry']['signal']} ({result['volume_asymmetry']['score']}/3)")
        print(f"  Tightening:  {result['tightening']['signal']} ({result['tightening']['score']}/3)")
        print(f"  Streak:      {result['buying_streak']['signal']} ({result['buying_streak']['score']}/3)")
        print(f"  Rel Strength:{result['relative_strength']['signal']} ({result['relative_strength']['score']}/3)")
        print(f"  Position:    {pos['signal']} (×{pos['discount']})")
        print()

    # Telegram notification
    if args.notify or os.environ.get("TELEGRAM_BOT_TOKEN"):
        from notifications.telegram import send_telegram
        strong = [(s, r) for s, r in results_all if r["composite"]["adjusted_score"] >= 11]
        moderate = [(s, r) for s, r in results_all if 7 <= r["composite"]["adjusted_score"] < 11]

        if strong or moderate:
            msg = "<b>🔍 Accumulation Scan</b>\n"
            msg += f"Scanned {len(symbols)} symbols | {len(strong)} strong | {len(moderate)} moderate\n\n"

            for symbol, r in strong:
                comp = r["composite"]
                msg += f"🟢 <b>{symbol}</b> — {comp['adjusted_score']}/{comp['max']}\n"
                msg += f"   {r['obv']['signal']}\n"
                msg += f"   {r['buying_streak']['signal']}\n"
                msg += f"   {r['relative_strength']['signal']}\n\n"

            for symbol, r in moderate[:5]:
                comp = r["composite"]
                msg += f"🟡 <b>{symbol}</b> — {comp['adjusted_score']}/{comp['max']}\n"

            send_telegram(msg, dry_run=not args.notify)
        else:
            print("  No accumulation signals to notify.")


if __name__ == "__main__":
    main()
