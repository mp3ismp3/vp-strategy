import { NextResponse } from "next/server";

import { getEcpayConfig, verifyEcpayCallback } from "@/lib/ecpay";
import { getCanonicalAppUrl, PayloadTooLargeError, readRequestBodyWithLimit } from "@/lib/http-security";

export async function POST(request: Request) {
  let raw: string;
  try {
    raw = await readRequestBodyWithLimit(request, 64 * 1024);
  } catch (error) {
    if (error instanceof PayloadTooLargeError) return NextResponse.json({ error: "Payload too large" }, { status: 413 });
    throw error;
  }
  const fields = Object.fromEntries(new URLSearchParams(raw));
  const valid = verifyEcpayCallback(fields, getEcpayConfig());
  const appUrl = getCanonicalAppUrl();
  return NextResponse.redirect(`${appUrl}/account?payment=${valid && fields.RtnCode === "1" ? "success" : "failed"}`, 303);
}
