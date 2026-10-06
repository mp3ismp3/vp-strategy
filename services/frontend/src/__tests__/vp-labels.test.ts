import { describe, expect, it } from "vitest";
import {
  getNearestValueAreaEdge,
  getVpPositionLabel,
  summarizeValueAreaTouches,
} from "@/lib/vp-labels";

describe("VP position labels", () => {
  it.each([
    ["above_va", "高於價值區"],
    ["inside_va", "價值區內"],
    ["below_va", "低於價值區"],
  ])("translates %s for dashboard readers", (position, label) => {
    expect(getVpPositionLabel(position)).toBe(label);
  });

  it("returns a safe fallback for missing or future values", () => {
    expect(getVpPositionLabel(undefined)).toBe("無資料");
    expect(getVpPositionLabel("future_state")).toBe("future_state");
  });

  it("translates the missing-data fallback", () => {
    expect(getVpPositionLabel(undefined, (key) => `translated:${key}`)).toBe("translated:noData");
  });

  it("accepts the active locale translator", () => {
    expect(getVpPositionLabel("above_va", (key) => `translated:${key}`)).toBe("translated:above");
  });
});

describe("nearest value-area edge", () => {
  it("selects VAH when price is closer to the upper edge", () => {
    expect(getNearestValueAreaEdge(99, 90, 100)).toEqual({ edge: "VAH", distancePct: 1 });
  });

  it("selects VAL when price is closer to the lower edge", () => {
    expect(getNearestValueAreaEdge(91, 90, 100)).toEqual({ edge: "VAL", distancePct: 1.1 });
  });

  it("returns no proximity for incomplete or invalid levels", () => {
    expect(getNearestValueAreaEdge(0, 90, 100)).toBeNull();
    expect(getNearestValueAreaEdge(100, 0, 100)).toBeNull();
    expect(getNearestValueAreaEdge(100, 110, 100)).toBeNull();
  });
});

describe("value-area touch summaries", () => {
  it("identifies nearby daily and weekly VAHs as one confluence zone", () => {
    expect(summarizeValueAreaTouches([
      { timeframe: "D", vah: 100, val: 90, vaTouch: "vah" },
      { timeframe: "W", vah: 100.4, val: 80, vaTouch: "vah" },
      { timeframe: "M", vah: 120, val: 70, vaTouch: null },
    ])).toEqual([{
      edge: "VAH",
      timeframes: ["D", "W"],
      lowPrice: 100,
      highPrice: 100.4,
      isConfluent: true,
      label: "VAH 匯聚（D/W） $100.00–$100.40",
    }]);
  });

  it("keeps distant same-edge touches distinct from confluence", () => {
    expect(summarizeValueAreaTouches([
      { timeframe: "D", vah: 100, val: 90, vaTouch: "vah" },
      { timeframe: "W", vah: 102, val: 80, vaTouch: "vah" },
    ])).toEqual([{
      edge: "VAH",
      timeframes: ["D", "W"],
      lowPrice: 100,
      highPrice: 102,
      isConfluent: false,
      label: "VAH 分散觸及（D $100.00 · W $102.00）",
    }]);
  });

  it("separates a bar that touched both value-area edges", () => {
    expect(summarizeValueAreaTouches([
      { timeframe: "D", vah: 100, val: 90, vaTouch: "both" },
    ])).toEqual([
      {
        edge: "VAH",
        timeframes: ["D"],
        lowPrice: 100,
        highPrice: 100,
        isConfluent: false,
        label: "VAH 觸及（D） $100.00",
      },
      {
        edge: "VAL",
        timeframes: ["D"],
        lowPrice: 90,
        highPrice: 90,
        isConfluent: false,
        label: "VAL 觸及（D） $90.00",
      },
    ]);
  });
});
