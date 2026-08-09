import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";

import { buildBillingSubscriptionRecord, hasActiveEntitlement } from "@/lib/billing";

describe("provider-neutral billing model", () => {
  it("enforces one open ECPay subscription per user at the database boundary", () => {
    const migration = readFileSync("supabase_billing_providers.sql", "utf8");
    expect(migration).toContain("idx_billing_subscriptions_one_open_ecpay_per_user");
    expect(migration).toMatch(/UNIQUE INDEX[\s\S]*user_id[\s\S]*provider = 'ecpay'[\s\S]*pending[\s\S]*active[\s\S]*past_due[\s\S]*canceling/);
  });

  it("fails closed after a canceled subscription reaches its period end", () => {
    expect(hasActiveEntitlement({
      plan: "pro",
      subscriptionStatus: "active",
      cancelAtPeriodEnd: true,
      currentPeriodEnd: "2026-08-07T00:00:00.000Z",
    }, new Date("2026-08-07T00:00:01.000Z"))).toBe(false);
  });

  it("keeps access before the canceled subscription reaches its period end", () => {
    expect(hasActiveEntitlement({
      plan: "premium",
      subscriptionStatus: "active",
      cancelAtPeriodEnd: true,
      currentPeriodEnd: "2026-08-08T00:00:00.000Z",
    }, new Date("2026-08-07T00:00:00.000Z"))).toBe(true);
  });

  it.each([
    ["stripe", "sub_123", "cus_123", "price_123"],
    ["ecpay", "240807000000001", null, "VP260807ABC123"],
    ["future-pay", "future_sub_1", "future_customer_1", "future_order_1"],
  ])("stores %s identifiers in the same subscription contract", (
    provider,
    providerSubscriptionId,
    providerCustomerId,
    providerOrderId
  ) => {
    expect(
      buildBillingSubscriptionRecord({
        userId: "user_1",
        provider,
        providerSubscriptionId,
        providerCustomerId,
        providerOrderId,
        plan: "pro",
        amount: 320,
        currency: "TWD",
        billingInterval: "month",
        status: "active",
        metadata: { source: provider },
      })
    ).toEqual({
      user_id: "user_1",
      provider,
      provider_subscription_id: providerSubscriptionId,
      provider_customer_id: providerCustomerId,
      provider_order_id: providerOrderId,
      plan: "pro",
      amount: 320,
      currency: "TWD",
      billing_interval: "month",
      status: "active",
      metadata: { source: provider },
    });
  });
});
