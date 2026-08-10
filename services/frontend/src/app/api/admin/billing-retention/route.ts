import { getServerSession } from "next-auth";
import { NextResponse } from "next/server";

import { authOptions } from "@/lib/auth";
import { isJsonRequest, isTrustedMutationRequest } from "@/lib/http-security";
import { getSupabaseAdmin } from "@/lib/supabase";

function isAdmin(email: string): boolean {
  return (process.env.ADMIN_EMAILS || "").split(",")
    .map((item) => item.trim().toLowerCase()).filter(Boolean)
    .includes(email.toLowerCase());
}

export async function POST(request: Request) {
  if (!isTrustedMutationRequest(request) || !isJsonRequest(request)) {
    return NextResponse.json({ error: "Untrusted request origin" }, { status: 403 });
  }
  const session = await getServerSession(authOptions);
  if (!session?.user?.email || !isAdmin(session.user.email)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const body = await request.json().catch(() => ({})) as { retentionDays?: unknown };
  const retentionDays = body.retentionDays === undefined ? 90 : Number(body.retentionDays);
  if (!Number.isInteger(retentionDays) || retentionDays < 30 || retentionDays > 365) {
    return NextResponse.json({ error: "retentionDays must be between 30 and 365" }, { status: 400 });
  }
  const { data, error } = await getSupabaseAdmin().rpc("purge_expired_billing_events", {
    retention_days: retentionDays,
  });
  if (error) return NextResponse.json({ error: "Unable to purge billing events" }, { status: 500 });
  return NextResponse.json({ removed: data, retentionDays });
}
