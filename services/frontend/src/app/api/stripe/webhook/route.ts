import { NextRequest, NextResponse } from "next/server";
import Stripe from "stripe";

import { stripe } from "@/lib/stripe";
import {
  findReplacementSubscription,
  getStripeMode,
  getSubscriptionSnapshot,
} from "@/lib/stripe-config";
import { getSupabaseAdmin } from "@/lib/supabase";
import {
  claimWebhookEvent,
  markWebhookFailed,
  markWebhookProcessed,
} from "@/lib/stripe-webhook";

type SupabaseAdmin = ReturnType<typeof getSupabaseAdmin>;
interface CancellationNotice {
  telegramUserId: number;
}

function getInvoiceSubscriptionId(invoice: Stripe.Invoice): string | null {
  const compatibleInvoice = invoice as Stripe.Invoice & {
    subscription?: string | Stripe.Subscription | null;
    parent?: {
      subscription_details?: {
        subscription?: string | Stripe.Subscription | null;
      } | null;
    } | null;
  };
  const subscription =
    compatibleInvoice.subscription ??
    compatibleInvoice.parent?.subscription_details?.subscription;
  if (!subscription) return null;
  return typeof subscription === "string" ? subscription : subscription.id;
}

async function syncSubscription(
  supabase: SupabaseAdmin,
  subscription: Stripe.Subscription
) {
  const customerId =
    typeof subscription.customer === "string"
      ? subscription.customer
      : subscription.customer.id;
  const snapshot = getSubscriptionSnapshot(subscription);
  const { data: billingCustomer } = await supabase
    .from("billing_customers")
    .select("user_id")
    .eq("provider", "stripe")
    .eq("provider_customer_id", customerId)
    .maybeSingle();
  let userId = billingCustomer?.user_id as string | undefined;
  if (!userId) {
    const { data: legacyUser } = await supabase
      .from("users")
      .select("id")
      .eq("stripe_customer_id", customerId)
      .single();
    userId = legacyUser?.id;
  }
  if (!userId) throw new Error(`No user mapped to Stripe customer ${customerId}`);
  const { error: customerUpsertError } = await supabase
    .from("billing_customers")
    .upsert({
      user_id: userId,
      provider: "stripe",
      provider_customer_id: customerId,
      mode: getStripeMode(),
      metadata: { source: "stripe_webhook" },
      updated_at: new Date().toISOString(),
    }, { onConflict: "provider,provider_customer_id" });
  if (customerUpsertError) throw customerUpsertError;
  const price = subscription.items.data[0]?.price;
  const interval = price?.recurring?.interval;
  const billingInterval = interval === "day" || interval === "year" ? interval : "month";
  const { error: billingError } = await supabase
    .from("billing_subscriptions")
    .upsert({
      user_id: userId,
      provider: "stripe",
      provider_customer_id: customerId,
      provider_subscription_id: subscription.id,
      provider_order_id: null,
      plan: snapshot.plan,
      amount: price?.unit_amount ?? 0,
      currency: (price?.currency ?? "usd").toUpperCase(),
      billing_interval: billingInterval,
      status: snapshot.subscriptionStatus,
      current_period_end: snapshot.currentPeriodEnd,
      cancel_at_period_end: subscription.cancel_at_period_end,
      metadata: { priceId: price?.id ?? null },
      updated_at: new Date().toISOString(),
    }, { onConflict: "provider,provider_subscription_id" });
  if (billingError) throw billingError;
  const update = {
    stripe_subscription_id: snapshot.stripeSubscriptionId,
    plan: snapshot.plan,
    subscription_status: snapshot.subscriptionStatus,
    trial_start: snapshot.trialStart,
    trial_end: snapshot.trialEnd,
    ...(snapshot.trialStart ? { trial_used_at: snapshot.trialStart } : {}),
    current_period_end: snapshot.currentPeriodEnd,
    cancel_at_period_end: subscription.cancel_at_period_end,
    stripe_checkout_session_id: null,
    stripe_checkout_expires_at: null,
    updated_at: new Date().toISOString(),
  };
  const { data: user, error } = await supabase
    .from("users")
    .update(update)
    .eq("id", userId)
    .select("id, telegram_user_id")
    .single();

  if (error || !user) {
    throw error ?? new Error(`No user mapped to Stripe customer ${customerId}`);
  }
  return user;
}

async function retrieveAndSyncSubscription(
  supabase: SupabaseAdmin,
  subscriptionId: string
) {
  const subscription = await stripe.subscriptions.retrieve(subscriptionId);
  return syncSubscription(supabase, subscription);
}

