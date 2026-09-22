import { expect, it } from "vitest";
import type { OHLCBar } from "@/lib/macd";
import type { SweepEvent } from "@/lib/liquidity";
import {
  evaluateLiquidityValidity,
  LIQUIDITY_VALIDATION_POLICY,
  type LiquidityTrade,
  validateLiquidityStrategy,
} from "@/lib/liquidity-validation";

function bars(count = 170): OHLCBar[] {
  return Array.from({ length: count }, (_, index) => {
    const open = 100 + index;
    return {
      time: new Date(Date.UTC(2025, 0, index + 1)).toISOString().slice(0, 10),
      open,
      high: open + 7,
      low: open - 2,
      close: open + 5,
      volume: 100,
    };
  });
}

function event(input: OHLCBar[], index: number, direction: "bullish" | "bearish" = "bullish"): SweepEvent {
  const lowSide = direction === "bullish";
  return {
    index,
    time: input[index].time,
    direction,
    level: {
      price: lowSide ? input[index].low + 1 : input[index].high - 1,
      type: lowSide ? "low" : "high",
      source: "PDL",
      startTime: input[index - 1].time,
      startIndex: index - 1,
      confirmedTime: input[index - 1].time,
      confirmedIndex: index - 1,
      touches: 1,
      swept: true,
      sweepTime: input[index].time,
      sweepIndex: index,
    },
    wickExtreme: lowSide ? input[index].low : input[index].high,
    closePrice: input[index].close,
    volumeRatio: 1.2,
  };
}

it("backtests a sweep from the next open to the fifth-session close with fixed costs", () => {
  const input = bars(20);
  const result = validateLiquidityStrategy(input, [event(input, 2)]);
  expect(result.trades).toHaveLength(1);
  expect(result.trades[0]).toMatchObject({
    eventIndex: 2,
    entryIndex: 3,
    exitIndex: 7,
    entryTime: input[3].time,
    exitTime: input[7].time,
  });
  expect(result.trades[0].netReturn).toBeCloseTo(
    (input[7].close - input[3].open) / input[3].open - LIQUIDITY_VALIDATION_POLICY.roundTripCostRate,
  );
});

it("emits a signal only after twenty previously completed positive trades validate the fixed rule", () => {
  const input = bars();
  const history = Array.from({ length: 21 }, (_, i) => event(input, 2 + i * 6));
  const candidate = event(input, 140);
  const result = validateLiquidityStrategy(input, [...history, candidate]);

  expect(result.assessments.find(item => item.event.time === history[19].time)?.validity.status).toBe("insufficient");
  expect(result.assessments.find(item => item.event.time === candidate.time)?.validity).toMatchObject({
    status: "valid",
    sampleSize: 21,
  });
  expect(result.signals.map(item => item.time)).toContain(candidate.time);
});

it("does not use candles after the candidate event to decide whether it is a signal", () => {
  const input = bars();
  const events = [...Array.from({ length: 21 }, (_, i) => event(input, 2 + i * 6)), event(input, 140)];
  const atEvent = validateLiquidityStrategy(input.slice(0, 141), events);
  const withFuture = validateLiquidityStrategy(input, events);
  expect(atEvent.assessments.at(-1)?.validity).toEqual(withFuture.assessments.at(-1)?.validity);
  expect(atEvent.signals.at(-1)?.time).toBe(input[140].time);
});

it("rejects statistically unconfirmed history and same-day direction conflicts", () => {
  const input = bars();
  const losing = Array.from({ length: 21 }, (_, i) => event(input, 2 + i * 6, "bearish"));
  const candidate = event(input, 140, "bearish");
  const result = validateLiquidityStrategy(input, [...losing, candidate]);
  expect(result.assessments.at(-1)?.validity.status).toBe("not-valid");
  expect(result.signals).toEqual([]);

  const conflict = validateLiquidityStrategy(input, [event(input, 20), event(input, 20, "bearish")]);
  expect(conflict.trades).toEqual([]);
  expect(conflict.assessments.every(item => item.exclusion === "direction-conflict")).toBe(true);
});

it("never lets bullish performance validate a bearish signal", () => {
  const input = bars(430);
  const bullish = Array.from({ length: 30 }, (_, i) => event(input, 2 + i * 6));
  const bearish = Array.from({ length: 20 }, (_, i) => event(input, 190 + i * 6, "bearish"));
  const bearishCandidate = event(input, 320, "bearish");
  const result = validateLiquidityStrategy(input, [...bullish, ...bearish, bearishCandidate]);
  expect(result.currentValidityByDirection.bullish.status).toBe("valid");
  expect(result.currentValidityByDirection.bearish.status).toBe("not-valid");
  expect(result.signals).not.toContain(bearishCandidate);
});

it("deduplicates same-day same-direction levels and handles insufficient data", () => {
  const input = bars(20);
  const first = event(input, 2);
  const second = { ...event(input, 2), level: { ...event(input, 2).level, source: "PWL" as const } };
  expect(validateLiquidityStrategy(input, [first, second]).trades).toHaveLength(1);
  expect(validateLiquidityStrategy([], [])).toMatchObject({ trades: [], signals: [], assessments: [] });
});

it("emits only one threshold signal for duplicate same-day same-direction levels", () => {
  const input = bars();
  const history = Array.from({ length: 21 }, (_, i) => event(input, 2 + i * 6));
  const first = event(input, 140);
  const second = { ...event(input, 140), level: { ...event(input, 140).level, source: "PWL" as const } };
  const result = validateLiquidityStrategy(input, [...history, first, second]);
  expect(result.signals.filter(signal => signal.time === input[140].time)).toHaveLength(1);
  expect(result.assessments.filter(item => item.event.time === input[140].time).map(item => item.exclusion))
    .toEqual([undefined, "same-day-duplicate"]);
});

it("does not count overlapping five-session positions as independent trades", () => {
  const input = bars(30);
  const result = validateLiquidityStrategy(input, [event(input, 2), event(input, 4), event(input, 8)]);
  expect(result.trades.map(trade => trade.eventIndex)).toEqual([2, 8]);
  expect(result.assessments[1].exclusion).toBe("overlapping-position");
});

it("marks consistently positive descriptive metrics as positive bias without promoting them to valid", () => {
  const trade = (netReturn: number): LiquidityTrade => ({
    eventIndex: 1, eventTime: "2026-01-01", direction: "bullish",
    entryIndex: 2, entryTime: "2026-01-02", entryPrice: 100,
    exitIndex: 6, exitTime: "2026-01-06", exitPrice: 100,
    grossReturn: netReturn + LIQUIDITY_VALIDATION_POLICY.roundTripCostRate,
    netReturn,
  });
  const result = evaluateLiquidityValidity([trade(0.1), trade(0.02), trade(-0.08)]);
  expect(result).toMatchObject({ status: "insufficient", bias: "positive" });
});
