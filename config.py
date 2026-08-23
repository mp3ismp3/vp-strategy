"""Global configuration for the VP Strategy platform."""

# Binance Futures symbols whose 2026-08-23 exchange metadata reports
# contractType=TRADIFI_PERPETUAL and underlyingType=EQUITY. Contract settlement
# suffixes are intentionally removed; BRKB is normalized for Yahoo Finance.
BINANCE_EQUITY_SYMBOLS = [
    "AAOI", "AAPL", "ADBE", "ALAB", "AMAT", "AMD", "AMZN", "APP", "ARM", "ASML",
    "ASTS", "AVGO", "AXTI", "BABA", "BBX", "BE", "BITO", "BMNR", "BNC", "BOT",
    "BRK-B", "BSP", "BX", "CAT", "CBRS", "CIEN", "COHR", "COIN", "COST", "CRCL",
    "CRDO", "CRM", "CRWD", "CRWV", "CSCO", "DELL", "DIS", "DKNG", "DRAM", "EBAY",
    "EWJ", "EWT", "EWY", "EWZ", "FLEX", "FLNC", "FWDI", "GDX", "GEV", "GLW",
    "GME", "GOOGL", "GS", "HD", "HIMS", "HOOD", "HPE", "IBM", "INTC", "INTW",
    "IREN", "IWM", "JPM", "KLAC", "KO", "KORU", "KSTR", "LITE", "LLY", "LRCX",
    "LYTE", "META", "MRVL", "MSFT", "MSTR", "MU", "MUU", "MVLL", "NBIS", "NET",
    "NFLX", "NOK", "NOW", "NVDA", "NVO", "ONDS", "ORCL", "PANW", "PAYP", "PENG",
    "PLTR", "PYPL", "QCOM", "QNTX", "QQQ", "RDDT", "RIVN", "RKLB", "SHAZ", "SHOP",
    "SKHY", "SMCI", "SMH", "SNDK", "SNOW", "SNXX", "SOFI", "SONY", "SOXL", "SOXS",
    "SPCX", "SPY", "SQQQ", "STRC", "STXX", "TBT", "TER", "TMF", "TQQQ", "TSLA",
    "TSM", "TTWO", "TXN", "TZA", "UBER", "URNM", "USAR", "UVXY", "V", "VRT",
    "VST", "WDC", "WEN", "WMT", "XBI", "XLE", "ZM",
]

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
    # AI Quantum / Robotics / Emerging
    "SERV", "IONQ", "RGTI", "QUBT",
    # AI Infra / Networking
    "CSCO", "CIEN", "LITE",
    # AI Healthcare
    "ISRG", "VEEV", "DXCM",
    # AI Cybersecurity
    "S", "OKTA",
    # AI Enterprise / Automation
    "MNDY", "DOCN", "TWLO", "TTD",
    # ETFs
    "SPY", "QQQ",
    # Misc Tech / AI Adjacent
    "UBER", "XYZ", "SHOP", "COIN", "MSTR",
]
BINANCE_EQUITY_ADDITIONS = [
    symbol for symbol in BINANCE_EQUITY_SYMBOLS if symbol not in SYMBOLS
]
SYMBOLS.extend(BINANCE_EQUITY_ADDITIONS)

BINANCE_INDUSTRY_CATEGORIES = {
    "Semiconductor / AI Chips": ["ALAB", "AXTI", "CBRS", "CRDO", "SKHY", "SNDK", "TER", "TXN", "WDC"],
    "AI / Cloud / Software": ["APP", "NBIS", "PENG", "ZM"],
    "AI Hardware / Robotics": ["BOT", "ONDS"],
    "AI Infra / Networking": ["AAOI", "COHR", "GLW", "NOK"],
    "Financial / Fintech": ["BBX", "BRK-B", "BSP", "BX", "CRCL", "GS", "HOOD", "JPM", "PAYP", "PYPL", "SOFI", "V"],
    "Digital Assets / Crypto": ["BMNR", "BNC", "FWDI", "IREN", "STRC"],
    "Consumer / Media": ["BABA", "COST", "DIS", "DKNG", "EBAY", "GME", "HD", "KO", "LYTE", "NFLX", "QNTX", "RDDT", "RIVN", "SONY", "TTWO", "WEN", "WMT"],
    "Healthcare / Biotech": ["HIMS", "LLY", "NVO"],
    "Industrial / Aerospace": ["ASTS", "CAT", "FLEX", "RKLB", "SPCX", "USAR"],
    "Energy / Clean Tech": ["BE", "FLNC"],
    "ETFs": [
        "BITO", "DRAM", "EWJ", "EWT", "EWY", "EWZ", "GDX", "INTW", "IWM", "KORU",
        "KSTR", "MUU", "MVLL", "SHAZ", "SMH", "SNXX", "SOXL", "SOXS", "SQQQ", "STXX",
        "TBT", "TMF", "TQQQ", "TZA", "URNM", "UVXY", "XBI", "XLE",
    ],
}

