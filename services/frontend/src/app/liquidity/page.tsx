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

interface SwingPoint {
  index: number;
  time: string;
  price: number;
  type: "high" | "low";
}

interface SweepEvent {
  index: number;
  time: string;
  direction: "bullish" | "bearish";
  sweepPrice: number; // the swing level that was swept
  wickExtreme: number; // how far the wick went past
  closePrice: number;
  volume: number;
  volumeRatio: number; // vs 20-day median
}

// ─── Algo: Swing Point Detection ─────────────────────────────────────────────

function detectSwingPoints(ohlc: OHLCBar[], lookback: number = 5): SwingPoint[] {
  const points: SwingPoint[] = [];
  for (let i = lookback; i < ohlc.length - lookback; i++) {
    // Swing High: high[i] > all highs in [i-lookback, i+lookback] (excluding i)
    let isHigh = true;
    for (let j = i - lookback; j <= i + lookback; j++) {
      if (j === i) continue;
      if (ohlc[j].high >= ohlc[i].high) {
        isHigh = false;
        break;
      }
    }
    if (isHigh) {
      points.push({ index: i, time: ohlc[i].time, price: ohlc[i].high, type: "high" });
    }

    // Swing Low: low[i] < all lows in [i-lookback, i+lookback] (excluding i)
    let isLow = true;
    for (let j = i - lookback; j <= i + lookback; j++) {
      if (j === i) continue;
      if (ohlc[j].low <= ohlc[i].low) {
        isLow = false;
        break;
      }
    }
    if (isLow) {
      points.push({ index: i, time: ohlc[i].time, price: ohlc[i].low, type: "low" });
    }
  }
  return points;
}

// ─── Algo: Liquidity Sweep Detection ─────────────────────────────────────────

function detectSweeps(ohlc: OHLCBar[], swingPoints: SwingPoint[]): SweepEvent[] {
  const sweeps: SweepEvent[] = [];

  // Minimum penetration ratio to filter noise (wick must pierce at least 0.1% past level)
  const MIN_PENETRATION = 0.001;
  // Maximum penetration ratio (too deep = not a sweep, it's a trend move)
  const MAX_PENETRATION = 0.03;
  // Volume must be at least 1.2x the 20-day median (stop-loss triggering = volume spike)
  const MIN_VOL_RATIO = 1.2;
  // Open must be within this % of the swing level (ensures price approaches from correct side)
  const MAX_OPEN_DISTANCE = 0.02;

  // Compute 20-day volume median for each bar
  const volMedian = ohlc.map((_, i) => {
    if (i < 19) return ohlc[i].volume;
    const window = ohlc.slice(i - 19, i + 1).map((b) => b.volume);
    const sorted = [...window].sort((a, b) => a - b);
    return (sorted[9] + sorted[10]) / 2; // proper median of 20 elements
  });

  for (let i = 10; i < ohlc.length; i++) {
    const bar = ohlc[i];
    const barRange = bar.high - bar.low;
    if (barRange === 0) continue; // skip doji with no range

    // Find relevant swing points that are before this bar (at least 3 bars ago)
    const relevantSwings = swingPoints.filter(
      (sp) => sp.index < i - 2 && sp.index >= i - 50
    );

    // Check for bullish sweep: low breaks below a swing low, but close is above it
    const swingLows = relevantSwings.filter((sp) => sp.type === "low");
    for (const sl of swingLows) {
      if (bar.low < sl.price && bar.close > sl.price) {
        // Open must be above or near the swing low (price approaches from above, dips below, reclaims)
        // If open is far below swing low, price was already broken down — not a sweep
        const openDistance = (sl.price - bar.open) / sl.price;
        if (bar.open < sl.price && openDistance > MAX_OPEN_DISTANCE) continue;

        // Check minimum penetration depth
        const penetration = (sl.price - bar.low) / sl.price;
        if (penetration < MIN_PENETRATION) continue;
        if (penetration > MAX_PENETRATION) continue;

        // Check volume confirmation
        const vRatio = bar.volume / volMedian[i];
        if (vRatio < MIN_VOL_RATIO) continue;

        // Check close strength: close should be in upper portion of bar (reclaimed convincingly)
        const closeStrength = (bar.close - bar.low) / barRange;
        if (closeStrength < 0.3) continue; // close too near the low = weak reclaim

        // Avoid duplicate sweeps of the same level on consecutive days
        const alreadySwept = sweeps.some(
          (s) =>
            s.direction === "bullish" &&
            Math.abs(s.sweepPrice - sl.price) / sl.price < 0.005 &&
            i - s.index < 5
        );
        if (!alreadySwept) {
          sweeps.push({
            index: i,
            time: bar.time,
            direction: "bullish",
            sweepPrice: sl.price,
            wickExtreme: bar.low,
            closePrice: bar.close,
            volume: bar.volume,
            volumeRatio: vRatio,
          });
        }
      }
    }

    // Check for bearish sweep: high breaks above a swing high, but close is below it
    const swingHighs = relevantSwings.filter((sp) => sp.type === "high");
    for (const sh of swingHighs) {
      if (bar.high > sh.price && bar.close < sh.price) {
        // Open must be below or near the swing high (price approaches from below, spikes above, rejects)
        // If open is far above swing high, price was already broken out — not a sweep
        const openDistance = (bar.open - sh.price) / sh.price;
        if (bar.open > sh.price && openDistance > MAX_OPEN_DISTANCE) continue;

        // Check minimum penetration depth
        const penetration = (bar.high - sh.price) / sh.price;
        if (penetration < MIN_PENETRATION) continue;
        if (penetration > MAX_PENETRATION) continue;

        // Check volume confirmation
        const vRatio = bar.volume / volMedian[i];
        if (vRatio < MIN_VOL_RATIO) continue;

        // Check close strength: close should be in lower portion of bar
        const closeStrength = (bar.high - bar.close) / barRange;
        if (closeStrength < 0.3) continue; // close too near the high = weak rejection

        // Avoid duplicate sweeps
        const alreadySwept = sweeps.some(
          (s) =>
            s.direction === "bearish" &&
            Math.abs(s.sweepPrice - sh.price) / sh.price < 0.005 &&
            i - s.index < 5
        );
        if (!alreadySwept) {
          sweeps.push({
            index: i,
            time: bar.time,
            direction: "bearish",
            sweepPrice: sh.price,
            wickExtreme: bar.high,
            closePrice: bar.close,
            volume: bar.volume,
            volumeRatio: vRatio,
          });
        }
      }
    }
  }

  return sweeps;
}

