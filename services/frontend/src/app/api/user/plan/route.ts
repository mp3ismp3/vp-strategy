import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { getSupabaseAdmin } from "@/lib/supabase";
import { hasActiveEntitlement } from "@/lib/billing";

export async function GET() {
  const session = await getServerSession(authOptions);

  if (!session?.user?.email) {
    return NextResponse.json({ plan: "free", subscriptionStatus: "inactive" });
  }

  const supabase = getSupabaseAdmin();
  const { data } = await supabase
    .from("users")
    .select("id, plan, subscription_status, trial_end, current_period_end, cancel_at_period_end")
    .eq("email", session.user.email)
    .single();

  const entitlementExpired = Boolean(data && data.plan !== "free" && !hasActiveEntitlement({
    plan: data.plan,
    subscriptionStatus: data.subscription_status,
    currentPeriodEnd: data.current_period_end,
    cancelAtPeriodEnd: data.cancel_at_period_end,
  }));
  const { data: billingSubscription } = data
    ? await supabase
        .from("billing_subscriptions")
        .select("provider")
        .eq("user_id", data.id)
        .in("status", ["active", "trialing", "past_due", "canceling"])
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle()
    : { data: null };
  return NextResponse.json({
    plan: entitlementExpired ? "free" : data?.plan || "free",
    subscriptionStatus: entitlementExpired ? "canceled" : data?.subscription_status || "inactive",
    trialEnd: data?.trial_end || null,
    currentPeriodEnd: data?.current_period_end || null,
    billingProvider: billingSubscription?.provider || null,
    cancelAtPeriodEnd: entitlementExpired ? false : data?.cancel_at_period_end || false,
  });
}
