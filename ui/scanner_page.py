"""Scanner Page — VP Multi-Timeframe Charts with Volume Profile Histogram.

Shows candlestick + VP histogram (horizontal volume bars) for Daily/Weekly/Monthly.
Default: Accumulation top 10. User can select any symbol.

Data strategy:
- Primary: use pre-computed scan_results.json (instant)
- On-demand: user clicks refresh to download fresh data (cached 15 min)
"""

import json
from pathlib import Path

import numpy as np
import streamlit as st
import pandas as pd
import plotly.graph_objects as go
from plotly.subplots import make_subplots

from config import SYMBOLS
from core.data_provider import YahooProvider
from core.indicators import calc_vp
from core.vp_multitf import compute_vp_multitf, resample_to_weekly, resample_to_monthly
from core.auction import calc_va_migration, calc_initial_balance, detect_single_prints, detect_poor_highs_lows

STATE_FILE = Path(__file__).parent.parent / "data" / "accum_state.json"
RESULTS_FILE = Path(__file__).parent.parent / "data" / "scan_results.json"


@st.cache_data(ttl=900, show_spinner=False)
def _download_symbol(symbol):
    """Download single symbol data with 15-min cache. Returns DataFrame or None."""
    try:
        provider = YahooProvider(max_workers=1, jitter=(0.1, 0.2))
        data = provider.batch_daily([symbol], period="1y")
        return data.get(symbol)
    except Exception:
        return None


@st.cache_data(ttl=900, show_spinner=False)
def _download_1h(symbol):
    """Download 1H data for a symbol with 15-min cache. Returns DataFrame or None."""
    try:
        provider = YahooProvider(max_workers=1, jitter=(0.1, 0.2))
        return provider.get_intraday(symbol, period="730d", interval="1h")
    except Exception:
        return None


def _load_accum_top10():
    """Load accumulation state and return top 10 symbols."""
    if not STATE_FILE.exists():
        return []
    try:
        state = json.loads(STATE_FILE.read_text())
    except (json.JSONDecodeError, IOError):
        return []

    items = []
    for sym, data in state.items():
        if isinstance(data, dict):
            items.append({
                "symbol": sym,
                "tier": data.get("tier", "watch"),
                "decay_score": data.get("decay_score", 0),
            })
    items.sort(key=lambda x: (0 if x["tier"] == "confirmed" else 1, -x["decay_score"]))
    return [item["symbol"] for item in items[:10]]


def _make_vp_chart(df, vp_data, title, n_bars=60):
    """Create candlestick chart with VP histogram overlay."""
    plot_df = df.tail(n_bars)

    fig = make_subplots(
        rows=1, cols=2,
        column_widths=[0.8, 0.2],
        shared_yaxes=True,
        horizontal_spacing=0.01,
    )

    # Left: Candlestick
    fig.add_trace(go.Candlestick(
        x=plot_df.index,
        open=plot_df["Open"],
        high=plot_df["High"],
        low=plot_df["Low"],
        close=plot_df["Close"],
        name="Price",
        increasing_line_color="#26a69a",
        decreasing_line_color="#ef5350",
    ), row=1, col=1)

    if vp_data:
        poc = vp_data["poc"]
        vah = vp_data["vah"]
        val = vp_data["val"]

        # VP zone shading
        fig.add_hrect(y0=val, y1=vah, fillcolor="rgba(255,165,0,0.06)",
                      line_width=0, row=1, col=1)

        # POC/VAH/VAL lines
        fig.add_hline(y=vah, line_dash="dash", line_color="red", line_width=1,
                      annotation_text=f"VAH {vah:.1f}", annotation_position="top left",
                      row=1, col=1)
        fig.add_hline(y=poc, line_dash="solid", line_color="orange", line_width=2,
                      annotation_text=f"POC {poc:.1f}", annotation_position="top left",
                      row=1, col=1)
        fig.add_hline(y=val, line_dash="dash", line_color="green", line_width=1,
                      annotation_text=f"VAL {val:.1f}", annotation_position="bottom left",
                      row=1, col=1)

        # Right: VP Histogram (horizontal bars)
        histogram = vp_data.get("histogram")
        if histogram:
            prices = histogram["prices"]
            volumes = histogram["volumes"]
            max_vol = max(volumes) if volumes else 1

            # Normalize volumes for display
            norm_volumes = [v / max_vol for v in volumes]

            # Color bars: inside VA = orange, outside = gray
            colors = []
            for p in prices:
                if val <= p <= vah:
                    colors.append("rgba(255,165,0,0.6)")
                else:
                    colors.append("rgba(150,150,150,0.3)")

            fig.add_trace(go.Bar(
                x=norm_volumes,
                y=prices,
                orientation="h",
                marker_color=colors,
                showlegend=False,
                hovertemplate="$%{y:.1f}<br>Vol: %{customdata:.0f}<extra></extra>",
                customdata=volumes,
            ), row=1, col=2)

            # POC/VAH/VAL lines on histogram side
            fig.add_hline(y=poc, line_dash="solid", line_color="orange", line_width=1, row=1, col=2)
            fig.add_hline(y=vah, line_dash="dash", line_color="red", line_width=1, row=1, col=2)
            fig.add_hline(y=val, line_dash="dash", line_color="green", line_width=1, row=1, col=2)

    fig.update_layout(
        title=title,
        height=450,
        showlegend=False,
        margin=dict(l=10, r=10, t=40, b=10),
        xaxis_rangeslider_visible=False,
        xaxis2_showticklabels=False,
        yaxis_title="",
    )

    return fig


