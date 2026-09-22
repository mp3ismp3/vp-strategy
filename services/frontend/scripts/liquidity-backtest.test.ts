import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { expect, it } from "vitest";
import type { OHLCBar } from "@/lib/macd";
import { analyzeLiquidity } from "@/lib/liquidity";
import { evaluateLiquidityValidity, validateLiquidityStrategy } from "@/lib/liquidity-validation";
import { completedDailyBars } from "@/lib/market-bars";

interface ChartRow {
  daily?: { captured_at?: string; ohlc?: OHLCBar[] };
}

it("reports the fixed-rule liquidity backtest without tuning parameters", () => {
  const inputPath = resolve(process.cwd(), "../../data/frontend_charts.json");
  const charts = JSON.parse(readFileSync(inputPath, "utf8")) as Record<string, ChartRow>;
  const rows = Object.entries(charts).map(([ticker, chart]) => {
    const bars = completedDailyBars(chart.daily?.ohlc ?? [], chart.daily?.captured_at);
    const liquidity = analyzeLiquidity(bars);
    const validation = validateLiquidityStrategy(bars, liquidity.sweeps);
    return {
      ticker,
      bars: bars.length,
      events: liquidity.sweeps.length,
      signals: validation.signals.length,
      signalRows: validation.signals,
      assessments: validation.assessments,
      validityByDirection: validation.currentValidityByDirection,
      tradeRows: validation.trades,
    };
  });
  const signalKeys: string[] = [];
  for (const row of rows) {
    for (const signal of row.signalRows) {
      const assessment = row.assessments.find(item => item.event === signal);
      expect(assessment?.validity.status).toBe("valid");
      expect(assessment?.exclusion).toBeUndefined();
      signalKeys.push(`${row.ticker}:${signal.time}:${signal.direction}`);
    }
  }
  expect(new Set(signalKeys).size).toBe(signalKeys.length);
  const trades = rows.flatMap(row => row.tradeRows);
  const aggregate = evaluateLiquidityValidity(trades);
  const report = {
    policy: "next open -> fifth-session close; 0.10% round-trip cost; no overlapping positions; no parameter search",
    symbols: rows.length,
    barRange: rows.length ? [Math.min(...rows.map(row => row.bars)), Math.max(...rows.map(row => row.bars))] : [0, 0],
    events: rows.reduce((sum, row) => sum + row.events, 0),
    completedTrades: trades.length,
    historicalThresholdPassedDirections: rows.flatMap(row => (["bullish", "bearish"] as const)
      .filter(direction => row.validityByDirection[direction].status === "valid")
      .map(direction => `${row.ticker}:${direction}`)),
    emittedHistoricalThresholdSignals: rows.reduce((sum, row) => sum + row.signals, 0),
    signalGateInvariantPassed: true,
    aggregateDescriptiveOnly: aggregate,
    aggregateByDirectionDescriptiveOnly: {
      bullish: evaluateLiquidityValidity(trades.filter(trade => trade.direction === "bullish")),
      bearish: evaluateLiquidityValidity(trades.filter(trade => trade.direction === "bearish")),
    },
  };
  console.log(JSON.stringify(report, null, 2));
  expect(rows.length).toBeGreaterThan(0);
});
