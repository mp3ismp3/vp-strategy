"""Data provider abstraction + YahooProvider implementation."""

import time
import random
from abc import ABC, abstractmethod
from concurrent.futures import ThreadPoolExecutor, as_completed

import pandas as pd
import yfinance as yf


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

    def get_intraday(self, symbol: str, period: str = "60d", interval: str = "1h") -> pd.DataFrame | None:
        try:
            df = yf.download(symbol, period=period, interval=interval,
                           progress=False, prepost=False)
            if df.empty:
                return None
            return _flatten_columns(df)
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