ETF_BENCHMARKS = {
    "BITO": "BITO", "DRAM": "SMH", "EWJ": "EWJ", "EWT": "EWT", "EWY": "EWY",
    "EWZ": "EWZ", "GDX": "GDX", "INTW": "INTW", "IWM": "IWM", "KORU": "KORU",
    "KSTR": "KSTR", "MUU": "MUU", "MVLL": "MVLL", "SHAZ": "SHAZ", "SMH": "SMH",
    "SNXX": "SNXX", "SOXL": "SOXL", "SOXS": "SOXS", "SPY": "SPY", "QQQ": "QQQ",
    "SQQQ": "SQQQ", "STXX": "STXX", "TBT": "TBT", "TMF": "TMF", "TQQQ": "TQQQ",
    "TZA": "TZA", "URNM": "URNM", "UVXY": "UVXY", "XBI": "XBI", "XLE": "XLE",
}

SECTOR_ETFS = list(dict.fromkeys([
    "SMH", "XLK", "IGV", "SKYY", "BOTZ", "XLF", "XLY", "XLV", "XLI", "XLE",
    *ETF_BENCHMARKS.values(),
]))

SYMBOL_CATEGORIES = {
    "Mega Cap Tech": ["AAPL", "MSFT", "GOOGL", "AMZN", "META", "NVDA", "TSLA"],
    "Semiconductor / AI Chips": ["AVGO", "AMD", "INTC", "QCOM", "MU", "MRVL", "ARM", "TSM", "ASML", "AMAT", "LRCX", "KLAC", "ON"],
    "AI / Cloud / Software": ["NOW", "CRWV", "PLTR", "AI", "SNOW", "DDOG", "NET", "MDB", "PANW", "CRWD", "ZS", "FTNT", "ESTC", "NTSK"],
    "AI Agent": ["CRM", "PATH", "HUBS", "ADBE"],
    "Cloud Infrastructure": ["ORCL", "IBM", "INTU", "WDAY", "TEAM"],
    "AI Hardware / Robotics": ["DELL", "HPE", "SMCI", "VRT", "ANET"],
    "AI Power / Energy": ["VST", "CEG", "TLN", "NRG", "ETN", "PWR", "GEV", "FSLR"],
    "AI Quantum / Emerging": ["SERV", "IONQ", "RGTI", "QUBT"],
    "AI Infra / Networking": ["CSCO", "JNPR", "CIEN", "LITE"],
    "AI Healthcare": ["ISRG", "VEEV", "DXCM"],
    "AI Cybersecurity": ["S", "CYBR", "OKTA"],
    "AI Enterprise / Automation": ["MNDY", "DOCN", "TWLO", "TTD"],
    "Financial / Fintech": [],
    "Digital Assets / Crypto": ["COIN", "MSTR"],
    "Consumer / Media": [],
    "Healthcare / Biotech": [],
    "Industrial / Aerospace": [],
    "Energy / Clean Tech": [],
    "ETFs": ["SPY", "QQQ"],
    "Misc Tech": ["UBER", "XYZ", "SHOP"],
}
for _category, _symbols in BINANCE_INDUSTRY_CATEGORIES.items():
    SYMBOL_CATEGORIES[_category].extend(_symbols)

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
    "UBER": "XLK", "XYZ": "XLK", "SHOP": "IGV", "COIN": "XLK", "MSTR": "XLK", "AMZN": "XLK",
    # New AI stocks
    "SERV": "XLK", "IONQ": "XLK", "RGTI": "XLK", "QUBT": "XLK",
    "CSCO": "XLK", "CIEN": "XLK", "LITE": "XLK",
    "ISRG": "XLK", "VEEV": "IGV", "DXCM": "XLK",
    "S": "IGV", "OKTA": "IGV",
    "MNDY": "IGV", "DOCN": "IGV", "TWLO": "IGV", "TTD": "IGV",
}

# Existing sector-specific mappings remain authoritative. Newly tracked Binance
# equities use SPY as the neutral relative-strength benchmark.
for _symbol in BINANCE_EQUITY_SYMBOLS:
    SECTOR_MAP.setdefault(_symbol, "SPY")
for _symbol in BINANCE_INDUSTRY_CATEGORIES["Semiconductor / AI Chips"]:
    SECTOR_MAP[_symbol] = "SMH"
for _symbol in BINANCE_INDUSTRY_CATEGORIES["AI / Cloud / Software"]:
    SECTOR_MAP[_symbol] = "IGV"
for _symbol in BINANCE_INDUSTRY_CATEGORIES["AI Infra / Networking"]:
    SECTOR_MAP[_symbol] = "XLK"
for _symbol in BINANCE_INDUSTRY_CATEGORIES["Financial / Fintech"]:
    SECTOR_MAP[_symbol] = "XLF"
for _symbol in BINANCE_INDUSTRY_CATEGORIES["Digital Assets / Crypto"]:
    SECTOR_MAP[_symbol] = "SPY"
for _symbol in BINANCE_INDUSTRY_CATEGORIES["Consumer / Media"]:
    SECTOR_MAP[_symbol] = "XLY"
for _symbol in BINANCE_INDUSTRY_CATEGORIES["Healthcare / Biotech"]:
    SECTOR_MAP[_symbol] = "XLV"
for _symbol in BINANCE_INDUSTRY_CATEGORIES["Industrial / Aerospace"]:
    SECTOR_MAP[_symbol] = "XLI"
for _symbol in BINANCE_INDUSTRY_CATEGORIES["Energy / Clean Tech"]:
    SECTOR_MAP[_symbol] = "XLE"
SECTOR_MAP.update(ETF_BENCHMARKS)

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
