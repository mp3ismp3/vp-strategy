import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const mocks = vi.hoisted(() => ({
  getServerSession: vi.fn(),
  getSupabaseAdmin: vi.fn(),
  constructEvent: vi.fn(),
  claimWebhookEvent: vi.fn(),
  markWebhookProcessed: vi.fn(),
  markWebhookFailed: vi.fn(),
  customerCreate: vi.fn(),
  customerRetrieve: vi.fn(),
  subscriptionList: vi.fn(),
  sessionCreate: vi.fn(),
  sessionRetrieve: vi.fn(),
  sessionExpire: vi.fn(),
  portalCreate: vi.fn(),
}));

vi.mock("next-auth", () => ({ getServerSession: mocks.getServerSession }));
vi.mock("@/lib/auth", () => ({ authOptions: {} }));
vi.mock("@/lib/supabase", () => ({ getSupabaseAdmin: mocks.getSupabaseAdmin }));
vi.mock("@/lib/stripe", () => ({
  stripe: {
    webhooks: { constructEvent: mocks.constructEvent },
    customers: { create: mocks.customerCreate, retrieve: mocks.customerRetrieve },
    subscriptions: { list: mocks.subscriptionList, retrieve: vi.fn() },
    checkout: {
      sessions: {
        create: mocks.sessionCreate,
        retrieve: mocks.sessionRetrieve,
        expire: mocks.sessionExpire,
      },
    },
    billingPortal: { sessions: { create: mocks.portalCreate } },
  },
}));
vi.mock("@/lib/stripe-webhook", () => ({
  claimWebhookEvent: mocks.claimWebhookEvent,
  markWebhookProcessed: mocks.markWebhookProcessed,
  markWebhookFailed: mocks.markWebhookFailed,
}));

function supabaseQuery(result: { data: unknown; error: unknown }) {
  const query: Record<string, ReturnType<typeof vi.fn>> = {};
  for (const method of ["select", "eq", "not", "update", "insert"]) {
    query[method] = vi.fn(() => query);
  }
  query.single = vi.fn().mockResolvedValue(result);
  return query;
}

