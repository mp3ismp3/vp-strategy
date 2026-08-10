import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { getSupabaseAdmin } from "@/lib/supabase";
import crypto from "crypto";
import { getServerPlan } from "@/lib/server-entitlement";
import { isTrustedMutationRequest } from "@/lib/http-security";

export async function POST(request: Request) {
  if (!isTrustedMutationRequest(request)) {
    return NextResponse.json({ error: "Untrusted request origin" }, { status: 403 });
  }
  const session = await getServerSession(authOptions);

  if (!session?.user?.email) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (await getServerPlan() !== "premium") {
    return NextResponse.json({ error: "Premium subscription required" }, { status: 403 });
  }

  // Generate a short-lived bind token
  const token = crypto.randomBytes(16).toString("hex");
  const expiresAt = new Date(Date.now() + 10 * 60 * 1000).toISOString(); // 10 min

  const supabase = getSupabaseAdmin();

  // Store token in a telegram_bind_tokens table (or use a simple approach)
  const { error } = await supabase.from("telegram_bind_tokens").upsert(
    {
      email: session.user.email,
      token,
      expires_at: expiresAt,
    },
    { onConflict: "email" }
  );
  if (error) {
    return NextResponse.json({ error: "Unable to create Telegram bind token" }, { status: 500 });
  }

  return NextResponse.json({ token });
}
