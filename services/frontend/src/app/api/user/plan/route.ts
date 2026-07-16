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
    .select("plan, subscription_status, trial_end, current_period_end")
    .eq("email", session.user.email)
    .single();

  return NextResponse.json({
    plan: data?.plan || "free",
    subscriptionStatus: data?.subscription_status || "inactive",
    trialEnd: data?.trial_end || null,
    currentPeriodEnd: data?.current_period_end || null,
  });
}