describe("Stripe route safety", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.STRIPE_SECRET_KEY = "sk_test_placeholder";
    process.env.STRIPE_WEBHOOK_SECRET = "whsec_placeholder";
    process.env.STRIPE_PRICE_PRO = "price_pro";
    process.env.STRIPE_PRICE_PREMIUM = "price_premium";
    process.env.NEXT_PUBLIC_APP_URL = "https://example.com";
  });

  it("keeps authenticated Checkout disabled by default", async () => {
    delete process.env.STRIPE_CHECKOUT_ENABLED;
    mocks.getServerSession.mockResolvedValue({ user: { email: "member@example.com" } });
    const { POST } = await import("@/app/api/stripe/checkout/route");

    const response = await POST(
      new NextRequest("https://example.com/api/stripe/checkout", {
        method: "POST",
        body: JSON.stringify({ plan: "pro" }),
      })
    );

    expect(response.status).toBe(503);
    expect(mocks.getSupabaseAdmin).not.toHaveBeenCalled();
  });

  it("returns 500 instead of creating a payment when billing lookup fails", async () => {
    process.env.STRIPE_CHECKOUT_ENABLED = "true";
    mocks.getServerSession.mockResolvedValue({ user: { email: "member@example.com" } });
    const query = supabaseQuery({ data: null, error: { message: "database unavailable" } });
    mocks.getSupabaseAdmin.mockReturnValue({ from: vi.fn(() => query) });
    const { POST } = await import("@/app/api/stripe/checkout/route");

    const response = await POST(
      new NextRequest("https://example.com/api/stripe/checkout", {
        method: "POST",
        body: JSON.stringify({ plan: "pro" }),
      })
    );

    expect(response.status).toBe(500);
  });

  it("reuses an open pending Checkout Session for the same plan", async () => {
    process.env.STRIPE_CHECKOUT_ENABLED = "true";
    mocks.getServerSession.mockResolvedValue({ user: { email: "member@example.com" } });
    const query = supabaseQuery({
      data: {
        id: "user_1",
        stripe_customer_id: "cus_1",
        stripe_mode: "test",
        trial_used_at: null,
        stripe_checkout_session_id: "cs_1",
        stripe_checkout_expires_at: "2099-08-05T12:30:00Z",
      },
      error: null,
    });
    mocks.getSupabaseAdmin.mockReturnValue({ from: vi.fn(() => query) });
    mocks.customerRetrieve.mockResolvedValue({ id: "cus_1" });
    mocks.sessionRetrieve.mockResolvedValue({
      id: "cs_1",
      customer: "cus_1",
      status: "open",
      url: "https://checkout.stripe.test/cs_1",
      expires_at: 4_089_078_000,
      metadata: { plan: "premium" },
    });
    const { POST } = await import("@/app/api/stripe/checkout/route");

    const response = await POST(
      new NextRequest("https://example.com/api/stripe/checkout", {
        method: "POST",
        body: JSON.stringify({ plan: "premium" }),
      })
    );
    const payload = await response.json();

    expect(payload.reusedSession).toBe(true);
    expect(payload.url).toContain("cs_1");
    expect(mocks.sessionCreate).not.toHaveBeenCalled();
  });

  it("rejects an open pending Checkout Session for another plan", async () => {
    process.env.STRIPE_CHECKOUT_ENABLED = "true";
    mocks.getServerSession.mockResolvedValue({ user: { email: "member@example.com" } });
    const query = supabaseQuery({
      data: {
        id: "user_1",
        stripe_customer_id: "cus_1",
        stripe_mode: "test",
        trial_used_at: null,
        stripe_checkout_session_id: "cs_1",
        stripe_checkout_expires_at: "2099-08-05T12:30:00Z",
      },
      error: null,
    });
    mocks.getSupabaseAdmin.mockReturnValue({ from: vi.fn(() => query) });
    mocks.customerRetrieve.mockResolvedValue({ id: "cus_1" });
    mocks.sessionRetrieve.mockResolvedValue({
      id: "cs_1",
      customer: "cus_1",
      status: "open",
      url: "https://checkout.stripe.test/cs_1",
      expires_at: 4_089_078_000,
      metadata: { plan: "pro" },
    });
    const { POST } = await import("@/app/api/stripe/checkout/route");

    const response = await POST(
      new NextRequest("https://example.com/api/stripe/checkout", {
        method: "POST",
        body: JSON.stringify({ plan: "premium" }),
      })
    );

    expect(response.status).toBe(409);
    expect(mocks.sessionCreate).not.toHaveBeenCalled();
  });

  it("uses an idempotency key when creating a Stripe customer", async () => {
    process.env.STRIPE_CHECKOUT_ENABLED = "true";
    mocks.getServerSession.mockResolvedValue({ user: { email: "member@example.com" } });
    const query = supabaseQuery({
      data: {
        id: "user_1",
        stripe_customer_id: null,
        stripe_mode: null,
        trial_used_at: null,
        stripe_checkout_session_id: null,
        stripe_checkout_expires_at: null,
      },
      error: null,
    });
    mocks.getSupabaseAdmin.mockReturnValue({ from: vi.fn(() => query) });
    mocks.customerCreate.mockResolvedValue({ id: "cus_new" });
    mocks.subscriptionList.mockResolvedValue({ data: [] });
    mocks.sessionCreate.mockResolvedValue({
      id: "cs_new",
      url: "https://checkout.stripe.test/cs_new",
    });
    const { POST } = await import("@/app/api/stripe/checkout/route");

    const response = await POST(
      new NextRequest("https://example.com/api/stripe/checkout", {
        method: "POST",
        body: JSON.stringify({ plan: "pro" }),
      })
    );

    expect(response.status).toBe(200);
    expect(mocks.customerCreate.mock.calls[0][1].idempotencyKey).toMatch(
      /^customer:test:/
    );
    expect(mocks.sessionCreate.mock.calls[0][1].idempotencyKey).toMatch(
      /^checkout:/
    );
  });

  it.each([
    ["processed", 200, true],
    ["busy", 409, false],
  ])("handles a %s webhook claim safely", async (claim, status, duplicate) => {
    mocks.constructEvent.mockReturnValue({
      id: "evt_123",
      type: "customer.subscription.updated",
      data: { object: {} },
    });
    mocks.claimWebhookEvent.mockResolvedValue(claim);
    mocks.getSupabaseAdmin.mockReturnValue({});
    const { POST } = await import("@/app/api/stripe/webhook/route");

    const response = await POST(
      new NextRequest("https://example.com/api/stripe/webhook", {
        method: "POST",
        body: "{}",
        headers: { "stripe-signature": "signature" },
      })
    );

    expect(response.status).toBe(status);
    const payload = await response.json();
    expect(Boolean(payload.duplicate)).toBe(duplicate);
    expect(mocks.markWebhookProcessed).not.toHaveBeenCalled();
  });

  it("keeps a processed webhook successful when Telegram delivery throws", async () => {
    mocks.constructEvent.mockReturnValue({
      id: "evt_deleted",
      type: "customer.subscription.deleted",
      data: { object: { id: "sub_old", customer: "cus_1" } },
    });
    mocks.claimWebhookEvent.mockResolvedValue("claimed");
    const selectQuery = supabaseQuery({
      data: { id: "user_1", telegram_user_id: 123 },
      error: null,
    });
    const updateQuery = supabaseQuery({ data: null, error: null });
    updateQuery.eq = vi.fn().mockResolvedValue({ error: null });
    mocks.getSupabaseAdmin.mockReturnValue({
      from: vi.fn(() => (selectQuery.select.mock.calls.length ? updateQuery : selectQuery)),
    });
    mocks.subscriptionList.mockResolvedValue({ data: [] });
    mocks.markWebhookProcessed.mockResolvedValue(undefined);
    process.env.TELEGRAM_BOT_TOKEN = "token";
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("network down")));
    const { POST } = await import("@/app/api/stripe/webhook/route");

    const response = await POST(
      new NextRequest("https://example.com/api/stripe/webhook", {
        method: "POST",
        body: "{}",
        headers: { "stripe-signature": "signature" },
      })
    );

    expect(response.status).toBe(200);
    expect(mocks.markWebhookProcessed).toHaveBeenCalledWith(expect.anything(), "evt_deleted");
    expect(mocks.markWebhookFailed).not.toHaveBeenCalled();
    vi.unstubAllGlobals();
    delete process.env.TELEGRAM_BOT_TOKEN;
  });

  it("keeps reconciliation dry-run by default", async () => {
    mocks.getServerSession.mockResolvedValue({ user: { email: "admin@example.com" } });
    process.env.ADMIN_EMAILS = "admin@example.com";
    const query = supabaseQuery({ data: [], error: null });
    query.not = vi.fn().mockResolvedValue({ data: [], error: null });
    mocks.getSupabaseAdmin.mockReturnValue({ from: vi.fn(() => query) });
    const { POST } = await import("@/app/api/admin/stripe-reconcile/route");

    const response = await POST(
      new Request("https://example.com/api/admin/stripe-reconcile", {
        method: "POST",
        body: JSON.stringify({}),
      })
    );
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload.dryRun).toBe(true);
    expect(payload.applied).toBe(0);
  });
});
