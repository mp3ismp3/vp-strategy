export interface OHLCBar {
  time: string;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

export interface MACDPoint {
  time: string;
  macd: number;
  signal: number;
  histogram: number;
}

interface SwingPoint {
  index: number;
  price: number;
}

export interface DivergenceSignal {
  type: "bullish" | "bearish";
  timeframe: "daily" | "weekly";
  barsAgo: number;
  priceSwingPrev: number;
  priceSwingCurr: number;
  macdSwingPrev: number;
  macdSwingCurr: number;
  time: string;
}

// ─── Algorithms ──────────────────────────────────────────────────────────────

function calcEMA(data: number[], period: number): number[] {
  const result: number[] = [];
  const k = 2 / (period + 1);
  result[0] = data[0];
  for (let i = 1; i < data.length; i++) {
    result[i] = data[i] * k + result[i - 1] * (1 - k);
  }
  return result;
}

export function calcMACD(
  closes: number[],
  fast = 12,
  slow = 26,
  sig = 9
): MACDPoint[] | null {
  if (closes.length < slow + sig) return null;

  const emaFast = calcEMA(closes, fast);
  const emaSlow = calcEMA(closes, slow);
  const macdLine = emaFast.map((v, i) => v - emaSlow[i]);
  const signalLine = calcEMA(macdLine, sig);
  const histogram = macdLine.map((v, i) => v - signalLine[i]);

  return closes.map((_, i) => ({
    time: "",
    macd: macdLine[i],
    signal: signalLine[i],
    histogram: histogram[i],
  }));
}

function findSwingHighs(values: number[], lookback: number): SwingPoint[] {
  const points: SwingPoint[] = [];
  for (let i = lookback; i < values.length - lookback; i++) {
    let isHigh = true;
    for (let j = i - lookback; j <= i + lookback; j++) {
      if (j === i) continue;
      if (values[j] >= values[i]) { isHigh = false; break; }
    }
    if (isHigh) points.push({ index: i, price: values[i] });
  }
  return points;
}

function findSwingLows(values: number[], lookback: number): SwingPoint[] {
  const points: SwingPoint[] = [];
  for (let i = lookback; i < values.length - lookback; i++) {
    let isLow = true;
    for (let j = i - lookback; j <= i + lookback; j++) {
      if (j === i) continue;
      if (values[j] <= values[i]) { isLow = false; break; }
    }
    if (isLow) points.push({ index: i, price: values[i] });
  }
  return points;
}

export function macdTurningPoints(macdValues: number[], mode: "low" | "high"): SwingPoint[] {
  const n = macdValues.length;
  if (n < 3) return [];

  // Keep zero separate so a crossing through zero cannot merge opposite signs.
  const crossings: number[] = [0];
  for (let i = 1; i < n; i++) {
    if (Math.sign(macdValues[i]) !== Math.sign(macdValues[i - 1])) crossings.push(i);
  }
  crossings.push(n);
  const points: SwingPoint[] = [];

  for (let segIdx = 0; segIdx < crossings.length - 1; segIdx++) {
    const segStart = crossings[segIdx];
    const segEnd = crossings[segIdx + 1];
    const seg = macdValues.slice(segStart, segEnd);
    if (mode === "low" && seg[0] >= 0) continue;
    if (mode === "high" && seg[0] <= 0) continue;

    // Include available neighbours to confirm turns at zero crossings.
    const contextStart = Math.max(0, segStart - 1);
    const contextEnd = Math.min(n, segEnd + 1);
    const segPoints: SwingPoint[] = [];
    let previousSlope = 0;
    let previousIndex = -1;
    for (let i = contextStart; i < contextEnd - 1; i++) {
      const slope = macdValues[i + 1] - macdValues[i];
      if (slope === 0) continue;
      const index = previousIndex + 1;
      if (index >= segStart && index < segEnd && (
        (mode === "low" && previousSlope < 0 && slope > 0) ||
        (mode === "high" && previousSlope > 0 && slope < 0)
      )) {
        segPoints.push({ index, price: macdValues[index] });
      }
      previousSlope = slope;
      previousIndex = i;
    }

    // Preserve the existing 15% within-segment significance filter.
    const minSignificance = (Math.max(...seg) - Math.min(...seg)) * 0.15;
    const filtered: SwingPoint[] = [];
    for (const point of segPoints) {
      const last = filtered[filtered.length - 1];
      if (!last || Math.abs(point.price - last.price) >= minSignificance) {
        filtered.push(point);
      } else if ((mode === "low" && point.price < last.price) ||
                 (mode === "high" && point.price > last.price)) {
        filtered[filtered.length - 1] = point;
      }
    }
    points.push(...filtered);
  }

  return points;
}

export function detectDivergence(
  ohlc: OHLCBar[],
  macdData: MACDPoint[],
  lookback: number = 60,
  swingLookback: number = 5,
  maxBarsAgo: number = 10
): DivergenceSignal[] {
  const signals: DivergenceSignal[] = [];
  const n = ohlc.length;
  if (n < lookback) return signals;

  const startIdx = n - lookback;
  const priceLows = ohlc.map((b) => b.low);
  const priceHighs = ohlc.map((b) => b.high);
  const macdValues = macdData.map((m) => m.macd);

  // MACD turning points via zero-crossing (parameter-free)
  const mLows = macdTurningPoints(macdValues.slice(startIdx), "low");
  const mHighs = macdTurningPoints(macdValues.slice(startIdx), "high");

  // Price swing lows (still uses lookback for raw price)
  const pLows = findSwingLows(priceLows.slice(startIdx), swingLookback);

  // Bullish divergence: price lower low, MACD higher low
  if (pLows.length >= 2 && mLows.length >= 2) {
    const pLow1 = pLows[pLows.length - 2];
    const pLow2 = pLows[pLows.length - 1];

    const mLow1 = findClosestSwing(mLows, pLow1.index);
    const mLow2 = findClosestSwing(mLows, pLow2.index);

    if (mLow1 && mLow2) {
      const barsAgo = lookback - 1 - pLow2.index;
      if (pLow2.price < pLow1.price && mLow2.price > mLow1.price && barsAgo <= maxBarsAgo) {
        const realIdx = startIdx + pLow2.index;
        signals.push({
          type: "bullish",
          timeframe: "daily",
          barsAgo,
          priceSwingPrev: pLow1.price,
          priceSwingCurr: pLow2.price,
          macdSwingPrev: mLow1.price,
          macdSwingCurr: mLow2.price,
          time: ohlc[realIdx]?.time || "",
        });
      }
    }
  }

  // Price swing highs
  const pHighs = findSwingHighs(priceHighs.slice(startIdx), swingLookback);

  // Bearish divergence: price higher high, MACD lower high
  if (pHighs.length >= 2 && mHighs.length >= 2) {
    const pHigh1 = pHighs[pHighs.length - 2];
    const pHigh2 = pHighs[pHighs.length - 1];

    const mHigh1 = findClosestSwing(mHighs, pHigh1.index);
    const mHigh2 = findClosestSwing(mHighs, pHigh2.index);

    if (mHigh1 && mHigh2) {
      const barsAgo = lookback - 1 - pHigh2.index;
      if (pHigh2.price > pHigh1.price && mHigh2.price < mHigh1.price && barsAgo <= maxBarsAgo) {
        const realIdx = startIdx + pHigh2.index;
        signals.push({
          type: "bearish",
          timeframe: "daily",
          barsAgo,
          priceSwingPrev: pHigh1.price,
          priceSwingCurr: pHigh2.price,
          macdSwingPrev: mHigh1.price,
          macdSwingCurr: mHigh2.price,
          time: ohlc[realIdx]?.time || "",
        });
      }
    }
  }

  return signals;
}

function findClosestSwing(swings: SwingPoint[], targetIdx: number): SwingPoint | null {
  let best: SwingPoint | null = null;
  let bestDist = 6; // tolerance
  for (const s of swings) {
    const dist = Math.abs(s.index - targetIdx);
    if (dist < bestDist) {
      bestDist = dist;
      best = s;
    }
  }
  return best;
}

export function resampleToWeekly(ohlc: OHLCBar[]): OHLCBar[] {
  if (ohlc.length === 0) return [];
  const weeks: OHLCBar[][] = [];
  let currentWeek: OHLCBar[] = [];
  let currentWeekKey = "";

  for (const bar of ohlc) {
    // Daily payload dates are YYYY-MM-DD. UTC avoids browser timezone shifts.
    const d = new Date(`${bar.time.slice(0, 10)}T00:00:00Z`);
    d.setUTCDate(d.getUTCDate() - (d.getUTCDay() + 6) % 7);
    const weekKey = d.toISOString().slice(0, 10);
    if (weekKey !== currentWeekKey && currentWeek.length > 0) {
      weeks.push(currentWeek);
      currentWeek = [];
    }
    currentWeekKey = weekKey;
    currentWeek.push(bar);
  }
  if (currentWeek.length > 0) weeks.push(currentWeek);

  return weeks.map((week) => ({
    time: week[week.length - 1].time,
    open: week[0].open,
    high: Math.max(...week.map((b) => b.high)),
    low: Math.min(...week.map((b) => b.low)),
    close: week[week.length - 1].close,
    volume: week.reduce((sum, b) => sum + b.volume, 0),
  }));
}

