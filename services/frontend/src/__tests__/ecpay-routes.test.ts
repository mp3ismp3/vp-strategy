import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  applyEcpayCallback: vi.fn(),
  getServerSession: vi.fn(),
  getSupabaseAdmin: vi.fn(),
  verifyEcpayCallback: vi.fn(),
}));

vi.mock("next-auth", () => ({ getServerSession: mocks.getServerSession }));
vi.mock("@/lib/auth", () => ({ authOptions: {} }));
vi.mock("@/lib/supabase", () => ({ getSupabaseAdmin: mocks.getSupabaseAdmin }));
vi.mock("@/lib/http-security", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/http-security")>();
  return { ...actual, isTrustedMutationRequest: () => true, isJsonRequest: () => true };
});
vi.mock("@/lib/ecpay-callback", () => ({
  applyEcpayCallback: mocks.applyEcpayCallback,
}));
vi.mock("@/lib/ecpay", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/ecpay")>();
  return {
    ...actual,
    getEcpayConfig: () => ({
      checkoutUrl: "https://payment-stage.ecpay.com.tw/Cashier/AioCheckOut/V5",
      periodActionUrl: "https://payment-stage.ecpay.com.tw/Cashier/CreditCardPeriodAction",
      merchantId: "3002607",
      hashKey: "test-key",
      hashIv: "test-iv",
      mode: "test" as const,
    }),
    verifyEcpayCallback: mocks.verifyEcpayCallback,
  };
});

