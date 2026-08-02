"""Indicator Scan Page — Unified view for MACD, FVG, and Liquidity indicators.

Provides a single page with indicator selector to reduce page clutter.
Each indicator scans all symbols and displays actionable results.

Read-only — no file writes, no strategy computation.
"""

import streamlit as st
import pandas as pd
import numpy as np

from config import SYMBOLS
from core.data_provider import YahooProvider
from core.indicators import (
    calc_macd,
    detect_macd_divergence,
    detect_fvg,
    resample_to_weekly,
)
from strategies.inst_trend import _liquidity_sweep


# ─── Data Loading ───────────────────────────────────────────────────────────

@st.cache_data(ttl=900, show_spinner=False)
def _batch_download(symbols):
    """Batch download daily data for all symbols (cached 15 min)."""
    try:
        provider = YahooProvider(max_workers=5, jitter=(0.1, 0.3))
        return provider.batch_daily(symbols, period="1y")
    except Exception as e:
        st.error(f"資料下載失敗: {e}")
        return {}


# ─── MACD Divergence Section ────────────────────────────────────────────────

def _render_macd_divergence(data):
    """Render MACD divergence scan results."""
    st.markdown("## 📉 MACD 背離掃描")
    st.markdown("""
    偵測 **日線 + 周線** 的 MACD 背離。雙重背離（日線與周線同向）是最強信號。

    - 🟢 **看漲背離**：價格創新低，但 MACD 未創新低 → 下跌動能衰竭
    - 🔴 **看跌背離**：價格創新高，但 MACD 未創新高 → 上漲動能衰竭
    """)

    with st.spinner("掃描 MACD 背離中..."):
        dual_results = []
        daily_results = []
        weekly_results = []

        for symbol, df in data.items():
            if df is None or len(df) < 60:
                continue

            # Daily divergence
            daily_divs = detect_macd_divergence(
                df, lookback=60, swing_lookback=5, max_bars_ago=10
            )

            # Weekly divergence
            weekly_df = resample_to_weekly(df)
            weekly_divs = []
            if weekly_df is not None and len(weekly_df) >= 35:
                weekly_divs = detect_macd_divergence(
                    weekly_df, lookback=30, swing_lookback=3, max_bars_ago=10
                )

            if not daily_divs and not weekly_divs:
                continue

            # Check for dual divergence
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

            last_price = float(df["Close"].iloc[-1])

            if is_dual:
                dual_results.append({
                    "symbol": symbol,
                    "type": dual_type,
                    "price": last_price,
                    "daily": daily_divs,
                    "weekly": weekly_divs,
                })
            elif daily_divs:
                daily_results.append({
                    "symbol": symbol,
                    "divs": daily_divs,
                    "price": last_price,
                })
            elif weekly_divs:
                weekly_results.append({
                    "symbol": symbol,
                    "divs": weekly_divs,
                    "price": last_price,
                })

    # ─── Display Results ───
    total = len(dual_results) + len(daily_results) + len(weekly_results)
    st.markdown(f"**共 {total} 檔有背離訊號** — 🔥 雙重: {len(dual_results)} | 日線: {len(daily_results)} | 周線: {len(weekly_results)}")
    st.markdown("---")

    # Dual Divergence
    if dual_results:
        st.markdown("### 🔥 雙重背離（日線 + 周線同向）")
        for r in sorted(dual_results, key=lambda x: x["symbol"]):
            emoji = "🟢" if r["type"] == "bullish" else "🔴"
            direction = "看漲" if r["type"] == "bullish" else "看跌"
            st.markdown(f"{emoji} **{r['symbol']}** — {direction} | 價格 ${r['price']:.2f}")
            dd = next((d for d in r["daily"] if d["type"] == r["type"]), None)
            wd = next((d for d in r["weekly"] if d["type"] == r["type"]), None)
            if dd:
                st.caption(f"　日線: ${dd['price_prev']:.2f} → ${dd['price_curr']:.2f} (MACD {dd['macd_prev']:.4f} → {dd['macd_curr']:.4f}) | {dd['bars_ago']} bar ago")
            if wd:
                st.caption(f"　周線: ${wd['price_prev']:.2f} → ${wd['price_curr']:.2f} (MACD {wd['macd_prev']:.4f} → {wd['macd_curr']:.4f}) | {wd['bars_ago']} bar ago")
        st.markdown("---")

    # Daily Only
    if daily_results:
        st.markdown("### 📊 日線背離")
        for r in sorted(daily_results, key=lambda x: x["symbol"]):
            for d in r["divs"]:
                emoji = "🟢" if d["type"] == "bullish" else "🔴"
                direction = "看漲" if d["type"] == "bullish" else "看跌"
                st.markdown(
                    f"{emoji} **{r['symbol']}** — {direction} | "
                    f"${d['price_prev']:.2f} → ${d['price_curr']:.2f} | "
                    f"{d['bars_ago']} bar ago"
                )
        st.markdown("---")

    # Weekly Only
    if weekly_results:
        st.markdown("### 📅 周線背離")
        for r in sorted(weekly_results, key=lambda x: x["symbol"]):
            for d in r["divs"]:
                emoji = "🟢" if d["type"] == "bullish" else "🔴"
                direction = "看漲" if d["type"] == "bullish" else "看跌"
                st.markdown(
                    f"{emoji} **{r['symbol']}** — {direction} | "
                    f"${d['price_prev']:.2f} → ${d['price_curr']:.2f} | "
                    f"{d['bars_ago']} bar ago"
                )

    if total == 0:
        st.info("目前無 MACD 背離訊號。")


