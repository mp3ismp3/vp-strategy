import { getServerSession } from "next-auth";
import { NextResponse } from "next/server";

import { authOptions } from "@/lib/auth";
import { buildEcpayCancelFields, getEcpayConfig, verifyEcpayCallback } from "@/lib/ecpay";
import { getSupabaseAdmin } from "@/lib/supabase";

export async function POST() {
  const session = await getServerSession(authOptions);
  if (!session?.user?.email) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const supabase = getSupabaseAdmin();
  const { data: user } = await supabase.from("users").select("id").eq("email", session.user.email).single();
  if (!user) {
    return NextResponse.json({ error: "No ECPay subscription found" }, { status: 400 });
  }
  const { data: subscription } = await supabase
    .from("billing_subscriptions")
    .select("id, provider_order_id")
    .eq("user_id", user.id)
    .eq("provider", "ecpay")
    .in("status", ["active", "past_due"])
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (!subscription?.provider_order_id) return NextResponse.json({ error: "No ECPay subscription found" }, { status: 400 });
  const config = getEcpayConfig();
  const fields = buildEcpayCancelFields(config, subscription.provider_order_id);
  const response = await fetch(config.periodActionUrl, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams(fields),
  });
  const result = Object.fromEntries(new URLSearchParams(await response.text())) as Record<string, string>;
  if (!response.ok || result.RtnCode !== "1" || !verifyEcpayCallback(result, config)) {
    return NextResponse.json({ error: result.RtnMsg || "Unable to cancel ECPay subscription" }, { status: 502 });
  }
  const { error: subscriptionError } = await supabase.from("billing_subscriptions").update({ status: "canceling", cancel_at_period_end: true, updated_at: new Date().toISOString() }).eq("id", subscription.id);
  const { error: userError } = await supabase.from("users").update({ subscription_status: "active", cancel_at_period_end: true }).eq("id", user.id);
  if (subscriptionError || userError) {
    console.error("ECPay cancellation persisted incompletely", subscriptionError ?? userError);
    return NextResponse.json({ error: "扣款已停止，但本地狀態同步失敗，請聯絡客服" }, { status: 500 });
  }
  return NextResponse.json({ canceledAtPeriodEnd: true });
}
