import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { stripe } from "@/lib/stripe";
import { getSupabaseAdmin } from "@/lib/supabase";
import { getStripeMode } from "@/lib/stripe-config";

export async function POST() {
  const session = await getServerSession(authOptions);

  if (!session?.user?.email) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const supabase = getSupabaseAdmin();
  const { data: user, error } = await supabase
    .from("users")
    .select("stripe_customer_id, stripe_mode")
    .eq("email", session.user.email)
    .single();

  if (error) {
    console.error("Billing portal user lookup failed", error);
    return NextResponse.json({ error: "Unable to load billing profile" }, { status: 500 });
  }

  if (!user?.stripe_customer_id || user.stripe_mode !== getStripeMode()) {
    return NextResponse.json({ error: "No subscription found" }, { status: 400 });
  }

  const portalSession = await stripe.billingPortal.sessions.create({
    customer: user.stripe_customer_id,
    return_url: `${process.env.NEXT_PUBLIC_APP_URL}/account`,
  });

  return NextResponse.json({ url: portalSession.url });
}
