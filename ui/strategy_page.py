"""Strategy Performance Page — Accumulation + RSI(2) combined strategy overview.

Displays backtest results, strategy rules, and live tracking status.
Read-only — no computation, no file writes.
"""

import json
from pathlib import Path

import numpy as np
import streamlit as st


STATE_FILE = Path("data/accum_state.json")


def _load_state():
    """Load accumulation state."""
    if not STATE_FILE.exists():
        return {}
    try:
        return json.loads(STATE_FILE.read_text())
    except (json.JSONDecodeError, IOError):
        return {}


def render_strategy():
    """Render the strategy overview page."""

    st.markdown("# 📊 Accumulation + RSI(2) Strategy")
    st.markdown("---")

    # ─── Strategy Rules ───
    st.markdown("## 策略規則")

    col1, col2, col3 = st.columns(3)

    with col1:
        st.markdown("""
        ### 🏛️ Layer 1: 機構吸籌
        **Accumulation Tracker (Confirmed Tier)**

        - 7 項指標日評分 (0-21)
        - Decay score 連續 2 天 ≥ 12 → Confirmed
        - Wyckoff Phase B/C/D 確認結構
        - **意義：機構正在買**
        """)

    with col2:
        st.markdown("""
        ### ⚡ Layer 2: 入場觸發
        **Spring / LPS / SOS Trigger**

        | 觸發 | 條件 | 動作 |
        |------|------|------|
        | Spring | 跌破支撐收回 + 量確認 | Pilot 10-25% |
        | LPS | 回踩量縮 + 守住前低 | Add 25-40% |
        | SOS | 突破阻力 + 量 1.5x | Full position |

        - **意義：結構時機到了**
        """)

    with col3:
        st.markdown("""
        ### 📉 Layer 3: 精確入場
        **RSI(2) < 30 Filter**

        - 2 日 RSI 低於 30 = 短線極度超賣
        - 確認恐慌拋售已耗盡
        - Spring/LPS 才需要（SOS 不需要）
        - **意義：賣壓枯竭，最佳買點**
        """)

    st.markdown("---")

    # ─── Backtest Results ───
    st.markdown("## 回測績效")

    st.markdown("""
    > **30 symbols × 900 天 | Walk-Forward + Holdout | 2024-2025**
    """)

    col_wf, col_ho = st.columns(2)

    with col_wf:
        st.markdown("### Walk-Forward (訓練外樣本)")
        metrics_wf = {
            "Trades": "29",
            "Win Rate": "51.7%",
            "Expectancy": "+0.64R",
            "Sharpe": "0.34",
            "Profit Factor": "2.16",
            "Max DD": "4.1R",
            "Avg Hold": "11 days",
            "R:R": "2.3 : 1",
        }
        for k, v in metrics_wf.items():
            st.metric(k, v)

    with col_ho:
        st.markdown("### Holdout (完全未見數據)")
        metrics_ho = {
            "Trades": "10",
            "Win Rate": "50.0%",
            "Expectancy": "+0.50R",
            "Sharpe": "0.32",
            "Profit Factor": "~2.0",
            "Max DD": "4.0R",
            "Avg Hold": "8 days",
            "R:R": "2.0 : 1",
        }
        for k, v in metrics_ho.items():
            st.metric(k, v)

    st.markdown("---")

    # ─── Comparison Table ───
    st.markdown("## 策略演進比較")

    comparison_data = {
        "配置": ["無 filter", "Confirmed only", "Confirmed + RSI(2)<30"],
        "Trades": [109, 57, 29],
        "Win Rate": ["35.8%", "36.8%", "51.7%"],
        "Expectancy": ["+0.19R", "+0.37R", "+0.64R"],
        "Sharpe": [0.09, 0.15, 0.34],
        "Max DD": ["18.9R", "11.0R", "4.1R"],
        "Profit Factor": ["1.3", "1.7", "2.16"],
    }
    st.table(comparison_data)

    st.markdown("---")

    # ─── Robustness ───
    st.markdown("## 穩定性驗證")

    col_r1, col_r2 = st.columns(2)

    with col_r1:
        st.markdown("""
        ### ✅ 通過的檢查
        - **不依賴少數大贏** — 移除 top 2 wins 仍正 (+0.24R)
        - **時間一致** — 前後半期 WR 相近 (48% vs 50%)
        - **Window 一致** — 兩個 walk-forward window 都正
        - **Holdout 正面** — 未見數據方向一致
        - **參數穩定** — E=5~9, C=9~12 都在正區域
        - **Max 連虧** — 最多 4 筆，可承受
        """)

    with col_r2:
        st.markdown("""
        ### ⚠️ 注意事項
        - **統計顯著** — CI 下界 = -0.001 (幾乎通過但未達)
        - **樣本量** — 31 筆 (需要 100+ 確認)
        - **Symbol 集中** — NOW 6 筆全虧，需要分散
        - **低頻** — 年約 32 筆交易，需耐心等待
        """)

    st.markdown("---")

    # ─── Position Sizing ───
    st.markdown("## 倉位管理建議")

    st.markdown("""
    | 階段 | 條件 | Position Size | 同時持倉 |
    |------|------|--------------|---------|
    | **Phase 1** (前 3-6 月) | 驗證期 | 1% risk/trade | 最多 3 筆 |
    | **Phase 2** (50+ live trades) | WR>40% & Exp>0 | 2% risk/trade | 最多 5 筆 |
    | **暫停** | WR<35% 或 Exp<0 | 停止交易，檢討 | — |
    """)

    st.markdown("""
    ### 每筆交易計算範例

    ```
    帳戶: $100,000 | Risk: 1% = $1,000/trade
    Entry: $150.00 | SL: $142.50 (trigger 給的)
    Risk/share: $7.50
    Position size: $1,000 / $7.50 = 133 shares ($19,950)
    Target: $165.00 (R:R = 2:1)
    ```
    """)

    st.markdown("---")

    # ─── Live Status ───
    st.markdown("## 目前追蹤狀態")

    state = _load_state()
    if not state:
        st.info("尚無追蹤數據 (data/accum_state.json)")
        return

    confirmed = [(s, d) for s, d in state.items()
                 if isinstance(d, dict) and d.get("tier") == "confirmed"]
    watch = [(s, d) for s, d in state.items()
             if isinstance(d, dict) and d.get("tier") == "watch"]

    confirmed.sort(key=lambda x: -x[1].get("decay_score", 0))
    watch.sort(key=lambda x: -x[1].get("decay_score", 0))

    st.markdown(f"**Confirmed: {len(confirmed)}** | Watch: {len(watch)}")

    if confirmed:
        st.markdown("### ✅ Confirmed (可交易)")
        for sym, data in confirmed:
            phase = data.get("phase", "?")
            score = data.get("decay_score", 0)
            sp = data.get("support_dynamic", 0)
            res = data.get("resistance", 0)
            st.markdown(
                f"**{sym}** — Phase {phase} | "
                f"Score {score:.1f} | "
                f"Support ${sp:.1f} | Resistance ${res:.1f}"
            )
    else:
        st.info("目前沒有 confirmed tier 的標的")

    if watch:
        with st.expander(f"👀 Watch ({len(watch)} 檔)", expanded=False):
            for sym, data in watch[:10]:
                phase = data.get("phase", "?")
                score = data.get("decay_score", 0)
                st.markdown(f"**{sym}** — Phase {phase} | Score {score:.1f}")

    st.markdown("---")
    st.markdown("""
    ### 指標定義速查

    | 指標 | 定義 | 好的標準 |
    |------|------|---------|
    | **Win Rate** | 贏的次數 ÷ 總次數 | > 40% (breakout type) |
    | **Expectancy** | 每筆交易平均賺幾 R | > 0 (正期望值) |
    | **Sharpe** | 報酬 ÷ 波動 (穩定性) | > 0.2 per-trade |
    | **Profit Factor** | 總獲利 ÷ 總虧損 | > 1.5 |
    | **Max DD** | 最大連續回撤 (R) | < 10R |
    | **R:R** | 平均贏 ÷ 平均虧 | > 1.5:1 |
    | **CI 下界** | 95% 信心最差情況 | > 0 = 統計顯著 |
    """)
