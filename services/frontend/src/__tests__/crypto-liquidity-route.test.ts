import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/server-entitlement", () => ({
  getServerPlan: vi.fn(async () => "free"),
}));

import { GET } from "@/app/api/data/crypto-liquidity/route";

const jsonResponse = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });

afterEach(() => vi.unstubAllGlobals());

describe("crypto liquidity route", () => {
  it("returns stablecoin data when CoinPaprika is temporarily unavailable", async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(jsonResponse({
        tokens: [{ date: 1704067200, circulating: { peggedUSD: 100 } }],
      }))
      .mockResolvedValueOnce(jsonResponse({
        tokens: [{ date: 1704067200, circulating: { peggedUSD: 50 } }],
      }))
      .mockResolvedValueOnce(jsonResponse({}, 503));
    vi.stubGlobal("fetch", fetchMock);

    const response = await GET();
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(fetchMock).toHaveBeenNthCalledWith(
      1,
      "https://stablecoins.llama.fi/stablecoin/1",
      expect.any(Object),
    );
    expect(payload.stablecoin.current).toBe(150);
    expect(payload.market.totalMarketCap).toBeNull();
    expect(payload.sources.market).toBeNull();
  });

  it("does not publish a partial USDT plus USDC aggregate", async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(jsonResponse({
        tokens: [{ date: 1704067200, circulating: { peggedUSD: 100 } }],
      }))
      .mockResolvedValueOnce(jsonResponse({}, 503))
      .mockResolvedValueOnce(jsonResponse([
        { timestamp: "2024-01-01T00:00:00Z", market_cap: 1000, volume_24h: 50 },
      ]));
    vi.stubGlobal("fetch", fetchMock);

    const response = await GET();
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload.stablecoin.current).toBeNull();
    expect(payload.stablecoin.history).toEqual([]);
    expect(payload.sources.stablecoin).toBeNull();
    expect(payload.sources.market).toBe("CoinPaprika");
  });

  it("returns 503 only when every configured upstream is unavailable", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonResponse({}, 503)));

    const response = await GET();

    expect(response.status).toBe(503);
    expect(response.headers.get("Retry-After")).toBe("30");
  });

  it("uses the keyless CoinPaprika Bitcoin history endpoint", async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(jsonResponse({ tokens: [] }))
      .mockResolvedValueOnce(jsonResponse({ tokens: [] }))
      .mockResolvedValueOnce(jsonResponse([
        { timestamp: "2024-01-01T00:00:00Z", market_cap: 1000, volume_24h: 50 },
      ]));
    vi.stubGlobal("fetch", fetchMock);

    const response = await GET();

    expect(response.status).toBe(200);
    expect(fetchMock).toHaveBeenNthCalledWith(
      3,
      expect.stringMatching(/^https:\/\/api\.coinpaprika\.com\/v1\/tickers\/btc-bitcoin\/historical\?start=\d{4}-\d{2}-\d{2}&interval=1d$/),
      expect.not.objectContaining({ headers: expect.anything() }),
    );
  });
});
