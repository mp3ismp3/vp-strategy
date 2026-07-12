"""Accumulation Tracker Visualization — Top symbols accumulation charts.

Shows candlestick + volume + support/resistance + Wyckoff phase for top tracked symbols.
"""

import json
from pathlib import Path

import numpy as np
import pandas as pd
import plotly.graph_objects as go
from plotly.subplots import make_subplots
import streamlit as st
import yfinance as yf

STATE_FILE = Path("data/accum_state.json")


def _load_state():
    """Load accumulation state from JSON."""
    if not STATE_FILE.exists():
        return {}
    try:
        return json.loads(STATE_FILE.read_text())
    except (json.JSONDecodeError, IOError):
        return {}


def _get_top_symbols(state, n=5):
    """Get top N symbols sorted by decay_score (confirmed first, then watch)."""
    items = []
    for sym, data in state.items():
        if isinstance(data, dict):
            items.append({
                "symbol": sym,
                "tier": data.get("tier", "watch"),
                "decay_score": data.get("decay_score", 0),
                "phase": data.get("phase", "?"),
                "support_primary": data.get("support_primary"),
                "support_dynamic": data.get("support_dynamic"),
                "resistance": data.get("resistance"),
                "entered_date": data.get("entered_date", ""),
                "raw_history": data.get("raw_history", []),
            })
    # Sort: confirmed first, then by decay_score desc
    items.sort(key=lambda x: (0 if x["tier"] == "confirmed" else 1, -x["decay_score"]))
    return items[:n]


@st.cache_data(ttl=300)
def _download_data(symbol, period="6mo"):
    """Download OHLCV data for a symbol."""
    df = yf.download(symbol, period=period, progress=False)
    if isinstance(df.columns, pd.MultiIndex):
        df.columns = df.columns.get_level_values(0)
    return df


def _create_accumulation_chart(symbol, df, state_info):
    """Create a price + OBV divergence chart with support/resistance."""
    fig = make_subplots(
        rows=3, cols=1,
        shared_xaxes=True,
        vertical_spacing=0.04,
        row_heights=[0.45, 0.30, 0.25],
        subplot_titles=(
            f"{symbol} — Phase {state_info['phase']} | "
            f"Score {state_info['decay_score']:.1f} | "
            f"{'✅ Confirmed' if state_info['tier'] == 'confirmed' else '👀 Watch'}",
            "OBV (On-Balance Volume) — 看方向是否與價格分歧",
            "Volume + Median",
        ),
    )

    # ─── Row 1: Candlestick + Support/Resistance ───
    fig.add_trace(
        go.Candlestick(
            x=df.index,
            open=df["Open"],
            high=df["High"],
            low=df["Low"],
            close=df["Close"],
            name="Price",
            increasing_line_color="#26a69a",
            decreasing_line_color="#ef5350",
        ),
        row=1, col=1,
    )

    # Support/Resistance levels
    sp = state_info.get("support_primary")
    sd = state_info.get("support_dynamic")
    res = state_info.get("resistance")

    if sp:
        fig.add_hline(
            y=sp, line_dash="dash", line_color="red", line_width=1,
            annotation_text=f"Primary ${sp:.2f}",
            annotation_position="bottom left",
            row=1, col=1,
        )
    if sd and sd != sp:
        fig.add_hline(
            y=sd, line_dash="dot", line_color="orange", line_width=1,
            annotation_text=f"Dynamic ${sd:.2f}",
            annotation_position="bottom left",
            row=1, col=1,
        )
    if res:
        fig.add_hline(
            y=res, line_dash="dash", line_color="#4caf50", line_width=1,
            annotation_text=f"Resistance ${res:.2f}",
            annotation_position="top left",
            row=1, col=1,
        )

    # ─── Row 2: OBV with trend line ───
    close = df["Close"].values.astype(float)
    volume = df["Volume"].values.astype(float)

    # Compute OBV
    obv = np.zeros(len(close))
    for i in range(1, len(close)):
        if close[i] > close[i - 1]:
            obv[i] = obv[i - 1] + volume[i]
        elif close[i] < close[i - 1]:
            obv[i] = obv[i - 1] - volume[i]
        else:
            obv[i] = obv[i - 1]

    # OBV line
    fig.add_trace(
        go.Scatter(
            x=df.index,
            y=obv,
            mode="lines",
            line=dict(color="#42a5f5", width=2),
            name="OBV",
        ),
        row=2, col=1,
    )

    # OBV 20-day moving average (trend direction)
    obv_ma = pd.Series(obv).rolling(20).mean().values
    fig.add_trace(
        go.Scatter(
            x=df.index,
            y=obv_ma,
            mode="lines",
            line=dict(color="#ffa726", width=1, dash="dot"),
            name="OBV MA(20)",
        ),
        row=2, col=1,
    )

    # Color background based on OBV trend vs Price trend (divergence detection)
    # Compare last 20 days: price slope vs OBV slope
    if len(df) >= 20:
        price_recent = close[-20:]
        obv_recent = obv[-20:]
        price_slope = np.polyfit(range(20), price_recent, 1)[0]
        obv_slope = np.polyfit(range(20), obv_recent, 1)[0]

        # Determine divergence status
        if obv_slope > 0 and price_slope <= 0:
            div_text = "🟢 正向分歧 — OBV↑ 價格平/↓ = 吸籌中"
            div_color = "#1b5e20"
        elif obv_slope > 0 and price_slope > 0:
            div_text = "✅ 同向上升 — 健康上漲趨勢"
            div_color = "#2e7d32"
        elif obv_slope < 0 and price_slope >= 0:
            div_text = "🔴 負向分歧 — OBV↓ 價格平/↑ = 派發中"
            div_color = "#b71c1c"
        elif obv_slope < 0 and price_slope < 0:
            div_text = "⚠️ 同向下跌 — 賣壓持續"
            div_color = "#e65100"
        else:
            div_text = "➡️ 無明確方向"
            div_color = "#616161"

        # Add annotation for divergence status
        fig.add_annotation(
            text=div_text,
            xref="paper", yref="paper",
            x=0.5, y=0.62,
            showarrow=False,
            font=dict(size=13, color="white"),
            bgcolor=div_color,
            borderpad=4,
        )

    # ─── Row 3: Volume bars ───
    colors = [
        "#26a69a" if close[i] >= close[i - 1] else "#ef5350"
        if i > 0 else "#26a69a"
        for i in range(len(close))
    ]

    fig.add_trace(
        go.Bar(
            x=df.index,
            y=df["Volume"],
            marker_color=colors,
            name="Volume",
            opacity=0.7,
        ),
        row=3, col=1,
    )

    # Volume median
    vol_median = df["Volume"].rolling(20).median()
    fig.add_trace(
        go.Scatter(
            x=df.index,
            y=vol_median,
            mode="lines",
            line=dict(color="yellow", width=1, dash="dot"),
            name="Vol Median(20)",
        ),
        row=3, col=1,
    )

    # ─── Layout ───
    fig.update_layout(
        height=750,
        showlegend=False,
        xaxis_rangeslider_visible=False,
        template="plotly_dark",
        margin=dict(l=50, r=20, t=40, b=20),
        font=dict(size=11),
    )

    fig.update_yaxes(title_text="Price", row=1, col=1)
    fig.update_yaxes(title_text="OBV", row=2, col=1)
    fig.update_yaxes(title_text="Volume", row=3, col=1)

    return fig


