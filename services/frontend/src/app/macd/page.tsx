"use client";

import { useEffect, useState, useMemo } from "react";
import dynamic from "next/dynamic";
import { Badge } from "@/components/ui/badge";
import { SYMBOL_CATEGORIES } from "@/lib/categories";

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

function detectSwingPointsFromArray(
  values: number[],
  lookback: number = 5
): SwingPoint[] {
  const highs: SwingPoint[] = [];
  const lows: SwingPoint[] = [];

  for (let i = lookback; i < values.length - lookback; i++) {
    let isHigh = true;
    let isLow = true;
    for (let j = i - lookback; j <= i + lookback; j++) {
      if (j === i) continue;
      if (values[j] >= values[i]) isHigh = false;
      if (values[j] <= values[i]) isLow = false;
    }
    if (isHigh) highs.push({ index: i, price: values[i] });
    if (isLow) lows.push({ index: i, price: values[i] });
  }

  return [...highs.map((h) => ({ ...h, _type: "high" as const })),
          ...lows.map((l) => ({ ...l, _type: "low" as const }))];
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

  // Swing lows in price and MACD
  const pLows = findSwingLows(priceLows.slice(startIdx), swingLookback);
  const mLows = findSwingLows(macdValues.slice(startIdx), swingLookback);

  // Bullish divergence: price lower low, MACD higher low
  if (pLows.length >= 2 && mLows.length >= 2) {
    const pLow1 = pLows[pLows.length - 2];
    const pLow2 = pLows[pLows.length - 1];

    // Find MACD low closest to each price low
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

  // Swing highs in price and MACD
  const pHighs = findSwingHighs(priceHighs.slice(startIdx), swingLookback);
  const mHighs = findSwingHighs(macdValues.slice(startIdx), swingLookback);

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
  ticker: string;
  ohlc: OHLCBar[];
  macdData: MACDPoint[];
  divergences: DivergenceSignal[];
  title: string;
}

function MACDChart({ ticker, ohlc, macdData, divergences, title }: MACDChartProps) {
  const times = ohlc.map((b) => b.time);

  // Candlestick
  const candlestick: any = {
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
  const histTrace: any = {
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
  const macdLine: any = {
    type: "scatter",
    x: times,
    y: macdData.map((m) => m.macd),
    line: { color: "#2962FF", width: 1.5 },
    name: "MACD",
    xaxis: "x2",
    yaxis: "y2",
  };

  // Signal Line
  const signalLine: any = {
    type: "scatter",
    x: times,
    y: macdData.map((m) => m.signal),
    line: { color: "#FF6D00", width: 1.5 },
    name: "Signal",
    xaxis: "x2",
    yaxis: "y2",
  };

  // Divergence annotations
  const annotations: any[] = divergences.map((div) => ({
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

  const layout: any = {
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
      title: "Price ($)",
      showgrid: true,
      gridcolor: "rgba(0,0,0,0.04)",
    },
    yaxis2: {
      domain: [0, 0.32],
      title: "MACD",
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
  const [selectedTicker, setSelectedTicker] = useState("NVDA");
  const [ohlc, setOhlc] = useState<OHLCBar[]>([]);
  const [loading, setLoading] = useState(true);
  const [scanning, setScanning] = useState(false);
  const [scanResults, setScanResults] = useState<ScanResult[]>([]);
  const [swingLookback, setSwingLookback] = useState(5);

  const allTickers = useMemo(
    () => Object.values(SYMBOL_CATEGORIES).flat().sort(),
    []
  );

  // Fetch OHLC for selected ticker
  useEffect(() => {
    setLoading(true);
    import("@supabase/supabase-js").then(({ createClient }) => {
      const supabase = createClient(
        process.env.NEXT_PUBLIC_SUPABASE_URL!,
        process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
      );
      supabase
        .from("chart_data")
        .select("data")
        .eq("ticker", selectedTicker.toUpperCase())
        .single()
        .then(({ data: row }) => {
          if (row?.data?.daily?.ohlc) {
            setOhlc(row.data.daily.ohlc);
          } else {
            setOhlc([]);
          }
          setLoading(false);
        });
    });
  }, [selectedTicker]);

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
    const divs = detectDivergence(ohlc, dailyMACD, 60, swingLookback);
    return divs.map((d) => ({ ...d, timeframe: "daily" as const }));
  }, [ohlc, dailyMACD, swingLookback]);

  const weeklyDivergences = useMemo(() => {
    if (!weeklyMACD) return [];
    const divs = detectDivergence(weeklyOHLC, weeklyMACD, 30, 3);
    return divs.map((d) => ({ ...d, timeframe: "weekly" as const }));
  }, [weeklyOHLC, weeklyMACD]);

  // Scan all tickers for divergences
  const handleScan = async () => {
    setScanning(true);
    const { createClient } = await import("@supabase/supabase-js");
    const supabase = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
    );

    const { data: rows } = await supabase
      .from("chart_data")
      .select("ticker, data");

    const results: ScanResult[] = [];

    if (rows) {
      for (const row of rows) {
        const dailyOhlc: OHLCBar[] = row.data?.daily?.ohlc || [];
        if (dailyOhlc.length < 60) continue;

        const closes = dailyOhlc.map((b: OHLCBar) => b.close);
        const dMacd = calcMACD(closes);
        if (!dMacd) continue;
        const dMacdWithTime = dMacd.map((m, i) => ({ ...m, time: dailyOhlc[i].time }));
        const dDivs = detectDivergence(dailyOhlc, dMacdWithTime, 60, swingLookback);
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
            value={selectedTicker}
            onChange={(e) => setSelectedTicker(e.target.value)}
            className="border rounded-md px-3 py-1.5 text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
          >
            {Object.entries(SYMBOL_CATEGORIES).map(([category, tickers]) => (
              <optgroup key={category} label={category}>
                {tickers.map((t) => (
                  <option key={t} value={t}>{t}</option>
                ))}
              </optgroup>
            ))}
          </select>
        </div>

        <div className="flex items-center gap-2">
          <label className="text-sm font-medium text-gray-700">Swing 靈敏度：</label>
          <select
            value={swingLookback}
            onChange={(e) => setSwingLookback(Number(e.target.value))}
            className="border rounded-md px-3 py-1.5 text-sm"
          >
            <option value={3}>高 (3天)</option>
            <option value={5}>中 (5天)</option>
            <option value={7}>低 (7天)</option>
          </select>
        </div>

        <button
          onClick={handleScan}
          disabled={scanning}
          className="ml-auto px-4 py-2 bg-black text-white rounded-md text-sm font-medium hover:bg-gray-800 disabled:opacity-50"
        >
          {scanning ? "掃描中..." : "🔍 掃描全部標的"}
        </button>
      </div>

      {/* Divergence stats for current ticker */}
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

      {/* Charts */}
      <div className="space-y-6 mb-8">
        {/* Daily MACD Chart */}
        <div className="bg-white rounded-xl border p-4">
          {loading ? (
            <div className="flex items-center justify-center h-[450px]">
              <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-gray-900" />
            </div>
          ) : ohlc.length === 0 ? (
            <div className="flex items-center justify-center h-[450px] text-gray-500">
              無 {selectedTicker} 圖表數據。請先執行 export_frontend_data.py
            </div>
          ) : dailyMACD ? (
            <MACDChart
              ticker={selectedTicker}
              ohlc={ohlc}
              macdData={dailyMACD}
              divergences={dailyDivergences}
              title={`${selectedTicker} 日線 MACD (Daily)`}
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
              ticker={selectedTicker}
              ohlc={weeklyOHLC}
              macdData={weeklyMACD}
              divergences={weeklyDivergences}
              title={`${selectedTicker} 周線 MACD (Weekly)`}
            />
          ) : (
            <div className="flex items-center justify-center h-[450px] text-gray-500">
              周線數據不足，無法計算 MACD
            </div>
          )}
        </div>
      </div>

      {/* Scan Results */}
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
    </div>
  );
}
