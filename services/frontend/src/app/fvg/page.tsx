"use client";

import { useEffect, useState, useMemo } from "react";
import dynamic from "next/dynamic";
import type { Annotations, Data, Layout, Shape } from "plotly.js";
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

interface FVGGap {
  type: "bullish" | "bearish";
  gapHigh: number;
  gapLow: number;
  gapSize: number;
  barIndex: number;
  date: string;
  filled: boolean;
  fillPct: number;
}

interface ScanResult {
  ticker: string;
  price: number;
  fvgs: FVGGap[];
}

// ─── Algorithms ──────────────────────────────────────────────────────────────

function calcATR(ohlc: OHLCBar[], period: number = 14): number {
  if (ohlc.length < period + 1) return 0;
  const trs: number[] = [];
  for (let i = 1; i < ohlc.length; i++) {
    const tr = Math.max(
      ohlc[i].high - ohlc[i].low,
      Math.abs(ohlc[i].high - ohlc[i - 1].close),
      Math.abs(ohlc[i].low - ohlc[i - 1].close)
    );
    trs.push(tr);
  }
  // Simple moving average of last `period` TRs
  const recent = trs.slice(-period);
  return recent.reduce((a, b) => a + b, 0) / recent.length;
}

function checkFVGFill(
  subsequentPrices: number[],
  gapLow: number,
  gapHigh: number,
  fvgType: "bullish" | "bearish"
): { filled: boolean; fillPct: number } {
  if (subsequentPrices.length === 0) return { filled: false, fillPct: 0 };

  const gapSize = gapHigh - gapLow;
  if (gapSize <= 0) return { filled: true, fillPct: 1.0 };

  if (fvgType === "bullish") {
    const minLow = Math.min(...subsequentPrices);
    if (minLow >= gapHigh) return { filled: false, fillPct: 0 };
    const penetration = gapHigh - Math.max(minLow, gapLow);
    const fillPct = Math.min(penetration / gapSize, 1.0);
    return { filled: fillPct >= 1.0, fillPct };
  } else {
    const maxHigh = Math.max(...subsequentPrices);
    if (maxHigh <= gapLow) return { filled: false, fillPct: 0 };
    const penetration = Math.min(maxHigh, gapHigh) - gapLow;
    const fillPct = Math.min(penetration / gapSize, 1.0);
    return { filled: fillPct >= 1.0, fillPct };
  }
}

function detectFVG(
  ohlc: OHLCBar[],
  lookback: number = 60,
  minGapAtrRatio: number = 0.5
): FVGGap[] {
  if (ohlc.length < 20) return [];

  const data = ohlc.slice(-lookback);
  const n = data.length;
  if (n < 3) return [];

  const atr = calcATR(ohlc, 14);
  const minGap = atr > 0 ? atr * minGapAtrRatio : 0;

  const fvgs: FVGGap[] = [];

  for (let i = 1; i < n - 1; i++) {
    // Bullish FVG: candle[i-1].high < candle[i+1].low
    const bullGapLow = data[i - 1].high;
    const bullGapHigh = data[i + 1].low;

    if (bullGapHigh > bullGapLow) {
      const gapSize = bullGapHigh - bullGapLow;
      if (gapSize >= minGap) {
        const subsequentLows = data.slice(i + 1).map((b) => b.low);
        const { filled, fillPct } = checkFVGFill(
          subsequentLows,
          bullGapLow,
          bullGapHigh,
          "bullish"
        );

        fvgs.push({
          type: "bullish",
          gapHigh: Math.round(bullGapHigh * 100) / 100,
          gapLow: Math.round(bullGapLow * 100) / 100,
          gapSize: Math.round(gapSize * 100) / 100,
          barIndex: i,
          date: data[i].time,
          filled,
          fillPct: Math.round(fillPct * 100) / 100,
        });
      }
    }

    // Bearish FVG: candle[i-1].low > candle[i+1].high
    const bearGapHigh = data[i - 1].low;
    const bearGapLow = data[i + 1].high;

    if (bearGapHigh > bearGapLow) {
      const gapSize = bearGapHigh - bearGapLow;
      if (gapSize >= minGap) {
        const subsequentHighs = data.slice(i + 1).map((b) => b.high);
        const { filled, fillPct } = checkFVGFill(
          subsequentHighs,
          bearGapLow,
          bearGapHigh,
          "bearish"
        );

        fvgs.push({
          type: "bearish",
          gapHigh: Math.round(bearGapHigh * 100) / 100,
          gapLow: Math.round(bearGapLow * 100) / 100,
          gapSize: Math.round(gapSize * 100) / 100,
          barIndex: i,
          date: data[i].time,
          filled,
          fillPct: Math.round(fillPct * 100) / 100,
        });
      }
    }
  }

  return fvgs;
}

