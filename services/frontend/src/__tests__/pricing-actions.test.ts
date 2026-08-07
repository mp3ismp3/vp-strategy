import { describe, expect, it } from "vitest";

import { getPricingPlanAction } from "@/lib/plans";

describe("Pricing plan actions", () => {
  it("lets a free user start either paid plan", () => {
    expect(getPricingPlanAction("free", "pro")).toEqual({
      disabled: false,
      label: "訂閱 Pro",
    });
    expect(getPricingPlanAction("free", "premium")).toEqual({
      disabled: false,
      label: "訂閱 Premium",
    });
  });

  it("disables paid-plan switching for an existing Pro subscriber", () => {
    expect(getPricingPlanAction("pro", "premium")).toEqual({
      disabled: true,
      label: "不支援直接切換",
    });
  });

  it("does not describe Pro as a new trial for a Premium subscriber", () => {
    expect(getPricingPlanAction("premium", "pro")).toEqual({
      disabled: true,
      label: "不支援直接切換",
    });
  });

  it.each(["pro", "premium"] as const)(
    "sends %s subscribers to account management to cancel",
    (currentPlan) => {
      expect(getPricingPlanAction(currentPlan, "free")).toEqual({
        disabled: false,
        href: "/account",
        label: "前往管理訂閱取消",
      });
    }
  );
});
