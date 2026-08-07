import {
  buildEcpayEventId,
  getEcpayCallbackAmount,
  getEcpayCallbackTime,
  getNextEcpayPeriodEnd,
  type EcpayFields,
} from "@/lib/ecpay";
import type { getSupabaseAdmin } from "@/lib/supabase";
import { shouldReclaimWebhookEvent } from "@/lib/stripe-webhook";

type SupabaseAdmin = ReturnType<typeof getSupabaseAdmin>;

export async function applyEcpayCallback(
  supabase: SupabaseAdmin,
  fields: EcpayFields
): Promise<"processed" | "duplicate" | "simulated" | "stale"> {
  const merchantTradeNo = fields.MerchantTradeNo;
  if (!merchantTradeNo) throw new Error("Missing MerchantTradeNo");

  const { data: order, error: orderError } = await supabase
    .from("billing_subscriptions")
    .select("id, user_id, plan, amount, status, metadata, last_provider_event_at")
    .eq("provider", "ecpay")
    .eq("provider_order_id", merchantTradeNo)
    .single();
  if (orderError || !order) throw orderError ?? new Error("ECPay order not found");
  if (["canceling", "canceled"].includes(order.status)) {
    throw new Error("ECPay subscription is no longer payable");
  }

  const eventId = buildEcpayEventId(fields);
  const { error: eventError } = await supabase.from("billing_events").insert({
    user_id: order.user_id,
    event_type: "ecpay.authorization",
    provider: "ecpay",
    provider_event_id: eventId,
    processing_status: "processing",
    processing_started_at: new Date().toISOString(),
    payload: fields,
  });
  if (eventError?.code === "23505") {
    const { data: existing, error: lookupError } = await supabase
      .from("billing_events")
      .select("processing_status, processing_started_at")
      .eq("provider", "ecpay")
      .eq("provider_event_id", eventId)
      .single();
    if (lookupError) throw lookupError;
    if (existing?.processing_status === "processed") return "duplicate";
    if (!shouldReclaimWebhookEvent(
      existing.processing_status,
      existing.processing_started_at
    )) {
      throw new Error("ECPay callback is already processing");
    }
    const observedStartedAt = existing.processing_started_at;
    const { data: reclaimed, error: reclaimError } = await supabase
      .from("billing_events")
      .update({ processing_status: "processing", processing_started_at: new Date().toISOString(), last_error: null })
      .eq("provider", "ecpay")
      .eq("provider_event_id", eventId)
      .eq("processing_status", existing.processing_status)
      .eq("processing_started_at", observedStartedAt)
      .select("id")
      .maybeSingle();
    if (reclaimError) throw reclaimError;
    if (!reclaimed) throw new Error("ECPay callback claim was lost");
  }
  if (eventError && eventError.code !== "23505") throw eventError;

  try {
    if (fields.SimulatePaid === "1") {
      await supabase.from("billing_events").update({ processing_status: "processed", processed_at: new Date().toISOString() }).eq("provider_event_id", eventId).eq("provider", "ecpay");
      return "simulated";
    }
    const expectedAmount = String(order.amount);
    const receivedAmount = getEcpayCallbackAmount(fields);
    if (!receivedAmount || receivedAmount !== expectedAmount) {
      throw new Error("ECPay callback amount mismatch");
    }

    const authorizationTime = getEcpayCallbackTime(fields);
    const success = fields.RtnCode === "1";
    const currentPeriodEnd = success ? getNextEcpayPeriodEnd(authorizationTime) : null;
    const successTimes = Number(fields.TotalSuccessTimes ?? (success ? "1" : "0"));
    const observedEventTime = order.last_provider_event_at
      ? new Date(order.last_provider_event_at).getTime()
      : null;
    const callbackEventTime = new Date(authorizationTime).getTime();
    if (observedEventTime !== null && observedEventTime > callbackEventTime) {
      await supabase.from("billing_events").update({ processing_status: "processed", processed_at: new Date().toISOString(), last_error: null }).eq("provider", "ecpay").eq("provider_event_id", eventId);
      return "stale";
    }
    if (observedEventTime !== callbackEventTime) {
      const { data: updatedSubscription, error: subscriptionError } = await supabase
        .from("billing_subscriptions")
        .update({
          provider_subscription_id: fields.TradeNo ?? null,
          status: success ? "active" : "past_due",
          current_period_end: currentPeriodEnd,
          last_provider_event_at: authorizationTime,
          metadata: {
            ...(order.metadata ?? {}),
            totalSuccessTimes: Number.isFinite(successTimes) ? successTimes : 0,
          },
          updated_at: new Date().toISOString(),
        })
        .eq("id", order.id)
        .in("status", ["pending", "active", "past_due"])
        .or(`last_provider_event_at.is.null,last_provider_event_at.lt.${authorizationTime}`)
        .select("id")
        .maybeSingle();
      if (subscriptionError) throw subscriptionError;
      if (!updatedSubscription) {
        const { data: latest, error: latestError } = await supabase
          .from("billing_subscriptions")
          .select("last_provider_event_at")
          .eq("id", order.id)
          .single();
        if (latestError) throw latestError;
        if (latest?.last_provider_event_at !== authorizationTime) {
          await supabase.from("billing_events").update({ processing_status: "processed", processed_at: new Date().toISOString(), last_error: null }).eq("provider", "ecpay").eq("provider_event_id", eventId);
          return "stale";
        }
      }
    }

    const { data: updatedUser, error: userError } = await supabase
      .from("users")
      .update({
        plan: success ? order.plan : "free",
        subscription_status: success ? "active" : "past_due",
        trial_start: null,
        trial_end: null,
        current_period_end: currentPeriodEnd,
        cancel_at_period_end: false,
        last_billing_event_at: authorizationTime,
        updated_at: new Date().toISOString(),
      })
      .eq("id", order.user_id)
      .or(`last_billing_event_at.is.null,last_billing_event_at.lte.${authorizationTime}`)
      .select("id")
      .maybeSingle();
    if (userError) throw userError;
    if (!updatedUser) {
      await supabase.from("billing_events").update({ processing_status: "processed", processed_at: new Date().toISOString(), last_error: null }).eq("provider", "ecpay").eq("provider_event_id", eventId);
      return "stale";
    }
    const { error: processedError } = await supabase
      .from("billing_events")
      .update({ processing_status: "processed", processed_at: new Date().toISOString(), last_error: null })
      .eq("provider_event_id", eventId)
      .eq("provider", "ecpay");
    if (processedError) throw processedError;
    return "processed";
  } catch (error) {
    await supabase
      .from("billing_events")
      .update({ processing_status: "failed", last_error: error instanceof Error ? error.message : "Unknown ECPay callback error" })
      .eq("provider_event_id", eventId)
      .eq("provider", "ecpay");
    throw error;
  }
}
