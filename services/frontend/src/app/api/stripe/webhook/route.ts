import { NextRequest, NextResponse } from "next/server";
import { stripe } from "@/lib/stripe";
import { getSupabaseAdmin } from "@/lib/supabase";
import Stripe from "stripe";

export async function POST(req: NextRequest) {
  const body = await req.text();
  const sig = req.headers.get("stripe-signature");

  if (!sig) {
    return NextResponse.json({ error: "Missing signature" }, { status: 400 });
  }

  let event: Stripe.Event;

  try {
    event = stripe.webhooks.constructEvent(
      body,
      sig,
      process.env.STRIPE_WEBHOOK_SECRET!
    );
  } catch (err: any) {
    console.error("Webhook signature verification failed:", err.message);
    return NextResponse.json({ error: "Invalid signature" }, { status: 400 });
  }

  const supabase = getSupabaseAdmin();

  switch (event.type) {
    case "checkout.session.completed": {
      const session = event.data.object as Stripe.Checkout.Session;
      const customerEmail =
        session.customer_details?.email || session.metadata?.userEmail;
      const plan = session.metadata?.plan || "pro";

      if (customerEmail) {
        await supabase
          .from("users")
          .update({
            plan,
            stripe_customer_id: session.customer as string,
            stripe_subscription_id: session.subscription as string,
            subscription_status: "trialing",
            trial_start: new Date().toISOString(),
            trial_end: new Date(
              Date.now() + 7 * 24 * 60 * 60 * 1000
            ).toISOString(),
            updated_at: new Date().toISOString(),
          })
          .eq("email", customerEmail);

        // Log event
        await supabase.from("subscription_events").insert({
          user_id: null, // Will be matched by email
          event_type: "checkout_completed",
          stripe_event_id: event.id,
          payload: session as any,
        });
      }
      break;
    }

    case "customer.subscription.updated": {
      const subscription = event.data.object as Stripe.Subscription;
      const customerId = subscription.customer as string;

      await supabase
        .from("users")
        .update({
          subscription_status: subscription.status,
          current_period_end: new Date(
            subscription.current_period_end * 1000
          ).toISOString(),
          updated_at: new Date().toISOString(),
        })
        .eq("stripe_customer_id", customerId);

      break;
    }

    case "customer.subscription.deleted": {
      const subscription = event.data.object as Stripe.Subscription;
      const customerId = subscription.customer as string;

      // Get user's telegram_user_id before updating plan
      const { data: userBeforeUpdate } = await supabase
        .from("users")
        .select("telegram_user_id")
        .eq("stripe_customer_id", customerId)
        .single();

      await supabase
        .from("users")
        .update({
          plan: "free",
          subscription_status: "canceled",
          updated_at: new Date().toISOString(),
        })
        .eq("stripe_customer_id", customerId);

      // Send Telegram notification if user has bound their account
      if (userBeforeUpdate?.telegram_user_id && process.env.TELEGRAM_BOT_TOKEN) {
        await fetch(
          `https://api.telegram.org/bot${process.env.TELEGRAM_BOT_TOKEN}/sendMessage`,
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              chat_id: userBeforeUpdate.telegram_user_id,
              text: "📢 你的訂閱已結束，通知已暫停。\n\n隨時可到網站重新訂閱，恢復即時交易信號。\n👉 https://vp-strategy-nu.vercel.app/pricing",
            }),
          }
        );
      }

      // Log event
      await supabase.from("subscription_events").insert({
        event_type: "subscription_canceled",
        stripe_event_id: event.id,
        payload: subscription as any,
      });

      break;
    }

    case "invoice.payment_failed": {
      const invoice = event.data.object as Stripe.Invoice;
      const customerId = invoice.customer as string;

      await supabase
        .from("users")
        .update({
          subscription_status: "past_due",
          updated_at: new Date().toISOString(),
        })
        .eq("stripe_customer_id", customerId);

      break;
    }
  }

  return NextResponse.json({ received: true });
}
