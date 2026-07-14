"""Fusion Report Page — VP + Accumulation Cross-System Alignment.

Shows which tracked accumulation symbols have favorable VP positions,
producing a prioritized action list with confidence stars.
"""

import pandas as pd
import streamlit as st

from fusion_report import (
    compute_fusion_signals,
    load_accum_state,
    load_scan_data,
)


def _stars_display(n: int) -> str:
    """Convert star count to emoji display."""
    if n <= 0:
        return "❌"
    return "⭐" * n


def _pos_badge(position: str) -> str:
    """Colored badge for VP position."""
    badges = {
        "above_va": "🟢 Above VA",
        "inside_va": "🟡 Inside VA",
        "below_va": "🔴 Below VA",
    }
    return badges.get(position, position)


def _phase_badge(phase: str) -> str:
    """Phase with emoji."""
    badges = {
        "A": "🛑 A (Stopping)",
        "B": "🔨 B (Building)",
        "C": "🌊 C (Spring)",
        "D": "📈 D (Trending)",
        "E": "🚀 E (Markup)",
        "UNKNOWN": "❓ Unknown",
    }
    return badges.get(phase, phase)


def _macro_badge(direction: str) -> str:
    """Macro direction badge."""
    badges = {
        "bullish": "🟢 Bullish",
        "bearish": "🔴 Bearish",
        "neutral": "⚪ Neutral",
    }
    return badges.get(direction, direction)


def _render_signal_card(sig: dict):
    """Render a single fusion signal as an expander card."""
    symbol = sig["symbol"]
    stars = sig["stars"]
    phase = sig["phase"]
    label = sig["label"]

    # Header
    tier_icon = "✅" if sig["tier"] == "confirmed" else "👀"
    header = f"{_stars_display(stars)} {tier_icon} **{symbol}** — {label}"

    with st.expander(header, expanded=(stars >= 4)):
        # ─── Top Row: Key Info ───
        col1, col2, col3, col4 = st.columns(4)
        with col1:
            st.metric("Phase", phase)
        with col2:
            st.metric("Decay Score", f"{sig['decay_score']:.1f}")
        with col3:
            st.metric("Price", f"${sig['price']:.2f}" if sig.get("price") else "—")
        with col4:
            st.metric("信心", f"{stars}/5")

        st.divider()

        # ─── VP Position Row ───
        st.markdown("**📊 VP 多時間框架位置**")
        c1, c2, c3, c4 = st.columns(4)
        with c1:
            st.caption("日線")
            st.markdown(_pos_badge(sig["daily_position"]))
            st.caption(f"{sig['daily_position_pct']:.0f}%")
        with c2:
            st.caption("周線")
            st.markdown(_pos_badge(sig["weekly_position"]) if sig["weekly_position"] != "—" else "—")
        with c3:
            st.caption("月線")
            st.markdown(_pos_badge(sig["monthly_position"]) if sig["monthly_position"] != "—" else "—")
        with c4:
            st.caption("大方向")
            st.markdown(_macro_badge(sig["macro_direction"]))

        st.divider()

        # ─── Action ───
        st.markdown(f"**🎯 建議動作：** {sig['action']}")

        # ─── Levels ───
        levels = sig.get("levels", {})
        if levels.get("targets") or levels.get("stop_loss"):
            st.markdown("**📐 關鍵價位**")
            level_cols = st.columns(3)

            with level_cols[0]:
                if levels.get("stop_loss"):
                    sl_pct = levels.get("stop_pct", 0)
                    st.markdown(
                        f"🔴 **止損:** ${levels['stop_loss']:.2f} "
                        f"({sl_pct:+.1f}%)\n\n"
                        f"<small>Source: {levels.get('stop_source', '—')}</small>",
                        unsafe_allow_html=True,
                    )
                if levels.get("hard_stop"):
                    st.caption(f"Hard Stop: ${levels['hard_stop']:.2f}")

            with level_cols[1]:
                targets = levels.get("targets", [])
                if targets:
                    lines = []
                    for t in targets:
                        pct_str = f" ({t['pct']:+.1f}%)" if t.get("pct") is not None else ""
                        lines.append(f"🟢 **{t['label']}:** ${t['level']:.2f}{pct_str}")
                    st.markdown("\n\n".join(lines))

            with level_cols[2]:
                # R:R estimation
                if levels.get("stop_loss") and targets and sig.get("price"):
                    price = sig["price"]
                    risk = abs(price - levels["stop_loss"])
                    if risk > 0 and targets:
                        best_tp = targets[-1]["level"]
                        reward = abs(best_tp - price)
                        rr = reward / risk
                        st.metric("R:R", f"1:{rr:.1f}")

        # ─── Red Flags ───
        if sig.get("red_flags"):
            st.markdown("**🚩 紅旗 (降低信心或不做)**")
            for flag in sig["red_flags"]:
                st.warning(flag, icon="🚩")

        # ─── Trigger History ───
        if sig.get("triggers_fired"):
            st.markdown("**⚡ 已觸發的 Triggers**")
            for t in sig["triggers_fired"]:
                st.markdown(f"- {t}")
            if sig.get("trigger_alignment"):
                for a in sig["trigger_alignment"]:
                    st.caption(a)


