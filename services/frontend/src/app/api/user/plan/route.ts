import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { getSupabaseAdmin } from "@/lib/supabase";

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

  const cancellationExpired = Boolean(
    data?.cancel_at_period_end && data.current_period_end && new Date(data.current_period_end).getTime() <= Date.now()
  );
  if (cancellationExpired) {
    await supabase.from("users").update({ plan: "free", subscription_status: "canceled", cancel_at_period_end: false }).eq("email", session.user.email);
    await supabase.from("billing_subscriptions").update({ status: "canceled", cancel_at_period_end: false, updated_at: new Date().toISOString() }).eq("user_id", data!.id).eq("status", "canceling");
  }
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
    plan: cancellationExpired ? "free" : data?.plan || "free",
    subscriptionStatus: cancellationExpired ? "canceled" : data?.subscription_status || "inactive",
    trialEnd: data?.trial_end || null,
    currentPeriodEnd: data?.current_period_end || null,
    billingProvider: billingSubscription?.provider || null,
    cancelAtPeriodEnd: cancellationExpired ? false : data?.cancel_at_period_end || false,
  });
}
