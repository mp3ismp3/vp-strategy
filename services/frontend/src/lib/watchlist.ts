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

export function reorderWatchlistItems<T extends { ticker: string; sort_order: number }>(
  items: T[],
  ticker: string,
  targetIndex: number,
): T[] {
  const sourceIndex = items.findIndex((item) => item.ticker === ticker);
  if (sourceIndex < 0 || sourceIndex === targetIndex || targetIndex < 0 || targetIndex >= items.length) {
    return items;
  }

  const reordered = [...items];
  const [movedItem] = reordered.splice(sourceIndex, 1);
  reordered.splice(targetIndex, 0, movedItem);
  return reordered.map((item, sortOrder) => ({ ...item, sort_order: sortOrder }));
}

type WatchlistFetcher = (input: string, init: RequestInit) => Promise<{ ok: boolean }>;
type ReorderLock = { current: boolean };

export async function persistWatchlistOrder(
  fetcher: WatchlistFetcher,
  tickers: string[],
  lock: ReorderLock,
): Promise<"saved" | "failed" | "busy"> {
  if (lock.current) return "busy";
  lock.current = true;
  try {
    const response = await fetcher("/api/user/watchlist", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ tickers }),
    });
    return response.ok ? "saved" : "failed";
  } catch {
    return "failed";
  } finally {
    lock.current = false;
  }
}
