import { getServerSession } from "next-auth";
import { NextResponse } from "next/server";

import { authOptions } from "@/lib/auth";
import { processEcpayCancellation } from "@/lib/ecpay-cancel";
import { isTrustedMutationRequest } from "@/lib/http-security";
import { getSupabaseAdmin } from "@/lib/supabase";

export async function POST(request: Request) {
  if (!isTrustedMutationRequest(request)) {
    return NextResponse.json({ error: "Untrusted request origin" }, { status: 403 });
  }
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
  const { data: intentId, error: intentError } = await supabase.rpc(
    "create_ecpay_cancel_intent",
    { target_user_id: user.id, target_subscription_id: subscription.id }
  );
  if (intentError || !intentId) {
    return NextResponse.json({ error: "Unable to persist cancellation request" }, { status: 500 });
  }
  const { data: claimed } = await supabase.rpc("claim_ecpay_cancel_intent", {
    target_intent_id: intentId,
  });
  if (!claimed) {
    return NextResponse.json({ error: "取消請求已由其他工作處理中" }, { status: 409 });
  }
  try {
    await processEcpayCancellation({
      supabase,
      intentId,
      providerOrderId: subscription.provider_order_id,
    });
  } catch {
    return NextResponse.json({
      error: "取消請求已保存並排入重試；若狀態未更新請聯絡客服",
      retryScheduled: true,
    }, { status: 502 });
  }
  return NextResponse.json({ canceledAtPeriodEnd: true });
}
