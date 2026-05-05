"""Data download and caching layer."""

import pandas as pd
import yfinance as yf


def _flatten_columns(df):
    if isinstance(df.columns, pd.MultiIndex):
        df.columns = df.columns.get_level_values(0)
    return df


def download_symbol(symbol, period="1y", interval="1d"):
    """Download OHLCV for a single symbol. Returns DataFrame or None."""
    try:
        df = yf.download(symbol, period=period, interval=interval, progress=False)
        if df.empty:
            return None
        return _flatten_columns(df)
    except Exception:
        return None


def download_batch(symbols, period="1mo", interval="1d"):
    """Download multiple symbols in one call. Returns dict of {symbol: DataFrame}."""
    result = {}
    try:
        df = yf.download(symbols, period=period, interval=interval, progress=False)
        if df.empty:
            return result
        if isinstance(df.columns, pd.MultiIndex):
            for sym in symbols:
                try:
                    sub = df.xs(sym, level=1, axis=1) if sym in df.columns.get_level_values(1) else None
                    if sub is not None and not sub.empty:
                        result[sym] = sub
                except (KeyError, TypeError):
                    pass
            # Fallback: try Close column multi-index
            if not result and "Close" in df.columns.get_level_values(0):
                for sym in symbols:
                    try:
                        close = df["Close"][sym].dropna()
                        if len(close) >= 2:
                            result[sym] = pd.DataFrame({"Close": close})
                    except (KeyError, TypeError):
                        pass
        else:
            # Single symbol returned flat
            result[symbols[0]] = _flatten_columns(df)
    except Exception:
        pass
    return result