function formRequest(path: string) {
  return new Request(`https://example.com${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ MerchantTradeNo: "VP260807ABC123", RtnCode: "1" }),
  });
}

function chain(result: { data: unknown; error: unknown }) {
  const query: Record<string, ReturnType<typeof vi.fn>> = {};
  for (const method of ["select", "eq", "in", "order", "limit", "update"]) {
    query[method] = vi.fn(() => query);
  }
  query.single = vi.fn().mockResolvedValue(result);
  query.maybeSingle = vi.fn().mockResolvedValue(result);
  query.insert = vi.fn().mockResolvedValue(result);
  query.then = vi.fn((resolve) => Promise.resolve(result).then(resolve));
  return query;
}

describe("ECPay API routes", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.verifyEcpayCallback.mockReturnValue(true);
    mocks.applyEcpayCallback.mockResolvedValue("processed");
    vi.stubGlobal("fetch", vi.fn());
    vi.stubEnv("ECPAY_CHECKOUT_ENABLED", "false");
    vi.stubEnv("NEXT_PUBLIC_APP_URL", "https://example.com");
  });

  it("fails closed when checkout is disabled", async () => {
    mocks.getServerSession.mockResolvedValue({ user: { email: "member@example.com" } });
    const { POST } = await import("@/app/api/ecpay/checkout/route");
    const response = await POST(new Request("https://example.com/api/ecpay/checkout", {
      method: "POST",
      body: JSON.stringify({ plan: "pro" }),
    }));

    expect(response.status).toBe(503);
    expect(mocks.getSupabaseAdmin).not.toHaveBeenCalled();
  });

  it("returns a conflict when the database rejects a concurrent checkout", async () => {
    vi.stubEnv("ECPAY_CHECKOUT_ENABLED", "true");
    mocks.getServerSession.mockResolvedValue({ user: { email: "member@example.com" } });
    const userQuery = chain({
      data: { id: "user_1", plan: "free", subscription_status: "inactive" },
      error: null,
    });
    const insertQuery = chain({ data: null, error: { code: "23505" } });
    const rpc = vi.fn(async (name: string) => ({
      data: name === "reserve_billing_checkout" ? "intent_1" : true, error: null,
    }));
    mocks.getSupabaseAdmin.mockReturnValue({
      from: vi.fn()
        .mockReturnValueOnce(userQuery)
        .mockReturnValueOnce(insertQuery),
      rpc,
    });
    const { POST } = await import("@/app/api/ecpay/checkout/route");
    const response = await POST(new Request("https://example.com/api/ecpay/checkout", {
      method: "POST",
      body: JSON.stringify({ plan: "pro" }),
    }));

    expect(response.status).toBe(409);
  });

  it("rejects ECPay checkout while another provider entitlement is active", async () => {
    vi.stubEnv("ECPAY_CHECKOUT_ENABLED", "true");
    mocks.getServerSession.mockResolvedValue({ user: { email: "member@example.com" } });
    const userQuery = chain({ data: { id: "user_1", plan: "free", subscription_status: "inactive" }, error: null });
    const rpc = vi.fn().mockResolvedValue({ data: null, error: { message: "Another checkout is already reserved" } });
    mocks.getSupabaseAdmin.mockReturnValue({
      from: vi.fn().mockReturnValueOnce(userQuery), rpc,
    });
    const { POST } = await import("@/app/api/ecpay/checkout/route");
    const response = await POST(new Request("https://example.com/api/ecpay/checkout", {
      method: "POST", body: JSON.stringify({ plan: "pro" }),
    }));
    expect(response.status).toBe(409);
  });

  it.each(["return", "period-return"])(
    "acknowledges a verified %s callback only after it is applied",
    async (route) => {
      const { POST } = route === "return"
        ? await import("@/app/api/ecpay/return/route")
        : await import("@/app/api/ecpay/period-return/route");
      const response = await POST(formRequest(`/api/ecpay/${route}`));

      expect(response.status).toBe(200);
      expect(await response.text()).toBe("1|OK");
      expect(mocks.applyEcpayCallback).toHaveBeenCalledOnce();
    }
  );

  it("rejects an invalid callback without touching billing state", async () => {
    mocks.verifyEcpayCallback.mockReturnValue(false);
    const { POST } = await import("@/app/api/ecpay/return/route");
    const response = await POST(formRequest("/api/ecpay/return"));

    expect(response.status).toBe(400);
    expect(mocks.applyEcpayCallback).not.toHaveBeenCalled();
  });

  it("persists cancel-at-period-end only after a signed successful provider response", async () => {
    mocks.getServerSession.mockResolvedValue({ user: { email: "member@example.com" } });
    const userQuery = chain({ data: { id: "user_1" }, error: null });
    const subscriptionQuery = chain({
      data: { id: "sub_1", provider_order_id: "VP260807ABC123" },
      error: null,
    });
    const from = vi.fn()
      .mockReturnValueOnce(userQuery)
      .mockReturnValueOnce(subscriptionQuery);
    const rpc = vi.fn()
      .mockResolvedValueOnce({ data: "intent_1", error: null })
      .mockResolvedValue({ data: true, error: null });
    mocks.getSupabaseAdmin.mockReturnValue({ from, rpc });
    vi.mocked(fetch).mockImplementation(async () => Response.json({
      MerchantID: "3002607", MerchantTradeNo: "VP260807ABC123",
      RtnCode: 1, RtnMsg: "OK", CheckMacValue: "SIGNED",
    }));
    const { POST } = await import("@/app/api/ecpay/cancel/route");
    const response = await POST(new Request("https://example.com/api/ecpay/cancel", {
      method: "POST",
      headers: { origin: "https://example.com" },
    }));

    expect(response.status).toBe(200);
    expect(rpc).toHaveBeenCalledWith("create_ecpay_cancel_intent", {
      target_subscription_id: "sub_1",
      target_user_id: "user_1",
    });
    expect(rpc).toHaveBeenCalledWith("finalize_ecpay_cancel_intent", expect.objectContaining({
      target_intent_id: "intent_1",
    }));
  });

  it("does not mark a subscription canceled when the provider response is unsigned", async () => {
    mocks.getServerSession.mockResolvedValue({ user: { email: "member@example.com" } });
    const userQuery = chain({ data: { id: "user_1" }, error: null });
    const subscriptionQuery = chain({
      data: { id: "sub_1", provider_order_id: "VP260807ABC123" },
      error: null,
    });
    const from = vi.fn()
      .mockReturnValueOnce(userQuery)
      .mockReturnValueOnce(subscriptionQuery);
    const rpc = vi.fn()
      .mockResolvedValueOnce({ data: "intent_1", error: null })
      .mockResolvedValue({ data: true, error: null });
    mocks.getSupabaseAdmin.mockReturnValue({ from, rpc });
    mocks.verifyEcpayCallback.mockReturnValue(false);
    vi.mocked(fetch).mockImplementation(async () => new Response("RtnCode=1&RtnMsg=OK"));
    const { POST } = await import("@/app/api/ecpay/cancel/route");
    const response = await POST(new Request("https://example.com/api/ecpay/cancel", {
      method: "POST",
      headers: { origin: "https://example.com" },
    }));

    expect(response.status).toBe(502);
    expect(rpc).toHaveBeenCalledWith("fail_ecpay_cancel_intent", expect.objectContaining({
      target_intent_id: "intent_1",
    }));
  });
});
