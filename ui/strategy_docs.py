"""Strategy documentation — explanations for each strategy in Traditional Chinese."""

import streamlit as st

STRATEGY_DOCS = {
    "VP": (
        "Volume Profile 分析市場在不同價位的成交量分佈。"
        "VAH（Value Area High）和 VAL（Value Area Low）代表 68% 成交量集中的區間。"
        "POC（Point of Control）是成交量最大的價位。"
        "信號：VA Rejection（碰到邊緣反轉）、Failed Auction（假突破拉回）、Breakout Retest（突破回測）。"
    ),
    "VWAP": (
        "VWAP（成交量加權平均價）是機構的成本基準線。"
        "價格在 VWAP 上方代表多數持倉者獲利，下方代表虧損。"
        "信號：VWAP Reclaim（收回 VWAP 上方）、Deviation（碰到 ±2σ 反轉）、AVWAP Pullback（回踩錨定 VWAP）。"
        "Anchored VWAP 從特定事件（如 swing low、財報）開始計算，更精準反映機構成本。"
    ),
    "TrendFollowing": (
        "趨勢跟蹤策略不預測方向，只跟隨已確認的趨勢。"
        "核心邏輯：市場趨勢一旦形成，傾向持續而非反轉。"
        "信號：Breakout Acceptance（突破 Donchian 通道 + 量確認 + 連續收在上方）、"
        "EMA Cross（EMA20 穿越 EMA50 + 價格確認）、"
        "Compression Breakout（波動率收縮後爆發）。"
        "適合中長線持有，大賺小賠。"
    ),
}

REGIME_DOCS = {
    "range": "盤整：POC 平穩，價格在 VA 內。VP Rejection 和 VWAP 策略最可靠。",
    "trend": "趨勢：POC 遷移，價格突破 VA。Trend Following 和 VWAP 策略最可靠。",
    "expansion": "擴張：VIX 高 + 價格在 VA 外。VP 結構不穩定，Trend Following 較可靠。",
    "compression": "壓縮：ATR 收縮 5+ 天。VWAP 和 VP 較可靠，等待突破方向。",
}


def render_sidebar_docs():
    """Render strategy explanations in sidebar."""
    st.subheader("📚 策略說明")
    for name, doc in STRATEGY_DOCS.items():
        with st.expander(name):
            st.write(doc)

    st.subheader("🏷️ Regime 說明")
    for regime, doc in REGIME_DOCS.items():
        st.caption(f"**{regime.title()}**: {doc}")