// ─── Chart Component ─────────────────────────────────────────────────────────

interface FVGChartProps {
  ticker: string;
  ohlc: OHLCBar[];
  fvgs: FVGGap[];
  showFilled: boolean;
}

function FVGChart({ ticker, ohlc, fvgs, showFilled }: FVGChartProps) {
  const displayData = ohlc.slice(-60);
  const times = displayData.map((b) => b.time);

  const visibleFvgs = fvgs.filter((f) => showFilled || !f.filled);

  // Candlestick
  const candlestick: Data = {
    type: "candlestick",
    x: times,
    open: displayData.map((b) => b.open),
    high: displayData.map((b) => b.high),
    low: displayData.map((b) => b.low),
    close: displayData.map((b) => b.close),
    increasing: { line: { color: "#26a69a" } },
    decreasing: { line: { color: "#ef5350" } },
    name: "Price",
  };

  // FVG rectangles as shapes
  const shapes: Partial<Shape>[] = visibleFvgs.map((fvg) => {
    const startTime = fvg.date;
    const endTime = times[times.length - 1]; // extend to end

    return {
      type: "rect",
      xref: "x",
      yref: "y",
      x0: startTime,
      x1: endTime,
      y0: fvg.gapLow,
      y1: fvg.gapHigh,
      fillcolor:
        fvg.type === "bullish"
          ? fvg.filled
            ? "rgba(76,175,80,0.05)"
            : "rgba(76,175,80,0.15)"
          : fvg.filled
          ? "rgba(244,67,54,0.05)"
          : "rgba(244,67,54,0.15)",
      line: {
        color:
          fvg.type === "bullish"
            ? "rgba(76,175,80,0.5)"
            : "rgba(244,67,54,0.5)",
        width: 1,
        dash: fvg.filled ? "dot" : "solid",
      },
    };
  });

  // Annotations at FVG start
  const annotations: Partial<Annotations>[] = visibleFvgs.map((fvg) => ({
    x: fvg.date,
    y: fvg.type === "bullish" ? fvg.gapLow : fvg.gapHigh,
    xref: "x",
    yref: "y",
    text:
      fvg.type === "bullish"
        ? `$${fvg.gapLow.toFixed(1)}-${fvg.gapHigh.toFixed(1)}`
        : `$${fvg.gapLow.toFixed(1)}-${fvg.gapHigh.toFixed(1)}`,
    showarrow: false,
    font: {
      size: 9,
      color: fvg.type === "bullish" ? "#4caf50" : "#f44336",
    },
    yshift: fvg.type === "bullish" ? -12 : 12,
  }));

  const layout: Partial<Layout> = {
    height: 550,
    margin: { l: 60, r: 20, t: 40, b: 40 },
    showlegend: true,
    legend: { x: 0, y: 1.1, orientation: "h", font: { size: 11 } },
    paper_bgcolor: "white",
    plot_bgcolor: "white",
    title: { text: `${ticker} — Fair Value Gaps`, font: { size: 15 } },
    xaxis: {
      type: "category",
      rangeslider: { visible: false },
      tickangle: -45,
      nticks: 12,
    },
    yaxis: {
      title: { text: "Price ($)" },
      showgrid: true,
      gridcolor: "rgba(0,0,0,0.04)",
    },
    shapes,
    annotations,
  };

  return (
    <Plot
      data={[candlestick]}
      layout={layout}
      config={{ displayModeBar: true, responsive: true }}
      style={{ width: "100%" }}
    />
  );
}

// ─── Main Page ───────────────────────────────────────────────────────────────

