"use client";

import { useEffect, useState } from "react";
import dynamic from "next/dynamic";
import type { Annotations, Data, Layout, Shape } from "plotly.js";
import type { FVGGap, OHLCBar } from "@/lib/fvg";

const Plot = dynamic(() => import("react-plotly.js"), { ssr: false });

export function FVGChart({ ticker, gaps }: { ticker: string; gaps: FVGGap[] }) {
  const [ohlc, setOhlc] = useState<OHLCBar[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch(`/api/data/chart-data?ticker=${encodeURIComponent(ticker)}`)
      .then(async (response) => response.ok ? response.json() : Promise.reject())
      .then((chart) => setOhlc(chart?.daily?.ohlc || []))
      .catch(() => setOhlc([]))
      .finally(() => setLoading(false));
  }, [ticker]);

  if (loading) return <div className="flex h-[420px] items-center justify-center text-gray-500">FVG 圖載入中</div>;
  if (!ohlc.length) return <div className="flex h-[240px] items-center justify-center text-gray-500">暫無 K 線資料</div>;

  const displayData = ohlc.slice(-60);
  const times = displayData.map((bar) => bar.time);
  const visibleGaps = gaps.filter((gap) => !gap.filled && times.includes(gap.date));
  const candlestick: Data = {
    type: "candlestick",
    x: times,
    open: displayData.map((bar) => bar.open),
    high: displayData.map((bar) => bar.high),
    low: displayData.map((bar) => bar.low),
    close: displayData.map((bar) => bar.close),
    increasing: { line: { color: "#15803d" } },
    decreasing: { line: { color: "#dc2626" } },
    name: "價格",
  };
  const shapes: Partial<Shape>[] = visibleGaps.map((gap) => ({
    type: "rect",
    xref: "x",
    yref: "y",
    x0: gap.date,
    x1: times.at(-1),
    y0: gap.gapLow,
    y1: gap.gapHigh,
    fillcolor: gap.type === "bullish" ? "rgba(21,128,61,0.16)" : "rgba(220,38,38,0.16)",
    line: { color: gap.type === "bullish" ? "#15803d" : "#dc2626", width: 1 },
  }));
  const annotations: Partial<Annotations>[] = visibleGaps.map((gap) => ({
    x: gap.date,
    y: gap.type === "bullish" ? gap.gapLow : gap.gapHigh,
    xref: "x",
    yref: "y",
    text: `${gap.type === "bullish" ? "多方" : "空方"} $${gap.gapLow.toFixed(2)}–$${gap.gapHigh.toFixed(2)}`,
    showarrow: false,
    font: { size: 10, color: gap.type === "bullish" ? "#15803d" : "#dc2626" },
    yshift: gap.type === "bullish" ? -12 : 12,
  }));
  const layout: Partial<Layout> = {
    height: 480,
    margin: { l: 60, r: 20, t: 20, b: 45 },
    showlegend: false,
    paper_bgcolor: "white",
    plot_bgcolor: "white",
    xaxis: { type: "category", rangeslider: { visible: false }, nticks: 12 },
    yaxis: { title: { text: "價格 ($)" }, gridcolor: "rgba(0,0,0,0.05)" },
    shapes,
    annotations,
  };

  return <Plot data={[candlestick]} layout={layout} config={{ responsive: true }} style={{ width: "100%" }} />;
}