def render_scanner():
    st.title("📈 VP Multi-Timeframe Scanner")

    # --- Symbol Selection ---
    accum_top10 = _load_accum_top10()

    mode = st.radio(
        "顯示模式",
        ["Accumulation Top 10", "自選標的"],
        horizontal=True,
    )

    if mode == "Accumulation Top 10":
        if accum_top10:
            symbols_to_show = accum_top10
        else:
            st.info("No accumulation state. Showing defaults.")
            symbols_to_show = SYMBOLS[:10]
    else:
        symbols_to_show = st.multiselect(
            "選擇標的 (最多 5 檔避免超時)",
            SYMBOLS,
            default=SYMBOLS[:3],
            max_selections=5,
        )

    if not symbols_to_show:
        st.info("請選擇至少一個標的。")
        return

    # --- Load data per symbol (cached individually) ---
    progress = st.progress(0, text="載入數據中...")
    loaded = {}
    for i, symbol in enumerate(symbols_to_show):
        progress.progress((i + 1) / len(symbols_to_show), text=f"載入 {symbol}...")
        df = _download_symbol(symbol)
        if df is not None and len(df) >= 60:
            loaded[symbol] = df
    progress.empty()

    if not loaded:
        st.warning("無法載入任何數據。請稍後再試。")
        return

    # --- Render each symbol ---
    for symbol, df in loaded.items():
        vp = compute_vp_multitf(df, va_pct=0.68)
        if not vp:
            continue

        # Compute auction elements
        df_1h = _download_1h(symbol)
        if df_1h is not None and len(df_1h) >= 50:
            mig = calc_va_migration(df, df_1h=df_1h)
            if mig:
                vp["va_migration"] = {
                    "direction": mig["direction"],
                    "speed": mig["speed"],
                    "poc_shift": mig["poc_shift"],
                }
            ib = calc_initial_balance(df_1h)
            if ib:
                vp["ib"] = ib

            # Single prints from daily histogram
            daily_hist = vp.get("daily", {}).get("histogram")
            if daily_hist:
                sp = detect_single_prints(daily_hist["volumes"], daily_hist["prices"])
                if sp:
                    vp["single_prints"] = sp

        phl = detect_poor_highs_lows(df)
        if phl["poor_highs"] or phl["poor_lows"]:
            vp["poor_highs_lows"] = phl

        # Symbol header
        price = vp["price"]
        st.markdown(f"## {symbol} — ${price}")

        # Tabs for each timeframe
        tab_d, tab_w, tab_m = st.tabs(["📅 日線 (60天)", "📆 周線 (52週)", "🗓️ 月線 (12月)"])

        with tab_d:
            daily_chart = _make_vp_chart(df, vp.get("daily"), f"{symbol} — 日線 VP", n_bars=60)
            st.plotly_chart(daily_chart, use_container_width=True)
            if vp.get("daily"):
                _show_position_badge(vp["daily"])

        with tab_w:
            weekly_df = resample_to_weekly(df)
            weekly_chart = _make_vp_chart(weekly_df, vp.get("weekly"), f"{symbol} — 周線 VP", n_bars=52)
            st.plotly_chart(weekly_chart, use_container_width=True)
            if vp.get("weekly"):
                _show_position_badge(vp["weekly"])

        with tab_m:
            monthly_df = resample_to_monthly(df)
            monthly_chart = _make_vp_chart(monthly_df, vp.get("monthly"), f"{symbol} — 月線 VP", n_bars=12)
            st.plotly_chart(monthly_chart, use_container_width=True)
            if vp.get("monthly"):
                _show_position_badge(vp["monthly"])

        # Multi-TF consensus
        _show_consensus(vp)

        # Auction theory elements
        _show_auction_info(vp)
        st.divider()


