import { describe, expect, it } from "vitest";

import {
  buildCheckoutIdempotencyKey,
  buildCustomerIdempotencyKey,
  findReplacementSubscription,
  getPlanForPriceId,
  getSubscriptionSnapshot,
  getStripeMode,
  getStripePriceIds,
  isStripeCheckoutEnabled,
  isPendingCheckoutReusable,
} from "@/lib/stripe-config";
import { claimWebhookEvent, shouldReclaimWebhookEvent } from "@/lib/stripe-webhook";
import { buildReconciliationResult } from "@/lib/stripe-reconciliation";

describe("Stripe production configuration", () => {
  const prices = {
    STRIPE_PRICE_PRO: "price_pro",
    STRIPE_PRICE_PREMIUM: "price_premium",
  };

  it("keeps checkout disabled unless explicitly enabled", () => {
    expect(isStripeCheckoutEnabled({})).toBe(false);
    expect(isStripeCheckoutEnabled({ STRIPE_CHECKOUT_ENABLED: "false" })).toBe(false);
    expect(isStripeCheckoutEnabled({ STRIPE_CHECKOUT_ENABLED: "true" })).toBe(true);
  });

  it("requires distinct server-side price IDs", () => {
    expect(getStripePriceIds(prices)).toEqual({
      pro: "price_pro",
      premium: "price_premium",
    });
    expect(() => getStripePriceIds({})).toThrow("STRIPE_PRICE_PRO");
    expect(() =>
      getStripePriceIds({
        STRIPE_PRICE_PRO: "price_same",
        STRIPE_PRICE_PREMIUM: "price_same",
      })
    ).toThrow("distinct");
  });

  it("maps only allowlisted prices to plans", () => {
    expect(getPlanForPriceId("price_pro", prices)).toBe("pro");
    expect(getPlanForPriceId("price_premium", prices)).toBe("premium");
    expect(() => getPlanForPriceId("price_attacker", prices)).toThrow(
      "Unknown Stripe price"
    );
  });

  it("detects Stripe mode from the server secret key", () => {
    expect(getStripeMode("sk_test_example")).toBe("test");
    expect(getStripeMode("sk_live_example")).toBe("live");
    expect(getStripeMode("rk_live_example")).toBe("live");
    expect(() => getStripeMode("pk_live_example")).toThrow("Unsupported");
  });

  it("deduplicates checkout attempts across plans for a thirty-minute window", () => {
    const first = buildCheckoutIdempotencyKey(
      "user@example.com",
      new Date("2026-08-05T12:01:00Z")
    );
    const sameWindow = buildCheckoutIdempotencyKey(
      "user@example.com",
      new Date("2026-08-05T12:29:59Z")
    );
    const nextWindow = buildCheckoutIdempotencyKey(
      "user@example.com",
      new Date("2026-08-05T12:30:00Z")
    );

    expect(first).toBe(sameWindow);
    expect(first).not.toBe(nextWindow);
    expect(first).not.toContain("user@example.com");
    expect(buildCustomerIdempotencyKey("user@example.com", "live")).toBe(
      buildCustomerIdempotencyKey("user@example.com", "live")
    );
    expect(buildCustomerIdempotencyKey("user@example.com", "live")).not.toBe(
      buildCustomerIdempotencyKey("user@example.com", "test")
    );
  });

  it("reuses only open, unexpired Checkout Sessions", () => {
    const now = new Date("2026-08-05T12:00:00Z");
    expect(
      isPendingCheckoutReusable("open", "https://checkout.stripe.test/1", 1_786_104_600, now)
    ).toBe(true);
    expect(
      isPendingCheckoutReusable("complete", "https://checkout.stripe.test/1", 1_786_104_600, now)
    ).toBe(false);
    expect(isPendingCheckoutReusable("open", null, 1_786_104_600, now)).toBe(false);
  });

  it("derives access state from Stripe subscription data and allowlisted prices", () => {
    expect(
      getSubscriptionSnapshot(
        {
          id: "sub_123",
          status: "trialing",
          trial_start: 1_700_000_000,
          trial_end: 1_700_604_800,
          current_period_end: 1_702_592_000,
          items: { data: [{ price: { id: "price_premium" } }] },
        },
        prices
      )
    ).toEqual({
      stripeSubscriptionId: "sub_123",
      plan: "premium",
      subscriptionStatus: "trialing",
      trialStart: "2023-11-14T22:13:20.000Z",
      trialEnd: "2023-11-21T22:13:20.000Z",
      currentPeriodEnd: "2023-12-14T22:13:20.000Z",
    });
  });

  it("retries failed or stale webhook claims but not completed events", () => {
    const now = new Date("2026-08-05T12:10:00Z");

    expect(shouldReclaimWebhookEvent("failed", null, now)).toBe(true);
    expect(
      shouldReclaimWebhookEvent("processing", "2026-08-05T12:00:00Z", now)
    ).toBe(true);
    expect(
      shouldReclaimWebhookEvent("processing", "2026-08-05T12:09:00Z", now)
    ).toBe(false);
    expect(shouldReclaimWebhookEvent("processed", null, now)).toBe(false);
  });

  it("uses the observed claim timestamp as part of stale-event compare-and-swap", async () => {
    const filters: Array<[string, unknown]> = [];
    const reclaimQuery = {
      update: () => reclaimQuery,
      eq: (field: string, value: unknown) => {
        filters.push([field, value]);
        return reclaimQuery;
      },
      select: () => reclaimQuery,
      maybeSingle: async () => ({ data: { id: "ledger_1" }, error: null }),
    };
    const lookupQuery = {
      select: () => lookupQuery,
      eq: () => lookupQuery,
      single: async () => ({
        data: {
          processing_status: "processing",
          processing_started_at: "2020-01-01T00:00:00.000Z",
        },
        error: null,
      }),
    };
    const supabase = {
      from: () => ({
        insert: async () => ({ error: { code: "23505" } }),
        ...lookupQuery,
        update: reclaimQuery.update,
      }),
    };

    await claimWebhookEvent(
      supabase as never,
      "evt_1",
      "customer.subscription.updated",
      {}
    );

    expect(filters).toContainEqual([
      "processing_started_at",
      "2020-01-01T00:00:00.000Z",
    ]);
  });

  it("reports reconciliation differences and blocks ambiguous subscriptions", () => {
    const user = {
      id: "user_1",
      email: "member@example.com",
      plan: "pro",
      subscription_status: "active",
      stripe_subscription_id: "sub_old",
      current_period_end: null,
    };
    const subscription = {
      id: "sub_current",
      status: "active",
      created: 1_700_000_000,
      trial_start: null,
      trial_end: null,
      current_period_end: 1_702_592_000,
      items: { data: [{ price: { id: "price_premium" } }] },
    };

    const result = buildReconciliationResult(user, [subscription], prices);
    expect(result.safeToApply).toBe(true);
    expect(result.expected?.plan).toBe("premium");
    expect(result.differences.map((item) => item.field)).toContain("plan");

    const ambiguous = buildReconciliationResult(
      user,
      [subscription, { ...subscription, id: "sub_second" }],
      prices
    );
    expect(ambiguous.safeToApply).toBe(false);
    expect(ambiguous.issue).toContain("multiple");
  });

  it("keeps the newest active replacement when an older subscription is deleted", () => {
    const base = {
      status: "active",
      trial_start: null,
      trial_end: null,
      current_period_end: 1_702_592_000,
      items: { data: [{ price: { id: "price_pro" } }] },
    };
    const replacement = findReplacementSubscription(
      [
        { ...base, id: "sub_deleted", status: "canceled", created: 1 },
        { ...base, id: "sub_current", created: 3 },
        { ...base, id: "sub_older", status: "canceled", created: 2 },
      ],
      "sub_deleted"
    );

    expect(replacement?.id).toBe("sub_current");
  });
});
