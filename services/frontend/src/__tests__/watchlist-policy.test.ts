import { describe, expect, it, vi } from "vitest";
import {
  getWatchlistLimit,
  isTickerAllowedForPlan,
  normalizeTicker,
  persistWatchlistOrder,
  reorderWatchlistItems,
  validateWatchlistTicker,
} from "@/lib/watchlist";

describe("watchlist policy", () => {
  it("normalizes ticker input", () => {
    expect(normalizeTicker(" nvda ")).toBe("NVDA");
  });

  it("limits plans to the agreed watchlist sizes", () => {
    expect(getWatchlistLimit("free")).toBe(5);
    expect(getWatchlistLimit("pro")).toBe(30);
    expect(getWatchlistLimit("premium")).toBe(100);
  });

  it("keeps free users inside the Mega Cap Tech universe", () => {
    expect(isTickerAllowedForPlan("NVDA", "free")).toBe(true);
    expect(isTickerAllowedForPlan("AMD", "free")).toBe(false);
    expect(isTickerAllowedForPlan("AMD", "pro")).toBe(true);
  });

  it("rejects unknown symbols for every plan", () => {
    expect(isTickerAllowedForPlan("NOTREAL", "premium")).toBe(false);
    expect(validateWatchlistTicker("NOTREAL", "premium")).toEqual({
      ok: false,
      reason: "unsupported",
    });
  });

  it("distinguishes unsupported symbols from plan-locked symbols", () => {
    expect(validateWatchlistTicker("AMD", "free")).toEqual({
      ok: false,
      reason: "upgrade_required",
    });
  });
});

const orderedItems = [
  { ticker: "AAPL", sort_order: 0 },
  { ticker: "MSFT", sort_order: 1 },
  { ticker: "NVDA", sort_order: 2 },
];

describe("watchlist ordering", () => {
  it("moves an item down and normalizes every sort order", () => {
    expect(reorderWatchlistItems(orderedItems, "AAPL", 2)).toEqual([
      { ticker: "MSFT", sort_order: 0 },
      { ticker: "NVDA", sort_order: 1 },
      { ticker: "AAPL", sort_order: 2 },
    ]);
  });

  it("moves an item up without mutating the original items", () => {
    expect(reorderWatchlistItems(orderedItems, "NVDA", 0).map((item) => item.ticker)).toEqual(["NVDA", "AAPL", "MSFT"]);
    expect(orderedItems.map((item) => item.ticker)).toEqual(["AAPL", "MSFT", "NVDA"]);
  });

  it("returns the original order for unknown tickers and invalid targets", () => {
    expect(reorderWatchlistItems(orderedItems, "TSLA", 1)).toBe(orderedItems);
    expect(reorderWatchlistItems(orderedItems, "AAPL", -1)).toBe(orderedItems);
    expect(reorderWatchlistItems(orderedItems, "AAPL", orderedItems.length)).toBe(orderedItems);
  });

  it("persists the complete order", async () => {
    const fetcher = vi.fn().mockResolvedValue({ ok: true });
    const lock = { current: false };

    await expect(persistWatchlistOrder(fetcher, ["NVDA", "AAPL"], lock)).resolves.toBe("saved");
    expect(fetcher).toHaveBeenCalledWith("/api/user/watchlist", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ tickers: ["NVDA", "AAPL"] }),
    });
    expect(lock.current).toBe(false);
  });

  it("reports HTTP and network failures without rejecting", async () => {
    const lock = { current: false };
    await expect(persistWatchlistOrder(vi.fn().mockResolvedValue({ ok: false }), ["AAPL"], lock)).resolves.toBe("failed");
    await expect(persistWatchlistOrder(vi.fn().mockRejectedValue(new Error("offline")), ["AAPL"], lock)).resolves.toBe("failed");
    expect(lock.current).toBe(false);
  });

  it("rejects overlapping persistence while the first request is pending", async () => {
    let resolveRequest: ((value: { ok: boolean }) => void) | undefined;
    const fetcher = vi.fn().mockImplementation(() => new Promise((resolve) => { resolveRequest = resolve; }));
    const lock = { current: false };
    const first = persistWatchlistOrder(fetcher, ["AAPL", "NVDA"], lock);

    await expect(persistWatchlistOrder(fetcher, ["NVDA", "AAPL"], lock)).resolves.toBe("busy");
    expect(fetcher).toHaveBeenCalledTimes(1);
    resolveRequest?.({ ok: true });
    await expect(first).resolves.toBe("saved");
  });
});
