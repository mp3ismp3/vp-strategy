import { describe, expect, it } from "vitest";

import {
  GUEST_ACCUMULATION_LIMIT,
  filterIndicatorItems,
  getIndicatorCategories,
  isIndicatorTickerAllowed,
  limitAccumulationItems,
} from "@/lib/preview-access";

describe("indicator preview access", () => {
  const rows = [
    { ticker: "NVDA", score: 10 },
    { ticker: "AMD", score: 9 },
    { ticker: "AAPL", score: 8 },
  ];

  it("limits guests to Mega Cap Tech tickers", () => {
    expect(filterIndicatorItems(rows, false).map((row) => row.ticker)).toEqual([
      "NVDA",
      "AAPL",
    ]);
    expect(Object.keys(getIndicatorCategories(false))).toEqual(["Mega Cap Tech"]);
    expect(isIndicatorTickerAllowed("NVDA", false)).toBe(true);
    expect(isIndicatorTickerAllowed("AMD", false)).toBe(false);
  });

  it("keeps all indicator tickers for authenticated users", () => {
    expect(filterIndicatorItems(rows, true)).toEqual(rows);
    expect(Object.keys(getIndicatorCategories(true)).length).toBeGreaterThan(1);
    expect(isIndicatorTickerAllowed("AMD", true)).toBe(true);
  });
});

describe("accumulation preview access", () => {
  const rows = Array.from({ length: 12 }, (_, index) => ({
    ticker: `T${index}`,
    decay_score: index,
  }));

  it("sorts and limits guests to the top ten", () => {
    const visible = limitAccumulationItems(rows, false);

    expect(visible).toHaveLength(GUEST_ACCUMULATION_LIMIT);
    expect(visible[0].decay_score).toBe(11);
    expect(visible.at(-1)?.decay_score).toBe(2);
  });

  it("returns the complete sorted list for authenticated users", () => {
    const visible = limitAccumulationItems(rows, true);

    expect(visible).toHaveLength(12);
    expect(visible.map((row) => row.decay_score)).toEqual([
      11, 10, 9, 8, 7, 6, 5, 4, 3, 2, 1, 0,
    ]);
  });
});
