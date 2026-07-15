import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { getSupabaseAdmin } from "@/lib/supabase";
import crypto from "crypto";

export async function POST() {
  const session = await getServerSession(authOptions);

  if (!session?.user?.email) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  // Generate a short-lived bind token
  const token = crypto.randomBytes(16).toString("hex");
  const expiresAt = new Date(Date.now() + 10 * 60 * 1000).toISOString(); // 10 min

  const supabase = getSupabaseAdmin();

  // Store token in a telegram_bind_tokens table (or use a simple approach)
  await supabase.from("telegram_bind_tokens").upsert(
    {
      email: session.user.email,
      token,
      expires_at: expiresAt,
    },
    { onConflict: "email" }
  );

  return NextResponse.json({ token });
}
