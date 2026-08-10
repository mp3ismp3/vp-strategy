import { createHash, randomBytes, timingSafeEqual } from "node:crypto";

import type { Plan } from "@/types/user";

type Env = Record<string, string | undefined>;
type PaidPlan = Exclude<Plan, "free">;
export type EcpayFields = Record<string, string>;

const PLAN_AMOUNTS: Record<PaidPlan, number> = { pro: 320, premium: 620 };

export interface EcpayConfig {
  checkoutUrl: string;
  periodActionUrl: string;
  periodQueryUrl: string;
  merchantId: string;
  hashKey: string;
  hashIv: string;
  mode: "test" | "live";
}

export function isEcpayCheckoutEnabled(env: Env = process.env): boolean {
  return env.ECPAY_CHECKOUT_ENABLED === "true";
}

export function getEcpayPlanAmount(plan: PaidPlan): number {
  return PLAN_AMOUNTS[plan];
}

export function getEcpayConfig(env: Env = process.env): EcpayConfig {
  const merchantId = env.ECPAY_MERCHANT_ID;
  const hashKey = env.ECPAY_HASH_KEY;
  const hashIv = env.ECPAY_HASH_IV;
  if (!merchantId) throw new Error("Missing ECPAY_MERCHANT_ID");
  if (!hashKey) throw new Error("Missing ECPAY_HASH_KEY");
  if (!hashIv) throw new Error("Missing ECPAY_HASH_IV");
  const mode = env.ECPAY_MODE === "live" ? "live" : "test";
  const base = mode === "live" ? "https://payment.ecpay.com.tw" : "https://payment-stage.ecpay.com.tw";
  return {
    merchantId,
    hashKey,
    hashIv,
    mode,
    checkoutUrl: `${base}/Cashier/AioCheckOut/V5`,
    periodActionUrl: `${base}/Cashier/CreditCardPeriodAction`,
    periodQueryUrl: `${base}/Cashier/QueryCreditCardPeriodInfo`,
  };
}

function ecpayUrlEncode(value: string): string {
  return encodeURIComponent(value)
    .replace(/%20/g, "+")
    .replace(/%2D/gi, "-")
    .replace(/%5F/gi, "_")
    .replace(/%2E/gi, ".")
    .replace(/%21/gi, "!")
    .replace(/%2A/gi, "*")
    .replace(/%28/gi, "(")
    .replace(/%29/gi, ")")
    .toLowerCase();
}

export function createCheckMacValue(
  fields: EcpayFields,
  hashKey: string,
  hashIv: string
): string {
  const query = Object.entries(fields)
    .filter(([key]) => key.toLowerCase() !== "checkmacvalue")
    .sort(([left], [right]) =>
      left.toLowerCase().localeCompare(right.toLowerCase(), "en")
    )
    .map(([key, value]) => `${key}=${value}`)
    .join("&");
  const encoded = ecpayUrlEncode(`HashKey=${hashKey}&${query}&HashIV=${hashIv}`);
  return createHash("sha256").update(encoded).digest("hex").toUpperCase();
}

export function verifyEcpayCallback(
  fields: EcpayFields,
  config: EcpayConfig
): boolean {
  if (fields.MerchantID !== config.merchantId) return false;
  const received = fields.CheckMacValue?.toUpperCase();
  if (!received || !/^[A-F0-9]{64}$/.test(received)) return false;
  const expected = createCheckMacValue(fields, config.hashKey, config.hashIv);
  return timingSafeEqual(Buffer.from(received), Buffer.from(expected));
}

export function parseEcpayResponse(body: string): EcpayFields {
  const trimmed = body.trim();
  if (trimmed.startsWith("{")) {
    const parsed = JSON.parse(trimmed) as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      throw new Error("Invalid ECPay JSON response");
    }
    return Object.fromEntries(
      Object.entries(parsed).map(([key, value]) => [key, String(value)])
    );
  }
  return Object.fromEntries(new URLSearchParams(trimmed));
}

export function createMerchantTradeNo(now = new Date()): string {
  const stamp = now.toISOString().slice(2, 10).replace(/-/g, "");
  return `VP${stamp}${randomBytes(5).toString("hex").toUpperCase()}`.slice(0, 20);
}

