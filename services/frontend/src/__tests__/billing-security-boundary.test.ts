import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import {
  getCanonicalAppUrl,
  isTrustedMutationRequest,
  readRequestBodyWithLimit,
} from "@/lib/http-security";
import { minimizeBillingEventPayload } from "@/lib/billing-event";

describe("billing security boundaries", () => {
  it("accepts only the configured canonical HTTPS origin in production", () => {
    const env = { NODE_ENV: "production", NEXT_PUBLIC_APP_URL: "https://app.example.com" };
    expect(getCanonicalAppUrl(env)).toBe("https://app.example.com");
    expect(isTrustedMutationRequest(new Request("https://app.example.com/api/pay", {
      method: "POST",
      headers: { origin: "https://app.example.com", "content-type": "application/json" },
    }), env)).toBe(true);
    expect(isTrustedMutationRequest(new Request("https://app.example.com/api/pay", {
      method: "POST",
      headers: { origin: "https://evil.example", "content-type": "application/json" },
    }), env)).toBe(false);
    expect(() => getCanonicalAppUrl({ NODE_ENV: "production", NEXT_PUBLIC_APP_URL: "http://app.example.com" })).toThrow("HTTPS");
  });

  it("stops reading a streamed request once the body limit is exceeded", async () => {
    const request = new Request("https://app.example.com/webhook", {
      method: "POST",
      body: "123456789",
    });
    await expect(readRequestBodyWithLimit(request, 8)).rejects.toThrow("Payload too large");
  });

  it("stores only an allowlisted billing event summary", () => {
    expect(minimizeBillingEventPayload({
      id: "evt_1",
      created: 123,
      livemode: true,
      data: { object: { id: "sub_1", customer_email: "secret@example.com" } },
    })).toEqual({ objectId: "sub_1", created: 123, livemode: true });
  });

  it("defines atomic provider writes, durable cancellation and retention in SQL", () => {
    const migration = readFileSync("supabase_billing_providers.sql", "utf8");
    expect(migration).toContain("refresh_user_entitlement");
    expect(migration).toContain("apply_ecpay_callback");
    expect(migration).toContain("sync_stripe_subscription");
    expect(migration).toContain("billing_cancel_outbox");
    expect(migration).toContain("billing_checkout_intents");
    expect(migration).toContain("reserve_billing_checkout");
    expect(migration).toContain("idx_billing_checkout_one_open_per_user");
    expect(migration).toContain("claim_telegram_bind_token");
    expect(migration).toContain("purge_expired_billing_events");
    expect(migration).toMatch(/REVOKE ALL ON public\.billing_customers FROM anon, authenticated/);
    expect(migration).toMatch(/REVOKE ALL ON public\.billing_subscriptions FROM anon, authenticated/);
    expect(migration).toMatch(/REVOKE ALL ON public\.billing_events FROM anon, authenticated/);
  });
});
