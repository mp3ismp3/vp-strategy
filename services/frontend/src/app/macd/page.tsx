"use client";

import { useEffect, useState, useMemo } from "react";
import dynamic from "next/dynamic";
import type { Annotations, Data, Layout } from "plotly.js";
import { useSession } from "next-auth/react";
import { Badge } from "@/components/ui/badge";
import { SignalMosaic } from "@/components/SignalMosaic";
import {
  filterIndicatorItems,
  getIndicatorCategories,
  isIndicatorTickerAllowed,
} from "@/lib/preview-access";

const Plot = dynamic(() => import("react-plotly.js"), { ssr: false });

// ─── Types ───────────────────────────────────────────────────────────────────

interface OHLCBar {
  time: string;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

interface MACDPoint {
  time: string;
  macd: number;
  signal: number;
  histogram: number;
}

interface SwingPoint {
  index: number;
  price: number;
}

interface DivergenceSignal {
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

function calcMACD(
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

function macdTurningPoints(macdValues: number[], mode: "low" | "high"): SwingPoint[] {
  const n = macdValues.length;
  if (n < 3) return [];

  // Find zero-crossing boundaries
  const crossings: number[] = [0];
  for (let i = 1; i < n; i++) {
    if (macdValues[i] * macdValues[i - 1] < 0) {
      crossings.push(i);
    }
  }
  crossings.push(n);

  const points: SwingPoint[] = [];

  for (let segIdx = 0; segIdx < crossings.length - 1; segIdx++) {
    const segStart = crossings[segIdx];
    const segEnd = crossings[segIdx + 1];
    const seg = macdValues.slice(segStart, segEnd);

    if (seg.length < 2) continue;

    const segMean = seg.reduce((a, b) => a + b, 0) / seg.length;

    if (mode === "low" && segMean >= 0) continue;
    if (mode === "high" && segMean <= 0) continue;

    // Find turning points via derivative sign changes
    const segPoints: SwingPoint[] = [];
    const diff: number[] = [];
    for (let i = 1; i < seg.length; i++) {
      diff.push(seg[i] - seg[i - 1]);
    }

    for (let i = 1; i < diff.length; i++) {
      if (mode === "low" && diff[i - 1] < 0 && diff[i] >= 0) {
        segPoints.push({ index: segStart + i, price: seg[i] });
      } else if (mode === "high" && diff[i - 1] > 0 && diff[i] <= 0) {
        segPoints.push({ index: segStart + i, price: seg[i] });
      }
    }

    if (segPoints.length > 1) {
      // Filter insignificant points (< 15% of segment range)
      const segMin = Math.min(...seg);
      const segMax = Math.max(...seg);
      const segRange = segMax - segMin;
      if (segRange > 0) {
        const minSignificance = segRange * 0.15;
        const filtered: SwingPoint[] = [segPoints[0]];
        for (let i = 1; i < segPoints.length; i++) {
          const last = filtered[filtered.length - 1];
          if (Math.abs(segPoints[i].price - last.price) >= minSignificance) {
            filtered.push(segPoints[i]);
          } else if (mode === "low" && segPoints[i].price < last.price) {
            filtered[filtered.length - 1] = segPoints[i];
          } else if (mode === "high" && segPoints[i].price > last.price) {
            filtered[filtered.length - 1] = segPoints[i];
          }
        }
        points.push(...filtered);
      } else {
        points.push(...segPoints);
      }
    } else if (segPoints.length === 1) {
      points.push(...segPoints);
    } else {
      // Fallback: absolute extremum of segment
      if (mode === "low") {
        const minVal = Math.min(...seg);
        const minIdx = seg.indexOf(minVal);
        points.push({ index: segStart + minIdx, price: minVal });
      } else {
        const maxVal = Math.max(...seg);
        const maxIdx = seg.indexOf(maxVal);
        points.push({ index: segStart + maxIdx, price: maxVal });
      }
    }
  }

  return points;
}

function detectDivergence(
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

function resampleToWeekly(ohlc: OHLCBar[]): OHLCBar[] {
  if (ohlc.length === 0) return [];
  const weeks: OHLCBar[][] = [];
  let currentWeek: OHLCBar[] = [];

  for (const bar of ohlc) {
    const d = new Date(bar.time);
    const dayOfWeek = d.getDay();
    // Start new week on Monday (or if first bar)
    if (dayOfWeek === 1 && currentWeek.length > 0) {
      weeks.push(currentWeek);
      currentWeek = [];
    }
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

// ─── Chart Component ─────────────────────────────────────────────────────────

interface MACDChartProps {
  ohlc: OHLCBar[];
  macdData: MACDPoint[];
  divergences: DivergenceSignal[];
  title: string;
}

function MACDChart({ ohlc, macdData, divergences, title }: MACDChartProps) {
  const times = ohlc.map((b) => b.time);

  // Candlestick
  const candlestick: Data = {
    type: "candlestick",
    x: times,
    open: ohlc.map((b) => b.open),
    high: ohlc.map((b) => b.high),
    low: ohlc.map((b) => b.low),
    close: ohlc.map((b) => b.close),
    increasing: { line: { color: "#26a69a" } },
    decreasing: { line: { color: "#ef5350" } },
    name: "Price",
    xaxis: "x",
    yaxis: "y",
  };

  // MACD Histogram
  const histColors = macdData.map((m) => (m.histogram >= 0 ? "#26a69a" : "#ef5350"));
  const histTrace: Data = {
    type: "bar",
    x: times,
    y: macdData.map((m) => m.histogram),
    marker: { color: histColors },
    name: "Histogram",
    xaxis: "x2",
    yaxis: "y2",
    showlegend: false,
  };

  // MACD Line
  const macdLine: Data = {
    type: "scatter",
    x: times,
    y: macdData.map((m) => m.macd),
    line: { color: "#2962FF", width: 1.5 },
    name: "MACD",
    xaxis: "x2",
    yaxis: "y2",
  };

  // Signal Line
  const signalLine: Data = {
    type: "scatter",
    x: times,
    y: macdData.map((m) => m.signal),
    line: { color: "#FF6D00", width: 1.5 },
    name: "Signal",
    xaxis: "x2",
    yaxis: "y2",
  };

  // Divergence annotations
  const annotations: Partial<Annotations>[] = divergences.map((div) => ({
    x: div.time,
    y: div.type === "bullish" ? div.priceSwingCurr : div.priceSwingCurr,
    xref: "x",
    yref: "y",
    text: div.type === "bullish" ? "🟢 Bull Div" : "🔴 Bear Div",
    showarrow: true,
    arrowhead: 2,
    arrowcolor: div.type === "bullish" ? "#4caf50" : "#f44336",
    ay: div.type === "bullish" ? 30 : -30,
    font: { size: 10, color: div.type === "bullish" ? "#4caf50" : "#f44336" },
  }));

  const layout: Partial<Layout> = {
    height: 450,
    margin: { l: 60, r: 20, t: 40, b: 30 },
    showlegend: true,
    legend: { x: 0, y: 1.12, orientation: "h", font: { size: 11 } },
    paper_bgcolor: "white",
    plot_bgcolor: "white",
    title: { text: title, font: { size: 14 } },
    xaxis: {
      domain: [0, 1],
      anchor: "y",
      showticklabels: false,
      rangeslider: { visible: false },
      type: "category",
    },
    xaxis2: {
      domain: [0, 1],
      anchor: "y2",
      type: "category",
      tickangle: -45,
      nticks: 10,
    },
    yaxis: {
      domain: [0.38, 1],
      title: { text: "Price ($)" },
      showgrid: true,
      gridcolor: "rgba(0,0,0,0.04)",
    },
    yaxis2: {
      domain: [0, 0.32],
      title: { text: "MACD" },
      showgrid: true,
      gridcolor: "rgba(0,0,0,0.04)",
    },
    annotations,
  };

  return (
    <Plot
      data={[candlestick, histTrace, macdLine, signalLine]}
      layout={layout}
      config={{ displayModeBar: true, responsive: true }}
      style={{ width: "100%" }}
    />
  );
}

// ─── Main Page ───────────────────────────────────────────────────────────────

interface ScanResult {
  ticker: string;
  dailyDivs: DivergenceSignal[];
  weeklyDivs: DivergenceSignal[];
  isDual: boolean; // 日線+周線同向背離
  dualType?: "bullish" | "bearish";
}

export default function MACDPage() {
  const { data: session } = useSession();
  const accessPlan = (session?.user as { plan?: "free" | "pro" | "premium" } | undefined)?.plan ?? "free";
  const isPaid = accessPlan === "pro" || accessPlan === "premium";
  const [selectedTicker, setSelectedTicker] = useState("NVDA");
  const [ohlc, setOhlc] = useState<OHLCBar[]>([]);
  const [loadedTicker, setLoadedTicker] = useState<string | null>(null);
  const [scanning, setScanning] = useState(false);
  const [scanResults, setScanResults] = useState<ScanResult[]>([]);

  const indicatorCategories = useMemo(
    () => getIndicatorCategories(accessPlan),
    [accessPlan]
  );
  const effectiveTicker = isIndicatorTickerAllowed(selectedTicker, accessPlan)
    ? selectedTicker
    : "NVDA";
  const loading = loadedTicker !== effectiveTicker;

  // Fetch OHLC for selected ticker
  useEffect(() => {
    let cancelled = false;
    fetch(`/api/data/chart-data?ticker=${encodeURIComponent(effectiveTicker)}`)
      .then(async (response) => response.ok ? response.json() : Promise.reject())
      .then((chart) => {
        if (!cancelled) setOhlc(chart?.daily?.ohlc || []);
      })
      .catch(() => {
        if (!cancelled) setOhlc([]);
      })
      .finally(() => {
        if (!cancelled) setLoadedTicker(effectiveTicker);
      });
    return () => {
      cancelled = true;
    };
  }, [effectiveTicker]);

  // Compute MACD and divergences for selected ticker
  const dailyMACD = useMemo(() => {
    if (ohlc.length === 0) return null;
    const closes = ohlc.map((b) => b.close);
    const result = calcMACD(closes);
    if (!result) return null;
    return result.map((m, i) => ({ ...m, time: ohlc[i].time }));
  }, [ohlc]);

  const weeklyOHLC = useMemo(() => resampleToWeekly(ohlc), [ohlc]);

  const weeklyMACD = useMemo(() => {
    if (weeklyOHLC.length === 0) return null;
    const closes = weeklyOHLC.map((b) => b.close);
    const result = calcMACD(closes);
    if (!result) return null;
    return result.map((m, i) => ({ ...m, time: weeklyOHLC[i].time }));
  }, [weeklyOHLC]);

  const dailyDivergences = useMemo(() => {
    if (!dailyMACD) return [];
    const divs = detectDivergence(ohlc, dailyMACD, 60, 5);
    return divs.map((d) => ({ ...d, timeframe: "daily" as const }));
  }, [ohlc, dailyMACD]);

  const weeklyDivergences = useMemo(() => {
    if (!weeklyMACD) return [];
    const divs = detectDivergence(weeklyOHLC, weeklyMACD, 30, 3);
    return divs.map((d) => ({ ...d, timeframe: "weekly" as const }));
  }, [weeklyOHLC, weeklyMACD]);

  // Scan all tickers for divergences
  const handleScan = async () => {
    setScanning(true);
    const response = await fetch("/api/data/chart-data?include=data");
    const chartRows = (response.ok ? await response.json() : {}) as Record<
      string,
      { daily?: { ohlc?: OHLCBar[] } }
    >;
    const rows = Object.entries(chartRows).map(([ticker, data]) => ({ ticker, data }));

    const results: ScanResult[] = [];

    if (rows) {
      for (const row of filterIndicatorItems(rows, accessPlan)) {
        const dailyOhlc: OHLCBar[] = row.data?.daily?.ohlc || [];
        if (dailyOhlc.length < 60) continue;

        const closes = dailyOhlc.map((b: OHLCBar) => b.close);
        const dMacd = calcMACD(closes);
        if (!dMacd) continue;
        const dMacdWithTime = dMacd.map((m, i) => ({ ...m, time: dailyOhlc[i].time }));
        const dDivs = detectDivergence(dailyOhlc, dMacdWithTime, 60, 5);
        const dailyDivs = dDivs.map((d) => ({ ...d, timeframe: "daily" as const }));

        const wOhlc = resampleToWeekly(dailyOhlc);
        let weeklyDivs: DivergenceSignal[] = [];
        if (wOhlc.length >= 35) {
          const wCloses = wOhlc.map((b) => b.close);
          const wMacd = calcMACD(wCloses);
          if (wMacd) {
            const wMacdWithTime = wMacd.map((m, i) => ({ ...m, time: wOhlc[i].time }));
            const wDivs = detectDivergence(wOhlc, wMacdWithTime, 30, 3);
            weeklyDivs = wDivs.map((d) => ({ ...d, timeframe: "weekly" as const }));
          }
        }

        if (dailyDivs.length > 0 || weeklyDivs.length > 0) {
          // Check dual divergence (same direction on both timeframes)
          let isDual = false;
          let dualType: "bullish" | "bearish" | undefined;

          for (const dd of dailyDivs) {
            for (const wd of weeklyDivs) {
              if (dd.type === wd.type) {
                isDual = true;
                dualType = dd.type;
                break;
              }
            }
            if (isDual) break;
          }

          results.push({
            ticker: row.ticker,
            dailyDivs,
            weeklyDivs,
            isDual,
            dualType,
          });
        }
      }
    }

    // Sort: dual first, then by most recent
    results.sort((a, b) => {
      if (a.isDual && !b.isDual) return -1;
      if (!a.isDual && b.isDual) return 1;
      const aMin = Math.min(
        ...a.dailyDivs.map((d) => d.barsAgo),
        ...a.weeklyDivs.map((d) => d.barsAgo),
        999
      );
      const bMin = Math.min(
        ...b.dailyDivs.map((d) => d.barsAgo),
        ...b.weeklyDivs.map((d) => d.barsAgo),
        999
      );
      return aMin - bMin;
    });

    setScanResults(results);
    setScanning(false);
  };

  // Auto-scan all tickers on page load
  useEffect(() => {
    const timeoutId = window.setTimeout(() => void handleScan(), 0);
    return () => window.clearTimeout(timeoutId);
  }, [accessPlan]); // eslint-disable-line react-hooks/exhaustive-deps

  // Categorize scan results
  const dualResults = scanResults.filter((r) => r.isDual);
  const dailyOnlyResults = scanResults.filter((r) => !r.isDual && r.dailyDivs.length > 0);
  const weeklyOnlyResults = scanResults.filter((r) => !r.isDual && r.weeklyDivs.length > 0);

  return (
    <div className="max-w-7xl mx-auto px-4 py-8">
      {/* Header */}
      <div className="mb-6">
        <h1 className="text-3xl font-bold">📉 MACD Divergence</h1>
        <p className="text-gray-600 mt-1">
          日線 + 周線 MACD 背離偵測 — 找出動能與價格背離的標的
        </p>
      </div>

      {/* Controls */}
      <div className="bg-white rounded-xl border p-4 mb-6 flex flex-wrap gap-4 items-center">
        <div className="flex items-center gap-2">
          <label className="text-sm font-medium text-gray-700">標的：</label>
          <select
            value={effectiveTicker}
            onChange={(e) => setSelectedTicker(e.target.value)}
            className="border rounded-md px-3 py-1.5 text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
          >
            {Object.entries(indicatorCategories).map(([category, tickers]) => (
              <optgroup key={category} label={category}>
                {tickers.map((t) => (
                  <option key={t} value={t}>{t}</option>
                ))}
              </optgroup>
            ))}
          </select>
        </div>

        {scanning && (
          <div className="ml-auto flex items-center gap-2 text-sm text-gray-500">
            <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-gray-900" />
            掃描中...
          </div>
        )}
      </div>

      {/* Charts remain visible in the guest preview. */}
      <div className="space-y-6 mb-8">
        {/* Daily MACD Chart */}
        <div className="bg-white rounded-xl border p-4">
          {loading ? (
            <div className="flex items-center justify-center h-[450px]">
              <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-gray-900" />
            </div>
          ) : ohlc.length === 0 ? (
            <div className="flex items-center justify-center h-[450px] text-gray-500">
              無 {effectiveTicker} 圖表數據。請先執行 export_frontend_data.py
            </div>
          ) : dailyMACD ? (
            <MACDChart
              ohlc={ohlc}
              macdData={dailyMACD}
              divergences={dailyDivergences}
              title={`${effectiveTicker} 日線 MACD (Daily)`}
            />
          ) : (
            <div className="flex items-center justify-center h-[450px] text-gray-500">
              數據不足，無法計算 MACD
            </div>
          )}
        </div>

        {/* Weekly MACD Chart */}
        <div className="bg-white rounded-xl border p-4">
          {loading ? (
            <div className="flex items-center justify-center h-[450px]">
              <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-gray-900" />
            </div>
          ) : weeklyOHLC.length === 0 ? (
            <div className="flex items-center justify-center h-[450px] text-gray-500">
              無周線數據
            </div>
          ) : weeklyMACD ? (
            <MACDChart
              ohlc={weeklyOHLC}
              macdData={weeklyMACD}
              divergences={weeklyDivergences}
              title={`${effectiveTicker} 周線 MACD (Weekly)`}
            />
          ) : (
            <div className="flex items-center justify-center h-[450px] text-gray-500">
              周線數據不足，無法計算 MACD
            </div>
          )}
        </div>
      </div>

      {/* Signal details */}
      <SignalMosaic locked={!isPaid}>
        {(dailyDivergences.length > 0 || weeklyDivergences.length > 0) && (
          <div className="bg-white rounded-xl border p-4 mb-6 flex flex-wrap gap-3">
            {dailyDivergences.map((d, i) => (
              <Badge key={`d-${i}`} className={d.type === "bullish" ? "bg-green-100 text-green-800" : "bg-red-100 text-red-800"}>
                {d.type === "bullish" ? "🟢" : "🔴"} 日線{d.type === "bullish" ? "看漲" : "看跌"}背離 ({d.barsAgo} bars ago)
              </Badge>
            ))}
            {weeklyDivergences.map((d, i) => (
              <Badge key={`w-${i}`} className={d.type === "bullish" ? "bg-green-100 text-green-800" : "bg-red-100 text-red-800"}>
                {d.type === "bullish" ? "🟢" : "🔴"} 周線{d.type === "bullish" ? "看漲" : "看跌"}背離 ({d.barsAgo} bars ago)
              </Badge>
            ))}
            {dailyDivergences.some((d) => weeklyDivergences.some((w) => w.type === d.type)) && (
              <Badge className="bg-orange-100 text-orange-800 font-bold">
                🔥 日線+周線雙重背離
              </Badge>
            )}
          </div>
        )}
        {scanResults.length > 0 && (
          <div className="space-y-6">
          {/* 🔥 Dual Divergence */}
          {dualResults.length > 0 && (
            <div className="bg-white rounded-xl border p-6">
              <h2 className="text-xl font-bold mb-4">🔥 雙重背離（日線 + 周線同向）</h2>
              <p className="text-sm text-gray-500 mb-4">最強訊號：兩個時間框架都確認動能背離</p>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b bg-gray-50">
                      <th className="text-left p-3">標的</th>
                      <th className="text-left p-3">方向</th>
                      <th className="text-left p-3">日線 (bars ago)</th>
                      <th className="text-left p-3">周線 (bars ago)</th>
                    </tr>
                  </thead>
                  <tbody>
                    {dualResults.map((r) => (
                      <tr key={r.ticker} className="border-b hover:bg-gray-50 cursor-pointer" onClick={() => setSelectedTicker(r.ticker)}>
                        <td className="p-3 font-bold">{r.ticker}</td>
                        <td className="p-3">
                          <Badge className={r.dualType === "bullish" ? "bg-green-100 text-green-800" : "bg-red-100 text-red-800"}>
                            {r.dualType === "bullish" ? "🟢 看漲" : "🔴 看跌"}
                          </Badge>
                        </td>
                        <td className="p-3">{r.dailyDivs.find((d) => d.type === r.dualType)?.barsAgo ?? "-"}</td>
                        <td className="p-3">{r.weeklyDivs.find((d) => d.type === r.dualType)?.barsAgo ?? "-"}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {/* Daily Only */}
          {dailyOnlyResults.length > 0 && (
            <div className="bg-white rounded-xl border p-6">
              <h2 className="text-xl font-bold mb-4">📊 日線背離</h2>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b bg-gray-50">
                      <th className="text-left p-3">標的</th>
                      <th className="text-left p-3">方向</th>
                      <th className="text-left p-3">Bars Ago</th>
                      <th className="text-left p-3">日期</th>
                    </tr>
                  </thead>
                  <tbody>
                    {dailyOnlyResults.map((r) =>
                      r.dailyDivs.map((d, i) => (
                        <tr key={`${r.ticker}-${i}`} className="border-b hover:bg-gray-50 cursor-pointer" onClick={() => setSelectedTicker(r.ticker)}>
                          <td className="p-3 font-bold">{r.ticker}</td>
                          <td className="p-3">
                            <Badge className={d.type === "bullish" ? "bg-green-100 text-green-800" : "bg-red-100 text-red-800"}>
                              {d.type === "bullish" ? "🟢 看漲" : "🔴 看跌"}
                            </Badge>
                          </td>
                          <td className="p-3">{d.barsAgo}</td>
                          <td className="p-3 font-mono text-gray-600">{d.time}</td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {/* Weekly Only */}
          {weeklyOnlyResults.length > 0 && (
            <div className="bg-white rounded-xl border p-6">
              <h2 className="text-xl font-bold mb-4">📅 周線背離</h2>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b bg-gray-50">
                      <th className="text-left p-3">標的</th>
                      <th className="text-left p-3">方向</th>
                      <th className="text-left p-3">Bars Ago</th>
                      <th className="text-left p-3">日期</th>
                    </tr>
                  </thead>
                  <tbody>
                    {weeklyOnlyResults.map((r) =>
                      r.weeklyDivs.map((d, i) => (
                        <tr key={`${r.ticker}-${i}`} className="border-b hover:bg-gray-50 cursor-pointer" onClick={() => setSelectedTicker(r.ticker)}>
                          <td className="p-3 font-bold">{r.ticker}</td>
                          <td className="p-3">
                            <Badge className={d.type === "bullish" ? "bg-green-100 text-green-800" : "bg-red-100 text-red-800"}>
                              {d.type === "bullish" ? "🟢 看漲" : "🔴 看跌"}
                            </Badge>
                          </td>
                          <td className="p-3">{d.barsAgo}</td>
                          <td className="p-3 font-mono text-gray-600">{d.time}</td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {/* Summary */}
          <div className="text-center text-sm text-gray-500">
            共掃描到 {scanResults.length} 檔有背離訊號 | 🔥 雙重: {dualResults.length} | 日線: {dailyOnlyResults.length} | 周線: {weeklyOnlyResults.length}
          </div>
          </div>
        )}
      </SignalMosaic>
    </div>
  );
}
