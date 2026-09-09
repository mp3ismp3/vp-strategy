import { describe, expect, it } from "vitest";
import { analyzeRvol, classifyRvol } from "@/lib/rvol";
import type { OHLCBar } from "@/lib/macd";

const baseline = (): OHLCBar[] => Array.from({ length: 20 }, (_, i) => ({
  time: `day-${i}`, open: 98, high: 100, low: 96, close: 99, volume: 100,
}));
const breakout = (volume: number): OHLCBar => ({
  time: "breakout", open: 99, high: 103, low: 98, close: 102, volume,
});

describe("RVOL price confirmation", () => {
  it("separates deep undercuts from ordinary retests", () => {
    const result = analyzeRvol([...baseline(), breakout(220), { ...breakout(63.6), low: 80, close: 101 }]);
    expect(result.signal?.label).toBe("跌破後收復");
  });
  it("keeps the original breakout while waiting for a retest", () => {
    const result = analyzeRvol([...baseline(), breakout(220), { ...breakout(100), low: 101, close: 102 }]);
    expect(result.signal).toMatchObject({ type: "waiting", level: 100, breakoutRvol: 2.2 });
  });
  it("keeps an invalidation visible instead of disappearing", () => {
    const result = analyzeRvol([...baseline(), breakout(220), { ...breakout(100), low: 98, close: 99 }]);
    expect(result.setup?.status).toBe("invalidated");
  });
  it("keeps event volume attached to the retest date on subsequent sessions", () => {
    const result = analyzeRvol([...baseline(), breakout(220),
      { ...breakout(63.6), time: "retest", low: 100, close: 101 },
      { ...breakout(180), time: "later", low: 101, close: 102 }]);
    expect(result.setup).toMatchObject({ eventDate: "retest", eventRvol: 0.6, label: "回踩縮量", level: 100 });
    expect(result.asOf).toBe("later");
    expect(result.rvol).not.toBe(0.6);
  });
  it("expires a setup after ten following sessions", () => {
    const bars = [...baseline(), breakout(220), ...Array.from({ length: 11 }, (_, i) =>
      ({ ...breakout(100), time: `later-${i}`, low: 101, close: 102 }))];
    expect(analyzeRvol(bars).setup).toMatchObject({ status: "expired", age: 11, level: 100 });
  });
  it("does not confirm a retest with an invalid closing price", () => {
    expect(analyzeRvol([...baseline(), breakout(220), { ...breakout(60), low: 100, close: NaN }]).signal).toBeNull();
  });
  it.each([[0.69, "明顯縮量"], [0.7, "普通"], [1, "有量"], [1.5, "明顯放量"], [2, "明顯放量"], [2.01, "異常大量"]])
    ("classifies boundary %s", (ratio, label) => expect(classifyRvol(Number(ratio))).toBe(label));

  it.each([[220, 2.2, "突破放量"], [80, 0.8, "突破量不足"]])
    ("evaluates a breakout at volume %s", (volume, ratio, label) => {
      expect(analyzeRvol([...baseline(), breakout(Number(volume))])).toMatchObject({
        rvol: ratio, signal: { label, level: 100, type: "breakout" },
      });
    });

  it.each([[0.6, "回踩縮量"], [1.8, "回踩放量"]])
    ("evaluates a retest at RVOL %s", (ratio, label) => {
      const bars = [...baseline(), breakout(220)];
      bars.push({ time: "retest", open: 102, high: 102, low: 100.2, close: 101, volume: Number(ratio) * 106 });
      expect(analyzeRvol(bars)).toMatchObject({ rvol: ratio, signal: { label, type: "retest", level: 100, breakoutRvol: 2.2 } });
    });

  it("does not call a wick above resistance a breakout", () => {
    expect(analyzeRvol([...baseline(), { ...breakout(220), close: 99 }]).signal).toBeNull();
  });

  it("rejects a failed support retest", () => {
    expect(analyzeRvol([...baseline(), breakout(220), {
      ...breakout(60), low: 98, close: 99,
    }]).signal).toBeNull();
  });

  it("invalidates a breakout after an intervening close below support", () => {
    const bars = [...baseline(), breakout(220), { ...breakout(100), low: 98, close: 99 },
      { ...breakout(60), low: 100, close: 101 }];
    expect(analyzeRvol(bars).signal).toBeNull();
  });

  it("reports unavailable for insufficient or invalid volume", () => {
    expect(analyzeRvol([]).rvol).toBeNull();
    expect(analyzeRvol(baseline()).rvol).toBeNull();
    expect(analyzeRvol([...baseline().map(b => ({ ...b, volume: 0 })), breakout(100)]).rvol).toBeNull();
    expect(analyzeRvol([...baseline(), breakout(NaN)]).rvol).toBeNull();
    expect(analyzeRvol([...baseline(), breakout(-1)]).signal).toBeNull();
  });
});
