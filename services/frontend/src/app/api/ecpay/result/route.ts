import { NextResponse } from "next/server";

import { getEcpayConfig, formDataToFields, verifyEcpayCallback } from "@/lib/ecpay";

export async function POST(request: Request) {
  const fields = formDataToFields(await request.formData());
  const valid = verifyEcpayCallback(fields, getEcpayConfig());
  const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? new URL(request.url).origin;
  return NextResponse.redirect(`${appUrl}/account?payment=${valid && fields.RtnCode === "1" ? "success" : "failed"}`, 303);
}
