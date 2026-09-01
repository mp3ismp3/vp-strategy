import { describe, expect, it } from "vitest";
import { detectFvgs, type OHLCBar } from "@/lib/fvg";

function bar(time: string, low: number, high: number, close = low): OHLCBar {
  return { time, open: close, high, low, close, volume: 100 };
}

describe("FVG calculator", () => {
  it("returns no gaps when fewer than three candles are available", () => {
    expect(detectFvgs([bar("1", 10, 11), bar("2", 11, 12)])).toEqual([]);
  });

  it("detects an unfilled bullish fair value gap", () => {
    const result = detectFvgs([
      bar("1", 9, 10),
      bar("2", 10, 12),
      bar("3", 11, 13),
    ]);

    expect(result).toEqual([
      expect.objectContaining({
        type: "bullish",
        gapLow: 10,
        gapHigh: 11,
        filled: false,
        fillPct: 0,
      }),
    ]);
  });

  it("marks a bullish gap filled when a later candle trades through it", () => {
    const result = detectFvgs([
      bar("1", 9, 10),
      bar("2", 10, 12),
      bar("3", 11, 13),
      bar("4", 9.5, 12),
    ]);

    expect(result[0]).toEqual(expect.objectContaining({ filled: true, fillPct: 100 }));
  });
});
