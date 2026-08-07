import { getEcpayConfig, formDataToFields, verifyEcpayCallback } from "@/lib/ecpay";
import { applyEcpayCallback } from "@/lib/ecpay-callback";
import { getSupabaseAdmin } from "@/lib/supabase";

export async function POST(request: Request) {
  const fields = formDataToFields(await request.formData());
  if (!verifyEcpayCallback(fields, getEcpayConfig())) return new Response("0|Invalid CheckMacValue", { status: 400 });
  try {
    await applyEcpayCallback(getSupabaseAdmin(), fields);
    return new Response("1|OK");
  } catch (error) {
    console.error("ECPay callback processing failed", error);
    return new Response("0|Error", { status: 500 });
  }
}
