"""Global configuration for the VP Strategy platform."""

SYMBOLS = [
    # Mega Cap Tech
    "AAPL", "MSFT", "GOOGL", "AMZN", "META", "NVDA", "TSLA",
    # Semiconductor / AI Chips
    "AVGO", "AMD", "INTC", "QCOM", "MU", "MRVL", "ARM", "TSM", "ASML", "AMAT", "LRCX", "KLAC", "ON",
    # AI / Cloud / Software
    "NOW", "CRWV", "PLTR", "AI", "SNOW", "DDOG", "NET", "MDB", "PANW", "CRWD", "ZS", "FTNT",
    # Cloud Infrastructure
    "CRM", "ORCL", "IBM", "ADBE", "INTU", "WDAY", "TEAM", "HUBS",
    # AI Hardware / Robotics
    "DELL", "HPE", "SMCI", "VRT", "ANET",
    # ETFs
    "SPY", "QQQ",
    # Misc Tech / AI Adjacent
    "UBER", "XYZ", "SHOP", "COIN",
]

SECTOR_ETFS = ["SMH", "XLK", "IGV", "SKYY", "BOTZ"]

SECTOR_MAP = {
    "NVDA": "SMH", "AVGO": "SMH", "AMD": "SMH", "INTC": "SMH", "QCOM": "SMH",
    "MU": "SMH", "MRVL": "SMH", "ARM": "SMH", "TSM": "SMH", "ASML": "SMH",
    "AMAT": "SMH", "LRCX": "SMH", "KLAC": "SMH", "ON": "SMH",
    "AAPL": "XLK", "MSFT": "XLK", "GOOGL": "XLK", "META": "XLK", "TSLA": "XLK",
    "NOW": "IGV", "CRWV": "IGV", "PLTR": "IGV", "AI": "IGV", "SNOW": "IGV",
    "DDOG": "IGV", "NET": "IGV", "MDB": "IGV", "PANW": "IGV", "CRWD": "IGV",
    "ZS": "IGV", "FTNT": "IGV",
    "CRM": "IGV", "ORCL": "XLK", "IBM": "XLK", "ADBE": "IGV", "INTU": "IGV",
    "WDAY": "IGV", "TEAM": "IGV", "HUBS": "IGV",
    "DELL": "XLK", "HPE": "XLK", "SMCI": "SMH", "VRT": "XLK", "ANET": "XLK",
    "SPY": "SPY", "QQQ": "QQQ",
    "UBER": "XLK", "XYZ": "XLK", "SHOP": "IGV", "COIN": "XLK", "AMZN": "XLK",
}

DEFAULT_CFG = {
    "vp_lookback": 60,
    "va_pct": 0.68,
    "atr_len": 14,
    "vol_ma_len": 21,
    "max_sl_atr": 3.0,
    "cooldown_bars": 3,
    "long_only": True,
    "primary_signal": "Breakout Retest",  # Best signal from backtest
}
