import { describe, expect, it, vi } from "vitest";

import { auditEcpaySubscription, compareEcpayProviderState, queryEcpaySubscription, shouldAlertEcpayAudit } from "@/lib/ecpay-reconciliation";

describe("ECPay reconciliation audit", () => {
  it("alerts when unresolved events exist even without provider findings", () => {
    expect(shouldAlertEcpayAudit(0, 1)).toBe(true);
    expect(shouldAlertEcpayAudit(0, 0)).toBe(false);
  });
  it("queries and validates the provider periodic-order snapshot", async () => {
    const fetcher = vi.fn().mockResolvedValue(new Response(JSON.stringify({
      MerchantID: "3002607", MerchantTradeNo: "VP260807ABC123", TradeNo: "trade_1",
      RtnCode: 1, PeriodAmount: 320, TotalSuccessTimes: 2, ExecStatus: "1",
      ExecLog: [{ process_date: "2026/08/01 12:00:00" }],
    })));
    const snapshot = await queryEcpaySubscription("VP260807ABC123", {
      checkoutUrl: "https://payment-stage.ecpay.com.tw/Cashier/AioCheckOut/V5",
      periodActionUrl: "https://payment-stage.ecpay.com.tw/Cashier/CreditCardPeriodAction",
      periodQueryUrl: "https://payment-stage.ecpay.com.tw/Cashier/QueryCreditCardPeriodInfo",
      merchantId: "3002607", hashKey: "key", hashIv: "iv", mode: "test",
    }, fetcher);
    expect(snapshot.executionStatus).toBe("active");
    expect(snapshot.periodAmount).toBe(320);
  });

  it("flags provider termination and amount drift", () => {
    expect(compareEcpayProviderState({
      subscriptionId: "sub_1", localStatus: "active", localAmount: 320,
      provider: {
        merchantTradeNo: "order_1", tradeNo: "trade_1", executionStatus: "terminated",
        periodAmount: 620, totalSuccessTimes: 1, latestAuthorizationAt: null,
      },
    }).map((item) => item.issue)).toEqual([
      "provider_amount_mismatch", "provider_terminated_locally_open",
    ]);
  });
  it("flags an active subscription whose paid period has expired", () => {
    expect(auditEcpaySubscription({
      id: "sub_1",
      status: "active",
      current_period_end: "2026-08-01T00:00:00.000Z",
      last_provider_event_at: "2026-07-01T00:00:00.000Z",
    }, new Date("2026-08-02T00:00:00.000Z"))).toMatchObject({
      severity: "critical",
      issue: "active_period_expired",
    });
  });

  it("flags a missing renewal callback before entitlement expires", () => {
    expect(auditEcpaySubscription({
      id: "sub_2",
      status: "active",
      current_period_end: "2026-08-01T00:00:00.000Z",
      last_provider_event_at: "2026-07-01T00:00:00.000Z",
    }, new Date("2026-08-01T06:00:00.000Z"), 12)).toMatchObject({
      severity: "warning",
      issue: "renewal_callback_overdue",
    });
  });

  it("keeps a healthy active subscription clear", () => {
    expect(auditEcpaySubscription({
      id: "sub_3",
      status: "active",
      current_period_end: "2026-09-01T00:00:00.000Z",
      last_provider_event_at: "2026-08-01T00:00:00.000Z",
    }, new Date("2026-08-10T00:00:00.000Z"))).toBeNull();
  });
});
