import { getServerSession } from "next-auth";
import { NextResponse } from "next/server";

import { authOptions } from "@/lib/auth";
import {
  buildEcpayCheckoutFields,
  createMerchantTradeNo,
  formatTaipeiTradeDate,
  getEcpayConfig,
  getEcpayPlanAmount,
  isEcpayCheckoutEnabled,
} from "@/lib/ecpay";
import { getSupabaseAdmin } from "@/lib/supabase";
import type { Plan } from "@/types/user";
import { getCanonicalAppUrl, isJsonRequest, isTrustedMutationRequest } from "@/lib/http-security";

export async function POST(request: Request) {
  if (!isTrustedMutationRequest(request) || !isJsonRequest(request)) {
    return NextResponse.json({ error: "Untrusted request origin" }, { status: 403 });
  }
  const session = await getServerSession(authOptions);
  if (!session?.user?.email) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!isEcpayCheckoutEnabled()) {
    return NextResponse.json({ error: "台灣地區金流建置中，目前暫不支援新訂閱" }, { status: 503 });
  }
  const body = await request.json().catch(() => null);
  const plan = body?.plan as Plan | undefined;
  if (plan !== "pro" && plan !== "premium") {
    return NextResponse.json({ error: "Invalid plan" }, { status: 400 });
  }
  const supabase = getSupabaseAdmin();
  const { data: user, error } = await supabase
    .from("users")
    .select("id, plan, subscription_status")
    .eq("email", session.user.email)
    .single();
  if (error || !user) return NextResponse.json({ error: "Unable to load billing profile" }, { status: 500 });
  const { data: checkoutIntentId, error: reservationError } = await supabase.rpc("reserve_billing_checkout", {
    target_user_id: user.id, target_provider: "ecpay", target_plan: plan,
  });
  if (reservationError || !checkoutIntentId) {
    return NextResponse.json({ error: "已有訂閱或付款流程進行中，請先完成或等待 30 分鐘" }, { status: 409 });
  }
  const config = getEcpayConfig();
  const appUrl = getCanonicalAppUrl();
  const merchantTradeNo = createMerchantTradeNo();
  const amount = getEcpayPlanAmount(plan);
  const { error: insertError } = await supabase.from("billing_subscriptions").insert({
    user_id: user.id,
    provider: "ecpay",
    provider_customer_id: null,
    provider_subscription_id: null,
    provider_order_id: merchantTradeNo,
    plan,
    amount,
    currency: "TWD",
    billing_interval: "month",
    status: "pending",
    metadata: { frequency: 1, execTimes: 99 },
  });
  if (insertError?.code === "23505") {
    await supabase.rpc("release_billing_checkout", { target_intent_id: checkoutIntentId, target_user_id: user.id });
    return NextResponse.json({ error: "已有訂閱或付款流程進行中，請勿重複送出" }, { status: 409 });
  }
  if (insertError) {
    await supabase.rpc("release_billing_checkout", { target_intent_id: checkoutIntentId, target_user_id: user.id });
    return NextResponse.json({ error: "Unable to create billing order" }, { status: 500 });
  }
  const { data: attached, error: attachError } = await supabase.rpc("attach_billing_checkout", {
    target_intent_id: checkoutIntentId, target_user_id: user.id,
    target_external_reference: merchantTradeNo,
  });
  if (attachError || !attached) {
    return NextResponse.json({ error: "Unable to finalize billing order" }, { status: 500 });
  }
  return NextResponse.json({
    action: config.checkoutUrl,
    fields: buildEcpayCheckoutFields({ config, merchantTradeNo, plan, appUrl, tradeDate: formatTaipeiTradeDate() }),
  });
}