# ─── FVG Section ────────────────────────────────────────────────────────────

def _render_fvg(data):
    """Render FVG (Fair Value Gap) scan results."""
    st.markdown("## 📐 FVG (Fair Value Gap) 掃描")
    st.markdown("""
    偵測日線級別的 **公允價值缺口**。FVG 是價格快速移動留下的未交易區域，通常作為支撐/阻力。

    - 🟢 **看漲 FVG**：向上跳空缺口（未填補 = 下方支撐）
    - 🔴 **看跌 FVG**：向下跳空缺口（未填補 = 上方阻力）
    - **已填補** 的 FVG 已失效，只顯示 **未填補** 的有效缺口
    """)

    col1, col2 = st.columns(2)
    with col1:
        show_filled = st.checkbox("也顯示已填補的 FVG", value=False)
    with col2:
        max_age = st.slider("最近 N 天內的 FVG", 10, 60, 30)

    with st.spinner("掃描 FVG 中..."):
        bullish_fvgs = []
        bearish_fvgs = []

        for symbol, df in data.items():
            if df is None or len(df) < 30:
                continue

            fvgs = detect_fvg(df, lookback=max_age + 2, min_gap_atr_ratio=0.5)
            last_price = float(df["Close"].iloc[-1])

            for fvg in fvgs:
                if not show_filled and fvg["filled"]:
                    continue

                entry = {
                    "symbol": symbol,
                    "price": last_price,
                    **fvg,
                }

                # Calculate distance from current price to gap
                if fvg["type"] == "bullish":
                    entry["distance_pct"] = round(
                        (last_price - fvg["gap_high"]) / last_price * 100, 1
                    )
                    bullish_fvgs.append(entry)
                else:
                    entry["distance_pct"] = round(
                        (fvg["gap_low"] - last_price) / last_price * 100, 1
                    )
                    bearish_fvgs.append(entry)

    # Sort: closest to current price first (most actionable)
    bullish_fvgs.sort(key=lambda x: abs(x["distance_pct"]))
    bearish_fvgs.sort(key=lambda x: abs(x["distance_pct"]))

    total = len(bullish_fvgs) + len(bearish_fvgs)
    st.markdown(f"**共 {total} 個有效 FVG** — 🟢 看漲: {len(bullish_fvgs)} | 🔴 看跌: {len(bearish_fvgs)}")
    st.markdown("---")

    # ─── Bullish FVGs (support zones) ───
    if bullish_fvgs:
        st.markdown("### 🟢 看漲 FVG（下方支撐缺口）")
        st.markdown("價格若回踩到這些缺口區域，可能獲得支撐反彈。")

        # Group by symbol for cleaner display
        df_bull = pd.DataFrame(bullish_fvgs)
        df_bull_display = df_bull[["symbol", "price", "gap_low", "gap_high", "gap_size", "fill_pct", "distance_pct", "date"]].copy()
        df_bull_display.columns = ["標的", "現價", "缺口下緣", "缺口上緣", "缺口大小", "填補%", "距離%", "日期"]
        df_bull_display["填補%"] = (df_bull_display["填補%"] * 100).round(0).astype(int).astype(str) + "%"

        st.dataframe(
            df_bull_display,
            use_container_width=True,
            hide_index=True,
        )
        st.markdown("---")

    # ─── Bearish FVGs (resistance zones) ───
    if bearish_fvgs:
        st.markdown("### 🔴 看跌 FVG（上方阻力缺口）")
        st.markdown("價格若反彈到這些缺口區域，可能遇到阻力回落。")

        df_bear = pd.DataFrame(bearish_fvgs)
        df_bear_display = df_bear[["symbol", "price", "gap_low", "gap_high", "gap_size", "fill_pct", "distance_pct", "date"]].copy()
        df_bear_display.columns = ["標的", "現價", "缺口下緣", "缺口上緣", "缺口大小", "填補%", "距離%", "日期"]
        df_bear_display["填補%"] = (df_bear_display["填補%"] * 100).round(0).astype(int).astype(str) + "%"

        st.dataframe(
            df_bear_display,
            use_container_width=True,
            hide_index=True,
        )

    if total == 0:
        st.info("目前無有效 FVG 訊號（可能已全數填補）。")


