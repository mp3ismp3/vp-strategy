import { getServerSession } from "next-auth";
import { NextResponse } from "next/server";

import { authOptions } from "@/lib/auth";
import { auditEcpaySubscription } from "@/lib/ecpay-reconciliation";
import { getSupabaseAdmin } from "@/lib/supabase";

function isAdmin(email: string): boolean {
  return (process.env.ADMIN_EMAILS || "")
    .split(",")
    .map((item) => item.trim().toLowerCase())
    .filter(Boolean)
    .includes(email.toLowerCase());
}

export async function GET() {
  const session = await getServerSession(authOptions);
  if (!session?.user?.email || !isAdmin(session.user.email)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const supabase = getSupabaseAdmin();
  const [{ data: subscriptions, error: subscriptionError }, { data: failedEvents, error: eventError }] = await Promise.all([
    supabase
      .from("billing_subscriptions")
      .select("id, user_id, status, current_period_end, last_provider_event_at")
      .eq("provider", "ecpay")
      .in("status", ["active", "past_due", "canceling"]),
    supabase
      .from("billing_events")
      .select("provider_event_id, processing_status, processing_started_at, last_error")
      .eq("provider", "ecpay")
      .in("processing_status", ["processing", "failed"]),
  ]);
  if (subscriptionError || eventError) {
    return NextResponse.json({ error: "Unable to audit ECPay billing state" }, { status: 500 });
  }

  const findings = (subscriptions || [])
    .map((subscription) => ({
      userId: subscription.user_id,
      ...auditEcpaySubscription(subscription),
    }))
    .filter((finding) => finding.issue);

  return NextResponse.json({
    checkedAt: new Date().toISOString(),
    checkedSubscriptions: subscriptions?.length ?? 0,
    findings,
    unresolvedEvents: failedEvents ?? [],
    providerVerificationAvailable: false,
    localStateHealthy: findings.length === 0 && (failedEvents?.length ?? 0) === 0,
    safeToEnableCheckout: false,
  });
}
