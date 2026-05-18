"""Detail Analysis Page — single stock full analysis."""

import json
from pathlib import Path

import streamlit as st

RESULTS_FILE = Path(__file__).parent.parent / "data" / "scan_results.json"


def _load_ticker_data(ticker):
    if not RESULTS_FILE.exists():
        return None, None
    data = json.loads(RESULTS_FILE.read_text())
    for r in data.get("results", []):
        if r["ticker"] == ticker:
            return r, data.get("market_ctx", {})
    return None, None


def render_detail(ticker):
    st.title(f"📈 {ticker} — Detailed Analysis")

    if st.button("← Back to Scanner"):
        st.query_params["page"] = "scanner"
        st.query_params.pop("ticker", None)
        st.rerun()

    result, market_ctx = _load_ticker_data(ticker)
    if not result:
        st.error(f"No data for {ticker}. Run scanner first.")
        return

    # Summary metrics
    col1, col2, col3, col4 = st.columns(4)
    col1.metric("Composite Score", f"{result['score']}/100")
    col2.metric("Direction", result["label"])
    col3.metric("Regime", result["regime"].title())
    col4.metric("Hold", result["holding"])

    # Chart
    st.subheader("Price Chart")
    from ui.components import render_chart
    render_chart(ticker)

    # Strategy Cards
    st.subheader("Strategy Analysis")
    from ui.strategy_docs import STRATEGY_DOCS
    from ui.components import render_strategy_card

    signals_by_strategy = {}
    for sig in result.get("signals", []):
        strat = sig["strategy"]
        if strat not in signals_by_strategy:
            signals_by_strategy[strat] = []
        signals_by_strategy[strat].append(sig)

    for strat_name in ["VP", "VWAP", "TrendFollowing"]:
        sigs = signals_by_strategy.get(strat_name, [])
        trust = result.get("regime_trust", {}).get(strat_name, 0)
        render_strategy_card(strat_name, sigs, trust, STRATEGY_DOCS.get(strat_name, ""))

    # Trade Plan
    st.subheader("📋 Trade Plan")
    st.markdown(f"""
    | Item | Value |
    |------|-------|
    | **Score** | {result['score']}/100 ({result['label']}) |
    | **Direction** | {result['direction']} |
    | **Setup** | {result['setup']} |
    | **Holding** | {result['holding']} ({result.get('holding_reasoning', '')}) |
    | **R:R** | {result['rr']:.1f} |
    | **Regime** | {result['regime']} |
    """)

    if result.get("conflicts"):
        st.warning(f"⚠️ Strategy conflicts: {', '.join(result['conflicts'])}")

    # Per-strategy scores
    st.subheader("Strategy Contribution")
    for strat, score in result.get("per_strategy", {}).items():
        st.progress(min(score / 50, 1.0), text=f"{strat}: {score:.1f} pts")
