"""Data provider abstraction + YahooProvider implementation."""

import os
import time
import random
from abc import ABC, abstractmethod
from concurrent.futures import ThreadPoolExecutor, as_completed
from pathlib import Path

import pandas as pd
import yfinance as yf

CACHE_DIR = Path(__file__).parent.parent / "data" / "cache" / "1h"
CACHE_TTL_SECONDS = 4 * 3600  # 4 hours


class DataProvider(ABC):
    @abstractmethod
    def get_daily(self, symbol: str, period: str = "1y") -> pd.DataFrame | None:
        pass

    @abstractmethod
    def get_intraday(self, symbol: str, period: str = "60d", interval: str = "1h") -> pd.DataFrame | None:
        pass

    @abstractmethod
    def batch_daily(self, symbols: list, period: str = "1y") -> dict:
        pass


def _flatten_columns(df):
    if isinstance(df.columns, pd.MultiIndex):
        df.columns = df.columns.get_level_values(0)
    return df


def _cache_path(symbol: str) -> Path:
    """Return cache file path for a symbol's 1H data."""
    return CACHE_DIR / f"{symbol}_1h.csv"


def _cache_is_fresh(path: Path) -> bool:
    """Check if cache file exists and is younger than TTL."""
    if not path.exists():
        return False
    mtime = path.stat().st_mtime
    age = time.time() - mtime
    return age < CACHE_TTL_SECONDS


def _read_cache(path: Path) -> pd.DataFrame | None:
    """Read cached 1H data from CSV."""
    try:
        df = pd.read_csv(path, index_col=0, parse_dates=True)
        if df.empty:
            return None
        # Ensure index is proper DatetimeIndex
        if not isinstance(df.index, pd.DatetimeIndex):
            df.index = pd.to_datetime(df.index, utc=True)
        return df
    except Exception:
        return None


def _write_cache(path: Path, df: pd.DataFrame) -> None:
    """Write 1H data to CSV cache."""
    try:
        path.parent.mkdir(parents=True, exist_ok=True)
        df.to_csv(path)
    except Exception:
        pass


class YahooProvider(DataProvider):
    """Yahoo Finance data provider with rate-limit jitter."""

    def __init__(self, max_workers: int = 5, jitter: tuple = (0.1, 0.3)):
        self.max_workers = max_workers
        self.jitter = jitter

    def get_daily(self, symbol: str, period: str = "1y") -> pd.DataFrame | None:
        try:
            df = yf.download(symbol, period=period, interval="1d",
                           progress=False, prepost=False)
            if df.empty:
                return None
            return _flatten_columns(df)
        except Exception:
            return None

    def get_intraday(self, symbol: str, period: str = "730d",
                     interval: str = "1h") -> pd.DataFrame | None:
        """Fetch intraday data with file-based caching.

        Cache uses file mtime for TTL check (4 hours).
        Falls back to fresh download if cache is stale or missing.
        """
        cache_file = _cache_path(symbol)

        # Check cache first
        if _cache_is_fresh(cache_file):
            df = _read_cache(cache_file)
            if df is not None:
                return df

        # Download fresh
        try:
            df = yf.download(symbol, period=period, interval=interval,
                           progress=False, prepost=False)
            if df.empty:
                return None
            df = _flatten_columns(df)
            _write_cache(cache_file, df)
            return df
        except Exception:
            return None

    def batch_daily(self, symbols: list, period: str = "1y") -> dict:
        results = {}

        def _fetch(sym):
            time.sleep(random.uniform(*self.jitter))
            return sym, self.get_daily(sym, period)

        with ThreadPoolExecutor(max_workers=self.max_workers) as executor:
            futures = {executor.submit(_fetch, s): s for s in symbols}
            for future in as_completed(futures):
                try:
                    sym, df = future.result()
                    if df is not None:
                        results[sym] = df
                except Exception:
                    pass
        return results

    def batch_intraday(self, symbols: list, period: str = "730d",
                       interval: str = "1h") -> dict:
        """Batch fetch intraday data with caching.

        Uses per-symbol CSV cache (4h TTL). Downloads in parallel.
        Returns {symbol: DataFrame} for symbols with data.
        """
        results = {}

        def _fetch(sym):
            time.sleep(random.uniform(*self.jitter))
            return sym, self.get_intraday(sym, period, interval)

        with ThreadPoolExecutor(max_workers=self.max_workers) as executor:
            futures = {executor.submit(_fetch, s): s for s in symbols}
            for future in as_completed(futures):
                try:
                    sym, df = future.result()
                    if df is not None:
                        results[sym] = df
                except Exception:
                    pass
        return results
