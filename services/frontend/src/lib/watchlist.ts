import { SYMBOL_CATEGORIES } from "@/lib/categories";
import type { Plan } from "@/types/user";

const FREE_TICKERS = new Set(SYMBOL_CATEGORIES["Mega Cap Tech"] || []);
const SUPPORTED_TICKERS = new Set(Object.values(SYMBOL_CATEGORIES).flat());

const WATCHLIST_LIMITS: Record<Plan, number> = {
  free: 5,
  pro: 30,
  premium: 100,
};

export type WatchlistValidation =
  | { ok: true; ticker: string }
  | { ok: false; reason: "unsupported" | "upgrade_required" };

export function normalizeTicker(ticker: string): string {
  return ticker.trim().toUpperCase();
}

export function getWatchlistLimit(plan: Plan): number {
  return WATCHLIST_LIMITS[plan];
}

export function validateWatchlistTicker(
  input: string,
  plan: Plan
): WatchlistValidation {
  const ticker = normalizeTicker(input);
  if (!SUPPORTED_TICKERS.has(ticker)) {
    return { ok: false, reason: "unsupported" };
  }
  if (plan === "free" && !FREE_TICKERS.has(ticker)) {
    return { ok: false, reason: "upgrade_required" };
  }
  return { ok: true, ticker };
}

export function isTickerAllowedForPlan(ticker: string, plan: Plan): boolean {
  return validateWatchlistTicker(ticker, plan).ok;
}

export function getAllowedWatchlistTickers(plan: Plan): string[] {
  return [...(plan === "free" ? FREE_TICKERS : SUPPORTED_TICKERS)].sort();
}
