"""Reusable UI components — charts and strategy cards."""

import streamlit as st


def render_chart(ticker):
    """Render candlestick chart with VP levels and VWAP."""
    try:
        import plotly.graph_objects as go
        from core.data_provider import YahooProvider
        from core.indicators import calc_vp, calc_vwap_bands, calc_anchored_vwap, find_swing_anchor
        from config import DEFAULT_CFG

        provider = YahooProvider()
        df = provider.get_daily(ticker, period="6mo")
        if df is None or len(df) < 60:
            st.info("Insufficient data for chart.")
            return

        cfg = DEFAULT_CFG
        vp = calc_vp(df, cfg["vp_lookback"], cfg["va_pct"])
        bands = calc_vwap_bands(df, cfg["vp_lookback"])

        # Last 60 bars for display
        display = df.tail(60)

        fig = go.Figure()

        # Candlestick
        fig.add_trace(go.Candlestick(
            x=display.index, open=display["Open"], high=display["High"],
            low=display["Low"], close=display["Close"], name="Price",
        ))

        # VP levels
        if vp:
            for level, name, color in [(vp["vah"], "VAH", "red"), (vp["poc"], "POC", "orange"), (vp["val"], "VAL", "green")]:
                fig.add_hline(y=level, line_dash="dash", line_color=color,
                             annotation_text=f"{name} {level:.2f}")

        # VWAP
        if bands:
            fig.add_hline(y=bands["vwap"], line_dash="dot", line_color="blue",
                         annotation_text=f"VWAP {bands['vwap']:.2f}")
            fig.add_hline(y=bands["upper"], line_dash="dot", line_color="lightblue",
                         annotation_text="+2σ", annotation_position="bottom right")
            fig.add_hline(y=bands["lower"], line_dash="dot", line_color="lightblue",
                         annotation_text="-2σ")

        # AVWAP
        anchor = find_swing_anchor(df)
        avwap = calc_anchored_vwap(df, anchor)
        if avwap:
            fig.add_hline(y=avwap, line_dash="dashdot", line_color="purple",
                         annotation_text=f"AVWAP {avwap:.2f}")

        fig.update_layout(
            title=f"{ticker} — Daily", xaxis_rangeslider_visible=False,
            height=500, margin=dict(l=50, r=50, t=50, b=30),
        )
        st.plotly_chart(fig, use_container_width=True)

    except Exception as e:
        st.error(f"Chart error: {e}")


def render_strategy_card(strategy_name, signals, trust, doc_text):
    """Render a strategy analysis card."""
    triggered = [s for s in signals if s.get("triggered")]
    status = "✅ Triggered" if triggered else "❌ Not triggered"
    trust_pct = f"{trust*100:.0f}%" if trust else "0%"

    with st.expander(f"{strategy_name} — {status} (Trust: {trust_pct})", expanded=bool(triggered)):
        st.caption(doc_text)
        if not triggered:
            st.info("No signal triggered for this strategy.")
            return

        for sig in triggered:
            direction_emoji = "🟢" if sig["direction"] == "LONG" else "🔴" if sig["direction"] == "SHORT" else "⚪"
            st.markdown(f"{direction_emoji} **{sig['signal_type']}** — {sig['direction']}")
            st.markdown(f"Confidence: {sig['confidence']:.0%}")

            col1, col2, col3 = st.columns(3)
            col1.metric("Entry", f"${sig['entry']:.2f}")
            col2.metric("Target", f"${sig['target']:.2f}")
            col3.metric("Stop", f"${sig['stop']:.2f}")

            risk = abs(sig["entry"] - sig["stop"])
            reward = abs(sig["target"] - sig["entry"])
            rr = f"{reward/risk:.1f}" if risk > 0 else "—"
            st.markdown(f"R:R = 1:{rr} | Hold: {sig['holding_type']}")

            if sig.get("reasons"):
                st.markdown("**Reasons:** " + " • ".join(sig["reasons"]))
            if sig.get("warnings"):
                st.warning(" • ".join(sig["warnings"]))
            st.divider()
