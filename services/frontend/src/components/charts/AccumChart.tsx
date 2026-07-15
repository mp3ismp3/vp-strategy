"use client";

import dynamic from "next/dynamic";

const Plot = dynamic(() => import("react-plotly.js"), { ssr: false });

interface AccumChartProps {
  ticker: string;
  phase: string;
  decay_score: number;
  raw_score: number;
  support_primary: number;
  support_dynamic: number;
  resistance: number;
}

export function AccumChart({
  ticker,
  phase,
  decay_score,
  raw_score,
  support_primary,
  support_dynamic,
  resistance,
}: AccumChartProps) {
  // Score gauge chart
  const scoreTrace: any = {
    type: "indicator",
    mode: "gauge+number",
    value: decay_score,
    title: { text: `${ticker} — Phase ${phase}`, font: { size: 14 } },
    gauge: {
      axis: { range: [0, 18], tickwidth: 1 },
      bar: { color: decay_score >= 12 ? "#4caf50" : decay_score >= 9 ? "#ff9800" : "#f44336" },
      steps: [
        { range: [0, 6], color: "rgba(244,67,54,0.1)" },
        { range: [6, 9], color: "rgba(255,152,0,0.1)" },
        { range: [9, 12], color: "rgba(255,193,7,0.1)" },
        { range: [12, 18], color: "rgba(76,175,80,0.1)" },
      ],
      threshold: {
        line: { color: "blue", width: 2 },
        thickness: 0.75,
        value: raw_score,
      },
    },
  };

  // Levels bar chart
  const levelsTrace: any = {
    type: "bar",
    x: ["Support 1", "Support 2", "Resistance"],
    y: [support_primary, support_dynamic, resistance],
    marker: {
      color: ["#4caf50", "#8bc34a", "#f44336"],
    },
    text: [
      `$${support_primary.toFixed(2)}`,
      `$${support_dynamic.toFixed(2)}`,
      `$${resistance.toFixed(2)}`,
    ],
    textposition: "outside",
    hovertemplate: "%{x}: $%{y:.2f}<extra></extra>",
  };

  return (
    <div className="grid md:grid-cols-2 gap-4">
      <Plot
        data={[scoreTrace]}
        layout={{
          height: 250,
          margin: { l: 30, r: 30, t: 50, b: 10 },
          paper_bgcolor: "white",
        }}
        config={{ displayModeBar: false, responsive: true }}
        style={{ width: "100%" }}
      />
      <Plot
        data={[levelsTrace]}
        layout={{
          height: 250,
          margin: { l: 60, r: 20, t: 30, b: 40 },
          title: { text: "Support / Resistance", font: { size: 13 } },
          yaxis: { tickformat: "$.0f" },
          paper_bgcolor: "white",
          plot_bgcolor: "white",
        }}
        config={{ displayModeBar: false, responsive: true }}
        style={{ width: "100%" }}
      />
    </div>
  );
}
