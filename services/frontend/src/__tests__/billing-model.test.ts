import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";

import { buildBillingSubscriptionRecord, hasActiveEntitlement, hasTelegramEntitlement } from "@/lib/billing";

describe("provider-neutral billing model", () => {
  it("enforces one open ECPay subscription per user at the database boundary", () => {
    const migration = readFileSync("supabase_billing_providers.sql", "utf8");
    expect(migration).toContain("idx_billing_subscriptions_one_open_ecpay_per_user");
    expect(migration).toMatch(/UNIQUE INDEX[\s\S]*user_id[\s\S]*provider = 'ecpay'[\s\S]*pending[\s\S]*active[\s\S]*past_due[\s\S]*canceling/);
  });

  it("persists ECPay callback and cancellation through transaction RPCs", () => {
    const migration = readFileSync("supabase_billing_providers.sql", "utf8");
    expect(migration).toContain("apply_ecpay_callback");
    expect(migration).toContain("create_ecpay_cancel_intent");
    expect(migration).toContain("finalize_ecpay_cancel_intent");
    expect(migration).toMatch(/UPDATE public\.billing_subscriptions[\s\S]*refresh_user_entitlement/);
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

  it("fails closed when an active subscription has passed its period end", () => {
    expect(hasActiveEntitlement({
      plan: "pro",
      subscriptionStatus: "active",
      currentPeriodEnd: "2026-01-01T00:00:00.000Z",
    }, new Date("2026-01-02T00:00:00.000Z"))).toBe(false);
  });

  it("requires a known future period end for every paid entitlement", () => {
    expect(hasActiveEntitlement({
      plan: "premium",
      subscriptionStatus: "active",
      currentPeriodEnd: null,
    })).toBe(false);
  });

  it("reserves Telegram linking and signals for Premium", () => {
    const base = {
      subscriptionStatus: "active" as const,
      currentPeriodEnd: "2026-09-01T00:00:00.000Z",
    };
    expect(hasTelegramEntitlement({ ...base, plan: "pro" }, new Date("2026-08-01T00:00:00.000Z"))).toBe(false);
    expect(hasTelegramEntitlement({ ...base, plan: "premium" }, new Date("2026-08-01T00:00:00.000Z"))).toBe(true);
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
