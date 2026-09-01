import { describe, expect, it } from "vitest";
import { buildSymbolAnalysis, type AnalysisSources } from "@/lib/symbol-analysis";

const sources: AnalysisSources = {
  scan: {
    scan_time: "2026-09-01T21:05:00Z",
    vp_data: {
      NVDA: {
        price: 120,
        daily: { poc: 115, vah: 119, val: 110, position: "above_va", position_pct: 4.3 },
        weekly: { poc: 112, vah: 121, val: 105, position: "inside_va", position_pct: 7.1 },
        monthly: { poc: 100, vah: 115, val: 90, position: "above_va", position_pct: 20 },
      },
    },
  },
  accumulation: {
    NVDA: {
      phase: "D",
      tier: "confirmed",
      raw_score: 12,
      decay_score: 11.5,
      failing: false,
      support_primary: 108,
      support_dynamic: 112,
      resistance: 125,
      triggers_fired: ["SOS"],
    },
  },
  charts: {
    NVDA: {
      daily: {
        ohlc: [
          { time: "1", open: 9, high: 10, low: 9, close: 9.5, volume: 100 },
          { time: "2", open: 10, high: 12, low: 10, close: 11, volume: 100 },
          { time: "3", open: 11, high: 13, low: 11, close: 12, volume: 100 },
        ],
      },
    },
  },
};

describe("symbol analysis", () => {
  it("combines VP, accumulation and FVG into one overview", () => {
    const result = buildSymbolAnalysis("NVDA", "pro", sources);

    expect(result).toMatchObject({
      ticker: "NVDA",
      price: 120,
      vp: { consensus: "bullish" },
      accumulation: { phase: "D", support_primary: 108 },
      fvg: { bullishOpen: 1, bearishOpen: 0 },
    });
  });

  it("removes actionable accumulation levels and FVG details for free", () => {
    const result = buildSymbolAnalysis("NVDA", "free", sources);

    expect(result?.accumulation).not.toHaveProperty("support_primary");
    expect(result?.accumulation).not.toHaveProperty("triggers_fired");
    expect(result?.fvg.gaps).toBeUndefined();
    expect(result?.fvg.nearest).toBeUndefined();
    expect(result?.access).toEqual({ accumulationDetails: false, fvgDetails: false });
  });

  it("returns null for a supported ticker with no current analysis", () => {
    expect(buildSymbolAnalysis("AAPL", "pro", sources)).toBeNull();
  });
});
