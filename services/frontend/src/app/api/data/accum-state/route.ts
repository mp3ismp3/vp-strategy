import { NextResponse } from "next/server";
import { sanitizeAccumulationForPlan } from "@/lib/data-entitlement";
import { getServerPlan } from "@/lib/server-entitlement";
import { getSupabaseAdmin } from "@/lib/supabase";
import { serviceUnavailable } from "@/lib/api-response";

interface AccumulationInfo {
  decay_score?: number;
  failing?: boolean;
  phase?: string;
  raw_score?: number;
  resistance?: number;
  support_dynamic?: number;
  support_primary?: number;
  tier?: string;
  triggers_fired?: unknown[];
}

export async function GET() {
  const plan = await getServerPlan();
  if (!plan) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  try {
    const { data: rows, error } = await getSupabaseAdmin()
      .from("accum_data")
      .select("ticker, state");
    if (error) {
      return serviceUnavailable("DATA_SOURCE_UNAVAILABLE", "Accumulation data is temporarily unavailable", error);
    }
    if (!rows) {
      return NextResponse.json({ states: [], error: "Accumulation data not found" }, { status: 404 });
    }

    // 轉換 dict → array
    const states = sanitizeAccumulationForPlan(rows.map((row) => {
      const info = (row.state || {}) as AccumulationInfo & { pending_triggers?: unknown[] };
      return {
      ticker: row.ticker,
      phase: info.phase || "UNKNOWN",
      tier: info.tier || "watch",
      decay_score: info.decay_score || 0,
      raw_score: info.raw_score || 0,
      support_primary: info.support_primary || 0,
      support_dynamic: info.support_dynamic || 0,
      resistance: info.resistance || 0,
      failing: info.failing || false,
      triggers_fired: info.triggers_fired || [],
      pending_triggers: info.pending_triggers || [],
    };}), plan);

    return NextResponse.json({ states, accessPlan: plan });
  } catch (error: unknown) {
    return serviceUnavailable("DATA_SOURCE_UNAVAILABLE", "Accumulation data is temporarily unavailable", error);
  }
}
