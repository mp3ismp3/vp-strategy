import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { stripe } from "@/lib/stripe";
import { getSupabaseAdmin } from "@/lib/supabase";
import {
  buildCheckoutIdempotencyKey,
  buildCustomerIdempotencyKey,
  getStripeMode,
  getStripePriceIds,
  isStripeCheckoutEnabled,
  isPendingCheckoutReusable,
} from "@/lib/stripe-config";
import { Plan } from "@/types/user";
import Stripe from "stripe";
import { getCanonicalAppUrl, isJsonRequest, isTrustedMutationRequest } from "@/lib/http-security";

function isMissingStripeResource(error: unknown): boolean {
  return (
    error instanceof Stripe.errors.StripeInvalidRequestError &&
    error.code === "resource_missing"
  );
}

export async function POST(req: NextRequest) {
  if (!isTrustedMutationRequest(req) || !isJsonRequest(req)) {
    return NextResponse.json({ error: "Untrusted request origin" }, { status: 403 });
  }
  const session = await getServerSession(authOptions);

  if (!session?.user?.email) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  if (!isStripeCheckoutEnabled()) {
    return NextResponse.json(
      { error: "Checkout is temporarily unavailable" },
      { status: 503 }
    );
  }

  const body = await req.json().catch(() => null);
  const plan = body?.plan as Plan | undefined;

  if (plan !== "pro" && plan !== "premium") {
    return NextResponse.json({ error: "Invalid plan" }, { status: 400 });
  }
  const prices = getStripePriceIds();

  const supabase = getSupabaseAdmin();
  const { data: user, error: userError } = await supabase
    .from("users")
    .select("id, stripe_customer_id, stripe_mode, trial_used_at, stripe_checkout_session_id, stripe_checkout_expires_at")
    .eq("email", session.user.email)
    .single();

  if (userError || !user) {
    console.error("Checkout user lookup failed", userError);
    return NextResponse.json({ error: "Unable to load billing profile" }, { status: 500 });
  }

  const { data: checkoutIntentId, error: reservationError } = await supabase.rpc("reserve_billing_checkout", {
    target_user_id: user.id, target_provider: "stripe", target_plan: plan,
  });
  if (reservationError || !checkoutIntentId) {
    return NextResponse.json({ error: "An existing billing subscription or checkout must be resolved first" }, { status: 409 });
  }
  const releaseReservation = () => supabase.rpc("release_billing_checkout", {
    target_intent_id: checkoutIntentId, target_user_id: user.id,
  });

  // Get or create Stripe customer
  let customerId = user?.stripe_customer_id;
  const stripeMode = getStripeMode();

  if (customerId && user.stripe_mode === stripeMode) {
    try {
      await stripe.customers.retrieve(customerId);
    } catch (error: unknown) {
      if (!isMissingStripeResource(error)) throw error;
      customerId = null;
    }
  } else if (customerId) {
    customerId = null;
  }

  if (!customerId) {
    const customer = await stripe.customers.create(
      {
        email: session.user.email,
        metadata: { source: "vp-strategy", userId: user.id },
      },
      { idempotencyKey: buildCustomerIdempotencyKey(user.id, stripeMode) }
    );
    customerId = customer.id;

    const { error: customerUpdateError } = await supabase
      .from("users")
      .update({
        stripe_customer_id: customerId,
        stripe_subscription_id: null,
        stripe_mode: stripeMode,
        stripe_checkout_session_id: null,
        stripe_checkout_expires_at: null,
      })
      .eq("email", session.user.email);

    if (customerUpdateError) {
      await releaseReservation();
      console.error("Stripe customer persistence failed", customerUpdateError);
      return NextResponse.json({ error: "Unable to save billing profile" }, { status: 500 });
    }
  }

  const { error: billingCustomerError } = await supabase
    .from("billing_customers")
    .upsert({
      user_id: user.id,
      provider: "stripe",
      provider_customer_id: customerId,
      mode: stripeMode,
      metadata: { source: "stripe_checkout" },
      updated_at: new Date().toISOString(),
    }, { onConflict: "provider,provider_customer_id" });
  if (billingCustomerError) {
    await releaseReservation();
    console.error("Generic billing customer persistence failed", billingCustomerError);
    return NextResponse.json({ error: "Unable to save billing profile" }, { status: 500 });
  }

  const subscriptions = await stripe.subscriptions.list({
    customer: customerId,
    status: "all",
    limit: 10,
  });
  const existingSubscription = subscriptions.data.find(
    (item) => !["canceled", "incomplete_expired"].includes(item.status)
  );

  if (existingSubscription) {
    await releaseReservation();
    return NextResponse.json(
      {
        error:
          "Direct plan changes are not supported. Cancel the current subscription and subscribe to another plan after it ends.",
      },
      { status: 409 }
    );
  }

  if (
    user.stripe_mode === stripeMode &&
    user.stripe_customer_id === customerId &&
    user.stripe_checkout_session_id &&
    user.stripe_checkout_expires_at &&
    new Date(user.stripe_checkout_expires_at).getTime() > Date.now()
  ) {
    try {
      const pendingSession = await stripe.checkout.sessions.retrieve(
        user.stripe_checkout_session_id
      );
      const pendingCustomer =
        typeof pendingSession.customer === "string"
          ? pendingSession.customer
          : pendingSession.customer?.id;
      if (
        pendingCustomer === customerId &&
        isPendingCheckoutReusable(
          pendingSession.status ?? "expired",
          pendingSession.url,
          pendingSession.expires_at
        )
      ) {
        if (pendingSession.metadata?.plan !== plan) {
          await releaseReservation();
          return NextResponse.json(
            {
              error: "A Checkout Session for another plan is already open",
              pendingPlan: pendingSession.metadata?.plan ?? null,
              url: pendingSession.url,
            },
            { status: 409 }
          );
        }
        const { data: attached } = await supabase.rpc("attach_billing_checkout", {
          target_intent_id: checkoutIntentId, target_user_id: user.id,
          target_external_reference: pendingSession.id,
        });
        if (!attached) return NextResponse.json({ error: "Unable to reserve Checkout Session" }, { status: 500 });
        return NextResponse.json({ url: pendingSession.url, reusedSession: true });
      }
    } catch (error: unknown) {
      if (!isMissingStripeResource(error)) throw error;
    }

    const { error: clearPendingError } = await supabase
      .from("users")
      .update({ stripe_checkout_session_id: null, stripe_checkout_expires_at: null })
      .eq("id", user.id);
    if (clearPendingError) throw clearPendingError;
  }

  // Create checkout session
  const expiresAt = Math.floor(Date.now() / 1000) + 30 * 60;
  let checkoutSession: Awaited<ReturnType<typeof stripe.checkout.sessions.create>>;
  try {
    checkoutSession = await stripe.checkout.sessions.create({
    customer: customerId,
    mode: "subscription",
    payment_method_types: ["card"],
    line_items: [
      {
        price: prices[plan],
        quantity: 1,
      },
    ],
    subscription_data: {
      metadata: { plan, userId: user.id },
    },
    success_url: `${getCanonicalAppUrl()}/account?session_id={CHECKOUT_SESSION_ID}`,
    cancel_url: `${getCanonicalAppUrl()}/pricing`,
    expires_at: expiresAt,
    metadata: {
      plan,
      userId: user.id,
      userEmail: session.user.email,
    },
    }, { idempotencyKey: buildCheckoutIdempotencyKey(user.id) });
  } catch (error) {
    await releaseReservation();
    throw error;
  }

  const { data: attached, error: attachError } = await supabase.rpc("attach_billing_checkout", {
    target_intent_id: checkoutIntentId, target_user_id: user.id,
    target_external_reference: checkoutSession.id,
  });
  if (attachError || !attached) {
    await stripe.checkout.sessions.expire(checkoutSession.id).catch(() => undefined);
    await releaseReservation();
    return NextResponse.json({ error: "Unable to reserve Checkout Session" }, { status: 500 });
  }

  const { error: pendingUpdateError } = await supabase
    .from("users")
    .update({
      stripe_checkout_session_id: checkoutSession.id,
      stripe_checkout_expires_at: new Date(expiresAt * 1000).toISOString(),
    })
    .eq("id", user.id);

  if (pendingUpdateError) {
    await stripe.checkout.sessions.expire(checkoutSession.id).catch(() => undefined);
    throw pendingUpdateError;
  }

  return NextResponse.json({ url: checkoutSession.url });
}
