import { describe, expect, it } from "vitest";
import {
  getFreshActionableTriggers,
  getFusionActionability,
  getFusionConfidence,
  getFusionRedFlags,
  getMacroDirection,
  isFusionDataFresh,
} from "@/lib/fusion-policy";

describe("Fusion policy", () => {
  it("uses the shared matrix and requires weekly/monthly agreement for macro direction", () => {
    expect(getFusionConfidence("B", "below_va").stars).toBe(3);
    expect(getFusionConfidence("D", "above_va").stars).toBe(3);
    expect(getMacroDirection("above_va", "inside_va")).toBe("neutral");
    expect(getMacroDirection("above_va", "above_va")).toBe("bullish");
  });

  it("requires a recognised trigger dated on the scan day", () => {
    expect(getFreshActionableTriggers([
      { type: "Spring", date: "2026-10-05" },
      { type: "LPS", date: "2026-10-04" },
      "SOS_BREAKOUT",
    ], "2026-10-05T21:05:00-04:00")).toEqual([{ type: "Spring", date: "2026-10-05" }]);
  });

  it("marks contradictory or stale candidates as ineligible inputs", () => {
    expect(getFusionRedFlags({
      phase: "C", dailyPosition: "above_va", dailyPositionPct: 155, macroDirection: "neutral",
    })).toHaveLength(2);
    expect(isFusionDataFresh("2026-10-05T21:05:00-04:00", "2026-10-05")).toBe(true);
    expect(isFusionDataFresh("2026-10-05T21:05:00-04:00", "2026-10-04")).toBe(false);
  });

  it("only makes confirmed, fresh, trigger-backed and unflagged candidates actionable", () => {
    expect(getFusionActionability({
      tier: "confirmed", dataFresh: true, failing: false, redFlags: [],
      freshTriggers: [{ type: "Spring", date: "2026-10-05" }],
    })).toEqual({ actionable: true, reasons: [] });
    expect(getFusionActionability({
      tier: "confirmed", dataFresh: false, failing: false, redFlags: [], freshTriggers: [],
    })).toEqual({ actionable: false, reasons: ["資料不是同一掃描日", "沒有當日有效觸發"] });
  });
});
