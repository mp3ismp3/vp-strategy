import { expect, it } from "vitest";
import { buildRvolChart } from "@/lib/rvol-chart";
import { analyzeRvol } from "@/lib/rvol";
it("aligns price, actual volume and preceding average on the same dates", () => {
  const bars = Array.from({ length: 21 }, (_, i) => ({ time: `day-${i}`, open: 99, high: i === 20 ? 103 : 100, low: 98, close: i === 20 ? 102 : 99, volume: i === 20 ? 220 : 100 }));
  const chart = buildRvolChart(bars, analyzeRvol(bars));
  expect(chart.data[0]).toMatchObject({ x: bars.map(b => b.time) });
  expect(chart.data[1]).toMatchObject({ x: bars.map(b => b.time) });
  expect(chart.data[2]).toMatchObject({ y: [...Array(20).fill(null), 100] });
  expect(chart.layout.annotations?.[0]).toMatchObject({ x: "day-20", y: 100 });
});
