import { NextResponse } from "next/server";
import { getServerPlan } from "@/lib/server-entitlement";
import { serviceUnavailable } from "@/lib/api-response";
import { buildLiquiditySnapshot, combineSeries, normalizeCoinGeckoGlobal, normalizeStablecoinChart } from "@/lib/crypto-liquidity";

const timeout = (ms: number) => AbortSignal.timeout(ms);

export async function GET() {
  const plan = await getServerPlan();
  if (!plan) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  try {
    const [usdtResponse, usdcResponse, marketResponse] = await Promise.all([
      fetch("https://stablecoins.llama.fi/stablecoincharts/1", { signal: timeout(10_000), next: { revalidate: 3600 } }),
      fetch("https://stablecoins.llama.fi/stablecoincharts/2", { signal: timeout(10_000), next: { revalidate: 3600 } }),
      fetch("https://api.coingecko.com/api/v3/global/market_cap_chart?days=365", { signal: timeout(10_000), next: { revalidate: 3600 } }),
    ]);
    if (!usdtResponse.ok || !usdcResponse.ok || !marketResponse.ok) {
      return serviceUnavailable("CRYPTO_DATA_UNAVAILABLE", "Crypto liquidity data is temporarily unavailable");
    }
    const [usdt, usdc, market] = await Promise.all([usdtResponse.json(), usdcResponse.json(), marketResponse.json()]);
    const payload = buildLiquiditySnapshot(combineSeries(normalizeStablecoinChart(usdt), normalizeStablecoinChart(usdc)), normalizeCoinGeckoGlobal(market), null);
    return NextResponse.json({ ...payload, accessPlan: plan }, { headers: { "Cache-Control": "private, max-age=900" } });
  } catch (error) {
    return serviceUnavailable("CRYPTO_DATA_UNAVAILABLE", "Crypto liquidity data is temporarily unavailable", error);
  }
}
