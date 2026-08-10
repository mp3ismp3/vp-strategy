import { getServerSession } from "next-auth";
import { NextResponse } from "next/server";

import { authOptions } from "@/lib/auth";
import { processEcpayCancellation } from "@/lib/ecpay-cancel";
import { isTrustedMutationRequest } from "@/lib/http-security";
import { getSupabaseAdmin } from "@/lib/supabase";

function isAdmin(email: string): boolean {
  return (process.env.ADMIN_EMAILS || "").split(",")
    .map((item) => item.trim().toLowerCase()).filter(Boolean)
    .includes(email.toLowerCase());
}

export async function POST(request: Request) {
  if (!isTrustedMutationRequest(request)) {
    return NextResponse.json({ error: "Untrusted request origin" }, { status: 403 });
  }
  const session = await getServerSession(authOptions);
  if (!session?.user?.email || !isAdmin(session.user.email)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const supabase = getSupabaseAdmin();
  const { data: intents, error } = await supabase.from("billing_cancel_outbox")
    .select("id, provider_order_id")
    .in("status", ["pending", "failed", "processing", "provider_succeeded"])
    .lte("next_attempt_at", new Date().toISOString())
    .order("created_at", { ascending: true }).limit(25);
  if (error) return NextResponse.json({ error: "Unable to load cancellation retries" }, { status: 500 });
  const results = [];
  for (const intent of intents ?? []) {
    const { data: claimed } = await supabase.rpc("claim_ecpay_cancel_intent", {
      target_intent_id: intent.id,
    });
    if (!claimed) continue;
    try {
      await processEcpayCancellation({ supabase, intentId: intent.id, providerOrderId: intent.provider_order_id });
      results.push({ id: intent.id, status: "completed" });
    } catch {
      results.push({ id: intent.id, status: "retry_scheduled" });
    }
  }
  return NextResponse.json({ processed: results.length, results });
}
