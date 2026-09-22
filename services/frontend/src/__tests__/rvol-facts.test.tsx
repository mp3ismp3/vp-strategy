import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { expect, it } from "vitest";
import { RvolFacts } from "@/components/RvolFacts";
import { analyzeRvol } from "@/lib/rvol";
import type { OHLCBar } from "@/lib/macd";

const bars: OHLCBar[] = Array.from({ length: 20 }, (_, i) => ({
  time: `day-${i}`, open: 99, high: 100, low: 96, close: 99, volume: 100,
}));
bars.push({ time: "breakout", open: 99, high: 103, low: 98, close: 102, volume: 180 });

it("shows prices, dated volume and exact retest conditions without predicting success", () => {
  const html = renderToStaticMarkup(<RvolFacts analysis={analyzeRvol(bars)} bars={bars} />);
  expect(html).toContain("$102.00");
  expect(html).toContain("$100.00");
  expect(html).toContain("1.80×");
  expect(html).toContain("$100.50");
  expect(html).toContain("$99.50");
  expect(html).toContain("breakout");
  expect(html).not.toMatch(/勝率|推薦進場|強烈買入/);
});

it("keeps historical events separate from the latest session", () => {
  const history = [...bars,
    { ...bars[20], time: "retest", low: 100, close: 101, volume: 62.4 },
    { ...bars[20], time: "latest", low: 101, close: 102, volume: 180 },
  ];
  const html = renderToStaticMarkup(<RvolFacts analysis={analyzeRvol(history)} bars={history} />);
  expect(html).toContain("最近事件（歷史紀錄）");
  expect(html).toContain("retest");
  expect(html).toContain("0.60×");
  expect(html).toContain("latest");
});

it.each([{ input: [] }, { input: bars.slice(0, 10) }])("handles missing or insufficient data", ({ input }) => {
  const html = renderToStaticMarkup(<RvolFacts analysis={analyzeRvol(input)} bars={input} />);
  expect(html).toContain("資料不足");
  expect(html).not.toMatch(/NaN|Infinity/);
});

it("marks an invalidated setup as ended", () => {
  const history = [...bars, { ...bars[20], time: "failed", low: 98, close: 99 }];
  const html = renderToStaticMarkup(<RvolFacts analysis={analyzeRvol(history)} bars={history} />);
  expect(html).toContain("已結束：收盤跌破失效");
  expect(html).not.toContain("剩餘 9 根");
});

it("renders dated comparisons and a factual summary, including unmet volume conditions", () => {
  const history = [...bars, { ...bars[20], time: "retest", low: 100.2, close: 101, volume: 187.2 }];
  const html = renderToStaticMarkup(<RvolFacts analysis={analyzeRvol(history)} bars={history} />);
  expect(html).toContain("RVOL 自動摘要");
  expect(html).toContain("RVOL 逐項比對");
  expect(html).toContain("一般回踩價格條件成立，縮量條件未成立");
  expect(html).toContain("數據日期");
  expect(html).toContain("未成立");
});
