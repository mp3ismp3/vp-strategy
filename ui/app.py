"""Streamlit Multi-Strategy Analysis Platform — Main Entry Point.

Run: streamlit run ui/app.py
"""

import streamlit as st

st.set_page_config(
    page_title="VP Strategy Platform",
    page_icon="📊",
    layout="wide",
)

# Navigation
page = st.query_params.get("page", "scanner")
ticker = st.query_params.get("ticker", None)

if page == "detail" and ticker:
    from ui.detail_page import render_detail
    render_detail(ticker)
else:
    from ui.scanner_page import render_scanner
    render_scanner()
