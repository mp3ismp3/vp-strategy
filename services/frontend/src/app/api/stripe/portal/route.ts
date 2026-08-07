import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { stripe } from "@/lib/stripe";
import { getSupabaseAdmin } from "@/lib/supabase";
import {
  getStripeMode,
  getStripePortalConfigurationId,
} from "@/lib/stripe-config";

export async function POST() {
  const session = await getServerSession(authOptions);

  if (!session?.user?.email) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const supabase = getSupabaseAdmin();
  const { data: user, error } = await supabase
    .from("users")
    .select("id, stripe_customer_id, stripe_mode")
    .eq("email", session.user.email)
    .single();

  if (error) {
    console.error("Billing portal user lookup failed", error);
    return NextResponse.json({ error: "Unable to load billing profile" }, { status: 500 });
  }

  const stripeMode = getStripeMode();
  const { data: billingCustomer } = user
    ? await supabase
        .from("billing_customers")
        .select("provider_customer_id, mode")
        .eq("user_id", user.id)
        .eq("provider", "stripe")
        .eq("mode", stripeMode)
        .maybeSingle()
    : { data: null };
  const customerId = billingCustomer?.provider_customer_id ?? user?.stripe_customer_id;
  const customerMode = billingCustomer?.mode ?? user?.stripe_mode;
  if (!customerId || customerMode !== stripeMode) {
    return NextResponse.json({ error: "No subscription found" }, { status: 400 });
  }

  const portalSession = await stripe.billingPortal.sessions.create({
    configuration: getStripePortalConfigurationId(),
    customer: customerId,
    return_url: `${process.env.NEXT_PUBLIC_APP_URL}/account`,
  });

  return NextResponse.json({ url: portalSession.url });
}
