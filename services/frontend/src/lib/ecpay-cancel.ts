import {
  buildEcpayCancelFields,
  getEcpayConfig,
  parseEcpayResponse,
  verifyEcpayCallback,
} from "@/lib/ecpay";
import type { getSupabaseAdmin } from "@/lib/supabase";
import { queryEcpaySubscription } from "@/lib/ecpay-reconciliation";

type SupabaseAdmin = ReturnType<typeof getSupabaseAdmin>;

export async function processEcpayCancellation(input: {
  supabase: SupabaseAdmin;
  intentId: string;
  providerOrderId: string;
  fetcher?: typeof fetch;
}): Promise<void> {
  const config = getEcpayConfig();
  const fetcher = input.fetcher ?? fetch;
  try {
    // A previous attempt may have canceled ECPay successfully but failed before
    // local finalize. Provider query makes that dual-write failure recoverable.
    const existing = await queryEcpaySubscription(input.providerOrderId, config, fetcher)
      .catch(() => null);
    if (existing?.executionStatus === "terminated") {
      const { data, error } = await input.supabase.rpc("finalize_ecpay_cancel_intent", {
        target_intent_id: input.intentId,
        result_summary: { merchantTradeNo: input.providerOrderId, recoveredByQuery: true },
      });
      if (error || !data) throw error ?? new Error("Unable to finalize recovered ECPay cancellation");
      return;
    }
    const response = await fetcher(config.periodActionUrl, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams(buildEcpayCancelFields(config, input.providerOrderId)),
    });
    const raw = await response.text();
    if (Buffer.byteLength(raw, "utf8") > 64 * 1024) throw new Error("ECPay cancellation response too large");
    const result = parseEcpayResponse(raw);
    if (!response.ok || result.RtnCode !== "1" || !verifyEcpayCallback(result, config)) {
      throw new Error(result.RtnMsg || "Unable to cancel ECPay subscription");
    }
    const { data, error } = await input.supabase.rpc("finalize_ecpay_cancel_intent", {
      target_intent_id: input.intentId,
      result_summary: {
        merchantTradeNo: result.MerchantTradeNo ?? input.providerOrderId,
        rtnCode: result.RtnCode,
      },
    });
    if (error || !data) throw error ?? new Error("Unable to finalize ECPay cancellation");
  } catch (error) {
    await input.supabase.rpc("fail_ecpay_cancel_intent", {
      target_intent_id: input.intentId,
      error_message: error instanceof Error ? error.message : "Unknown cancellation error",
    });
    throw error;
  }
}
