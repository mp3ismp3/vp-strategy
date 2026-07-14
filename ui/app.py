"""Streamlit Multi-Strategy Analysis Platform — Main Entry Point.

Run: streamlit run ui/app.py
"""

import sys
from pathlib import Path

# Ensure project root is on sys.path so `from ui.xxx` works
sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

import streamlit as st

st.set_page_config(
    page_title="VP Strategy Platform",
    page_icon="💰",
    layout="wide",
    initial_sidebar_state="collapsed",
)

st.markdown(
    """
    <style>
    [data-testid="collapsedControl"] { display: none; }
    #MainMenu { visibility: hidden; }
    footer { visibility: hidden; }
    header { visibility: hidden; }
    .block-container { padding-top: 0 !important; }

    .top-nav {
        display: flex;
        justify-content: center;
        gap: 3.5rem;
        padding: 1.2rem 2rem;
        border-bottom: 1px solid #eee;
        background: #fafafa;
    }
    .top-nav a {
        text-decoration: none;
        color: #111;
        font-size: 0.85rem;
        font-weight: 600;
        letter-spacing: 0.5px;
    }
    .top-nav a:hover { color: #555; }

    .hero {
        display: flex;
        flex-direction: column;
        align-items: center;
        justify-content: center;
        min-height: 60vh;
        text-align: center;
    }
    .hero-icon { font-size: 5rem; margin-bottom: 1.5rem; }
    .hero-title {
        font-size: 2.2rem;
        font-weight: 700;
        color: #111;
        line-height: 1.4;
    }

    .bottom-nav {
        display: flex;
        justify-content: center;
        gap: 4rem;
        padding: 2rem;
    }
    .bottom-nav a {
        text-decoration: none;
        color: #111;
        font-size: 0.9rem;
        font-weight: 700;
        letter-spacing: 0.5px;
    }
    .bottom-nav a:hover { color: #666; }
    </style>
    """,
    unsafe_allow_html=True,
)

# --- Nav bar (always visible) ---
st.markdown(
    """
    <div class="top-nav">
        <a href="/" target="_self">HOME</a>
        <a href="/?page=scanner" target="_self">SCANNER</a>
        <a href="/?page=accumulation" target="_self">ACCUMULATION</a>
        <a href="/?page=fusion" target="_self">FUSION</a>
    </div>
    """,
    unsafe_allow_html=True,
)

# --- Page Routing ---
page = st.query_params.get("page", "home")

if page == "scanner":
    from ui.scanner_page import render_scanner
    render_scanner()
elif page == "accumulation":
    from ui.accumulation_page import render_accumulation
    render_accumulation()
elif page == "fusion":
    from ui.fusion_page import render_fusion
    render_fusion()
else:
    # Home
    st.markdown(
        """
        <div class="hero">
            <div class="hero-icon">💰</div>
            <div class="hero-title">
                Multi-Strategy Analysis Platform<br>
                for market auction theory
            </div>
        </div>
        <div class="bottom-nav">
            <a href="/?page=scanner" target="_self">SCANNER</a>
            <a href="/?page=accumulation" target="_self">ACCUMULATION</a>
            <a href="/?page=fusion" target="_self">FUSION</a>
        </div>
        """,
        unsafe_allow_html=True,
    )
