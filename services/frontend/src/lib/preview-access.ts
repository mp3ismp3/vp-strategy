import { SYMBOL_CATEGORIES } from "@/lib/categories";
import type { Plan } from "@/types/user";

export const GUEST_ACCUMULATION_LIMIT = 10;
export const FREE_TICKERS: readonly string[] = [
  "AAPL",
  "MSFT",
  "NVDA",
  "AMZN",
  "GOOGL",
  "META",
  "TSLA",
] as const;
export const MEGA_CAP_TECH_TICKERS = [...FREE_TICKERS];

type AccessPlan = Plan | boolean;

function isPaid(plan: AccessPlan): boolean {
  return plan === "pro" || plan === "premium";
}

export function getIndicatorCategories(plan: AccessPlan) {
  if (isPaid(plan)) return SYMBOL_CATEGORIES;
  return { "Mega Cap Tech": MEGA_CAP_TECH_TICKERS };
}

export function isIndicatorTickerAllowed(
  ticker: string,
  plan: AccessPlan
): boolean {
  return isPaid(plan) || MEGA_CAP_TECH_TICKERS.includes(ticker);
}

export function filterIndicatorItems<T extends { ticker: string }>(
  items: T[],
  plan: AccessPlan
): T[] {
  if (isPaid(plan)) return items;
  return items.filter((item) => MEGA_CAP_TECH_TICKERS.includes(item.ticker));
}

export function filterScanItemsForPlan<T extends { ticker: string }>(
  items: T[],
  plan: Plan
): T[] {
  return filterIndicatorItems(items, plan);
}

export function limitAccumulationItems<T extends { decay_score: number }>(
  items: T[],
  plan: AccessPlan
): T[] {
  const sorted = [...items].sort((a, b) => b.decay_score - a.decay_score);
  return isPaid(plan) ? sorted : sorted.slice(0, GUEST_ACCUMULATION_LIMIT);
}
