import type { Data, Layout } from "plotly.js";
import type { OHLCBar } from "./macd";
import { relativeVolume, type RvolAnalysis } from "./rvol";

export function buildRvolChart(bars: OHLCBar[], analysis: RvolAnalysis): { data: Data[]; layout: Partial<Layout> } {
  const x = bars.map(b => b.time);
  const averages = bars.map((_, i) => i < 20 ? null : bars.slice(i - 20, i).reduce((sum, b) => sum + b.volume, 0) / 20);
  const setup = analysis.setup;
  return {
    data: [
      { type: "candlestick", x, open: bars.map(b => b.open), high: bars.map(b => b.high), low: bars.map(b => b.low), close: bars.map(b => b.close), name: "已完成日 K", yaxis: "y" },
      { type: "bar", x, y: bars.map(b => b.volume), yaxis: "y2", name: "日成交量", text: bars.map((_, i) => `RVOL ${relativeVolume(bars, i)?.toFixed(2) ?? "資料不足"}`), hovertemplate: "%{x}<br>成交量 %{y}<br>%{text}<extra></extra>" },
      { type: "scatter", mode: "lines", x, y: averages, yaxis: "y2", name: "該日前20日均量" },
    ],
    layout: {
      height: 480, margin: { l: 65, r: 20, t: 40, b: 45 },
      title: { text: "20 日高點突破與回踩（日線量價）" },
      xaxis: { type: "category", rangeslider: { visible: false }, nticks: 10 },
      yaxis: { domain: [0.36, 1], title: { text: "價格" } },
      yaxis2: { domain: [0, 0.27], title: { text: "成交量" } },
      legend: { orientation: "h", y: 1.12 },
      shapes: setup ? [{ type: "line", xref: "x", yref: "y", x0: setup.breakoutDate, x1: analysis.asOf!, y0: setup.level, y1: setup.level, line: { color: "#2563eb", dash: "dash" } }] : [],
      annotations: setup ? [
        { x: setup.breakoutDate, y: setup.level, xref: "x", yref: "y", text: `突破 RVOL ${setup.breakoutRvol?.toFixed(2) ?? "—"}`, showarrow: true, ay: -40 },
        ...(setup.eventDate !== setup.breakoutDate ? [{ x: setup.eventDate, y: setup.level, xref: "x" as const, yref: "y" as const, text: `${setup.label} RVOL ${setup.eventRvol?.toFixed(2) ?? "—"}`, showarrow: true, ay: 40 }] : []),
      ] : [],
    },
  };
}
