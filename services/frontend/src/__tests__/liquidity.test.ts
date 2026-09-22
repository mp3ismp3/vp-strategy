import { expect, it } from "vitest";
import { analyzeLiquidity, detectLevelSweep, type LiquidityLevel } from "@/lib/liquidity";
import type { OHLCBar } from "@/lib/macd";

function bars(count = 80): OHLCBar[] {
  const result: OHLCBar[] = [];
  const date = new Date("2026-06-01T00:00:00Z");
  while (result.length < count) {
    if (date.getUTCDay() !== 0 && date.getUTCDay() !== 6) result.push({
      time: date.toISOString().slice(0, 10), open: 102, high: 104, low: 100, close: 102, volume: 100,
    });
    date.setUTCDate(date.getUTCDate() + 1);
  }
  return result;
}
const level = (input: OHLCBar[]): LiquidityLevel => ({ price: 104, type: "high", source: "Swing",
  startIndex: 10, startTime: input[10].time, confirmedIndex: 20, confirmedTime: input[20].time, touches: 1, swept: false });

it("detects yesterday's high sweep on the immediately following session", () => {
  const input = bars(40);
  input[39] = { ...input[39], high: 105, close: 103, volume: 200 };
  expect(analyzeLiquidity(input).sweeps.find(event => event.level.source === "PDH" && event.index === 39)).toMatchObject({
    direction: "bearish", level: { confirmedIndex: 38, price: 104 },
  });
});

it("does not retrospectively sweep a previous-week level inside its own week", () => {
  const input = bars(40);
  input[31] = { ...input[31], high: 110, close: 108 };
  input[33] = { ...input[33], high: 109, close: 105 };
  input[35] = { ...input[35], high: 111, low: 107, close: 109, volume: 200 };
  const weekly = analyzeLiquidity(input).sweeps.filter(event => event.level.source === "PWH" && event.level.price === 110);
  expect(weekly.map(event => event.index)).toEqual([35]);
  expect(weekly[0].level.confirmedIndex).toBe(34);
});

it("waits for ten following bars to confirm a swing and freezes its confirmation-time ATR", () => {
  const input = bars(60);
  input[20] = { ...input[20], high: 110, close: 108 };
  input[31] = { ...input[31], high: 111, low: 107, close: 109, volume: 200 };
  expect(analyzeLiquidity(input.slice(0, 30)).levels.some(item => item.source === "Swing" && item.startIndex === 20)).toBe(false);
  expect(analyzeLiquidity(input.slice(0, 31)).levels.find(item => item.source === "Swing" && item.startIndex === 20)?.confirmedIndex).toBe(30);
  const before = analyzeLiquidity(input.slice(0, 32)).sweeps.find(event => event.level.source === "Swing" && event.level.startIndex === 20);
  expect(before?.index).toBe(31);
  input[59] = { ...input[59], high: 1000, close: 500 };
  expect(analyzeLiquidity(input).sweeps.find(event => event.level.source === "Swing" && event.level.startIndex === 20)).toEqual(before);
});

it("equal lows become available after the second swing confirms, without changing prior event prices", () => {
  const input = bars(80);
  input[20] = { ...input[20], low: 90 };
  input[30] = { ...input[30], low: 90.03 };
  input[31] = { ...input[31], low: 90.04 };
  input[42] = { ...input[42], low: 90.1 };
  input[53] = { ...input[53], low: 89.5, close: 92, volume: 200, high: 94 };
  input[64] = { ...input[64], low: 90.2 };
  const before = analyzeLiquidity(input.slice(0, 54)).sweeps.filter(event => event.level.source === "EQL");
  expect(before.map(event => event.index)).toEqual([53]);
  expect(before[0].level).toMatchObject({ confirmedIndex: 52, price: 90.05, touches: 2 });
  expect(analyzeLiquidity(input).sweeps.filter(event => event.level.source === "EQL" && event.index <= 53)).toEqual(before);
});

it("no event can precede or equal its level confirmation", () => {
  const input = bars(50);
  input[20] = { ...input[20], high: 105, close: 103, volume: 200 };
  expect(detectLevelSweep(input, 20, level(input))).toBeNull();
  input[21] = { ...input[21], high: 105, close: 103, volume: 200 };
  expect(detectLevelSweep(input, 21, level(input))?.index).toBe(21);
});

it.each([0, NaN, -10])("rejects invalid or zero median volume: %s", value => {
  const input = bars(40);
  input[39] = { ...input[39], high: 105, close: 103, volume: 200 };
  for (let index = 20; index < 39; index++) input[index].volume = value;
  expect(detectLevelSweep(input, 39, level(input))).toBeNull();
});

it("requires twenty volume observations and a strictly recovered close", () => {
  const input = bars(40);
  input[19] = { ...input[19], high: 105, close: 104, volume: 200 };
  expect(detectLevelSweep(input, 19, { ...level(input), confirmedIndex: 18, confirmedTime: input[18].time })).toBeNull();
  input[18] = { ...input[18], high: 105, close: 103, volume: 200 };
  expect(detectLevelSweep(input, 18, { ...level(input), confirmedIndex: 17, confirmedTime: input[17].time })).toBeNull();
});

it("uses calendar weeks independently of browser timezone", () => {
  const input = bars(40);
  const original = process.env.TZ;
  try {
    process.env.TZ = "UTC";
    const utc = analyzeLiquidity(input);
    process.env.TZ = "America/Los_Angeles";
    expect(analyzeLiquidity(input)).toEqual(utc);
  } finally {
    if (original === undefined) delete process.env.TZ; else process.env.TZ = original;
  }
});

it("preserves earlier events for every later snapshot, without mutating inputs", () => {
  const input = bars(90).map((bar, index) => {
    const mid = 100 + Math.sin(index / 5) * 8;
    return Object.freeze({ ...bar, open: mid, high: mid + 2, low: mid - 2, close: mid + 0.5, volume: 100 + index % 7 * 30 });
  });
  const full = analyzeLiquidity(input);
  expect(full.sweeps.length).toBeGreaterThan(0);
  for (let end = 30; end < input.length; end++) {
    expect(analyzeLiquidity(input.slice(0, end)).sweeps).toEqual(full.sweeps.filter(event => event.index < end));
  }
  expect(analyzeLiquidity(input)).toEqual(full);
});

it.each([{ input: [] }, { input: bars(10) }, { input: bars(40).reverse() }, { input: [...bars(40), { ...bars(40)[39], low: NaN }] }])
  ("handles insufficient or malformed price history", ({ input }) => {
    expect(analyzeLiquidity(input)).toEqual({ levels: [], sweeps: [] });
  });
