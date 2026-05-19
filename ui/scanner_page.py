"""Scanner Dashboard — reads scan_results.json and displays ranking table."""

import json
from pathlib import Path

import streamlit as st
import pandas as pd

RESULTS_FILE = Path(__file__).parent.parent / "data" / "scan_results.json"


def load_results():
    if not RESULTS_FILE.exists():
        return None
    try:
        return json.loads(RESULTS_FILE.read_text())
    except (json.JSONDecodeError, IOError):
        return None


def render_scanner():
    st.title("📊 Multi-Strategy Scanner Dashboard")

    data = load_results()
    if not data or not data.get("results"):
        st.warning("No scan results found. Run `python scan_all.py` first.")
        return

    # Header info
    col1, col2, col3 = st.columns(3)
    ctx = data.get("market_ctx", {})
    col1.metric("VIX", f"{ctx.get('vix', 0):.1f}" if ctx.get('vix') else "N/A")
    col2.metric("SPY State", ctx.get("spy_state", "unknown"))
    col3.metric("Signals Found", data.get("signals_found", 0))

    st.caption(f"Last scan: {data.get('scan_time', 'unknown')}")

    # Filters
    with st.sidebar:
        st.header("Filters")
        min_score = st.slider("Min Score", 0, 100, 40)
        direction_filter = st.multiselect("Direction", ["LONG", "SHORT", "NEUTRAL"], default=["LONG", "SHORT"])
        regime_filter = st.multiselect("Regime", ["range", "trend", "expansion", "compression"], default=["range", "trend", "expansion", "compression"])
        holding_filter = st.multiselect("Holding", ["short", "mid", "long"], default=["short", "mid", "long"])

        st.divider()
        from ui.strategy_docs import render_sidebar_docs
        render_sidebar_docs()

    # Filter results
    results = data["results"]
    filtered = [
        r for r in results
        if r["score"] >= min_score
        and r["direction"] in direction_filter
        and r["regime"] in regime_filter
        and r.get("holding_timeframe", "mid") in holding_filter
    ]

    if not filtered:
        st.info("No results match current filters.")
        return

    # Build DataFrame
    rows = []
    for r in filtered:
        tracks = r.get("tracks", {})
        rows.append({
            "Ticker": r["ticker"],
            "Score": r["score"],
            "Direction": r["direction"],
            "Setup": r["setup"],
            "Regime": r["regime"],
            "R:R": r["rr"],
            "Holding": r["holding"],
            "Short": tracks.get("short", {}).get("score", "—"),
            "Mid": tracks.get("mid", {}).get("score", "—"),
            "Long": tracks.get("long", {}).get("score", "—"),
        })

    df = pd.DataFrame(rows)

    # Color coding
    def color_score(val):
        if val >= 80:
            return "background-color: #c6efce"
        elif val >= 60:
            return "background-color: #ffeb9c"
        return ""

    def color_direction(val):
        if val == "LONG":
            return "color: green"
        elif val == "SHORT":
            return "color: red"
        return ""

    styled = df.style.applymap(color_score, subset=["Score"]).applymap(color_direction, subset=["Direction"])
    st.dataframe(styled, use_container_width=True, hide_index=True)

    # Click to detail
    st.divider()
    selected = st.selectbox("Select ticker for detailed analysis:", [r["ticker"] for r in filtered])
    if st.button("View Detail →"):
        st.query_params["page"] = "detail"
        st.query_params["ticker"] = selected
        st.rerun()
