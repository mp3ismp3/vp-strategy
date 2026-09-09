import { describe, expect, it } from "vitest";
import { calcMACD, detectDivergence, macdTurningPoints, resampleToWeekly } from "@/lib/macd";

describe("confirmed MACD turns", () => {
  it.each([
    { values: [-1, -3, -1, 0, 1, 3, 1], indices: [1] },
    { values: [-1, -3, -1, 0, 0, 1, 3, 1], indices: [1] },
    { values: [-1, -2, -3], indices: [] },
    { values: [-3, -2, -1], indices: [] },
    { values: [-1, -3, -3], indices: [] },
    { values: [-1, -3, -3, -4], indices: [] },
    { values: [-1, -3, -3, -2], indices: [1] },
    { values: [1, -2, 1], indices: [1] },
    { values: [1, -1, -2, 1], indices: [2] },
    { values: [-1, -3, -1], indices: [1] },
    { values: [0, 0, 0], indices: [] },
    { values: [], indices: [] },
    { values: [-1, -2], indices: [] },
  ])("handles $values symmetrically", ({ values, indices }) => {
    expect(macdTurningPoints(values, "low").map(p => p.index)).toEqual(indices);
    expect(macdTurningPoints(values.map(v => -v), "high").map(p => p.index)).toEqual(indices);
  });

  it("finds both signs when the crossing passes through zero", () => {
    expect(macdTurningPoints([-1, -3, -1, 0, 1, 3, 1], "high"))
      .toEqual([{ index: 5, price: 3 }]);
  });

  it("waits for an actual MACD reversal before reporting bullish divergence", () => {
    const anchors = [[0, 1], [55, -1], [60, -5], [65, 1], [90, -1], [99, -3], [100, -2]];
    const ohlc = Array.from({ length: 101 }, (_, i) => ({
      time: String(i), open: 100, high: 101, low: i === 60 ? 95 : i === 96 ? 94 : 99,
      close: 100, volume: 100,
    }));
    const macd = ohlc.map((bar, i) => {
      const right = anchors.findIndex(a => a[0] >= i);
      const [x1, y1] = anchors[Math.max(0, right - 1)];
      const [x2, y2] = anchors[right];
      return { time: bar.time, macd: x1 === x2 ? y1 : y1 + (y2 - y1) * (i - x1) / (x2 - x1), signal: 0, histogram: 0 };
    });
    expect(detectDivergence(ohlc.slice(0, 100), macd.slice(0, 100), 60, 3)).toEqual([]);
    expect(detectDivergence(ohlc, macd, 60, 3)).toEqual([expect.objectContaining({ type: "bullish" })]);
  });
});

describe("calendar weekly bars", () => {
  it.each([
    ["2026-09-04", "2026-09-08"], // Monday holiday
    ["2026-12-31", "2027-01-05"], // year boundary
    ["2026-09-06", "2026-09-07"], // Sunday belongs to previous week
  ])("separates %s and %s", (first, second) => {
    const bars = [first, second].map((time, i) => ({
      time, open: 10 + i, high: 12 + i, low: 9 + i, close: 11 + i, volume: 100,
    }));
    expect(resampleToWeekly(bars)).toEqual(bars);
  });

  it("aggregates OHLCV within a week and preserves the last trading date", () => {
    expect(resampleToWeekly([
      { time: "2026-09-08", open: 10, high: 13, low: 9, close: 12, volume: 100 },
      { time: "2026-09-11", open: 12, high: 14, low: 8, close: 11, volume: 200 },
    ])).toEqual([{ time: "2026-09-11", open: 10, high: 14, low: 8, close: 11, volume: 300 }]);
    expect(resampleToWeekly([])).toEqual([]);
  });

  it("keeps the existing MACD minimum and flat-market formula", () => {
    expect(calcMACD([])).toBeNull();
    expect(calcMACD(Array(34).fill(100))).toBeNull();
    expect(calcMACD(Array(35).fill(100))?.at(-1))
      .toEqual({ time: "", macd: 0, signal: 0, histogram: 0 });
  });
});
