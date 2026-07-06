"""Global configuration for the VP Strategy platform."""

SYMBOLS = [
    # Mega Cap Tech
    "AAPL", "MSFT", "GOOGL", "AMZN", "META", "NVDA", "TSLA",
    # Semiconductor / AI Chips
    "AVGO", "AMD", "INTC", "QCOM", "MU", "MRVL", "ARM", "TSM", "ASML", "AMAT", "LRCX", "KLAC", "ON",
    # AI / Cloud / Software
    "NOW", "CRWV", "PLTR", "AI", "SNOW", "DDOG", "NET", "MDB", "PANW", "CRWD", "ZS", "FTNT", "ESTC", "NTSK",
    # AI Agent 概念
    "CRM", "PATH", "HUBS", "ADBE",
    # Cloud Infrastructure
    "ORCL", "IBM", "INTU", "WDAY", "TEAM",
    # AI Hardware / Robotics
    "DELL", "HPE", "SMCI", "VRT", "ANET",
    # AI Power / Energy
    "VST", "CEG", "TLN", "NRG", "ETN", "PWR", "GEV", "FSLR",
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
    "ZS": "IGV", "FTNT": "IGV", "ESTC": "IGV", "NTSK": "IGV",
    "CRM": "IGV", "PATH": "IGV", "HUBS": "IGV", "ADBE": "IGV",
    "ORCL": "XLK", "IBM": "XLK", "INTU": "IGV",
    "WDAY": "IGV", "TEAM": "IGV",
    "DELL": "XLK", "HPE": "XLK", "SMCI": "SMH", "VRT": "XLK", "ANET": "XLK",
    "VST": "XLK", "CEG": "XLK", "TLN": "XLK", "NRG": "XLK",
    "ETN": "XLK", "PWR": "XLK", "GEV": "XLK", "FSLR": "XLK",
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
    "long_only": False,
    "primary_signal": "Breakout Retest",
}

# Signal Fusion Engine weights (must sum to 1.0)
SCORING_WEIGHTS = {
    "VP": 0.4,
    "VWAP": 0.3,
    "TrendFollowing": 0.2,
    "regime": 0.1,
}

# Regime detection thresholds
REGIME_THRESHOLDS = {
    "poc_flat_pct": 0.003,        # POC shift < 0.3% = flat
    "poc_migrating_pct": 0.008,   # POC shift > 0.8% = migrating
    "atr_compression": 0.7,       # ATR < 0.7x avg = compressed
    "atr_compression_days": 5,    # consecutive days needed
    "atr_expansion": 1.5,         # ATR > 1.5x avg = expanding
    "vix_high": 25,               # VIX >= 25 = high volatility
    "vix_low": 15,                # VIX <= 15 = low volatility
}

# Regime → Strategy trust multipliers
REGIME_STRATEGY_TRUST = {
    "range":       {"VP": 1.0, "VWAP": 0.8, "TrendFollowing": 0.3},
    "trend":       {"VP": 0.5, "VWAP": 0.9, "TrendFollowing": 1.0},
    "expansion":   {"VP": 0.2, "VWAP": 0.6, "TrendFollowing": 0.8},
    "compression": {"VP": 0.7, "VWAP": 1.0, "TrendFollowing": 0.4},
}