export default function FVGPage() {
  const { data: session } = useSession();
  const accessPlan = (session?.user as { plan?: "free" | "pro" | "premium" } | undefined)?.plan ?? "free";
  const isPaid = accessPlan === "pro" || accessPlan === "premium";
  const [selectedTicker, setSelectedTicker] = useState("NVDA");
  const [ohlc, setOhlc] = useState<OHLCBar[]>([]);
  const [loadedTicker, setLoadedTicker] = useState<string | null>(null);
  const [scanning, setScanning] = useState(false);
  const [scanResults, setScanResults] = useState<ScanResult[]>([]);
  const [showFilled, setShowFilled] = useState(false);
  const [maxAge, setMaxAge] = useState(30);
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

  // Detect FVGs for selected ticker
  const fvgs = useMemo(() => {
    if (ohlc.length === 0) return [];
    return detectFVG(ohlc, maxAge + 2, 0.5);
  }, [ohlc, maxAge]);

  const visibleFvgs = useMemo(
    () => fvgs.filter((f) => showFilled || !f.filled),
    [fvgs, showFilled]
  );

  const bullishCount = visibleFvgs.filter((f) => f.type === "bullish").length;
  const bearishCount = visibleFvgs.filter((f) => f.type === "bearish").length;

  // Scan all tickers
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
        if (dailyOhlc.length < 30) continue;

        const gaps = detectFVG(dailyOhlc, maxAge + 2, 0.5);
        const filtered = gaps.filter((f) => showFilled || !f.filled);

        if (filtered.length > 0) {
          const lastPrice = dailyOhlc[dailyOhlc.length - 1].close;
          results.push({
            ticker: row.ticker,
            price: lastPrice,
            fvgs: filtered,
          });
        }
      }
    }

    // Sort by number of unfilled FVGs (most actionable first)
    results.sort((a, b) => b.fvgs.length - a.fvgs.length);
    setScanResults(results);
    setScanning(false);
  };

  // Auto-scan on mount
  useEffect(() => {
    const timeoutId = window.setTimeout(() => void handleScan(), 0);
    return () => window.clearTimeout(timeoutId);
  }, [accessPlan]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div className="analysis-page">
      {/* Header */}
      <div className="analysis-header">
        <div>
          <h1 className="text-3xl font-bold">FVG (Fair Value Gap)</h1>
          <p className="text-gray-600 mt-1">
            日線級別公允價值缺口偵測 — 未填補的 FVG 是潛在支撐/阻力區域
          </p>
        </div>
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

        <div className="flex items-center gap-2">
          <label className="text-sm font-medium text-gray-700">回看天數：</label>
          <select
            value={maxAge}
            onChange={(e) => setMaxAge(Number(e.target.value))}
            className="border rounded-md px-3 py-1.5 text-sm"
          >
            <option value={15}>15 天</option>
            <option value={30}>30 天</option>
            <option value={45}>45 天</option>
            <option value={60}>60 天</option>
          </select>
        </div>

        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={showFilled}
            onChange={(e) => setShowFilled(e.target.checked)}
            className="rounded border-gray-300"
          />
          顯示已填補 FVG
        </label>

        <div className="flex items-center gap-3 ml-auto">
          <Badge className="bg-green-100 text-green-800">
            Bullish: {bullishCount}
          </Badge>
          <Badge className="bg-red-100 text-red-800">
            Bearish: {bearishCount}
          </Badge>
        </div>
      </div>

      {/* Chart remains visible in the guest preview. */}
      <div className="bg-white rounded-xl border p-4 mb-6">
        {loading ? (
          <div className="flex items-center justify-center h-[550px]">
            <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-gray-900" />
          </div>
        ) : ohlc.length === 0 ? (
          <div className="flex items-center justify-center h-[550px] text-gray-500">
            無 {effectiveTicker} 圖表數據。請先執行 export_frontend_data.py
          </div>
        ) : (
          <FVGChart
            ticker={effectiveTicker}
            ohlc={ohlc}
            fvgs={fvgs}
            showFilled={showFilled}
          />
        )}
      </div>

      {/* Signal details */}
      <SignalMosaic locked={!isPaid}>
        {visibleFvgs.length > 0 && (
          <div className="bg-white rounded-xl border p-6 mb-6">
          <h2 className="text-xl font-bold mb-4">
            {effectiveTicker} FVG 列表
          </h2>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b bg-gray-50">
                  <th className="text-left p-3">日期</th>
                  <th className="text-left p-3">方向</th>
                  <th className="text-left p-3">缺口下緣</th>
                  <th className="text-left p-3">缺口上緣</th>
                  <th className="text-left p-3">缺口大小</th>
                  <th className="text-left p-3">填補%</th>
                  <th className="text-left p-3">狀態</th>
                </tr>
              </thead>
              <tbody>
                {[...visibleFvgs].reverse().map((fvg, i) => (
                  <tr key={i} className="border-b hover:bg-gray-50">
                    <td className="p-3 font-mono">{fvg.date}</td>
                    <td className="p-3">
                      {fvg.type === "bullish" ? (
                        <Badge className="bg-green-100 text-green-800">看漲</Badge>
                      ) : (
                        <Badge className="bg-red-100 text-red-800">看跌</Badge>
                      )}
                    </td>
                    <td className="p-3 font-mono">${fvg.gapLow.toFixed(2)}</td>
                    <td className="p-3 font-mono">${fvg.gapHigh.toFixed(2)}</td>
                    <td className="p-3 font-mono">${fvg.gapSize.toFixed(2)}</td>
                    <td className="p-3">{Math.round(fvg.fillPct * 100)}%</td>
                    <td className="p-3">
                      {fvg.filled ? (
                        <span className="text-gray-400">已填補</span>
                      ) : (
                        <span className="text-blue-600 font-medium">有效</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          </div>
        )}
        {scanning && (
          <div className="flex items-center justify-center py-8 gap-2 text-gray-500">
            <div className="animate-spin rounded-full h-5 w-5 border-b-2 border-gray-900" />
            掃描全部標的中...
          </div>
        )}
        {!scanning && scanResults.length > 0 && (
          <div className="bg-white rounded-xl border p-6">
          <h2 className="text-xl font-bold mb-4">
            全標的 FVG 掃描（共 {scanResults.length} 檔有有效缺口）
          </h2>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b bg-gray-50">
                  <th className="text-left p-3">標的</th>
                  <th className="text-left p-3">現價</th>
                  <th className="text-left p-3">看漲 FVG</th>
                  <th className="text-left p-3">看跌 FVG</th>
                  <th className="text-left p-3">最近缺口</th>
                </tr>
              </thead>
              <tbody>
                {scanResults.map((r) => {
                  const bullish = r.fvgs.filter((f) => f.type === "bullish");
                  const bearish = r.fvgs.filter((f) => f.type === "bearish");
                  const nearest = r.fvgs.reduce((prev, curr) => {
                    const prevDist = Math.min(
                      Math.abs(r.price - prev.gapHigh),
                      Math.abs(r.price - prev.gapLow)
                    );
                    const currDist = Math.min(
                      Math.abs(r.price - curr.gapHigh),
                      Math.abs(r.price - curr.gapLow)
                    );
                    return currDist < prevDist ? curr : prev;
                  });

                  return (
                    <tr
                      key={r.ticker}
                      className="border-b hover:bg-gray-50 cursor-pointer"
                      onClick={() => setSelectedTicker(r.ticker)}
                    >
                      <td className="p-3 font-bold">{r.ticker}</td>
                      <td className="p-3 font-mono">${r.price.toFixed(2)}</td>
                      <td className="p-3">
                        {bullish.length > 0 ? (
                          <Badge className="bg-green-100 text-green-800">
                            {bullish.length}
                          </Badge>
                        ) : (
                          <span className="text-gray-300">—</span>
                        )}
                      </td>
                      <td className="p-3">
                        {bearish.length > 0 ? (
                          <Badge className="bg-red-100 text-red-800">
                            {bearish.length}
                          </Badge>
                        ) : (
                          <span className="text-gray-300">—</span>
                        )}
                      </td>
                      <td className="p-3 text-xs text-gray-500">
                        {nearest.type === "bullish" ? "看漲" : "看跌"} $
                        {nearest.gapLow.toFixed(1)}-${nearest.gapHigh.toFixed(1)}
                        {" "}({nearest.date})
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          </div>
        )}
      </SignalMosaic>
    </div>
  );
}
