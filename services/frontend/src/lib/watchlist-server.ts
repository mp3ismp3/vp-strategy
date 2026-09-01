import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { getSupabaseAdmin } from "@/lib/supabase";
import type { Plan } from "@/types/user";

interface UserRow {
  id: string;
  plan: Plan | null;
  subscription_status: string | null;
  current_period_end: string | null;
}

export interface WatchlistContext {
  supabase: ReturnType<typeof getSupabaseAdmin>;
  user: { id: string; plan: Plan };
}

function effectivePlan(row: UserRow): Plan {
  if (row.plan !== "pro" && row.plan !== "premium") return "free";
  if (!row.subscription_status || !["active", "trialing"].includes(row.subscription_status)) {
    return "free";
  }
  if (!row.current_period_end) return "free";
  const periodEnd = new Date(row.current_period_end).getTime();
  return Number.isFinite(periodEnd) && periodEnd > Date.now() ? row.plan : "free";
}

export async function getWatchlistContext(): Promise<WatchlistContext | null> {
  const session = await getServerSession(authOptions);
  if (!session?.user?.email) return null;

  const supabase = getSupabaseAdmin();
  const { data, error } = await supabase
    .from("users")
    .select("id, plan, subscription_status, current_period_end")
    .eq("email", session.user.email)
    .single();
  if (error || !data) throw new Error("WATCHLIST_USER_LOOKUP_FAILED");

  const row = data as UserRow;
  return { supabase, user: { id: row.id, plan: effectivePlan(row) } };
}
