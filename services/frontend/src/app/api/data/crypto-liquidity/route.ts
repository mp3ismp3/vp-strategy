import { NextResponse } from "next/server";
import { getServerPlan } from "@/lib/server-entitlement";
import { serviceUnavailable } from "@/lib/api-response";
import { buildLiquiditySnapshot, combineSeries, normalizeCoinPaprikaBitcoin, normalizeStablecoinChart } from "@/lib/crypto-liquidity";

const timeout = (ms: number) => AbortSignal.timeout(ms);

function coinPaprikaHistoryUrl(now = new Date()): string {
  const start = new Date(now);
  start.setUTCDate(start.getUTCDate() - 364);
  const startDate = start.toISOString().slice(0, 10);
  return `https://api.coinpaprika.com/v1/tickers/btc-bitcoin/historical?start=${startDate}&interval=1d`;
}

async function fetchProviderJson(
  url: string,
  options: RequestInit & { next: { revalidate: number } },
): Promise<unknown | null> {
  try {
    const response = await fetch(url, options);
    return response.ok ? await response.json() : null;
  } catch {
    return null;
  }
}

export async function GET() {
  const plan = await getServerPlan();
  if (!plan) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  try {
    const providerOptions = { signal: timeout(10_000), next: { revalidate: 3600 } };
    const [usdt, usdc, marketPayload] = await Promise.all([
      fetchProviderJson("https://stablecoins.llama.fi/stablecoin/1", providerOptions),
      fetchProviderJson("https://stablecoins.llama.fi/stablecoin/2", providerOptions),
      fetchProviderJson(coinPaprikaHistoryUrl(), providerOptions),
    ]);
    const usdtSeries = normalizeStablecoinChart(usdt);
    const usdcSeries = normalizeStablecoinChart(usdc);
    const stablecoin = usdtSeries.length > 0 && usdcSeries.length > 0
      ? combineSeries(usdtSeries, usdcSeries)
      : [];
    const market = normalizeCoinPaprikaBitcoin(marketPayload);
    if (stablecoin.length === 0 && market.marketCap.length === 0 && market.volume.length === 0) {
      return serviceUnavailable("CRYPTO_DATA_UNAVAILABLE", "Crypto liquidity data is temporarily unavailable");
    }
    const payload = buildLiquiditySnapshot(stablecoin, market, null);
    return NextResponse.json({ ...payload, accessPlan: plan }, { headers: { "Cache-Control": "private, max-age=900" } });
  } catch (error) {
    return serviceUnavailable("CRYPTO_DATA_UNAVAILABLE", "Crypto liquidity data is temporarily unavailable", error);
  }
}
