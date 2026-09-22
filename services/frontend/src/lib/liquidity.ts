import type { OHLCBar } from "./macd";
import { validReviewBars } from "./indicator-review";

export type LiquiditySource = "EQH" | "EQL" | "PDH" | "PDL" | "PWH" | "PWL" | "Swing";
export interface LiquidityLevel {
  price: number;
  type: "high" | "low";
  source: LiquiditySource;
  startTime: string;
  startIndex: number;
  confirmedIndex: number;
  confirmedTime: string;
  touches: number;
  swept: boolean;
  sweepIndex?: number;
  sweepTime?: string;
}
export interface SweepEvent {
  index: number;
  time: string;
  direction: "bullish" | "bearish";
  level: LiquidityLevel;
  wickExtreme: number;
  closePrice: number;
  volumeRatio: number;
}

export const LIQUIDITY_SOURCE_LABELS: Record<LiquiditySource, string> = {
  EQH: "等高點", EQL: "等低點", PDH: "前日高點", PDL: "前日低點",
  PWH: "前週高點", PWL: "前週低點", Swing: "已確認波段轉折",
};

/** Same volume definition as the original page: 20-bar median including the event. */
export function sweepVolumeRatio(bars: OHLCBar[], index: number): number | null {
  if (!Number.isInteger(index) || index < 19 || index >= bars.length) return null;
  const values = bars.slice(index - 19, index + 1).map(bar => bar.volume);
  if (values.some(value => !Number.isFinite(value) || value < 0)) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const median = (sorted[9] + sorted[10]) / 2;
  const ratio = median > 0 ? bars[index].volume / median : NaN;
  return Number.isFinite(ratio) ? ratio : null;
}

/** Evaluate one already-confirmed level without mutating it or accessing future candles. */
export function detectLevelSweep(bars: OHLCBar[], index: number, level: LiquidityLevel): SweepEvent | null {
  const confirmed = level.confirmedIndex;
  const bar = bars[index];
  if (!bar || level.swept || confirmed === undefined || !Number.isInteger(confirmed) ||
    confirmed < level.startIndex || confirmed >= index || bars[confirmed]?.time !== level.confirmedTime ||
    bars[level.startIndex]?.time !== level.startTime || !Number.isFinite(level.price) || level.price <= 0 ||
    ![bar.high, bar.low, bar.close].every(Number.isFinite) || bar.low <= 0 || bar.close < bar.low || bar.close > bar.high) return null;
  const range = bar.high - bar.low;
  if (range <= 0) return null;
  const lowSide = level.type === "low";
  if (lowSide ? !(bar.low < level.price && bar.close > level.price) : !(bar.high > level.price && bar.close < level.price)) return null;
  const penetration = (lowSide ? level.price - bar.low : bar.high - level.price) / level.price;
  const strength = (lowSide ? bar.close - bar.low : bar.high - bar.close) / range;
  const ratio = sweepVolumeRatio(bars, index);
  if (penetration < 0.0005 || penetration > 0.03 || strength < 0.3 || ratio === null || ratio < 1) return null;
  return {
    index, time: bar.time, direction: lowSide ? "bullish" : "bearish",
    level: { ...level, swept: true, sweepIndex: index, sweepTime: bar.time },
    wickExtreme: lowSide ? bar.low : bar.high, closePrice: bar.close, volumeRatio: ratio,
  };
}

