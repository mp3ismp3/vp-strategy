export type DataPoint = { date: string; value: number };

export type CryptoLiquidityPayload = {
  asOf: string;
  sources: { stablecoin: string | null; market: string | null; etf: string | null };
  stablecoin: { current: number | null; changePct: number | null; changePct1d: number | null; changePct7d: number | null; changePct30d: number | null; changePct90d: number | null; history: DataPoint[] };
  etf: { status: "unavailable" | "available"; btcNetFlow: number | null; ethNetFlow: number | null; history: DataPoint[] };
  market: { totalMarketCap: number | null; totalVolume: number | null; marketCapChangePct: number | null; volumeRatio30d: number | null; history: DataPoint[] };
  liquidityBias: "strong_inflow" | "moderate_inflow" | "neutral" | "moderate_outflow" | "strong_outflow" | "insufficient_data";
  biasReasons: string[];
};

function dateFromSeconds(value: number): string {
  return new Date(value * 1000).toISOString().slice(0, 10);
}

export function normalizeStablecoinChart(input: unknown): DataPoint[] {
  const rows = Array.isArray(input)
    ? input
    : input && typeof input === "object" && Array.isArray((input as { tokens?: unknown }).tokens)
      ? (input as { tokens: unknown[] }).tokens
      : [];
  return rows.flatMap((row) => {
    if (!row || typeof row !== "object") return [];
    const item = row as {
      date?: unknown;
      circulating?: { peggedUSD?: unknown };
      totalCirculating?: { peggedUSD?: unknown };
    };
    const date = Number(item.date);
    const value = Number(item.circulating?.peggedUSD ?? item.totalCirculating?.peggedUSD);
    return Number.isFinite(date) && Number.isFinite(value) ? [{ date: dateFromSeconds(date), value }] : [];
  });
}

export function combineSeries(...series: DataPoint[][]): DataPoint[] {
  const totals = new Map<string, number>();
  for (const rows of series) for (const row of rows) totals.set(row.date, (totals.get(row.date) || 0) + row.value);
  return [...totals.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([date, value]) => ({ date, value }));
}

export function joinSeriesByDate(left: DataPoint[], right: DataPoint[]): Array<{ date: string; left: number; right: number }> {
  const rightByDate = new Map(right.map((row) => [row.date, row.value]));
  return left.flatMap((row) => {
    const value = rightByDate.get(row.date);
    return value == null ? [] : [{ date: row.date, left: row.value, right: value }];
  });
}

export function normalizeCoinPaprikaBitcoin(input: unknown): { marketCap: DataPoint[]; volume: DataPoint[] } {
  if (!Array.isArray(input)) return { marketCap: [], volume: [] };
  const marketCap: DataPoint[] = [];
  const volume: DataPoint[] = [];
  for (const row of input) {
    if (!row || typeof row !== "object") continue;
    const item = row as { timestamp?: unknown; market_cap?: unknown; volume_24h?: unknown };
    const timestamp = typeof item.timestamp === "string" ? Date.parse(item.timestamp) : Number.NaN;
    if (!Number.isFinite(timestamp)) continue;
    const date = new Date(timestamp).toISOString().slice(0, 10);
    const marketCapValue = Number(item.market_cap);
    const volumeValue = Number(item.volume_24h);
    if (Number.isFinite(marketCapValue)) marketCap.push({ date, value: marketCapValue });
    if (Number.isFinite(volumeValue)) volume.push({ date, value: volumeValue });
  }
  return { marketCap, volume };
}

function pctChange(series: DataPoint[]): number | null {
  if (series.length < 2 || series[0].value === 0) return null;
  return Number((((series.at(-1)!.value - series[0].value) / series[0].value) * 100).toFixed(2));
}

function pctChangeOver(series: DataPoint[], days: number): number | null {
  if (series.length < 2) return null;
  const current = series.at(-1)!.value;
  const previous = series[Math.max(0, series.length - 1 - days)].value;
  return previous === 0 ? null : Number((((current - previous) / previous) * 100).toFixed(2));
}

export function buildLiquiditySnapshot(stablecoin: DataPoint[], market: { marketCap: DataPoint[]; volume: DataPoint[] }, etf: { btcNetFlow: number; ethNetFlow: number } | null): CryptoLiquidityPayload {
  const stableChange = pctChange(stablecoin);
  const stableChange1d = pctChangeOver(stablecoin, 1);
  const stableChange7d = pctChangeOver(stablecoin, 7);
  const stableChange30d = pctChangeOver(stablecoin, 30);
  const stableChange90d = pctChangeOver(stablecoin, 90);
  const marketChange = pctChangeOver(market.marketCap, 30);
  const score = (stableChange30d ?? 0) > 0 ? 1 : (stableChange30d ?? 0) < 0 ? -1 : 0;
  const marketScore = (marketChange ?? 0) > 0 ? 1 : (marketChange ?? 0) < 0 ? -1 : 0;
  const biasScore = score + marketScore + (etf && etf.btcNetFlow + etf.ethNetFlow > 0 ? 1 : 0);
  const biasReasons = [
    stableChange30d == null ? "Stablecoin supply 30D history unavailable" : stableChange30d > 0 ? "Stablecoin supply expanding" : "Stablecoin supply contracting",
    marketChange == null ? "Bitcoin market cap history unavailable" : marketChange > 0 ? "Bitcoin market cap expanding" : "Bitcoin market cap contracting",
  ];
  if (etf) biasReasons.push(etf.btcNetFlow + etf.ethNetFlow > 0 ? "ETF flows positive" : "ETF flows negative");
  const liquidityBias = stablecoin.length === 0 && market.marketCap.length === 0
    ? "insufficient_data"
    : biasScore >= 3 ? "strong_inflow" : biasScore >= 1 ? "moderate_inflow" : biasScore <= -2 ? "strong_outflow" : biasScore < 0 ? "moderate_outflow" : "neutral";
  const previousVolume = market.volume.slice(-31, -1);
  const averageVolume = previousVolume.length >= 7 ? previousVolume.reduce((sum, row) => sum + row.value, 0) / previousVolume.length : 0;
  return {
    asOf: new Date().toISOString(),
    sources: {
      stablecoin: stablecoin.length ? "DeFiLlama" : null,
      market: market.marketCap.length || market.volume.length ? "CoinPaprika" : null,
      etf: etf ? "configured provider" : null,
    },
    stablecoin: { current: stablecoin.at(-1)?.value ?? null, changePct: stableChange, changePct1d: stableChange1d, changePct7d: stableChange7d, changePct30d: stableChange30d, changePct90d: stableChange90d, history: stablecoin },
    etf: etf ? { status: "available", btcNetFlow: etf.btcNetFlow, ethNetFlow: etf.ethNetFlow, history: [] } : { status: "unavailable", btcNetFlow: null, ethNetFlow: null, history: [] },
    market: { totalMarketCap: market.marketCap.at(-1)?.value ?? null, totalVolume: market.volume.at(-1)?.value ?? null, marketCapChangePct: marketChange, volumeRatio30d: averageVolume ? Number((market.volume.at(-1)!.value / averageVolume).toFixed(2)) : null, history: market.marketCap },
    liquidityBias,
    biasReasons,
  };
}