def _render_summary_table(signals: list):
    """Render the overview summary table."""
    if not signals:
        return

    rows = []
    for sig in signals:
        rows.append({
            "信心": _stars_display(sig["stars"]),
            "Symbol": sig["symbol"],
            "Phase": sig["phase"],
            "Tier": "✅" if sig["tier"] == "confirmed" else "👀",
            "Score": f"{sig['decay_score']:.1f}",
            "日線 VP": sig["daily_position"].replace("_", " ").title(),
            "大方向": sig["macro_direction"].title(),
            "動作": sig["action"][:30] + "…" if len(sig["action"]) > 30 else sig["action"],
            "紅旗": "🚩" if sig.get("red_flags") else "",
        })

    df = pd.DataFrame(rows)
    st.dataframe(df, use_container_width=True, hide_index=True)


def render_fusion():
    """Main render function for the Fusion Report page."""
    st.title("🔗 VP + Accumulation 聯動分析")

    # Load data
    scan_data = load_scan_data()
    accum_state = load_accum_state()

    # Data availability check
    if scan_data is None:
        st.error("❌ 無 VP 掃描資料 — 請先執行 `python scan_all.py`")
        return
    if accum_state is None:
        st.error("❌ 無 Accumulation 狀態 — 請先執行 `python accumulation.py`")
        return

    # Show scan time
    scan_time = scan_data.get("scan_time", "—")
    market_ctx = scan_data.get("market_ctx", {})
    vix = market_ctx.get("vix")
    spy_state = market_ctx.get("spy_state", "?")

    col_info1, col_info2, col_info3 = st.columns(3)
    with col_info1:
        st.caption(f"📅 掃描時間: {scan_time[:16] if scan_time != '—' else '—'}")
    with col_info2:
        vix_str = f"{vix:.1f}" if vix else "N/A"
        st.caption(f"📊 VIX: {vix_str}")
    with col_info3:
        st.caption(f"📈 SPY: {spy_state}")

    st.divider()

    # Compute fusion signals
    signals = compute_fusion_signals(scan_data, accum_state)

    if not signals:
        st.info("目前沒有同時在 VP 掃描和 Accumulation 追蹤中的標的。")
        st.caption("可能原因：scan_results.json 和 accum_state.json 沒有重疊的 symbol")
        return

    # ─── Stats Row ───
    total = len(signals)
    high_conf = sum(1 for s in signals if s["stars"] >= 4)
    actionable = sum(1 for s in signals if s["stars"] >= 3)
    flagged = sum(1 for s in signals if s.get("red_flags"))

    c1, c2, c3, c4 = st.columns(4)
    c1.metric("總分析標的", total)
    c2.metric("⭐ 高信心 (4+)", high_conf)
    c3.metric("✅ 可操作 (3+)", actionable)
    c4.metric("🚩 有紅旗", flagged)

    st.divider()

    # ─── Filter ───
    filter_col1, filter_col2 = st.columns(2)
    with filter_col1:
        min_stars = st.select_slider(
            "最低信心等級",
            options=[0, 1, 2, 3, 4, 5],
            value=0,
            format_func=lambda x: f"{'⭐' * x if x > 0 else '全部'}"
        )
    with filter_col2:
        phase_filter = st.multiselect(
            "Phase 篩選",
            options=["A", "B", "C", "D", "E", "UNKNOWN"],
            default=[],
            placeholder="全部 Phase"
        )

    # Apply filters
    filtered = signals
    if min_stars > 0:
        filtered = [s for s in filtered if s["stars"] >= min_stars]
    if phase_filter:
        filtered = [s for s in filtered if s["phase"] in phase_filter]

    if not filtered:
        st.info("篩選後沒有結果，試著放寬條件。")
        return

    # ─── Summary Table ───
    st.subheader(f"📋 總覽 ({len(filtered)} 檔)")
    _render_summary_table(filtered)

    st.divider()

    # ─── Detailed Cards ───
    st.subheader("📊 詳細分析")

    # Group by confidence level
    high = [s for s in filtered if s["stars"] >= 4]
    mid = [s for s in filtered if 2 <= s["stars"] < 4]
    low = [s for s in filtered if s["stars"] < 2]

    if high:
        st.markdown("### ⭐⭐⭐⭐+ 高信心")
        for sig in high:
            _render_signal_card(sig)

    if mid:
        st.markdown("### ⭐⭐ ~ ⭐⭐⭐ 中等信心")
        for sig in mid:
            _render_signal_card(sig)

    if low:
        st.markdown("### ❌ ~ ⭐ 低信心 / 不做")
        for sig in low:
            _render_signal_card(sig)

    # ─── Legend ───
    with st.expander("📖 信心等級說明"):
        st.markdown("""
| 信心 | 含義 | 動作建議 |
|------|------|----------|
| ⭐⭐⭐⭐⭐ | Phase C + Below VA (黃金入場) | PILOT BUY 10-25% |
| ⭐⭐⭐⭐ | Phase D + Inside VA / Phase E + Above VA | ADD or HOLD |
| ⭐⭐⭐ | 單系統確認 + 另一系統中性 | 小倉觀察 |
| ⭐⭐ | 只有一邊有信號 | 僅觀察 |
| ⭐ | 初期，太早 | 加入觀察清單 |
| ❌ | 矛盾信號或紅旗 | 不操作 |

**大方向修正：**
- 月/周線 Bullish + Phase C/D → +1 星
- 月/周線 Bearish + Phase A/B → -1 星
- 有紅旗 → 信心封頂 2 星

**紅旗觸發條件：**
- 月/周線 Below VA + 僅 Phase A/B
- Phase E 卻在 VA 下方（假突破）
- Phase C 卻在 VA 上方（矛盾）
- 日線 VP > 150%（嚴重偏離）
- 近 5 天分數持續下降
        """)