# ─── Liquidity Sweep Section ───────────────────────────────────────────────

def _render_liquidity(data):
    """Render Liquidity Sweep scan results."""
    st.markdown("## 💧 Liquidity Sweep 掃描")
    st.markdown("""
    偵測 **流動性掃蕩**：價格突破 swing high/low 後迅速反轉。
    機構利用止損單提供的流動性建立部位。

    - 🟢 **Bull Sweep**：掃蕩 swing low 後反轉向上（止損獵殺後反彈）
    - 🔴 **Bear Sweep**：掃蕩 swing high 後反轉向下（假突破後回落）
    """)

    with st.spinner("掃描 Liquidity Sweep 中..."):
        bull_sweeps = []
        bear_sweeps = []

        for symbol, df in data.items():
            if df is None or len(df) < 25:
                continue

            sweep = _liquidity_sweep(df, lookback=20)
            if sweep is None:
                continue

            last_price = float(df["Close"].iloc[-1])
            entry = {
                "symbol": symbol,
                "price": last_price,
                "sweep_type": sweep,
            }

            if sweep == "bull_sweep":
                bull_sweeps.append(entry)
            elif sweep == "bear_sweep":
                bear_sweeps.append(entry)

    total = len(bull_sweeps) + len(bear_sweeps)
    st.markdown(f"**共 {total} 檔有 Sweep 訊號** — 🟢 Bull: {len(bull_sweeps)} | 🔴 Bear: {len(bear_sweeps)}")
    st.markdown("---")

    if bull_sweeps:
        st.markdown("### 🟢 Bull Sweep（掃蕩低點後反轉向上）")
        for s in sorted(bull_sweeps, key=lambda x: x["symbol"]):
            st.markdown(f"🟢 **{s['symbol']}** — ${s['price']:.2f} | 掃蕩支撐後反彈確認")

    if bear_sweeps:
        st.markdown("### 🔴 Bear Sweep（掃蕩高點後反轉向下）")
        for s in sorted(bear_sweeps, key=lambda x: x["symbol"]):
            st.markdown(f"🔴 **{s['symbol']}** — ${s['price']:.2f} | 假突破後回落確認")

    if total == 0:
        st.info("目前無 Liquidity Sweep 訊號。")


# ─── Main Render Function ──────────────────────────────────────────────────

def render_indicator():
    """Render the unified Indicator scan page."""
    st.markdown("# 🔬 Indicator Scanner")
    st.markdown("整合三大技術指標掃描，選擇要查看的指標類型：")

    # Indicator selector
    indicator = st.selectbox(
        "選擇指標",
        ["MACD 背離", "FVG (Fair Value Gap)", "Liquidity Sweep"],
        index=0,
    )

    st.markdown("---")

    # Download data (shared across all indicators)
    data = _batch_download(SYMBOLS)

    if not data:
        st.error("無法下載市場資料，請稍後再試。")
        return

    st.caption(f"📊 已載入 {len(data)} 檔資料（快取 15 分鐘）")

    # Route to selected indicator
    if indicator == "MACD 背離":
        _render_macd_divergence(data)
    elif indicator == "FVG (Fair Value Gap)":
        _render_fvg(data)
    elif indicator == "Liquidity Sweep":
        _render_liquidity(data)
