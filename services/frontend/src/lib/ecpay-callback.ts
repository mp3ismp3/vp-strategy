import { minimizeEcpayEventPayload } from "@/lib/billing-event";
import {
  buildEcpayEventId,
  getEcpayCallbackAmount,
  getEcpayCallbackTime,
  getNextEcpayPeriodEnd,
  type EcpayFields,
} from "@/lib/ecpay";
import type { getSupabaseAdmin } from "@/lib/supabase";

type SupabaseAdmin = ReturnType<typeof getSupabaseAdmin>;
type EcpayCallbackResult = "processed" | "duplicate" | "simulated" | "stale";

export async function applyEcpayCallback(
  supabase: SupabaseAdmin,
  fields: EcpayFields
): Promise<EcpayCallbackResult> {
  const merchantTradeNo = fields.MerchantTradeNo;
  if (!merchantTradeNo) throw new Error("Missing MerchantTradeNo");
  const receivedAmount = getEcpayCallbackAmount(fields);
  if (!receivedAmount || !/^\d+$/.test(receivedAmount)) {
    throw new Error("Missing or invalid ECPay callback amount");
  }
  const authorizationTime = getEcpayCallbackTime(fields);
  const success = fields.RtnCode === "1";
  const successTimes = Number(fields.TotalSuccessTimes ?? (success ? "1" : "0"));
  const eventId = buildEcpayEventId(fields);
  const payload = minimizeEcpayEventPayload(fields);
  const { data, error } = await supabase.rpc("apply_ecpay_callback", {
    callback_event_id: eventId,
    callback_order_id: merchantTradeNo,
    callback_trade_no: fields.TradeNo ?? null,
    callback_success: success,
    callback_simulated: fields.SimulatePaid === "1",
    callback_amount: Number(receivedAmount),
    callback_event_at: authorizationTime,
    callback_period_end: success ? getNextEcpayPeriodEnd(authorizationTime) : null,
    callback_success_times: Number.isFinite(successTimes) ? successTimes : 0,
    callback_payload: payload,
  });
  if (error) {
    try {
      await supabase.from("billing_events").upsert({
        provider: "ecpay",
        provider_event_id: eventId,
        event_type: "ecpay.authorization",
        processing_status: "failed",
        last_error: error instanceof Error ? error.message.slice(0, 500) : "ECPay callback transaction failed",
        payload,
      }, { onConflict: "provider,provider_event_id" });
    } catch {
      // Preserve the original transaction error; the provider will retry.
    }
    throw error;
  }
  if (!["processed", "duplicate", "simulated", "stale"].includes(data)) {
    throw new Error("Unexpected ECPay callback result");
  }
  return data as EcpayCallbackResult;
}
