import type { OHLCBar } from "./macd";

export interface RvolSignal {
  type: "breakout" | "retest" | "waiting" | "reclaimed";
  label: string;
  level: number;
  breakoutRvol: number | null;
}

export interface RvolSetup {
  status: "breakout" | "waiting" | "retest" | "reclaimed" | "invalidated" | "expired";
  label: string;
  level: number;
  tolerance: number;
  breakoutDate: string;
  breakoutRvol: number | null;
  eventDate: string;
  eventRvol: number | null;
  age: number;
}

export interface RvolAnalysis {
  setup: RvolSetup | null;
  asOf: string | null;
  baselineStart: string | null;
  baselineEnd: string | null;
  distancePct: number | null;
  rvol: number | null;
  volumeLabel: string;
  signal: RvolSignal | null;
}

export function classifyRvol(rvol: number): string {
  if (!Number.isFinite(rvol) || rvol < 0) return "資料不足";
  if (rvol < 0.7) return "明顯縮量";
  if (rvol < 1) return "普通";
  if (rvol < 1.5) return "有量";
  if (rvol <= 2) return "明顯放量";
  return "異常大量";
}

export function relativeVolume(bars: OHLCBar[], index: number): number | null {
  if (!Number.isInteger(index) || index < 20 || index >= bars.length) return null;
  const volumes = bars.slice(index - 20, index + 1).map(b => b.volume);
  if (volumes.some(v => !Number.isFinite(v) || v < 0)) return null;
  const average = volumes.slice(0, 20).reduce((sum, v) => sum + v, 0) / 20;
  return average > 0 ? volumes[20] / average : null;
}

function breakoutLevel(bars: OHLCBar[], index: number): number | null {
  if (index < 20) return null;
  const window = bars.slice(index - 20, index + 1);
  if (window.some(b => !Number.isFinite(b.high) || !Number.isFinite(b.low) ||
    !Number.isFinite(b.close) || b.low <= 0 || b.high < b.low || b.close < b.low || b.close > b.high)) return null;
  const level = Math.max(...window.slice(0, 20).map(b => b.high));
  return bars[index].close > level && bars[index - 1].close <= level ? level : null;
}

/** Supplied bars must be completed daily sessions, ordered oldest to newest. */
export function analyzeRvol(bars: OHLCBar[]): RvolAnalysis {
  const index = bars.length - 1;
  const rvol = relativeVolume(bars, index);
  let setup: RvolSetup | null = null;
  let startIndex = -1;
  for (let i = 20; i <= index; i++) {
    const bar = bars[i];
    if (![bar.low, bar.high, bar.close].every(Number.isFinite) ||
      bar.low <= 0 || bar.close < bar.low || bar.close > bar.high) {
      setup = null;
      continue;
    }
    const volume = relativeVolume(bars, i);
    if (setup) {
      setup.age = i - startIndex;
      if (setup.age > 20) setup = null;
      else if (!["invalidated", "expired"].includes(setup.status)) {
        if (setup.age > 10) {
          setup.status = "expired"; setup.label = "觀察期結束";
          setup.eventDate = bar.time; setup.eventRvol = volume;
        } else if (bar.close < setup.level) {
          setup.status = "invalidated"; setup.label = "收盤跌破失效";
          setup.eventDate = bar.time; setup.eventRvol = volume;
        } else if (Number.isFinite(bar.low) && bar.low <= setup.level + setup.tolerance && volume !== null) {
          setup.status = bar.low < setup.level - setup.tolerance ? "reclaimed" : "retest";
          setup.label = setup.status === "reclaimed" ? "跌破後收復" : volume < 0.7 ? "回踩縮量" : volume >= 1.5 ? "回踩放量" : "回踩量能普通";
          setup.eventDate = bar.time; setup.eventRvol = volume;
        } else if (setup.status === "breakout") {
          setup.status = "waiting"; setup.label = "等待回踩";
        }
      }
    }
    // Keep a live setup anchored to its original breakout, even on new highs.
    if (!setup || ["invalidated", "expired"].includes(setup.status)) {
      const level = breakoutLevel(bars, i);
      if (level !== null && volume !== null) {
        const ranges = bars.slice(i - 14, i).map((b, j) => Math.max(b.high - b.low,
          Math.abs(b.high - bars[i - 15 + j].close), Math.abs(b.low - bars[i - 15 + j].close)));
        const atr = ranges.reduce((sum, value) => sum + value, 0) / 14;
        setup = {
          status: "breakout", label: volume >= 1.5 ? "突破放量" : volume < 1 ? "突破量不足" : "突破量能普通",
          level, tolerance: Math.min(level * 0.005, atr * 0.25), breakoutDate: bar.time,
          breakoutRvol: volume, eventDate: bar.time, eventRvol: volume, age: 0,
        };
        startIndex = i;
      }
    }
  }
  const active = setup && !["invalidated", "expired"].includes(setup.status);
  return {
    rvol, volumeLabel: rvol === null ? "資料不足" : classifyRvol(rvol), setup,
    asOf: bars.at(-1)?.time ?? null,
    baselineStart: index >= 20 ? bars[index - 20].time : null,
    baselineEnd: index >= 20 ? bars[index - 1].time : null,
    distancePct: setup ? (bars[index].close / setup.level - 1) * 100 : null,
    signal: setup && active && rvol !== null ? {
      type: setup.status as RvolSignal["type"], label: setup.label, level: setup.level, breakoutRvol: setup.breakoutRvol,
    } : null,
  };
}
