"""
AI analysis module — uses Gemini to analyze signals with full OHLCV context.
"""

import os
import json
import pandas as pd
import numpy as np

GEMINI_API_KEY = os.environ.get("GEMINI_API_KEY", "")


def calc_rsi(df, period=14):
    delta = df["Close"].diff()
    gain = delta.where(delta > 0, 0).rolling(period).mean()
    loss = (-delta.where(delta < 0, 0)).rolling(period).mean()
    rs = gain / loss
    return 100 - (100 / (1 + rs))


def calc_ema(series, period):
    return series.ewm(span=period, adjust=False).mean()


def calc_macd(df):
    ema12 = calc_ema(df["Close"], 12)
    ema26 = calc_ema(df["Close"], 26)
    macd = ema12 - ema26
    signal = calc_ema(macd, 9)
    return macd, signal


def build_prompt(symbol, df, signals, market_ctx, vp_data=None, factors=None):
    """Build analysis prompt with OHLCV + indicators + VP structure."""
    # Recent 20 days OHLCV
    recent = df.tail(20)
    ohlcv_str = "Date | Open | High | Low | Close | Volume\n"
    for idx, row in recent.iterrows():
        date = idx.strftime("%m/%d") if hasattr(idx, "strftime") else str(idx)[:10]
        ohlcv_str += f"{date} | {row['Open']:.2f} | {row['High']:.2f} | {row['Low']:.2f} | {row['Close']:.2f} | {int(row['Volume']):,}\n"

    # Indicators
    rsi = calc_rsi(df).iloc[-1]
    macd, macd_signal = calc_macd(df)
    ema20 = calc_ema(df["Close"], 20).iloc[-1]
    ema50 = calc_ema(df["Close"], 50).iloc[-1]
    atr = df["High"].tail(14).values - df["Low"].tail(14).values
    atr_val = np.mean(atr)
    vol_avg = df["Volume"].tail(21).mean()
    vol_today = df["Volume"].iloc[-1]

    indicators = f"""RSI(14): {rsi:.1f}
MACD: {macd.iloc[-1]:.2f} | Signal: {macd_signal.iloc[-1]:.2f} | {'多頭' if macd.iloc[-1] > macd_signal.iloc[-1] else '空頭'}
EMA20: {ema20:.2f} | EMA50: {ema50:.2f} | 價格{'在EMA20上' if df['Close'].iloc[-1] > ema20 else '在EMA20下'}
ATR(14): {atr_val:.2f}
成交量: {int(vol_today):,} ({'放量' if vol_today > vol_avg * 1.5 else '正常' if vol_today > vol_avg * 0.8 else '縮量'}, {vol_today/vol_avg:.1f}x 均量)"""

    # VP structure
    vp_str = "無資料"
    if vp_data:
        close = df["Close"].iloc[-1]
        pos = "在VA內" if vp_data["val"] < close < vp_data["vah"] else "在VA上方" if close > vp_data["vah"] else "在VA下方"
        vp_str = f"VAH: {vp_data['vah']:.2f} | POC: {vp_data['poc']:.2f} | VAL: {vp_data['val']:.2f} | 價格{pos}"

    # Institutional trend + regime + score details
    factors_str = "無資料"
    if factors:
        trend = factors.get("inst_trend", "NEUTRAL")
        regime = factors.get("regime", "unknown")
        score_details = factors.get("score_details", {})
        swing = factors.get("swing_points", {})

        factors_str = f"機構趨勢: {trend} | Regime: {regime}"
        if score_details:
            gate = " ".join(f"{k}{v}" for k, v in score_details.items() if k in ("量能", "趨勢"))
            bonus = " ".join(f"{k}{v}" for k, v in score_details.items() if k not in ("量能", "趨勢", "Regime"))
            factors_str += f"\n評分細節: 🔑 {gate} | 📊 {bonus}"
        if swing:
            factors_str += f"\nSwing High: {swing.get('high', 'N/A')} | Swing Low: {swing.get('low', 'N/A')}"

    # Signals
    signal_str = ""
    if signals:
        for sig in signals:
            signal_str += f"- {sig['direction']} {sig['type']} | Entry: {sig['entry']:.2f} | TP: {sig['tp']:.2f} | SL: {sig['sl']:.2f} | Score: {sig['score']}/5\n"
    else:
        signal_str = "- 無信號觸發\n"

    # Market context
    vix = market_ctx.get("vix", "N/A")
    spy = market_ctx.get("spy_va_pos", "N/A")

    prompt = f"""你是專業的量化交易分析師。請分析以下股票的技術面，給出交易建議。

## {symbol} 近20日 OHLCV
{ohlcv_str}

## 技術指標
{indicators}

## Volume Profile 結構
{vp_str}

## 機構分析
{factors_str}

## VP 信號
{signal_str}

## 市場環境
VIX: {vix} | SPY: {spy}

## 請分析：
1. 趨勢判斷（多頭/空頭/盤整）+ 理由
2. 關鍵支撐壓力位（2-3個）
3. 對 VP 信號的看法（是否值得進場）
4. 風險提醒
5. 最終建議：進場 / 觀望 / 跳過

請用繁體中文回答，簡潔扼要（200字以內）。"""

    return prompt


def call_gemini(prompt):
    """Call Gemini API using official SDK."""
    import time
    if not GEMINI_API_KEY:
        return "⚠️ GEMINI_API_KEY 未設定"

    try:
        from google import genai
        client = genai.Client(api_key=GEMINI_API_KEY)

        for attempt in range(3):
            try:
                response = client.models.generate_content(
                    model="gemini-2.5-flash",
                    contents=prompt,
                )
                return response.text
            except Exception as e:
                if "429" in str(e) or "RESOURCE_EXHAUSTED" in str(e):
                    time.sleep(10 * (attempt + 1))
                    continue
                return f"⚠️ API error: {e}"

        return "⚠️ API rate limited, retry later"
    except ImportError:
        return "⚠️ google-genai not installed"
    except Exception as e:
        return f"⚠️ API error: {e}"


def analyze_signals(symbols_data, market_ctx):
    """Analyze signals for symbols that have VP signals.
    
    symbols_data: list of {"symbol", "df", "signals", "vp_data", "factors"}
    Returns: dict of {symbol: ai_analysis_text}
    """
    results = {}
    import time

    for i, item in enumerate(symbols_data):
        if i > 0:
            time.sleep(4)  # Gemini free: max 15 req/min
        symbol = item["symbol"]
        df = item["df"]
        signals = item["signals"]
        vp_data = item.get("vp_data")
        factors = item.get("factors")

        prompt = build_prompt(symbol, df, signals, market_ctx, vp_data, factors)
        analysis = call_gemini(prompt)
        results[symbol] = analysis

    return results
