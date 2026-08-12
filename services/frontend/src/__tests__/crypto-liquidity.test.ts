import { describe, expect, it } from "vitest";
import { buildLiquiditySnapshot, combineSeries, joinSeriesByDate, normalizeCoinGeckoGlobal, normalizeStablecoinChart } from "@/lib/crypto-liquidity";

describe("crypto liquidity normalization", () => {
  it("normalizes DefiLlama stablecoin chart and calculates changes", () => {
    const rows = normalizeStablecoinChart([
      { date: 1704067200, totalCirculating: { peggedUSD: 100 } },
      { date: 1704153600, totalCirculating: { peggedUSD: 102 } },
    ]);
    expect(rows).toEqual([
      { date: "2024-01-01", value: 100 },
      { date: "2024-01-02", value: 102 },
    ]);
    const snapshot = buildLiquiditySnapshot(rows, { marketCap: [], volume: [] }, null);
    expect(snapshot.stablecoin.changePct1d).toBe(2);
    expect(snapshot.stablecoin.changePct7d).toBe(2);
  });

  it("normalizes CoinGecko global chart arrays and preserves missing ETF data", () => {
    const market = normalizeCoinGeckoGlobal({
      market_cap: [[1704067200000, 1000], [1704153600000, 1100]],
      total_volume: [[1704067200000, 50], [1704153600000, 60]],
    });
    const snapshot = buildLiquiditySnapshot([], market, null);
    expect(snapshot.market.totalMarketCap).toBe(1100);
    expect(snapshot.market.totalVolume).toBe(60);
    expect(snapshot.etf.status).toBe("unavailable");
  });

  it("combines USDT and USDC histories by date", () => {
    expect(combineSeries([{ date: "2024-01-01", value: 100 }], [{ date: "2024-01-01", value: 40 }, { date: "2024-01-02", value: 42 }])).toEqual([
      { date: "2024-01-01", value: 140 },
      { date: "2024-01-02", value: 42 },
    ]);
  });

  it("uses the previous 30 days as the volume baseline", () => {
    const market = { marketCap: [], volume: Array.from({ length: 31 }, (_, index) => ({ date: `2024-01-${String(index + 1).padStart(2, "0")}`, value: index === 30 ? 200 : 100 })) };
    expect(buildLiquiditySnapshot([], market, null).market.volumeRatio30d).toBe(2);
  });

  it("does not report a volume baseline when there are fewer than 7 prior observations", () => {
    const market = { marketCap: [], volume: Array.from({ length: 5 }, (_, index) => ({ date: `2024-01-${index + 1}`, value: 100 })) };
    expect(buildLiquiditySnapshot([], market, null).market.volumeRatio30d).toBeNull();
  });

  it("uses a 30-day market-cap change rather than the full history", () => {
    const market = { marketCap: Array.from({ length: 61 }, (_, index) => ({ date: `2024-01-${index + 1}`, value: index === 0 ? 100 : index === 30 ? 200 : index === 60 ? 220 : 200 })), volume: [] };
    expect(buildLiquiditySnapshot([], market, null).market.marketCapChangePct).toBe(10);
  });

  it("joins chart series by date when one provider omits an observation", () => {
    expect(joinSeriesByDate([{ date: "2024-01-01", value: 100 }, { date: "2024-01-03", value: 120 }], [{ date: "2024-01-03", value: 220 }])).toEqual([{ date: "2024-01-03", left: 120, right: 220 }]);
  });

  it("exposes bias reasons and keeps ETF missing data out of the score", () => {
    const snapshot = buildLiquiditySnapshot([{ date: "2024-01-01", value: 100 }, { date: "2024-01-02", value: 110 }], { marketCap: [], volume: [] }, null);
    expect(snapshot.etf.status).toBe("unavailable");
    expect(snapshot.liquidityBias).toBe("moderate_inflow");
    expect(snapshot.biasReasons).toContain("Stablecoin supply expanding");
    expect(snapshot.biasReasons.join(" ")).not.toContain("ETF");
  });

  it("uses the displayed 30-day stablecoin trend for the bias", () => {
    const stablecoin = Array.from({ length: 61 }, (_, index) => ({ date: `2024-01-${index + 1}`, value: index === 0 ? 100 : index === 30 ? 200 : index === 60 ? 150 : 200 }));
    const snapshot = buildLiquiditySnapshot(stablecoin, { marketCap: [], volume: [] }, null);
    expect(snapshot.stablecoin.changePct).toBe(50);
    expect(snapshot.stablecoin.changePct30d).toBe(-25);
    expect(snapshot.liquidityBias).toBe("moderate_outflow");
    expect(snapshot.biasReasons[0]).toBe("Stablecoin supply contracting");
  });
});