def _show_position_badge(tf_data):
    """Show position badge below chart."""
    pos = tf_data["position"]
    pct = tf_data["position_pct"]
    poc = tf_data["poc"]
    vah = tf_data["vah"]
    val = tf_data["val"]

    col1, col2, col3, col4 = st.columns(4)
    if pos == "above_va":
        col1.success(f"🟢 Above VA ({pct:.0f}%)")
    elif pos == "below_va":
        col1.error(f"🔴 Below VA ({pct:.0f}%)")
    else:
        col1.info(f"⚪ Inside VA ({pct:.0f}%)")
    col2.metric("POC", f"${poc:.2f}")
    col3.metric("VAH", f"${vah:.2f}")
    col4.metric("VAL", f"${val:.2f}")


def _show_consensus(vp):
    """Show multi-TF auction context and actionable insight."""
    daily = vp.get("daily", {})
    weekly = vp.get("weekly", {})
    monthly = vp.get("monthly", {})

    d_pos = daily.get("position", "")
    w_pos = weekly.get("position", "")
    m_pos = monthly.get("position", "")

    positions = [d_pos, w_pos, m_pos]
    above_count = positions.count("above_va")
    below_count = positions.count("below_va")
    inside_count = positions.count("inside_va")

    # --- All 3 same direction ---
    if above_count == 3:
        st.info("📈 三框架都在 VA 上方 — 已走一段，等回踩再找做多位置，勿追高")
    elif below_count == 3:
        st.info("📉 三框架都在 VA 下方 — 已跌一段，等反彈再找做空位置，勿追空")
    elif inside_count == 3:
        st.info("⚪ 三框架都在 VA 內 — 區間交易環境：碰 VAL 做多、碰 VAH 做空")

    # --- 大方向偏多 (月或周 above) + 日線回踩 ---
    elif (m_pos == "above_va" or w_pos == "above_va") and d_pos == "inside_va":
        st.success("🟢 大方向偏多 + 日線回到 VA 內 — 等碰 VAL 做多（回踩公允價值買入）")
    elif (m_pos == "above_va" or w_pos == "above_va") and d_pos == "below_va":
        st.warning("⚠️ 大方向偏多，但日線跌破 VA — 觀察是否為 Failed Auction（跌破後快速收回＝做多機會）")

    # --- 大方向偏空 (月或周 below) + 日線反彈 ---
    elif (m_pos == "below_va" or w_pos == "below_va") and d_pos == "inside_va":
        st.error("🔴 大方向偏空 + 日線反彈到 VA 內 — 等碰 VAH 做空（反彈至公允價值賣出）")
    elif (m_pos == "below_va" or w_pos == "below_va") and d_pos == "above_va":
        st.warning("⚠️ 大方向偏空，日線短暫突破 VA — 觀察是否為假突破（突破後跌回＝做空機會）")

    # --- 大方向偏多 + 日線也偏多 ---
    elif above_count == 2 and inside_count == 1:
        st.success("🟢 偏多結構 — 2/3 框架在 VA 上方，等日線碰 VAL 或回到 VA 內找做多位置")

    # --- 大方向偏空 + 日線也偏空 ---
    elif below_count == 2 and inside_count == 1:
        st.error("🔴 偏空結構 — 2/3 框架在 VA 下方，等日線碰 VAH 或回到 VA 內找做空位置")

    # --- 真正的分歧：一個 above 一個 below ---
    elif above_count >= 1 and below_count >= 1:
        st.warning("⚠️ 時間框架方向衝突（有 above 也有 below）— 等方向一致再操作")

    else:
        st.info("⚪ 區間震盪環境 — 碰 VAL 做多、碰 VAH 做空")


