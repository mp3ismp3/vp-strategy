export interface OHLCBar {
  time: string;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

export interface FVGGap {
  type: "bullish" | "bearish";
  gapHigh: number;
  gapLow: number;
  gapSize: number;
  barIndex: number;
  date: string;
  filled: boolean;
  fillPct: number;
}

function round(value: number): number {
  return Math.round(value * 100) / 100;
}

function calcAtr(ohlc: OHLCBar[], period = 14): number {
  if (ohlc.length < period + 1) return 0;
  const ranges = ohlc.slice(1).map((bar, index) =>
    Math.max(
      bar.high - bar.low,
      Math.abs(bar.high - ohlc[index].close),
      Math.abs(bar.low - ohlc[index].close)
    )
  );
  const recent = ranges.slice(-period);
  return recent.reduce((sum, value) => sum + value, 0) / recent.length;
}

function fillState(
  prices: number[],
  gapLow: number,
  gapHigh: number,
  type: FVGGap["type"]
): Pick<FVGGap, "filled" | "fillPct"> {
  if (prices.length === 0) return { filled: false, fillPct: 0 };
  const size = gapHigh - gapLow;
  if (size <= 0) return { filled: true, fillPct: 100 };

  const penetration = type === "bullish"
    ? gapHigh - Math.max(Math.min(...prices), gapLow)
    : Math.min(Math.max(...prices), gapHigh) - gapLow;
  const ratio = Math.max(0, Math.min(penetration / size, 1));
  return { filled: ratio === 1, fillPct: round(ratio * 100) };
}

export function detectFvgs(
  ohlc: OHLCBar[],
  lookback = 60,
  minGapAtrRatio = 0.5
): FVGGap[] {
  if (ohlc.length < 3) return [];
  const data = ohlc.slice(-lookback);
  const minimumGap = calcAtr(ohlc) * minGapAtrRatio;
  const gaps: FVGGap[] = [];

  for (let index = 1; index < data.length - 1; index += 1) {
    const previous = data[index - 1];
    const next = data[index + 1];
    if (next.low > previous.high && next.low - previous.high >= minimumGap) {
      const gapLow = previous.high;
      const gapHigh = next.low;
      gaps.push({
        type: "bullish",
        gapLow: round(gapLow),
        gapHigh: round(gapHigh),
        gapSize: round(gapHigh - gapLow),
        barIndex: index,
        date: data[index].time,
        ...fillState(data.slice(index + 1).map((bar) => bar.low), gapLow, gapHigh, "bullish"),
      });
    }
    if (previous.low > next.high && previous.low - next.high >= minimumGap) {
      const gapLow = next.high;
      const gapHigh = previous.low;
      gaps.push({
        type: "bearish",
        gapLow: round(gapLow),
        gapHigh: round(gapHigh),
        gapSize: round(gapHigh - gapLow),
        barIndex: index,
        date: data[index].time,
        ...fillState(data.slice(index + 1).map((bar) => bar.high), gapLow, gapHigh, "bearish"),
      });
    }
  }
  return gaps;
}