export function buildEcpayCheckoutFields(input: {
  config: EcpayConfig;
  merchantTradeNo: string;
  plan: PaidPlan;
  appUrl: string;
  tradeDate: string;
}): EcpayFields {
  const amount = String(getEcpayPlanAmount(input.plan));
  const fields: EcpayFields = {
    MerchantID: input.config.merchantId,
    MerchantTradeNo: input.merchantTradeNo,
    MerchantTradeDate: input.tradeDate,
    PaymentType: "aio",
    TotalAmount: amount,
    TradeDesc: `VP Strategy ${input.plan.toUpperCase()} monthly subscription`,
    ItemName: `VP Strategy ${input.plan.toUpperCase()} 月訂閱`,
    ReturnURL: `${input.appUrl}/api/ecpay/return`,
    OrderResultURL: `${input.appUrl}/api/ecpay/result`,
    ChoosePayment: "Credit",
    EncryptType: "1",
    PeriodAmount: amount,
    PeriodType: "M",
    Frequency: "1",
    ExecTimes: "99",
    PeriodReturnURL: `${input.appUrl}/api/ecpay/period-return`,
    CustomField1: input.plan,
    NeedExtraPaidInfo: "N",
  };
  return {
    ...fields,
    CheckMacValue: createCheckMacValue(fields, input.config.hashKey, input.config.hashIv),
  };
}

export function buildEcpayEventId(fields: EcpayFields): string {
  return [
    "ecpay",
    fields.MerchantTradeNo ?? "unknown",
    fields.TradeNo ?? "unknown",
    fields.TotalSuccessTimes ?? "1",
    fields.RtnCode ?? "unknown",
    fields.SimulatePaid ?? "0",
    fields.ProcessDate ?? fields.process_date ?? fields.PaymentDate ?? fields.TradeDate ?? "unknown",
  ].join(":");
}

export function getEcpayCallbackAmount(fields: EcpayFields): string | undefined {
  return fields.Amount ?? fields.PeriodAmount ?? fields.TradeAmt ?? fields.amount;
}

export function getEcpayCallbackTime(fields: EcpayFields): string {
  const value = fields.ProcessDate ?? fields.process_date ?? fields.PaymentDate ?? fields.TradeDate;
  const match = value?.match(/^(\d{4})\/(\d{2})\/(\d{2}) (\d{2}):(\d{2}):(\d{2})$/);
  if (!match) throw new Error("Missing or invalid ECPay authorization time");
  const [, year, month, day, hour, minute, second] = match;
  return new Date(Date.UTC(
    Number(year),
    Number(month) - 1,
    Number(day),
    Number(hour) - 8,
    Number(minute),
    Number(second)
  )).toISOString();
}

export function getNextEcpayPeriodEnd(authorizationTime: string): string {
  const taipei = new Date(new Date(authorizationTime).getTime() + 8 * 60 * 60 * 1000);
  const year = taipei.getUTCFullYear();
  const month = taipei.getUTCMonth();
  const day = taipei.getUTCDate();
  const daysInNextMonth = new Date(Date.UTC(year, month + 2, 0)).getUTCDate();
  const targetLocal = Date.UTC(
    year,
    month + 1,
    Math.min(day, daysInNextMonth),
    taipei.getUTCHours(),
    taipei.getUTCMinutes(),
    taipei.getUTCSeconds()
  );
  return new Date(targetLocal - 8 * 60 * 60 * 1000).toISOString();
}

export function buildEcpayCancelFields(
  config: EcpayConfig,
  merchantTradeNo: string,
  timestamp = Math.floor(Date.now() / 1000)
): EcpayFields {
  const fields: EcpayFields = {
    MerchantID: config.merchantId,
    MerchantTradeNo: merchantTradeNo,
    Action: "Cancel",
    TimeStamp: String(timestamp),
  };
  return {
    ...fields,
    CheckMacValue: createCheckMacValue(fields, config.hashKey, config.hashIv),
  };
}

export function buildEcpayPeriodQueryFields(
  config: EcpayConfig,
  merchantTradeNo: string,
  timestamp = Math.floor(Date.now() / 1000)
): EcpayFields {
  const fields: EcpayFields = {
    MerchantID: config.merchantId,
    MerchantTradeNo: merchantTradeNo,
    TimeStamp: String(timestamp),
  };
  return {
    ...fields,
    CheckMacValue: createCheckMacValue(fields, config.hashKey, config.hashIv),
  };
}

export function formDataToFields(formData: FormData): EcpayFields {
  return Object.fromEntries(
    [...formData.entries()].map(([key, value]) => [key, String(value)])
  );
}

export function formatTaipeiTradeDate(date = new Date()): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Taipei",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  }).formatToParts(date);
  const get = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((part) => part.type === type)?.value ?? "";
  return `${get("year")}/${get("month")}/${get("day")} ${get("hour")}:${get("minute")}:${get("second")}`;
}
