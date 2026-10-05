import policy from "@/lib/fusion-policy.json";
import type { Trigger } from "@/lib/triggers";

export type FusionPhase = "A" | "B" | "C" | "D" | "E" | "UNKNOWN";
export type VPPosition = "above_va" | "inside_va" | "below_va";

export interface FusionConfidence {
  stars: number;
  label: string;
  action: string;
}

export interface FusionRedFlagInput {
  phase: string;
  dailyPosition: string;
  dailyPositionPct: number;
  macroDirection: string;
  rawHistory?: number[];
}

const matrix = policy.matrix as Record<string, FusionConfidence>;
const actionableTypes = new Set(policy.actionable_trigger_types);

export function getFusionConfidence(phase: string, position: string): FusionConfidence {
  return matrix[`${phase}|${position}`] ?? { stars: 0, label: "未定義", action: "—" };
}

export function getMacroDirection(weekly?: string, monthly?: string): "bullish" | "bearish" | "neutral" {
  if (weekly === "above_va" && monthly === "above_va") return "bullish";
  if (weekly === "below_va" && monthly === "below_va") return "bearish";
  return "neutral";
}

export function getFusionRedFlags(input: FusionRedFlagInput): string[] {
  const flags: string[] = [];
  if (input.macroDirection === "bearish" && ["A", "B"].includes(input.phase)) {
    flags.push("月/周線 Below VA 且僅 Phase A/B，可能是假吸籌");
  }
  if (input.phase === "E" && input.dailyPosition === "below_va") {
    flags.push("Phase E 卻在 VA 下方，突破可能失敗");
  }
  if (input.phase === "C" && input.dailyPosition === "above_va") {
    flags.push("Phase C 位於 VA 上方，Phase 判定可能有誤");
  }
  if (input.dailyPositionPct > 150) {
    flags.push(`日線 VP position ${input.dailyPositionPct.toFixed(0)}%，嚴重偏離價值區`);
  }
  const recent = input.rawHistory?.slice(-5) ?? [];
  if (recent.length === 5 && recent.every((value, index) => index === 0 || recent[index - 1] >= value)) {
    flags.push("近 5 天分數持續下降，吸籌動能衰退");
  }
  return flags;
}

export function getFreshActionableTriggers(triggers: Trigger[], scanDate?: string): Trigger[] {
  if (!scanDate) return [];
  return triggers.filter((trigger) => {
    if (typeof trigger === "string" || !trigger.date) return false;
    const triggerType = trigger.type.toUpperCase().replaceAll(" ", "_");
    return actionableTypes.has(triggerType) && trigger.date.slice(0, 10) === scanDate.slice(0, 10);
  });
}

export function isFusionDataFresh(scanTime?: string, lastUpdated?: string): boolean {
  return Boolean(scanTime && lastUpdated && scanTime.slice(0, 10) === lastUpdated.slice(0, 10));
}

export function getFusionActionability(input: {
  tier?: string;
  failing?: boolean;
  dataFresh: boolean;
  freshTriggers: Trigger[];
  redFlags: string[];
}): { actionable: boolean; reasons: string[] } {
  const reasons: string[] = [];
  if ((input.tier || "watch") !== "confirmed") reasons.push("Accumulation 尚未確認");
  if (!input.dataFresh) reasons.push("資料不是同一掃描日");
  if (input.freshTriggers.length === 0) reasons.push("沒有當日有效觸發");
  if (input.redFlags.length > 0) reasons.push("存在 Fusion 紅旗");
  if (input.failing) reasons.push("Accumulation 結構已失敗");
  return { actionable: reasons.length === 0, reasons };
}
