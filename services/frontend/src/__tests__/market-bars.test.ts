import { expect, it } from "vitest";
import { completedDailyBars, completedWeeklyBars } from "@/lib/market-bars";
const bars = ["2026-03-06", "2026-03-09"].map(time => ({ time, open: 10, high: 12, low: 9, close: 11, volume: 100 }));
it("uses snapshot time, including US daylight saving time", () => {
  expect(completedDailyBars(bars, "2026-03-09T19:59:00Z")).toHaveLength(1);
  expect(completedDailyBars(bars, "2026-03-09T20:00:00Z")).toHaveLength(2);
  expect(completedDailyBars(bars.slice(0, 1), "2026-03-06T20:59:00Z")).toHaveLength(0);
  expect(completedDailyBars(bars.slice(0, 1), "2026-03-06T21:00:00Z")).toHaveLength(1);
});
it("does not promote a stale intraday snapshot or an unknown last bar", () => {
  expect(completedDailyBars(bars, "2026-03-09T15:00:00Z")).toHaveLength(1);
  expect(completedDailyBars(bars)).toHaveLength(1);
  expect(completedDailyBars([])).toEqual([]);
});
it("rejects unsorted or duplicated trading dates", () => {
  expect(completedDailyBars([...bars].reverse())).toEqual([]);
  expect(completedDailyBars([bars[0], bars[0]])).toEqual([]);
});
it("excludes an unfinished week and accepts Friday after close", () => {
  expect(completedWeeklyBars(bars, "2026-03-09T20:00:00Z")).toHaveLength(1);
  expect(completedWeeklyBars(bars.slice(0, 1), "2026-03-06T21:00:00Z")).toHaveLength(1);
});
