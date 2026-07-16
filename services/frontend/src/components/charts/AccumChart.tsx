"use client";

import { useEffect, useState } from "react";
import dynamic from "next/dynamic";

const Plot = dynamic(() => import("react-plotly.js"), { ssr: false });

interface AccumChartProps {
  ticker: string;
  phase: string;
  decay_score: number;
  support_primary: number;
  support_dynamic: number;
  resistance: number;
}

interface OHLCBar {
  time: string;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

export function AccumChart({
  ticker,
  phase,
  decay_score,
  support_primary,
  support_dynamic,
  resistance,
}: AccumChartProps) {
  const [ohlc, setOhlc] = useState<OHLCBar[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    import("@supabase/supabase-js").then(({ createClient }) => {
      const supabase = createClient(
        process.env.NEXT_PUBLIC_SUPABASE_URL!,
        process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
      );
      supabase
        .from("chart_data")
        .select("data")
        .eq("ticker", ticker.toUpperCase())
        .single()
        .then(({ data: row, error }) => {
          if (row?.data?.daily?.ohlc) {
            setOhlc(row.data.daily.ohlc);
          }
          setLoading(false);
        });
    });
  }, [ticker]);

  if (loading) {
    return (
      <div className="flex items-center justify-center h-[500px]">
        <div className="animate-spin rounded-full h-6 w-6 border-b-2 border-gray-900" />
      </div>
    );
  }

  if (ohlc.length === 0) {
    return <div className="text-center text-gray-500 py-8">無圖表數據</div>;
  }

  // Compute OBV
  const obv: number[] = [0];
  for (let i = 1; i < ohlc.length; i++) {
    if (ohlc[i].close > ohlc[i - 1].close) {
      obv.push(obv[i - 1] + ohlc[i].volume);
    } else if (ohlc[i].close < ohlc[i - 1].close) {
      obv.push(obv[i - 1] - ohlc[i].volume);
    } else {
      obv.push(obv[i - 1]);
    }
  }

  // OBV MA(20)
  const obvMA: (number | null)[] = obv.map((_, i) => {
    if (i < 19) return null;
    const slice = obv.slice(i - 19, i + 1);
    return slice.reduce((a, b) => a + b, 0) / 20;
  });

  // Volume median(20)
  const volMedian: (number | null)[] = ohlc.map((_, i) => {
    if (i < 19) return null;
    const slice = ohlc.slice(i - 19, i + 1).map((b) => b.volume);
    const sorted = [...slice].sort((a, b) => a - b);
    return sorted[10];
  });

  // Volume bar colors
  const volColors = ohlc.map((bar, i) =>
    i === 0 ? "#26a69a" : bar.close >= ohlc[i - 1].close ? "#26a69a" : "#ef5350"
  );

  const times = ohlc.map((b) => b.time);

  // Row 1: Candlestick + S/R
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

  // Row 2: OBV
  const obvTrace: any = {
    type: "scatter",
    x: times,
    y: obv,
    mode: "lines",
    line: { color: "#42a5f5", width: 2 },
    name: "OBV",
    xaxis: "x2",
    yaxis: "y2",
  };

  const obvMATrace: any = {
    type: "scatter",
    x: times,
    y: obvMA,
    mode: "lines",
    line: { color: "#ffa726", width: 1, dash: "dot" },
    name: "OBV MA(20)",
    xaxis: "x2",
    yaxis: "y2",
  };

  // Row 3: Volume
  const volTrace: any = {
    type: "bar",
    x: times,
    y: ohlc.map((b) => b.volume),
    marker: { color: volColors },
    name: "Volume",
    opacity: 0.7,
    xaxis: "x3",
    yaxis: "y3",
  };

  const volMedianTrace: any = {
    type: "scatter",
    x: times,
    y: volMedian,
    mode: "lines",
    line: { color: "#ffeb3b", width: 1, dash: "dot" },
    name: "Vol Median(20)",
    xaxis: "x3",
    yaxis: "y3",
  };

  // Support/Resistance shapes
  const shapes: any[] = [];
  if (support_primary) {
    shapes.push({
      type: "line", xref: "paper", yref: "y",
      x0: 0, x1: 1, y0: support_primary, y1: support_primary,
      line: { color: "red", width: 1, dash: "dash" },
    });
  }
  if (support_dynamic && support_dynamic !== support_primary) {
    shapes.push({
      type: "line", xref: "paper", yref: "y",
      x0: 0, x1: 1, y0: support_dynamic, y1: support_dynamic,
      line: { color: "orange", width: 1, dash: "dot" },
    });
  }
  if (resistance) {
    shapes.push({
      type: "line", xref: "paper", yref: "y",
      x0: 0, x1: 1, y0: resistance, y1: resistance,
      line: { color: "#4caf50", width: 1, dash: "dash" },
    });
  }

  const layout: any = {
    height: 550,
    margin: { l: 50, r: 20, t: 40, b: 30 },
    showlegend: false,
    paper_bgcolor: "white",
    plot_bgcolor: "white",
    title: {
      text: `${ticker} — Phase ${phase} | Score ${decay_score.toFixed(1)}`,
      font: { size: 14 },
    },
    xaxis: { domain: [0, 1], anchor: "y", showticklabels: false, rangeslider: { visible: false } },
    xaxis2: { domain: [0, 1], anchor: "y2", showticklabels: false },
    xaxis3: { domain: [0, 1], anchor: "y3" },
    yaxis: { domain: [0.48, 1], title: "Price" },
    yaxis2: { domain: [0.24, 0.45], title: "OBV" },
    yaxis3: { domain: [0, 0.21], title: "Volume" },
    shapes,
    annotations: [
      ...(support_primary ? [{
        x: 1.01, xref: "paper", y: support_primary, yref: "y",
        text: `SP $${support_primary.toFixed(0)}`, showarrow: false,
        font: { size: 9, color: "red" }, xanchor: "left",
      }] : []),
      ...(resistance ? [{
        x: 1.01, xref: "paper", y: resistance, yref: "y",
        text: `R $${resistance.toFixed(0)}`, showarrow: false,
        font: { size: 9, color: "green" }, xanchor: "left",
      }] : []),
    ],
  };

  return (
    <Plot
      data={[candlestick, obvTrace, obvMATrace, volTrace, volMedianTrace]}
      layout={layout}
      config={{ displayModeBar: false, responsive: true }}
      style={{ width: "100%" }}
    />
  );
}
