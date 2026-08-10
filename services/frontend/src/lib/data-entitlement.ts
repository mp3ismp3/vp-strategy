import { PLAN_HIERARCHY } from "@/lib/plans";
import { GUEST_ACCUMULATION_LIMIT } from "@/lib/preview-access";
import type { Plan } from "@/types/user";

export function statusForRequiredPlan(
  plan: Plan | null,
  requiredPlan: Plan
): 200 | 401 | 403 {
  if (!plan) return 401;
  return PLAN_HIERARCHY[plan] >= PLAN_HIERARCHY[requiredPlan] ? 200 : 403;
}

export function sanitizeAccumulationForPlan<
  T extends {
    decay_score: number;
    support_primary?: unknown;
    support_dynamic?: unknown;
    resistance?: unknown;
    triggers_fired?: unknown;
    pending_triggers?: unknown;
  },
>(rows: T[], plan: Plan): Array<T | Omit<T, "support_primary" | "support_dynamic" | "resistance" | "triggers_fired" | "pending_triggers">> {
  const sorted = [...rows].sort((left, right) => right.decay_score - left.decay_score);
  if (plan !== "free") return sorted;
  return sorted.slice(0, GUEST_ACCUMULATION_LIMIT).map((row) => {
    const summary = { ...row };
    delete summary.support_primary;
    delete summary.support_dynamic;
    delete summary.resistance;
    delete summary.triggers_fired;
    delete summary.pending_triggers;
    return summary;
  });
}
