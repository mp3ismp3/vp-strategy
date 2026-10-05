import { NextResponse } from "next/server";
import type { Trigger } from "@/lib/triggers";
import {
  getFreshActionableTriggers,
  getFusionActionability,
  getFusionConfidence,
  getFusionRedFlags,
  getMacroDirection,
  isFusionDataFresh,
} from "@/lib/fusion-policy";
import { getServerPlan } from "@/lib/server-entitlement";
import { getSupabaseAdmin } from "@/lib/supabase";
import { serviceUnavailable } from "@/lib/api-response";

interface VPFrame {
  position?: string;
  position_pct?: number;
}

interface VPInfo {
  daily?: VPFrame;
  monthly?: VPFrame;
  price?: number;
  weekly?: VPFrame;
}

interface AccumulationInfo {
  decay_score?: number;
  failing?: boolean;
  phase?: string;
  raw_score?: number;
  resistance?: number;
  raw_history?: number[];
  support_primary?: number;
  tier?: string;
  triggers_fired?: Trigger[];
  last_updated?: string;
}

interface FusionSignal {
  decay_score: number;
  stars: number;
  [key: string]: unknown;
}

export async function GET() {
  const plan = await getServerPlan();
  if (!plan) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (plan !== "premium") {
    return NextResponse.json({ error: "Premium subscription required" }, { status: 403 });
  }
  try {
    const supabase = getSupabaseAdmin();

    // Fetch scan data
    const { data: scanRow, error: scanError } = await supabase
      .from("scan_data")
      .select("vp_data, market_ctx, scan_time, updated_at")
      .eq("id", "latest")
      .maybeSingle();

    // Fetch accum data
    const { data: accumRows, error: accumError } = await supabase
      .from("accum_data")
      .select("ticker, state, updated_at");

    if (scanError || accumError) {
      return serviceUnavailable(
        "DATA_SOURCE_UNAVAILABLE",
        "Fusion data is temporarily unavailable",
        scanError || accumError
      );
    }
    if (!scanRow || !accumRows) {
      return NextResponse.json({ signals: [], error: "No data" }, { status: 404 });
    }

    const vpData = (scanRow.vp_data || {}) as Record<string, VPInfo>;
    const accumState: Record<string, AccumulationInfo> = {};
    for (const row of accumRows) {
      accumState[row.ticker] = { ...(row.state as AccumulationInfo), last_updated: row.state?.last_updated || row.updated_at };
    }

    const signals: FusionSignal[] = [];

    for (const [symbol, accumInfo] of Object.entries(accumState)) {
      if (!accumInfo || typeof accumInfo !== "object") continue;

      const phase = accumInfo.phase || "UNKNOWN";
      const vp = vpData[symbol];
      if (!vp) continue;

      const dailyPos = vp.daily?.position || "inside_va";
      const dailyPct = vp.daily?.position_pct || 50;
      const macro = getMacroDirection(vp.weekly?.position, vp.monthly?.position);

      const confidence = getFusionConfidence(phase, dailyPos);
      const redFlags = getFusionRedFlags({
        phase, dailyPosition: dailyPos, dailyPositionPct: dailyPct,
        macroDirection: macro, rawHistory: accumInfo.raw_history,
      });

      let effectiveStars = confidence.stars;
      if (redFlags.length > 0) effectiveStars = Math.min(effectiveStars, 2);
      if (accumInfo.failing) effectiveStars = 0;
      if (macro === "bullish" && ["C", "D", "E"].includes(phase)) {
        effectiveStars = Math.min(5, effectiveStars + 1);
      } else if (macro === "bearish" && ["A", "B"].includes(phase)) {
        effectiveStars = Math.max(0, effectiveStars - 1);
      }

      const triggers = accumInfo.triggers_fired || [];
      const freshTriggers = getFreshActionableTriggers(triggers, scanRow.scan_time);
      const dataFresh = isFusionDataFresh(scanRow.scan_time, accumInfo.last_updated);
      const actionability = getFusionActionability({
        tier: accumInfo.tier, failing: accumInfo.failing, dataFresh, freshTriggers, redFlags,
      });

      signals.push({
        symbol,
        phase,
        tier: accumInfo.tier || "watch",
        decay_score: accumInfo.decay_score || 0,
        raw_score: accumInfo.raw_score || 0,
        daily_position: dailyPos,
        daily_position_pct: dailyPct,
        weekly_position: vp.weekly?.position || "—",
        monthly_position: vp.monthly?.position || "—",
        macro_direction: macro,
        stars: effectiveStars,
        label: confidence.label,
        action: confidence.action,
        triggers_fired: triggers,
        fresh_triggers: freshTriggers,
        red_flags: redFlags,
        data_fresh: dataFresh,
        actionable: actionability.actionable,
        actionability_reasons: actionability.reasons,
        price: vp.price,
        support: accumInfo.support_primary,
        resistance: accumInfo.resistance,
      });
    }

    signals.sort((a, b) => b.stars - a.stars || b.decay_score - a.decay_score);

    return NextResponse.json({ signals, scan_time: scanRow.scan_time });
  } catch (error: unknown) {
    return serviceUnavailable("DATA_SOURCE_UNAVAILABLE", "Fusion data is temporarily unavailable", error);
  }
}
