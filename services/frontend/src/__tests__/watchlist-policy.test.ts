import { describe, expect, it } from "vitest";
import {
  getWatchlistLimit,
  isTickerAllowedForPlan,
  normalizeTicker,
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
