import type { OHLCBar } from "./macd";
import type { SweepEvent } from "./liquidity";
import { validReviewBars } from "./indicator-review";

export const LIQUIDITY_VALIDATION_POLICY = Object.freeze({
  holdingSessions: 5,
  roundTripCostRate: 0.001,
  minimumTrades: 20,
  confidenceZ: 1.96,
});

export type LiquidityValidityStatus = "valid" | "insufficient" | "not-valid";
export type LiquidityBias = "positive" | "negative" | "mixed" | "insufficient";

export interface LiquidityTrade {
  eventIndex: number;
  eventTime: string;
  direction: SweepEvent["direction"];
  entryIndex: number;
  entryTime: string;
  entryPrice: number;
  exitIndex: number;
  exitTime: string;
  exitPrice: number;
  grossReturn: number;
  netReturn: number;
}

export interface LiquidityValidity {
  status: LiquidityValidityStatus;
  bias: LiquidityBias;
  sampleSize: number;
  meanNetReturn: number | null;
  medianNetReturn: number | null;
  winRate: number | null;
  lowerConfidenceBound: number | null;
}

export interface LiquidityEventAssessment {
  event: SweepEvent;
  validity: LiquidityValidity;
  exclusion?: "direction-conflict" | "overlapping-position" | "same-day-duplicate";
}

export interface LiquidityValidationResult {
  trades: LiquidityTrade[];
  signals: SweepEvent[];
  assessments: LiquidityEventAssessment[];
  currentValidity: LiquidityValidity;
  currentValidityByDirection: Record<SweepEvent["direction"], LiquidityValidity>;
}

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
}

export function evaluateLiquidityValidity(trades: LiquidityTrade[]): LiquidityValidity {
  const returns = trades.map(trade => trade.netReturn).filter(Number.isFinite);
  if (returns.length === 0) return {
    status: "insufficient", bias: "insufficient", sampleSize: 0, meanNetReturn: null, medianNetReturn: null,
    winRate: null, lowerConfidenceBound: null,
  };
  const mean = returns.reduce((sum, value) => sum + value, 0) / returns.length;
  const middle = median(returns);
  const winRate = returns.filter(value => value > 0).length / returns.length;
  const variance = returns.length > 1
    ? returns.reduce((sum, value) => sum + (value - mean) ** 2, 0) / (returns.length - 1)
    : 0;
  const lower = mean - LIQUIDITY_VALIDATION_POLICY.confidenceZ * Math.sqrt(variance / returns.length);
  const enough = returns.length >= LIQUIDITY_VALIDATION_POLICY.minimumTrades;
  const bias: LiquidityBias = mean > 0 && middle > 0 && winRate > 0.5
    ? "positive"
    : mean < 0 && middle < 0 && winRate < 0.5 ? "negative" : "mixed";
  return {
    status: !enough ? "insufficient" : lower > 0 && middle > 0 ? "valid" : "not-valid",
    bias,
    sampleSize: returns.length,
    meanNetReturn: mean,
    medianNetReturn: middle,
    winRate,
    lowerConfidenceBound: lower,
  };
}

function createTrade(bars: OHLCBar[], event: SweepEvent): LiquidityTrade | null {
  const entryIndex = event.index + 1;
  const exitIndex = event.index + LIQUIDITY_VALIDATION_POLICY.holdingSessions;
  const entry = bars[entryIndex];
  const exit = bars[exitIndex];
  if (!entry || !exit || !Number.isFinite(entry.open) || entry.open <= 0 ||
    !Number.isFinite(exit.close) || exit.close <= 0) return null;
  const grossReturn = event.direction === "bullish"
    ? (exit.close - entry.open) / entry.open
    : (entry.open - exit.close) / entry.open;
  return {
    eventIndex: event.index,
    eventTime: event.time,
    direction: event.direction,
    entryIndex,
    entryTime: entry.time,
    entryPrice: entry.open,
    exitIndex,
    exitTime: exit.time,
    exitPrice: exit.close,
    grossReturn,
    netReturn: grossReturn - LIQUIDITY_VALIDATION_POLICY.roundTripCostRate,
  };
}

/**
 * Fixed-rule chronological validation. An event can become a signal only from
 * trades whose five-session exits were already known before that event.
 */
export function validateLiquidityStrategy(bars: OHLCBar[], events: SweepEvent[]): LiquidityValidationResult {
  const noTrades = evaluateLiquidityValidity([]);
  const empty: LiquidityValidationResult = {
    trades: [], signals: [], assessments: [], currentValidity: noTrades,
    currentValidityByDirection: { bullish: noTrades, bearish: noTrades },
  };
  if (!validReviewBars(bars) || bars.some(bar => !Number.isFinite(bar.open) || bar.open <= 0)) return empty;

  const usable = events.filter(event => Number.isInteger(event.index) && event.index >= 0 &&
    event.index < bars.length && bars[event.index]?.time === event.time);
  const grouped = new Map<number, SweepEvent[]>();
  for (const event of usable) grouped.set(event.index, [...(grouped.get(event.index) ?? []), event]);

  const trades: LiquidityTrade[] = [];
  const signals: SweepEvent[] = [];
  const assessments: LiquidityEventAssessment[] = [];
  for (const [eventIndex, sameDay] of [...grouped.entries()].sort(([a], [b]) => a - b)) {
    const direction = sameDay[0].direction;
    const historical = trades.filter(trade => trade.exitIndex < eventIndex && trade.direction === direction);
    const validity = evaluateLiquidityValidity(historical);
    const directions = new Set(sameDay.map(event => event.direction));
    if (directions.size !== 1) {
      assessments.push(...sameDay.map(event => ({ event, validity, exclusion: "direction-conflict" as const })));
      continue;
    }
    if (trades.at(-1)?.exitIndex !== undefined && trades.at(-1)!.exitIndex >= eventIndex) {
      assessments.push(...sameDay.map(event => ({ event, validity, exclusion: "overlapping-position" as const })));
      continue;
    }
    const primary = sameDay[0];
    assessments.push({ event: primary, validity });
    assessments.push(...sameDay.slice(1).map(event => ({
      event,
      validity,
      exclusion: "same-day-duplicate" as const,
    })));
    if (validity.status === "valid") signals.push(primary);
    const trade = createTrade(bars, primary);
    if (trade) trades.push(trade);
  }

  return {
    trades,
    signals,
    assessments,
    currentValidity: evaluateLiquidityValidity(trades),
    currentValidityByDirection: {
      bullish: evaluateLiquidityValidity(trades.filter(trade => trade.direction === "bullish")),
      bearish: evaluateLiquidityValidity(trades.filter(trade => trade.direction === "bearish")),
    },
  };
}
