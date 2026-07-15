import { Plan } from "@/types/user";

export const PLAN_HIERARCHY: Record<Plan, number> = {
  free: 0,
  pro: 1,
  premium: 2,
};

export const TRIAL_DAYS = 7;

export interface PlanConfig {
  name: string;
  price: number;
  stripePriceId: string | null;
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
    stripePriceId: null,
    features: {
      scannerSymbols: 5,
      scannerDelayDays: 1,
      accumulation: false,
      fusion: false,
      telegramSignals: false,
      historyDays: 0,
    },
    highlights: [
      "VP Scanner — 5 檔（延遲 1 天）",
      "多時間框架總覽",
      "基本操作建議",
    ],
  },
  pro: {
    name: "Pro",
    price: 10,
    stripePriceId: process.env.NEXT_PUBLIC_STRIPE_PRICE_PRO || "",
    features: {
      scannerSymbols: -1,
      scannerDelayDays: 0,
      accumulation: true,
      fusion: false,
      telegramSignals: true,
      historyDays: 7,
    },
    highlights: [
      "VP Scanner — 全部 62 檔即時",
      "Accumulation Tracker",
      "Telegram 即時信號通知",
      "7 天歷史回顧",
      "7 天免費試用",
    ],
  },
  premium: {
    name: "Premium",
    price: 19,
    stripePriceId: process.env.NEXT_PUBLIC_STRIPE_PRICE_PREMIUM || "",
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
      "Telegram 觸發即時提醒",
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
