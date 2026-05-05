"""Market-wide context: VIX, SPY state, sector momentum."""

from core.data import download_symbol, download_batch
from core.indicators import calc_vp
from config import SECTOR_ETFS


def fetch_market_context(cfg):
    """Download and compute global market context."""
    ctx = {"vix": None, "spy_state": "unknown", "spy_df": None, "sector_momentum": {}}

    # VIX
    vix_df = download_symbol("^VIX", period="5d")
    if vix_df is not None and not vix_df.empty:
        ctx["vix"] = float(vix_df["Close"].iloc[-1])

    # SPY VA state
    spy_df = download_symbol("SPY", period="1y")
    if spy_df is not None and len(spy_df) >= cfg["vp_lookback"]:
        ctx["spy_df"] = spy_df
        vp = calc_vp(spy_df, cfg["vp_lookback"], cfg["va_pct"])
        if vp:
            last_close = float(spy_df["Close"].iloc[-1])
            if last_close > vp["vah"]:
                ctx["spy_state"] = "above_va"
            elif last_close < vp["val"]:
                ctx["spy_state"] = "below_va"
            else:
                ctx["spy_state"] = "in_va"

    # Sector ETF momentum (10-day return)
    batch = download_batch(SECTOR_ETFS, period="1mo")
    for etf, df in batch.items():
        if "Close" in df.columns and len(df) >= 10:
            try:
                ctx["sector_momentum"][etf] = (float(df["Close"].iloc[-1]) / float(df["Close"].iloc[-10]) - 1) * 100
            except (IndexError, ZeroDivisionError):
                pass

    vix_str = f"{ctx['vix']:.1f}" if ctx["vix"] else "N/A"
    print(f"  Market: VIX={vix_str} | SPY={ctx['spy_state']} | Sectors={len(ctx['sector_momentum'])}")
    return ctx
