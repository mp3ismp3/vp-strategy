import { describe, expect, it } from "vitest";

import { resolvePlanSnapshot } from "@/lib/plans";
import { formatTrigger } from "@/lib/triggers";

describe("subscription UI safety", () => {
  it("fails closed when the plan snapshot belongs to another account", () => {
    expect(
      resolvePlanSnapshot(
        { email: "paid@example.com", plan: "premium", status: "active" },
        "new@example.com"
      )
    ).toEqual({ plan: "free", ready: false, status: "inactive" });
  });

  it("accepts an explicit free snapshot after a plan lookup failure", () => {
    expect(
      resolvePlanSnapshot(
        { email: "new@example.com", plan: "free", status: "inactive" },
        "new@example.com"
      )
    ).toEqual({ plan: "free", ready: true, status: "inactive" });
  });

  it("formats both legacy string and object triggers", () => {
    expect(formatTrigger("Spring")).toBe("Spring");
    expect(formatTrigger({ type: "LPS", date: "2026-08-07" })).toBe("LPS");
  });
});
