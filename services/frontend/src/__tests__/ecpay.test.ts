import { describe, expect, it } from "vitest";

import {
  buildEcpayCheckoutFields,
  buildEcpayEventId,
  createCheckMacValue,
  getEcpayConfig,
  getEcpayCallbackAmount,
  getEcpayCallbackTime,
  getEcpayPlanAmount,
  getNextEcpayPeriodEnd,
  isEcpayCheckoutEnabled,
  parseEcpayResponse,
  verifyEcpayCallback,
} from "@/lib/ecpay";
import { applyEcpayCallback } from "@/lib/ecpay-callback";

const credentials = {
  ECPAY_MERCHANT_ID: "3002607",
  ECPAY_HASH_KEY: "pwFHCqoQZGmho4w6",
  ECPAY_HASH_IV: "EkRm7iFT261dpevs",
};

describe("ECPay recurring billing", () => {
  it("is disabled unless explicitly enabled", () => {
    expect(isEcpayCheckoutEnabled({})).toBe(false);
    expect(isEcpayCheckoutEnabled({ ECPAY_CHECKOUT_ENABLED: "true" })).toBe(true);
  });

  it("uses the approved TWD monthly prices", () => {
    expect(getEcpayPlanAmount("pro")).toBe(320);
    expect(getEcpayPlanAmount("premium")).toBe(620);
  });

  it("implements the official AioCheckOut SHA256 vector", () => {
    expect(
      createCheckMacValue(
        {
          ChoosePayment: "ALL",
          EncryptType: "1",
          ItemName: "Apple iphone 15",
          MerchantID: "3002607",
          MerchantTradeDate: "2023/03/12 15:30:23",
          MerchantTradeNo: "ecpay20230312153023",
          PaymentType: "aio",
          ReturnURL: "https://www.ecpay.com.tw/receive.php",
          TotalAmount: "30000",
          TradeDesc: "促銷方案",
        },
        credentials.ECPAY_HASH_KEY,
        credentials.ECPAY_HASH_IV
      )
    ).toBe("6C51C9E6888DE861FD62FB1DD17029FC742634498FD813DC43D4243B5685B840");
  });

  it("builds a monthly recurring credit-card checkout without a trial", () => {
    const config = getEcpayConfig({ ...credentials, ECPAY_MODE: "test" });
    const fields = buildEcpayCheckoutFields({
      config,
      merchantTradeNo: "VP260807ABC123",
      plan: "pro",
      appUrl: "https://example.com",
      tradeDate: "2026/08/07 12:34:56",
    });

    expect(fields).toMatchObject({
      ChoosePayment: "Credit",
      PeriodAmount: "320",
      PeriodType: "M",
      Frequency: "1",
      ExecTimes: "99",
      TotalAmount: "320",
      ReturnURL: "https://example.com/api/ecpay/return",
      PeriodReturnURL: "https://example.com/api/ecpay/period-return",
    });
    expect(fields).not.toHaveProperty("trial_period_days");
    expect(verifyEcpayCallback(fields, config)).toBe(true);
  });

  it("rejects tampered callbacks and deduplicates each authorization", () => {
    const config = getEcpayConfig({ ...credentials, ECPAY_MODE: "test" });
    const callback = {
      MerchantID: "3002607",
      MerchantTradeNo: "VP260807ABC123",
      TradeNo: "240807000000001",
      RtnCode: "1",
      TotalSuccessTimes: "2",
    };
    const signed = {
      ...callback,
      CheckMacValue: createCheckMacValue(
        callback,
        config.hashKey,
        config.hashIv
      ),
    };

    expect(verifyEcpayCallback(signed, config)).toBe(true);
    expect(verifyEcpayCallback({ ...signed, RtnCode: "0" }, config)).toBe(false);
    const withoutMerchantId = {
      MerchantTradeNo: callback.MerchantTradeNo,
      TradeNo: callback.TradeNo,
      RtnCode: callback.RtnCode,
      TotalSuccessTimes: callback.TotalSuccessTimes,
    };
    const missingMerchantId = {
      ...withoutMerchantId,
      CheckMacValue: createCheckMacValue(withoutMerchantId, config.hashKey, config.hashIv),
    };
    expect(verifyEcpayCallback(missingMerchantId, config)).toBe(false);
    expect(buildEcpayEventId(signed)).toBe(
      "ecpay:VP260807ABC123:240807000000001:2:1:0:unknown"
    );
  });

  it("reads the official recurring Amount field and requires an authorization time", () => {
    expect(getEcpayCallbackAmount({ Amount: "320" })).toBe("320");
    expect(getEcpayCallbackTime({ ProcessDate: "2026/01/31 12:34:56" })).toBe(
      "2026-01-31T04:34:56.000Z"
    );
    expect(() => getEcpayCallbackTime({})).toThrow("authorization time");
  });

  it("accepts the lowercase process_date used by recurring callbacks", () => {
    expect(getEcpayCallbackTime({ process_date: "2026/01/31 12:34:56" })).toBe(
      "2026-01-31T04:34:56.000Z"
    );
    expect(buildEcpayEventId({
      MerchantTradeNo: "VP260807ABC123",
      TradeNo: "240807000000001",
      RtnCode: "1",
      TotalSuccessTimes: "2",
      process_date: "2026/01/31 12:34:56",
    })).toContain("2026/01/31 12:34:56");
  });

  it("clamps month-end entitlement instead of rolling into March", () => {
    expect(getNextEcpayPeriodEnd("2026-01-31T04:34:56.000Z")).toBe(
      "2026-02-28T04:34:56.000Z"
    );
  });

  it("parses both current JSON and legacy form-encoded provider responses", () => {
    expect(parseEcpayResponse('{"MerchantID":"3002607","RtnCode":1}')).toEqual({
      MerchantID: "3002607",
      RtnCode: "1",
    });
    expect(parseEcpayResponse("MerchantID=3002607&RtnCode=1")).toEqual({
      MerchantID: "3002607",
      RtnCode: "1",
    });
  });

  function callbackDb(options: {
    eventInsertError?: { code: string } | null;
    existingEvent?: { processing_status: string; processing_started_at: string | null };
    subscriptionUpdated?: boolean;
    userUpdated?: boolean;
    lastProviderEventAt?: string;
  } = {}) {
    const updates: Array<{ table: string; value: Record<string, unknown> }> = [];
    const order = {
      id: "billing_1",
      user_id: "user_1",
      plan: "pro",
      amount: 320,
      status: "active",
      metadata: {},
      last_provider_event_at:
        options.lastProviderEventAt ?? "2026-01-01T00:00:00.000Z",
    };
    const from = (table: string) => {
      let operation: "select" | "update" | null = null;
      const query = {
        insert: async () => ({ error: options.eventInsertError ?? null }),
        select: () => {
          if (!operation) operation = "select";
          return query;
        },
        update: (value: Record<string, unknown>) => {
          operation = "update";
          updates.push({ table, value });
          return query;
        },
        eq: () => query,
        in: () => query,
        or: () => query,
        single: async () => ({
          data: table === "billing_subscriptions" ? order : options.existingEvent,
          error: null,
        }),
        maybeSingle: async () => ({
          data:
            operation === "update" && table === "billing_subscriptions"
              ? options.subscriptionUpdated === false ? null : { id: order.id }
              : operation === "update" && table === "users"
                ? options.userUpdated === false ? null : { id: "user_1" }
              : operation === "update" ? { id: "event_1" } : options.existingEvent,
          error: null,
        }),
      };
      return query;
    };
    return { db: { from } as never, updates };
  }

  const successfulCallback = {
    MerchantID: "3002607",
    MerchantTradeNo: "VP260807ABC123",
    TradeNo: "240807000000001",
    RtnCode: "1",
    Amount: "320",
    TotalSuccessTimes: "2",
    ProcessDate: "2026/01/31 12:34:56",
  };

  it("applies a verified recurring authorization to generic billing and entitlement state", async () => {
    const { db, updates } = callbackDb();
    await expect(applyEcpayCallback(db, successfulCallback)).resolves.toBe("processed");
    expect(updates).toContainEqual({
      table: "billing_subscriptions",
      value: expect.objectContaining({
        status: "active",
        current_period_end: "2026-02-28T04:34:56.000Z",
        last_provider_event_at: "2026-01-31T04:34:56.000Z",
      }),
    });
    expect(updates).toContainEqual({
      table: "users",
      value: expect.objectContaining({ plan: "pro", subscription_status: "active" }),
    });
  });

  it("does not let an out-of-order authorization overwrite entitlement", async () => {
    const { db, updates } = callbackDb({ subscriptionUpdated: false });
    await expect(applyEcpayCallback(db, successfulCallback)).resolves.toBe("stale");
    expect(updates.some((item) => item.table === "users")).toBe(false);
  });

  it("resumes entitlement sync when the same failed callback is retried", async () => {
    const { db, updates } = callbackDb({
      eventInsertError: { code: "23505" },
      existingEvent: {
        processing_status: "failed",
        processing_started_at: "2026-01-31T04:35:00.000Z",
      },
      lastProviderEventAt: "2026-01-31T04:34:56.000Z",
    });

    await expect(applyEcpayCallback(db, successfulCallback)).resolves.toBe("processed");
    expect(updates.some((item) => item.table === "billing_subscriptions")).toBe(false);
    expect(updates).toContainEqual({
      table: "users",
      value: expect.objectContaining({ plan: "pro", subscription_status: "active" }),
    });
  });

  it("does not let an older callback overwrite a newer users snapshot", async () => {
    const { db, updates } = callbackDb({ userUpdated: false });

    await expect(applyEcpayCallback(db, successfulCallback)).resolves.toBe("stale");
    expect(updates).toContainEqual({
      table: "users",
      value: expect.objectContaining({
        last_billing_event_at: "2026-01-31T04:34:56.000Z",
      }),
    });
  });

  it("records but never fulfills simulated payments", async () => {
    const { db, updates } = callbackDb();
    await expect(
      applyEcpayCallback(db, { ...successfulCallback, SimulatePaid: "1" })
    ).resolves.toBe("simulated");
    expect(updates.some((item) => item.table === "users")).toBe(false);
  });

  it("fails closed on amount mismatch and marks the event retryable", async () => {
    const { db, updates } = callbackDb();
    await expect(
      applyEcpayCallback(db, { ...successfulCallback, Amount: "620" })
    ).rejects.toThrow("amount mismatch");
    expect(updates).toContainEqual({
      table: "billing_events",
      value: expect.objectContaining({ processing_status: "failed" }),
    });
  });

  it("does not reclaim a fresh concurrent callback", async () => {
    const { db } = callbackDb({
      eventInsertError: { code: "23505" },
      existingEvent: {
        processing_status: "processing",
        processing_started_at: new Date().toISOString(),
      },
    });
    await expect(applyEcpayCallback(db, successfulCallback)).rejects.toThrow(
      "already processing"
    );
  });
});
