import { getServerSession } from "next-auth";
import { NextResponse } from "next/server";

import { authOptions } from "@/lib/auth";
import { auditEcpaySubscription, compareEcpayProviderState, queryEcpaySubscription, shouldAlertEcpayAudit } from "@/lib/ecpay-reconciliation";
import { getSupabaseAdmin } from "@/lib/supabase";
import { timingSafeEqual } from "node:crypto";

function isAdmin(email: string): boolean {
  return (process.env.ADMIN_EMAILS || "")
    .split(",")
    .map((item) => item.trim().toLowerCase())
    .filter(Boolean)
    .includes(email.toLowerCase());
}

function hasCronSecret(request: Request): boolean {
  const expected = process.env.BILLING_RECONCILIATION_SECRET;
  const received = request.headers.get("authorization")?.replace(/^Bearer\s+/i, "");
  if (!expected || !received) return false;
  const left = Buffer.from(received);
  const right = Buffer.from(expected);
  return left.length === right.length && timingSafeEqual(left, right);
}

export async function GET(request: Request) {
  const session = await getServerSession(authOptions);
  const adminSession = Boolean(session?.user?.email && isAdmin(session.user.email));
  if (!adminSession && !hasCronSecret(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const supabase = getSupabaseAdmin();
  const [{ data: subscriptions, error: subscriptionError }, { data: failedEvents, error: eventError }] = await Promise.all([
    supabase
      .from("billing_subscriptions")
      .select("id, user_id, provider_order_id, status, amount, current_period_end, last_provider_event_at")
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

  const localFindings = (subscriptions || [])
    .map((subscription) => ({
      userId: subscription.user_id,
      ...auditEcpaySubscription(subscription),
    }))
    .filter((finding) => finding.issue);
  const providerChecks = await Promise.all((subscriptions || []).map(async (subscription) => {
    try {
      if (!subscription.provider_order_id) throw new Error("Missing provider order ID");
      const provider = await queryEcpaySubscription(subscription.provider_order_id);
      return {
        subscriptionId: subscription.id,
        provider,
        findings: compareEcpayProviderState({
          subscriptionId: subscription.id,
          localStatus: subscription.status,
          localAmount: subscription.amount,
          provider,
        }),
      };
    } catch (error) {
      return {
        subscriptionId: subscription.id,
        provider: null,
        findings: [{
          subscriptionId: subscription.id,
          severity: "critical" as const,
          issue: "provider_query_failed" as const,
          error: error instanceof Error ? error.message : "Unknown provider query failure",
        }],
      };
    }
  }));
  const findings = [...localFindings, ...providerChecks.flatMap((item) => item.findings)];
  const unresolvedEvents = (failedEvents ?? []).map((event) => ({
    providerEventId: event.provider_event_id,
    processingStatus: event.processing_status,
    processingStartedAt: event.processing_started_at,
    hasError: Boolean(event.last_error),
  }));
  if (shouldAlertEcpayAudit(findings.length, unresolvedEvents.length) && process.env.BILLING_ALERT_WEBHOOK_URL) {
    await fetch(process.env.BILLING_ALERT_WEBHOOK_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        source: "ecpay-reconciliation",
        findingCount: findings.length,
        unresolvedEventCount: unresolvedEvents.length,
        findings,
        unresolvedEvents,
      }),
    }).catch((error) => console.error("ECPay reconciliation alert failed", error));
  }

  return NextResponse.json({
    checkedAt: new Date().toISOString(),
    checkedSubscriptions: subscriptions?.length ?? 0,
    findings,
    unresolvedEvents,
    providerChecks,
    providerVerificationAvailable: true,
    localStateHealthy: findings.length === 0 && (failedEvents?.length ?? 0) === 0,
    safeToEnableCheckout: findings.length === 0 && (failedEvents?.length ?? 0) === 0,
  });
}
