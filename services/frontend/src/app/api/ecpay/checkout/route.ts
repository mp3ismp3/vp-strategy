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

export async function POST(request: Request) {
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
  if (user.plan !== "free" && !["inactive", "canceled"].includes(user.subscription_status)) {
    return NextResponse.json({ error: "目前不支援方案直接切換，請先取消並於到期後重新訂閱" }, { status: 409 });
  }
  const { data: pending } = await supabase
    .from("billing_subscriptions")
    .select("id, created_at")
    .eq("user_id", user.id)
    .eq("provider", "ecpay")
    .eq("status", "pending")
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (pending) {
    if (Date.now() - new Date(pending.created_at).getTime() < 30 * 60 * 1000) {
      return NextResponse.json({ error: "已有付款頁面建立中，請 30 分鐘後再試" }, { status: 409 });
    }
    await supabase.from("billing_subscriptions").update({ status: "canceled", updated_at: new Date().toISOString() }).eq("id", pending.id);
  }
  const config = getEcpayConfig();
  const appUrl = process.env.NEXT_PUBLIC_APP_URL;
  if (!appUrl) return NextResponse.json({ error: "Missing NEXT_PUBLIC_APP_URL" }, { status: 500 });
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
  if (insertError) return NextResponse.json({ error: "Unable to create billing order" }, { status: 500 });
  return NextResponse.json({
    action: config.checkoutUrl,
    fields: buildEcpayCheckoutFields({ config, merchantTradeNo, plan, appUrl, tradeDate: formatTaipeiTradeDate() }),
  });
}
