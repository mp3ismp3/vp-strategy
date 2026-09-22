import { expect, it } from "vitest";
import { buildFvgReview } from "@/lib/fvg-review";
import type { OHLCBar } from "@/lib/macd";
import { completedDailyBars } from "@/lib/market-bars";

const baseline = (): OHLCBar[] => Array.from({ length: 30 }, (_, i) => ({
  time: new Date(Date.UTC(2026, 6, i + 1)).toISOString().slice(0, 10), open: 104, high: 106, low: 102, close: 105, volume: 100,
}));
const fvgBars = () => { const bars = baseline(); bars[27] = { ...bars[27], high: 100, low: 98, open: 99, close: 99 }; bars[29] = { ...bars[29], low: 104 }; return bars; };
const gap = { type: "bullish" as const, date: "2026-07-29", gapLow: 100, gapHigh: 104 };
const later = (overrides: Partial<OHLCBar> = {}): OHLCBar => ({ time: "2026-07-31", open: 104, high: 106, low: 102, close: 103, volume: 100, ...overrides });
const row = (review: ReturnType<typeof buildFvgReview>, id: string) => review.checks.find(check => check.id === id);

it("distinguishes middle-candle date from third-candle confirmation and does not call formation a retest", () => {
  const result = buildFvgReview(gap, fvgBars());
  expect(result.summary.join(" ")).toContain("第三根完成日 2026-07-30"); expect(row(result, "latest-touch")?.status).toBe("not-applicable"); expect(row(result, "filled")?.status).toBe("not-met");
});
it("reports partial penetration, latest overlap and price inside separately", () => { const result = buildFvgReview(gap, [...fvgBars(), later()]); expect(row(result, "latest-touch")?.status).toBe("met"); expect(row(result, "inside")?.status).toBe("met"); expect(row(result, "filled")?.status).toBe("not-met"); expect(result.summary.join(" ")).toContain("50.00%"); });
it("keeps a historical full fill after price returns above the gap", () => { const result = buildFvgReview(gap, [...fvgBars(), later({ low: 100 }), later({ time: "2026-08-01", low: 105, close: 106 })]); expect(row(result, "filled")?.status).toBe("met"); expect(row(result, "filled")?.date).toBe("2026-08-01"); expect(row(result, "latest-touch")?.status).toBe("not-applicable"); expect(result.summary.join(" ")).toContain("首次完全填補 2026-07-31"); expect(result.summary.join(" ")).toContain("上方"); });
it("touching the near boundary is not full fill", () => { const result = buildFvgReview(gap, [...fvgBars(), later({ low: 104, close: 105 })]); expect(row(result, "latest-touch")?.status).toBe("met"); expect(row(result, "filled")?.status).toBe("not-met"); expect(result.summary.join(" ")).toContain("0.00%"); });
it("uses later highs for bearish fill and lower-side distance", () => { const bars = fvgBars().map(bar => ({ ...bar, open: 210 - bar.open, high: 210 - bar.low, low: 210 - bar.high, close: 210 - bar.close })); const result = buildFvgReview({ type: "bearish", date: gap.date, gapLow: 106, gapHigh: 110 }, [...bars, later({ open: 105, high: 108, low: 103, close: 104 })]); expect(row(result, "filled")?.status).toBe("not-met"); expect(result.summary.join(" ")).toContain("50.00%"); expect(result.summary.join(" ")).toContain("下方"); });
it("refuses a missing third candle or mismatched bounds", () => { expect(buildFvgReview(gap, fvgBars().slice(0, -1)).checks).toEqual([]); expect(buildFvgReview({ ...gap, gapHigh: 105 }, fvgBars()).checks).toEqual([]); });
it.each([{ bars: [] }, { bars: baseline().slice(0, 2) }])( "handles insufficient data", ({ bars }) => { expect(buildFvgReview(null, bars).summary.join(" ")).toContain("資料不足"); });
it("does not declare full fill from a rounded 100% penetration", () => { expect(row(buildFvgReview(gap, [...fvgBars(), later({ low: 100.00001 })]), "filled")?.status).toBe("not-met"); });
it("reports actual subsequent low when every low stays above the gap", () => { const result = buildFvgReview(gap, [...fvgBars(), later({ low: 105, close: 106 })]); expect(row(result, "filled")?.evidence).toContain("$105.00"); expect(row(result, "latest-touch")?.status).toBe("not-met"); });
it("unfinished candles cannot confirm FVG structure", () => { const bars = completedDailyBars(fvgBars(), "2026-07-30T15:00:00Z"); expect(buildFvgReview(gap, bars).checks).toEqual([]); });
it("distinguishes an empty filtered list from insufficient data", () => { expect(buildFvgReview(null, baseline()).summary.join(" ")).toContain("目前篩選範圍沒有"); });
it("does not draw conclusions across invalid historical price bars", () => { expect(buildFvgReview(gap, [...fvgBars(), later({ low: NaN })]).checks).toEqual([]); });
