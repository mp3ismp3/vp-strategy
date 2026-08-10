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
import { minimizeBillingEventPayload } from "@/lib/billing-event";
import { PayloadTooLargeError, readRequestBodyWithLimit } from "@/lib/http-security";

type SupabaseAdmin = ReturnType<typeof getSupabaseAdmin>;
interface CancellationNotice {
  telegramUserId: number;
}
interface WebhookResult {
  notice: CancellationNotice | null;
  completedAtomically: boolean;
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
  subscription: Stripe.Subscription,
  eventId: string
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
  const { error: billingError } = await supabase.rpc("sync_stripe_subscription", {
    target_user_id: userId,
    stripe_customer: customerId,
    stripe_subscription: subscription.id,
    stripe_plan: snapshot.plan,
    stripe_amount: price?.unit_amount ?? 0,
    stripe_currency: (price?.currency ?? "usd").toUpperCase(),
    stripe_interval: billingInterval,
    stripe_status: snapshot.subscriptionStatus,
    stripe_period_end: snapshot.currentPeriodEnd,
    stripe_cancel_at_period_end: subscription.cancel_at_period_end,
    stripe_price_id: price?.id ?? null,
    stripe_trial_start: snapshot.trialStart,
    stripe_trial_end: snapshot.trialEnd,
    stripe_mode_value: getStripeMode(),
    stripe_event_id: eventId,
  });
  if (billingError) throw billingError;
  const { data: user, error } = await supabase.from("users")
    .select("id, telegram_user_id").eq("id", userId).single();
  if (error || !user) throw error ?? new Error(`No user mapped to Stripe customer ${customerId}`);
  return user;
}

async function retrieveAndSyncSubscription(
  supabase: SupabaseAdmin,
  subscriptionId: string,
  eventId: string
) {
  const subscription = await stripe.subscriptions.retrieve(subscriptionId);
  return syncSubscription(supabase, subscription, eventId);
}

async function handleWebhookEvent(
  supabase: SupabaseAdmin,
  event: Stripe.Event
): Promise<WebhookResult> {
  switch (event.type) {
    case "checkout.session.completed": {
      const session = event.data.object as Stripe.Checkout.Session;
      if (typeof session.subscription !== "string") {
        throw new Error("Checkout session is missing a subscription ID");
      }
      await retrieveAndSyncSubscription(supabase, session.subscription, event.id);
      return { notice: null, completedAtomically: true };
    }

    case "customer.subscription.created":
    case "customer.subscription.updated": {
      const subscription = event.data.object as Stripe.Subscription;
      await retrieveAndSyncSubscription(supabase, subscription.id, event.id);
      return { notice: null, completedAtomically: true };
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
        await syncSubscription(supabase, replacement, event.id);
        return { notice: null, completedAtomically: true };
      }

      const { error: billingUpdateError } = await supabase.rpc("cancel_stripe_subscription", {
        target_user_id: user.id,
        stripe_subscription: subscription.id,
        stripe_event_id: event.id,
      });
      if (billingUpdateError) throw billingUpdateError;

      return {
        notice: user.telegram_user_id ? { telegramUserId: user.telegram_user_id } : null,
        completedAtomically: true,
      };
    }

    case "invoice.paid":
    case "invoice.payment_failed":
    case "invoice.payment_action_required": {
      const subscriptionId = getInvoiceSubscriptionId(event.data.object as Stripe.Invoice);
      if (subscriptionId) {
        await retrieveAndSyncSubscription(supabase, subscriptionId, event.id);
        return { notice: null, completedAtomically: true };
      }
      return { notice: null, completedAtomically: false };
    }

    case "customer.subscription.trial_will_end":
      return { notice: null, completedAtomically: false };
  }
  return { notice: null, completedAtomically: false };
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
  let body: string;
  try {
    body = await readRequestBodyWithLimit(req, 256 * 1024);
  } catch (error) {
    if (error instanceof PayloadTooLargeError) {
      return NextResponse.json({ error: "Payload too large" }, { status: 413 });
    }
    throw error;
  }
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
    const claim = await claimWebhookEvent(supabase, event.id, event.type, minimizeBillingEventPayload(event));
    if (claim === "processed") {
      return NextResponse.json({ received: true, duplicate: true });
    }
    if (claim === "busy") {
      return NextResponse.json({ error: "Webhook event is still processing" }, { status: 409 });
    }

    const result = await handleWebhookEvent(supabase, event);
    if (!result.completedAtomically) await markWebhookProcessed(supabase, event.id);
    await sendCancellationNotice(result.notice);
    return NextResponse.json({ received: true });
  } catch (error: unknown) {
    console.error("Stripe webhook processing failed", error);
    await markWebhookFailed(supabase, event.id, error);
    return NextResponse.json({ error: "Webhook processing failed" }, { status: 500 });
  }
}
