import { NextRequest, NextResponse } from "next/server";
import Stripe from "stripe";

import { stripe } from "@/lib/stripe";
import {
  findReplacementSubscription,
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
  const update = {
    stripe_subscription_id: snapshot.stripeSubscriptionId,
    plan: snapshot.plan,
    subscription_status: snapshot.subscriptionStatus,
    trial_start: snapshot.trialStart,
    trial_end: snapshot.trialEnd,
    ...(snapshot.trialStart ? { trial_used_at: snapshot.trialStart } : {}),
    current_period_end: snapshot.currentPeriodEnd,
    stripe_checkout_session_id: null,
    stripe_checkout_expires_at: null,
    updated_at: new Date().toISOString(),
  };
  const { data: user, error } = await supabase
    .from("users")
    .update(update)
    .eq("stripe_customer_id", customerId)
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
      const { data: user, error: lookupError } = await supabase
        .from("users")
        .select("id, telegram_user_id")
        .eq("stripe_customer_id", customerId)
        .single();
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
