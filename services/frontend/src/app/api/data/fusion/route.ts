import { NextResponse } from "next/server";
import type { Trigger } from "@/lib/triggers";
import { getServerPlan } from "@/lib/server-entitlement";
import { getSupabaseAdmin } from "@/lib/supabase";

// Confidence matrix (replicated from fusion_report.py)
const CONFIDENCE_MATRIX: Record<string, { stars: number; label: string; action: string }> = {
  "B|below_va": { stars: 2, label: "吸籌+低位（觀察）", action: "觀察期，等 Phase C/D trigger 再入場" },
  "B|inside_va": { stars: 2, label: "吸籌中（觀察）", action: "觀察期，不急進，等結構明確" },
  "B|above_va": { stars: 0, label: "吸籌但價高", action: "❌ 不追，等回踩" },
  "C|below_va": { stars: 5, label: "⭐ 黃金入場區", action: "Spring 觸發 → PILOT BUY 10-25%" },
  "C|inside_va": { stars: 3, label: "Spring 幅度小", action: "可做但降 size，觀察是否回落" },
  "C|above_va": { stars: 0, label: "矛盾信號", action: "❌ Phase C 不該在 VA 上方，可能誤判" },
  "D|below_va": { stars: 3, label: "回踩好位", action: "LPS 觸發 → ADD 25-40%" },
  "D|inside_va": { stars: 4, label: "LPS 入場區", action: "回踩 VA 內，找 POC 支撐進場" },
  "D|above_va": { stars: 2, label: "SOS 追蹤（已跑一段）", action: "已突破，用 trailing stop 跟蹤，勿追高" },
  "E|below_va": { stars: 0, label: "⚠️ 假突破?", action: "❌ 已 markup 卻跌回 → 可能失敗" },
  "E|inside_va": { stars: 2, label: "回踩觀察", action: "等價格站回 VAH 再考慮" },
  "E|above_va": { stars: 4, label: "趨勢確認", action: "已在軌道上，持有或 trailing stop" },
  "A|below_va": { stars: 1, label: "初期觀察", action: "剛停止下跌，僅觀察" },
  "A|inside_va": { stars: 1, label: "初期觀察", action: "剛停止下跌，僅觀察" },
  "A|above_va": { stars: 0, label: "不合理", action: "❌ 剛止跌不該在上方" },
  "UNKNOWN|below_va": { stars: 0, label: "無結構", action: "不符吸籌結構，忽略" },
  "UNKNOWN|inside_va": { stars: 0, label: "無結構", action: "不符吸籌結構，忽略" },
  "UNKNOWN|above_va": { stars: 0, label: "無結構", action: "不符吸籌結構，忽略" },
};

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
  support_primary?: number;
  tier?: string;
  triggers_fired?: Trigger[];
}

interface FusionSignal {
  decay_score: number;
  stars: number;
  [key: string]: unknown;
}

function getMacroDirection(vp: VPInfo): string {
  const weekly = vp?.weekly?.position || "inside_va";
  const monthly = vp?.monthly?.position || "inside_va";
  const above = [weekly, monthly].filter((p) => p === "above_va").length;
  const below = [weekly, monthly].filter((p) => p === "below_va").length;
  if (above >= 2) return "bullish";
  if (below >= 2) return "bearish";
  return "neutral";
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
    const { data: scanRow } = await supabase
      .from("scan_data")
      .select("vp_data, market_ctx")
      .eq("id", "latest")
      .single();

    // Fetch accum data
    const { data: accumRows } = await supabase
      .from("accum_data")
      .select("ticker, state");

    if (!scanRow || !accumRows) {
      return NextResponse.json({ signals: [], error: "No data" }, { status: 404 });
    }

    const vpData = (scanRow.vp_data || {}) as Record<string, VPInfo>;
    const accumState: Record<string, AccumulationInfo> = {};
    for (const row of accumRows) {
      accumState[row.ticker] = row.state;
    }

    const signals: FusionSignal[] = [];

    for (const [symbol, accumInfo] of Object.entries(accumState)) {
      if (!accumInfo || typeof accumInfo !== "object") continue;

      const phase = accumInfo.phase || "UNKNOWN";
      const vp = vpData[symbol];
      if (!vp) continue;

      const dailyPos = vp.daily?.position || "inside_va";
      const dailyPct = vp.daily?.position_pct || 50;
      const macro = getMacroDirection(vp);

      const matrixKey = `${phase}|${dailyPos}`;
      const confidence = CONFIDENCE_MATRIX[matrixKey] || { stars: 0, label: "未定義", action: "—" };

      let effectiveStars = confidence.stars;
      if (accumInfo.failing) effectiveStars = 0;
      if (macro === "bullish" && ["C", "D", "E"].includes(phase)) {
        effectiveStars = Math.min(5, effectiveStars + 1);
      } else if (macro === "bearish" && ["A", "B"].includes(phase)) {
        effectiveStars = Math.max(0, effectiveStars - 1);
      }

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
        triggers_fired: accumInfo.triggers_fired || [],
        price: vp.price,
        support: accumInfo.support_primary,
        resistance: accumInfo.resistance,
      });
    }

    signals.sort((a, b) => b.stars - a.stars || b.decay_score - a.decay_score);

    return NextResponse.json({ signals });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "Unknown error";
    return NextResponse.json({ signals: [], error: message }, { status: 500 });
  }
}
