import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import Stripe from "stripe";

import { authOptions } from "@/lib/auth";
import { stripe } from "@/lib/stripe";
import { getStripeMode } from "@/lib/stripe-config";
import { buildReconciliationResult } from "@/lib/stripe-reconciliation";
import { getSupabaseAdmin } from "@/lib/supabase";
import { isJsonRequest, isTrustedMutationRequest } from "@/lib/http-security";

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
  if (!isTrustedMutationRequest(request) || !isJsonRequest(request)) {
    return NextResponse.json({ error: "Untrusted request origin" }, { status: 403 });
  }
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
        const expectedSubscription = subscriptions.data.find(
          (item) => item.id === result.expected?.stripe_subscription_id
        );
        if (expectedSubscription) {
          const price = expectedSubscription.items.data[0]?.price;
          const interval = price?.recurring?.interval;
          const { error: billingError } = await supabase.rpc("sync_stripe_subscription", {
            target_user_id: user.id,
            stripe_customer: user.stripe_customer_id,
            stripe_subscription: expectedSubscription.id,
            stripe_plan: result.expected.plan,
            stripe_amount: price?.unit_amount ?? 0,
            stripe_currency: (price?.currency ?? "usd").toUpperCase(),
            stripe_interval: interval === "day" || interval === "year" ? interval : "month",
            stripe_status: expectedSubscription.status,
            stripe_period_end: result.expected.current_period_end,
            stripe_cancel_at_period_end: expectedSubscription.cancel_at_period_end,
            stripe_price_id: price?.id ?? null,
            stripe_trial_start: result.expected.trial_start,
            stripe_trial_end: result.expected.trial_end,
            stripe_mode_value: stripeMode,
            stripe_event_id: null,
          });
          if (billingError) throw billingError;
        } else {
          const { error: billingError } = await supabase.rpc("cancel_all_stripe_subscriptions", {
            target_user_id: user.id,
          });
          if (billingError) throw billingError;
        }
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