function weekKey(time: string): string {
  const date = new Date(`${time}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() - (date.getUTCDay() + 6) % 7);
  return date.toISOString().slice(0, 10);
}

function atrAt(bars: OHLCBar[], end: number): number {
  let sum = 0;
  for (let index = end - 13; index <= end; index++) {
    const bar = bars[index];
    sum += Math.max(bar.high - bar.low, Math.abs(bar.high - bars[index - 1].close), Math.abs(bar.low - bars[index - 1].close));
  }
  return sum / 14;
}

/** Chronological replay. Session references expire; swing/cluster prices freeze at confirmation.
 * Returned events contain snapshots, so later cluster members never rewrite earlier events.
 */
export function analyzeLiquidity(bars: OHLCBar[]): { levels: LiquidityLevel[]; sweeps: SweepEvent[] } {
  if (bars.length < 30 || !validReviewBars(bars)) return { levels: [], sweeps: [] };
  const levels: LiquidityLevel[] = [];
  const active = new Set<LiquidityLevel>();
  const sweeps: SweepEvent[] = [];
  type Cluster = { points: { index: number; price: number }[]; level: LiquidityLevel };
  const clusters: Record<"high" | "low", Cluster[]> = { high: [], low: [] };
  let weekStart = 0;
  let currentWeek = weekKey(bars[0].time);

  const addLevel = (source: LiquiditySource, type: "high" | "low", start: number, confirmed: number, price: number, touches = 1) => {
    const level: LiquidityLevel = { source, type, price: Math.round(price * 100) / 100,
      startIndex: start, startTime: bars[start].time, confirmedIndex: confirmed, confirmedTime: bars[confirmed].time, touches, swept: false };
    levels.push(level);
    active.add(level);
    return level;
  };

  for (let index = 1; index < bars.length; index++) {
    // Yesterday's references are usable immediately today, not three sessions later.
    for (const level of active) if (level.source === "PDH" || level.source === "PDL") active.delete(level);
    addLevel("PDH", "high", index - 1, index - 1, bars[index - 1].high);
    addLevel("PDL", "low", index - 1, index - 1, bars[index - 1].low);
    const week = weekKey(bars[index].time);
    if (week !== currentWeek) {
      for (const level of active) if (level.source === "PWH" || level.source === "PWL") active.delete(level);
      // Ignore a truncated first calendar week: its true high/low may precede this snapshot.
      if (weekStart > 0 || new Date(`${bars[0].time}T00:00:00Z`).getUTCDay() === 1) {
        let high = weekStart;
        let low = weekStart;
        for (let cursor = weekStart + 1; cursor < index; cursor++) {
          if (bars[cursor].high > bars[high].high) high = cursor;
          if (bars[cursor].low < bars[low].low) low = cursor;
        }
        addLevel("PWH", "high", high, index - 1, bars[high].high);
        addLevel("PWL", "low", low, index - 1, bars[low].low);
      }
      weekStart = index;
      currentWeek = week;
    }

    for (const level of active) {
      const event = detectLevelSweep(bars, index, level);
      if (event) {
        Object.assign(level, { swept: true, sweepIndex: index, sweepTime: event.time });
        active.delete(level);
        sweeps.push(event);
      }
    }

    // A pivot at i-10 becomes known only after today's close; evaluate it from tomorrow.
    if (index < 20) continue;
    const pivot = index - 10;
    const window = bars.slice(pivot - 10, index + 1);
    const atr = atrAt(bars, index);
    for (const type of ["high", "low"] as const) {
      const value = bars[pivot][type];
      const strictPivot = window.every((bar, offset) => offset === 10 || (type === "high" ? bar.high < value : bar.low > value));
      const amplitude = type === "high" ? value - Math.min(...window.map(bar => bar.low)) : Math.max(...window.map(bar => bar.high)) - value;
      if (!strictPivot || amplitude < atr) continue;
      const cluster = clusters[type].find(group => Math.abs(value - group.points[0].price) / group.points[0].price <= 0.003);
      if (cluster) {
        active.delete(cluster.level);
        cluster.points.push({ index: pivot, price: value });
        const average = cluster.points.reduce((sum, point) => sum + point.price, 0) / cluster.points.length;
        cluster.level = addLevel(type === "high" ? "EQH" : "EQL", type, cluster.points[0].index, index, average, cluster.points.length);
      } else {
        const level = addLevel("Swing", type, pivot, index, value);
        clusters[type].push({ points: [{ index: pivot, price: value }], level });
      }
    }
  }
  return { levels: levels.filter(level => active.has(level) || level.swept), sweeps };
}