def _show_auction_info(vp):
    """Show auction theory elements (VA migration, IB, single prints, poor highs/lows)."""
    mig = vp.get("va_migration")
    ib = vp.get("ib")
    sp = vp.get("single_prints")
    phl = vp.get("poor_highs_lows")

    if not any([mig, ib, sp, phl]):
        return

    with st.expander("🏛️ Auction Analysis", expanded=False):
        cols = st.columns(3)

        # VA Migration
        with cols[0]:
            st.markdown("**VA Migration**")
            with st.popover("❓ 什麼是 VA Migration"):
                st.markdown("""
                **價值區遷移** — 追蹤市場「公允價格」的移動方向和速度。

                - **Direction up** = POC 往上移，市場接受更高的價格 → 上升趨勢
                - **Direction down** = POC 往下移，市場接受更低的價格 → 下降趨勢
                - **Flat** = POC 不動，市場在平衡 → 區間交易環境

                **Speed（速度）：**
                - < 1.0 = 正常/慢速遷移
                - 1.0~2.0 = 明確趨勢
                - > 2.0 = 快速遷移（強趨勢，不要逆勢操作）

                **操作含義：**
                - up + 高 speed → 順勢做多，不要抄底
                - down + 高 speed → 順勢做空或觀望，不要接刀
                - flat → 區間交易，碰 VAL 做多、碰 VAH 做空
                """)
            if mig:
                dir_emoji = "📈" if mig["direction"] == "up" else "📉" if mig["direction"] == "down" else "➡️"
                st.markdown(f"{dir_emoji} Direction: **{mig['direction']}**")
                st.caption(f"Speed: {mig['speed']} ATR | POC shift: ${mig['poc_shift']}")
            else:
                st.caption("數據不足")

        # Initial Balance
        with cols[1]:
            st.markdown("**Initial Balance**")
            with st.popover("❓ 什麼是 Initial Balance"):
                st.markdown("""
                **開盤第一小時範圍** — 預測當天是趨勢日還是區間日。

                - **Balance day** = 價格整天都留在第一小時的範圍內 → 做區間交易
                - **Directional day** = 價格突破第一小時範圍 → 順突破方向做

                **IB 寬度：**
                - **Wide**（比平均寬 30%+）= 開盤就波動大，已走一段，追進要謹慎
                - **Narrow**（比平均窄 30%+）= 能量壓縮，突破後動能可能很大
                - **Normal** = 正常

                **Directional days %：**
                - 高（>70%）= 這檔股票經常做趨勢日，適合突破策略
                - 低（<40%）= 這檔股票偏好區間，適合 mean reversion
                """)
            if ib:
                today = ib["today"]
                stats = ib["stats"]
                type_emoji = "📊" if today["day_type"] == "balance" else "🚀"
                st.markdown(f"{type_emoji} {today['day_type']} ({stats['today_relative']})")
                st.caption(f"IB: ${today['ib_low']:.2f} - ${today['ib_high']:.2f} (${today['ib_width']:.2f})")
                st.caption(f"Directional days: {stats['pct_directional']:.0%}")
            else:
                st.caption("需要 1H 數據")

        # Single Prints + Poor Highs/Lows
        with cols[2]:
            st.markdown("**Price Targets**")
            with st.popover("❓ 什麼是 Single Prints / Poor Highs/Lows"):
                st.markdown("""
                **Single Prints（量能稀薄區）：**

                市場快速穿越、幾乎沒有交易的價格區間。
                代表「未完成的拍賣」— 市場未來很可能回到這裡**回填**。
                類似「跳空缺口會回補」的邏輯，但基於量而不是價格。

                → 這些是磁吸目標價

                ---

                **Poor Highs（弱高點）：**

                高點收盤在最高附近、沒有上影線拒絕 = 買方未被打敗。
                價格很可能**再次回來測試甚至突破**這個高點。

                **Poor Lows（弱低點）：**

                低點收盤在最低附近、沒有下影線保護 = 賣方未被打敗。
                價格很可能**再次下探**這個低點。

                （對比：有長影線的極端值 = Strong High/Low = 不容易再回去）
                """)
            if sp:
                st.markdown(f"**Single Prints** ({len(sp)})")
                for s in sp[:2]:
                    st.caption(f"🧲 ${s['price_start']} - ${s['price_end']} (fill target)")
            if phl:
                ph = phl.get("poor_highs", [])
                pl = phl.get("poor_lows", [])
                if ph:
                    st.markdown(f"**Poor Highs** ({len(ph)})")
                    for p in ph[-2:]:
                        st.caption(f"⬆️ ${p['price']} on {p['date']}")
                if pl:
                    st.markdown(f"**Poor Lows** ({len(pl)})")
                    for p in pl[-2:]:
                        st.caption(f"⬇️ ${p['price']} on {p['date']}")
