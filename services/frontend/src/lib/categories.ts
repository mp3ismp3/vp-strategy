// Binance Futures TradFi equity underlyings verified on 2026-08-23. Settlement suffixes are omitted;
// BRKB is normalized to the Yahoo-compatible ticker used by the data pipeline.
export const BINANCE_EQUITY_SYMBOLS = [
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
];
export const BINANCE_EQUITY_TICKERS = new Set(BINANCE_EQUITY_SYMBOLS);

export function isBinanceEquityTicker(ticker: string): boolean {
  return BINANCE_EQUITY_TICKERS.has(ticker);
}

const BINANCE_INDUSTRY_CATEGORIES: Record<string, string[]> = {
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
};

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
  "Financial / Fintech": [],
  "Digital Assets / Crypto": ["COIN", "MSTR"],
  "Consumer / Media": [],
  "Healthcare / Biotech": [],
  "Industrial / Aerospace": [],
  "Energy / Clean Tech": [],
  "ETFs": ["SPY", "QQQ"],
  "Misc Tech": ["UBER", "XYZ", "SHOP"],
};

for (const [category, symbols] of Object.entries(BINANCE_INDUSTRY_CATEGORIES)) {
  SYMBOL_CATEGORIES[category].push(...symbols);
}

// Reverse lookup: ticker → category
export const TICKER_TO_CATEGORY: Record<string, string> = {};
for (const [category, tickers] of Object.entries(SYMBOL_CATEGORIES)) {
  for (const ticker of tickers) {
    TICKER_TO_CATEGORY[ticker] = category;
  }
}

export const ALL_CATEGORIES = Object.keys(SYMBOL_CATEGORIES);
