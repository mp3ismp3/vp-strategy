import { expect, it } from "vitest";
import { analyzeRvol } from "@/lib/rvol";
import { buildRvolReview } from "@/lib/rvol-review";
import { completedDailyBars } from "@/lib/market-bars";
import type { OHLCBar } from "@/lib/macd";

const baseline = (): OHLCBar[] => Array.from({ length: 20 }, (_, i) => ({
  time: `2026-08-${String(i + 1).padStart(2, "0")}`, open: 99, high: 100, low: 96, close: 99, volume: 100,
}));
const breakout = (): OHLCBar => ({ time: "2026-08-21", open: 99, high: 103, low: 98, close: 102, volume: 180 });
const next = (overrides: Partial<OHLCBar> = {}): OHLCBar => ({ ...breakout(), time: "2026-08-24", low: 100.2, close: 101, volume: 62.4, ...overrides });
const review = (bars: OHLCBar[]) => buildRvolReview(analyzeRvol(bars), bars);
const check = (bars: OHLCBar[], id: string) => review(bars).checks.find(row => row.id === id);

it("does not call the breakout candle a retest and compares breakout volume", () => {
  const bars = [...baseline(), breakout()];
  expect(check(bars, "breakout-volume")).toMatchObject({ status: "met", date: "2026-08-21" });
  expect(check(bars, "retest-price")?.status).toBe("not-applicable");
  expect(check(bars, "retest-volume")?.status).toBe("not-applicable");
  expect(review(bars).summary.join(" ")).toContain("突破當日，不判定突破後回踩");
});

it("explains a confirmed price retest independently of its volume condition", () => {
  const bars = [...baseline(), breakout(), next()];
  expect(check(bars, "retest-price")).toMatchObject({ status: "met", date: "2026-08-24" });
  expect(check(bars, "retest-volume")?.status).toBe("met");
  expect(review(bars).summary.join(" ")).toContain("一般回踩價格條件成立，縮量條件成立");
  const highVolume = [...bars.slice(0, -1), next({ volume: 187.2 })];
  expect(check(highVolume, "retest-price")?.status).toBe("met");
  expect(check(highVolume, "retest-volume")?.status).toBe("not-met");
});

it("does not pair an earlier retest with today's volume or call it a fresh event", () => {
  const bars = [...baseline(), breakout(), next(), next({ time: "2026-08-25", low: 101, close: 102, volume: 180 })];
  const result = review(bars);
  expect(check(bars, "retest-price")?.status).toBe("not-met");
  expect(check(bars, "retest-volume")?.status).toBe("not-applicable");
  expect(result.summary.join(" ")).toContain("2026-08-24：回踩縮量，事件日 RVOL 0.60×");
  expect(result.summary.join(" ")).toContain("2026-08-25：未觸及回踩上界");
  expect(result.summary.join(" ")).toContain("距原突破位 +2.00%");
});

it("distinguishes a deep undercut and recovery from an ordinary low-volume retest", () => {
  const bars = [...baseline(), breakout(), next({ low: 98 })];
  expect(check(bars, "retest-price")?.status).toBe("not-met");
  expect(check(bars, "reclaimed-price")?.status).toBe("met");
  expect(check(bars, "retest-volume")?.status).toBe("not-applicable");
  expect(review(bars).summary.join(" ")).toContain("跌破後收復價格條件成立");
});

it("keeps a setup ended even if a later candle again meets its old retest prices", () => {
  const bars = [...baseline(), breakout(), next({ low: 98, close: 99 }), next({ time: "2026-08-25" })];
  expect(check(bars, "tracking")?.status).toBe("not-met");
  expect(check(bars, "retest-price")?.status).toBe("not-applicable");
  expect(review(bars).summary.join(" ")).toContain("已結束：收盤跌破失效");
});

it("expires after ten subsequent bars, without treating expiry as a price failure", () => {
  const bars = [...baseline(), breakout(), ...Array.from({ length: 11 }, (_, i) =>
    next({ time: `2026-09-${String(i + 1).padStart(2, "0")}`, low: 101, close: 102 }))];
  expect(check(bars.slice(0, -1), "tracking")?.status).toBe("met");
  expect(check(bars, "tracking")?.status).toBe("not-met");
  expect(check(bars, "retest-price")?.status).toBe("not-applicable");
  expect(review(bars).summary.join(" ")).toContain("已結束：觀察期結束");
});

it("reports missing volume separately from a met price condition", () => {
  const bars = [...baseline(), breakout(), next({ volume: NaN })];
  expect(check(bars, "retest-price")?.status).toBe("met");
  expect(check(bars, "retest-volume")?.status).toBe("unavailable");
  expect(review(bars).summary.join(" ")).toContain("量能資料不足，無法確認回踩事件");
});

it.each([
  { low: 99.5, close: 100, expected: "met" },
  { low: 99.49, close: 100, expected: "not-met" },
  { low: 100.5, close: 101, expected: "met" },
  { low: 100.51, close: 101, expected: "not-met" },
])("uses unrounded inclusive retest boundaries: $low", ({ low, close, expected }) => {
  expect(check([...baseline(), breakout(), next({ low, close })], "retest-price")?.status).toBe(expected);
});

it("treats exact RVOL 0.7 as not meeting the strict shrinkage threshold", () => {
  const bars = [...baseline(), breakout(), next({ volume: 72.8 })];
  expect(check(bars, "retest-volume")?.status).toBe("not-met");
});

it.each([{ bars: [] }, { bars: baseline().slice(0, 10) }, { bars: [...baseline(), next({ close: NaN })] }])
  ("does not fabricate conditions from insufficient or invalid data", ({ bars }) => {
    const result = review(bars);
    expect(result.checks).toEqual([]);
    expect(result.summary.join(" ")).toContain("資料不足");
    expect(JSON.stringify(result)).not.toMatch(/NaN|Infinity/);
  });

it("reports no retained setup separately from missing data", () => {
  const bars = [...baseline(), next({ low: 96, high: 100, close: 99 })];
  expect(review(bars).summary.join(" ")).toContain("目前沒有保留中的突破紀錄");
});

it("rejects mismatched snapshot dates instead of blending data", () => {
  const bars = [...baseline(), breakout()];
  const result = buildRvolReview(analyzeRvol(bars), [...bars, next()]);
  expect(result.checks).toEqual([]);
  expect(result.summary.join(" ")).toContain("分析日期與日 K 不一致");
});

it("only summarizes completed sessions provided by the market-bar boundary", () => {
  const raw = [...baseline(), breakout(), next()];
  const completed = completedDailyBars(raw, "2026-08-24T19:00:00Z");
  expect(review(completed)).toEqual(review(raw.slice(0, -1)));
  expect(review(completed).summary.join(" ")).not.toContain("2026-08-24");
});
