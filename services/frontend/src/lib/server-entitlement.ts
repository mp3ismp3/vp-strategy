import { getServerSession } from "next-auth";

import { authOptions } from "@/lib/auth";
import { hasActiveEntitlement } from "@/lib/billing";
import { getSupabaseAdmin } from "@/lib/supabase";
import type { Plan, SubscriptionStatus } from "@/types/user";

export async function getServerPlan(): Promise<Plan | null> {
  const session = await getServerSession(authOptions);
  if (!session?.user?.email) return null;

  const { data, error } = await getSupabaseAdmin()
    .from("users")
    .select("plan, subscription_status, current_period_end, cancel_at_period_end")
    .eq("email", session.user.email)
    .single();
  if (error || !data) return "free";
  if (data.plan === "free") return "free";

  return hasActiveEntitlement({
    plan: data.plan as Plan,
    subscriptionStatus: data.subscription_status as SubscriptionStatus,
    currentPeriodEnd: data.current_period_end,
    cancelAtPeriodEnd: data.cancel_at_period_end,
  }) ? data.plan as Plan : "free";
}