def render_accumulation():
    """Render the accumulation tracker visualization page."""
    st.title("🔍 Accumulation Tracker — Top 10")

    state = _load_state()
    if not state:
        st.warning("⚠️ 無追蹤狀態 — 請先執行 `python accumulation.py` 產生 data/accum_state.json")
        return

    top_symbols = _get_top_symbols(state, n=10)

    if not top_symbols:
        st.info("目前沒有追蹤中的標的")
        return

    # Summary table
    st.subheader("📋 追蹤狀態")
    summary_data = []
    for item in top_symbols:
        summary_data.append({
            "Symbol": item["symbol"],
            "Tier": "✅ Confirmed" if item["tier"] == "confirmed" else "👀 Watch",
            "Phase": item["phase"],
            "Score": f"{item['decay_score']:.1f}",
            "Support": f"${item['support_dynamic']:.2f}" if item.get("support_dynamic") else "—",
            "Resistance": f"${item['resistance']:.2f}" if item.get("resistance") else "—",
            "Since": item.get("entered_date", "—"),
        })
    st.dataframe(pd.DataFrame(summary_data), use_container_width=True, hide_index=True)

    st.divider()

    # Individual charts
    st.subheader("📈 籌碼累積圖")

    for item in top_symbols:
        symbol = item["symbol"]
        with st.spinner(f"Loading {symbol}..."):
            df = _download_data(symbol)

        if df is None or df.empty:
            st.error(f"❌ 無法下載 {symbol} 數據")
            continue

        fig = _create_accumulation_chart(symbol, df, item)
        st.plotly_chart(fig, use_container_width=True, key=f"chart_{symbol}")

        # Phase explanation
        phase_desc = {
            "A": "🛑 Phase A — 停止下跌（Selling Climax 後）",
            "B": "🔨 Phase B — 區間震盪吸籌中",
            "C": "🌊 Phase C — 彈簧測試（假跌破洗盤）",
            "D": "📈 Phase D — Higher Lows 形成，趨勢啟動",
            "E": "🚀 Phase E — 突破確認，已起飛",
            "UNKNOWN": "❓ Phase Unknown — 無明確階段",
        }
        st.caption(phase_desc.get(item["phase"], f"Phase {item['phase']}"))
        st.divider()
