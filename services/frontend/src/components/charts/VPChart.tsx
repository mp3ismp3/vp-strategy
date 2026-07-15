"use client";

import { useEffect, useState } from "react";
import dynamic from "next/dynamic";

const Plot = dynamic(() => import("react-plotly.js"), { ssr: false });

interface OHLCBar {
  time: string;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

interface Histogram {
  prices: number[];
  volumes: number[];
}

interface TFData {
  ohlc: OHLCBar[];
  poc: number;
  vah: number;
  val: number;
  position: string;
  position_pct: number;
  histogram: Histogram | null;
}

interface ChartData {
  price: number;
  daily: TFData;
  weekly: TFData;
  monthly: TFData;
}

interface VPChartProps {
  ticker: string;
}

export function VPChart({ ticker }: VPChartProps) {
  const [data, setData] = useState<ChartData | null>(null);
  const [loading, setLoading] = useState(true);
  const [timeframe, setTimeframe] = useState<"daily" | "weekly" | "monthly">("daily");

  useEffect(() => {
    fetch(`/api/data/chart-data?ticker=${ticker}`)
      .then((res) => res.json())
      .then((d) => {
        if (d.error) {
          setData(null);
        } else {
          setData(d);
        }
        setLoading(false);
      })
      .catch(() => setLoading(false));
  }, [ticker]);

  if (loading) {
    return (
      <div className="flex items-center justify-center h-[400px]">
        <div className="animate-spin rounded-full h-6 w-6 border-b-2 border-gray-900" />
      </div>
    );
  }

  if (!data) {
    return (
      <div className="flex items-center justify-center h-[400px] text-gray-500">
        圖表數據尚未生成。請先執行 export_frontend_data.py
      </div>
    );
  }

  const tf = data[timeframe];
  if (!tf || !tf.ohlc || tf.ohlc.length === 0) {
    return (
      <div className="flex items-center justify-center h-[400px] text-gray-500">
        無 {timeframe} 數據
      </div>
    );
  }

  const ohlc = tf.ohlc;
  const histogram = tf.histogram;

  // Candlestick trace
  const candlestickTrace: any = {
    type: "candlestick",
    x: ohlc.map((b) => b.time),
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

  // VP histogram trace (horizontal bars on right subplot)
  const histTrace: any = histogram
    ? {
        type: "bar",
        x: histogram.volumes.map((v) => v / Math.max(...histogram.volumes)),
        y: histogram.prices,
        orientation: "h",
        marker: {
          color: histogram.prices.map((p) =>
            p >= tf.val && p <= tf.vah
              ? "rgba(255,165,0,0.6)"
              : "rgba(150,150,150,0.3)"
          ),
        },
        showlegend: false,
        xaxis: "x2",
        yaxis: "y",
        hovertemplate: "$%{y:.2f}<br>Vol: %{customdata:.0f}<extra></extra>",
        customdata: histogram.volumes,
      }
    : null;

  // Layout with subplots: 80% candlestick, 20% histogram
  const layout: any = {
    height: 450,
    margin: { l: 60, r: 10, t: 30, b: 40 },
    showlegend: false,
    paper_bgcolor: "white",
    plot_bgcolor: "white",
    xaxis: {
      domain: [0, 0.78],
      rangeslider: { visible: false },
      type: "category",
      tickangle: -45,
      nticks: 10,
    },
    xaxis2: {
      domain: [0.8, 1],
      showticklabels: false,
    },
    yaxis: {
      title: "Price ($)",
      side: "left",
      showgrid: true,
      gridcolor: "rgba(0,0,0,0.05)",
    },
    // VP level shapes
    shapes: [
      // Value Area background
      {
        type: "rect",
        xref: "paper",
        yref: "y",
        x0: 0,
        x1: 0.78,
        y0: tf.val,
        y1: tf.vah,
        fillcolor: "rgba(255,165,0,0.05)",
        line: { width: 0 },
      },
      // VAH
      {
        type: "line",
        xref: "paper",
        yref: "y",
        x0: 0,
        x1: 1,
        y0: tf.vah,
        y1: tf.vah,
        line: { color: "red", width: 1, dash: "dash" },
      },
      // POC
      {
        type: "line",
        xref: "paper",
        yref: "y",
        x0: 0,
        x1: 1,
        y0: tf.poc,
        y1: tf.poc,
        line: { color: "orange", width: 2 },
      },
      // VAL
      {
        type: "line",
        xref: "paper",
        yref: "y",
        x0: 0,
        x1: 1,
        y0: tf.val,
        y1: tf.val,
        line: { color: "green", width: 1, dash: "dash" },
      },
    ],
    annotations: [
      {
        x: 1.01,
        xref: "paper",
        y: tf.vah,
        yref: "y",
        text: `VAH ${tf.vah.toFixed(1)}`,
        showarrow: false,
        font: { size: 10, color: "red" },
        xanchor: "left",
      },
      {
        x: 1.01,
        xref: "paper",
        y: tf.poc,
        yref: "y",
        text: `POC ${tf.poc.toFixed(1)}`,
        showarrow: false,
        font: { size: 10, color: "orange" },
        xanchor: "left",
      },
      {
        x: 1.01,
        xref: "paper",
        y: tf.val,
        yref: "y",
        text: `VAL ${tf.val.toFixed(1)}`,
        showarrow: false,
        font: { size: 10, color: "green" },
        xanchor: "left",
      },
    ],
  };

  const traces = [candlestickTrace];
  if (histTrace) traces.push(histTrace);

  const tfLabels = { daily: "日線 (60天)", weekly: "周線 (52週)", monthly: "月線 (12月)" };

  return (
    <div>
      {/* Timeframe tabs */}
      <div className="flex gap-2 mb-3">
        {(["daily", "weekly", "monthly"] as const).map((tf) => (
          <button
            key={tf}
            onClick={() => setTimeframe(tf)}
            className={`px-3 py-1 rounded-md text-sm font-medium transition ${
              timeframe === tf
                ? "bg-black text-white"
                : "bg-gray-100 text-gray-700 hover:bg-gray-200"
            }`}
          >
            {tfLabels[tf]}
          </button>
        ))}
      </div>

      <Plot
        data={traces}
        layout={layout}
        config={{ displayModeBar: false, responsive: true }}
        style={{ width: "100%" }}
      />
    </div>
  );
}
