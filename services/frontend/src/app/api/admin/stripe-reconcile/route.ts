import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import Stripe from "stripe";

import { authOptions } from "@/lib/auth";
import { stripe } from "@/lib/stripe";
import { getStripeMode } from "@/lib/stripe-config";
import { buildReconciliationResult } from "@/lib/stripe-reconciliation";
import { getSupabaseAdmin } from "@/lib/supabase";

function isAdmin(email: string): boolean {
  return (process.env.ADMIN_EMAILS || "")
    .split(",")
    .map((item) => item.trim().toLowerCase())
    .filter(Boolean)
    .includes(email.toLowerCase());
}

function isMissingStripeResource(error: unknown): boolean {
  return (
    error instanceof Stripe.errors.StripeInvalidRequestError &&
    error.code === "resource_missing"
  );
}

export async function POST(request: Request) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.email || !isAdmin(session.user.email)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = (await request.json().catch(() => ({}))) as { apply?: unknown };
  if (body.apply !== undefined && typeof body.apply !== "boolean") {
    return NextResponse.json({ error: "apply must be a boolean" }, { status: 400 });
  }
  const apply = body.apply === true;
  const stripeMode = getStripeMode();
  const supabase = getSupabaseAdmin();
  const { data: users, error: usersError } = await supabase
    .from("users")
    .select(
      "id, email, plan, subscription_status, stripe_customer_id, stripe_subscription_id, stripe_mode, current_period_end"
    )
    .not("stripe_customer_id", "is", null);

  if (usersError) {
    console.error("Stripe reconciliation user lookup failed", usersError);
    return NextResponse.json({ error: "Unable to load billing profiles" }, { status: 500 });
  }

  const results = [];
  for (const user of users ?? []) {
    if (user.stripe_mode !== stripeMode) {
      results.push({
        userId: user.id,
        email: user.email,
        safeToApply: false,
        issue: `Customer belongs to ${user.stripe_mode ?? "unknown"} mode`,
        differences: [],
        expected: null,
        applied: false,
      });
      continue;
    }

    try {
      const subscriptions = await stripe.subscriptions.list({
        customer: user.stripe_customer_id,
        status: "all",
        limit: 100,
      });
      const result = buildReconciliationResult(user, subscriptions.data);
      let applied = false;

      if (apply && result.safeToApply && result.expected && result.differences.length > 0) {
        const { error: updateError } = await supabase
          .from("users")
          .update({
            ...result.expected,
            ...(result.expected.trial_start
              ? { trial_used_at: result.expected.trial_start }
              : {}),
            stripe_checkout_session_id: null,
            stripe_checkout_expires_at: null,
            updated_at: new Date().toISOString(),
          })
          .eq("id", user.id);
        if (updateError) throw updateError;
        applied = true;
      }

      results.push({ ...result, applied });
    } catch (error: unknown) {
      results.push({
        userId: user.id,
        email: user.email,
        safeToApply: false,
        issue: isMissingStripeResource(error)
          ? "Stripe customer does not exist in the configured mode"
          : error instanceof Error
            ? error.message
            : "Unknown reconciliation error",
        differences: [],
        expected: null,
        applied: false,
      });
    }
  }

  return NextResponse.json({
    mode: stripeMode,
    dryRun: !apply,
    checked: results.length,
    differences: results.filter((item) => item.differences.length > 0).length,
    blocked: results.filter((item) => !item.safeToApply).length,
    applied: results.filter((item) => item.applied).length,
    results,
  });
}