// ─── Component ───────────────────────────────────────────────────────────────

export default function LiquidityPage() {
  const [selectedTicker, setSelectedTicker] = useState("NVDA");
  const [ohlc, setOhlc] = useState<OHLCBar[]>([]);
  const [loading, setLoading] = useState(true);
  const [lookback, setLookback] = useState(5);

  const allTickers = useMemo(
    () => Object.values(SYMBOL_CATEGORIES).flat().sort(),
    []
  );

  // Fetch OHLC from Supabase
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

  // Compute swing points and sweeps
  const swingPoints = useMemo(() => detectSwingPoints(ohlc, lookback), [ohlc, lookback]);
  const sweeps = useMemo(() => detectSweeps(ohlc, swingPoints), [ohlc, swingPoints]);

  const bullishSweeps = sweeps.filter((s) => s.direction === "bullish");
  const bearishSweeps = sweeps.filter((s) => s.direction === "bearish");

  return (
    <div className="max-w-7xl mx-auto px-4 py-8">
      {/* Header */}
      <div className="mb-6">
        <h1 className="text-3xl font-bold">💧 Liquidity Sweep</h1>
        <p className="text-gray-600 mt-1">
          偵測日線級別的流動性掃蕩點——掃過 Swing High/Low 後快速收回
        </p>
      </div>

      {/* Controls */}
      <div className="bg-white rounded-xl border p-4 mb-6 flex flex-wrap gap-4 items-center">
        {/* Ticker Select */}
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
                  <option key={t} value={t}>
                    {t}
                  </option>
                ))}
              </optgroup>
            ))}
          </select>
        </div>

        {/* Lookback */}
        <div className="flex items-center gap-2">
          <label className="text-sm font-medium text-gray-700">Swing 靈敏度：</label>
          <select
            value={lookback}
            onChange={(e) => setLookback(Number(e.target.value))}
            className="border rounded-md px-3 py-1.5 text-sm"
          >
            <option value={3}>高 (3天)</option>
            <option value={5}>中 (5天)</option>
            <option value={7}>低 (7天)</option>
            <option value={10}>極低 (10天)</option>
          </select>
        </div>

        {/* Stats */}
        <div className="flex items-center gap-3 ml-auto">
          <Badge className="bg-green-100 text-green-800">
            🟢 Bullish Sweep: {bullishSweeps.length}
          </Badge>
          <Badge className="bg-red-100 text-red-800">
            🔴 Bearish Sweep: {bearishSweeps.length}
          </Badge>
        </div>
      </div>

      {/* Chart */}
      <div className="bg-white rounded-xl border p-4 mb-6">
        {loading ? (
          <div className="flex items-center justify-center h-[500px]">
            <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-gray-900" />
          </div>
        ) : ohlc.length === 0 ? (
          <div className="flex items-center justify-center h-[500px] text-gray-500">
            無 {selectedTicker} 圖表數據。請先執行 export_frontend_data.py
          </div>
        ) : (
          <LiquidityChart
            ticker={selectedTicker}
            ohlc={ohlc}
            swingPoints={swingPoints}
            sweeps={sweeps}
          />
        )}
      </div>

      {/* Sweep Events Table */}
      {sweeps.length > 0 && (
        <div className="bg-white rounded-xl border p-6">
          <h2 className="text-xl font-bold mb-4">📋 Sweep 事件列表</h2>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b bg-gray-50">
                  <th className="text-left p-3">日期</th>
                  <th className="text-left p-3">方向</th>
                  <th className="text-left p-3">掃過的價位</th>
                  <th className="text-left p-3">Wick 極值</th>
                  <th className="text-left p-3">收盤</th>
                  <th className="text-left p-3">量比</th>
                </tr>
              </thead>
              <tbody>
                {[...sweeps].reverse().map((s, i) => (
                  <tr key={i} className="border-b hover:bg-gray-50">
                    <td className="p-3 font-mono">{s.time}</td>
                    <td className="p-3">
                      {s.direction === "bullish" ? (
                        <Badge className="bg-green-100 text-green-800">🟢 Bullish</Badge>
                      ) : (
                        <Badge className="bg-red-100 text-red-800">🔴 Bearish</Badge>
                      )}
                    </td>
                    <td className="p-3 font-mono">${s.sweepPrice.toFixed(2)}</td>
                    <td className="p-3 font-mono">
                      ${s.wickExtreme.toFixed(2)}
                      <span className="text-gray-400 ml-1">
                        ({s.direction === "bullish" ? "-" : "+"}
                        {Math.abs(
                          ((s.wickExtreme - s.sweepPrice) / s.sweepPrice) * 100
                        ).toFixed(2)}
                        %)
                      </span>
                    </td>
                    <td className="p-3 font-mono">${s.closePrice.toFixed(2)}</td>
                    <td className="p-3">
                      <span
                        className={
                          s.volumeRatio >= 1.5
                            ? "text-green-700 font-bold"
                            : s.volumeRatio >= 1.0
                            ? "text-blue-700"
                            : "text-gray-500"
                        }
                      >
                        {s.volumeRatio.toFixed(2)}x
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Chart Component ─────────────────────────────────────────────────────────

interface LiquidityChartProps {
  ticker: string;
  ohlc: OHLCBar[];
  swingPoints: SwingPoint[];
  sweeps: SweepEvent[];
}

function LiquidityChart({ ticker, ohlc, swingPoints, sweeps }: LiquidityChartProps) {
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

  // Swing High markers
  const swingHighs = swingPoints.filter((sp) => sp.type === "high");
  const swingHighTrace: any = {
    type: "scatter",
    x: swingHighs.map((sp) => sp.time),
    y: swingHighs.map((sp) => sp.price),
    mode: "markers",
    marker: { symbol: "triangle-down", size: 8, color: "rgba(239,83,80,0.6)" },
    name: "Swing High",
    hovertemplate: "Swing High: $%{y:.2f}<br>%{x}<extra></extra>",
    xaxis: "x",
    yaxis: "y",
  };

  // Swing Low markers
  const swingLows = swingPoints.filter((sp) => sp.type === "low");
  const swingLowTrace: any = {
    type: "scatter",
    x: swingLows.map((sp) => sp.time),
    y: swingLows.map((sp) => sp.price),
    mode: "markers",
    marker: { symbol: "triangle-up", size: 8, color: "rgba(38,166,154,0.6)" },
    name: "Swing Low",
    hovertemplate: "Swing Low: $%{y:.2f}<br>%{x}<extra></extra>",
    xaxis: "x",
    yaxis: "y",
  };

  // Bullish Sweep markers (on the sweep bar, at the low)
  const bullSweeps = sweeps.filter((s) => s.direction === "bullish");
  const bullSweepTrace: any = {
    type: "scatter",
    x: bullSweeps.map((s) => s.time),
    y: bullSweeps.map((s) => s.wickExtreme),
    mode: "markers+text",
    marker: { symbol: "star", size: 14, color: "#4caf50", line: { width: 1, color: "#1b5e20" } },
    text: bullSweeps.map(() => "SWEEP"),
    textposition: "bottom center",
    textfont: { size: 9, color: "#4caf50" },
    name: "Bullish Sweep",
    hovertemplate:
      "🟢 Bullish Sweep<br>掃過: $%{customdata[0]:.2f}<br>Wick: $%{y:.2f}<br>Close: $%{customdata[1]:.2f}<br>Vol: %{customdata[2]:.1f}x<extra></extra>",
    customdata: bullSweeps.map((s) => [s.sweepPrice, s.closePrice, s.volumeRatio]),
    xaxis: "x",
    yaxis: "y",
  };

  // Bearish Sweep markers (on the sweep bar, at the high)
  const bearSweeps = sweeps.filter((s) => s.direction === "bearish");
  const bearSweepTrace: any = {
    type: "scatter",
    x: bearSweeps.map((s) => s.time),
    y: bearSweeps.map((s) => s.wickExtreme),
    mode: "markers+text",
    marker: { symbol: "star", size: 14, color: "#f44336", line: { width: 1, color: "#b71c1c" } },
    text: bearSweeps.map(() => "SWEEP"),
    textposition: "top center",
    textfont: { size: 9, color: "#f44336" },
    name: "Bearish Sweep",
    hovertemplate:
      "🔴 Bearish Sweep<br>掃過: $%{customdata[0]:.2f}<br>Wick: $%{y:.2f}<br>Close: $%{customdata[1]:.2f}<br>Vol: %{customdata[2]:.1f}x<extra></extra>",
    customdata: bearSweeps.map((s) => [s.sweepPrice, s.closePrice, s.volumeRatio]),
    xaxis: "x",
    yaxis: "y",
  };

  // Volume subplot
  const volColors = ohlc.map((bar, i) =>
    i === 0 ? "#26a69a" : bar.close >= ohlc[i - 1].close ? "#26a69a" : "#ef5350"
  );
  const volTrace: any = {
    type: "bar",
    x: times,
    y: ohlc.map((b) => b.volume),
    marker: { color: volColors },
    name: "Volume",
    opacity: 0.6,
    xaxis: "x2",
    yaxis: "y2",
  };

  // Shapes: horizontal lines at swing levels extending forward
  const shapes: any[] = [];

  // Draw dashed lines from each swing point extending to the right
  for (const sp of swingPoints) {
    // Extend line from swing point to end of data (or until swept)
    const endIdx = ohlc.length - 1;
    const sweptBy = sweeps.find(
      (s) =>
        s.index > sp.index &&
        ((sp.type === "low" && s.direction === "bullish" && Math.abs(s.sweepPrice - sp.price) / sp.price < 0.005) ||
          (sp.type === "high" && s.direction === "bearish" && Math.abs(s.sweepPrice - sp.price) / sp.price < 0.005))
    );
    const lineEnd = sweptBy ? sweptBy.index : endIdx;

    if (lineEnd > sp.index) {
      shapes.push({
        type: "line",
        xref: "x",
        yref: "y",
        x0: ohlc[sp.index].time,
        x1: ohlc[Math.min(lineEnd, endIdx)].time,
        y0: sp.price,
        y1: sp.price,
        line: {
          color: sp.type === "high" ? "rgba(239,83,80,0.3)" : "rgba(38,166,154,0.3)",
          width: 1,
          dash: "dot",
        },
      });
    }
  }

  const layout: any = {
    height: 600,
    margin: { l: 60, r: 20, t: 40, b: 30 },
    showlegend: true,
    legend: { x: 0, y: 1.12, orientation: "h", font: { size: 11 } },
    paper_bgcolor: "white",
    plot_bgcolor: "white",
    title: {
      text: `${ticker} — Liquidity Sweep Analysis`,
      font: { size: 15 },
    },
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
      nticks: 12,
    },
    yaxis: {
      domain: [0.28, 1],
      title: "Price ($)",
      showgrid: true,
      gridcolor: "rgba(0,0,0,0.04)",
    },
    yaxis2: {
      domain: [0, 0.22],
      title: "Volume",
      showgrid: true,
      gridcolor: "rgba(0,0,0,0.04)",
    },
    shapes,
  };

  return (
    <Plot
      data={[candlestick, swingHighTrace, swingLowTrace, bullSweepTrace, bearSweepTrace, volTrace]}
      layout={layout}
      config={{ displayModeBar: true, responsive: true }}
      style={{ width: "100%" }}
    />
  );
}
