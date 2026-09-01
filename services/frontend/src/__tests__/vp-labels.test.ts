import { describe, expect, it } from "vitest";
import { getVpPositionLabel } from "@/lib/vp-labels";

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
