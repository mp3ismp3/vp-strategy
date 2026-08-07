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
  return query;
}

describe("ECPay API routes", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.verifyEcpayCallback.mockReturnValue(true);
    mocks.applyEcpayCallback.mockResolvedValue("processed");
    vi.stubGlobal("fetch", vi.fn());
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
    const subscriptionUpdate = chain({ data: null, error: null });
    const userUpdate = chain({ data: null, error: null });
    const from = vi.fn()
      .mockReturnValueOnce(userQuery)
      .mockReturnValueOnce(subscriptionQuery)
      .mockReturnValueOnce(subscriptionUpdate)
      .mockReturnValueOnce(userUpdate);
    mocks.getSupabaseAdmin.mockReturnValue({ from });
    vi.mocked(fetch).mockResolvedValue(new Response(
      "MerchantID=3002607&RtnCode=1&RtnMsg=OK&CheckMacValue=SIGNED"
    ));
    const { POST } = await import("@/app/api/ecpay/cancel/route");
    const response = await POST();

    expect(response.status).toBe(200);
    expect(subscriptionUpdate.update).toHaveBeenCalledWith(expect.objectContaining({
      status: "canceling",
      cancel_at_period_end: true,
    }));
    expect(userUpdate.update).toHaveBeenCalledWith(expect.objectContaining({
      cancel_at_period_end: true,
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
    mocks.getSupabaseAdmin.mockReturnValue({ from });
    mocks.verifyEcpayCallback.mockReturnValue(false);
    vi.mocked(fetch).mockResolvedValue(new Response("RtnCode=1&RtnMsg=OK"));
    const { POST } = await import("@/app/api/ecpay/cancel/route");
    const response = await POST();

    expect(response.status).toBe(502);
    expect(from).toHaveBeenCalledTimes(2);
  });
});
