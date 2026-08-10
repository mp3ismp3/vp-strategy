import { getEcpayConfig, verifyEcpayCallback } from "@/lib/ecpay";
import { applyEcpayCallback } from "@/lib/ecpay-callback";
import { getSupabaseAdmin } from "@/lib/supabase";
import { PayloadTooLargeError, readRequestBodyWithLimit } from "@/lib/http-security";

export async function POST(request: Request) {
  let raw: string;
  try {
    raw = await readRequestBodyWithLimit(request, 64 * 1024);
  } catch (error) {
    if (error instanceof PayloadTooLargeError) return new Response("0|Payload too large", { status: 413 });
    throw error;
  }
  const fields = Object.fromEntries(new URLSearchParams(raw));
  if (!verifyEcpayCallback(fields, getEcpayConfig())) return new Response("0|Invalid CheckMacValue", { status: 400 });
  try {
    await applyEcpayCallback(getSupabaseAdmin(), fields);
    return new Response("1|OK");
  } catch (error) {
    console.error("ECPay callback processing failed", error);
    return new Response("0|Error", { status: 500 });
  }
}
