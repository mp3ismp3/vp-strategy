import { SYMBOL_CATEGORIES } from "@/lib/categories";

export const GUEST_ACCUMULATION_LIMIT = 10;
export const MEGA_CAP_TECH_TICKERS = SYMBOL_CATEGORIES["Mega Cap Tech"] || [];

export function getIndicatorCategories(isAuthenticated: boolean) {
  if (isAuthenticated) return SYMBOL_CATEGORIES;
  return { "Mega Cap Tech": MEGA_CAP_TECH_TICKERS };
}

export function isIndicatorTickerAllowed(
  ticker: string,
  isAuthenticated: boolean
): boolean {
  return isAuthenticated || MEGA_CAP_TECH_TICKERS.includes(ticker);
}

export function filterIndicatorItems<T extends { ticker: string }>(
  items: T[],
  isAuthenticated: boolean
): T[] {
  if (isAuthenticated) return items;
  return items.filter((item) => MEGA_CAP_TECH_TICKERS.includes(item.ticker));
}

export function limitAccumulationItems<T extends { decay_score: number }>(
  items: T[],
  isAuthenticated: boolean
): T[] {
  const sorted = [...items].sort((a, b) => b.decay_score - a.decay_score);
  return isAuthenticated ? sorted : sorted.slice(0, GUEST_ACCUMULATION_LIMIT);
}
