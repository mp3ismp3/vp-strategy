import type { OHLCBar } from "./macd";

export interface IndicatorReview {
  title: string;
  summary: string[];
  guidance?: string[];
  checks: {
    id: string;
    label: string;
    date: string;
    status: "met" | "not-met" | "not-applicable" | "unavailable";
    evidence: string;
  }[];
}

export const reviewPrice = (value: number) => `$${value.toFixed(2)}`;
export const reviewOutcome = (met: boolean) => met ? "met" as const : "not-met" as const;

/** Callers supply completed daily bars; reject malformed or unordered snapshots. */
export function validReviewBars(bars: OHLCBar[]): boolean {
  return bars.length > 0 && bars.every((bar, index) =>
    /^\d{4}-\d{2}-\d{2}$/.test(bar.time) && Number.isFinite(Date.parse(bar.time)) &&
    (index === 0 || bar.time > bars[index - 1].time) &&
    [bar.high, bar.low, bar.close].every(Number.isFinite) && bar.low > 0 &&
    bar.high >= bar.low && bar.close >= bar.low && bar.close <= bar.high);
}
