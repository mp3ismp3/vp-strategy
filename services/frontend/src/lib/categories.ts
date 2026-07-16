// Symbol categories — mirrors config.py SYMBOL_CATEGORIES
export const SYMBOL_CATEGORIES: Record<string, string[]> = {
  "Mega Cap Tech": ["AAPL", "MSFT", "GOOGL", "AMZN", "META", "NVDA", "TSLA"],
  "Semiconductor / AI Chips": ["AVGO", "AMD", "INTC", "QCOM", "MU", "MRVL", "ARM", "TSM", "ASML", "AMAT", "LRCX", "KLAC", "ON"],
  "AI / Cloud / Software": ["NOW", "CRWV", "PLTR", "AI", "SNOW", "DDOG", "NET", "MDB", "PANW", "CRWD", "ZS", "FTNT", "ESTC", "NTSK"],
  "AI Agent": ["CRM", "PATH", "HUBS", "ADBE"],
  "Cloud Infrastructure": ["ORCL", "IBM", "INTU", "WDAY", "TEAM"],
  "AI Hardware / Robotics": ["DELL", "HPE", "SMCI", "VRT", "ANET"],
  "AI Power / Energy": ["VST", "CEG", "TLN", "NRG", "ETN", "PWR", "GEV", "FSLR"],
  "AI Quantum / Emerging": ["SERV", "IONQ", "RGTI", "QUBT"],
  "AI Infra / Networking": ["CSCO", "CIEN", "LITE"],
  "AI Healthcare": ["ISRG", "VEEV", "DXCM"],
  "AI Cybersecurity": ["S", "OKTA"],
  "AI Enterprise / Automation": ["MNDY", "DOCN", "TWLO", "TTD"],
  "ETFs": ["SPY", "QQQ"],
  "Misc Tech": ["UBER", "XYZ", "SHOP", "COIN"],
};

// Reverse lookup: ticker → category
export const TICKER_TO_CATEGORY: Record<string, string> = {};
for (const [category, tickers] of Object.entries(SYMBOL_CATEGORIES)) {
  for (const ticker of tickers) {
    TICKER_TO_CATEGORY[ticker] = category;
  }
}

export const ALL_CATEGORIES = Object.keys(SYMBOL_CATEGORIES);
