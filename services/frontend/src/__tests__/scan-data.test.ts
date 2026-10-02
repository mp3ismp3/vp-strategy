import { describe, expect, it } from "vitest";

import { isValidScanInfo } from "@/lib/scan-data";

const frame = {
  poc: 100,
  vah: 105,
  val: 95,
  position: "inside_va",
  position_pct: 50,
};

describe("scan data validation", () => {
  it("accepts a complete VP result", () => {
    expect(isValidScanInfo({
      price: 100,
      daily: frame,
      weekly: frame,
      monthly: frame,
    })).toBe(true);
  });

  it("rejects the null price produced by an incomplete Yahoo bar", () => {
    expect(isValidScanInfo({
      price: null,
      daily: frame,
      weekly: frame,
      monthly: frame,
    })).toBe(false);
  });

  it("rejects a missing position percentage", () => {
    expect(isValidScanInfo({
      price: 100,
      daily: { ...frame, position_pct: null },
      weekly: frame,
      monthly: frame,
    })).toBe(false);
  });

  it("allows unavailable longer timeframes for newly listed symbols", () => {
    expect(isValidScanInfo({ price: 100, daily: frame, weekly: null, monthly: null })).toBe(true);
  });
});
