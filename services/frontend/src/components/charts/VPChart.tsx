"use client";

import { useEffect, useState } from "react";
import dynamic from "next/dynamic";
import type { Data, Layout } from "plotly.js";

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
    fetch(`/api/data/chart-data?ticker=${encodeURIComponent(ticker)}`)
      .then(async (response) => response.ok ? response.json() : Promise.reject())
      .then((chart) => setData(chart))
      .catch(() => setData(null))
      .finally(() => setLoading(false));
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
  const candlestickTrace: Data = {
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
  const histTrace: Data | null = histogram
    ? {
        type: "bar",
        x: histogram.volumes.map((v) => v / Math.max(...histogram.volumes)),
        y: histogram.prices,
        orientation: "h",
        marker: {
          color: histogram.prices.map((p) =>
            p >= tf.val && p <= tf.vah
              ? "rgba(245,158,11,0.85)"
              : "rgba(107,114,128,0.5)"
          ),
          line: { color: "rgba(90,90,90,0.7)", width: 1 },
        },
        showlegend: false,
        xaxis: "x2",
        yaxis: "y",
        hovertemplate: "$%{y:.2f}<br>Vol: %{customdata:.0f}<extra></extra>",
        customdata: histogram.volumes,
      }
    : null;

  // Keep the price chart readable while giving VP enough width to compare bins.
  const layout: Partial<Layout> = {
    height: 450,
    margin: { l: 60, r: 80, t: 30, b: 40 },
    showlegend: false,
    paper_bgcolor: "white",
    plot_bgcolor: "white",
    xaxis: {
      domain: [0, 0.68],
      rangeslider: { visible: false },
      rangeselector: {
        buttons: [
          { count: 3, label: "3M", step: "month", stepmode: "backward" },
          { count: 6, label: "6M", step: "month", stepmode: "backward" },
          { count: 1, label: "1Y", step: "year", stepmode: "backward" },
          { step: "all", label: "All" },
        ],
      },
      type: "date",
      tickangle: -45,
      nticks: 10,
    },
    xaxis2: {
      domain: [0.7, 1],
      showticklabels: false,
      title: { text: "Volume Profile", font: { size: 11 } },
    },
    yaxis: {
      title: { text: "Price ($)" },
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
        x1: 0.68,
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
        x: 1.02,
        xref: "paper",
        y: tf.vah,
        yref: "y",
        text: `VAH $${tf.vah.toFixed(1)}`,
        showarrow: false,
        font: { size: 11, color: "white" },
        bgcolor: "red",
        borderpad: 2,
        xanchor: "left",
      },
      {
        x: 1.02,
        xref: "paper",
        y: tf.poc,
        yref: "y",
        text: `POC $${tf.poc.toFixed(1)}`,
        showarrow: false,
        font: { size: 11, color: "white" },
        bgcolor: "orange",
        borderpad: 2,
        xanchor: "left",
      },
      {
        x: 1.02,
        xref: "paper",
        y: tf.val,
        yref: "y",
        text: `VAL $${tf.val.toFixed(1)}`,
        showarrow: false,
        font: { size: 11, color: "white" },
        bgcolor: "green",
        borderpad: 2,
        xanchor: "left",
      },
    ],
  };

  const traces = [candlestickTrace];
  if (histTrace) traces.push(histTrace);

  const tfLabels = { daily: "日線 (1年價格 / 60日 VP)", weekly: "周線 (52週)", monthly: "月線 (12月)" };

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
        config={{ displayModeBar: true, responsive: true, displaylogo: false }}
        style={{ width: "100%" }}
      />
    </div>
  );
}
