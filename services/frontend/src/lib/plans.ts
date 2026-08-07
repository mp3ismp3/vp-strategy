import { Plan, SubscriptionStatus } from "@/types/user";

export const PLAN_HIERARCHY: Record<Plan, number> = {
  free: 0,
  pro: 1,
  premium: 2,
};

export interface PlanConfig {
  name: string;
  price: number;
  features: {
    scannerSymbols: number; // -1 = unlimited
    scannerDelayDays: number;
    accumulation: boolean;
    fusion: boolean;
    telegramSignals: boolean;
    historyDays: number;
  };
  highlights: string[];
}

export const PLANS: Record<Plan, PlanConfig> = {
  free: {
    name: "Free",
    price: 0,
    features: {
      scannerSymbols: 7,
      scannerDelayDays: 0,
      accumulation: true,
      fusion: false,
      telegramSignals: false,
      historyDays: 0,
    },
    highlights: [
      "VP Scanner — Mega Cap Tech 7 檔",
      "多時間框架 VP 圖表",
      "登入解鎖 Accumulation 完整排行榜",
      "基本操作建議",
    ],
  },
  pro: {
    name: "Pro",
    price: 320,
    features: {
      scannerSymbols: -1,
      scannerDelayDays: 0,
      accumulation: true,
      fusion: false,
      telegramSignals: false,
      historyDays: 7,
    },
    highlights: [
      "VP Scanner — 全部 78 檔",
      "Accumulation Tracker",
      "類別篩選",
      "7 天歷史回顧",
    ],
  },
  premium: {
    name: "Premium",
    price: 620,
    features: {
      scannerSymbols: -1,
      scannerDelayDays: 0,
      accumulation: true,
      fusion: true,
      telegramSignals: true,
      historyDays: 30,
    },
    highlights: [
      "所有 Pro 功能",
      "Fusion 多策略綜合分析",
      "Telegram 即時信號私訊",
      "30 天歷史回顧",
      "優先客服支援",
    ],
  },
};

export function hasAccess(userPlan: Plan, requiredPlan: Plan): boolean {
  return PLAN_HIERARCHY[userPlan] >= PLAN_HIERARCHY[requiredPlan];
}

export function isSubscriptionActive(status: string | null): boolean {
  return status === "active" || status === "trialing";
}

export interface PlanSnapshot {
  email: string;
  plan: Plan;
  status: SubscriptionStatus;
}

export function resolvePlanSnapshot(
  snapshot: PlanSnapshot | null,
  email: string | null | undefined
): { plan: Plan; ready: boolean; status: SubscriptionStatus } {
  if (!email) return { plan: "free", ready: true, status: "inactive" };
  if (snapshot?.email !== email) {
    return { plan: "free", ready: false, status: "inactive" };
  }
  return { plan: snapshot.plan, ready: true, status: snapshot.status };
}

interface PricingPlanAction {
  disabled: boolean;
  href?: string;
  label: string;
}

export function getPricingPlanAction(
  userPlan: Plan,
  plan: Plan
): PricingPlanAction {
  if (userPlan === plan) {
    return { disabled: true, label: "目前方案" };
  }

  if (userPlan !== "free") {
    if (plan === "free") {
      return {
        disabled: false,
        href: "/account",
        label: "前往管理訂閱取消",
      };
    }
    return { disabled: true, label: "不支援直接切換" };
  }

  if (plan === "pro") {
    return { disabled: false, label: "訂閱 Pro" };
  }
  if (plan === "premium") {
    return { disabled: false, label: "訂閱 Premium" };
  }
  return { disabled: true, label: "目前方案" };
}