async function handleWebhookEvent(
  supabase: SupabaseAdmin,
  event: Stripe.Event
): Promise<CancellationNotice | null> {
  switch (event.type) {
    case "checkout.session.completed": {
      const session = event.data.object as Stripe.Checkout.Session;
      if (typeof session.subscription !== "string") {
        throw new Error("Checkout session is missing a subscription ID");
      }
      await retrieveAndSyncSubscription(supabase, session.subscription);
      return null;
    }

    case "customer.subscription.created":
    case "customer.subscription.updated": {
      const subscription = event.data.object as Stripe.Subscription;
      await retrieveAndSyncSubscription(supabase, subscription.id);
      return null;
    }

    case "customer.subscription.deleted": {
      const subscription = event.data.object as Stripe.Subscription;
      const customerId =
        typeof subscription.customer === "string"
          ? subscription.customer
          : subscription.customer.id;
      const { data: mappedCustomer } = await supabase
        .from("billing_customers")
        .select("user_id")
        .eq("provider", "stripe")
        .eq("provider_customer_id", customerId)
        .maybeSingle();
      let userQuery = supabase.from("users").select("id, telegram_user_id");
      userQuery = mappedCustomer?.user_id
        ? userQuery.eq("id", mappedCustomer.user_id)
        : userQuery.eq("stripe_customer_id", customerId);
      const { data: user, error: lookupError } = await userQuery.single();
      if (lookupError || !user) throw lookupError ?? new Error("Subscription user not found");

      const subscriptions = await stripe.subscriptions.list({
        customer: customerId,
        status: "all",
        limit: 100,
      });
      const replacement = findReplacementSubscription(
        subscriptions.data,
        subscription.id
      );
      if (replacement) {
        await syncSubscription(supabase, replacement);
        return null;
      }

      const { error: updateError } = await supabase
        .from("users")
        .update({
          plan: "free",
          subscription_status: "canceled",
          current_period_end: null,
          stripe_checkout_session_id: null,
          stripe_checkout_expires_at: null,
          updated_at: new Date().toISOString(),
        })
        .eq("id", user.id);
      if (updateError) throw updateError;
      const { error: billingUpdateError } = await supabase
        .from("billing_subscriptions")
        .update({ status: "canceled", current_period_end: null, updated_at: new Date().toISOString() })
        .eq("provider", "stripe")
        .eq("provider_subscription_id", subscription.id);
      if (billingUpdateError) throw billingUpdateError;

      return user.telegram_user_id
        ? { telegramUserId: user.telegram_user_id }
        : null;
    }

    case "invoice.paid":
    case "invoice.payment_failed":
    case "invoice.payment_action_required": {
      const subscriptionId = getInvoiceSubscriptionId(event.data.object as Stripe.Invoice);
      if (subscriptionId) await retrieveAndSyncSubscription(supabase, subscriptionId);
      return null;
    }

    case "customer.subscription.trial_will_end":
      return null;
  }
  return null;
}

async function sendCancellationNotice(notice: CancellationNotice | null) {
  if (!notice || !process.env.TELEGRAM_BOT_TOKEN) return;
  try {
    const response = await fetch(
      `https://api.telegram.org/bot${process.env.TELEGRAM_BOT_TOKEN}/sendMessage`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          chat_id: notice.telegramUserId,
          text:
            "📢 你的訂閱已結束，通知已暫停。\n\n" +
            `隨時可到網站重新訂閱：${process.env.NEXT_PUBLIC_APP_URL}/pricing`,
        }),
      }
    );
    if (!response.ok) console.error("Subscription cancellation Telegram notification failed");
  } catch (error: unknown) {
    console.error("Subscription cancellation Telegram notification failed", error);
  }
}

export async function POST(req: NextRequest) {
  const body = await req.text();
  const signature = req.headers.get("stripe-signature");
  if (!signature) {
    return NextResponse.json({ error: "Missing signature" }, { status: 400 });
  }

  let event: Stripe.Event;
  try {
    event = stripe.webhooks.constructEvent(
      body,
      signature,
      process.env.STRIPE_WEBHOOK_SECRET!
    );
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "Unknown signature error";
    console.error("Webhook signature verification failed:", message);
    return NextResponse.json({ error: "Invalid signature" }, { status: 400 });
  }

  const supabase = getSupabaseAdmin();
  try {
    const claim = await claimWebhookEvent(supabase, event.id, event.type, event);
    if (claim === "processed") {
      return NextResponse.json({ received: true, duplicate: true });
    }
    if (claim === "busy") {
      return NextResponse.json({ error: "Webhook event is still processing" }, { status: 409 });
    }

    const cancellationNotice = await handleWebhookEvent(supabase, event);
    await markWebhookProcessed(supabase, event.id);
    await sendCancellationNotice(cancellationNotice);
    return NextResponse.json({ received: true });
  } catch (error: unknown) {
    console.error("Stripe webhook processing failed", error);
    await markWebhookFailed(supabase, event.id, error);
    return NextResponse.json({ error: "Webhook processing failed" }, { status: 500 });
  }
}
